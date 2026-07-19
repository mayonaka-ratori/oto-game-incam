export function percentile(values: readonly number[], quantile: number): number | null {
  if (values.length === 0) {
    return null;
  }
  if (!Number.isFinite(quantile) || quantile < 0 || quantile > 1) {
    throw new RangeError("quantile must be between 0 and 1");
  }

  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * quantile;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];

  if (lower === undefined || upper === undefined) {
    return null;
  }

  return lower + (upper - lower) * (position - lowerIndex);
}

export class FixedSampleWindow {
  readonly #capacity: number;
  readonly #samples: number[] = [];

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError("capacity must be a positive integer");
    }
    this.#capacity = capacity;
  }

  add(value: number): void {
    if (!Number.isFinite(value)) {
      return;
    }
    this.#samples.push(value);
    if (this.#samples.length > this.#capacity) {
      this.#samples.shift();
    }
  }

  clear(): void {
    this.#samples.length = 0;
  }

  get values(): readonly number[] {
    return this.#samples;
  }

  get count(): number {
    return this.#samples.length;
  }

  get mean(): number | null {
    if (this.#samples.length === 0) {
      return null;
    }
    return this.#samples.reduce((sum, value) => sum + value, 0) / this.#samples.length;
  }

  at(quantile: number): number | null {
    return percentile(this.#samples, quantile);
  }
}

