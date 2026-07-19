import type {
  MainToTrackingWorkerMessage,
  TrackingWorkerToMainMessage,
} from "./tracking-worker-messages";
import type { DetectedHand, Handedness } from "../tracking/tracking-types";

export interface TrackingWorkerEndpoint extends EventTarget {
  postMessage(message: MainToTrackingWorkerMessage, transfer?: Transferable[]): void;
  terminate(): void;
}

export type MockTrackingScenario =
  | "two"
  | "one-left"
  | "none"
  | "loss-cycle"
  | "slow"
  | "frame-error";

export class MockTrackingWorker extends EventTarget implements TrackingWorkerEndpoint {
  readonly #scenario: MockTrackingScenario;
  #terminated = false;
  #frameCount = 0;

  constructor(scenario: MockTrackingScenario = "two") {
    super();
    this.#scenario = scenario;
  }

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
        this.#frameCount += 1;
        message.image.close();
        if (this.#scenario === "frame-error" && this.#frameCount % 3 === 0) {
          queueMicrotask(() => this.#emit({
            type: "FRAME_ERROR",
            frameId: message.frameId,
            code: "inference-failed",
            recoverable: true,
            detail: "Synthetic recoverable inference failure.",
          }));
          return;
        }
        const hands = this.#handsForFrame();
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
              hands,
            },
          });
        }, this.#scenario === "slow" ? 80 : 8);
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

  #handsForFrame(): readonly DetectedHand[] {
    switch (this.#scenario) {
      case "one-left":
        return [syntheticHand(0, "left", 0.3)];
      case "none":
        return [];
      case "loss-cycle": {
        const phase = Math.floor((this.#frameCount - 1) / 20) % 3;
        if (phase === 1) return [syntheticHand(0, "left", 0.3)];
        if (phase === 2) return [];
        return [syntheticHand(0, "left", 0.3), syntheticHand(1, "right", 0.7)];
      }
      case "two":
      case "slow":
      case "frame-error":
        return [syntheticHand(0, "left", 0.3), syntheticHand(1, "right", 0.7)];
    }
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
