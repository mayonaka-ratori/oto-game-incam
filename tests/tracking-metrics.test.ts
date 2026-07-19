import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrackingMetricsCollector } from "../src/metrics/tracking-metrics";
import type { HandTrackingFrame } from "../src/tracking/tracking-types";

describe("TrackingMetricsCollector", () => {
  beforeEach(() => {
    vi.spyOn(performance, "now").mockReturnValue(1_000);
  });

  it("keeps unavailable metrics null instead of inventing zeroes", () => {
    const collector = new TrackingMetricsCollector();
    expect(collector.snapshot).toMatchObject({
      outputHz: null,
      oneHandCoverage: null,
      twoHandCoverage: null,
      handCount: null,
      state: "framing",
    });
  });

  it("separates one-hand and two-hand coverage and reports frame age", () => {
    const collector = new TrackingMetricsCollector();
    collector.markInitializing();
    collector.markReady({
      delegate: "CPU",
      fallbackReason: null,
      packageId: "test",
      modelId: "test",
    }, 4);
    collector.addResult(frame(1, ["left"], 900));
    vi.spyOn(performance, "now").mockReturnValue(1_040);
    collector.addResult(frame(2, ["left", "right"], 940));

    expect(collector.snapshot).toMatchObject({
      handCount: 2,
      oneHandCoverage: 1,
      twoHandCoverage: 0.5,
      frameAgeP50: 100,
      frameAgeP95: 100,
      state: "ready",
    });
  });
});

function frame(
  frameId: number,
  handedness: readonly ("left" | "right")[],
  captureTimeMs: number,
): HandTrackingFrame {
  return {
    frameId,
    captureTimeMs,
    callbackTimeMs: captureTimeMs + 10,
    workerReceivedTimeMs: captureTimeMs + 20,
    inferenceStartedTimeMs: captureTimeMs + 25,
    inferenceCompletedTimeMs: captureTimeMs + 100,
    hands: handedness.map((side, detectionIndex) => ({
      detectionIndex,
      handedness: side,
      handednessScore: 0.9,
      landmarks2D: [],
      landmarksWorld: [],
    })),
  };
}
