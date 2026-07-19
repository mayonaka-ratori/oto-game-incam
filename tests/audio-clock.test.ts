import { describe, expect, it } from "vitest";
import { AudioClockMapper } from "../src/time/audio-clock";

describe("AudioClockMapper", () => {
  it("maps both directions without combining unrelated offsets", () => {
    const mapper = new AudioClockMapper();
    mapper.update({ contextTimeSec: 12.5, performanceTimeMs: 20_000, source: "output-timestamp" });
    expect(mapper.toPerformanceTimeMs(12.75)).toBe(20_250);
    expect(mapper.toContextTimeSec(19_500)).toBe(12);
  });

  it("returns null before a mapping sample exists", () => {
    const mapper = new AudioClockMapper();
    expect(mapper.toPerformanceTimeMs(1)).toBeNull();
    expect(mapper.toContextTimeSec(1)).toBeNull();
  });

  it("rejects non-finite samples", () => {
    const mapper = new AudioClockMapper();
    expect(() => mapper.update({
      contextTimeSec: Number.NaN,
      performanceTimeMs: 1,
      source: "current-time-sample",
    })).toThrow(TypeError);
  });
});
