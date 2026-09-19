import { describe, expect, it } from "vitest";
import {
  BEAT_MS,
  COUNT_IN_LEAD_MS,
  GOOD_DISPLAY_MS,
  GO_DISPLAY_MS,
  stageCue,
} from "../src/rendering/stage-cue";

const TARGET = 10_000;
const timing = { targetTimeMs: TARGET, windowOpenedAtMs: TARGET - 500 };
const NEVER = Number.NEGATIVE_INFINITY;

describe("the count over the camera image", () => {
  it("shows nothing before the first click", () => {
    expect(stageCue(TARGET - COUNT_IN_LEAD_MS - 1, timing, NEVER)).toEqual({ text: "", kind: "none" });
  });

  it("shows 2 and 1 on the two beats before GO", () => {
    // The metronome clicks at target - 2 beats, target - 1 beat, and target.
    expect(stageCue(TARGET - COUNT_IN_LEAD_MS, timing, NEVER)).toEqual({ text: "2", kind: "count" });
    expect(stageCue(TARGET - BEAT_MS - 1, timing, NEVER)).toEqual({ text: "2", kind: "count" });
    expect(stageCue(TARGET - BEAT_MS, timing, NEVER)).toEqual({ text: "1", kind: "count" });
    expect(stageCue(TARGET - 1, timing, NEVER)).toEqual({ text: "1", kind: "count" });
  });

  it("shows GO from the target time for about six tenths of a second", () => {
    expect(stageCue(TARGET, timing, NEVER)).toEqual({ text: "GO", kind: "go" });
    expect(stageCue(TARGET + GO_DISPLAY_MS - 1, timing, NEVER)).toEqual({ text: "GO", kind: "go" });
    expect(stageCue(TARGET + GO_DISPLAY_MS, timing, NEVER)).toEqual({ text: "", kind: "none" });
  });

  it("falls back to the window opening when there is no count-in", () => {
    const withoutAudio = { targetTimeMs: null, windowOpenedAtMs: TARGET };
    expect(stageCue(TARGET - 1, withoutAudio, NEVER)).toEqual({ text: "", kind: "none" });
    expect(stageCue(TARGET, withoutAudio, NEVER)).toEqual({ text: "GO", kind: "go" });
    expect(stageCue(TARGET + GO_DISPLAY_MS, withoutAudio, NEVER)).toEqual({ text: "", kind: "none" });
  });

  it("shows GOOD after a success and nothing after a timeout", () => {
    const finishedAtMs = TARGET + 2_000;
    expect(stageCue(finishedAtMs, null, finishedAtMs + GOOD_DISPLAY_MS)).toEqual({ text: "GOOD", kind: "good" });
    expect(stageCue(finishedAtMs + GOOD_DISPLAY_MS - 1, null, finishedAtMs + GOOD_DISPLAY_MS))
      .toEqual({ text: "GOOD", kind: "good" });
    expect(stageCue(finishedAtMs + GOOD_DISPLAY_MS, null, finishedAtMs + GOOD_DISPLAY_MS))
      .toEqual({ text: "", kind: "none" });
    // A timeout never sets a GOOD deadline, so the middle of the image stays empty.
    expect(stageCue(finishedAtMs, null, NEVER)).toEqual({ text: "", kind: "none" });
  });

  it("depends on the time only, so it never follows the drawing rate", () => {
    const first = stageCue(TARGET - 250, timing, NEVER);
    const second = stageCue(TARGET - 250, timing, NEVER);
    expect(second).toEqual(first);
  });
});
