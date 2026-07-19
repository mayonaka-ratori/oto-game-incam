import type {
  MainToTrackingWorkerMessage,
  TrackingWorkerToMainMessage,
} from "./tracking-worker-messages";
import type { DetectedHand, Handedness } from "../tracking/tracking-types";

export interface TrackingWorkerEndpoint extends EventTarget {
  postMessage(message: MainToTrackingWorkerMessage, transfer?: Transferable[]): void;
  terminate(): void;
}

export class MockTrackingWorker extends EventTarget implements TrackingWorkerEndpoint {
  #terminated = false;

  postMessage(message: MainToTrackingWorkerMessage): void {
    if (this.#terminated) return;
    switch (message.type) {
      case "INIT":
        queueMicrotask(() => this.#emit({
          type: "READY",
          provider: {
            delegate: "CPU",
            fallbackReason: "mock-provider",
            packageId: message.config.packageId,
            modelId: "synthetic-two-hand-fixture",
          },
          initializationTimeMs: 1,
        }));
        return;
      case "FRAME": {
        const received = performance.now();
        message.image.close();
        window.setTimeout(() => {
          const started = received + 0.2;
          this.#emit({
            type: "RESULT",
            result: {
              frameId: message.frameId,
              captureTimeMs: message.timestamp.captureTimeMs,
              callbackTimeMs: message.timestamp.callbackTimeMs,
              workerReceivedTimeMs: received,
              inferenceStartedTimeMs: started,
              inferenceCompletedTimeMs: started + 7.5,
              hands: [syntheticHand(0, "left", 0.3), syntheticHand(1, "right", 0.7)],
            },
          });
        }, 8);
        return;
      }
      case "DISPOSE":
        this.#emit({ type: "DISPOSED" });
        this.terminate();
        return;
    }
  }

  terminate(): void {
    this.#terminated = true;
  }

  #emit(data: TrackingWorkerToMainMessage): void {
    if (!this.#terminated) this.dispatchEvent(new MessageEvent("message", { data }));
  }
}

function syntheticHand(detectionIndex: number, handedness: Handedness, centerX: number): DetectedHand {
  const landmarks2D = Array.from({ length: 21 }, (_, index) => {
    const finger = Math.max(0, Math.ceil(index / 4));
    const joint = index === 0 ? 0 : ((index - 1) % 4) + 1;
    return {
      x: centerX + (finger - 2.5) * 0.025,
      y: 0.72 - joint * 0.09 - Math.abs(finger - 2.5) * 0.01,
      zRelative: -joint * 0.01,
    };
  });
  return {
    detectionIndex,
    handedness,
    handednessScore: 0.98,
    landmarks2D,
    landmarksWorld: landmarks2D.map((point) => ({ x: point.x, y: point.y, z: point.zRelative })),
  };
}
