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

export const DEFAULT_HISTOGRAM_BUCKET_MS = 1;
const DEFAULT_HISTOGRAM_BUCKET_COUNT = 1_000;

/**
 * Constant-memory quantiles. Samples are counted into fixed-width buckets, so the reported
 * p50/p95 are the lower edge of a bucket: with the default 1ms width the value is the sample
 * rounded down to a whole millisecond. Samples above the last bucket are counted in it, and
 * count/sum/min/max stay exact, so the maximum is never truncated.
 */
export class FixedBucketHistogram {
  readonly #buckets: Int32Array;
  readonly #bucketWidth: number;
  #count = 0;
  #sum = 0;
  #minimum: number | null = null;
  #maximum: number | null = null;

  constructor(bucketWidth = DEFAULT_HISTOGRAM_BUCKET_MS, bucketCount = DEFAULT_HISTOGRAM_BUCKET_COUNT) {
    if (!Number.isFinite(bucketWidth) || bucketWidth <= 0) {
      throw new RangeError("bucketWidth must be a positive number");
    }
    if (!Number.isInteger(bucketCount) || bucketCount <= 0) {
      throw new RangeError("bucketCount must be a positive integer");
    }
    this.#bucketWidth = bucketWidth;
    this.#buckets = new Int32Array(bucketCount);
  }

  add(value: number): void {
    if (!Number.isFinite(value)) return;
    const index = Math.min(
      this.#buckets.length - 1,
      Math.max(0, Math.floor(value / this.#bucketWidth)),
    );
    this.#buckets[index] = (this.#buckets[index] ?? 0) + 1;
    this.#count += 1;
    this.#sum += value;
    this.#minimum = this.#minimum === null ? value : Math.min(this.#minimum, value);
    this.#maximum = this.#maximum === null ? value : Math.max(this.#maximum, value);
  }

  get count(): number {
    return this.#count;
  }

  get mean(): number | null {
    return this.#count === 0 ? null : this.#sum / this.#count;
  }

  get minimum(): number | null {
    return this.#minimum;
  }

  get maximum(): number | null {
    return this.#maximum;
  }

  get bucketWidth(): number {
    return this.#bucketWidth;
  }

  quantile(quantile: number): number | null {
    if (!Number.isFinite(quantile) || quantile < 0 || quantile > 1) {
      throw new RangeError("quantile must be between 0 and 1");
    }
    if (this.#count === 0) return null;
    const rank = Math.min(this.#count - 1, Math.floor(quantile * this.#count));
    let seen = 0;
    for (let index = 0; index < this.#buckets.length; index += 1) {
      seen += this.#buckets[index] ?? 0;
      if (seen > rank) {
        // Everything above the last bucket landed in it, so only its exact maximum is meaningful.
        if (index === this.#buckets.length - 1) return this.#maximum;
        const edge = index * this.#bucketWidth;
        const minimum = this.#minimum ?? edge;
        const maximum = this.#maximum ?? edge;
        return Math.min(maximum, Math.max(minimum, edge));
      }
    }
    return this.#maximum;
  }

  reset(): void {
    this.#buckets.fill(0);
    this.#count = 0;
    this.#sum = 0;
    this.#minimum = null;
    this.#maximum = null;
  }
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

