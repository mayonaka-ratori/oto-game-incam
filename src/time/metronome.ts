import type { BeatTimeline } from "./beat-timeline";

export class Metronome {
  readonly #context: AudioContext;
  readonly #timeline: BeatTimeline;
  readonly #scheduled = new Set<OscillatorNode>();

  constructor(context: AudioContext, timeline: BeatTimeline) {
    this.#context = context;
    this.#timeline = timeline;
  }

  scheduleBeat(beat: number): void {
    const time = this.#timeline.beatToContextTimeSec(beat);
    const oscillator = this.#context.createOscillator();
    const gain = this.#context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(this.#timeline.isBarAccent(beat) ? 1_040 : 780, time);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.11, time + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.055);
    oscillator.connect(gain).connect(this.#context.destination);
    oscillator.addEventListener("ended", () => {
      this.#scheduled.delete(oscillator);
      gain.disconnect();
    });
    this.#scheduled.add(oscillator);
    oscillator.start(time);
    oscillator.stop(time + 0.065);
  }

  /** Silences every click that has not played yet, so a pause or a skipped trial leaves no stray count-in. */
  cancelScheduled(): void {
    const now = this.#context.currentTime;
    for (const oscillator of this.#scheduled) {
      try {
        oscillator.stop(now);
      } catch {
        // A node that already stopped needs nothing more.
      }
      oscillator.disconnect();
    }
    this.#scheduled.clear();
  }
}
