import type { TrackedHandFeatures, TrackedHandFrame } from "../tracking/derived-tracking-types";
import {
  createGestureEventId,
  resolveTrackingGapToleranceMs,
  type GestureEvaluation,
  type GestureEvent,
  type GestureReasonCode,
  type GestureRejection,
  type SpotlightVariant,
  type TrackingGapDiagnostic,
} from "./gesture-types";

/**
 * Spotlight: one hand in the upper zone and the other in the lower zone, held
 * briefly. The event time is the first capture time where both hands were in
 * their zones, so the hold confirmation does not add perceived latency.
 * Left and right follow the mirrored preview: the screen-left hand is the player left hand.
 */
export interface SpotlightConfig {
  readonly variant: SpotlightVariant;
  readonly upperZoneMaxY?: number;
  readonly lowerZoneMinY?: number;
  readonly centerLineX?: number;
  readonly minimumHandSeparation?: number;
  readonly holdMs?: number;
  readonly maximumTrackingGapMs?: number;
  /** A pose change shorter than this is treated as landmark jitter, not as a release. */
  readonly poseGraceMs?: number;
}

/**
 * - target: the requested diagonal
 * - mirror: the opposite diagonal (left and right swapped)
 * - same-level: both hands in the upper zone or both in the lower zone
 * - off-center: both hands visible but not on both sides of the center line with the minimum separation
 * - transition: hands on both sides, with a hand in the band between the zones
 * - none: fewer than two hands visible
 */
export type SpotlightPose = "target" | "mirror" | "same-level" | "off-center" | "transition" | "none";

export interface SpotlightTrialDiagnostic {
  readonly variant: SpotlightVariant;
  readonly observationFrameCounts: {
    readonly zeroHands: number;
    readonly oneHand: number;
    readonly twoHands: number;
  };
  /** The requested pose was formed before the recognition window opened and was still held when it opened. */
  readonly poseBeforeGo: boolean;
  /** Zone-entry time adopted as eventTime for the successful hold. */
  readonly entryTimeMs: number | null;
  readonly holdCompletedAtMs: number | null;
  readonly longestHoldMs: number;
  readonly latestPose: SpotlightPose;
  readonly latestTrackingGap: TrackingGapDiagnostic | null;
  readonly rejectionReasonCodes: readonly GestureReasonCode[];
}

interface HoldCandidate {
  readonly entryTimeMs: number;
  readonly handIds: readonly string[];
  lastSeenMs: number;
  gapStartedAtMs: number | null;
  /** First frame of another pose during the hold; the hold breaks only if that change lasts the grace time. */
  breakStartedAtMs: number | null;
}

type WrongPoseKind = "mirror" | "same-level" | "off-center";

interface WrongPose {
  readonly pose: WrongPoseKind;
  readonly sinceMs: number;
  reported: boolean;
  interruptedAtMs: number | null;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/**
 * Judgment constants. Exported read-only so the on-camera guide can draw the same upper and
 * lower zones and the same hold time. Changing a value changes the judgment.
 */
export const SPOTLIGHT_DEFAULTS = {
  upperZoneMaxY: 0.42,
  lowerZoneMinY: 0.58,
  centerLineX: 0.5,
  minimumHandSeparation: 0.1,
  holdMs: 300,
  /** Floor of the tracking gap tolerance; a slow device raises it through the frame. */
  maximumTrackingGapMs: 150,
  poseGraceMs: 60,
} as const;

export class SpotlightStateMachine {
  readonly #config: Required<SpotlightConfig>;
  #hold: HoldCandidate | null = null;
  #wrongPose: WrongPose | null = null;
  #requireRelease = false;
  #releaseStartedAtMs: number | null = null;
  #windowStarted = false;
  /** The requested pose was formed during the count-in and has not been released since. */
  #preparedTargetHeld = false;
  #prepareReleaseStartedAtMs: number | null = null;
  #poseBeforeGoPending = false;
  #observationFrameCounts = { zeroHands: 0, oneHand: 0, twoHands: 0 };
  #poseBeforeGo = false;
  #entryTimeMs: number | null = null;
  #holdCompletedAtMs: number | null = null;
  #longestHoldMs = 0;
  #latestPose: SpotlightPose = "none";
  #latestTrackingGap: Mutable<TrackingGapDiagnostic> | null = null;
  #rejectionReasonCodes: GestureReasonCode[] = [];

  constructor(config: SpotlightConfig) {
    this.#config = { ...SPOTLIGHT_DEFAULTS, ...config };
  }

  /** Remember the count-in pose; a pose formed before the window opens must be released and formed again. */
  prepare(frame: TrackedHandFrame): GestureEvaluation {
    const now = frame.captureTimeMs;
    const { pose } = this.#classify(frame.hands);
    if (pose === "target") {
      this.#preparedTargetHeld = true;
      this.#prepareReleaseStartedAtMs = null;
    } else if (pose !== "none" && this.#preparedTargetHeld) {
      if (this.#prepareReleaseStartedAtMs === null) this.#prepareReleaseStartedAtMs = now;
      if (now - this.#prepareReleaseStartedAtMs >= this.#config.poseGraceMs) {
        this.#preparedTargetHeld = false;
        this.#prepareReleaseStartedAtMs = null;
      }
    }
    this.#hold = null;
    this.#wrongPose = null;
    this.#windowStarted = false;
    return { frame, events: [], rejections: [] };
  }

  process(frame: TrackedHandFrame): GestureEvaluation {
    const events: GestureEvent[] = [];
    const rejections: GestureRejection[] = [];
    const result = { frame, events, rejections };
    const now = frame.captureTimeMs;
    this.#recordObservation(frame);
    const toleranceMs = resolveTrackingGapToleranceMs(frame, this.#config.maximumTrackingGapMs);
    const { pose, handIds } = this.#classify(frame.hands);
    this.#latestPose = pose;
    if (pose !== "none") this.#closeGap(now);

    if (!this.#windowStarted) {
      this.#windowStarted = true;
      if (this.#preparedTargetHeld) {
        // The count-in pose is judged on the first window frame that shows it, even if a hand blinked out at the boundary.
        this.#requireRelease = true;
        this.#poseBeforeGoPending = true;
        this.#releaseStartedAtMs = this.#prepareReleaseStartedAtMs;
      }
    }

    if (this.#requireRelease) {
      if (pose === "none") return result;
      if (pose === "target") {
        this.#releaseStartedAtMs = null;
        if (this.#poseBeforeGoPending) {
          this.#poseBeforeGoPending = false;
          this.#poseBeforeGo = true;
          this.#pushRejection(rejections, now, handIds, "spotlight-pose-before-go");
        }
        return result;
      }
      if (this.#releaseStartedAtMs === null) this.#releaseStartedAtMs = now;
      if (now - this.#releaseStartedAtMs < this.#config.poseGraceMs) return result;
      this.#requireRelease = false;
      this.#poseBeforeGoPending = false;
      this.#releaseStartedAtMs = null;
    }

    if (pose === "none") {
      const hold = this.#hold;
      if (hold !== null) {
        if (hold.gapStartedAtMs === null) {
          hold.gapStartedAtMs = now;
          this.#latestTrackingGap = {
            startedAtMs: now,
            reacquiredAtMs: null,
            durationMs: null,
            handIds: [...hold.handIds],
          };
        }
        if (now - hold.lastSeenMs > toleranceMs) {
          this.#pushRejection(rejections, now, hold.handIds, "tracking-lost");
          this.#hold = null;
        }
      }
      return result;
    }

    this.#trackWrongPose(pose, handIds, now, rejections);

    if (pose === "target") {
      let hold = this.#hold;
      if (hold !== null && hold.gapStartedAtMs !== null) {
        if (now - hold.lastSeenMs > toleranceMs) {
          this.#pushRejection(rejections, now, hold.handIds, "tracking-lost");
          hold = null;
        } else {
          hold.gapStartedAtMs = null;
        }
      }
      if (hold === null) {
        hold = { entryTimeMs: now, handIds, lastSeenMs: now, gapStartedAtMs: null, breakStartedAtMs: null };
      }
      hold.breakStartedAtMs = null;
      hold.lastSeenMs = now;
      this.#hold = hold;
      const heldMs = now - hold.entryTimeMs;
      this.#longestHoldMs = Math.max(this.#longestHoldMs, heldMs);
      if (heldMs >= this.#config.holdMs) {
        events.push({
          id: createGestureEventId("spotlight"),
          gestureType: "spotlight",
          eventTimeMs: hold.entryTimeMs,
          handIds: [...hold.handIds].sort(),
          confidence: clamp01(0.62 + Math.min(1, heldMs / (this.#config.holdMs * 2)) * 0.3),
          quality: { holdDurationMs: heldMs, spotlightVariant: this.#config.variant },
          trackingQuality: "observed",
          reasonCodes: ["spotlight-held"],
        });
        this.#entryTimeMs = hold.entryTimeMs;
        this.#holdCompletedAtMs = now;
        this.#hold = null;
        this.#requireRelease = true;
      }
      return result;
    }

    // A visible pose other than the target ends the hold only when it lasts longer than landmark jitter.
    const hold = this.#hold;
    if (hold !== null) {
      if (hold.gapStartedAtMs !== null && now - hold.lastSeenMs > toleranceMs) {
        this.#pushRejection(rejections, now, hold.handIds, "tracking-lost");
        this.#hold = null;
      } else {
        hold.gapStartedAtMs = null;
        if (hold.breakStartedAtMs === null) hold.breakStartedAtMs = now;
        if (now - hold.breakStartedAtMs >= this.#config.poseGraceMs) {
          this.#pushRejection(rejections, now, hold.handIds, "spotlight-pose-not-held");
          this.#hold = null;
        }
      }
    }
    return result;
  }

  reset(): void {
    this.#hold = null;
    this.#wrongPose = null;
    this.#requireRelease = false;
    this.#releaseStartedAtMs = null;
    this.#windowStarted = false;
    this.#preparedTargetHeld = false;
    this.#prepareReleaseStartedAtMs = null;
    this.#poseBeforeGoPending = false;
    this.#observationFrameCounts = { zeroHands: 0, oneHand: 0, twoHands: 0 };
    this.#poseBeforeGo = false;
    this.#entryTimeMs = null;
    this.#holdCompletedAtMs = null;
    this.#longestHoldMs = 0;
    this.#latestPose = "none";
    this.#latestTrackingGap = null;
    this.#rejectionReasonCodes = [];
  }

  get diagnostic(): SpotlightTrialDiagnostic {
    return this.#createDiagnostic(null);
  }

  diagnosticAt(finishedAtMs: number): SpotlightTrialDiagnostic {
    return this.#createDiagnostic(finishedAtMs);
  }

  #createDiagnostic(finishedAtMs: number | null): SpotlightTrialDiagnostic {
    const gap = this.#latestTrackingGap;
    const latestTrackingGap = gap === null
      ? null
      : gap.reacquiredAtMs === null && finishedAtMs !== null
        ? { ...gap, durationMs: Math.max(0, finishedAtMs - gap.startedAtMs), handIds: [...gap.handIds] }
        : { ...gap, handIds: [...gap.handIds] };
    return {
      variant: this.#config.variant,
      observationFrameCounts: { ...this.#observationFrameCounts },
      poseBeforeGo: this.#poseBeforeGo,
      entryTimeMs: this.#entryTimeMs,
      holdCompletedAtMs: this.#holdCompletedAtMs,
      longestHoldMs: this.#longestHoldMs,
      latestPose: this.#latestPose,
      latestTrackingGap,
      rejectionReasonCodes: [...this.#rejectionReasonCodes],
    };
  }

  #recordObservation(frame: TrackedHandFrame): void {
    if (frame.hands.length === 0) this.#observationFrameCounts.zeroHands += 1;
    else if (frame.hands.length === 1) this.#observationFrameCounts.oneHand += 1;
    else this.#observationFrameCounts.twoHands += 1;
  }

  /** Records when both hands were seen again, whether or not the hold survived the gap. */
  #closeGap(timeMs: number): void {
    if (this.#latestTrackingGap === null || this.#latestTrackingGap.reacquiredAtMs !== null) return;
    this.#latestTrackingGap.reacquiredAtMs = timeMs;
    this.#latestTrackingGap.durationMs = Math.max(0, timeMs - this.#latestTrackingGap.startedAtMs);
  }

  /** Reports a wrong pose once after it is held for holdMs; interruptions shorter than the grace time do not reset it. */
  #trackWrongPose(pose: SpotlightPose, handIds: readonly string[], now: number, rejections: GestureRejection[]): void {
    const wrong = pose === "mirror" || pose === "same-level" || pose === "off-center" ? pose : null;
    const current = this.#wrongPose;
    if (current !== null && current.pose === wrong) {
      current.interruptedAtMs = null;
      if (!current.reported && now - current.sinceMs >= this.#config.holdMs) {
        this.#pushRejection(rejections, now, handIds, wrongPoseReason(current.pose));
        current.reported = true;
      }
      return;
    }
    if (current !== null) {
      if (current.interruptedAtMs === null) current.interruptedAtMs = now;
      if (now - current.interruptedAtMs < this.#config.poseGraceMs) return;
      this.#wrongPose = null;
    }
    if (wrong !== null) this.#wrongPose = { pose: wrong, sinceMs: now, reported: false, interruptedAtMs: null };
  }

  #classify(hands: readonly TrackedHandFeatures[]): { readonly pose: SpotlightPose; readonly handIds: readonly string[] } {
    if (hands.length < 2) return { pose: "none", handIds: [] };
    const [left, right] = [...hands].sort((a, b) => a.palmCenter.x - b.palmCenter.x);
    if (left === undefined || right === undefined) return { pose: "none", handIds: [] };
    const handIds = [left.trackId, right.trackId];
    const config = this.#config;
    if (right.palmCenter.x - left.palmCenter.x < config.minimumHandSeparation
      || left.palmCenter.x > config.centerLineX
      || right.palmCenter.x < config.centerLineX) {
      return { pose: "off-center", handIds };
    }
    const leftZone = this.#zone(left.palmCenter.y);
    const rightZone = this.#zone(right.palmCenter.y);
    if (leftZone === "middle" || rightZone === "middle") return { pose: "transition", handIds };
    const targetLeft = config.variant === "left-up-right-down" ? "upper" : "lower";
    const targetRight = targetLeft === "upper" ? "lower" : "upper";
    if (leftZone === targetLeft && rightZone === targetRight) return { pose: "target", handIds };
    if (leftZone === targetRight && rightZone === targetLeft) return { pose: "mirror", handIds };
    return { pose: "same-level", handIds };
  }

  #zone(y: number): "upper" | "lower" | "middle" {
    if (y <= this.#config.upperZoneMaxY) return "upper";
    if (y >= this.#config.lowerZoneMinY) return "lower";
    return "middle";
  }

  #pushRejection(
    rejections: GestureRejection[],
    timeMs: number,
    handIds: readonly string[],
    reason: GestureReasonCode,
  ): void {
    this.#rejectionReasonCodes.push(reason);
    rejections.push({ gestureType: "spotlight", timeMs, handIds: [...handIds].sort(), reasonCodes: [reason] });
  }
}

function wrongPoseReason(pose: WrongPoseKind): GestureReasonCode {
  if (pose === "mirror") return "spotlight-wrong-side";
  if (pose === "same-level") return "spotlight-wrong-zone";
  return "spotlight-hands-not-separated";
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
