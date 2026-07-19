export type AudioClockMappingSource = "output-timestamp" | "current-time-sample";

export interface AudioClockSample {
  readonly contextTimeSec: number;
  readonly performanceTimeMs: number;
  readonly source: AudioClockMappingSource;
}

export interface AudioClockSnapshot extends AudioClockSample {
  readonly state: AudioContextState;
  readonly baseLatencySec: number | null;
  readonly outputLatencySec: number | null;
}

export class AudioClockMapper {
  #sample: AudioClockSample | null = null;

  update(sample: AudioClockSample): void {
    if (!Number.isFinite(sample.contextTimeSec) || !Number.isFinite(sample.performanceTimeMs)) {
      throw new TypeError("Audio clock samples must be finite.");
    }
    this.#sample = sample;
  }

  toPerformanceTimeMs(contextTimeSec: number): number | null {
    if (this.#sample === null) return null;
    return this.#sample.performanceTimeMs + (contextTimeSec - this.#sample.contextTimeSec) * 1_000;
  }

  toContextTimeSec(performanceTimeMs: number): number | null {
    if (this.#sample === null) return null;
    return this.#sample.contextTimeSec + (performanceTimeMs - this.#sample.performanceTimeMs) / 1_000;
  }

  get sample(): AudioClockSample | null {
    return this.#sample;
  }
}

export class AudioClock {
  readonly #mapper = new AudioClockMapper();
  #context: AudioContext | null = null;

  async enable(): Promise<AudioClockSnapshot> {
    if (this.#context === null) {
      this.#context = new AudioContext({ latencyHint: "interactive" });
    }
    if (this.#context.state === "suspended") await this.#context.resume();
    return this.sample();
  }

  sample(): AudioClockSnapshot {
    const context = this.#requireContext();
    const outputTimestamp = context.getOutputTimestamp?.();
    const outputContextTime = outputTimestamp?.contextTime;
    const outputPerformanceTime = outputTimestamp?.performanceTime;
    const usableOutputTimestamp = outputContextTime !== undefined
      && outputPerformanceTime !== undefined
      && Number.isFinite(outputContextTime)
      && Number.isFinite(outputPerformanceTime)
      && outputPerformanceTime > 0;
    const sample: AudioClockSample = usableOutputTimestamp
      ? {
          contextTimeSec: outputContextTime,
          performanceTimeMs: outputPerformanceTime,
          source: "output-timestamp",
        }
      : {
          contextTimeSec: context.currentTime,
          performanceTimeMs: performance.now(),
          source: "current-time-sample",
        };
    this.#mapper.update(sample);
    return {
      ...sample,
      state: context.state,
      baseLatencySec: finiteOrNull(context.baseLatency),
      outputLatencySec: finiteOrNull(context.outputLatency),
    };
  }

  toPerformanceTimeMs(contextTimeSec: number): number | null {
    this.sample();
    return this.#mapper.toPerformanceTimeMs(contextTimeSec);
  }

  toContextTimeSec(performanceTimeMs: number): number | null {
    this.sample();
    return this.#mapper.toContextTimeSec(performanceTimeMs);
  }

  get context(): AudioContext | null {
    return this.#context;
  }

  async close(): Promise<void> {
    const context = this.#context;
    this.#context = null;
    if (context !== null && context.state !== "closed") await context.close();
  }

  #requireContext(): AudioContext {
    if (this.#context === null) throw new Error("Audio must be enabled by a user gesture first.");
    return this.#context;
  }
}

function finiteOrNull(value: number | undefined): number | null {
  return value !== undefined && Number.isFinite(value) ? value : null;
}
