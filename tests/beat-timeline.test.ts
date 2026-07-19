import { describe, expect, it } from "vitest";
import { BeatTimeline } from "../src/time/beat-timeline";

describe("BeatTimeline", () => {
  it("converts beats and audio time exactly at constant BPM", () => {
    const timeline = new BeatTimeline({ bpm: 120, beatZeroContextTimeSec: 10 });
    expect(timeline.beatToContextTimeSec(4)).toBe(12);
    expect(timeline.contextTimeSecToBeat(11.25)).toBe(2.5);
    expect(timeline.nextWholeBeat(11.26)).toBe(3);
  });

  it("marks bar accents without assuming playback starts at beat zero", () => {
    const timeline = new BeatTimeline({ bpm: 100, beatZeroContextTimeSec: 3, beatsPerBar: 3 });
    expect(timeline.isBarAccent(0)).toBe(true);
    expect(timeline.isBarAccent(3)).toBe(true);
    expect(timeline.isBarAccent(2)).toBe(false);
  });
});
