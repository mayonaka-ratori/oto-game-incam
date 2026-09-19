import { describe, expect, it } from "vitest";
import { SPEED_CHECK_STEPS, type SpeedCheckStep } from "../src/experiments/speed-check-plan";
import type { PerformanceScopeSummary } from "../src/metrics/session-performance";
import {
  buildSpeedCheckReport,
  createSpeedCheckRunId,
  describeFastestSpeedCheckStep,
  handsVisibleEnough,
  HANDS_VISIBLE_MIN_TWO_HAND_COVERAGE,
  selectFastestSpeedCheckStep,
  SPEED_CHECK_SCHEMA,
  SPEED_CHECK_SCHEMA_VERSION,
  toSpeedCheckStepResult,
  type SpeedCheckActualSettings,
  type SpeedCheckMeasurement,
} from "../src/metrics/speed-check-report";

function summary(overrides: Partial<PerformanceScopeSummary> = {}): PerformanceScopeSummary {
  return {
    startedAtMs: 1_000,
    endedAtMs: 13_000,
    durationMs: 12_000,
    open: false,
    trackingResultCount: 120,
    trackingHz: 10,
    inferenceP50Ms: 100,
    inferenceP95Ms: 135,
    inferenceMaxMs: 180,
    frameAgeP50Ms: 179,
    frameAgeP95Ms: 233,
    frameAgeMaxMs: 280,
    callbackToWorkerP50Ms: 80,
    workerWaitP50Ms: 75,
    cameraFrameCount: 310,
    cameraFps: 25.8,
    oneHandCoverage: 1,
    twoHandCoverage: 1,
    scheduler: { captured: 310, completed: 120, replaced: 0, dropped: 0, errored: 0 },
    longTask: { supported: true, count: 2, totalMs: 2_854, maxMs: 2_796, longest: [] },
    usedJsHeapSizeAtEndBytes: 14_800_000,
    trackingGapToleranceMs: null,
    ...overrides,
  };
}

const actual: SpeedCheckActualSettings = {
  delegate: "GPU",
  fallbackReason: null,
  packageId: "@mediapipe/tasks-vision@0.10.35",
  modelId: "hand_landmarker/full/float16/1#fbc2a30080c3",
  frameSource: "MediaStreamTrackProcessor",
  cameraWidth: 640,
  cameraHeight: 480,
  cameraFrameRate: 30,
};

function measurement(
  step: SpeedCheckStep,
  overrides: Partial<PerformanceScopeSummary> = {},
  error: string | null = null,
): SpeedCheckMeasurement {
  return {
    step,
    startedAtIso: "2026-09-20T00:00:00.000Z",
    endedAtIso: "2026-09-20T00:00:12.000Z",
    summary: summary(overrides),
    actual,
    error,
  };
}

const [step1, step2, step3] = SPEED_CHECK_STEPS as readonly [SpeedCheckStep, SpeedCheckStep, SpeedCheckStep, ...SpeedCheckStep[]];

describe("speed check result rows", () => {
  it("keeps both the requested setting and what the browser actually did", () => {
    const row = toSpeedCheckStepResult(measurement(step1));
    expect(row).toMatchObject({
      ordinal: 1,
      id: "gpu-640-auto-hold",
      requested: {
        experimentProfileId: "gpu-640x480-30",
        delegate: "GPU",
        cameraWidth: 640,
        frameSourceOverride: "auto",
        pendingPolicy: "hold",
        repeatOfOrdinal: null,
      },
      actual: { delegate: "GPU", frameSource: "MediaStreamTrackProcessor", cameraWidth: 640 },
      trackingHz: 10,
      inferenceP50Ms: 100,
      frameAgeP95Ms: 233,
      cameraFps: 25.8,
      scheduler: { captured: 310, completed: 120, replaced: 0, dropped: 0, errored: 0 },
      longTask: { supported: true, count: 2, totalMs: 2_854, maxMs: 2_796 },
      handsVisibleEnough: true,
      error: null,
    });
    // The three longest long tasks stay in the session file, not in this one.
    expect(row.longTask).not.toHaveProperty("longest");
  });

  it("marks a step where both hands were rarely in view", () => {
    expect(handsVisibleEnough(null)).toBe(false);
    expect(handsVisibleEnough(HANDS_VISIBLE_MIN_TWO_HAND_COVERAGE)).toBe(true);
    expect(handsVisibleEnough(HANDS_VISIBLE_MIN_TWO_HAND_COVERAGE - 0.01)).toBe(false);
    expect(toSpeedCheckStepResult(measurement(step1, { twoHandCoverage: 0.2 })).handsVisibleEnough)
      .toBe(false);
  });
});

describe("fastest step", () => {
  it("ignores steps measured without both hands, and steps that failed", () => {
    const rows = [
      toSpeedCheckStepResult(measurement(step1, { trackingHz: 9.6 })),
      toSpeedCheckStepResult(measurement(step2, { trackingHz: 40, twoHandCoverage: 0.1 })),
      toSpeedCheckStepResult(measurement(step3, { trackingHz: 21.44 }, "初期化に失敗しました")),
    ];
    expect(selectFastestSpeedCheckStep(rows)).toMatchObject({ ordinal: 1, trackingHz: 9.6 });
  });

  it("falls back to every step when none of them saw both hands", () => {
    const rows = [
      toSpeedCheckStepResult(measurement(step1, { trackingHz: 9.6, twoHandCoverage: 0 })),
      toSpeedCheckStepResult(measurement(step2, { trackingHz: 12, twoHandCoverage: 0 })),
    ];
    expect(selectFastestSpeedCheckStep(rows)).toMatchObject({ ordinal: 2, trackingHz: 12 });
  });

  it("returns nothing when no step produced a rate", () => {
    const rows = [toSpeedCheckStepResult(measurement(step1, { trackingHz: null }))];
    expect(selectFastestSpeedCheckStep(rows)).toBeNull();
    expect(describeFastestSpeedCheckStep(null)).toBe("いちばん速かった設定: 測れませんでした");
  });

  it("writes the one line the tester reads", () => {
    expect(describeFastestSpeedCheckStep({
      ordinal: 3,
      id: "gpu-640-rvfc-hold",
      label: "GPU・640×480・rvfc取り込み・待機枠あり",
      trackingHz: 21.44,
    })).toBe("いちばん速かった設定: 3番（毎秒 21.4 回）");
  });
});

describe("speed check report", () => {
  const base = {
    runId: "speedcheck-20260920000000000",
    createdAtIso: "2026-09-20T00:00:00.000Z",
    appBuildId: "test-build",
    pageUrl: "https://example.test/?mode=speedcheck",
    measureMsOverride: null,
    plannedStepCount: SPEED_CHECK_STEPS.length,
    device: null,
    viewport: { width: 390, height: 844, devicePixelRatio: 3, orientation: "portrait-primary" },
    longTaskSupported: true,
  } as const;

  it("names the schema, counts the steps and picks the fastest", () => {
    const report = buildSpeedCheckReport({
      ...base,
      abortReason: null,
      measurements: [
        measurement(step1, { trackingHz: 9.6 }),
        measurement(step2, { trackingHz: 14.2 }),
      ],
    });
    expect(report.schema).toBe(SPEED_CHECK_SCHEMA);
    expect(report.schemaVersion).toBe(SPEED_CHECK_SCHEMA_VERSION);
    expect(report.completion).toEqual({
      status: "completed",
      abortReason: null,
      plannedStepCount: SPEED_CHECK_STEPS.length,
      measuredStepCount: 2,
    });
    expect(report.steps).toHaveLength(2);
    expect(report.fastestStep).toMatchObject({ ordinal: 2, trackingHz: 14.2 });
    expect(report.viewport.orientation).toBe("portrait-primary");
  });

  it("keeps the results measured so far when the run was stopped", () => {
    const report = buildSpeedCheckReport({
      ...base,
      abortReason: "計測中に画面が表示されなくなりました。",
      measurements: [measurement(step1)],
    });
    expect(report.completion).toMatchObject({
      status: "aborted",
      abortReason: "計測中に画面が表示されなくなりました。",
      measuredStepCount: 1,
    });
    expect(report.steps).toHaveLength(1);
  });

  it("names the file after the time, like a P1 session id", () => {
    expect(createSpeedCheckRunId(new Date("2026-09-20T12:34:56.789Z")))
      .toBe("speedcheck-20260920123456789");
  });
});
