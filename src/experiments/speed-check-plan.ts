import type { FrameSourceOverride } from "../camera/create-frame-source";
import type { PendingFramePolicy } from "../camera/latest-frame-scheduler";
import {
  findTrackingExperimentProfile,
  type TrackingExperimentProfile,
} from "./tracking-experiment-profile";

/**
 * The ordered settings the automatic speed check measures (`?mode=speedcheck`).
 *
 * Why this file exists: the Pixel 10 Pro XL runs one hand inference in about 100ms and updates the
 * hand position about 9 times a second, while an iPhone reaches 27ms and about 29 times a second
 * (docs/18 の2.2). Three causes are still open — a slow GPU delegate, a slow
 * `MediaStreamTrackProcessor` capture, and a pending frame that is already about 80ms old when the
 * inference starts. Measuring them by hand meant re-opening a URL with one changed parameter and
 * running 20 trials each (docs/18 の5.5), which is a lot of work for a tester. Here one tap walks
 * the same comparisons automatically.
 *
 * Every step keeps the latest-frame-only rule: in-flight and pending stay at one or less
 * (docs/02 の9.2). Nothing here changes what the normal screen does.
 */
export interface SpeedCheckStep {
  /** 1-based position in the run. The tester screen shows this number. */
  readonly ordinal: number;
  readonly id: string;
  /** Japanese one-liner naming the combination. Written into the result JSON. */
  readonly label: string;
  readonly profile: TrackingExperimentProfile;
  readonly frameSourceOverride: FrameSourceOverride;
  readonly pendingPolicy: PendingFramePolicy;
  /** Set on the closing re-measurement, so a reader can compare it with the first run. */
  readonly repeatOfOrdinal: number | null;
  /** Discarded: the first results of a fresh Worker include its warm-up. */
  readonly warmupMs: number;
  /** Collected into one PerformanceScopeAccumulator. */
  readonly measureMs: number;
}

/** Discarded at the start of every step. */
export const SPEED_CHECK_WARMUP_MS = 3_000;
/** Collected for every step. */
export const SPEED_CHECK_MEASURE_MS = 12_000;
/** The closing repeat is shorter: it only has to show whether the device slowed down from heat. */
export const SPEED_CHECK_REPEAT_WARMUP_MS = 2_000;
export const SPEED_CHECK_REPEAT_MEASURE_MS = 6_000;

/**
 * Rough cost of restarting the Worker (and, where the resolution changes, the camera) before a
 * step. Used only for the "about N seconds left" hint, never as a source of measured time.
 */
export const SPEED_CHECK_STEP_SETUP_MS = 2_000;

const GPU_640 = findTrackingExperimentProfile("gpu-640x480-30");
const CPU_640 = findTrackingExperimentProfile("cpu-640x480-30");

/**
 * 320×240 is only ever requested here. A camera that will not deliver it returns something else,
 * and the step records the resolution that actually arrived.
 */
const GPU_320: TrackingExperimentProfile = {
  id: "gpu-320x240-30",
  label: "速度チェック · GPU · 320×240 · 30fps",
  purpose: "速度チェックで取得解像度だけを下げた比較条件です。画質は未検証です。",
  camera: { width: 320, height: 240, frameRateIdeal: 30, frameRateMin: 30 },
  tracking: GPU_640.tracking,
};

interface StepSeed {
  readonly id: string;
  readonly label: string;
  readonly profile: TrackingExperimentProfile;
  readonly frameSourceOverride: FrameSourceOverride;
  readonly pendingPolicy: PendingFramePolicy;
  readonly repeatOfOrdinal: number | null;
  readonly warmupMs: number;
  readonly measureMs: number;
}

/** Add or remove a comparison here; nothing else in the speed check knows the list's length. */
const STEP_SEEDS: readonly StepSeed[] = [
  {
    id: "gpu-640-auto-hold",
    label: "GPU・640×480・取り込み自動・待機枠あり（現在の既定）",
    profile: GPU_640,
    frameSourceOverride: "auto",
    pendingPolicy: "hold",
    repeatOfOrdinal: null,
    warmupMs: SPEED_CHECK_WARMUP_MS,
    measureMs: SPEED_CHECK_MEASURE_MS,
  },
  {
    id: "gpu-640-auto-drop",
    label: "GPU・640×480・取り込み自動・待機枠なし",
    profile: GPU_640,
    frameSourceOverride: "auto",
    pendingPolicy: "drop",
    repeatOfOrdinal: null,
    warmupMs: SPEED_CHECK_WARMUP_MS,
    measureMs: SPEED_CHECK_MEASURE_MS,
  },
  {
    id: "gpu-640-rvfc-hold",
    label: "GPU・640×480・rvfc取り込み・待機枠あり",
    profile: GPU_640,
    frameSourceOverride: "rvfc",
    pendingPolicy: "hold",
    repeatOfOrdinal: null,
    warmupMs: SPEED_CHECK_WARMUP_MS,
    measureMs: SPEED_CHECK_MEASURE_MS,
  },
  {
    id: "cpu-640-auto-hold",
    label: "CPU・640×480・取り込み自動・待機枠あり",
    profile: CPU_640,
    frameSourceOverride: "auto",
    pendingPolicy: "hold",
    repeatOfOrdinal: null,
    warmupMs: SPEED_CHECK_WARMUP_MS,
    measureMs: SPEED_CHECK_MEASURE_MS,
  },
  {
    id: "cpu-640-rvfc-hold",
    label: "CPU・640×480・rvfc取り込み・待機枠あり",
    profile: CPU_640,
    frameSourceOverride: "rvfc",
    pendingPolicy: "hold",
    repeatOfOrdinal: null,
    warmupMs: SPEED_CHECK_WARMUP_MS,
    measureMs: SPEED_CHECK_MEASURE_MS,
  },
  {
    id: "gpu-320-auto-hold",
    label: "GPU・320×240・取り込み自動・待機枠あり",
    profile: GPU_320,
    frameSourceOverride: "auto",
    pendingPolicy: "hold",
    repeatOfOrdinal: null,
    warmupMs: SPEED_CHECK_WARMUP_MS,
    measureMs: SPEED_CHECK_MEASURE_MS,
  },
  {
    id: "gpu-640-auto-hold-repeat",
    label: "1番の再測定（発熱で遅くなっていないかを見る）",
    profile: GPU_640,
    frameSourceOverride: "auto",
    pendingPolicy: "hold",
    repeatOfOrdinal: 1,
    warmupMs: SPEED_CHECK_REPEAT_WARMUP_MS,
    measureMs: SPEED_CHECK_REPEAT_MEASURE_MS,
  },
];

export const SPEED_CHECK_STEPS: readonly SpeedCheckStep[] = STEP_SEEDS.map((seed, index) => ({
  ordinal: index + 1,
  ...seed,
}));

/** Guard rails for `?speedcheckMs=`. Below the lower bound nothing measurable comes out. */
export const SPEED_CHECK_MEASURE_MS_MIN = 200;
export const SPEED_CHECK_MEASURE_MS_MAX = 60_000;

/**
 * `?speedcheckMs=1500` shortens every step so the browser test can walk the whole run. Anything
 * missing or out of range keeps the normal durations, so a tester's URL is never affected.
 */
export function resolveSpeedCheckMeasureOverrideMs(search: string): number | null {
  const raw = new URLSearchParams(search).get("speedcheckMs");
  if (raw === null) return null;
  const value = Number.parseInt(raw.trim(), 10);
  if (!Number.isInteger(value)) return null;
  if (value < SPEED_CHECK_MEASURE_MS_MIN || value > SPEED_CHECK_MEASURE_MS_MAX) return null;
  return value;
}

/** The warm-up follows the shortened measurement, but never grows past the normal one. */
export function warmupMsForOverride(measureMsOverride: number): number {
  return Math.min(SPEED_CHECK_WARMUP_MS, Math.max(100, Math.round(measureMsOverride / 4)));
}

export function speedCheckSteps(measureMsOverride: number | null): readonly SpeedCheckStep[] {
  if (measureMsOverride === null) return SPEED_CHECK_STEPS;
  const warmupMs = warmupMsForOverride(measureMsOverride);
  return SPEED_CHECK_STEPS.map((step) => ({ ...step, warmupMs, measureMs: measureMsOverride }));
}

/** Setup, warm-up and measurement of every step. An estimate for the screen, not a measurement. */
export function totalSpeedCheckDurationMs(steps: readonly SpeedCheckStep[]): number {
  return steps.reduce(
    (total, step) => total + SPEED_CHECK_STEP_SETUP_MS + step.warmupMs + step.measureMs,
    0,
  );
}

/**
 * Seconds still to go, for the "about N seconds left" line. `elapsedInStepMs` is measured with
 * performance.now(); the display timer only decides how often this is called.
 */
export function remainingSpeedCheckMs(
  steps: readonly SpeedCheckStep[],
  currentIndex: number,
  elapsedInStepMs: number,
): number {
  let remaining = 0;
  for (const [index, step] of steps.entries()) {
    if (index < currentIndex) continue;
    const stepTotal = SPEED_CHECK_STEP_SETUP_MS + step.warmupMs + step.measureMs;
    remaining += index === currentIndex ? Math.max(0, stepTotal - elapsedInStepMs) : stepTotal;
  }
  return remaining;
}

/** Whether the camera has to be reopened between two steps. Only the resolution forces it. */
export function requiresCameraRestart(
  previous: SpeedCheckStep | null,
  next: SpeedCheckStep,
): boolean {
  if (previous === null) return true;
  return previous.profile.camera.width !== next.profile.camera.width
    || previous.profile.camera.height !== next.profile.camera.height
    || previous.profile.camera.frameRateIdeal !== next.profile.camera.frameRateIdeal
    || previous.profile.camera.frameRateMin !== next.profile.camera.frameRateMin;
}
