import type { TrackedHandFeatures, TrackedHandFrame } from "../tracking/derived-tracking-types";
import {
  createGestureEventId,
  resolveTrackingGapToleranceMs,
  type GestureEvaluation,
  type GestureEvent,
  type GestureReadinessObservation,
  type GestureReasonCode,
  type GestureRejection,
} from "./gesture-types";
import { ReadinessGate } from "./readiness-gate";
import { StillnessWindow } from "./stillness-window";

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
  /** How long both hands must stay in the central start position before the count-in. */
  readonly readinessStableMs?: number;
  readonly readinessMaximumDrift?: number;
  /** Hands within this distance of the waiting position have not started the Bloom yet. */
  readonly stationaryTolerance?: number;
  /**
   * How long both hands must stay within the stationary tolerance to count as settled.
   * Settled hands re-arm after a rejection, and hands that drift and stop in the start
   * position move the waiting position there.
   */
  readonly settleMs?: number;
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
  /** When the latest waiting position was set: arming, or settling at a new position. */
  readonly armedAtMs: number | null;
  readonly triggerTimeMs: number | null;
  readonly maximumSyncSpreadMs: number;
  readonly preparationSpan: number | null;
  readonly hands: readonly BloomDiagnosticHand[];
  readonly latestTrackingGap: BloomTrackingGapDiagnostic | null;
  readonly rejectionReasonCodes: readonly GestureReasonCode[];
  /** Times the tracker swapped the two hand identities; positions kept the left and right hands apart. */
  readonly identitySwapCount: number;
}

type BloomPhase = "armed" | "gap";

interface Point {
  readonly x: number;
  readonly y: number;
}

interface BloomCandidate {
  phase: BloomPhase;
  leftId: string;
  rightId: string;
  leftStart: Point;
  rightStart: Point;
  /** Last time both hands were still at the waiting position; the duration limit counts from here. */
  startedAtMs: number;
  lastTimeMs: number;
  leftLast: Point;
  rightLast: Point;
  leftOutwardReadyAtMs: number | null;
  rightOutwardReadyAtMs: number | null;
  latestGapStartedAtMs: number | null;
}

interface MutableBloomDiagnosticHand extends BloomDiagnosticHand {
  trackId: string;
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

/**
 * Judgment constants. Exported read-only so the on-camera guide and the motion sample can be
 * drawn from the same preparation values. Changing a value changes the judgment.
 */
export const BLOOM_DEFAULTS = {
  minimumPreparationSpan: 0.1,
  maximumPreparationSpan: 0.42,
  preparationCenterToleranceX: 0.22,
  preparationCenterToleranceY: 0.25,
  minimumOutwardDistance: 0.16,
  minimumUpwardDistance: 0.08,
  minimumOutwardSpeed: 0.12,
  maximumSyncWindowMs: 420,
  maximumDurationMs: 1_400,
  /** Floor of the tracking gap tolerance; a slow device raises it through the frame. */
  maximumTrackingGapMs: 150,
  cooldownMs: 280,
  readinessStableMs: 200,
  readinessMaximumDrift: 0.05,
  stationaryTolerance: 0.02,
  settleMs: 250,
} as const;

/** A hand keeps its threshold crossing time until it falls this far back below the threshold. */
const REACH_RELEASE_MARGIN = 0.03;

export class BloomStateMachine {
  readonly #config: Required<BloomConfig>;
  #candidate: BloomCandidate | null = null;
  #cooldownUntilMs = -Infinity;
  /** The first two-hand frame of the recognition window has been checked for the start position. */
  #startChecked = false;
  #observationFrameCounts = { zeroHands: 0, oneHand: 0, twoHands: 0 };
  #lastTwoHandObservedAtMs: number | null = null;
  #armedAtMs: number | null = null;
  #triggerTimeMs: number | null = null;
  #maximumSyncSpreadMs = 0;
  #preparationSpan: number | null = null;
  #diagnosticHands: MutableBloomDiagnosticHand[] = [];
  #latestTrackingGap: MutableBloomTrackingGapDiagnostic | null = null;
  #rejectionReasonCodes: GestureReasonCode[] = [];
  #identitySwapCount = 0;
  /** Tolerance of the latest judged frame, so the diagnostic reads the gap the same way. */
  #trackingGapToleranceMs: number = BLOOM_DEFAULTS.maximumTrackingGapMs;
  readonly #readiness: ReadinessGate;
  readonly #armSettle: StillnessWindow;
  readonly #waitSettle: StillnessWindow;

  constructor(config: BloomConfig = {}) {
    this.#config = { ...BLOOM_DEFAULTS, ...config };
    this.#trackingGapToleranceMs = this.#config.maximumTrackingGapMs;
    this.#readiness = new ReadinessGate({
      requiredStableMs: this.#config.readinessStableMs,
      maximumDriftDistance: this.#config.readinessMaximumDrift,
    });
    this.#armSettle = new StillnessWindow(this.#config.settleMs, this.#config.stationaryTolerance);
    this.#waitSettle = new StillnessWindow(this.#config.settleMs, this.#config.stationaryTolerance);
  }

  /** Confirm that both hands settled in the central start position before the count-in. */
  observeReadiness(frame: TrackedHandFrame): GestureReadinessObservation {
    const pair = preparationPair(frame.hands);
    return this.#readiness.observe(
      frame.captureTimeMs,
      frame.hands.length,
      pair !== null && this.#inPreparationZone(pair) ? pair : null,
    );
  }

  /** Ignore all preparation motion so it cannot become an active Bloom. */
  prepare(frame: TrackedHandFrame): GestureEvaluation {
    this.#dropCandidate();
    this.#armedAtMs = null;
    this.#triggerTimeMs = null;
    this.#startChecked = false;
    return { frame, events: [], rejections: [] };
  }

  process(frame: TrackedHandFrame): GestureEvaluation {
    const events: GestureEvent[] = [];
    const rejections: GestureRejection[] = [];
    this.#recordObservation(frame);
    const toleranceMs = resolveTrackingGapToleranceMs(frame, this.#config.maximumTrackingGapMs);
    this.#trackingGapToleranceMs = toleranceMs;

    if (this.#candidate === null) {
      this.#closeTrackingGap(frame);
      this.#tryArm(frame);
      return { frame, events, rejections };
    }

    const candidate = this.#candidate;
    const visible = new Map(frame.hands.map((hand) => [hand.trackId, hand]));
    let left = visible.get(candidate.leftId);
    let right = visible.get(candidate.rightId);
    if (left === undefined || right === undefined) {
      const elapsed = frame.captureTimeMs - candidate.lastTimeMs;
      if (elapsed <= toleranceMs) {
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
      if (gapMs > toleranceMs) {
        this.#reject(candidate, frame.captureTimeMs, "tracking-lost", rejections);
        return { frame, events, rejections };
      }
      candidate.phase = "armed";
      this.#closeTrackingGap(frame);
      candidate.latestGapStartedAtMs = null;
    }

    if (left.palmCenter.x > right.palmCenter.x) {
      // The tracker swapped the two identities. Bloom hands never cross, so the positions tell left from right.
      [left, right] = [right, left];
      this.#swapIdentities(candidate);
    }

    const tolerance = this.#config.stationaryTolerance;
    const settled = this.#waitSettle.observe(
      frame.captureTimeMs,
      [candidate.leftId, candidate.rightId],
      [left.palmCenter, right.palmCenter],
    );
    if (isStill(candidate.leftStart, left, tolerance) && isStill(candidate.rightStart, right, tolerance)) {
      // Waiting in the armed position for GO must not consume the Bloom duration.
      candidate.startedAtMs = frame.captureTimeMs;
      advance(candidate, left, right, frame.captureTimeMs);
      return { frame, events, rejections };
    }
    if (settled && this.#inPreparationZone([left, right])) {
      // The hands drifted and stopped inside the start position: waiting continues from there.
      this.#setWaitingPosition(candidate, left, right, frame.captureTimeMs);
      return { frame, events, rejections };
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
      leftDiagnostic,
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
      rightDiagnostic,
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
      advance(candidate, left, right, frame.captureTimeMs);
      return { frame, events, rejections };
    }

    const syncSpreadMs = Math.abs(leftReadyAtMs - rightReadyAtMs);
    this.#maximumSyncSpreadMs = Math.max(this.#maximumSyncSpreadMs, syncSpreadMs);
    if (syncSpreadMs > this.#config.maximumSyncWindowMs) {
      this.#reject(candidate, frame.captureTimeMs, "bloom-sync-expired", rejections);
      return { frame, events, rejections };
    }
    if ((leftDiagnostic?.maximumOutwardSpeed ?? 0) < this.#config.minimumOutwardSpeed
      || (rightDiagnostic?.maximumOutwardSpeed ?? 0) < this.#config.minimumOutwardSpeed) {
      this.#reject(candidate, frame.captureTimeMs, "movement-too-slow", rejections);
      return { frame, events, rejections };
    }

    const eventTimeMs = Math.max(leftReadyAtMs, rightReadyAtMs);
    const outwardDistance = Math.min(leftMotion.outward, rightMotion.outward);
    const upwardDistance = Math.min(leftMotion.upward, rightMotion.upward);
    const maximumOutwardSpeed = Math.max(
      leftDiagnostic?.maximumOutwardSpeed ?? 0,
      rightDiagnostic?.maximumOutwardSpeed ?? 0,
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
    this.#dropCandidate();
    return { frame, events, rejections };
  }

  reset(): void {
    this.#dropCandidate();
    this.#cooldownUntilMs = -Infinity;
    this.#startChecked = false;
    this.#observationFrameCounts = { zeroHands: 0, oneHand: 0, twoHands: 0 };
    this.#lastTwoHandObservedAtMs = null;
    this.#armedAtMs = null;
    this.#triggerTimeMs = null;
    this.#maximumSyncSpreadMs = 0;
    this.#preparationSpan = null;
    this.#diagnosticHands = [];
    this.#latestTrackingGap = null;
    this.#rejectionReasonCodes = [];
    this.#identitySwapCount = 0;
    this.#trackingGapToleranceMs = this.#config.maximumTrackingGapMs;
    this.#readiness.reset();
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
      && (latestTrackingGap.durationMs ?? 0) > this.#trackingGapToleranceMs
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
      identitySwapCount: this.#identitySwapCount,
    };
  }

  #recordObservation(frame: TrackedHandFrame): void {
    if (frame.hands.length === 0) this.#observationFrameCounts.zeroHands += 1;
    else if (frame.hands.length === 1) this.#observationFrameCounts.oneHand += 1;
    else this.#observationFrameCounts.twoHands += 1;
    if (frame.hands.length >= 2) this.#lastTwoHandObservedAtMs = frame.captureTimeMs;
  }

  /** Records when both hands were seen again, whether or not a candidate survived the gap. */
  #closeTrackingGap(frame: TrackedHandFrame): void {
    const gap = this.#latestTrackingGap;
    if (gap === null || gap.reacquiredAtMs !== null || frame.hands.length < 2) return;
    gap.reacquiredAtMs = frame.captureTimeMs;
    gap.durationMs = Math.max(0, frame.captureTimeMs - gap.startedAtMs);
  }

  #tryArm(frame: TrackedHandFrame): void {
    if (frame.captureTimeMs < this.#cooldownUntilMs) return;
    const pair = preparationPair(frame.hands);
    if (pair === null) return;
    const inZone = this.#inPreparationZone(pair);
    if (!this.#startChecked) {
      // The first two-hand frame of the window follows the readiness check, so a pair in the zone arms at once.
      this.#startChecked = true;
      if (inZone) this.#arm(pair, frame.captureTimeMs);
      return;
    }
    if (!inZone) {
      this.#armSettle.reset();
      return;
    }
    // Later arming waits until the hands settle, so returning them to the center is not judged as a Bloom.
    const settled = this.#armSettle.observe(
      frame.captureTimeMs,
      pair.map(({ trackId }) => trackId),
      pair.map(({ palmCenter }) => palmCenter),
    );
    if (settled) this.#arm(pair, frame.captureTimeMs);
  }

  #arm(pair: readonly [TrackedHandFeatures, TrackedHandFeatures], timeMs: number): void {
    const [left, right] = pair;
    this.#preparationSpan = right.palmCenter.x - left.palmCenter.x;
    this.#armedAtMs = timeMs;
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
      startedAtMs: timeMs,
      lastTimeMs: timeMs,
      leftLast: point(left.palmCenter.x, left.palmCenter.y),
      rightLast: point(right.palmCenter.x, right.palmCenter.y),
      leftOutwardReadyAtMs: null,
      rightOutwardReadyAtMs: null,
      latestGapStartedAtMs: null,
    };
    this.#armSettle.reset();
    this.#waitSettle.reset();
  }

  #setWaitingPosition(
    candidate: BloomCandidate,
    left: TrackedHandFeatures,
    right: TrackedHandFeatures,
    timeMs: number,
  ): void {
    candidate.leftStart = point(left.palmCenter.x, left.palmCenter.y);
    candidate.rightStart = point(right.palmCenter.x, right.palmCenter.y);
    candidate.startedAtMs = timeMs;
    candidate.leftOutwardReadyAtMs = null;
    candidate.rightOutwardReadyAtMs = null;
    advance(candidate, left, right, timeMs);
    this.#armedAtMs = timeMs;
    this.#preparationSpan = right.palmCenter.x - left.palmCenter.x;
    this.#diagnosticHands = [
      diagnosticHand(left, "left", left.palmCenter.x, left.palmCenter.y),
      diagnosticHand(right, "right", right.palmCenter.x, right.palmCenter.y),
    ];
  }

  #swapIdentities(candidate: BloomCandidate): void {
    const { leftId, rightId } = candidate;
    candidate.leftId = rightId;
    candidate.rightId = leftId;
    for (const hand of this.#diagnosticHands) hand.trackId = hand.trackId === leftId ? rightId : leftId;
    this.#identitySwapCount += 1;
  }

  #inPreparationZone(pair: readonly [TrackedHandFeatures, TrackedHandFeatures]): boolean {
    const [left, right] = pair;
    const span = right.palmCenter.x - left.palmCenter.x;
    const centerX = (left.palmCenter.x + right.palmCenter.x) / 2;
    const centerY = (left.palmCenter.y + right.palmCenter.y) / 2;
    return span >= this.#config.minimumPreparationSpan
      && span <= this.#config.maximumPreparationSpan
      && Math.abs(centerX - 0.5) <= this.#config.preparationCenterToleranceX
      && Math.abs(centerY - 0.5) <= this.#config.preparationCenterToleranceY;
  }

  #dropCandidate(): void {
    this.#candidate = null;
    this.#armSettle.reset();
    this.#waitSettle.reset();
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
    this.#dropCandidate();
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
    this.#dropCandidate();
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
  if (previousReadyAtMs !== null) {
    // Keep the first crossing unless the hand clearly fell back below a threshold.
    return outward >= minimumOutwardDistance - REACH_RELEASE_MARGIN
      && upward >= minimumUpwardDistance - REACH_RELEASE_MARGIN
      ? previousReadyAtMs
      : null;
  }
  if (outward < minimumOutwardDistance || upward < minimumUpwardDistance) return null;
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
  // An axis already past its threshold at the previous sample crossed it no later than that sample.
  if (previousValue >= threshold) return previousTimeMs;
  if (currentValue <= previousValue) return currentTimeMs;
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

function advance(candidate: BloomCandidate, left: TrackedHandFeatures, right: TrackedHandFeatures, timeMs: number): void {
  candidate.leftLast = point(left.palmCenter.x, left.palmCenter.y);
  candidate.rightLast = point(right.palmCenter.x, right.palmCenter.y);
  candidate.lastTimeMs = timeMs;
}

function preparationPair(hands: readonly TrackedHandFeatures[]): readonly [TrackedHandFeatures, TrackedHandFeatures] | null {
  if (hands.length < 2) return null;
  const pair = [...hands].sort((left, right) => left.palmCenter.x - right.palmCenter.x).slice(0, 2);
  const left = pair[0];
  const right = pair[1];
  return left === undefined || right === undefined ? null : [left, right];
}

function isStill(start: Point, hand: TrackedHandFeatures, tolerance: number): boolean {
  return Math.abs(hand.palmCenter.x - start.x) <= tolerance
    && Math.abs(hand.palmCenter.y - start.y) <= tolerance;
}

function point(x: number, y: number): Point {
  return { x, y };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
