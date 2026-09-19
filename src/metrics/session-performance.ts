import type { SchedulerSnapshot } from "../camera/latest-frame-scheduler";
import type { HandTrackingFrame } from "../tracking/tracking-types";
import { DEFAULT_HISTOGRAM_BUCKET_MS, FixedBucketHistogram } from "./statistics";

/** Quantiles below are bucketed at this width, so p50/p95 are whole milliseconds. */
export const PERFORMANCE_HISTOGRAM_BUCKET_MS = DEFAULT_HISTOGRAM_BUCKET_MS;

/** Counters read once when a scope opens and once when it closes. Their difference is the scope's own work. */
export interface PerformanceScopeCounters {
  readonly scheduler: SchedulerSnapshot | null;
  readonly cameraFrames: number | null;
  readonly cameraElapsedMs: number | null;
  readonly usedJsHeapSizeBytes: number | null;
}

export interface SchedulerDeltaSummary {
  readonly captured: number;
  readonly completed: number;
  readonly replaced: number;
  readonly errored: number;
}

/** Main-thread blocking. Safari has no longtask entries, so supported is false and the counts are null. */
export interface LongTaskSummary {
  readonly supported: boolean;
  readonly count: number | null;
  readonly totalMs: number | null;
  readonly maxMs: number | null;
}

export interface PerformanceScopeSummary {
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly durationMs: number;
  readonly open: boolean;
  readonly trackingResultCount: number;
  readonly trackingHz: number | null;
  readonly inferenceP50Ms: number | null;
  readonly inferenceP95Ms: number | null;
  readonly inferenceMaxMs: number | null;
  readonly frameAgeP50Ms: number | null;
  readonly frameAgeP95Ms: number | null;
  readonly frameAgeMaxMs: number | null;
  readonly callbackToWorkerP50Ms: number | null;
  readonly workerWaitP50Ms: number | null;
  readonly cameraFrameCount: number | null;
  readonly cameraFps: number | null;
  readonly oneHandCoverage: number | null;
  readonly twoHandCoverage: number | null;
  readonly scheduler: SchedulerDeltaSummary | null;
  readonly longTask: LongTaskSummary;
  readonly usedJsHeapSizeAtEndBytes: number | null;
}

export function emptyScopeCounters(): PerformanceScopeCounters {
  return { scheduler: null, cameraFrames: null, cameraElapsedMs: null, usedJsHeapSizeBytes: null };
}

/**
 * Whole-scope performance without keeping every sample: four fixed-width histograms plus counters.
 * Memory stays constant however long a session runs.
 */
export class PerformanceScopeAccumulator {
  readonly #inference = new FixedBucketHistogram();
  readonly #frameAge = new FixedBucketHistogram();
  readonly #callbackToWorker = new FixedBucketHistogram();
  readonly #workerWait = new FixedBucketHistogram();
  readonly #startedAtMs: number;
  readonly #start: PerformanceScopeCounters;
  #endedAtMs: number | null = null;
  #end: PerformanceScopeCounters | null = null;
  #resultCount = 0;
  #oneHandFrames = 0;
  #twoHandFrames = 0;
  #firstResultAtMs: number | null = null;
  #lastResultAtMs: number | null = null;
  #longTaskCount = 0;
  #longTaskTotalMs = 0;
  #longTaskMaxMs = 0;

  constructor(startedAtMs: number, start: PerformanceScopeCounters) {
    this.#startedAtMs = startedAtMs;
    this.#start = start;
  }

  addResult(frame: HandTrackingFrame, nowMs: number): void {
    if (this.#endedAtMs !== null) return;
    this.#resultCount += 1;
    if (frame.hands.length >= 1) this.#oneHandFrames += 1;
    if (frame.hands.length >= 2) this.#twoHandFrames += 1;
    if (this.#firstResultAtMs === null) this.#firstResultAtMs = nowMs;
    this.#lastResultAtMs = nowMs;
    this.#inference.add(frame.inferenceCompletedTimeMs - frame.inferenceStartedTimeMs);
    this.#frameAge.add(frame.inferenceCompletedTimeMs - frame.captureTimeMs);
    this.#callbackToWorker.add(frame.workerReceivedTimeMs - frame.callbackTimeMs);
    this.#workerWait.add(frame.inferenceStartedTimeMs - frame.workerReceivedTimeMs);
  }

  addLongTask(durationMs: number): void {
    if (this.#endedAtMs !== null || !Number.isFinite(durationMs)) return;
    this.#longTaskCount += 1;
    this.#longTaskTotalMs += durationMs;
    this.#longTaskMaxMs = Math.max(this.#longTaskMaxMs, durationMs);
  }

  close(endedAtMs: number, end: PerformanceScopeCounters): void {
    if (this.#endedAtMs !== null) return;
    this.#endedAtMs = endedAtMs;
    this.#end = end;
  }

  get closed(): boolean {
    return this.#endedAtMs !== null;
  }

  get startedAtMs(): number {
    return this.#startedAtMs;
  }

  /** A still-open scope is summarized up to the given time and counters. */
  summary(
    fallbackEndedAtMs: number,
    fallbackEnd: PerformanceScopeCounters,
    longTaskSupported: boolean,
  ): PerformanceScopeSummary {
    const open = this.#endedAtMs === null;
    const endedAtMs = this.#endedAtMs ?? fallbackEndedAtMs;
    const end = this.#end ?? fallbackEnd;
    const span = this.#firstResultAtMs === null || this.#lastResultAtMs === null
      ? 0
      : this.#lastResultAtMs - this.#firstResultAtMs;
    const cameraFrameCount = difference(end.cameraFrames, this.#start.cameraFrames);
    const cameraElapsedMs = difference(end.cameraElapsedMs, this.#start.cameraElapsedMs);
    return {
      startedAtMs: this.#startedAtMs,
      endedAtMs,
      durationMs: Math.max(0, endedAtMs - this.#startedAtMs),
      open,
      trackingResultCount: this.#resultCount,
      // Average output rate while results were arriving, so a late scope boundary cannot lower it.
      trackingHz: this.#resultCount >= 2 && span > 0 ? (this.#resultCount - 1) * 1_000 / span : null,
      inferenceP50Ms: this.#inference.quantile(0.5),
      inferenceP95Ms: this.#inference.quantile(0.95),
      inferenceMaxMs: this.#inference.maximum,
      frameAgeP50Ms: this.#frameAge.quantile(0.5),
      frameAgeP95Ms: this.#frameAge.quantile(0.95),
      frameAgeMaxMs: this.#frameAge.maximum,
      callbackToWorkerP50Ms: this.#callbackToWorker.quantile(0.5),
      workerWaitP50Ms: this.#workerWait.quantile(0.5),
      cameraFrameCount,
      cameraFps: cameraFrameCount === null || cameraElapsedMs === null || cameraElapsedMs <= 0
        ? null
        : cameraFrameCount * 1_000 / cameraElapsedMs,
      oneHandCoverage: ratio(this.#oneHandFrames, this.#resultCount),
      twoHandCoverage: ratio(this.#twoHandFrames, this.#resultCount),
      scheduler: schedulerDelta(this.#start.scheduler, end.scheduler),
      longTask: longTaskSupported
        ? {
          supported: true,
          count: this.#longTaskCount,
          totalMs: this.#longTaskTotalMs,
          maxMs: this.#longTaskCount === 0 ? 0 : this.#longTaskMaxMs,
        }
        : { supported: false, count: null, totalMs: null, maxMs: null },
      usedJsHeapSizeAtEndBytes: end.usedJsHeapSizeBytes,
    };
  }
}

/**
 * Counts main-thread long tasks where the browser reports them (Chromium). Safari has no
 * longtask entry type: supported stays false and nothing is observed.
 */
export class LongTaskMonitor {
  readonly #onLongTask: (durationMs: number) => void;
  readonly #supported: boolean;
  #observer: PerformanceObserver | null = null;

  constructor(onLongTask: (durationMs: number) => void) {
    this.#onLongTask = onLongTask;
    this.#supported = longTaskEntriesAvailable();
  }

  get supported(): boolean {
    return this.#supported;
  }

  start(): void {
    if (!this.#supported || this.#observer !== null) return;
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) this.#onLongTask(entry.duration);
      });
      observer.observe({ type: "longtask", buffered: false });
      this.#observer = observer;
    } catch {
      // An environment that lists longtask but refuses to observe it is treated as unsupported.
      this.#observer = null;
    }
  }

  stop(): void {
    this.#observer?.disconnect();
    this.#observer = null;
  }
}

/** usedJSHeapSize is a Chromium extension; other browsers return null. */
export function readUsedJsHeapSizeBytes(): number | null {
  if (typeof performance === "undefined") return null;
  const memory = (performance as Performance & { memory?: { usedJSHeapSize?: unknown } }).memory;
  const value = memory?.usedJSHeapSize;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function longTaskEntriesAvailable(): boolean {
  if (typeof PerformanceObserver === "undefined") return false;
  const types: readonly string[] | undefined = PerformanceObserver.supportedEntryTypes;
  return Array.isArray(types) && types.includes("longtask");
}

function schedulerDelta(
  start: SchedulerSnapshot | null,
  end: SchedulerSnapshot | null,
): SchedulerDeltaSummary | null {
  if (end === null) return null;
  const base = start ?? { captured: 0, completed: 0, replaced: 0, errored: 0 };
  return {
    captured: Math.max(0, end.captured - base.captured),
    completed: Math.max(0, end.completed - base.completed),
    replaced: Math.max(0, end.replaced - base.replaced),
    errored: Math.max(0, end.errored - base.errored),
  };
}

function difference(end: number | null, start: number | null): number | null {
  if (end === null) return null;
  return Math.max(0, end - (start ?? 0));
}

function ratio(count: number, total: number): number | null {
  return total === 0 ? null : count / total;
}
