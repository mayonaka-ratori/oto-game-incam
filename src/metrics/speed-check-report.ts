import type { TrackingFrameSourceKind } from "../camera/frame-source";
import type { FrameSourceOverride } from "../camera/create-frame-source";
import type { PendingFramePolicy } from "../camera/latest-frame-scheduler";
import type { SpeedCheckStep } from "../experiments/speed-check-plan";
import type { TrackingDelegate } from "../tracking/tracking-types";
import type { DeviceInfo } from "./device-info";
import type {
  PerformanceScopeSummary,
  SchedulerDeltaSummary,
} from "./session-performance";

/**
 * The one file the automatic speed check saves. It holds derived numbers only: no camera image, no
 * audio, no landmarks. Nothing is sent anywhere — the tester saves the file and sends it on.
 */
export const SPEED_CHECK_SCHEMA = "oto-motion-speed-check";
export const SPEED_CHECK_SCHEMA_VERSION = 1;

/**
 * Below this share of frames with both hands, a step is marked `handsVisibleEnough: false`. With
 * no hands in view the inference has less to do and looks faster than it is, so a step measured
 * without hands must be recognisable later. The measurement itself is never stopped.
 */
export const HANDS_VISIBLE_MIN_TWO_HAND_COVERAGE = 0.6;

export interface SpeedCheckRequestedSettings {
  readonly experimentProfileId: string;
  readonly delegate: TrackingDelegate;
  readonly cameraWidth: number;
  readonly cameraHeight: number;
  readonly frameRateIdeal: number;
  readonly frameRateMin: number;
  readonly frameSourceOverride: FrameSourceOverride;
  readonly pendingPolicy: PendingFramePolicy;
  readonly repeatOfOrdinal: number | null;
  readonly warmupMs: number;
  readonly measureMs: number;
}

/** What the browser actually gave us. Every field is null where it could not be read. */
export interface SpeedCheckActualSettings {
  readonly delegate: TrackingDelegate | null;
  /** Why MediaPipe fell back, for example a GPU delegate this device refused. */
  readonly fallbackReason: string | null;
  readonly packageId: string | null;
  readonly modelId: string | null;
  readonly frameSource: TrackingFrameSourceKind | null;
  readonly cameraWidth: number | null;
  readonly cameraHeight: number | null;
  readonly cameraFrameRate: number | null;
}

export interface SpeedCheckLongTaskSummary {
  readonly supported: boolean;
  readonly count: number | null;
  readonly totalMs: number | null;
  readonly maxMs: number | null;
}

export interface SpeedCheckStepResult {
  readonly ordinal: number;
  readonly id: string;
  readonly label: string;
  readonly requested: SpeedCheckRequestedSettings;
  readonly actual: SpeedCheckActualSettings;
  readonly startedAtIso: string;
  readonly endedAtIso: string;
  readonly durationMs: number;
  readonly trackingResultCount: number;
  /** Hand position updates per second. The headline number of the whole check. */
  readonly trackingHz: number | null;
  readonly inferenceP50Ms: number | null;
  readonly inferenceP95Ms: number | null;
  readonly inferenceMaxMs: number | null;
  readonly frameAgeP50Ms: number | null;
  readonly frameAgeP95Ms: number | null;
  readonly callbackToWorkerP50Ms: number | null;
  readonly workerWaitP50Ms: number | null;
  readonly cameraFrameCount: number | null;
  readonly cameraFps: number | null;
  readonly oneHandCoverage: number | null;
  readonly twoHandCoverage: number | null;
  readonly handsVisibleEnough: boolean;
  readonly scheduler: SchedulerDeltaSummary | null;
  readonly longTask: SpeedCheckLongTaskSummary;
  readonly usedJsHeapSizeAtEndBytes: number | null;
  readonly error: string | null;
}

export interface SpeedCheckViewport {
  readonly width: number | null;
  readonly height: number | null;
  readonly devicePixelRatio: number | null;
  readonly orientation: string | null;
}

export interface SpeedCheckCompletion {
  readonly status: "completed" | "aborted";
  /** Japanese reason, only when the run was stopped early. */
  readonly abortReason: string | null;
  readonly plannedStepCount: number;
  readonly measuredStepCount: number;
}

export interface SpeedCheckFastestStep {
  readonly ordinal: number;
  readonly id: string;
  readonly label: string;
  readonly trackingHz: number;
}

export interface SpeedCheckReport {
  readonly schema: typeof SPEED_CHECK_SCHEMA;
  readonly schemaVersion: typeof SPEED_CHECK_SCHEMA_VERSION;
  readonly runId: string;
  readonly createdAtIso: string;
  readonly appBuildId: string;
  readonly pageUrl: string;
  readonly measureMsOverride: number | null;
  readonly completion: SpeedCheckCompletion;
  readonly device: DeviceInfo | null;
  readonly viewport: SpeedCheckViewport;
  readonly longTaskSupported: boolean;
  readonly steps: readonly SpeedCheckStepResult[];
  readonly fastestStep: SpeedCheckFastestStep | null;
}

/** One finished step, before it becomes a result row. */
export interface SpeedCheckMeasurement {
  readonly step: SpeedCheckStep;
  readonly startedAtIso: string;
  readonly endedAtIso: string;
  readonly summary: PerformanceScopeSummary;
  readonly actual: SpeedCheckActualSettings;
  readonly error: string | null;
}

export interface SpeedCheckReportInput {
  readonly runId: string;
  readonly createdAtIso: string;
  readonly appBuildId: string;
  readonly pageUrl: string;
  readonly measureMsOverride: number | null;
  readonly plannedStepCount: number;
  readonly abortReason: string | null;
  readonly device: DeviceInfo | null;
  readonly viewport: SpeedCheckViewport;
  readonly longTaskSupported: boolean;
  readonly measurements: readonly SpeedCheckMeasurement[];
}

export function handsVisibleEnough(twoHandCoverage: number | null): boolean {
  return twoHandCoverage !== null && twoHandCoverage >= HANDS_VISIBLE_MIN_TWO_HAND_COVERAGE;
}

export function toSpeedCheckStepResult(measurement: SpeedCheckMeasurement): SpeedCheckStepResult {
  const { step, summary } = measurement;
  return {
    ordinal: step.ordinal,
    id: step.id,
    label: step.label,
    requested: {
      experimentProfileId: step.profile.id,
      delegate: step.profile.tracking.preferredDelegate,
      cameraWidth: step.profile.camera.width,
      cameraHeight: step.profile.camera.height,
      frameRateIdeal: step.profile.camera.frameRateIdeal,
      frameRateMin: step.profile.camera.frameRateMin,
      frameSourceOverride: step.frameSourceOverride,
      pendingPolicy: step.pendingPolicy,
      repeatOfOrdinal: step.repeatOfOrdinal,
      warmupMs: step.warmupMs,
      measureMs: step.measureMs,
    },
    actual: measurement.actual,
    startedAtIso: measurement.startedAtIso,
    endedAtIso: measurement.endedAtIso,
    durationMs: summary.durationMs,
    trackingResultCount: summary.trackingResultCount,
    trackingHz: summary.trackingHz,
    inferenceP50Ms: summary.inferenceP50Ms,
    inferenceP95Ms: summary.inferenceP95Ms,
    inferenceMaxMs: summary.inferenceMaxMs,
    frameAgeP50Ms: summary.frameAgeP50Ms,
    frameAgeP95Ms: summary.frameAgeP95Ms,
    callbackToWorkerP50Ms: summary.callbackToWorkerP50Ms,
    workerWaitP50Ms: summary.workerWaitP50Ms,
    cameraFrameCount: summary.cameraFrameCount,
    cameraFps: summary.cameraFps,
    oneHandCoverage: summary.oneHandCoverage,
    twoHandCoverage: summary.twoHandCoverage,
    handsVisibleEnough: handsVisibleEnough(summary.twoHandCoverage),
    scheduler: summary.scheduler,
    longTask: {
      supported: summary.longTask.supported,
      count: summary.longTask.count,
      totalMs: summary.longTask.totalMs,
      maxMs: summary.longTask.maxMs,
    },
    usedJsHeapSizeAtEndBytes: summary.usedJsHeapSizeAtEndBytes,
    error: measurement.error,
  };
}

/**
 * The fastest setting by hand position updates per second. Steps measured without both hands, or
 * with an error, are only considered when nothing else qualifies — a step where the hands were
 * missing looks fast for the wrong reason. A tie keeps the earlier step.
 */
export function selectFastestSpeedCheckStep(
  steps: readonly SpeedCheckStepResult[],
): SpeedCheckFastestStep | null {
  const trusted = steps.filter((step) => step.error === null && step.handsVisibleEnough);
  return pickFastest(trusted.length > 0 ? trusted : steps);
}

function pickFastest(steps: readonly SpeedCheckStepResult[]): SpeedCheckFastestStep | null {
  let best: SpeedCheckStepResult | null = null;
  for (const step of steps) {
    const hz = step.trackingHz;
    if (hz === null) continue;
    if (best === null || hz > (best.trackingHz ?? Number.NEGATIVE_INFINITY)) best = step;
  }
  if (best === null || best.trackingHz === null) return null;
  return { ordinal: best.ordinal, id: best.id, label: best.label, trackingHz: best.trackingHz };
}

/** The one line the tester sees when the run finishes. */
export function describeFastestSpeedCheckStep(fastest: SpeedCheckFastestStep | null): string {
  if (fastest === null) return "いちばん速かった設定: 測れませんでした";
  return `いちばん速かった設定: ${fastest.ordinal}番（毎秒 ${fastest.trackingHz.toFixed(1)} 回）`;
}

export function buildSpeedCheckReport(input: SpeedCheckReportInput): SpeedCheckReport {
  const steps = input.measurements.map(toSpeedCheckStepResult);
  return {
    schema: SPEED_CHECK_SCHEMA,
    schemaVersion: SPEED_CHECK_SCHEMA_VERSION,
    runId: input.runId,
    createdAtIso: input.createdAtIso,
    appBuildId: input.appBuildId,
    pageUrl: input.pageUrl,
    measureMsOverride: input.measureMsOverride,
    completion: {
      status: input.abortReason === null ? "completed" : "aborted",
      abortReason: input.abortReason,
      plannedStepCount: input.plannedStepCount,
      measuredStepCount: steps.length,
    },
    device: input.device,
    viewport: input.viewport,
    longTaskSupported: input.longTaskSupported,
    steps,
    fastestStep: selectFastestSpeedCheckStep(steps),
  };
}

/** `speedcheck-YYYYMMDDHHMMSSmmm`, the same time wording as a P1 sessionId. */
export function createSpeedCheckRunId(now: Date): string {
  return `speedcheck-${now.toISOString().replace(/[-:.TZ]/g, "")}`;
}
