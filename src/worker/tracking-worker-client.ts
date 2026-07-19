import { createBestFrameSource } from "../camera/create-frame-source";
import type { FrameSource } from "../camera/frame-source";
import { LatestFrameScheduler } from "../camera/latest-frame-scheduler";
import { TrackingMetricsCollector, type TrackingMetricsSnapshot } from "../metrics/tracking-metrics";
import type { HandTrackingFrame } from "../tracking/tracking-types";
import {
  MockTrackingWorker,
  type MockTrackingScenario,
  type TrackingWorkerEndpoint,
} from "./mock-tracking-worker";
import type {
  MainToTrackingWorkerMessage,
  TrackingWorkerToMainMessage,
} from "./tracking-worker-messages";
import { assertNever } from "./tracking-worker-messages";

export interface TrackingClientUpdate {
  readonly metrics: TrackingMetricsSnapshot;
  readonly frame: HandTrackingFrame | null;
}

export class TrackingWorkerClient {
  readonly #onUpdate: (update: TrackingClientUpdate) => void;
  readonly #metrics = new TrackingMetricsCollector();
  #worker: TrackingWorkerEndpoint | null = null;
  #source: FrameSource | null = null;
  #scheduler: LatestFrameScheduler<VideoFrame | ImageBitmap> | null = null;
  #lastPublishedFrameId = 0;
  #running = false;
  #resolveReady: (() => void) | null = null;
  #rejectReady: ((reason: Error) => void) | null = null;

  constructor(onUpdate: (update: TrackingClientUpdate) => void) {
    this.#onUpdate = onUpdate;
  }

  async start(track: MediaStreamTrack, video: HTMLVideoElement): Promise<void> {
    this.stop();
    this.#running = true;
    this.#metrics.markInitializing();
    this.#emit();

    const worker = createWorkerEndpoint();
    this.#worker = worker;
    worker.addEventListener("message", this.#handleMessage);
    worker.addEventListener("error", this.#handleWorkerError);
    this.#scheduler = new LatestFrameScheduler((frame) => {
      const message: MainToTrackingWorkerMessage = {
        type: "FRAME",
        frameId: frame.frameId,
        image: frame.image,
        timestamp: frame.timestamp,
      };
      worker.postMessage(message, [frame.image]);
    });

    const ready = new Promise<void>((resolve, reject) => {
      this.#resolveReady = resolve;
      this.#rejectReady = reject;
    });
    worker.postMessage({
      type: "INIT",
      mainTimeOriginMs: performance.timeOrigin,
      config: {
        wasmRootUrl: new URL("/mediapipe/wasm", window.location.href).href,
        modelUrl: new URL("/mediapipe/models/hand_landmarker.task", window.location.href).href,
        preferredDelegate: "GPU",
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        packageId: "@mediapipe/tasks-vision@0.10.35",
        modelId: "hand_landmarker/full/float16/1#fbc2a30080c3",
      },
    });

    await ready;
    if (!this.#running) return;
    this.#source = createBestFrameSource(
      track,
      video,
      (captured) => {
        this.#scheduler?.offer(captured.image, captured.timestamp);
        this.#refreshScheduler();
      },
      (detail) => {
        this.#metrics.markError(`frame-source: ${detail}`);
        this.#emit();
      },
    );
    this.#metrics.setFrameSource(this.#source.kind);
    this.#source.start();
    this.#emit();
  }

  stop(): void {
    this.#running = false;
    this.#source?.stop();
    this.#source = null;
    this.#scheduler?.stop();
    this.#refreshScheduler();
    if (this.#worker !== null) {
      const worker = this.#worker;
      worker.removeEventListener("message", this.#handleMessage);
      worker.removeEventListener("error", this.#handleWorkerError);
      let timeoutId: number | null = null;
      const finish = (): void => {
        if (timeoutId !== null) clearTimeout(timeoutId);
        worker.removeEventListener("message", handleDisposed);
        worker.terminate();
      };
      const handleDisposed = (event: Event): void => {
        const message = (event as MessageEvent<TrackingWorkerToMainMessage>).data;
        if (message.type === "DISPOSED") finish();
      };
      worker.addEventListener("message", handleDisposed);
      timeoutId = window.setTimeout(finish, 1_500);
      worker.postMessage({ type: "DISPOSE" });
    }
    this.#worker = null;
    this.#scheduler = null;
    this.#resolveReady = null;
    this.#rejectReady?.(new Error("Tracking initialization was stopped."));
    this.#rejectReady = null;
  }

  readonly #handleMessage = (event: Event): void => {
    const message = (event as MessageEvent<TrackingWorkerToMainMessage>).data;
    switch (message.type) {
      case "READY":
        this.#metrics.markReady(message.provider, message.initializationTimeMs);
        this.#resolveReady?.();
        this.#resolveReady = null;
        this.#rejectReady = null;
        this.#emit();
        return;
      case "RESULT":
        this.#scheduler?.complete(message.result.frameId);
        this.#refreshScheduler();
        this.#metrics.addResult(message.result);
        if (message.result.frameId > this.#lastPublishedFrameId) {
          this.#lastPublishedFrameId = message.result.frameId;
          this.#emit();
        }
        return;
      case "FRAME_ERROR":
        this.#scheduler?.complete(message.frameId, true);
        this.#refreshScheduler();
        if (!message.recoverable) this.#metrics.markError(`${message.code}: ${message.detail}`);
        this.#emit();
        return;
      case "FATAL_ERROR": {
        const error = new Error(`${message.code}: ${message.detail}`);
        this.#metrics.markError(error.message);
        this.#rejectReady?.(error);
        this.#resolveReady = null;
        this.#rejectReady = null;
        this.#emit();
        return;
      }
      case "DISPOSED":
        return;
      default:
        assertNever(message);
    }
  };

  readonly #handleWorkerError = (event: Event): void => {
    const detail = event instanceof ErrorEvent ? event.message : "Tracking Worker error";
    this.#metrics.markError(detail);
    this.#rejectReady?.(new Error(detail));
    this.#emit();
  };

  #refreshScheduler(): void {
    if (this.#scheduler !== null) this.#metrics.setScheduler(this.#scheduler.snapshot);
  }

  #emit(): void {
    const metrics = this.#metrics.snapshot;
    this.#onUpdate({ metrics, frame: metrics.latestFrame });
  }
}

function createWorkerEndpoint(): TrackingWorkerEndpoint {
  const parameters = new URLSearchParams(window.location.search);
  if (parameters.get("tracking") === "mock") {
    const requested = parameters.get("trackingScenario");
    const scenarios: readonly MockTrackingScenario[] = [
      "two",
      "one-left",
      "none",
      "loss-cycle",
      "slow",
      "frame-error",
    ];
    const scenario = scenarios.find((candidate) => candidate === requested) ?? "two";
    return new MockTrackingWorker(scenario);
  }
  return new Worker(new URL("./tracking-worker.ts", import.meta.url), { type: "module" });
}
