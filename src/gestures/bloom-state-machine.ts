import type { TrackedHandFeatures, TrackedHandFrame } from "../tracking/derived-tracking-types";
import {
  createGestureEventId,
  type GestureEvaluation,
  type GestureEvent,
  type GestureReasonCode,
  type GestureRejection,
} from "./gesture-types";

export interface BloomConfig {
  /** The starting hand span must be large enough to distinguish two hands. */
  readonly minimumPreparationSpan?: number;
  /** The starting hand span must remain within a comfortable central pose. */
  readonly maximumPreparationSpan?: number;
  /** How far the pair midpoint may be from the normalized center at arming time. */
  readonly preparationCenterToleranceX?: number;
  readonly preparationCenterToleranceY?: number;
  readonly minimumOutwardDistance?: number;
  readonly minimumUpwardDistance?: number;
  readonly minimumOutwardSpeed?: number;
  readonly maximumSyncWindowMs?: number;
  readonly maximumDurationMs?: number;
  readonly maximumTrackingGapMs?: number;
  readonly cooldownMs?: number;
}

export interface BloomDiagnosticHand {
  readonly trackId: string;
  readonly side: "left" | "right";
  readonly startX: number;
  readonly startY: number;
  readonly maximumOutwardDistance: number;
  readonly maximumUpwardDistance: number;
  readonly maximumOutwardSpeed: number;
  readonly outwardThresholdReachedAtMs: number | null;
  readonly upwardThresholdReachedAtMs: number | null;
}

export interface BloomTrackingGapDiagnostic {
  readonly startedAtMs: number;
  readonly reacquiredAtMs: number | null;
  readonly durationMs: number | null;
  readonly handIds: readonly string[];
}

export interface BloomTrialDiagnostic {
  readonly observationFrameCounts: {
    readonly zeroHands: number;
    readonly oneHand: number;
    readonly twoHands: number;
  };
  readonly lastTwoHandObservedAtMs: number | null;
  readonly armedAtMs: number | null;
  readonly triggerTimeMs: number | null;
  readonly maximumSyncSpreadMs: number;
  readonly preparationSpan: number | null;
  readonly hands: readonly BloomDiagnosticHand[];
  readonly latestTrackingGap: BloomTrackingGapDiagnostic | null;
  readonly rejectionReasonCodes: readonly GestureReasonCode[];
}

type BloomPhase = "armed" | "gap";

interface Point {
  readonly x: number;
  readonly y: number;
}

interface BloomCandidate {
  phase: BloomPhase;
  readonly leftId: string;
  readonly rightId: string;
  readonly leftStart: Point;
  readonly rightStart: Point;
  readonly startedAtMs: number;
  lastTimeMs: number;
  leftLast: Point;
  rightLast: Point;
  leftOutwardReadyAtMs: number | null;
  rightOutwardReadyAtMs: number | null;
  latestGapStartedAtMs: number | null;
}

interface MutableBloomDiagnosticHand extends BloomDiagnosticHand {
  maximumOutwardDistance: number;
  maximumUpwardDistance: number;
  maximumOutwardSpeed: number;
  outwardThresholdReachedAtMs: number | null;
  upwardThresholdReachedAtMs: number | null;
}

interface MutableBloomTrackingGapDiagnostic extends BloomTrackingGapDiagnostic {
  reacquiredAtMs: number | null;
  durationMs: number | null;
}

const DEFAULTS = {
  minimumPreparationSpan: 0.1,
  maximumPreparationSpan: 0.42,
  preparationCenterToleranceX: 0.22,
  preparationCenterToleranceY: 0.25,
  minimumOutwardDistance: 0.16,
  minimumUpwardDistance: 0.08,
  minimumOutwardSpeed: 0.12,
  maximumSyncWindowMs: 420,
  maximumDurationMs: 1_400,
  maximumTrackingGapMs: 150,
  cooldownMs: 280,
} as const;

export class BloomStateMachine {
  readonly #config: Required<BloomConfig>;
  #candidate: BloomCandidate | null = null;
  #cooldownUntilMs = -Infinity;
  #observationFrameCounts = { zeroHands: 0, oneHand: 0, twoHands: 0 };
  #lastTwoHandObservedAtMs: number | null = null;
  #armedAtMs: number | null = null;
  #triggerTimeMs: number | null = null;
  #maximumSyncSpreadMs = 0;
  #preparationSpan: number | null = null;
  #diagnosticHands: MutableBloomDiagnosticHand[] = [];
  #latestTrackingGap: MutableBloomTrackingGapDiagnostic | null = null;
  #rejectionReasonCodes: GestureReasonCode[] = [];

  constructor(config: BloomConfig = {}) {
    this.#config = { ...DEFAULTS, ...config };
  }

  /** Ignore all preparation motion so it cannot become an active Bloom. */
  prepare(frame: TrackedHandFrame): GestureEvaluation {
    void frame;
    this.#candidate = null;
    this.#armedAtMs = null;
    this.#triggerTimeMs = null;
    return { frame, events: [], rejections: [] };
  }

  process(frame: TrackedHandFrame): GestureEvaluation {
    const events: GestureEvent[] = [];
    const rejections: GestureRejection[] = [];
    this.#recordObservation(frame);

    if (this.#candidate === null) {
      this.#tryArm(frame);
      return { frame, events, rejections };
    }

    const candidate = this.#candidate;
    const visible = new Map(frame.hands.map((hand) => [hand.trackId, hand]));
    const left = visible.get(candidate.leftId);
    const right = visible.get(candidate.rightId);
    if (left === undefined || right === undefined) {
      const elapsed = frame.captureTimeMs - candidate.lastTimeMs;
      if (elapsed <= this.#config.maximumTrackingGapMs) {
        candidate.phase = "gap";
        if (candidate.latestGapStartedAtMs === null) {
          candidate.latestGapStartedAtMs = frame.captureTimeMs;
          this.#latestTrackingGap = {
            startedAtMs: frame.captureTimeMs,
            reacquiredAtMs: null,
            durationMs: null,
            handIds: [candidate.leftId, candidate.rightId],
          };
        }
        return { frame, events, rejections };
      }
      this.#reject(candidate, frame.captureTimeMs, "tracking-lost", rejections);
      return { frame, events, rejections };
    }

    if (candidate.phase === "gap") {
      const gapMs = frame.captureTimeMs - candidate.lastTimeMs;
      if (gapMs > this.#config.maximumTrackingGapMs) {
        this.#reject(candidate, frame.captureTimeMs, "tracking-lost", rejections);
        return { frame, events, rejections };
      }
      candidate.phase = "armed";
      if (this.#latestTrackingGap !== null && this.#latestTrackingGap.reacquiredAtMs === null) {
        this.#latestTrackingGap.reacquiredAtMs = frame.captureTimeMs;
        this.#latestTrackingGap.durationMs = Math.max(
          0,
          frame.captureTimeMs - this.#latestTrackingGap.startedAtMs,
        );
      }
      candidate.latestGapStartedAtMs = null;
    }

    const elapsed = frame.captureTimeMs - candidate.startedAtMs;
    if (elapsed > this.#config.maximumDurationMs) {
      this.#rejectInsufficient(candidate, frame.captureTimeMs, rejections);
      return { frame, events, rejections };
    }

    const deltaMs = frame.captureTimeMs - candidate.lastTimeMs;
    const leftMotion = measureMotion(candidate.leftStart, candidate.leftLast, left, deltaMs, "left");
    const rightMotion = measureMotion(candidate.rightStart, candidate.rightLast, right, deltaMs, "right");
    const leftDiagnostic = this.#diagnosticHands.find(({ trackId }) => trackId === candidate.leftId);
    const rightDiagnostic = this.#diagnosticHands.find(({ trackId }) => trackId === candidate.rightId);
    if (leftDiagnostic !== undefined) updateDiagnosticHand(leftDiagnostic, leftMotion);
    if (rightDiagnostic !== undefined) updateDiagnosticHand(rightDiagnostic, rightMotion);

    if (leftMotion.outward < -0.025 || rightMotion.outward < -0.025) {
      this.#reject(candidate, frame.captureTimeMs, "bloom-not-outward", rejections);
      return { frame, events, rejections };
    }
    if (leftMotion.upward < -0.025 || rightMotion.upward < -0.025) {
      this.#reject(candidate, frame.captureTimeMs, "bloom-not-upward", rejections);
      return { frame, events, rejections };
    }

    const leftReadyAtMs = completeAt(
      candidate.leftStart,
      candidate.leftLast,
      left,
      candidate.lastTimeMs,
      frame.captureTimeMs,
      candidate.leftOutwardReadyAtMs,
      this.#config.minimumOutwardDistance,
      this.#config.minimumUpwardDistance,
      "left",
    );
    const rightReadyAtMs = completeAt(
      candidate.rightStart,
      candidate.rightLast,
      right,
      candidate.lastTimeMs,
      frame.captureTimeMs,
      candidate.rightOutwardReadyAtMs,
      this.#config.minimumOutwardDistance,
      this.#config.minimumUpwardDistance,
      "right",
    );
    candidate.leftOutwardReadyAtMs = leftReadyAtMs;
    candidate.rightOutwardReadyAtMs = rightReadyAtMs;
    updateThresholdDiagnostics(
      this.#diagnosticHands.find(({ trackId }) => trackId === candidate.leftId),
      candidate.leftStart,
      candidate.leftLast,
      left,
      candidate.lastTimeMs,
      frame.captureTimeMs,
      this.#config.minimumOutwardDistance,
      this.#config.minimumUpwardDistance,
      "left",
    );
    updateThresholdDiagnostics(
      this.#diagnosticHands.find(({ trackId }) => trackId === candidate.rightId),
      candidate.rightStart,
      candidate.rightLast,
      right,
      candidate.lastTimeMs,
      frame.captureTimeMs,
      this.#config.minimumOutwardDistance,
      this.#config.minimumUpwardDistance,
      "right",
    );
    if (leftReadyAtMs === null || rightReadyAtMs === null) {
      if (leftReadyAtMs !== null && frame.captureTimeMs - leftReadyAtMs > this.#config.maximumSyncWindowMs) {
        this.#reject(candidate, frame.captureTimeMs, "bloom-sync-expired", rejections);
        return { frame, events, rejections };
      } else if (rightReadyAtMs !== null && frame.captureTimeMs - rightReadyAtMs > this.#config.maximumSyncWindowMs) {
        this.#reject(candidate, frame.captureTimeMs, "bloom-sync-expired", rejections);
        return { frame, events, rejections };
      }
      candidate.leftLast = point(left.palmCenter.x, left.palmCenter.y);
      candidate.rightLast = point(right.palmCenter.x, right.palmCenter.y);
      candidate.lastTimeMs = frame.captureTimeMs;
      return { frame, events, rejections };
    }

    const syncSpreadMs = Math.abs(leftReadyAtMs - rightReadyAtMs);
    this.#maximumSyncSpreadMs = Math.max(this.#maximumSyncSpreadMs, syncSpreadMs);
    if (syncSpreadMs > this.#config.maximumSyncWindowMs) {
      this.#reject(candidate, frame.captureTimeMs, "bloom-sync-expired", rejections);
      return { frame, events, rejections };
    }
    const leftHand = this.#diagnosticHands.find(({ trackId }) => trackId === candidate.leftId);
    const rightHand = this.#diagnosticHands.find(({ trackId }) => trackId === candidate.rightId);
    if ((leftHand?.maximumOutwardSpeed ?? 0) < this.#config.minimumOutwardSpeed
      || (rightHand?.maximumOutwardSpeed ?? 0) < this.#config.minimumOutwardSpeed) {
      this.#reject(candidate, frame.captureTimeMs, "movement-too-slow", rejections);
      return { frame, events, rejections };
    }

    const eventTimeMs = Math.max(leftReadyAtMs, rightReadyAtMs);
    const outwardDistance = Math.min(leftMotion.outward, rightMotion.outward);
    const upwardDistance = Math.min(leftMotion.upward, rightMotion.upward);
    const maximumOutwardSpeed = Math.max(
      leftHand?.maximumOutwardSpeed ?? 0,
      rightHand?.maximumOutwardSpeed ?? 0,
    );
    events.push({
      id: createGestureEventId("bloom"),
      gestureType: "bloom",
      eventTimeMs,
      handIds: [candidate.leftId, candidate.rightId].sort(),
      confidence: clamp01(
        0.58
          + outwardDistance * 0.8
          + upwardDistance * 0.8
          + Math.min(0.25, maximumOutwardSpeed * 0.08),
      ),
      quality: {
        outwardDistance,
        upwardDistance,
        syncSpreadMs,
        speed: maximumOutwardSpeed,
        ...(this.#preparationSpan === null ? {} : { preparationSpan: this.#preparationSpan }),
      },
      trackingQuality: "observed",
      reasonCodes: ["bloom-opened"],
    });
    this.#triggerTimeMs = eventTimeMs;
    this.#cooldownUntilMs = eventTimeMs + this.#config.cooldownMs;
    this.#candidate = null;
    return { frame, events, rejections };
  }

  reset(): void {
    this.#candidate = null;
    this.#cooldownUntilMs = -Infinity;
    this.#observationFrameCounts = { zeroHands: 0, oneHand: 0, twoHands: 0 };
    this.#lastTwoHandObservedAtMs = null;
    this.#armedAtMs = null;
    this.#triggerTimeMs = null;
    this.#maximumSyncSpreadMs = 0;
    this.#preparationSpan = null;
    this.#diagnosticHands = [];
    this.#latestTrackingGap = null;
    this.#rejectionReasonCodes = [];
  }

  get diagnostic(): BloomTrialDiagnostic {
    return this.#createDiagnostic(null);
  }

  diagnosticAt(finishedAtMs: number): BloomTrialDiagnostic {
    return this.#createDiagnostic(finishedAtMs);
  }

  #createDiagnostic(finishedAtMs: number | null): BloomTrialDiagnostic {
    const latestGap = this.#latestTrackingGap;
    const latestTrackingGap = latestGap === null || latestGap.reacquiredAtMs !== null
      ? latestGap
      : finishedAtMs === null
        ? latestGap
        : {
          ...latestGap,
          durationMs: Math.max(0, finishedAtMs - latestGap.startedAtMs),
        };
    const reasons = [...this.#rejectionReasonCodes];
    if (latestTrackingGap !== null
      && latestTrackingGap.reacquiredAtMs === null
      && (latestTrackingGap.durationMs ?? 0) > this.#config.maximumTrackingGapMs
      && !reasons.includes("tracking-lost")) {
      reasons.push("tracking-lost");
    }
    return {
      observationFrameCounts: { ...this.#observationFrameCounts },
      lastTwoHandObservedAtMs: this.#lastTwoHandObservedAtMs,
      armedAtMs: this.#armedAtMs,
      triggerTimeMs: this.#triggerTimeMs,
      maximumSyncSpreadMs: this.#maximumSyncSpreadMs,
      preparationSpan: this.#preparationSpan,
      hands: this.#diagnosticHands.map((hand) => ({ ...hand })),
      latestTrackingGap: latestTrackingGap === null
        ? null
        : { ...latestTrackingGap, handIds: [...latestTrackingGap.handIds] },
      rejectionReasonCodes: reasons,
    };
  }

  #recordObservation(frame: TrackedHandFrame): void {
    if (frame.hands.length === 0) this.#observationFrameCounts.zeroHands += 1;
    else if (frame.hands.length === 1) this.#observationFrameCounts.oneHand += 1;
    else this.#observationFrameCounts.twoHands += 1;
    if (frame.hands.length >= 2) this.#lastTwoHandObservedAtMs = frame.captureTimeMs;
  }

  #tryArm(frame: TrackedHandFrame): void {
    if (frame.captureTimeMs < this.#cooldownUntilMs) return;
    const pair = preparationPair(frame.hands);
    if (pair === null) return;
    const [left, right] = pair;
    const span = right.palmCenter.x - left.palmCenter.x;
    const centerX = (left.palmCenter.x + right.palmCenter.x) / 2;
    const centerY = (left.palmCenter.y + right.palmCenter.y) / 2;
    if (span < this.#config.minimumPreparationSpan
      || span > this.#config.maximumPreparationSpan
      || Math.abs(centerX - 0.5) > this.#config.preparationCenterToleranceX
      || Math.abs(centerY - 0.5) > this.#config.preparationCenterToleranceY) return;
    this.#preparationSpan = span;
    this.#armedAtMs = frame.captureTimeMs;
    this.#diagnosticHands = [
      diagnosticHand(left, "left", left.palmCenter.x, left.palmCenter.y),
      diagnosticHand(right, "right", right.palmCenter.x, right.palmCenter.y),
    ];
    this.#candidate = {
      phase: "armed",
      leftId: left.trackId,
      rightId: right.trackId,
      leftStart: point(left.palmCenter.x, left.palmCenter.y),
      rightStart: point(right.palmCenter.x, right.palmCenter.y),
      startedAtMs: frame.captureTimeMs,
      lastTimeMs: frame.captureTimeMs,
      leftLast: point(left.palmCenter.x, left.palmCenter.y),
      rightLast: point(right.palmCenter.x, right.palmCenter.y),
      leftOutwardReadyAtMs: null,
      rightOutwardReadyAtMs: null,
      latestGapStartedAtMs: null,
    };
  }

  #reject(
    candidate: BloomCandidate,
    timeMs: number,
    reason: GestureReasonCode,
    rejections: GestureRejection[],
  ): void {
    this.#rejectionReasonCodes.push(reason);
    rejections.push({
      gestureType: "bloom",
      timeMs,
      handIds: [candidate.leftId, candidate.rightId].sort(),
      reasonCodes: [reason],
    });
    this.#candidate = null;
  }

  #rejectInsufficient(candidate: BloomCandidate, timeMs: number, rejections: GestureRejection[]): void {
    const reasons: GestureReasonCode[] = [];
    for (const hand of this.#diagnosticHands) {
      if (hand.maximumOutwardDistance < this.#config.minimumOutwardDistance
        && !reasons.includes("bloom-outward-distance-insufficient")) {
        reasons.push("bloom-outward-distance-insufficient");
      }
      if (hand.maximumUpwardDistance < this.#config.minimumUpwardDistance
        && !reasons.includes("bloom-upward-distance-insufficient")) {
        reasons.push("bloom-upward-distance-insufficient");
      }
    }
    if (reasons.length === 0) reasons.push("candidate-timeout");
    for (const reason of reasons) this.#rejectionReasonCodes.push(reason);
    rejections.push({
      gestureType: "bloom",
      timeMs,
      handIds: [candidate.leftId, candidate.rightId].sort(),
      reasonCodes: reasons,
    });
    this.#candidate = null;
  }
}

interface Motion {
  readonly outward: number;
  readonly upward: number;
  readonly outwardSpeed: number;
}

function measureMotion(
  start: Point,
  previous: Point,
  hand: TrackedHandFeatures,
  deltaMs: number,
  side: "left" | "right",
): Motion {
  const outward = side === "left"
    ? start.x - hand.palmCenter.x
    : hand.palmCenter.x - start.x;
  const upward = start.y - hand.palmCenter.y;
  const previousOutward = side === "left"
    ? start.x - previous.x
    : previous.x - start.x;
  return {
    outward,
    upward,
    outwardSpeed: deltaMs > 0 ? Math.max(0, (outward - previousOutward) * 1_000 / deltaMs) : 0,
  };
}

function completeAt(
  start: Point,
  previous: Point,
  current: TrackedHandFeatures,
  previousTimeMs: number,
  currentTimeMs: number,
  previousReadyAtMs: number | null,
  minimumOutwardDistance: number,
  minimumUpwardDistance: number,
  side: "left" | "right",
): number | null {
  const outward = side === "left"
    ? start.x - current.palmCenter.x
    : current.palmCenter.x - start.x;
  const upward = start.y - current.palmCenter.y;
  if (outward < minimumOutwardDistance || upward < minimumUpwardDistance) return null;
  if (previousReadyAtMs !== null) return previousReadyAtMs;
  const outwardAtMs = interpolateThreshold(
    previous,
    current.palmCenter,
    previousTimeMs,
    currentTimeMs,
    start,
    minimumOutwardDistance,
    side === "left" ? -1 : 1,
    "x",
  );
  const upwardAtMs = interpolateThreshold(
    previous,
    current.palmCenter,
    previousTimeMs,
    currentTimeMs,
    start,
    minimumUpwardDistance,
    -1,
    "y",
  );
  return Math.max(outwardAtMs, upwardAtMs);
}

function interpolateThreshold(
  previous: Point,
  current: Point,
  previousTimeMs: number,
  currentTimeMs: number,
  start: Point,
  threshold: number,
  direction: number,
  axis: "x" | "y",
): number {
  const previousValue = direction * (previous[axis] - start[axis]);
  const currentValue = direction * (current[axis] - start[axis]);
  if (currentValue <= previousValue) return currentTimeMs;
  if (previousValue >= threshold) return previousTimeMs;
  const ratio = clamp01((threshold - previousValue) / (currentValue - previousValue));
  return previousTimeMs + (currentTimeMs - previousTimeMs) * ratio;
}

function updateThresholdDiagnostics(
  hand: MutableBloomDiagnosticHand | undefined,
  start: Point,
  previous: Point,
  current: TrackedHandFeatures,
  previousTimeMs: number,
  currentTimeMs: number,
  minimumOutwardDistance: number,
  minimumUpwardDistance: number,
  side: "left" | "right",
): void {
  if (hand === undefined) return;
  if (hand.outwardThresholdReachedAtMs === null) {
    const outward = side === "left"
      ? start.x - current.palmCenter.x
      : current.palmCenter.x - start.x;
    if (outward >= minimumOutwardDistance) {
      hand.outwardThresholdReachedAtMs = interpolateThreshold(
        previous,
        current.palmCenter,
        previousTimeMs,
        currentTimeMs,
        start,
        minimumOutwardDistance,
        side === "left" ? -1 : 1,
        "x",
      );
    }
  }
  if (hand.upwardThresholdReachedAtMs === null) {
    const upward = start.y - current.palmCenter.y;
    if (upward >= minimumUpwardDistance) {
      hand.upwardThresholdReachedAtMs = interpolateThreshold(
        previous,
        current.palmCenter,
        previousTimeMs,
        currentTimeMs,
        start,
        minimumUpwardDistance,
        -1,
        "y",
      );
    }
  }
}

function updateDiagnosticHand(hand: MutableBloomDiagnosticHand, motion: Motion): void {
  hand.maximumOutwardDistance = Math.max(hand.maximumOutwardDistance, motion.outward);
  hand.maximumUpwardDistance = Math.max(hand.maximumUpwardDistance, motion.upward);
  hand.maximumOutwardSpeed = Math.max(hand.maximumOutwardSpeed, motion.outwardSpeed);
}

function diagnosticHand(
  hand: TrackedHandFeatures,
  side: "left" | "right",
  startX: number,
  startY: number,
): MutableBloomDiagnosticHand {
  return {
    trackId: hand.trackId,
    side,
    startX,
    startY,
    maximumOutwardDistance: 0,
    maximumUpwardDistance: 0,
    maximumOutwardSpeed: 0,
    outwardThresholdReachedAtMs: null,
    upwardThresholdReachedAtMs: null,
  };
}

function preparationPair(hands: readonly TrackedHandFeatures[]): readonly [TrackedHandFeatures, TrackedHandFeatures] | null {
  if (hands.length < 2) return null;
  const pair = [...hands].sort((left, right) => left.palmCenter.x - right.palmCenter.x).slice(0, 2);
  const left = pair[0];
  const right = pair[1];
  return left === undefined || right === undefined ? null : [left, right];
}

function point(x: number, y: number): Point {
  return { x, y };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
