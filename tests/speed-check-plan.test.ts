import { describe, expect, it } from "vitest";
import {
  remainingSpeedCheckMs,
  requiresCameraRestart,
  resolveSpeedCheckMeasureOverrideMs,
  speedCheckSteps,
  totalSpeedCheckDurationMs,
  SPEED_CHECK_MEASURE_MS_MAX,
  SPEED_CHECK_MEASURE_MS_MIN,
  SPEED_CHECK_STEPS,
  SPEED_CHECK_STEP_SETUP_MS,
  SPEED_CHECK_WARMUP_MS,
  warmupMsForOverride,
  type SpeedCheckStep,
} from "../src/experiments/speed-check-plan";

describe("speed check plan", () => {
  it("numbers the steps in order and repeats the first setting last", () => {
    expect(SPEED_CHECK_STEPS.map(({ ordinal }) => ordinal))
      .toEqual(Array.from({ length: SPEED_CHECK_STEPS.length }, (_, index) => index + 1));
    expect(new Set(SPEED_CHECK_STEPS.map((step) => step.id)).size).toBe(SPEED_CHECK_STEPS.length);
    expect(new Set(SPEED_CHECK_STEPS.map((step) => step.profile.tracking.modelId)).size).toBe(1);
    // The repeat measures drift over the run, so it must use exactly the first step's settings.
    const setting = (step: SpeedCheckStep) => ({
      profile: step.profile.id,
      frameSourceOverride: step.frameSourceOverride,
      pendingPolicy: step.pendingPolicy,
    });
    const [first] = SPEED_CHECK_STEPS;
    const last = SPEED_CHECK_STEPS.at(-1);
    expect(last?.repeatOfOrdinal).toBe(1);
    expect(setting(last!)).toEqual(setting(first!));
    expect(SPEED_CHECK_STEPS.slice(0, -1).every(({ repeatOfOrdinal }) => repeatOfOrdinal === null)).toBe(true);
  });

  it("keeps the whole run near two minutes", () => {
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
