import type { GestureEvent } from "./gesture-types";

const PRIORITY: Readonly<Record<GestureEvent["gestureType"], number>> = {
  clap: 4,
  burst: 3,
  "ribbon-swipe": 2,
  "air-tap": 1,
};

export class GestureArbiter {
  readonly #consumedUntil = new Map<string, number>();
  readonly #consumptionWindowMs: number;

  constructor(consumptionWindowMs = 120) {
    this.#consumptionWindowMs = consumptionWindowMs;
  }

  select(candidates: readonly GestureEvent[]): readonly GestureEvent[] {
    const accepted: GestureEvent[] = [];
    const ordered = [...candidates].sort((left, right) =>
      left.eventTimeMs - right.eventTimeMs
      || PRIORITY[right.gestureType] - PRIORITY[left.gestureType]
      || right.confidence - left.confidence);
    for (const candidate of ordered) {
      if (candidate.handIds.some((id) => (this.#consumedUntil.get(id) ?? -Infinity) > candidate.eventTimeMs)) continue;
      accepted.push(candidate);
      for (const id of candidate.handIds) {
        this.#consumedUntil.set(id, candidate.eventTimeMs + this.#consumptionWindowMs);
      }
    }
    return accepted.sort((left, right) => left.eventTimeMs - right.eventTimeMs);
  }

  reset(): void {
    this.#consumedUntil.clear();
  }
}
