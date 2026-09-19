import type { TrackedHandFrame, TrackedHandFeatures } from "../tracking/derived-tracking-types";
import {
  createGestureEventId,
  resolveTrackingGapToleranceMs,
  type GestureEvaluation,
  type GestureEvent,
  type GestureReasonCode,
  type GestureRejection,
  type RibbonSwipeDirection,
} from "./gesture-types";

interface ActiveCandidate {
  state: "armed" | "traversing";
  startTimeMs: number | null;
  startX: number;
  startY: number;
  lastProjection: number;
  /** Furthest the hand has travelled along the direction in this attempt. */
  maximumProjection: number;
  lastTimeMs: number;
  centerCrossTimeMs: number | null;
}

interface GapCandidate {
  state: "gap";
  resumeState: "armed" | "traversing";
  startTimeMs: number | null;
  startX: number;
  startY: number;
  lastProjection: number;
  maximumProjection: number;
  lastTimeMs: number;
  centerCrossTimeMs: number | null;
}

type Candidate = ActiveCandidate | GapCandidate;

export interface RibbonSwipeConfig {
  readonly direction: RibbonSwipeDirection;
  readonly minimumDistance?: number;
  readonly maximumDurationMs?: number;
  readonly perpendicularTolerance?: number;
  readonly maximumBackwardFromPeak?: number;
  readonly maximumTrackingGapMs?: number;
}

/**
 * Judgment constants. Exported read-only so the on-camera guide can place the start circle
 * and the end ring from the same distances. Changing a value changes the judgment.
 */
/** The judgment measures the travel as a projection from the middle of the frame. */
export const RIBBON_SWIPE_CENTER = { x: 0.5, y: 0.5 } as const;

export const RIBBON_SWIPE_DEFAULTS = {
  minimumDistance: 0.28,
  /**
   * How long one traversal may take. 1400 (the Bloom and Lift limit) was tried on the recorded
   * Android replays on 2026-09-20 and did not raise the number of successes (8/10 → 7/10 and
   * 9/10 → 8/10), so the value stays at 850.
   */
  maximumDurationMs: 850,
  perpendicularTolerance: 0.18,
  /**
   * How far a hand that has already set off may fall back from the furthest point it reached
   * before the attempt is judged as going the wrong way. Measured from that peak instead of
   * between two frames, so the judgment does not depend on the frame interval.
   *
   * Reason: on the Android session `p1-20260919162710819` all 16 `wrong-direction` records were
   * a 0.021–0.057 sway of a hand that had not crossed the middle yet, at 90–300ms frame spacing.
   * Initial value, not measured (2026-09-20).
   */
  maximumBackwardFromPeak: 0.06,
  /** Floor of the tracking gap tolerance; a slow device raises it through the frame. */
  maximumTrackingGapMs: 150,
} as const;

/** Below this the hand has not set off yet, so the candidate stays armed. */
const START_DISTANCE = 0.02;
const START_SPEED = 0.08;

export class RibbonSwipeStateMachine {
  readonly #config: Required<RibbonSwipeConfig>;
  readonly #direction: readonly [number, number];
  readonly #candidates = new Map<string, Candidate>();

  constructor(config: RibbonSwipeConfig) {
    this.#config = {
      ...config,
      minimumDistance: config.minimumDistance ?? RIBBON_SWIPE_DEFAULTS.minimumDistance,
      maximumDurationMs: config.maximumDurationMs ?? RIBBON_SWIPE_DEFAULTS.maximumDurationMs,
      perpendicularTolerance: config.perpendicularTolerance ?? RIBBON_SWIPE_DEFAULTS.perpendicularTolerance,
      maximumBackwardFromPeak: config.maximumBackwardFromPeak ?? RIBBON_SWIPE_DEFAULTS.maximumBackwardFromPeak,
      maximumTrackingGapMs: config.maximumTrackingGapMs ?? RIBBON_SWIPE_DEFAULTS.maximumTrackingGapMs,
    };
    this.#direction = directionVector(config.direction);
  }

  prepare(frame: TrackedHandFrame): GestureEvaluation {
    const visibleIds = new Set(frame.hands.map(({ trackId }) => trackId));
    for (const handId of this.#candidates.keys()) {
      if (!visibleIds.has(handId)) this.#candidates.delete(handId);
    }
    for (const hand of frame.hands) {
      const projection = projectFromCenter(hand.palmCenter.x, hand.palmCenter.y, this.#direction);
      const perpendicular = perpendicularFromCenter(hand.palmCenter.x, hand.palmCenter.y, this.#direction);
      if (projection <= -this.#config.minimumDistance / 2
        && Math.abs(perpendicular) <= this.#config.perpendicularTolerance) {
        this.#candidates.set(hand.trackId, {
          state: "armed",
          startTimeMs: null,
          startX: hand.palmCenter.x,
          startY: hand.palmCenter.y,
          lastProjection: projection,
          maximumProjection: projection,
          lastTimeMs: frame.captureTimeMs,
          centerCrossTimeMs: null,
        });
      } else {
        this.#candidates.delete(hand.trackId);
      }
    }
    return { frame, events: [], rejections: [] };
  }

  process(frame: TrackedHandFrame): GestureEvaluation {
    const events: GestureEvent[] = [];
    const rejections: GestureRejection[] = [];
    const visible = new Map(frame.hands.map((hand) => [hand.trackId, hand]));
    const toleranceMs = resolveTrackingGapToleranceMs(frame, this.#config.maximumTrackingGapMs);

    for (const [handId, candidate] of this.#candidates) {
      const hand = visible.get(handId);
      const gapMs = frame.captureTimeMs - candidate.lastTimeMs;
      if (hand === undefined) {
        if (gapMs > toleranceMs) {
          rejections.push(reject(frame, handId, "tracking-lost"));
          this.#candidates.delete(handId);
        } else if (candidate.state !== "gap") {
          this.#candidates.set(handId, { ...candidate, state: "gap", resumeState: candidate.state });
        }
        continue;
      }
      if (candidate.state !== "gap") continue;
      if (gapMs > toleranceMs) {
        rejections.push(reject(frame, handId, "tracking-lost"));
        this.#candidates.delete(handId);
      } else {
        this.#candidates.set(handId, { ...candidate, state: candidate.resumeState });
      }
    }

    for (const hand of frame.hands) this.#processHand(frame, hand, events, rejections);
    return { frame, events, rejections };
  }

  reset(): void {
    this.#candidates.clear();
  }

  #processHand(
    frame: TrackedHandFrame,
    hand: TrackedHandFeatures,
    events: GestureEvent[],
    rejections: GestureRejection[],
  ): void {
    const projection = projectFromCenter(hand.palmCenter.x, hand.palmCenter.y, this.#direction);
    const perpendicular = perpendicularFromCenter(hand.palmCenter.x, hand.palmCenter.y, this.#direction);
    const candidate = this.#candidates.get(hand.trackId);

    if (candidate === undefined) {
      if (projection <= -this.#config.minimumDistance / 2
        && Math.abs(perpendicular) <= this.#config.perpendicularTolerance) {
        this.#candidates.set(hand.trackId, {
          state: "armed",
          startTimeMs: null,
          startX: hand.palmCenter.x,
          startY: hand.palmCenter.y,
          lastProjection: projection,
          maximumProjection: projection,
          lastTimeMs: frame.captureTimeMs,
          centerCrossTimeMs: null,
        });
      }
      return;
    }
    if (candidate.state === "gap") return;

    const projectionDelta = projection - candidate.lastProjection;
    const directionalSpeed = hand.palmVelocity.x * this.#direction[0] + hand.palmVelocity.y * this.#direction[1];

    if (candidate.state === "armed") {
      if (Math.abs(perpendicular) > this.#config.perpendicularTolerance) {
        if (projectionDelta > START_DISTANCE) rejections.push(reject(frame, hand.trackId, "off-axis"));
        this.#candidates.delete(hand.trackId);
        return;
      }
      if (projectionDelta <= START_DISTANCE && directionalSpeed <= START_SPEED) {
        // Moving backwards lands here too: a hand that has not set off yet is waiting, not going
        // the wrong way, so the attempt is kept and the start simply follows the hand
        // (docs/19 の3.1: every recorded `wrong-direction` was a sway before the hand set off).
        candidate.lastProjection = projection;
        candidate.maximumProjection = projection;
        candidate.lastTimeMs = frame.captureTimeMs;
        candidate.startX = hand.palmCenter.x;
        candidate.startY = hand.palmCenter.y;
        return;
      }
      candidate.state = "traversing";
      candidate.startTimeMs = frame.captureTimeMs;
      candidate.maximumProjection = Math.max(candidate.maximumProjection, candidate.lastProjection);
    }

    if (Math.abs(perpendicular) > this.#config.perpendicularTolerance) {
      rejections.push(reject(frame, hand.trackId, "off-axis"));
      this.#candidates.delete(hand.trackId);
      return;
    }
    candidate.maximumProjection = Math.max(candidate.maximumProjection, projection);
    if (candidate.maximumProjection - projection > this.#config.maximumBackwardFromPeak) {
      rejections.push(reject(frame, hand.trackId, "wrong-direction"));
      this.#candidates.delete(hand.trackId);
      return;
    }
    if (candidate.startTimeMs !== null
      && frame.captureTimeMs - candidate.startTimeMs > this.#config.maximumDurationMs) {
      rejections.push(reject(frame, hand.trackId, "candidate-timeout"));
      this.#candidates.delete(hand.trackId);
      return;
    }
    if (candidate.centerCrossTimeMs === null && candidate.lastProjection < 0 && projection >= 0) {
      const ratio = -candidate.lastProjection / Math.max(projection - candidate.lastProjection, Number.EPSILON);
      candidate.centerCrossTimeMs = candidate.lastTimeMs + (frame.captureTimeMs - candidate.lastTimeMs) * ratio;
    }

    const pathDistance = Math.hypot(hand.palmCenter.x - candidate.startX, hand.palmCenter.y - candidate.startY);
    candidate.lastProjection = projection;
    candidate.lastTimeMs = frame.captureTimeMs;
    if (projection < this.#config.minimumDistance / 2 || candidate.centerCrossTimeMs === null) return;

    events.push({
      id: createGestureEventId("ribbon-swipe"),
      gestureType: "ribbon-swipe",
      eventTimeMs: candidate.centerCrossTimeMs,
      handIds: [hand.trackId],
      confidence: clamp01(0.55 + pathDistance + Math.max(0, directionalSpeed) * 0.12),
      quality: {
        speed: directionalSpeed,
        pathDistance,
        perpendicularError: Math.abs(perpendicular),
        direction: this.#config.direction,
      },
      trackingQuality: "observed",
      reasonCodes: ["center-crossed"],
    });
    this.#candidates.delete(hand.trackId);
  }
}

/** The unit vector the judgment projects onto, so a guide can place points along the same axis. */
export function ribbonSwipeDirectionVector(direction: RibbonSwipeDirection): readonly [number, number] {
  return directionVector(direction);
}

function directionVector(direction: RibbonSwipeDirection): readonly [number, number] {
  const diagonal = Math.SQRT1_2;
  return {
    "left-to-right": [1, 0] as const,
    "right-to-left": [-1, 0] as const,
    "lower-left-to-upper-right": [diagonal, -diagonal] as const,
    "lower-right-to-upper-left": [-diagonal, -diagonal] as const,
  }[direction];
}

function projectFromCenter(x: number, y: number, direction: readonly [number, number]): number {
  return (x - RIBBON_SWIPE_CENTER.x) * direction[0] + (y - RIBBON_SWIPE_CENTER.y) * direction[1];
}

function perpendicularFromCenter(x: number, y: number, direction: readonly [number, number]): number {
  return (x - RIBBON_SWIPE_CENTER.x) * -direction[1] + (y - RIBBON_SWIPE_CENTER.y) * direction[0];
}

function reject(frame: TrackedHandFrame, handId: string, reason: GestureReasonCode): GestureRejection {
  return { gestureType: "ribbon-swipe", timeMs: frame.captureTimeMs, handIds: [handId], reasonCodes: [reason] };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
