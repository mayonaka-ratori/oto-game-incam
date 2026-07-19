/// <reference lib="webworker" />

import type { HandTrackingProvider } from "../tracking/hand-tracking-provider";
import { MediaPipeHandTrackingProvider } from "../tracking/mediapipe-hand-tracking-provider";
import type {
  MainToTrackingWorkerMessage,
  TrackingWorkerToMainMessage,
} from "./tracking-worker-messages";
import { assertNever } from "./tracking-worker-messages";

const worker = self as unknown as DedicatedWorkerGlobalScope;
let provider: HandTrackingProvider | null = null;
let disposing = false;
let initializationGeneration = 0;
let workerToMainClockOffsetMs = 0;

worker.addEventListener("message", (event: MessageEvent<MainToTrackingWorkerMessage>) => {
  void handleMessage(event.data);
});

async function handleMessage(message: MainToTrackingWorkerMessage): Promise<void> {
  switch (message.type) {
    case "INIT": {
      const generation = ++initializationGeneration;
      disposing = false;
      workerToMainClockOffsetMs = performance.timeOrigin - message.mainTimeOriginMs;
      const startedAt = performance.now();
      try {
        const createdProvider = await MediaPipeHandTrackingProvider.create(message.config);
        if (disposing || generation !== initializationGeneration) {
          createdProvider.close();
          return;
        }
        provider?.close();
        provider = createdProvider;
        post({
          type: "READY",
          provider: provider.info,
          initializationTimeMs: performance.now() - startedAt,
        });
      } catch (error) {
        if (!disposing && generation === initializationGeneration) {
          post({ type: "FATAL_ERROR", code: "initialization-failed", detail: describeError(error) });
        }
      }
      return;
    }
    case "FRAME": {
      const workerReceivedTimeMs = performance.now();
      if (provider === null || disposing) {
        message.image.close();
        post({
          type: "FRAME_ERROR",
          frameId: message.frameId,
          code: "not-ready",
          recoverable: false,
          detail: "Tracking provider is not ready.",
        });
        return;
      }
      try {
        const result = provider.detect(
          { frameId: message.frameId, image: message.image, timestamp: message.timestamp },
          workerReceivedTimeMs,
        );
        post({ type: "RESULT", result: translateWorkerTimesToMainClock(result) });
      } catch (error) {
        post({
          type: "FRAME_ERROR",
          frameId: message.frameId,
          code: "inference-failed",
          recoverable: true,
          detail: describeError(error),
        });
      } finally {
        message.image.close();
      }
      return;
    }
    case "DISPOSE":
      disposing = true;
      initializationGeneration += 1;
      provider?.close();
      provider = null;
      post({ type: "DISPOSED" });
      worker.close();
      return;
    default:
      assertNever(message);
  }
}

function translateWorkerTimesToMainClock(
  result: ReturnType<HandTrackingProvider["detect"]>,
): ReturnType<HandTrackingProvider["detect"]> {
  return {
    ...result,
    workerReceivedTimeMs: result.workerReceivedTimeMs + workerToMainClockOffsetMs,
    inferenceStartedTimeMs: result.inferenceStartedTimeMs + workerToMainClockOffsetMs,
    inferenceCompletedTimeMs: result.inferenceCompletedTimeMs + workerToMainClockOffsetMs,
  };
}

function post(message: TrackingWorkerToMainMessage): void {
  worker.postMessage(message);
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
