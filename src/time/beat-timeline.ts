export interface BeatTimelineConfig {
  readonly bpm: number;
  readonly beatZeroContextTimeSec: number;
  readonly beatsPerBar?: number;
}

export class BeatTimeline {
  readonly bpm: number;
  readonly beatZeroContextTimeSec: number;
  readonly beatsPerBar: number;

  constructor(config: BeatTimelineConfig) {
    if (!Number.isFinite(config.bpm) || config.bpm <= 0) throw new RangeError("BPM must be positive.");
    if (!Number.isFinite(config.beatZeroContextTimeSec)) throw new RangeError("beat zero must be finite.");
    const beatsPerBar = config.beatsPerBar ?? 4;
    if (!Number.isInteger(beatsPerBar) || beatsPerBar <= 0) {
      throw new RangeError("beatsPerBar must be a positive integer.");
    }
    this.bpm = config.bpm;
    this.beatZeroContextTimeSec = config.beatZeroContextTimeSec;
    this.beatsPerBar = beatsPerBar;
  }

  beatToContextTimeSec(beat: number): number {
    return this.beatZeroContextTimeSec + beat * 60 / this.bpm;
  }

  contextTimeSecToBeat(contextTimeSec: number): number {
    return (contextTimeSec - this.beatZeroContextTimeSec) * this.bpm / 60;
  }

  nextWholeBeat(contextTimeSec: number, leadBeats = 0): number {
    return Math.ceil(this.contextTimeSecToBeat(contextTimeSec) + leadBeats - Number.EPSILON);
  }

  isBarAccent(beat: number): boolean {
    return modulo(Math.round(beat), this.beatsPerBar) === 0;
  }
}

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}
