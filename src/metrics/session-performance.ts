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
  /** v7: frames closed on arrival under the `drop` pending policy. 0 under the default `hold`. */
  readonly dropped: number;
  readonly errored: number;
}

/** How many of the longest long tasks a scope keeps. Memory stays constant however long it runs. */
export const LONG_TASK_RECORD_LIMIT = 3;

/**
 * v7: one of the longest main-thread blocks of a scope. It exists to locate a stall such as the
 * 2796ms one seen in block 1 (docs/18 の2.2), not to list every long task.
 */
export interface LongTaskRecord {
  /** performance.now() of the task's start, so it can be lined up with the trial times. */
  readonly startTimeMs: number;
  readonly durationMs: number;
  /** entry.attribution[0].name where the browser provides it. */
  readonly attributionName: string | null;
  readonly attributionContainerType: string | null;
}

/** Main-thread blocking. Safari has no longtask entries, so supported is false and the counts are null. */
export interface LongTaskSummary {
  readonly supported: boolean;
  readonly count: number | null;
  readonly totalMs: number | null;
  readonly maxMs: number | null;
  /** v7: the three longest tasks of the scope, longest first. Empty where longtask is unsupported. */
  readonly longest: readonly LongTaskRecord[];
}

/**
 * v7 addition: the tracking gap tolerance the judgment used while the scope was open, from the
 * smallest to the largest value the tracker measured. Null when nothing was recorded, which is
 * how every session saved before this field reads. Display and analysis only.
 */
export interface TrackingGapToleranceRange {
  readonly min: number;
  readonly max: number;
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
  /** v7 addition. See TrackingGapToleranceRange. */
  readonly trackingGapToleranceMs: TrackingGapToleranceRange | null;
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
  #gapToleranceMinMs: number | null = null;
  #gapToleranceMaxMs: number | null = null;
  /** At most LONG_TASK_RECORD_LIMIT entries, sorted longest first. */
  readonly #longestTasks: LongTaskRecord[] = [];

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

  /** Records the tracking gap tolerance of one judged frame. Nothing here feeds the judgment. */
  addTrackingGapTolerance(toleranceMs: number): void {
    if (this.#endedAtMs !== null || !Number.isFinite(toleranceMs)) return;
    this.#gapToleranceMinMs = this.#gapToleranceMinMs === null
      ? toleranceMs
      : Math.min(this.#gapToleranceMinMs, toleranceMs);
    this.#gapToleranceMaxMs = this.#gapToleranceMaxMs === null
      ? toleranceMs
      : Math.max(this.#gapToleranceMaxMs, toleranceMs);
  }

  addLongTask(durationMs: number, record: LongTaskRecord | null = null): void {
    if (this.#endedAtMs !== null || !Number.isFinite(durationMs)) return;
    this.#longTaskCount += 1;
    this.#longTaskTotalMs += durationMs;
    this.#longTaskMaxMs = Math.max(this.#longTaskMaxMs, durationMs);
    if (record !== null) this.#keepIfLongest(record);
  }

  /** Insertion sort into a list of at most three, so nothing grows with the number of long tasks. */
  #keepIfLongest(record: LongTaskRecord): void {
    const list = this.#longestTasks;
    const shortest = list.at(-1);
    if (list.length >= LONG_TASK_RECORD_LIMIT && shortest !== undefined && record.durationMs <= shortest.durationMs) {
      return;
    }
    const index = list.findIndex((item) => record.durationMs > item.durationMs);
    list.splice(index < 0 ? list.length : index, 0, record);
    if (list.length > LONG_TASK_RECORD_LIMIT) list.length = LONG_TASK_RECORD_LIMIT;
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
          longest: this.#longestTasks.map((record) => ({ ...record })),
        }
        : { supported: false, count: null, totalMs: null, maxMs: null, longest: [] },
      usedJsHeapSizeAtEndBytes: end.usedJsHeapSizeBytes,
      trackingGapToleranceMs: this.#gapToleranceMinMs === null || this.#gapToleranceMaxMs === null
        ? null
        : { min: this.#gapToleranceMinMs, max: this.#gapToleranceMaxMs },
    };
  }
}

/**
 * Counts main-thread long tasks where the browser reports them (Chromium). Safari has no
 * longtask entry type: supported stays false and nothing is observed.
 */
export class LongTaskMonitor {
  readonly #onLongTask: (durationMs: number, record: LongTaskRecord) => void;
  readonly #supported: boolean;
  #observer: PerformanceObserver | null = null;

  constructor(onLongTask: (durationMs: number, record: LongTaskRecord) => void) {
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
        for (const entry of list.getEntries()) this.#onLongTask(entry.duration, longTaskRecord(entry));
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

/**
 * Reads the start time and the first attribution of one longtask entry. TaskAttributionTiming is
 * not in the DOM types, and browsers differ in what they fill in, so both fields stay null when
 * the entry does not carry them.
 */
function longTaskRecord(entry: PerformanceEntry): LongTaskRecord {
  const attribution: unknown = (entry as PerformanceEntry & { attribution?: unknown }).attribution;
  const first: unknown = Array.isArray(attribution) ? attribution[0] : undefined;
  const source = typeof first === "object" && first !== null
    ? first as { name?: unknown; containerType?: unknown }
    : null;
  return {
    startTimeMs: entry.startTime,
    durationMs: entry.duration,
    attributionName: typeof source?.name === "string" && source.name.length > 0 ? source.name : null,
    attributionContainerType: typeof source?.containerType === "string" && source.containerType.length > 0
      ? source.containerType
      : null,
  };
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
  const base = start ?? { captured: 0, completed: 0, replaced: 0, dropped: 0, errored: 0 };
  return {
    captured: Math.max(0, end.captured - base.captured),
    completed: Math.max(0, end.completed - base.completed),
    replaced: Math.max(0, end.replaced - base.replaced),
    dropped: Math.max(0, end.dropped - base.dropped),
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
