import type { TrackedHandFrame } from "../tracking/derived-tracking-types";
import {
  createGestureEventId,
  type GestureEvaluation,
  type GestureEvent,
  type GestureRejection,
} from "./gesture-types";

export interface ClapBurstConfig {
  readonly armDistance?: number;
  readonly triggerDistance?: number;
  readonly contactLikeDistance?: number;
  readonly releaseDistance?: number;
  readonly minimumConvergenceSpeed?: number;
  readonly occlusionGraceMs?: number;
}

type Phase = "idle" | "armed" | "compressed";

export class ClapBurstStateMachine {
  readonly #config: Required<ClapBurstConfig>;
  #phase: Phase = "idle";
  #lastDistance: number | null = null;
  #lastTimeMs: number | null = null;
  #lastConvergenceSpeed = 0;
  #activeHandIds: readonly string[] = [];

  constructor(config: ClapBurstConfig = {}) {
    this.#config = {
      armDistance: config.armDistance ?? 0.34,
      triggerDistance: config.triggerDistance ?? 0.14,
      contactLikeDistance: config.contactLikeDistance ?? 0.075,
      releaseDistance: config.releaseDistance ?? 0.3,
      minimumConvergenceSpeed: config.minimumConvergenceSpeed ?? 0.28,
      occlusionGraceMs: config.occlusionGraceMs ?? 150,
    };
  }

  process(frame: TrackedHandFrame): GestureEvaluation {
    const events: GestureEvent[] = [];
    const rejections: GestureRejection[] = [];
    if (frame.hands.length < 2) {
      this.#handleOcclusion(frame, events, rejections);
      return { frame, events, rejections };
    }
    const [first, second] = frame.hands;
    if (first === undefined || second === undefined) return { frame, events, rejections };
    const distance = Math.hypot(
      first.palmCenter.x - second.palmCenter.x,
      first.palmCenter.y - second.palmCenter.y,
    );
    const deltaMs = this.#lastTimeMs === null ? 0 : frame.captureTimeMs - this.#lastTimeMs;
    const convergenceSpeed = deltaMs > 0 && this.#lastDistance !== null
      ? (this.#lastDistance - distance) * 1_000 / deltaMs
      : 0;
    const handIds = [first.trackId, second.trackId].sort();
    if (distance >= this.#config.armDistance && this.#phase === "idle") {
      this.#phase = "armed";
      this.#activeHandIds = handIds;
    }
    if (this.#phase === "armed" && distance <= this.#config.triggerDistance) {
      if (Math.max(convergenceSpeed, this.#lastConvergenceSpeed) >= this.#config.minimumConvergenceSpeed) {
        const eventTimeMs = interpolateDistanceTime(
          this.#lastTimeMs,
          frame.captureTimeMs,
          this.#lastDistance,
          distance,
          this.#config.triggerDistance,
        );
        const contactLike = distance <= this.#config.contactLikeDistance;
        events.push({
          id: createGestureEventId("clap"),
          gestureType: "clap",
          eventTimeMs,
          handIds,
          confidence: clamp01(0.62 + Math.max(convergenceSpeed, this.#lastConvergenceSpeed) * 0.18),
          quality: {
            speed: Math.max(convergenceSpeed, this.#lastConvergenceSpeed),
            minimumHandDistance: distance,
            clapKind: contactLike ? "contact-like" : "near-clap",
          },
          trackingQuality: "observed",
          reasonCodes: [contactLike ? "contact-like-distance" : "near-clap-distance"],
        });
        this.#phase = "compressed";
        this.#activeHandIds = handIds;
      } else {
        rejections.push({
          gestureType: "clap",
          timeMs: frame.captureTimeMs,
          handIds,
          reasonCodes: ["movement-too-slow"],
        });
      }
    } else if (this.#phase === "compressed" && distance >= this.#config.releaseDistance && convergenceSpeed < 0) {
      events.push({
        id: createGestureEventId("burst"),
        gestureType: "burst",
        eventTimeMs: frame.captureTimeMs,
        handIds: this.#activeHandIds,
        confidence: clamp01(0.6 + Math.abs(convergenceSpeed) * 0.15),
        quality: { speed: Math.abs(convergenceSpeed), minimumHandDistance: distance },
        trackingQuality: "observed",
        reasonCodes: ["two-hand-release"],
      });
      this.#phase = "idle";
      this.#activeHandIds = [];
    }
    this.#lastDistance = distance;
    this.#lastTimeMs = frame.captureTimeMs;
    this.#lastConvergenceSpeed = convergenceSpeed;
    return { frame, events, rejections };
  }

  reset(): void {
    this.#phase = "idle";
    this.#lastDistance = null;
    this.#lastTimeMs = null;
    this.#lastConvergenceSpeed = 0;
    this.#activeHandIds = [];
  }

  #handleOcclusion(
    frame: TrackedHandFrame,
    events: GestureEvent[],
    rejections: GestureRejection[],
  ): void {
    if (this.#phase !== "armed" || this.#lastTimeMs === null || this.#lastDistance === null) return;
    const elapsed = frame.captureTimeMs - this.#lastTimeMs;
    if (elapsed <= this.#config.occlusionGraceMs
      && this.#lastDistance <= this.#config.triggerDistance * 1.55
      && this.#lastConvergenceSpeed >= this.#config.minimumConvergenceSpeed) {
      const predictedDelayMs = Math.min(
        this.#config.occlusionGraceMs,
        Math.max(0, (this.#lastDistance - this.#config.triggerDistance) / this.#lastConvergenceSpeed * 1_000),
      );
      events.push({
        id: createGestureEventId("clap"),
        gestureType: "clap",
        eventTimeMs: this.#lastTimeMs + predictedDelayMs,
        handIds: this.#activeHandIds,
        confidence: 0.58,
        quality: {
          speed: this.#lastConvergenceSpeed,
          minimumHandDistance: this.#lastDistance,
          clapKind: "occlusion-predicted",
        },
        trackingQuality: "short-occlusion-predicted",
        reasonCodes: ["occlusion-predicted"],
      });
      this.#phase = "compressed";
      return;
    }
    if (elapsed > this.#config.occlusionGraceMs) {
      rejections.push({
        gestureType: "clap",
        timeMs: frame.captureTimeMs,
        handIds: this.#activeHandIds,
        reasonCodes: ["tracking-lost"],
      });
      this.reset();
    }
  }
}

function interpolateDistanceTime(
  previousTimeMs: number | null,
  currentTimeMs: number,
  previousDistance: number | null,
  currentDistance: number,
  targetDistance: number,
): number {
  if (previousTimeMs === null || previousDistance === null || previousDistance <= currentDistance) return currentTimeMs;
  const ratio = clamp01((previousDistance - targetDistance) / (previousDistance - currentDistance));
  return previousTimeMs + (currentTimeMs - previousTimeMs) * ratio;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
