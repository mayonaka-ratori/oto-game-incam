import type { TrackedHandFrame, TrackedHandFeatures } from "../tracking/derived-tracking-types";
import {
  createGestureEventId,
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
  lastTimeMs: number;
  centerCrossTimeMs: number | null;
}

type Candidate = ActiveCandidate | GapCandidate;

export interface RibbonSwipeConfig {
  readonly direction: RibbonSwipeDirection;
  readonly minimumDistance?: number;
  readonly maximumDurationMs?: number;
  readonly perpendicularTolerance?: number;
  readonly maximumTrackingGapMs?: number;
}

export class RibbonSwipeStateMachine {
  readonly #config: Required<RibbonSwipeConfig>;
  readonly #direction: readonly [number, number];
  readonly #candidates = new Map<string, Candidate>();

  constructor(config: RibbonSwipeConfig) {
    this.#config = {
      ...config,
      minimumDistance: config.minimumDistance ?? 0.28,
      maximumDurationMs: config.maximumDurationMs ?? 850,
      perpendicularTolerance: config.perpendicularTolerance ?? 0.18,
      maximumTrackingGapMs: config.maximumTrackingGapMs ?? 150,
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

    for (const [handId, candidate] of this.#candidates) {
      const hand = visible.get(handId);
      const gapMs = frame.captureTimeMs - candidate.lastTimeMs;
      if (hand === undefined) {
        if (gapMs > this.#config.maximumTrackingGapMs) {
          rejections.push(reject(frame, handId, "tracking-lost"));
          this.#candidates.delete(handId);
        } else if (candidate.state !== "gap") {
          this.#candidates.set(handId, { ...candidate, state: "gap", resumeState: candidate.state });
        }
        continue;
      }
      if (candidate.state !== "gap") continue;
      if (gapMs > this.#config.maximumTrackingGapMs) {
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
      if (projectionDelta < -0.02 || directionalSpeed < -0.08) {
        rejections.push(reject(frame, hand.trackId, "wrong-direction"));
        this.#candidates.delete(hand.trackId);
        return;
      }
      if (Math.abs(perpendicular) > this.#config.perpendicularTolerance) {
        if (projectionDelta > 0.02) rejections.push(reject(frame, hand.trackId, "off-axis"));
        this.#candidates.delete(hand.trackId);
        return;
      }
      if (projectionDelta <= 0.02 && directionalSpeed <= 0.08) {
        candidate.lastProjection = projection;
        candidate.lastTimeMs = frame.captureTimeMs;
        candidate.startX = hand.palmCenter.x;
        candidate.startY = hand.palmCenter.y;
        return;
      }
      candidate.state = "traversing";
      candidate.startTimeMs = frame.captureTimeMs;
    }

    if (Math.abs(perpendicular) > this.#config.perpendicularTolerance) {
      rejections.push(reject(frame, hand.trackId, "off-axis"));
      this.#candidates.delete(hand.trackId);
      return;
    }
    if (projectionDelta < -0.02 || directionalSpeed < -0.08) {
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
  return (x - 0.5) * direction[0] + (y - 0.5) * direction[1];
}

function perpendicularFromCenter(x: number, y: number, direction: readonly [number, number]): number {
  return (x - 0.5) * -direction[1] + (y - 0.5) * direction[0];
}

function reject(frame: TrackedHandFrame, handId: string, reason: GestureReasonCode): GestureRejection {
  return { gestureType: "ribbon-swipe", timeMs: frame.captureTimeMs, handIds: [handId], reasonCodes: [reason] };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
