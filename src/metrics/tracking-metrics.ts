import type { SchedulerSnapshot } from "../camera/latest-frame-scheduler";
import type { TrackingFrameSourceKind } from "../camera/frame-source";
import type { HandTrackingFrame, TrackingProviderInfo } from "../tracking/tracking-types";
import { FixedSampleWindow } from "./statistics";

export type TrackingPresentationState =
  | "framing"
  | "ready"
  | "one-hand-lost"
  | "both-hands-lost"
  | "performance-low";

export interface TrackingMetricsSnapshot {
  readonly initializationStatus: "idle" | "initializing" | "ready" | "error";
  readonly initializationTimeMs: number | null;
  readonly provider: TrackingProviderInfo | null;
  readonly fatalError: string | null;
  readonly frameSource: TrackingFrameSourceKind | null;
  readonly scheduler: SchedulerSnapshot;
  readonly callbackToWorkerP50: number | null;
  readonly workerWaitP50: number | null;
  readonly inferenceP50: number | null;
  readonly inferenceP95: number | null;
  readonly inferenceMax: number | null;
  readonly frameAgeP50: number | null;
  readonly frameAgeP95: number | null;
  readonly outputHz: number | null;
  readonly handCount: number | null;
  readonly firstAcquisitionMs: number | null;
  readonly oneHandCoverage: number | null;
  readonly twoHandCoverage: number | null;
  readonly leftMissingMs: number | null;
  readonly rightMissingMs: number | null;
  readonly state: TrackingPresentationState;
  readonly latestFrame: HandTrackingFrame | null;
}

const EMPTY_SCHEDULER: SchedulerSnapshot = {
  captured: 0,
  sent: 0,
  completed: 0,
  replaced: 0,
  errored: 0,
  inFlight: 0,
  pending: 0,
};

export class TrackingMetricsCollector {
  readonly #callbackToWorker = new FixedSampleWindow(180);
  readonly #workerWait = new FixedSampleWindow(180);
  readonly #inference = new FixedSampleWindow(180);
  readonly #frameAge = new FixedSampleWindow(180);
  readonly #outputIntervals = new FixedSampleWindow(180);
  #status: TrackingMetricsSnapshot["initializationStatus"] = "idle";
  #initializationTimeMs: number | null = null;
  #provider: TrackingProviderInfo | null = null;
  #fatalError: string | null = null;
  #frameSource: TrackingFrameSourceKind | null = null;
  #scheduler: SchedulerSnapshot = EMPTY_SCHEDULER;
  #startedAt = performance.now();
  #latestFrame: HandTrackingFrame | null = null;
  #lastOutputAt: number | null = null;
  #firstAcquisitionMs: number | null = null;
  #resultCount = 0;
  #oneHandFrames = 0;
  #twoHandFrames = 0;
  #lastLeftSeen: number | null = null;
  #lastRightSeen: number | null = null;

  markInitializing(): void {
    this.#status = "initializing";
    this.#startedAt = performance.now();
  }

  markReady(provider: TrackingProviderInfo, initializationTimeMs: number): void {
    this.#status = "ready";
    this.#provider = provider;
    this.#initializationTimeMs = initializationTimeMs;
  }

  markError(detail: string): void {
    this.#status = "error";
    this.#fatalError = detail;
  }

  setFrameSource(source: TrackingFrameSourceKind): void {
    this.#frameSource = source;
  }

  setScheduler(snapshot: SchedulerSnapshot): void {
    this.#scheduler = snapshot;
  }

  addResult(frame: HandTrackingFrame): void {
    const now = performance.now();
    this.#latestFrame = frame;
    this.#resultCount += 1;
    if (frame.hands.length >= 1) this.#oneHandFrames += 1;
    if (frame.hands.length >= 2) this.#twoHandFrames += 1;
    if (frame.hands.length > 0 && this.#firstAcquisitionMs === null) {
      this.#firstAcquisitionMs = now - this.#startedAt;
    }
    if (frame.hands.some((hand) => hand.handedness === "left")) this.#lastLeftSeen = now;
    if (frame.hands.some((hand) => hand.handedness === "right")) this.#lastRightSeen = now;

    this.#callbackToWorker.add(frame.workerReceivedTimeMs - frame.callbackTimeMs);
    this.#workerWait.add(frame.inferenceStartedTimeMs - frame.workerReceivedTimeMs);
    this.#inference.add(frame.inferenceCompletedTimeMs - frame.inferenceStartedTimeMs);
    this.#frameAge.add(frame.inferenceCompletedTimeMs - frame.captureTimeMs);
    if (this.#lastOutputAt !== null) this.#outputIntervals.add(now - this.#lastOutputAt);
    this.#lastOutputAt = now;
  }

  get snapshot(): TrackingMetricsSnapshot {
    const now = performance.now();
    const outputMean = this.#outputIntervals.mean;
    const outputHz = outputMean === null || outputMean <= 0 ? null : 1000 / outputMean;
    const handCount = this.#latestFrame?.hands.length ?? null;
    const state = presentationState(this.#status, handCount, outputHz, this.#resultCount);
    return {
      initializationStatus: this.#status,
      initializationTimeMs: this.#initializationTimeMs,
      provider: this.#provider,
      fatalError: this.#fatalError,
      frameSource: this.#frameSource,
      scheduler: this.#scheduler,
      callbackToWorkerP50: this.#callbackToWorker.at(0.5),
      workerWaitP50: this.#workerWait.at(0.5),
      inferenceP50: this.#inference.at(0.5),
      inferenceP95: this.#inference.at(0.95),
      inferenceMax: maximum(this.#inference.values),
      frameAgeP50: this.#frameAge.at(0.5),
      frameAgeP95: this.#frameAge.at(0.95),
      outputHz,
      handCount,
      firstAcquisitionMs: this.#firstAcquisitionMs,
      oneHandCoverage: ratio(this.#oneHandFrames, this.#resultCount),
      twoHandCoverage: ratio(this.#twoHandFrames, this.#resultCount),
      leftMissingMs: this.#lastLeftSeen === null ? null : Math.max(0, now - this.#lastLeftSeen),
      rightMissingMs: this.#lastRightSeen === null ? null : Math.max(0, now - this.#lastRightSeen),
      state,
      latestFrame: this.#latestFrame,
    };
  }
}

function maximum(values: readonly number[]): number | null {
  return values.length === 0 ? null : Math.max(...values);
}

function ratio(count: number, total: number): number | null {
  return total === 0 ? null : count / total;
}

function presentationState(
  status: TrackingMetricsSnapshot["initializationStatus"],
  handCount: number | null,
  outputHz: number | null,
  resultCount: number,
): TrackingPresentationState {
  if (status !== "ready" || handCount === null) return "framing";
  if (resultCount >= 10 && outputHz !== null && outputHz < 15) return "performance-low";
  if (handCount >= 2) return "ready";
  if (handCount === 1) return "one-hand-lost";
  return "both-hands-lost";
}
