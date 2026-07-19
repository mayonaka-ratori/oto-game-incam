import { describe, expect, it } from "vitest";
import { FixedSampleWindow, percentile } from "../src/metrics/statistics";

describe("percentile", () => {
  it("returns null for an empty sample", () => {
    expect(percentile([], 0.95)).toBeNull();
  });

  it("sorts and interpolates the requested quantile", () => {
    expect(percentile([40, 10, 30, 20], 0.5)).toBe(25);
    expect(percentile([10, 20, 30, 40], 0.95)).toBeCloseTo(38.5);
  });

  it("rejects an invalid quantile", () => {
    expect(() => percentile([1], 1.01)).toThrow(RangeError);
  });
});

describe("FixedSampleWindow", () => {
  it("keeps only the most recent finite samples", () => {
    const samples = new FixedSampleWindow(3);
    samples.add(1);
    samples.add(Number.NaN);
    samples.add(2);
    samples.add(3);
    samples.add(4);

    expect(samples.values).toEqual([2, 3, 4]);
    expect(samples.mean).toBe(3);
  });

  it("clears accumulated intervals", () => {
    const samples = new FixedSampleWindow(2);
    samples.add(16);
    samples.clear();

    expect(samples.count).toBe(0);
    expect(samples.at(0.5)).toBeNull();
  });
});

