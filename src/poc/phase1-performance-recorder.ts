import type { SchedulerSnapshot } from "../camera/latest-frame-scheduler";
import {
  LongTaskMonitor,
  PerformanceScopeAccumulator,
  PERFORMANCE_HISTOGRAM_BUCKET_MS,
  readUsedJsHeapSizeBytes,
  type LongTaskRecord,
  type PerformanceScopeCounters,
} from "../metrics/session-performance";
import type { HandTrackingFrame } from "../tracking/tracking-types";
import type { P1Gesture, P1RunnerSnapshot } from "./phase1-protocol";
import type { Phase1BlockPerformance, Phase1PerformanceReport } from "./phase1-session";

/** Counters the screen already holds. The recorder adds the heap reading itself. */
export interface Phase1PerformanceInputs {
  readonly scheduler: SchedulerSnapshot | null;
  readonly cameraFrames: number | null;
  readonly cameraElapsedMs: number | null;
}

interface BlockScope {
  readonly blockIndex: number;
  readonly blockId: string;
  readonly gesture: P1Gesture;
  readonly accumulator: PerformanceScopeAccumulator;
}

/**
 * Whole-session and per-block performance for the P1 result JSON. The recent-window values in
 * technicalSummary say what the device was doing in the last few seconds before saving; these say
 * what it did from the start of the session, and separately inside each block of the protocol.
 *
 * Nothing here feeds the gesture judgement, the trial progression, or the pass counts.
 */
export class Phase1PerformanceRecorder {
  readonly #getInputs: () => Phase1PerformanceInputs;
  readonly #now: () => number;
  readonly #longTasks: LongTaskMonitor;
  readonly #blocks: BlockScope[] = [];
  #session: PerformanceScopeAccumulator | null = null;
  #heapAtStartBytes: number | null = null;

  constructor(getInputs: () => Phase1PerformanceInputs, now: () => number = () => performance.now()) {
    this.#getInputs = getInputs;
    this.#now = now;
    this.#longTasks = new LongTaskMonitor((durationMs, record) => this.#addLongTask(durationMs, record));
  }

  start(): void {
    this.#blocks.length = 0;
    this.#heapAtStartBytes = readUsedJsHeapSizeBytes();
    this.#session = new PerformanceScopeAccumulator(this.#now(), this.#counters());
    this.#longTasks.start();
  }

  stop(): void {
    this.#longTasks.stop();
  }

  addResult(frame: HandTrackingFrame): void {
    const nowMs = this.#now();
    this.#session?.addResult(frame, nowMs);
    for (const block of this.#blocks) {
      if (!block.accumulator.closed) block.accumulator.addResult(frame, nowMs);
    }
  }

  /**
   * Records the tracking gap tolerance the judgment used for one frame, so the saved result says
   * how long a hand could stay unseen on this device. Nothing here feeds the judgment.
   */
  addTrackingGapTolerance(toleranceMs: number): void {
    this.#session?.addTrackingGapTolerance(toleranceMs);
    for (const block of this.#blocks) {
      if (!block.accumulator.closed) block.accumulator.addTrackingGapTolerance(toleranceMs);
    }
  }

  /** Opens a block scope once the block has started and closes it once the block has finished. */
  syncBlocks(protocol: P1RunnerSnapshot): void {
    if (this.#session === null) return;
    for (const block of protocol.blocks) {
      if (block.startedAtMs === null) continue;
      let scope = this.#blocks.find((candidate) => candidate.blockIndex === block.index);
      if (scope === undefined) {
        scope = {
          blockIndex: block.index,
          blockId: block.id,
          gesture: block.gesture,
          accumulator: new PerformanceScopeAccumulator(block.startedAtMs, this.#counters()),
        };
        this.#blocks.push(scope);
      }
      if (block.finishedAtMs !== null && !scope.accumulator.closed) {
        scope.accumulator.close(block.finishedAtMs, this.#counters());
      }
    }
  }

  report(): Phase1PerformanceReport | null {
    const session = this.#session;
    if (session === null) return null;
    const nowMs = this.#now();
    const counters = this.#counters();
    const supported = this.#longTasks.supported;
    const blocks: Phase1BlockPerformance[] = this.#blocks
      .map((block) => ({
        blockIndex: block.blockIndex,
        blockId: block.blockId,
        gesture: block.gesture,
        ...block.accumulator.summary(nowMs, counters, supported),
      }))
      .sort((left, right) => left.blockIndex - right.blockIndex);
    return {
      histogramBucketMs: PERFORMANCE_HISTOGRAM_BUCKET_MS,
      longTaskSupported: supported,
      memorySupported: counters.usedJsHeapSizeBytes !== null || this.#heapAtStartBytes !== null,
      usedJsHeapSizeAtStartBytes: this.#heapAtStartBytes,
      usedJsHeapSizeAtExportBytes: counters.usedJsHeapSizeBytes,
      session: session.summary(nowMs, counters, supported),
      blocks,
    };
  }

  #addLongTask(durationMs: number, record: LongTaskRecord): void {
    this.#session?.addLongTask(durationMs, record);
    for (const block of this.#blocks) {
      if (!block.accumulator.closed) block.accumulator.addLongTask(durationMs, record);
    }
  }

  #counters(): PerformanceScopeCounters {
    const inputs = this.#getInputs();
    return {
      scheduler: inputs.scheduler,
      cameraFrames: inputs.cameraFrames,
      cameraElapsedMs: inputs.cameraElapsedMs,
      usedJsHeapSizeBytes: readUsedJsHeapSizeBytes(),
    };
  }
}
