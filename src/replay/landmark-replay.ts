import type { HandTrackingFrame, TrackingProviderInfo } from "../tracking/tracking-types";

export const LANDMARK_REPLAY_SCHEMA_VERSION = 1 as const;

export interface LandmarkReplaySession {
  readonly sessionId: string;
  readonly createdAtIso: string;
  readonly appVersion: string;
  readonly provider: TrackingProviderInfo | null;
  readonly notes: string;
}

export interface LandmarkReplayDocument {
  readonly schema: "oto-motion-landmark-replay";
  readonly schemaVersion: typeof LANDMARK_REPLAY_SCHEMA_VERSION;
  readonly privacy: {
    readonly includesCameraFrames: false;
    readonly includesAudio: false;
    readonly derivedLandmarksOnly: true;
  };
  readonly session: LandmarkReplaySession;
  readonly frames: readonly HandTrackingFrame[];
}

export class LandmarkReplayRecorder {
  readonly #session: LandmarkReplaySession;
  readonly #frames: HandTrackingFrame[] = [];

  constructor(session: LandmarkReplaySession) {
    this.#session = session;
  }

  addFrame(frame: HandTrackingFrame): void {
    const previous = this.#frames.at(-1);
    if (previous !== undefined && frame.captureTimeMs < previous.captureTimeMs) {
      throw new RangeError("Replay frames must use monotonic capture times.");
    }
    this.#frames.push(cloneFrame(frame));
  }

  snapshot(): LandmarkReplayDocument {
    return {
      schema: "oto-motion-landmark-replay",
      schemaVersion: LANDMARK_REPLAY_SCHEMA_VERSION,
      privacy: {
        includesCameraFrames: false,
        includesAudio: false,
        derivedLandmarksOnly: true,
      },
      session: { ...this.#session },
      frames: this.#frames.map(cloneFrame),
    };
  }
}

export class LandmarkReplayCursor {
  readonly #frames: readonly HandTrackingFrame[];
  #index = 0;

  constructor(document: LandmarkReplayDocument) {
    this.#frames = document.frames.map(cloneFrame);
  }

  next(): HandTrackingFrame | null {
    const frame = this.#frames[this.#index];
    if (frame === undefined) return null;
    this.#index += 1;
    return cloneFrame(frame);
  }

  reset(): void {
    this.#index = 0;
  }
}

export function serializeLandmarkReplay(document: LandmarkReplayDocument): string {
  return JSON.stringify(document, null, 2);
}

export function parseLandmarkReplay(value: string): LandmarkReplayDocument {
  return parseLandmarkReplayValue(JSON.parse(value));
}

export function parseLandmarkReplayImport(value: string): LandmarkReplayDocument {
  const parsed: unknown = JSON.parse(value);
  if (isRecord(parsed) && parsed.schema === "oto-motion-p1-controlled") {
    return parseLandmarkReplayValue(parsed.replay);
  }
  return parseLandmarkReplayValue(parsed);
}

function parseLandmarkReplayValue(parsed: unknown): LandmarkReplayDocument {
  if (!isRecord(parsed)
    || parsed.schema !== "oto-motion-landmark-replay"
    || parsed.schemaVersion !== LANDMARK_REPLAY_SCHEMA_VERSION
    || !isRecord(parsed.session)
    || typeof parsed.session.sessionId !== "string"
    || typeof parsed.session.createdAtIso !== "string"
    || typeof parsed.session.appVersion !== "string"
    || typeof parsed.session.notes !== "string"
    || !Array.isArray(parsed.frames)) {
    throw new TypeError("Unsupported or invalid landmark replay document.");
  }
  const provider = parseProvider(parsed.session.provider);
  const frames = parsed.frames.map(parseFrame);
  for (let index = 1; index < frames.length; index += 1) {
    if (frames[index]!.captureTimeMs < frames[index - 1]!.captureTimeMs) {
      throw new TypeError("Replay capture times must be monotonic.");
    }
  }
  return {
    schema: "oto-motion-landmark-replay",
    schemaVersion: LANDMARK_REPLAY_SCHEMA_VERSION,
    privacy: {
      includesCameraFrames: false,
      includesAudio: false,
      derivedLandmarksOnly: true,
    },
    session: {
      sessionId: parsed.session.sessionId,
      createdAtIso: parsed.session.createdAtIso,
      appVersion: parsed.session.appVersion,
      provider,
      notes: parsed.session.notes,
    },
    frames,
  };
}

function parseFrame(value: unknown): HandTrackingFrame {
  if (!isRecord(value)
    || !finite(value.frameId)
    || !finite(value.captureTimeMs)
    || !finite(value.callbackTimeMs)
    || !finite(value.workerReceivedTimeMs)
    || !finite(value.inferenceStartedTimeMs)
    || !finite(value.inferenceCompletedTimeMs)
    || !Array.isArray(value.hands)) {
    throw new TypeError("Invalid replay frame.");
  }
  const hands = value.hands.map((hand, detectionIndex) => {
    if (!isRecord(hand)
      || !finite(hand.detectionIndex)
      || !isHandedness(hand.handedness)
      || !finite(hand.handednessScore)
      || !Array.isArray(hand.landmarks2D)
      || !Array.isArray(hand.landmarksWorld)) {
      throw new TypeError(`Invalid replay hand at index ${detectionIndex}.`);
    }
    return {
      detectionIndex: hand.detectionIndex,
      handedness: hand.handedness,
      handednessScore: hand.handednessScore,
      landmarks2D: hand.landmarks2D.map((point) => {
        if (!isRecord(point) || !finite(point.x) || !finite(point.y) || !finite(point.zRelative)) {
          throw new TypeError("Invalid 2D landmark.");
        }
        return { x: point.x, y: point.y, zRelative: point.zRelative };
      }),
      landmarksWorld: hand.landmarksWorld.map((point) => {
        if (!isRecord(point) || !finite(point.x) || !finite(point.y) || !finite(point.z)) {
          throw new TypeError("Invalid world landmark.");
        }
        return { x: point.x, y: point.y, z: point.z };
      }),
    };
  });
  return {
    frameId: value.frameId,
    captureTimeMs: value.captureTimeMs,
    callbackTimeMs: value.callbackTimeMs,
    workerReceivedTimeMs: value.workerReceivedTimeMs,
    inferenceStartedTimeMs: value.inferenceStartedTimeMs,
    inferenceCompletedTimeMs: value.inferenceCompletedTimeMs,
    hands,
  };
}

function parseProvider(value: unknown): TrackingProviderInfo | null {
  if (value === null) return null;
  if (!isRecord(value)
    || (value.delegate !== "GPU" && value.delegate !== "CPU")
    || (value.fallbackReason !== null && typeof value.fallbackReason !== "string")
    || typeof value.packageId !== "string"
    || typeof value.modelId !== "string") {
    throw new TypeError("Invalid replay provider metadata.");
  }
  return {
    delegate: value.delegate,
    fallbackReason: value.fallbackReason,
    packageId: value.packageId,
    modelId: value.modelId,
  };
}

function cloneFrame(frame: HandTrackingFrame): HandTrackingFrame {
  return {
    ...frame,
    hands: frame.hands.map((hand) => ({
      ...hand,
      landmarks2D: hand.landmarks2D.map((point) => ({ ...point })),
      landmarksWorld: hand.landmarksWorld.map((point) => ({ ...point })),
    })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isHandedness(value: unknown): value is "left" | "right" | "unknown" {
  return value === "left" || value === "right" || value === "unknown";
}
