import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerOptions,
} from "@mediapipe/tasks-vision";
import type { HandTrackingProvider } from "./hand-tracking-provider";
import { adaptMediaPipeResult } from "./mediapipe-result-adapter";
import type {
  HandTrackingFrame,
  TrackingDelegate,
  TrackingInput,
  TrackingProviderInfo,
} from "./tracking-types";

export interface MediaPipeProviderConfig {
  readonly wasmRootUrl: string;
  readonly modelUrl: string;
  readonly preferredDelegate: TrackingDelegate;
  readonly numHands: 2;
  readonly minHandDetectionConfidence: number;
  readonly minHandPresenceConfidence: number;
  readonly minTrackingConfidence: number;
  readonly packageId: string;
  readonly modelId: string;
}

export class MediaPipeHandTrackingProvider implements HandTrackingProvider {
  readonly info: TrackingProviderInfo;
  readonly #landmarker: HandLandmarker;
  #lastTimestampMs = -1;

  private constructor(landmarker: HandLandmarker, info: TrackingProviderInfo) {
    this.#landmarker = landmarker;
    this.info = info;
  }

  static async create(config: MediaPipeProviderConfig): Promise<MediaPipeHandTrackingProvider> {
    // Module Workers cannot execute the classic Emscripten loader with importScripts().
    // The package's module loader explicitly exports ModuleFactory on globalThis.
    const fileset = await FilesetResolver.forVisionTasks(config.wasmRootUrl, true);
    try {
      const landmarker = await HandLandmarker.createFromOptions(
        fileset,
        createOptions(config, config.preferredDelegate),
      );
      return new MediaPipeHandTrackingProvider(landmarker, {
        delegate: config.preferredDelegate,
        fallbackReason: null,
        packageId: config.packageId,
        modelId: config.modelId,
      });
    } catch (gpuError) {
      if (config.preferredDelegate !== "GPU") throw gpuError;
      const cpuFileset = await FilesetResolver.forVisionTasks(config.wasmRootUrl, true);
      // The module loader clears globalThis.ModuleFactory after each initialization.
      // A query makes the CPU retry execute the loader module again instead of reusing
      // the dynamic-import cache left by the failed GPU attempt.
      cpuFileset.wasmLoaderPath = appendQuery(cpuFileset.wasmLoaderPath, "delegate", "cpu");
      const landmarker = await HandLandmarker.createFromOptions(
        cpuFileset,
        createOptions(config, "CPU"),
      );
      return new MediaPipeHandTrackingProvider(landmarker, {
        delegate: "CPU",
        fallbackReason: classifyGpuFallback(gpuError),
        packageId: config.packageId,
        modelId: config.modelId,
      });
    }
  }

  detect(input: TrackingInput, workerReceivedTimeMs: number): HandTrackingFrame {
    const inferenceStartedTimeMs = performance.now();
    const timestampMs = Math.max(this.#lastTimestampMs + 0.001, input.timestamp.captureTimeMs);
    this.#lastTimestampMs = timestampMs;
    const result = this.#landmarker.detectForVideo(input.image, timestampMs);
    const inferenceCompletedTimeMs = performance.now();
    return {
      frameId: input.frameId,
      captureTimeMs: input.timestamp.captureTimeMs,
      callbackTimeMs: input.timestamp.callbackTimeMs,
      workerReceivedTimeMs,
      inferenceStartedTimeMs,
      inferenceCompletedTimeMs,
      hands: adaptMediaPipeResult(result),
    };
  }

  close(): void {
    this.#landmarker.close();
  }
}

function createOptions(
  config: MediaPipeProviderConfig,
  delegate: TrackingDelegate,
): HandLandmarkerOptions {
  return {
    baseOptions: { modelAssetPath: config.modelUrl, delegate },
    runningMode: "VIDEO",
    numHands: config.numHands,
    minHandDetectionConfidence: config.minHandDetectionConfidence,
    minHandPresenceConfidence: config.minHandPresenceConfidence,
    minTrackingConfidence: config.minTrackingConfidence,
  };
}

function classifyGpuFallback(error: unknown): string {
  const name = error instanceof Error ? error.name : "UnknownError";
  return `gpu-initialization-failed:${name}`;
}

function appendQuery(url: string, key: string, value: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set(key, value);
  return parsed.href;
}
