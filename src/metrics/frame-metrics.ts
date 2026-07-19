import { FixedSampleWindow } from "./statistics";

export type CameraFrameSource = "requestVideoFrameCallback" | "animationFrame-fallback";

export interface FrameMetricsSnapshot {
  readonly cameraFrames: number;
  readonly cameraFps: number | null;
  readonly frameIntervalP50: number | null;
  readonly frameIntervalP95: number | null;
  readonly displayFps: number | null;
  readonly elapsedMs: number;
  readonly source: CameraFrameSource;
  readonly pageVisible: boolean;
}

export class FrameMetricsCollector {
  readonly #video: HTMLVideoElement;
  readonly #onUpdate: (snapshot: FrameMetricsSnapshot) => void;
  readonly #cameraIntervals = new FixedSampleWindow(180);
  readonly #displayIntervals = new FixedSampleWindow(180);
  #cameraFrames = 0;
  #startedAt = 0;
  #lastCameraNow: number | null = null;
  #lastDisplayNow: number | null = null;
  #lastMediaTime = -1;
  #videoFrameCallbackId: number | null = null;
  #videoFallbackRafId: number | null = null;
  #displayRafId: number | null = null;
  #updateTimerId: number | null = null;
  #running = false;
  readonly #source: CameraFrameSource;

  constructor(video: HTMLVideoElement, onUpdate: (snapshot: FrameMetricsSnapshot) => void) {
    this.#video = video;
    this.#onUpdate = onUpdate;
    this.#source =
      typeof video.requestVideoFrameCallback === "function"
        ? "requestVideoFrameCallback"
        : "animationFrame-fallback";
  }

  start(): void {
    if (this.#running) {
      return;
    }

    this.#running = true;
    this.#startedAt = performance.now();
    this.#cameraFrames = 0;
    this.#resetIntervals();
    document.addEventListener("visibilitychange", this.#handleVisibilityChange);
    this.#scheduleCameraFrame();
    this.#displayRafId = requestAnimationFrame(this.#handleDisplayFrame);
    this.#updateTimerId = window.setInterval(() => this.#emit(), 250);
    this.#emit();
  }

  stop(): void {
    this.#running = false;
    document.removeEventListener("visibilitychange", this.#handleVisibilityChange);

    if (this.#videoFrameCallbackId !== null) {
      this.#video.cancelVideoFrameCallback(this.#videoFrameCallbackId);
    }
    if (this.#videoFallbackRafId !== null) {
      cancelAnimationFrame(this.#videoFallbackRafId);
    }
    if (this.#displayRafId !== null) {
      cancelAnimationFrame(this.#displayRafId);
    }
    if (this.#updateTimerId !== null) {
      clearInterval(this.#updateTimerId);
    }

    this.#videoFrameCallbackId = null;
    this.#videoFallbackRafId = null;
    this.#displayRafId = null;
    this.#updateTimerId = null;
  }

  #scheduleCameraFrame(): void {
    if (!this.#running) {
      return;
    }

    if (this.#source === "requestVideoFrameCallback") {
      this.#videoFrameCallbackId = this.#video.requestVideoFrameCallback((now) => {
        this.#recordCameraFrame(now);
        this.#scheduleCameraFrame();
      });
      return;
    }

    this.#videoFallbackRafId = requestAnimationFrame((now) => {
      if (this.#video.currentTime !== this.#lastMediaTime) {
        this.#lastMediaTime = this.#video.currentTime;
        this.#recordCameraFrame(now);
      }
      this.#scheduleCameraFrame();
    });
  }

  #recordCameraFrame(now: number): void {
    if (!this.#running || document.visibilityState !== "visible") {
      this.#lastCameraNow = null;
      return;
    }

    if (this.#lastCameraNow !== null) {
      this.#cameraIntervals.add(now - this.#lastCameraNow);
    }
    this.#lastCameraNow = now;
    this.#cameraFrames += 1;
  }

  readonly #handleDisplayFrame = (now: number): void => {
    if (!this.#running) {
      return;
    }

    if (document.visibilityState === "visible") {
      if (this.#lastDisplayNow !== null) {
        this.#displayIntervals.add(now - this.#lastDisplayNow);
      }
      this.#lastDisplayNow = now;
    } else {
      this.#lastDisplayNow = null;
    }

    this.#displayRafId = requestAnimationFrame(this.#handleDisplayFrame);
  };

  readonly #handleVisibilityChange = (): void => {
    this.#resetIntervals();
    this.#emit();
  };

  #resetIntervals(): void {
    this.#cameraIntervals.clear();
    this.#displayIntervals.clear();
    this.#lastCameraNow = null;
    this.#lastDisplayNow = null;
    this.#lastMediaTime = -1;
  }

  #emit(): void {
    const cameraMean = this.#cameraIntervals.mean;
    const displayMean = this.#displayIntervals.mean;
    this.#onUpdate({
      cameraFrames: this.#cameraFrames,
      cameraFps: cameraMean === null || cameraMean <= 0 ? null : 1000 / cameraMean,
      frameIntervalP50: this.#cameraIntervals.at(0.5),
      frameIntervalP95: this.#cameraIntervals.at(0.95),
      displayFps: displayMean === null || displayMean <= 0 ? null : 1000 / displayMean,
      elapsedMs: Math.max(0, performance.now() - this.#startedAt),
      source: this.#source,
      pageVisible: document.visibilityState === "visible",
    });
  }
}

