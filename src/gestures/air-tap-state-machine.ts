import type { TrackedHandFeatures, TrackedHandFrame } from "../tracking/derived-tracking-types";
import {
  createGestureEventId,
  type GestureEvaluation,
  type GestureEvent,
  type GestureRejection,
} from "./gesture-types";

interface Sample {
  readonly timeMs: number;
  readonly distance: number;
  readonly inside: boolean;
}

export interface AirTapConfig {
  readonly centerX: number;
  readonly centerY: number;
  readonly radius?: number;
  readonly minimumSpeed?: number;
  readonly cooldownMs?: number;
}

export class AirTapStateMachine {
  readonly #config: Required<AirTapConfig>;
  readonly #samples = new Map<string, Sample>();
  readonly #cooldownUntil = new Map<string, number>();

  constructor(config: AirTapConfig) {
    this.#config = {
      ...config,
      radius: config.radius ?? 0.11,
      minimumSpeed: config.minimumSpeed ?? 0.35,
      cooldownMs: config.cooldownMs ?? 280,
    };
  }

  process(frame: TrackedHandFrame): GestureEvaluation {
    const events: GestureEvent[] = [];
    const rejections: GestureRejection[] = [];
    for (const hand of frame.hands) this.#processHand(frame, hand, events, rejections);
    return { frame, events, rejections };
  }

  reset(): void {
    this.#samples.clear();
    this.#cooldownUntil.clear();
  }

  #processHand(
    frame: TrackedHandFrame,
    hand: TrackedHandFeatures,
    events: GestureEvent[],
    rejections: GestureRejection[],
  ): void {
    const distance = Math.hypot(
      hand.indexTip.x - this.#config.centerX,
      hand.indexTip.y - this.#config.centerY,
    );
    const inside = distance <= this.#config.radius;
    const previous = this.#samples.get(hand.trackId);
    this.#samples.set(hand.trackId, { timeMs: frame.captureTimeMs, distance, inside });
    if (previous === undefined || previous.inside || !inside) return;
    const speed = Math.hypot(hand.indexTipVelocity.x, hand.indexTipVelocity.y);
    const cooldownUntil = this.#cooldownUntil.get(hand.trackId) ?? -Infinity;
    if (frame.captureTimeMs < cooldownUntil) {
      rejections.push(rejection(frame.captureTimeMs, hand.trackId, "cooldown-active"));
      return;
    }
    if (speed < this.#config.minimumSpeed) {
      rejections.push(rejection(frame.captureTimeMs, hand.trackId, "movement-too-slow"));
      return;
    }
    const eventTimeMs = interpolateBoundaryTime(previous, frame.captureTimeMs, distance, this.#config.radius);
    events.push({
      id: createGestureEventId("air-tap"),
      gestureType: "air-tap",
      eventTimeMs,
      handIds: [hand.trackId],
      confidence: clamp01(0.6 + speed / 3),
      quality: { speed },
      trackingQuality: "observed",
      reasonCodes: ["target-crossed"],
    });
    this.#cooldownUntil.set(hand.trackId, eventTimeMs + this.#config.cooldownMs);
  }
}

function interpolateBoundaryTime(
  previous: Sample,
  currentTimeMs: number,
  currentDistance: number,
  radius: number,
): number {
  const range = previous.distance - currentDistance;
  if (range <= 0) return currentTimeMs;
  const ratio = clamp01((previous.distance - radius) / range);
  return previous.timeMs + (currentTimeMs - previous.timeMs) * ratio;
}

function rejection(timeMs: number, handId: string, reason: "cooldown-active" | "movement-too-slow"): GestureRejection {
  return { gestureType: "air-tap", timeMs, handIds: [handId], reasonCodes: [reason] };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
