import type { TrackedHandFrame, TrackedHandFeatures } from "../tracking/derived-tracking-types";
import {
  createGestureEventId,
  type GestureEvaluation,
  type GestureEvent,
  type GestureRejection,
  type RibbonSwipeDirection,
} from "./gesture-types";

interface Candidate {
  readonly startTimeMs: number;
  readonly startX: number;
  readonly startY: number;
  lastProjection: number;
  lastTimeMs: number;
  centerCrossTimeMs: number | null;
}

export interface RibbonSwipeConfig {
  readonly direction: RibbonSwipeDirection;
  readonly minimumDistance?: number;
  readonly maximumDurationMs?: number;
  readonly perpendicularTolerance?: number;
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
    };
    this.#direction = directionVector(config.direction);
  }

  process(frame: TrackedHandFrame): GestureEvaluation {
    const events: GestureEvent[] = [];
    const rejections: GestureRejection[] = [];
    for (const hand of frame.hands) this.#processHand(frame, hand, events, rejections);
    const visibleIds = new Set(frame.hands.map((hand) => hand.trackId));
    for (const [handId] of this.#candidates) {
      if (!visibleIds.has(handId)) {
        rejections.push({
          gestureType: "ribbon-swipe",
          timeMs: frame.captureTimeMs,
          handIds: [handId],
          reasonCodes: ["tracking-lost"],
        });
        this.#candidates.delete(handId);
      }
    }
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
    let candidate = this.#candidates.get(hand.trackId);
    if (candidate === undefined) {
      if (projection <= -this.#config.minimumDistance / 2) {
        candidate = {
          startTimeMs: frame.captureTimeMs,
          startX: hand.palmCenter.x,
          startY: hand.palmCenter.y,
          lastProjection: projection,
          lastTimeMs: frame.captureTimeMs,
          centerCrossTimeMs: null,
        };
        this.#candidates.set(hand.trackId, candidate);
      }
      return;
    }
    const elapsed = frame.captureTimeMs - candidate.startTimeMs;
    if (elapsed > this.#config.maximumDurationMs) {
      rejections.push(reject(frame, hand.trackId, "candidate-timeout"));
      this.#candidates.delete(hand.trackId);
      return;
    }
    if (Math.abs(perpendicular) > this.#config.perpendicularTolerance) {
      rejections.push(reject(frame, hand.trackId, "off-axis"));
      this.#candidates.delete(hand.trackId);
      return;
    }
    const directionalSpeed = hand.palmVelocity.x * this.#direction[0] + hand.palmVelocity.y * this.#direction[1];
    if (directionalSpeed < -0.08) {
      rejections.push(reject(frame, hand.trackId, "wrong-direction"));
      this.#candidates.delete(hand.trackId);
      return;
    }
    if (candidate.centerCrossTimeMs === null && candidate.lastProjection < 0 && projection >= 0) {
      const ratio = -candidate.lastProjection / Math.max(projection - candidate.lastProjection, Number.EPSILON);
      candidate.centerCrossTimeMs = candidate.lastTimeMs + (frame.captureTimeMs - candidate.lastTimeMs) * ratio;
    }
    candidate.lastProjection = projection;
    candidate.lastTimeMs = frame.captureTimeMs;
    const pathDistance = Math.hypot(hand.palmCenter.x - candidate.startX, hand.palmCenter.y - candidate.startY);
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

function reject(
  frame: TrackedHandFrame,
  handId: string,
  reason: "candidate-timeout" | "off-axis" | "wrong-direction",
): GestureRejection {
  return { gestureType: "ribbon-swipe", timeMs: frame.captureTimeMs, handIds: [handId], reasonCodes: [reason] };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
