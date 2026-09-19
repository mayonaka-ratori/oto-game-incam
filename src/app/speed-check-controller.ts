import {
  CameraController,
  type CameraSession,
  type CameraTrackEvent,
} from "../camera/camera-controller";
import { classifyCameraError } from "../camera/camera-errors";
import {
  remainingSpeedCheckMs,
  requiresCameraRestart,
  resolveSpeedCheckMeasureOverrideMs,
  speedCheckSteps,
  type SpeedCheckStep,
} from "../experiments/speed-check-plan";
import { DeviceInfoCollector } from "../metrics/device-info";
import { FrameMetricsCollector, type FrameMetricsSnapshot } from "../metrics/frame-metrics";
import {
  emptyScopeCounters,
  LongTaskMonitor,
  PerformanceScopeAccumulator,
  readUsedJsHeapSizeBytes,
  type PerformanceScopeCounters,
  type PerformanceScopeSummary,
} from "../metrics/session-performance";
import {
  buildSpeedCheckReport,
  createSpeedCheckRunId,
  describeFastestSpeedCheckStep,
  type SpeedCheckActualSettings,
  type SpeedCheckMeasurement,
  type SpeedCheckReport,
} from "../metrics/speed-check-report";
import type { TrackingMetricsSnapshot } from "../metrics/tracking-metrics";
import { SpeedCheckView } from "../ui/speed-check-view";
import { TrackingWorkerClient } from "../worker/tracking-worker-client";
import { APP_BUILD_ID } from "./app-build";
import { ScreenWakeLock } from "./screen-wake-lock";

/**
 * Disposing a tracking Worker is asynchronous. This pause sits between two steps so the previous
 * Worker's last frames cannot land inside the next step's measurement.
 */
const STEP_SETTLE_MS = 400;

/**
 * How often the progress line is redrawn. Every measured time still comes from performance.now();
 * this timer only decides how often the screen is rewritten.
 */
const PROGRESS_INTERVAL_MS = 250;

/**
 * Runs the automatic speed check: one tap, then every setting in `speedCheckSteps` is measured in
 * turn and the whole run is saved as one JSON file.
 *
 * What it guarantees between steps:
 * - a fresh tracking Worker, so no state carries over;
 * - a fresh camera whenever the requested resolution changes, and only then;
 * - a measurement window that starts after the warm-up, so a Worker's first frames are discarded.
 */
export class SpeedCheckController {
  readonly #view: SpeedCheckView;
  readonly #camera: CameraController;
  readonly #steps: readonly SpeedCheckStep[];
  readonly #measureMsOverride: number | null;
  readonly #deviceInfo = new DeviceInfoCollector();
  readonly #wakeLock = new ScreenWakeLock();
  readonly #longTask: LongTaskMonitor;
  readonly #measurements: SpeedCheckMeasurement[] = [];
  #session: CameraSession | null = null;
  #cameraStep: SpeedCheckStep | null = null;
  #frameMetricsCollector: FrameMetricsCollector | null = null;
  #frameMetrics: FrameMetricsSnapshot | null = null;
  #client: TrackingWorkerClient | null = null;
  #tracking: TrackingMetricsSnapshot | null = null;
  #scope: PerformanceScopeAccumulator | null = null;
  #lastCountedFrameId = 0;
  #stepIndex = 0;
  #stepStartedAtMs = 0;
  #running = false;
  #abortReason: string | null = null;
  #wake: (() => void) | null = null;
  #progressTimerId: number | null = null;
  #report: SpeedCheckReport | null = null;
  #disposed = false;

  constructor(root: HTMLElement) {
    this.#measureMsOverride = resolveSpeedCheckMeasureOverrideMs(window.location.search);
    this.#steps = speedCheckSteps(this.#measureMsOverride);
    // Started before the camera so the WebGL probe never competes with the tracking Worker.
    this.#deviceInfo.start();
    this.#longTask = new LongTaskMonitor((durationMs, record) => {
      this.#scope?.addLongTask(durationMs, record);
    });
    this.#camera = new CameraController((event) => this.#handleTrackEvent(event));
    this.#view = new SpeedCheckView(root, {
      onStart: () => void this.#start(),
      onStop: () => this.#abort("テスターが「やめる」を押しました。"),
      onSave: () => this.#save(),
    });
    this.#view.showPhase("intro");
    document.addEventListener("visibilitychange", this.#handleVisibilityChange);
    window.addEventListener("pagehide", this.#dispose);
  }

  async #start(): Promise<void> {
    if (this.#running || this.#disposed) return;
    this.#running = true;
    this.#abortReason = null;
    this.#measurements.length = 0;
    this.#view.setIntroError("");
    this.#view.setStartEnabled(false);
    this.#view.showPhase("running");
    this.#renderProgress();
    this.#longTask.start();
    void this.#wakeLock.acquire();
    this.#progressTimerId = window.setInterval(() => this.#renderProgress(), PROGRESS_INTERVAL_MS);
    try {
      await this.#runAllSteps();
    } finally {
      this.#finish();
    }
  }

  async #runAllSteps(): Promise<void> {
    for (const [index, step] of this.#steps.entries()) {
      if (this.#abortReason !== null || this.#disposed) return;
      this.#stepIndex = index;
      this.#stepStartedAtMs = performance.now();
      this.#lastCountedFrameId = 0;
      const startedAtIso = new Date().toISOString();
      let stepError: string | null = null;
      let fatal = false;
      try {
        await this.#prepareStep(step);
        await this.#sleep(step.warmupMs);
        if (this.#abortReason === null && !this.#disposed) {
          this.#openScope();
          await this.#sleep(step.measureMs);
        }
      } catch (error) {
        stepError = describeError(error);
        fatal = this.#session === null;
      }
      const summary = this.#closeScope();
      const actual = this.#readActualSettings();
      this.#stopTracking();
      if (summary !== null) {
        this.#measurements.push({ step, startedAtIso, endedAtIso: new Date().toISOString(), summary, actual, error: stepError });
      } else if (stepError !== null && this.#abortReason === null) {
        this.#measurements.push({
          step,
          startedAtIso,
          endedAtIso: new Date().toISOString(),
          summary: emptyScopeSummary(this.#longTask.supported),
          actual,
          error: stepError,
        });
      }
      if (fatal && this.#abortReason === null) {
        // Without a camera every remaining step would fail the same way, so the run stops here.
        this.#abortReason = `カメラを使えませんでした。${stepError ?? ""}`.trim();
      }
      if (this.#abortReason !== null || this.#disposed) return;
      await this.#sleep(STEP_SETTLE_MS);
    }
  }

  /** Reopens the camera only when the requested resolution changed, then starts a fresh Worker. */
  async #prepareStep(step: SpeedCheckStep): Promise<void> {
    if (this.#session === null || requiresCameraRestart(this.#cameraStep, step)) {
      this.#stopCamera();
      try {
        this.#session = await this.#camera.start(this.#view.video, step.profile);
      } catch (error) {
        const classified = classifyCameraError(error);
        throw new Error(`${classified.title}（${classified.technicalName}）`, { cause: error });
      }
      this.#cameraStep = step;
      this.#frameMetricsCollector = new FrameMetricsCollector(this.#view.video, (metrics) => {
        this.#frameMetrics = metrics;
      });
      this.#frameMetricsCollector.start();
    }
    const session = this.#session;
    if (session === null) throw new Error("カメラを開始できませんでした。");
    const client = new TrackingWorkerClient((update) => {
      if (this.#client !== client) return;
      this.#tracking = update.metrics;
      const frame = update.frame;
      if (frame !== null && frame.frameId > this.#lastCountedFrameId) {
        this.#lastCountedFrameId = frame.frameId;
        this.#scope?.addResult(frame, performance.now());
      }
    });
    this.#client = client;
    this.#tracking = null;
    await client.start(session.track, this.#view.video, step.profile, {
      frameSourceOverride: step.frameSourceOverride,
      pendingPolicy: step.pendingPolicy,
    });
  }

  #openScope(): void {
    this.#scope = new PerformanceScopeAccumulator(performance.now(), this.#counters());
  }

  #closeScope(): PerformanceScopeSummary | null {
    const scope = this.#scope;
    if (scope === null) return null;
    this.#scope = null;
    const now = performance.now();
    const counters = this.#counters();
    scope.close(now, counters);
    return scope.summary(now, counters, this.#longTask.supported);
  }

  #counters(): PerformanceScopeCounters {
    return {
      scheduler: this.#tracking?.scheduler ?? null,
      cameraFrames: this.#frameMetrics?.cameraFrames ?? null,
      cameraElapsedMs: this.#frameMetrics?.elapsedMs ?? null,
      usedJsHeapSizeBytes: readUsedJsHeapSizeBytes(),
    };
  }

  #readActualSettings(): SpeedCheckActualSettings {
    const provider = this.#tracking?.provider ?? null;
    const settings = this.#session?.track.getSettings();
    return {
      delegate: provider?.delegate ?? null,
      fallbackReason: provider?.fallbackReason ?? null,
      packageId: provider?.packageId ?? null,
      modelId: provider?.modelId ?? null,
      frameSource: this.#tracking?.frameSource ?? null,
      cameraWidth: settings?.width ?? null,
      cameraHeight: settings?.height ?? null,
      cameraFrameRate: settings?.frameRate ?? null,
    };
  }

  #stopTracking(): void {
    this.#client?.stop();
    this.#client = null;
  }

  #stopCamera(): void {
    this.#frameMetricsCollector?.stop();
    this.#frameMetricsCollector = null;
    this.#frameMetrics = null;
    this.#session = null;
    this.#cameraStep = null;
    this.#camera.stop();
  }

  #finish(): void {
    this.#running = false;
    if (this.#progressTimerId !== null) window.clearInterval(this.#progressTimerId);
    this.#progressTimerId = null;
    this.#stopTracking();
    this.#stopCamera();
    this.#longTask.stop();
    void this.#wakeLock.release();
    if (this.#disposed) return;
    this.#report = buildSpeedCheckReport({
      runId: createSpeedCheckRunId(new Date()),
      createdAtIso: new Date().toISOString(),
      appBuildId: APP_BUILD_ID,
      pageUrl: window.location.href,
      measureMsOverride: this.#measureMsOverride,
      plannedStepCount: this.#steps.length,
      abortReason: this.#abortReason,
      // Snapshotted here, so the battery reading belongs to the end of the measurement.
      device: this.#deviceInfo.snapshot(),
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
        orientation: readOrientation(),
      },
      longTaskSupported: this.#longTask.supported,
      measurements: this.#measurements,
    });
    this.#view.showPhase("finished");
    this.#view.setSaveStatus("");
    this.#view.renderFinished({
      title: this.#abortReason === null ? "計測が終わりました" : "計測を途中でやめました",
      abortReason: this.#abortReason,
      fastestLine: describeFastestSpeedCheckStep(this.#report.fastestStep),
    });
  }

  #save(): void {
    const report = this.#report;
    if (report === null) return;
    const fileName = `${report.runId}.json`;
    downloadJson(report, fileName);
    this.#view.setSaveStatus(`${fileName} を保存しました。このファイルを送ってください。`);
  }

  #abort(reason: string): void {
    if (!this.#running || this.#abortReason !== null) return;
    this.#abortReason = reason;
    this.#wake?.();
  }

  /** Resolves after the given time, or at once when the run was stopped. */
  #sleep(durationMs: number): Promise<void> {
    return new Promise<void>((resolve) => {
      if (this.#abortReason !== null || this.#disposed) {
        resolve();
        return;
      }
      const timeoutId = window.setTimeout(() => {
        this.#wake = null;
        resolve();
      }, durationMs);
      this.#wake = () => {
        window.clearTimeout(timeoutId);
        this.#wake = null;
        resolve();
      };
    });
  }

  #renderProgress(): void {
    const remainingMs = remainingSpeedCheckMs(
      this.#steps,
      this.#stepIndex,
      performance.now() - this.#stepStartedAtMs,
    );
    this.#view.renderRunning({
      stepNumber: this.#stepIndex + 1,
      stepCount: this.#steps.length,
      remainingSeconds: remainingMs / 1_000,
      handCount: this.#tracking?.handCount ?? null,
    });
  }

  #handleTrackEvent(event: CameraTrackEvent): void {
    if (event.type === "ended") this.#abort("カメラが止まりました。");
  }

  readonly #handleVisibilityChange = (): void => {
    if (document.visibilityState !== "visible") {
      this.#abort("計測中に画面が表示されなくなりました。最初からやり直してください。");
    }
  };

  readonly #dispose = (): void => {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#abortReason ??= "ページを離れました。";
    this.#wake?.();
    if (this.#progressTimerId !== null) window.clearInterval(this.#progressTimerId);
    this.#progressTimerId = null;
    this.#stopTracking();
    this.#stopCamera();
    this.#longTask.stop();
    this.#wakeLock.dispose();
    document.removeEventListener("visibilitychange", this.#handleVisibilityChange);
    window.removeEventListener("pagehide", this.#dispose);
  };
}

/** A step that never reached its measurement still gets a row, so its error is visible. */
function emptyScopeSummary(longTaskSupported: boolean): PerformanceScopeSummary {
  const now = performance.now();
  const counters = emptyScopeCounters();
  const scope = new PerformanceScopeAccumulator(now, counters);
  scope.close(now, counters);
  return scope.summary(now, counters, longTaskSupported);
}

function readOrientation(): string | null {
  try {
    const type: unknown = screen.orientation?.type;
    return typeof type === "string" && type.length > 0 ? type : null;
  } catch {
    return null;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function downloadJson(value: unknown, filename: string): void {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // Revoking at once can cancel the download on some browsers, so the URL is released later.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
