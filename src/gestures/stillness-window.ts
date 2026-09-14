export interface StillnessPoint {
  readonly x: number;
  readonly y: number;
}

interface StillnessSample {
  readonly timeMs: number;
  readonly points: readonly StillnessPoint[];
}

/**
 * Tells whether tracked points stayed within a tolerance of their current
 * positions for a whole time window. A resting hand that drifts slowly counts
 * as still; a motion faster than tolerance / window (0.08 normalized units per
 * second with 0.02 and 250ms) never does, so slow but deliberate gestures are
 * not mistaken for waiting.
 */
export class StillnessWindow {
  readonly #windowMs: number;
  readonly #tolerance: number;
  #ids: readonly string[] = [];
  #samples: StillnessSample[] = [];

  constructor(windowMs: number, tolerance: number) {
    this.#windowMs = windowMs;
    this.#tolerance = tolerance;
  }

  /** Adds a sample and reports whether the points have been still for the whole window. */
  observe(timeMs: number, ids: readonly string[], points: readonly StillnessPoint[]): boolean {
    if (ids.length !== this.#ids.length || ids.some((id, index) => id !== this.#ids[index])) {
      this.#ids = [...ids];
      this.#samples = [];
    }
    this.#samples.push({ timeMs, points: points.map(({ x, y }) => ({ x, y })) });
    // Keep the newest sample at or before the window start and everything after it.
    const windowStartMs = timeMs - this.#windowMs;
    let first = 0;
    for (const [index, sample] of this.#samples.entries()) {
      if (sample.timeMs <= windowStartMs) first = index;
    }
    if (first > 0) this.#samples.splice(0, first);
    const oldest = this.#samples[0];
    if (oldest === undefined || oldest.timeMs > windowStartMs) return false;
    return this.#samples.every((sample) => sample.points.every((point, index) => {
      const current = points[index];
      return current !== undefined
        && Math.abs(point.x - current.x) <= this.#tolerance
        && Math.abs(point.y - current.y) <= this.#tolerance;
    }));
  }

  reset(): void {
    this.#ids = [];
    this.#samples = [];
  }
}
