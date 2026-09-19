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

/** Recomputing the windowed quantiles on every tracking result is wasteful, so they are cached this long. */
export const TRACKING_STATISTICS_INTERVAL_MS = 250;
/** Number of recent samples behind callbackToWorkerP50 … frameAgeP95 and outputHz. */
export const TRACKING_WINDOW_SAMPLES = 180;

export interface TrackingMetricsOptions {
  /** Injectable clock. Tests drive the statistics cache through it. */
  readonly now?: () => number;
  readonly statisticsIntervalMs?: number;
}

interface WindowedStatistics {
  readonly callbackToWorkerP50: number | null;
  readonly workerWaitP50: number | null;
  readonly inferenceP50: number | null;
  readonly inferenceP95: number | null;
  readonly inferenceMax: number | null;
  readonly frameAgeP50: number | null;
  readonly frameAgeP95: number | null;
  readonly outputHz: number | null;
}

export class TrackingMetricsCollector {
  readonly #callbackToWorker = new FixedSampleWindow(TRACKING_WINDOW_SAMPLES);
  readonly #workerWait = new FixedSampleWindow(TRACKING_WINDOW_SAMPLES);
  readonly #inference = new FixedSampleWindow(TRACKING_WINDOW_SAMPLES);
  readonly #frameAge = new FixedSampleWindow(TRACKING_WINDOW_SAMPLES);
  readonly #outputIntervals = new FixedSampleWindow(TRACKING_WINDOW_SAMPLES);
  readonly #now: () => number;
  readonly #statisticsIntervalMs: number;
  #statistics: WindowedStatistics | null = null;
  #statisticsAtMs = 0;
  #samplesChanged = false;
  #status: TrackingMetricsSnapshot["initializationStatus"] = "idle";
  #initializationTimeMs: number | null = null;
  #provider: TrackingProviderInfo | null = null;
  #fatalError: string | null = null;
  #frameSource: TrackingFrameSourceKind | null = null;
  #scheduler: SchedulerSnapshot = EMPTY_SCHEDULER;
  #startedAt: number;
  #latestFrame: HandTrackingFrame | null = null;
  #lastOutputAt: number | null = null;
  #firstAcquisitionMs: number | null = null;
  #resultCount = 0;
  #oneHandFrames = 0;
  #twoHandFrames = 0;
  #lastLeftSeen: number | null = null;
  #lastRightSeen: number | null = null;

  constructor(options: TrackingMetricsOptions = {}) {
    this.#now = options.now ?? (() => performance.now());
    this.#statisticsIntervalMs = options.statisticsIntervalMs ?? TRACKING_STATISTICS_INTERVAL_MS;
    this.#startedAt = this.#now();
  }

  markInitializing(): void {
    this.#status = "initializing";
    this.#startedAt = this.#now();
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
    const now = this.#now();
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
    this.#samplesChanged = true;
  }

  get snapshot(): TrackingMetricsSnapshot {
    const now = this.#now();
    const statistics = this.#windowedStatistics(now);
    const handCount = this.#latestFrame?.hands.length ?? null;
    const state = presentationState(this.#status, handCount, statistics.outputHz, this.#resultCount);
    return {
      initializationStatus: this.#status,
      initializationTimeMs: this.#initializationTimeMs,
      provider: this.#provider,
      fatalError: this.#fatalError,
      frameSource: this.#frameSource,
      scheduler: this.#scheduler,
      callbackToWorkerP50: statistics.callbackToWorkerP50,
      workerWaitP50: statistics.workerWaitP50,
      inferenceP50: statistics.inferenceP50,
      inferenceP95: statistics.inferenceP95,
      inferenceMax: statistics.inferenceMax,
      frameAgeP50: statistics.frameAgeP50,
      frameAgeP95: statistics.frameAgeP95,
      outputHz: statistics.outputHz,
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

  /**
   * Sorting five 180-sample windows on every tracking result dominated the frame budget, so the
   * quantiles are recomputed at most every statisticsIntervalMs. Everything the gesture pipeline
   * reads per frame (latestFrame, handCount, state, hand loss) is not throttled.
   */
  #windowedStatistics(now: number): WindowedStatistics {
    const cached = this.#statistics;
    if (cached !== null && (!this.#samplesChanged || now - this.#statisticsAtMs < this.#statisticsIntervalMs)) {
      return cached;
    }
    const outputMean = this.#outputIntervals.mean;
    const statistics: WindowedStatistics = {
      callbackToWorkerP50: this.#callbackToWorker.at(0.5),
      workerWaitP50: this.#workerWait.at(0.5),
      inferenceP50: this.#inference.at(0.5),
      inferenceP95: this.#inference.at(0.95),
      inferenceMax: maximum(this.#inference.values),
      frameAgeP50: this.#frameAge.at(0.5),
      frameAgeP95: this.#frameAge.at(0.95),
      outputHz: outputMean === null || outputMean <= 0 ? null : 1000 / outputMean,
    };
    this.#statistics = statistics;
    this.#statisticsAtMs = now;
    this.#samplesChanged = false;
    return statistics;
  }
}

/** A loop instead of Math.max(...values): spreading 180 arguments allocated on every result. */
function maximum(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let largest = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (value > largest) largest = value;
  }
  return largest;
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
