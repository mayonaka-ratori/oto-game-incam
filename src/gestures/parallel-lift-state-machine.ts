import type { TrackedHandFeatures, TrackedHandFrame } from "../tracking/derived-tracking-types";
import {
  createGestureEventId,
  resolveTrackingGapToleranceMs,
  type GestureEvaluation,
  type GestureEvent,
  type GestureQuality,
  type GestureReadinessObservation,
  type GestureReasonCode,
  type GestureRejection,
  type GestureType,
  type TrackingGapDiagnostic,
} from "./gesture-types";
import { ReadinessGate } from "./readiness-gate";
import { StillnessWindow } from "./stillness-window";

/**
 * Both hands start in the lower left/right zones and travel roughly in parallel along one
 * direction. Lift is the special case of the direction being straight up; ななめリフト
 * (diagonal-lift) uses the same machine with a diagonal direction.
 *
 * Distances are normalized mirrored-preview coordinates (y grows downward). The absolute arm
 * height or speed is not scored. Every distance below is measured from the start position:
 * `Upward` names the travel along the configured direction, and `Sideways` the drift
 * perpendicular to it. For the straight-up Lift the two are literally up and sideways.
 */
export interface ParallelLiftConfig {
  readonly startZoneMinY?: number;
  readonly startZoneMaxY?: number;
  readonly leftZoneMinX?: number;
  readonly leftZoneMaxX?: number;
  readonly rightZoneMinX?: number;
  readonly rightZoneMaxX?: number;
  readonly minimumHandSeparation?: number;
  readonly readinessStableMs?: number;
  readonly readinessMaximumDrift?: number;
  /** Hands within this distance of the waiting position have not started the movement yet. */
  readonly stationaryTolerance?: number;
  /**
   * How long both hands must stay within the stationary tolerance to count as settled.
   * Settled hands re-arm after a rejection, and hands that drift and stop in the start
   * zones move the waiting position there.
   */
  readonly settleMs?: number;
  /** Travel along the direction that both hands must reach. */
  readonly minimumUpwardDistance?: number;
  /** Drift perpendicular to the direction. How it is judged depends on `lateralRule`. */
  readonly maximumSidewaysDistance?: number;
  /** Travel against the direction that is still tolerated before the attempt is refused. */
  readonly downwardTolerance?: number;
  readonly maximumSyncWindowMs?: number;
  readonly maximumDurationMs?: number;
  readonly maximumTrackingGapMs?: number;
  readonly cooldownMs?: number;
}

/** Reason codes of one gesture, so Lift and ななめリフト are told apart in the records. */
export interface ParallelLiftReasonCodes {
  readonly reached: GestureReasonCode;
  readonly notReady: GestureReasonCode;
  /** Moved against the direction, or drifted too far off it. */
  readonly wrongDirection: GestureReasonCode;
  readonly distanceInsufficient: GestureReasonCode;
  readonly syncExpired: GestureReasonCode;
}

/** What makes one gesture out of this machine. Fixed per gesture; never read from a trial. */
export interface ParallelLiftSettings {
  readonly gestureType: GestureType;
  /** Unit vector of the travel, in mirrored preview coordinates (y grows downward). */
  readonly direction: readonly [number, number];
  readonly reasonCodes: ParallelLiftReasonCodes;
  /**
   * How the perpendicular drift is judged.
   * - "relative" (Lift): refused only when the drift is larger than the tolerance AND larger
   *   than the travel, so a high raise with some sway still counts.
   * - "absolute" (ななめリフト): refused as soon as the drift passes the tolerance.
   */
  readonly lateralRule: "relative" | "absolute";
  /**
   * Horizontal travel a hand must also have made before it counts as having reached, so a
   * straight-up raise cannot be read as a diagonal one. 0 turns the check off (Lift).
   */
  readonly minimumHorizontalDistance: number;
  /** Extra quality fields of the event, such as which diagonal was asked for. */
  readonly quality: GestureQuality;
}

export interface ParallelLiftDiagnosticHand {
  readonly trackId: string;
  readonly side: "left" | "right";
  readonly startX: number;
  readonly startY: number;
  /** Largest travel along the direction. */
  readonly maximumUpwardDistance: number;
  /** Largest drift perpendicular to the direction. */
  readonly maximumSidewaysDistance: number;
  readonly maximumUpwardSpeed: number;
  readonly upwardThresholdReachedAtMs: number | null;
}

export interface ParallelLiftTrialDiagnostic {
  readonly observationFrameCounts: {
    readonly zeroHands: number;
    readonly oneHand: number;
    readonly twoHands: number;
  };
  /** When the latest waiting position was set: arming, or settling at a new position. */
  readonly armedAtMs: number | null;
  readonly motionStartedAtMs: number | null;
  readonly triggerTimeMs: number | null;
  readonly maximumSyncSpreadMs: number;
  readonly hands: readonly ParallelLiftDiagnosticHand[];
  readonly latestTrackingGap: TrackingGapDiagnostic | null;
  readonly rejectionReasonCodes: readonly GestureReasonCode[];
  /** Times the tracker swapped the two hand identities; positions kept the left and right hands apart. */
  readonly identitySwapCount: number;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

interface LiftCandidate {
  gap: boolean;
  leftId: string;
  rightId: string;
  leftStart: Point;
  rightStart: Point;
  motionStartedAtMs: number;
  lastTimeMs: number;
  leftLast: Point;
  rightLast: Point;
  leftReachedAtMs: number | null;
  rightReachedAtMs: number | null;
}

interface HandMotion {
  /** Travel along the direction. */
  readonly upward: number;
  /** Absolute drift perpendicular to the direction. */
  readonly sideways: number;
  /** Absolute horizontal travel, for the straight-up/diagonal check. */
  readonly horizontal: number;
  readonly upwardSpeed: number;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** A hand keeps its threshold crossing time until it falls this far back below the threshold. */
const REACH_RELEASE_MARGIN = 0.03;

export class ParallelLiftStateMachine {
  readonly #config: Required<ParallelLiftConfig>;
  readonly #settings: ParallelLiftSettings;
  readonly #readiness: ReadinessGate;
  readonly #armSettle: StillnessWindow;
  readonly #waitSettle: StillnessWindow;
  #candidate: LiftCandidate | null = null;
  #cooldownUntilMs = -Infinity;
  /** The first two-hand frame of the recognition window has been checked for the start position. */
  #startChecked = false;
  #observationFrameCounts = { zeroHands: 0, oneHand: 0, twoHands: 0 };
  #armedAtMs: number | null = null;
  #motionStartedAtMs: number | null = null;
  #triggerTimeMs: number | null = null;
  #maximumSyncSpreadMs = 0;
  #diagnosticHands: Mutable<ParallelLiftDiagnosticHand>[] = [];
  #latestTrackingGap: Mutable<TrackingGapDiagnostic> | null = null;
  #rejectionReasonCodes: GestureReasonCode[] = [];
  #identitySwapCount = 0;
  /** Tolerance of the latest judged frame, so the diagnostic reads the gap the same way. */
  #trackingGapToleranceMs: number;

  constructor(
    config: ParallelLiftConfig,
    settings: ParallelLiftSettings,
    defaults: Required<ParallelLiftConfig>,
  ) {
    this.#config = { ...defaults, ...config };
    this.#settings = settings;
    this.#trackingGapToleranceMs = this.#config.maximumTrackingGapMs;
    this.#readiness = new ReadinessGate({
      requiredStableMs: this.#config.readinessStableMs,
      maximumDriftDistance: this.#config.readinessMaximumDrift,
    });
    this.#armSettle = new StillnessWindow(this.#config.settleMs, this.#config.stationaryTolerance);
    this.#waitSettle = new StillnessWindow(this.#config.settleMs, this.#config.stationaryTolerance);
  }

  /** Confirm that both hands settled in the lower start zones before the count-in. */
  observeReadiness(frame: TrackedHandFrame): GestureReadinessObservation {
    const pair = orderedPair(frame.hands);
    return this.#readiness.observe(
      frame.captureTimeMs,
      frame.hands.length,
      pair !== null && this.#inStartZones(pair) ? pair : null,
    );
  }

  /** Ignore count-in motion so it cannot become an active attempt. */
  prepare(frame: TrackedHandFrame): GestureEvaluation {
    this.#dropCandidate();
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
      this.#tryArm(frame, rejections);
      return { frame, events, rejections };
    }

    const candidate = this.#candidate;
    const visible = new Map(frame.hands.map((hand) => [hand.trackId, hand]));
    let left = visible.get(candidate.leftId);
    let right = visible.get(candidate.rightId);
    if (left === undefined || right === undefined) {
      if (frame.captureTimeMs - candidate.lastTimeMs <= toleranceMs) {
        if (!candidate.gap) {
          candidate.gap = true;
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

    if (candidate.gap) {
      if (frame.captureTimeMs - candidate.lastTimeMs > toleranceMs) {
        this.#reject(candidate, frame.captureTimeMs, "tracking-lost", rejections);
        return { frame, events, rejections };
      }
      candidate.gap = false;
      this.#closeTrackingGap(frame);
    }

    if (left.palmCenter.x > right.palmCenter.x) {
      // The tracker swapped the two identities. The hands travel in parallel, so the positions tell left from right.
      [left, right] = [right, left];
      this.#swapIdentities(candidate);
    }

    const direction = this.#settings.direction;
    const deltaMs = frame.captureTimeMs - candidate.lastTimeMs;
    const leftMotion = measure(direction, candidate.leftStart, candidate.leftLast, left, deltaMs);
    const rightMotion = measure(direction, candidate.rightStart, candidate.rightLast, right, deltaMs);
    const tolerance = this.#config.stationaryTolerance;
    const settled = this.#waitSettle.observe(
      frame.captureTimeMs,
      [candidate.leftId, candidate.rightId],
      [left.palmCenter, right.palmCenter],
    );
    if (isStill(leftMotion, tolerance) && isStill(rightMotion, tolerance)) {
      // Waiting in the start position for GO must not consume the movement duration.
      candidate.motionStartedAtMs = frame.captureTimeMs;
      advance(candidate, left, right, frame.captureTimeMs);
      return { frame, events, rejections };
    }
    if (settled && this.#inStartZones([left, right])) {
      // The hands drifted and stopped inside the start zones: waiting continues from there.
      this.#setWaitingPosition(candidate, left, right, frame.captureTimeMs);
      return { frame, events, rejections };
    }
    this.#motionStartedAtMs = candidate.motionStartedAtMs;
    this.#updateHand(candidate.leftId, leftMotion);
    this.#updateHand(candidate.rightId, rightMotion);

    if (frame.captureTimeMs - candidate.motionStartedAtMs > this.#config.maximumDurationMs) {
      this.#reject(candidate, frame.captureTimeMs, this.#settings.reasonCodes.distanceInsufficient, rejections);
      return { frame, events, rejections };
    }
    if (!this.#movingForward(leftMotion) || !this.#movingForward(rightMotion)) {
      this.#reject(candidate, frame.captureTimeMs, this.#settings.reasonCodes.wrongDirection, rejections);
      return { frame, events, rejections };
    }

    const threshold = this.#config.minimumUpwardDistance;
    const horizontal = this.#settings.minimumHorizontalDistance;
    const leftReachedAtMs = reachedAt(
      direction,
      candidate.leftStart,
      candidate.leftLast,
      left,
      candidate.lastTimeMs,
      frame.captureTimeMs,
      candidate.leftReachedAtMs,
      threshold,
      horizontal,
    );
    const rightReachedAtMs = reachedAt(
      direction,
      candidate.rightStart,
      candidate.rightLast,
      right,
      candidate.lastTimeMs,
      frame.captureTimeMs,
      candidate.rightReachedAtMs,
      threshold,
      horizontal,
    );
    candidate.leftReachedAtMs = leftReachedAtMs;
    candidate.rightReachedAtMs = rightReachedAtMs;
    this.#recordReach(candidate.leftId, leftReachedAtMs);
    this.#recordReach(candidate.rightId, rightReachedAtMs);

    if (leftReachedAtMs === null || rightReachedAtMs === null) {
      const reached = leftReachedAtMs ?? rightReachedAtMs;
      if (reached !== null && frame.captureTimeMs - reached > this.#config.maximumSyncWindowMs) {
        this.#reject(candidate, frame.captureTimeMs, this.#settings.reasonCodes.syncExpired, rejections);
        return { frame, events, rejections };
      }
      advance(candidate, left, right, frame.captureTimeMs);
      return { frame, events, rejections };
    }

    const syncSpreadMs = Math.abs(leftReachedAtMs - rightReachedAtMs);
    this.#maximumSyncSpreadMs = Math.max(this.#maximumSyncSpreadMs, syncSpreadMs);
    if (syncSpreadMs > this.#config.maximumSyncWindowMs) {
      this.#reject(candidate, frame.captureTimeMs, this.#settings.reasonCodes.syncExpired, rejections);
      return { frame, events, rejections };
    }

    const eventTimeMs = Math.max(leftReachedAtMs, rightReachedAtMs);
    const upwardDistance = Math.min(leftMotion.upward, rightMotion.upward);
    const speed = Math.max(0, ...this.#diagnosticHands.map(({ maximumUpwardSpeed }) => maximumUpwardSpeed));
    events.push({
      id: createGestureEventId(this.#settings.gestureType),
      gestureType: this.#settings.gestureType,
      eventTimeMs,
      handIds: [candidate.leftId, candidate.rightId].sort(),
      confidence: clamp01(0.6 + upwardDistance * 0.8 + Math.min(0.2, speed * 0.08)),
      quality: { ...this.#settings.quality, upwardDistance, syncSpreadMs, speed },
      trackingQuality: "observed",
      reasonCodes: [this.#settings.reasonCodes.reached],
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
    this.#armedAtMs = null;
    this.#motionStartedAtMs = null;
    this.#triggerTimeMs = null;
    this.#maximumSyncSpreadMs = 0;
    this.#diagnosticHands = [];
    this.#latestTrackingGap = null;
    this.#rejectionReasonCodes = [];
    this.#identitySwapCount = 0;
    this.#trackingGapToleranceMs = this.#config.maximumTrackingGapMs;
    this.#readiness.reset();
  }

  get diagnostic(): ParallelLiftTrialDiagnostic {
    return this.#createDiagnostic(null);
  }

  diagnosticAt(finishedAtMs: number): ParallelLiftTrialDiagnostic {
    return this.#createDiagnostic(finishedAtMs);
  }

  #createDiagnostic(finishedAtMs: number | null): ParallelLiftTrialDiagnostic {
    const gap = this.#latestTrackingGap;
    const latestTrackingGap = gap === null
      ? null
      : gap.reacquiredAtMs === null && finishedAtMs !== null
        ? { ...gap, durationMs: Math.max(0, finishedAtMs - gap.startedAtMs), handIds: [...gap.handIds] }
        : { ...gap, handIds: [...gap.handIds] };
    const reasons = [...this.#rejectionReasonCodes];
    if (latestTrackingGap !== null
      && latestTrackingGap.reacquiredAtMs === null
      && (latestTrackingGap.durationMs ?? 0) > this.#trackingGapToleranceMs
      && !reasons.includes("tracking-lost")) {
      reasons.push("tracking-lost");
    }
    return {
      observationFrameCounts: { ...this.#observationFrameCounts },
      armedAtMs: this.#armedAtMs,
      motionStartedAtMs: this.#motionStartedAtMs,
      triggerTimeMs: this.#triggerTimeMs,
      maximumSyncSpreadMs: this.#maximumSyncSpreadMs,
      hands: this.#diagnosticHands.map((hand) => ({ ...hand })),
      latestTrackingGap,
      rejectionReasonCodes: reasons,
      identitySwapCount: this.#identitySwapCount,
    };
  }

  #recordObservation(frame: TrackedHandFrame): void {
    if (frame.hands.length === 0) this.#observationFrameCounts.zeroHands += 1;
    else if (frame.hands.length === 1) this.#observationFrameCounts.oneHand += 1;
    else this.#observationFrameCounts.twoHands += 1;
  }

  /** Records when both hands were seen again, whether or not a candidate survived the gap. */
  #closeTrackingGap(frame: TrackedHandFrame): void {
    const gap = this.#latestTrackingGap;
    if (gap === null || gap.reacquiredAtMs !== null || frame.hands.length < 2) return;
    gap.reacquiredAtMs = frame.captureTimeMs;
    gap.durationMs = Math.max(0, frame.captureTimeMs - gap.startedAtMs);
  }

  #tryArm(frame: TrackedHandFrame, rejections: GestureRejection[]): void {
    if (frame.captureTimeMs < this.#cooldownUntilMs) return;
    const pair = orderedPair(frame.hands);
    if (pair === null) return;
    const inZones = this.#inStartZones(pair);
    if (!this.#startChecked) {
      // The start position is judged once, on the first frame of the window where both hands are visible.
      this.#startChecked = true;
      if (inZones) {
        this.#arm(pair, frame.captureTimeMs);
      } else {
        this.#pushRejection(
          rejections,
          frame.captureTimeMs,
          pair.map(({ trackId }) => trackId),
          this.#settings.reasonCodes.notReady,
        );
      }
      return;
    }
    if (!inZones) {
      this.#armSettle.reset();
      return;
    }
    // Later arming waits until the hands settle, so lowering them into the zones is not judged as a movement.
    const settled = this.#armSettle.observe(
      frame.captureTimeMs,
      pair.map(({ trackId }) => trackId),
      pair.map(({ palmCenter }) => palmCenter),
    );
    if (settled) this.#arm(pair, frame.captureTimeMs);
  }

  #arm(pair: readonly [TrackedHandFeatures, TrackedHandFeatures], timeMs: number): void {
    const [left, right] = pair;
    this.#armedAtMs = timeMs;
    this.#motionStartedAtMs = null;
    this.#diagnosticHands = [diagnosticHand(left, "left"), diagnosticHand(right, "right")];
    this.#candidate = {
      gap: false,
      leftId: left.trackId,
      rightId: right.trackId,
      leftStart: point(left),
      rightStart: point(right),
      motionStartedAtMs: timeMs,
      lastTimeMs: timeMs,
      leftLast: point(left),
      rightLast: point(right),
      leftReachedAtMs: null,
      rightReachedAtMs: null,
    };
    this.#armSettle.reset();
    this.#waitSettle.reset();
  }

  #setWaitingPosition(
    candidate: LiftCandidate,
    left: TrackedHandFeatures,
    right: TrackedHandFeatures,
    timeMs: number,
  ): void {
    candidate.leftStart = point(left);
    candidate.rightStart = point(right);
    candidate.motionStartedAtMs = timeMs;
    candidate.leftReachedAtMs = null;
    candidate.rightReachedAtMs = null;
    advance(candidate, left, right, timeMs);
    this.#armedAtMs = timeMs;
    this.#motionStartedAtMs = null;
    this.#diagnosticHands = [diagnosticHand(left, "left"), diagnosticHand(right, "right")];
  }

  #swapIdentities(candidate: LiftCandidate): void {
    const { leftId, rightId } = candidate;
    candidate.leftId = rightId;
    candidate.rightId = leftId;
    for (const hand of this.#diagnosticHands) hand.trackId = hand.trackId === leftId ? rightId : leftId;
    this.#identitySwapCount += 1;
  }

  #inStartZones(pair: readonly [TrackedHandFeatures, TrackedHandFeatures]): boolean {
    const [left, right] = pair;
    const config = this.#config;
    return right.palmCenter.x - left.palmCenter.x >= config.minimumHandSeparation
      && within(left.palmCenter.x, config.leftZoneMinX, config.leftZoneMaxX)
      && within(right.palmCenter.x, config.rightZoneMinX, config.rightZoneMaxX)
      && within(left.palmCenter.y, config.startZoneMinY, config.startZoneMaxY)
      && within(right.palmCenter.y, config.startZoneMinY, config.startZoneMaxY);
  }

  #movingForward(motion: HandMotion): boolean {
    if (motion.upward < -this.#config.downwardTolerance) return false;
    if (this.#settings.lateralRule === "absolute") {
      return motion.sideways <= this.#config.maximumSidewaysDistance;
    }
    return !(motion.sideways > this.#config.maximumSidewaysDistance && motion.sideways > motion.upward);
  }

  #updateHand(trackId: string, motion: HandMotion): void {
    const hand = this.#diagnosticHands.find((item) => item.trackId === trackId);
    if (hand === undefined) return;
    hand.maximumUpwardDistance = Math.max(hand.maximumUpwardDistance, motion.upward);
    hand.maximumSidewaysDistance = Math.max(hand.maximumSidewaysDistance, motion.sideways);
    hand.maximumUpwardSpeed = Math.max(hand.maximumUpwardSpeed, motion.upwardSpeed);
  }

  /** Mirrors the reach time used for the sync check, so the diagnostic and the event agree. */
  #recordReach(trackId: string, reachedAtMs: number | null): void {
    const hand = this.#diagnosticHands.find((item) => item.trackId === trackId);
    if (hand !== undefined && reachedAtMs !== null) hand.upwardThresholdReachedAtMs = reachedAtMs;
  }

  #dropCandidate(): void {
    this.#candidate = null;
    this.#armSettle.reset();
    this.#waitSettle.reset();
  }

  #reject(candidate: LiftCandidate, timeMs: number, reason: GestureReasonCode, rejections: GestureRejection[]): void {
    this.#pushRejection(rejections, timeMs, [candidate.leftId, candidate.rightId], reason);
    this.#dropCandidate();
  }

  #pushRejection(
    rejections: GestureRejection[],
    timeMs: number,
    handIds: readonly string[],
    reason: GestureReasonCode,
  ): void {
    this.#rejectionReasonCodes.push(reason);
    rejections.push({
      gestureType: this.#settings.gestureType,
      timeMs,
      handIds: [...handIds].sort(),
      reasonCodes: [reason],
    });
  }
}

/** Travel along the direction. Positive means the hand moved the way it was asked to. */
function project(direction: readonly [number, number], start: Point, position: Point): number {
  return (position.x - start.x) * direction[0] + (position.y - start.y) * direction[1];
}

/** Signed drift perpendicular to the direction. */
function perpendicular(direction: readonly [number, number], start: Point, position: Point): number {
  return (position.x - start.x) * -direction[1] + (position.y - start.y) * direction[0];
}

function measure(
  direction: readonly [number, number],
  start: Point,
  previous: Point,
  hand: TrackedHandFeatures,
  deltaMs: number,
): HandMotion {
  const upward = project(direction, start, hand.palmCenter);
  const previousUpward = project(direction, start, previous);
  return {
    upward,
    sideways: Math.abs(perpendicular(direction, start, hand.palmCenter)),
    horizontal: Math.abs(hand.palmCenter.x - start.x),
    upwardSpeed: deltaMs > 0 ? Math.max(0, (upward - previousUpward) * 1_000 / deltaMs) : 0,
  };
}

function isStill(motion: HandMotion, tolerance: number): boolean {
  return Math.abs(motion.upward) <= tolerance && motion.sideways <= tolerance;
}

/**
 * Interpolates when the travel along the direction first crossed the threshold between two
 * samples. The crossing time stays latched until the hand clearly falls back below the
 * threshold. A gesture that also asks for horizontal travel counts the hand as reached only
 * while that travel is there too.
 */
function reachedAt(
  direction: readonly [number, number],
  start: Point,
  previous: Point,
  current: TrackedHandFeatures,
  previousTimeMs: number,
  currentTimeMs: number,
  previousReachedAtMs: number | null,
  threshold: number,
  minimumHorizontalDistance: number,
): number | null {
  if (minimumHorizontalDistance > 0
    && Math.abs(current.palmCenter.x - start.x) < minimumHorizontalDistance) {
    return null;
  }
  const upward = project(direction, start, current.palmCenter);
  if (previousReachedAtMs !== null) {
    return upward >= threshold - REACH_RELEASE_MARGIN ? previousReachedAtMs : null;
  }
  if (upward < threshold) return null;
  const previousUpward = project(direction, start, previous);
  if (previousUpward >= threshold) return previousTimeMs;
  const ratio = clamp01((threshold - previousUpward) / (upward - previousUpward));
  return previousTimeMs + (currentTimeMs - previousTimeMs) * ratio;
}

function advance(candidate: LiftCandidate, left: TrackedHandFeatures, right: TrackedHandFeatures, timeMs: number): void {
  candidate.leftLast = point(left);
  candidate.rightLast = point(right);
  candidate.lastTimeMs = timeMs;
}

function diagnosticHand(hand: TrackedHandFeatures, side: "left" | "right"): Mutable<ParallelLiftDiagnosticHand> {
  return {
    trackId: hand.trackId,
    side,
    startX: hand.palmCenter.x,
    startY: hand.palmCenter.y,
    maximumUpwardDistance: 0,
    maximumSidewaysDistance: 0,
    maximumUpwardSpeed: 0,
    upwardThresholdReachedAtMs: null,
  };
}

function orderedPair(hands: readonly TrackedHandFeatures[]): readonly [TrackedHandFeatures, TrackedHandFeatures] | null {
  if (hands.length < 2) return null;
  const [left, right] = [...hands].sort((a, b) => a.palmCenter.x - b.palmCenter.x);
  return left === undefined || right === undefined ? null : [left, right];
}

function point(hand: TrackedHandFeatures): Point {
  return { x: hand.palmCenter.x, y: hand.palmCenter.y };
}

function within(value: number, minimum: number, maximum: number): boolean {
  return value >= minimum && value <= maximum;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
