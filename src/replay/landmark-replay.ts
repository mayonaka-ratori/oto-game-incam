import type { DetectedHand, HandTrackingFrame, TrackingProviderInfo } from "../tracking/tracking-types";
import type { P1ActiveTrialTiming, P1ReadinessTiming, P1Resolution } from "../poc/phase1-protocol";

/** v3: a trial window may hold only a readiness phase (timing null) or a discarded attempt. v1 and v2 stay readable. */
export const LANDMARK_REPLAY_SCHEMA_VERSION = 3 as const;
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
  /** Recognition timing. Null when a readiness-gated trial ended before the count-in. */
  readonly timing: P1ActiveTrialTiming | null;
  readonly readiness: P1ReadinessTiming | null;
  readonly resolution: P1Resolution | null;
  readonly finishedAtMs: number | null;
  /** The attempt was discarded by a pause and repeated later under the same trialId. */
  readonly abandoned: boolean;
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

/** Compact frames without world landmarks. Version 2 files are read into the same shape as version 3. */
export interface LandmarkReplayDocumentV2 {
  readonly schema: "oto-motion-landmark-replay";
  readonly schemaVersion: 2 | typeof LANDMARK_REPLAY_SCHEMA_VERSION;
  readonly privacy: LandmarkReplayPrivacy;
  readonly session: LandmarkReplaySession;
  readonly frames: readonly LandmarkReplayFrameV2[];
  readonly trialWindows: readonly LandmarkReplayTrialWindow[];
}

export type LandmarkReplayDocument = LandmarkReplayDocumentV1 | LandmarkReplayDocumentV2;

/** What the P1 result JSON records about the replay. Reading it must not copy the frames. */
export interface LandmarkReplayCounts {
  readonly frameCount: number;
  readonly trialWindowCount: number;
}

/** A trial window starts with recognition timing, or with a readiness phase that has no timing yet. */
export type LandmarkReplayTrialStart =
  | {
    readonly trialId: string;
    readonly ordinal: number;
    readonly timing: P1ActiveTrialTiming;
    readonly readiness?: P1ReadinessTiming | null;
  }
  | {
    readonly trialId: string;
    readonly ordinal: number;
    readonly timing: null;
    readonly readiness: P1ReadinessTiming;
  };

interface ActiveTrialWindow {
  readonly trialId: string;
  readonly ordinal: number;
  timing: P1ActiveTrialTiming | null;
  readiness: P1ReadinessTiming | null;
  readonly startFrameIndex: number;
  resolution: P1Resolution | null;
  finishedAtMs: number | null;
  abandoned: boolean;
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

  beginTrial(input: LandmarkReplayTrialStart): void {
    this.#finalizeActiveWindow();
    const startedAtMs = input.timing?.preparedAtMs ?? input.readiness?.startedAtMs ?? Number.NEGATIVE_INFINITY;
    const preRollCutoff = startedAtMs - REPLAY_PRE_ROLL_MS;
    while (this.#preRoll[0] !== undefined && this.#preRoll[0].captureTimeMs < preRollCutoff) this.#preRoll.shift();
    let startFrameIndex = this.#frames.length;
    for (const frame of this.#preRoll) {
      startFrameIndex = Math.min(startFrameIndex, this.#appendFrame(frame));
    }
    this.#activeWindow = {
      trialId: input.trialId,
      ordinal: input.ordinal,
      timing: input.timing === null ? null : { ...input.timing },
      readiness: input.readiness === undefined || input.readiness === null ? null : { ...input.readiness },
      startFrameIndex,
      resolution: null,
      finishedAtMs: null,
      abandoned: false,
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

  /** Records the recognition timing once a readiness-gated trial settles. */
  updateTrial(input: {
    readonly trialId: string;
    readonly timing: P1ActiveTrialTiming | null;
    readonly readiness: P1ReadinessTiming | null;
  }): void {
    const active = this.#activeWindow;
    if (active?.trialId !== input.trialId || active.finishedAtMs !== null) return;
    active.timing = input.timing === null ? null : { ...input.timing };
    active.readiness = input.readiness === null ? null : { ...input.readiness };
  }

  /** Closes the window of an attempt discarded by a pause. The retry opens a new window. */
  abandonTrial(input: { readonly trialId: string; readonly abandonedAtMs: number }): void {
    const active = this.#activeWindow;
    if (active?.trialId !== input.trialId || active.finishedAtMs !== null) return;
    active.abandoned = true;
    active.finishedAtMs = input.abandonedAtMs;
    // A discarded attempt needs no post-roll. Closing it now keeps saving from waiting for frames.
    this.#finalizeActiveWindow();
  }

  get postRollPending(): boolean {
    return typeof this.#activeWindow?.finishedAtMs === "number";
  }

  get frameCount(): number {
    return this.#frames.length;
  }

  /** Counts only, so exporting the light result JSON never deep-copies the recorded frames. */
  counts(): LandmarkReplayCounts {
    return {
      frameCount: this.#frames.length,
      trialWindowCount: this.#trialWindows.length + (this.#activeWindow === null ? 0 : 1),
    };
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

  /**
   * The compact frame was already copied once in addFrame and is never mutated afterwards, so the
   * pre-roll buffer and the recorded list share it instead of copying it a second time per frame.
   * snapshot() still copies on the way out.
   */
  #appendFrame(frame: LandmarkReplayFrameV2): number {
    const key = frameKey(frame);
    const existing = this.#frameIndexByKey.get(key);
    if (existing !== undefined) return existing;
    const index = this.#frames.length;
    this.#frames.push(frame);
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
      timing: active.timing === null ? null : { ...active.timing },
      readiness: active.readiness === null ? null : { ...active.readiness },
      resolution: active.resolution,
      finishedAtMs: active.finishedAtMs,
      abandoned: active.abandoned,
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
    || (parsed.schemaVersion !== 1 && parsed.schemaVersion !== 2 && parsed.schemaVersion !== LANDMARK_REPLAY_SCHEMA_VERSION)
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
  const schemaVersion = parsed.schemaVersion === 2 ? 2 : LANDMARK_REPLAY_SCHEMA_VERSION;
  const frames = parsed.frames.map((frame) => parseFrame(frame, false) as LandmarkReplayFrameV2);
  assertMonotonic(frames);
  const trialWindows = Array.isArray(parsed.trialWindows)
    ? parsed.trialWindows.map((window) => parseTrialWindow(window, schemaVersion))
    : [];
  return {
    schema: "oto-motion-landmark-replay",
    schemaVersion,
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

function parseTrialWindow(
  value: unknown,
  schemaVersion: 2 | typeof LANDMARK_REPLAY_SCHEMA_VERSION,
): LandmarkReplayTrialWindow {
  if (!isRecord(value)
    || typeof value.trialId !== "string"
    || !finite(value.ordinal)
    || !finite(value.startFrameIndex)
    || !finite(value.endFrameIndex)
    || (value.finishedAtMs !== null && !finite(value.finishedAtMs))
    || (value.resolution !== null && !isResolution(value.resolution))) {
    throw new TypeError("Invalid replay trial window.");
  }
  const timing = value.timing === null ? null : parseTrialTiming(value.timing);
  const readiness = value.readiness === undefined || value.readiness === null
    ? null
    : parseReadinessTiming(value.readiness);
  // Version 2 windows always had recognition timing; readiness-only windows start with version 3.
  if (timing === null && (readiness === null || schemaVersion === 2)) {
    throw new TypeError("Invalid replay trial window.");
  }
  return {
    trialId: value.trialId,
    ordinal: value.ordinal,
    startFrameIndex: value.startFrameIndex,
    endFrameIndex: value.endFrameIndex,
    timing,
    readiness,
    resolution: value.resolution as P1Resolution | null,
    finishedAtMs: value.finishedAtMs as number | null,
    abandoned: value.abandoned === true,
  };
}

function parseTrialTiming(value: unknown): P1ActiveTrialTiming {
  if (!isRecord(value)
    || !finite(value.preparedAtMs)
    || !finite(value.windowOpenedAtMs)
    || (value.targetTimeMs !== null && !finite(value.targetTimeMs))
    || !finite(value.deadlineTimeMs)
    || (value.readyAtMs !== undefined && value.readyAtMs !== null && !finite(value.readyAtMs))) {
    throw new TypeError("Invalid replay trial timing.");
  }
  return {
    preparedAtMs: value.preparedAtMs,
    readyAtMs: finite(value.readyAtMs) ? value.readyAtMs : null,
    windowOpenedAtMs: value.windowOpenedAtMs,
    targetTimeMs: value.targetTimeMs as number | null,
    deadlineTimeMs: value.deadlineTimeMs,
  };
}

function parseReadinessTiming(value: unknown): P1ReadinessTiming {
  if (!isRecord(value)
    || !finite(value.startedAtMs)
    || !finite(value.deadlineTimeMs)
    || !finite(value.requiredStableMs)
    || (value.readyAtMs !== null && !finite(value.readyAtMs))) {
    throw new TypeError("Invalid replay readiness timing.");
  }
  return {
    startedAtMs: value.startedAtMs,
    deadlineTimeMs: value.deadlineTimeMs,
    requiredStableMs: value.requiredStableMs,
    readyAtMs: value.readyAtMs as number | null,
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
