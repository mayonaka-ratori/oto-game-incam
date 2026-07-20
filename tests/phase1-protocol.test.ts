import { describe, expect, it } from "vitest";
import {
  P1_CONTROLLED_TRIALS,
  P1_TRIAL_TIMEOUT_MS,
  Phase1ControlledRunner,
} from "../src/poc/phase1-protocol";
import type { GestureEvent } from "../src/gestures/gesture-types";
import { summarizeProtocol } from "../src/poc/phase1-session";

describe("P1 controlled protocol", () => {
  it("encodes the canonical 10 + 10 + 10 controlled sequence", () => {
    expect(P1_CONTROLLED_TRIALS).toHaveLength(30);
    expect(P1_CONTROLLED_TRIALS.slice(0, 10).map(({ gesture }) => gesture)).toEqual(Array(10).fill("air-tap"));
    expect(P1_CONTROLLED_TRIALS.slice(10, 20).map(({ gesture }) => gesture)).toEqual(Array(10).fill("ribbon-swipe"));
    expect(P1_CONTROLLED_TRIALS.slice(20).filter(({ clapMode }) => clapMode === "contact")).toHaveLength(5);
    expect(P1_CONTROLLED_TRIALS.slice(20).filter(({ clapMode }) => clapMode === "near-clap")).toHaveLength(5);
  });

  it("records event offset separately from outcome and false triggers", () => {
    const runner = new Phase1ControlledRunner(P1_CONTROLLED_TRIALS.slice(0, 2));
    runner.start();
    runner.beginNextTrial(1_000);
    runner.acceptEvent(event("air-tap", 1_025));
    runner.beginNextTrial(null);
    runner.recordOutcome("tracking-loss", ["tracking-lost"]);
    expect(runner.snapshot).toMatchObject({ state: "complete", completed: 2, total: 2 });
    expect(runner.snapshot.results[0]).toMatchObject({ outcome: "success", offsetMs: 25 });
    expect(runner.snapshot.results[1]).toMatchObject({ outcome: "tracking-loss", offsetMs: null });
    expect(summarizeProtocol(runner.snapshot)).toMatchObject({
      byGesture: { "air-tap": { completed: 2, success: 1, trackingLoss: 1, offsetP50Ms: 25 } },
      falseTriggers: 0,
    });
  });

  it("requires the detected clap kind to match the controlled trial mode", () => {
    const runner = new Phase1ControlledRunner([
      P1_CONTROLLED_TRIALS[20]!,
      P1_CONTROLLED_TRIALS[25]!,
    ]);
    runner.start();
    runner.beginNextTrial(null);
    expect(runner.acceptEvent(event("clap", 100, { clapKind: "near-clap" }))).toBe(false);
    expect(runner.acceptEvent(event("clap", 110, { clapKind: "contact-like" }))).toBe(true);
    runner.beginNextTrial(null);
    expect(runner.acceptEvent(event("clap", 200, { clapKind: "contact-like" }))).toBe(false);
    expect(runner.acceptEvent(event("clap", 210, { clapKind: "near-clap" }))).toBe(true);
    expect(runner.snapshot).toMatchObject({ completed: 2, falseTriggers: [{}, {}] });
  });

  it("opens the recognition window before target and derives an absolute deadline", () => {
    const runner = new Phase1ControlledRunner(P1_CONTROLLED_TRIALS.slice(0, 1));
    runner.start();
    runner.beginNextTrial(2_000, 100);

    expect(runner.snapshot.activeTiming).toEqual({
      preparedAtMs: 100,
      windowOpenedAtMs: 1_500,
      targetTimeMs: 2_000,
      deadlineTimeMs: 2_000 + P1_TRIAL_TIMEOUT_MS,
    });
  });

  it("counts manual skip as unclassified and records its resolution", () => {
    const runner = new Phase1ControlledRunner(P1_CONTROLLED_TRIALS.slice(0, 1));
    runner.start();
    runner.beginNextTrial(null, 100);

    expect(runner.skip(250)).toBe(true);
    expect(runner.snapshot).toMatchObject({ state: "complete", completed: 1 });
    expect(runner.snapshot.results[0]).toMatchObject({
      outcome: "unclassified",
      resolution: "manual-skip",
      reasonCodes: ["manual-skip"],
      timing: {
        preparedAtMs: 100,
        windowOpenedAtMs: 100,
        targetTimeMs: null,
        deadlineTimeMs: 100 + P1_TRIAL_TIMEOUT_MS,
        finishedAtMs: 250,
      },
    });
  });

  it("finishes a deadline race exactly once", () => {
    const runner = new Phase1ControlledRunner(P1_CONTROLLED_TRIALS.slice(0, 1));
    runner.start();
    runner.beginNextTrial(null, 0);

    expect(runner.timeout(P1_TRIAL_TIMEOUT_MS)).toBe(true);
    expect(runner.acceptEvent(event("air-tap", P1_TRIAL_TIMEOUT_MS))).toBe(false);
    expect(runner.timeout(P1_TRIAL_TIMEOUT_MS + 1)).toBe(false);
    expect(runner.snapshot.results).toHaveLength(1);
    expect(runner.snapshot.results[0]).toMatchObject({
      outcome: "unclassified",
      resolution: "trial-timeout",
      reasonCodes: ["trial-timeout"],
    });
  });

  it("keeps an exact-deadline event when it is established first", () => {
    const runner = new Phase1ControlledRunner(P1_CONTROLLED_TRIALS.slice(0, 1));
    runner.start();
    runner.beginNextTrial(null, 0);

    expect(runner.acceptEvent(event("air-tap", P1_TRIAL_TIMEOUT_MS))).toBe(true);
    expect(runner.timeout(P1_TRIAL_TIMEOUT_MS)).toBe(false);
    expect(runner.snapshot.results).toHaveLength(1);
    expect(runner.snapshot.results[0]?.resolution).toBe("gesture-event");
  });
});

function event(
  gestureType: GestureEvent["gestureType"],
  eventTimeMs: number,
  quality: GestureEvent["quality"] = {},
): GestureEvent {
  return {
    id: "event-1",
    gestureType,
    eventTimeMs,
    handIds: ["hand-1"],
    confidence: 0.9,
    quality,
    trackingQuality: "observed",
    reasonCodes: ["target-crossed"],
  };
}
