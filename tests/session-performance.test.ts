import { describe, expect, it } from "vitest";
import { FixedBucketHistogram } from "../src/metrics/statistics";
import {
  PerformanceScopeAccumulator,
  type PerformanceScopeCounters,
} from "../src/metrics/session-performance";
import type { SchedulerSnapshot } from "../src/camera/latest-frame-scheduler";
import type { HandTrackingFrame } from "../src/tracking/tracking-types";

function scheduler(
  captured: number,
  completed: number,
  replaced: number,
  errored: number,
  dropped = 0,
): SchedulerSnapshot {
  return {
    captured,
    sent: captured,
    completed,
    replaced,
    dropped,
    errored,
    inFlight: 0,
    pending: 0,
    pendingPolicy: dropped === 0 ? "hold" : "drop",
  };
}

function counters(
  captured: number,
  cameraFrames: number,
  cameraElapsedMs: number,
  usedJsHeapSizeBytes: number | null = null,
): PerformanceScopeCounters {
  return {
    scheduler: scheduler(captured, captured, 0, 0),
    cameraFrames,
    cameraElapsedMs,
    usedJsHeapSizeBytes,
  };
}

function frame(frameId: number, captureTimeMs: number, inferenceMs: number, hands: number): HandTrackingFrame {
  return {
    frameId,
    captureTimeMs,
    callbackTimeMs: captureTimeMs + 5,
    workerReceivedTimeMs: captureTimeMs + 12,
    inferenceStartedTimeMs: captureTimeMs + 20,
    inferenceCompletedTimeMs: captureTimeMs + 20 + inferenceMs,
    hands: Array.from({ length: hands }, (_, detectionIndex) => ({
      detectionIndex,
      handedness: detectionIndex === 0 ? "left" as const : "right" as const,
      handednessScore: 0.9,
      landmarks2D: [],
      landmarksWorld: [],
    })),
  };
}

describe("FixedBucketHistogram", () => {
  it("returns null until a sample arrives", () => {
    const histogram = new FixedBucketHistogram();
    expect(histogram.quantile(0.5)).toBeNull();
    expect(histogram.maximum).toBeNull();
    expect(histogram.count).toBe(0);
  });

  it("reports quantiles at the 1ms bucket edge and keeps the exact maximum", () => {
    const histogram = new FixedBucketHistogram();
    for (let value = 1; value <= 100; value += 1) histogram.add(value + 0.4);

    expect(histogram.count).toBe(100);
    expect(histogram.quantile(0.5)).toBe(51);
    expect(histogram.quantile(0.95)).toBe(96);
    expect(histogram.maximum).toBeCloseTo(100.4, 5);
    expect(histogram.minimum).toBeCloseTo(1.4, 5);
  });

  it("counts a sample beyond the last bucket without losing the maximum", () => {
    const histogram = new FixedBucketHistogram(1, 10);
    histogram.add(2);
    histogram.add(5_000);

    expect(histogram.count).toBe(2);
    expect(histogram.maximum).toBe(5_000);
    expect(histogram.quantile(1)).toBe(5_000);
  });

  it("ignores values that are not finite", () => {
    const histogram = new FixedBucketHistogram();
    histogram.add(Number.NaN);
    histogram.add(Number.POSITIVE_INFINITY);

    expect(histogram.count).toBe(0);
  });
});

describe("PerformanceScopeAccumulator", () => {
  it("summarizes a whole scope from constant memory", () => {
    const accumulator = new PerformanceScopeAccumulator(1_000, counters(100, 300, 10_000, 5_000_000));
    accumulator.addResult(frame(1, 0, 20, 2), 1_000);
    accumulator.addResult(frame(2, 33, 40, 1), 1_033);
    accumulator.addResult(frame(3, 66, 60, 0), 1_066);
    accumulator.addResult(frame(4, 99, 300, 2), 1_099);
    accumulator.addLongTask(120);
    accumulator.addLongTask(80);
    accumulator.close(2_000, counters(220, 330, 11_000, 6_000_000));

    const summary = accumulator.summary(9_999, counters(999, 999, 99_999), true);

    expect(summary).toMatchObject({
      startedAtMs: 1_000,
      endedAtMs: 2_000,
      durationMs: 1_000,
      open: false,
      trackingResultCount: 4,
      // Nearest rank over 20/40/60/300ms, not the interpolation the recent-window values use.
      inferenceP50Ms: 60,
      inferenceMaxMs: 300,
      oneHandCoverage: 0.75,
      twoHandCoverage: 0.5,
      usedJsHeapSizeAtEndBytes: 6_000_000,
    });
    // 3 intervals over 99ms of results.
    expect(summary.trackingHz).toBeCloseTo(3 * 1_000 / 99, 5);
    // 30 camera frames in 1 second.
    expect(summary.cameraFrameCount).toBe(30);
    expect(summary.cameraFps).toBeCloseTo(30, 5);
    expect(summary.scheduler).toEqual({ captured: 120, completed: 120, replaced: 0, dropped: 0, errored: 0 });
    expect(summary.longTask).toEqual({ supported: true, count: 2, totalMs: 200, maxMs: 120, longest: [] });
  });

  it("keeps only the three longest tasks, with their times and attribution", () => {
    const accumulator = new PerformanceScopeAccumulator(0, counters(0, 0, 0));
    const task = (startTimeMs: number, durationMs: number, attributionName: string | null = null) => ({
      startTimeMs,
      durationMs,
      attributionName,
      attributionContainerType: attributionName === null ? null : "window",
    });
    // The 2.8-second stall of block 1 must be findable by its time, whatever came before it.
    for (const record of [
      task(1_000, 60),
      task(2_000, 2_796, "self"),
      task(3_000, 55),
      task(4_000, 900, "iframe"),
      task(5_000, 51),
      task(6_000, 300),
    ]) {
      accumulator.addLongTask(record.durationMs, record);
    }

    const summary = accumulator.summary(9_999, counters(0, 0, 0), true);

    expect(summary.longTask).toMatchObject({ supported: true, count: 6, maxMs: 2_796 });
    expect(summary.longTask.totalMs).toBe(60 + 2_796 + 55 + 900 + 51 + 300);
    expect(summary.longTask.longest).toEqual([
      { startTimeMs: 2_000, durationMs: 2_796, attributionName: "self", attributionContainerType: "window" },
      { startTimeMs: 4_000, durationMs: 900, attributionName: "iframe", attributionContainerType: "window" },
      { startTimeMs: 6_000, durationMs: 300, attributionName: null, attributionContainerType: null },
    ]);
  });

  it("records the range of tracking gap tolerances the judgment used", () => {
    const accumulator = new PerformanceScopeAccumulator(0, counters(0, 0, 0));
    expect(accumulator.summary(100, counters(0, 0, 0), false).trackingGapToleranceMs).toBeNull();

    for (const toleranceMs of [150, 250, 197.5, 400]) accumulator.addTrackingGapTolerance(toleranceMs);
    accumulator.close(500, counters(0, 0, 0));
    accumulator.addTrackingGapTolerance(1_000);

    expect(accumulator.summary(900, counters(0, 0, 0), false).trackingGapToleranceMs)
      .toEqual({ min: 150, max: 400 });
  });

  it("summarizes a still-open scope up to now and ignores later results", () => {
    const accumulator = new PerformanceScopeAccumulator(0, counters(0, 0, 0));
    accumulator.addResult(frame(1, 0, 10, 2), 0);
    const open = accumulator.summary(500, counters(15, 15, 500), false);

    expect(open).toMatchObject({ open: true, endedAtMs: 500, durationMs: 500, trackingResultCount: 1 });
    expect(open.longTask).toEqual({ supported: false, count: null, totalMs: null, maxMs: null, longest: [] });

    accumulator.close(500, counters(15, 15, 500));
    accumulator.addResult(frame(2, 100, 10, 2), 600);

    expect(accumulator.summary(900, counters(30, 30, 900), false).trackingResultCount).toBe(1);
  });

  it("keeps counters null when the screen has no camera or scheduler values yet", () => {
    const empty: PerformanceScopeCounters = {
      scheduler: null,
      cameraFrames: null,
      cameraElapsedMs: null,
      usedJsHeapSizeBytes: null,
    };
    const accumulator = new PerformanceScopeAccumulator(0, empty);
    const summary = accumulator.summary(100, empty, false);

    expect(summary).toMatchObject({
      trackingResultCount: 0,
      trackingHz: null,
      inferenceP50Ms: null,
      cameraFps: null,
      cameraFrameCount: null,
      scheduler: null,
      oneHandCoverage: null,
      usedJsHeapSizeAtEndBytes: null,
    });
  });
});
