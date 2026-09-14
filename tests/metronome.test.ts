import { describe, expect, it } from "vitest";
import { BeatTimeline } from "../src/time/beat-timeline";
import { Metronome } from "../src/time/metronome";

class FakeParam {
  setValueAtTime(): this {
    return this;
  }

  exponentialRampToValueAtTime(): this {
    return this;
  }
}

class FakeNode {
  disconnected = false;

  connect<T>(node: T): T {
    return node;
  }

  disconnect(): void {
    this.disconnected = true;
  }
}

class FakeOscillator extends FakeNode {
  type = "sine";
  readonly frequency = new FakeParam();
  startedAt: number | null = null;
  readonly stops: number[] = [];

  addEventListener(): void {}

  start(time: number): void {
    this.startedAt = time;
  }

  stop(time: number): void {
    this.stops.push(time);
  }
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam();
}

describe("Metronome", () => {
  it("silences scheduled count-in clicks when they are cancelled", () => {
    const oscillators: FakeOscillator[] = [];
    const context = {
      currentTime: 1,
      destination: new FakeNode(),
      createOscillator: () => {
        const oscillator = new FakeOscillator();
        oscillators.push(oscillator);
        return oscillator;
      },
      createGain: () => new FakeGain(),
    } as unknown as AudioContext;
    const metronome = new Metronome(context, new BeatTimeline({ bpm: 120, beatZeroContextTimeSec: 0 }));
    metronome.scheduleBeat(4);
    metronome.scheduleBeat(5);

    expect(oscillators.map(({ startedAt }) => startedAt)).toEqual([2, 2.5]);
    metronome.cancelScheduled();

    // stop(now) replaces the scheduled stop, and a click stopped before its start never plays.
    expect(oscillators.map(({ stops }) => stops.at(-1))).toEqual([1, 1]);
    expect(oscillators.every(({ disconnected }) => disconnected)).toBe(true);
  });
});
