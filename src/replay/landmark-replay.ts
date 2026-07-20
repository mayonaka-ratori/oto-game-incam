import type { DetectedHand, HandTrackingFrame, TrackingProviderInfo } from "../tracking/tracking-types";
import type { P1ActiveTrialTiming, P1Resolution } from "../poc/phase1-protocol";

export const LANDMARK_REPLAY_SCHEMA_VERSION = 2 as const;
const REPLAY_PRE_ROLL_MS = 500;
const REPLAY_POST_ROLL_MS = 500;

export interface LandmarkReplaySession {
  readonly sessionId: string;
  readonly createdAtIso: string;
  readonly appVersion: string;
  readonly provider: TrackingProviderInfo | null;
  readonly notes: string;
}

export type LandmarkReplayFrameV2 = Omit<HandTrackingFrame, "hands"> & {
  readonly hands: ReadonlyArray<Omit<DetectedHand, "landmarksWorld">>;
};

export interface LandmarkReplayTrialWindow {
  readonly trialId: string;
  readonly ordinal: number;
  readonly startFrameIndex: number;
  readonly endFrameIndex: number;
  readonly timing: P1ActiveTrialTiming;
  readonly resolution: P1Resolution | null;
  readonly finishedAtMs: number | null;
}

interface LandmarkReplayPrivacy {
  readonly includesCameraFrames: false;
  readonly includesAudio: false;
  readonly derivedLandmarksOnly: true;
}

export interface LandmarkReplayDocumentV1 {
  readonly schema: "oto-motion-landmark-replay";
  readonly schemaVersion: 1;
  readonly privacy: LandmarkReplayPrivacy;
  readonly session: LandmarkReplaySession;
  readonly frames: readonly HandTrackingFrame[];
}

export interface LandmarkReplayDocumentV2 {
  readonly schema: "oto-motion-landmark-replay";
  readonly schemaVersion: typeof LANDMARK_REPLAY_SCHEMA_VERSION;
  readonly privacy: LandmarkReplayPrivacy;
  readonly session: LandmarkReplaySession;
  readonly frames: readonly LandmarkReplayFrameV2[];
  readonly trialWindows: readonly LandmarkReplayTrialWindow[];
}

export type LandmarkReplayDocument = LandmarkReplayDocumentV1 | LandmarkReplayDocumentV2;

interface ActiveTrialWindow {
  readonly trialId: string;
  readonly ordinal: number;
  readonly timing: P1ActiveTrialTiming;
  readonly startFrameIndex: number;
  resolution: P1Resolution | null;
  finishedAtMs: number | null;
}

export class LandmarkReplayRecorder {
  readonly #session: LandmarkReplaySession;
  readonly #frames: LandmarkReplayFrameV2[] = [];
  readonly #preRoll: LandmarkReplayFrameV2[] = [];
  readonly #frameIndexByKey = new Map<string, number>();
  readonly #trialWindows: LandmarkReplayTrialWindow[] = [];
  #activeWindow: ActiveTrialWindow | null = null;
  #lastCaptureTimeMs: number | null = null;

  constructor(session: LandmarkReplaySession) {
    this.#session = session;
  }

  addFrame(frame: HandTrackingFrame): void {
    if (this.#lastCaptureTimeMs !== null && frame.captureTimeMs < this.#lastCaptureTimeMs) {
      throw new RangeError("Replay frames must use monotonic capture times.");
    }
    this.#lastCaptureTimeMs = frame.captureTimeMs;
    const compactFrame = cloneFrameV2(frame);
    this.#preRoll.push(compactFrame);
    const cutoff = frame.captureTimeMs - REPLAY_PRE_ROLL_MS;
    while (this.#preRoll[0] !== undefined && this.#preRoll[0].captureTimeMs < cutoff) this.#preRoll.shift();

    const active = this.#activeWindow;
    if (active === null) return;
    if (active.finishedAtMs !== null && frame.captureTimeMs > active.finishedAtMs + REPLAY_POST_ROLL_MS) {
      this.#finalizeActiveWindow();
      return;
    }
    this.#appendFrame(compactFrame);
  }

  beginTrial(input: {
    readonly trialId: string;
    readonly ordinal: number;
    readonly timing: P1ActiveTrialTiming;
  }): void {
    this.#finalizeActiveWindow();
    const preRollCutoff = input.timing.preparedAtMs - REPLAY_PRE_ROLL_MS;
    while (this.#preRoll[0] !== undefined && this.#preRoll[0].captureTimeMs < preRollCutoff) this.#preRoll.shift();
    let startFrameIndex = this.#frames.length;
    for (const frame of this.#preRoll) {
      startFrameIndex = Math.min(startFrameIndex, this.#appendFrame(frame));
    }
    this.#activeWindow = {
      ...input,
      startFrameIndex,
      resolution: null,
      finishedAtMs: null,
    };
  }

  finishTrial(input: {
    readonly trialId: string;
    readonly resolution: P1Resolution;
    readonly finishedAtMs: number;
  }): void {
    if (this.#activeWindow?.trialId !== input.trialId || this.#activeWindow.finishedAtMs !== null) return;
    this.#activeWindow.resolution = input.resolution;
    this.#activeWindow.finishedAtMs = input.finishedAtMs;
  }

  get postRollPending(): boolean {
    return typeof this.#activeWindow?.finishedAtMs === "number";
  }

  get frameCount(): number {
    return this.#frames.length;
  }

  snapshot(): LandmarkReplayDocumentV2 {
    const windows = [...this.#trialWindows];
    const active = this.#activeWindow;
    if (active !== null) windows.push(this.#windowSnapshot(active));
    return {
      schema: "oto-motion-landmark-replay",
      schemaVersion: LANDMARK_REPLAY_SCHEMA_VERSION,
      privacy: privacy(),
      session: cloneSession(this.#session),
      frames: this.#frames.map(cloneFrameV2),
      trialWindows: windows,
    };
  }

  #appendFrame(frame: LandmarkReplayFrameV2): number {
    const key = frameKey(frame);
    const existing = this.#frameIndexByKey.get(key);
    if (existing !== undefined) return existing;
    const index = this.#frames.length;
    this.#frames.push(cloneFrameV2(frame));
    this.#frameIndexByKey.set(key, index);
    return index;
  }

  #finalizeActiveWindow(): void {
    const active = this.#activeWindow;
    if (active === null) return;
    this.#trialWindows.push(this.#windowSnapshot(active));
    this.#activeWindow = null;
  }

  #windowSnapshot(active: ActiveTrialWindow): LandmarkReplayTrialWindow {
    return {
      trialId: active.trialId,
      ordinal: active.ordinal,
      startFrameIndex: active.startFrameIndex,
      endFrameIndex: Math.max(active.startFrameIndex - 1, this.#frames.length - 1),
      timing: { ...active.timing },
      resolution: active.resolution,
      finishedAtMs: active.finishedAtMs,
    };
  }
}

export class LandmarkReplayCursor {
  readonly #frames: readonly HandTrackingFrame[];
  #index = 0;

  constructor(document: LandmarkReplayDocument) {
    this.#frames = document.frames.map(toHandTrackingFrame);
  }

  next(): HandTrackingFrame | null {
    const frame = this.#frames[this.#index];
    if (frame === undefined) return null;
    this.#index += 1;
    return cloneFrameV1(frame);
  }

  reset(): void {
    this.#index = 0;
  }
}

export function serializeLandmarkReplay(document: LandmarkReplayDocument): string {
  return JSON.stringify(document);
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

export function toHandTrackingFrame(frame: HandTrackingFrame | LandmarkReplayFrameV2): HandTrackingFrame {
  return {
    ...frame,
    hands: frame.hands.map((hand) => ({
      ...hand,
      landmarks2D: hand.landmarks2D.map((point) => ({ ...point })),
      landmarksWorld: "landmarksWorld" in hand && Array.isArray(hand.landmarksWorld)
        ? hand.landmarksWorld.map((point) => ({ ...point }))
        : [],
    })),
  };
}

function parseLandmarkReplayValue(parsed: unknown): LandmarkReplayDocument {
  if (!isRecord(parsed)
    || parsed.schema !== "oto-motion-landmark-replay"
    || (parsed.schemaVersion !== 1 && parsed.schemaVersion !== LANDMARK_REPLAY_SCHEMA_VERSION)
    || !isRecord(parsed.session)
    || typeof parsed.session.sessionId !== "string"
    || typeof parsed.session.createdAtIso !== "string"
    || typeof parsed.session.appVersion !== "string"
    || typeof parsed.session.notes !== "string"
    || !Array.isArray(parsed.frames)) {
    throw new TypeError("Unsupported or invalid landmark replay document.");
  }
  const session: LandmarkReplaySession = {
    sessionId: parsed.session.sessionId,
    createdAtIso: parsed.session.createdAtIso,
    appVersion: parsed.session.appVersion,
    provider: parseProvider(parsed.session.provider),
    notes: parsed.session.notes,
  };
  if (parsed.schemaVersion === 1) {
    const frames = parsed.frames.map((frame) => parseFrame(frame, true) as HandTrackingFrame);
    assertMonotonic(frames);
    return { schema: "oto-motion-landmark-replay", schemaVersion: 1, privacy: privacy(), session, frames };
  }
  const frames = parsed.frames.map((frame) => parseFrame(frame, false) as LandmarkReplayFrameV2);
  assertMonotonic(frames);
  const trialWindows = Array.isArray(parsed.trialWindows)
    ? parsed.trialWindows.map(parseTrialWindow)
    : [];
  return {
    schema: "oto-motion-landmark-replay",
    schemaVersion: LANDMARK_REPLAY_SCHEMA_VERSION,
    privacy: privacy(),
    session,
    frames,
    trialWindows,
  };
}

function parseFrame(value: unknown, includeWorld: boolean): HandTrackingFrame | LandmarkReplayFrameV2 {
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
      || (includeWorld && !Array.isArray(hand.landmarksWorld))) {
      throw new TypeError(`Invalid replay hand at index ${detectionIndex}.`);
    }
    const base = {
      detectionIndex: hand.detectionIndex,
      handedness: hand.handedness,
      handednessScore: hand.handednessScore,
      landmarks2D: hand.landmarks2D.map(parsePoint2D),
    };
    return includeWorld
      ? { ...base, landmarksWorld: (hand.landmarksWorld as unknown[]).map(parsePointWorld) }
      : base;
  });
  return {
    frameId: value.frameId,
    captureTimeMs: value.captureTimeMs,
    callbackTimeMs: value.callbackTimeMs,
    workerReceivedTimeMs: value.workerReceivedTimeMs,
    inferenceStartedTimeMs: value.inferenceStartedTimeMs,
    inferenceCompletedTimeMs: value.inferenceCompletedTimeMs,
    hands,
  } as HandTrackingFrame | LandmarkReplayFrameV2;
}

function parseTrialWindow(value: unknown): LandmarkReplayTrialWindow {
  if (!isRecord(value)
    || typeof value.trialId !== "string"
    || !finite(value.ordinal)
    || !finite(value.startFrameIndex)
    || !finite(value.endFrameIndex)
    || !isRecord(value.timing)
    || !finite(value.timing.preparedAtMs)
    || !finite(value.timing.windowOpenedAtMs)
    || (value.timing.targetTimeMs !== null && !finite(value.timing.targetTimeMs))
    || !finite(value.timing.deadlineTimeMs)
    || (value.finishedAtMs !== null && !finite(value.finishedAtMs))
    || (value.resolution !== null && !isResolution(value.resolution))) {
    throw new TypeError("Invalid replay trial window.");
  }
  return {
    trialId: value.trialId,
    ordinal: value.ordinal,
    startFrameIndex: value.startFrameIndex,
    endFrameIndex: value.endFrameIndex,
    timing: {
      preparedAtMs: value.timing.preparedAtMs,
      windowOpenedAtMs: value.timing.windowOpenedAtMs,
      targetTimeMs: value.timing.targetTimeMs as number | null,
      deadlineTimeMs: value.timing.deadlineTimeMs,
    },
    resolution: value.resolution as P1Resolution | null,
    finishedAtMs: value.finishedAtMs as number | null,
  };
}

function parsePoint2D(value: unknown): { x: number; y: number; zRelative: number } {
  if (!isRecord(value) || !finite(value.x) || !finite(value.y) || !finite(value.zRelative)) {
    throw new TypeError("Invalid 2D landmark.");
  }
  return { x: value.x, y: value.y, zRelative: value.zRelative };
}

function parsePointWorld(value: unknown): { x: number; y: number; z: number } {
  if (!isRecord(value) || !finite(value.x) || !finite(value.y) || !finite(value.z)) {
    throw new TypeError("Invalid world landmark.");
  }
  return { x: value.x, y: value.y, z: value.z };
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

function cloneFrameV1(frame: HandTrackingFrame): HandTrackingFrame {
  return toHandTrackingFrame(frame);
}

function cloneFrameV2(frame: HandTrackingFrame | LandmarkReplayFrameV2): LandmarkReplayFrameV2 {
  return {
    frameId: frame.frameId,
    captureTimeMs: frame.captureTimeMs,
    callbackTimeMs: frame.callbackTimeMs,
    workerReceivedTimeMs: frame.workerReceivedTimeMs,
    inferenceStartedTimeMs: frame.inferenceStartedTimeMs,
    inferenceCompletedTimeMs: frame.inferenceCompletedTimeMs,
    hands: frame.hands.map((hand) => ({
      detectionIndex: hand.detectionIndex,
      handedness: hand.handedness,
      handednessScore: hand.handednessScore,
      landmarks2D: hand.landmarks2D.map((point) => ({ ...point })),
    })),
  };
}

function cloneSession(session: LandmarkReplaySession): LandmarkReplaySession {
  return { ...session, provider: session.provider === null ? null : { ...session.provider } };
}

function privacy(): LandmarkReplayPrivacy {
  return { includesCameraFrames: false, includesAudio: false, derivedLandmarksOnly: true };
}

function frameKey(frame: LandmarkReplayFrameV2): string {
  return `${frame.frameId}:${frame.captureTimeMs}`;
}

function assertMonotonic(frames: ReadonlyArray<{ readonly captureTimeMs: number }>): void {
  for (let index = 1; index < frames.length; index += 1) {
    if (frames[index]!.captureTimeMs < frames[index - 1]!.captureTimeMs) {
      throw new TypeError("Replay capture times must be monotonic.");
    }
  }
}

function isResolution(value: unknown): value is P1Resolution {
  return value === "gesture-event"
    || value === "manual-classification"
    || value === "manual-skip"
    || value === "trial-timeout";
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
