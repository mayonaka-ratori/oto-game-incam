import { describe, expect, it } from "vitest";
import {
  remainingSpeedCheckMs,
  requiresCameraRestart,
  resolveSpeedCheckMeasureOverrideMs,
  speedCheckSteps,
  totalSpeedCheckDurationMs,
  SPEED_CHECK_MEASURE_MS,
  SPEED_CHECK_MEASURE_MS_MAX,
  SPEED_CHECK_MEASURE_MS_MIN,
  SPEED_CHECK_REPEAT_MEASURE_MS,
  SPEED_CHECK_STEPS,
  SPEED_CHECK_STEP_SETUP_MS,
  SPEED_CHECK_WARMUP_MS,
  warmupMsForOverride,
} from "../src/experiments/speed-check-plan";

describe("speed check plan", () => {
  it("measures the six comparisons in order and repeats the first one last", () => {
    expect(SPEED_CHECK_STEPS.map((step) => ({
      ordinal: step.ordinal,
      id: step.id,
      delegate: step.profile.tracking.preferredDelegate,
      width: step.profile.camera.width,
      height: step.profile.camera.height,
      frameSourceOverride: step.frameSourceOverride,
      pendingPolicy: step.pendingPolicy,
      repeatOfOrdinal: step.repeatOfOrdinal,
    }))).toEqual([
      { ordinal: 1, id: "gpu-640-auto-hold", delegate: "GPU", width: 640, height: 480, frameSourceOverride: "auto", pendingPolicy: "hold", repeatOfOrdinal: null },
      { ordinal: 2, id: "gpu-640-auto-drop", delegate: "GPU", width: 640, height: 480, frameSourceOverride: "auto", pendingPolicy: "drop", repeatOfOrdinal: null },
      { ordinal: 3, id: "gpu-640-rvfc-hold", delegate: "GPU", width: 640, height: 480, frameSourceOverride: "rvfc", pendingPolicy: "hold", repeatOfOrdinal: null },
      { ordinal: 4, id: "cpu-640-auto-hold", delegate: "CPU", width: 640, height: 480, frameSourceOverride: "auto", pendingPolicy: "hold", repeatOfOrdinal: null },
      { ordinal: 5, id: "cpu-640-rvfc-hold", delegate: "CPU", width: 640, height: 480, frameSourceOverride: "rvfc", pendingPolicy: "hold", repeatOfOrdinal: null },
      { ordinal: 6, id: "gpu-320-auto-hold", delegate: "GPU", width: 320, height: 240, frameSourceOverride: "auto", pendingPolicy: "hold", repeatOfOrdinal: null },
      { ordinal: 7, id: "gpu-640-auto-hold-repeat", delegate: "GPU", width: 640, height: 480, frameSourceOverride: "auto", pendingPolicy: "hold", repeatOfOrdinal: 1 },
    ]);
    expect(new Set(SPEED_CHECK_STEPS.map((step) => step.id)).size).toBe(SPEED_CHECK_STEPS.length);
    expect(new Set(SPEED_CHECK_STEPS.map((step) => step.profile.tracking.modelId)).size).toBe(1);
  });

  it("keeps the repeat short and the whole run near two minutes", () => {
    const last = SPEED_CHECK_STEPS.at(-1);
    expect(last?.measureMs).toBe(SPEED_CHECK_REPEAT_MEASURE_MS);
    expect(SPEED_CHECK_STEPS[0]?.measureMs).toBe(SPEED_CHECK_MEASURE_MS);
    expect(SPEED_CHECK_STEPS[0]?.warmupMs).toBe(SPEED_CHECK_WARMUP_MS);
    const totalMs = totalSpeedCheckDurationMs(SPEED_CHECK_STEPS);
    expect(totalMs).toBeGreaterThan(100_000);
    expect(totalMs).toBeLessThan(140_000);
  });

  it("restarts the camera only when the requested resolution changes", () => {
    const [first, second, , , , small] = SPEED_CHECK_STEPS;
    expect(first).toBeDefined();
    expect(requiresCameraRestart(null, first!)).toBe(true);
    expect(requiresCameraRestart(first!, second!)).toBe(false);
    expect(requiresCameraRestart(second!, small!)).toBe(true);
    expect(requiresCameraRestart(small!, first!)).toBe(true);
  });

  it("shortens every step only for a usable ?speedcheckMs value", () => {
    expect(resolveSpeedCheckMeasureOverrideMs("")).toBeNull();
    expect(resolveSpeedCheckMeasureOverrideMs("?speedcheckMs=abc")).toBeNull();
    expect(resolveSpeedCheckMeasureOverrideMs(`?speedcheckMs=${SPEED_CHECK_MEASURE_MS_MIN - 1}`)).toBeNull();
    expect(resolveSpeedCheckMeasureOverrideMs(`?speedcheckMs=${SPEED_CHECK_MEASURE_MS_MAX + 1}`)).toBeNull();
    expect(resolveSpeedCheckMeasureOverrideMs("?speedcheckMs=1500")).toBe(1500);

    expect(speedCheckSteps(null)).toBe(SPEED_CHECK_STEPS);
    const shortened = speedCheckSteps(1500);
    expect(shortened).toHaveLength(SPEED_CHECK_STEPS.length);
    expect(new Set(shortened.map((step) => step.measureMs))).toEqual(new Set([1500]));
    expect(new Set(shortened.map((step) => step.warmupMs))).toEqual(new Set([375]));
    expect(warmupMsForOverride(200)).toBe(100);
    expect(warmupMsForOverride(60_000)).toBe(SPEED_CHECK_WARMUP_MS);
  });

  it("counts down from the current step without going below zero", () => {
    const steps = speedCheckSteps(1000);
    const perStep = SPEED_CHECK_STEP_SETUP_MS + 250 + 1000;
    expect(remainingSpeedCheckMs(steps, 0, 0)).toBe(perStep * steps.length);
    expect(remainingSpeedCheckMs(steps, 1, 0)).toBe(perStep * (steps.length - 1));
    expect(remainingSpeedCheckMs(steps, steps.length - 1, perStep * 5)).toBe(0);
  });
});
