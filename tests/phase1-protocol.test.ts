import { describe, expect, it } from "vitest";
import {
  P1_CONTROLLED_TRIALS,
  P1_FIVE_GESTURE_PROTOCOL,
  P1_LEGACY_CLAP_TRIALS,
  P1_READINESS_TIMEOUT_MS,
  P1_TRIAL_TIMEOUT_MS,
  Phase1ControlledRunner,
} from "../src/poc/phase1-protocol";
import type { GestureEvent } from "../src/gestures/gesture-types";
import { summarizeProtocol } from "../src/poc/phase1-session";

describe("P1 controlled protocol", () => {
  it("limits each recognition window and each readiness phase to 10 seconds", () => {
    expect(P1_TRIAL_TIMEOUT_MS).toBe(10_000);
    expect(P1_READINESS_TIMEOUT_MS).toBe(10_000);
  });

  it("encodes the canonical five-gesture 50-trial sequence in five blocks", () => {
    const order = ["air-tap", "ribbon-swipe", "bloom", "lift", "spotlight"];
    expect(P1_FIVE_GESTURE_PROTOCOL).toMatchObject({
      id: "p1-five-gesture-50",
      trialsPerGesture: 10,
      gestures: order,
    });
    expect(P1_CONTROLLED_TRIALS).toHaveLength(50);
    expect(P1_CONTROLLED_TRIALS.map(({ ordinal }) => ordinal)).toEqual(Array.from({ length: 50 }, (_, index) => index + 1));
    order.forEach((gesture, block) => {
      expect(P1_CONTROLLED_TRIALS.slice(block * 10, block * 10 + 10).map((trial) => trial.gesture))
        .toEqual(Array(10).fill(gesture));
    });
    expect(P1_FIVE_GESTURE_PROTOCOL.blocks.map(({ gesture, firstOrdinal, lastOrdinal, restAfter }) => (
      { gesture, firstOrdinal, lastOrdinal, restAfter }
    ))).toEqual([
      { gesture: "air-tap", firstOrdinal: 1, lastOrdinal: 10, restAfter: "none" },
      { gesture: "ribbon-swipe", firstOrdinal: 11, lastOrdinal: 20, restAfter: "none" },
      { gesture: "bloom", firstOrdinal: 21, lastOrdinal: 30, restAfter: "none" },
      { gesture: "lift", firstOrdinal: 31, lastOrdinal: 40, restAfter: "none" },
      { gesture: "spotlight", firstOrdinal: 41, lastOrdinal: 50, restAfter: "none" },
    ]);
    expect(P1_CONTROLLED_TRIALS.filter(({ requiresReadiness }) => requiresReadiness === true).map(({ gesture }) => gesture))
      .toEqual([...Array(10).fill("bloom"), ...Array(10).fill("lift")]);
    const spotlight = P1_CONTROLLED_TRIALS.slice(40).map(({ spotlightVariant }) => spotlightVariant);
    expect(spotlight.filter((variant) => variant === "left-up-right-down")).toHaveLength(5);
    expect(spotlight.filter((variant) => variant === "right-up-left-down")).toHaveLength(5);
    expect(spotlight.slice(0, 2)).toEqual(["left-up-right-down", "right-up-left-down"]);
    expect(P1_LEGACY_CLAP_TRIALS.filter(({ clapMode }) => clapMode === "contact")).toHaveLength(5);
    expect(P1_LEGACY_CLAP_TRIALS.filter(({ clapMode }) => clapMode === "near-clap")).toHaveLength(5);
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

  it("requires observed clap kinds to match the controlled trial mode", () => {
    const runner = new Phase1ControlledRunner([
      P1_LEGACY_CLAP_TRIALS[0]!,
      P1_LEGACY_CLAP_TRIALS[5]!,
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

  it("accepts an occlusion-predicted clap as inferred contact without a false trigger", () => {
    const runner = new Phase1ControlledRunner([P1_LEGACY_CLAP_TRIALS[0]!]);
    runner.start();
    runner.beginNextTrial(null);

    expect(runner.acceptEvent(event("clap", 100, { clapKind: "occlusion-predicted" }))).toBe(true);
    expect(runner.snapshot).toMatchObject({
      state: "complete",
      completed: 1,
      falseTriggers: [],
      results: [{
        outcome: "success",
        event: {
          quality: { clapKind: "occlusion-predicted" },
          reasonCodes: ["target-crossed"],
        },
      }],
    });
  });

  it("opens the recognition window before target and derives an absolute deadline", () => {
    const runner = new Phase1ControlledRunner(P1_CONTROLLED_TRIALS.slice(0, 1));
    runner.start();
    runner.beginNextTrial(2_000, 100);

    expect(runner.snapshot.activeTiming).toEqual({
      preparedAtMs: 100,
      readyAtMs: null,
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
      timeoutPhase: null,
      finishedAtMs: 250,
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
      timeoutPhase: "recognition",
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

  it("waits in a readiness phase before a gated trial and derives the window from GO", () => {
    const runner = new Phase1ControlledRunner(P1_CONTROLLED_TRIALS.slice(20, 21));
    runner.start();

    expect(runner.beginNextTrial(9_999, 100)?.gesture).toBe("bloom");
    expect(runner.snapshot).toMatchObject({
      activeTiming: null,
      activeReadiness: {
        startedAtMs: 100,
        deadlineTimeMs: 100 + P1_READINESS_TIMEOUT_MS,
        requiredStableMs: 200,
        readyAtMs: null,
      },
    });
    expect(runner.acceptEvent(event("bloom", 150))).toBe(false);
    expect(runner.snapshot.falseTriggers).toHaveLength(0);
    expect(runner.startRecognition(400, 2_000)).toBe(true);
    expect(runner.snapshot.activeTiming).toEqual({
      preparedAtMs: 100,
      readyAtMs: 400,
      windowOpenedAtMs: 1_500,
      targetTimeMs: 2_000,
      deadlineTimeMs: 12_000,
    });
    expect(runner.acceptEvent(event("bloom", 2_040))).toBe(true);
    expect(runner.snapshot.results[0]).toMatchObject({
      outcome: "success",
      offsetMs: 40,
      readiness: { readyAtMs: 400 },
      timing: { readyAtMs: 400, finishedAtMs: 2_040 },
      timeoutPhase: null,
    });
  });

  it("separates a readiness timeout from a recognition timeout", () => {
    const runner = new Phase1ControlledRunner([P1_CONTROLLED_TRIALS[30]!, P1_CONTROLLED_TRIALS[31]!]);
    runner.start();
    runner.beginNextTrial(null, 0);
    expect(runner.timeout(P1_READINESS_TIMEOUT_MS, { readinessReasonCodes: ["lift-not-ready"] })).toBe(true);
    runner.beginNextTrial(null, 20_000);
    runner.startRecognition(20_300, null);
    expect(runner.timeout(30_300)).toBe(true);

    const [readiness, recognition] = runner.snapshot.results;
    expect(readiness).toMatchObject({
      outcome: "unclassified",
      resolution: "trial-timeout",
      timeoutPhase: "readiness",
      timing: null,
      readiness: { readyAtMs: null },
      reasonCodes: ["readiness-timeout", "lift-not-ready"],
    });
    expect(recognition).toMatchObject({
      timeoutPhase: "recognition",
      reasonCodes: ["trial-timeout"],
      timing: { readyAtMs: 20_300, windowOpenedAtMs: 20_300, deadlineTimeMs: 30_300 },
    });
    expect(summarizeProtocol(runner.snapshot).byGesture.lift).toMatchObject({
      completed: 2,
      unclassified: 2,
      trialTimeout: 2,
      readinessTimeout: 1,
      recognitionTimeout: 1,
      readinessP50Ms: 300,
    });
  });

  it("records block starts, rest time, and pauses without counting paused time", () => {
    const runner = new Phase1ControlledRunner([
      ...P1_CONTROLLED_TRIALS.slice(0, 2),
      ...P1_CONTROLLED_TRIALS.slice(10, 12),
    ]);
    runner.start();
    expect(runner.snapshot).toMatchObject({ awaitingBlockStart: true, currentBlockIndex: 0 });
    expect(runner.startBlock(50)).toBe(true);
    expect(runner.startBlock(60)).toBe(false);
    runner.beginNextTrial(null, 100);

    expect(runner.pause(200)).toEqual({ paused: true, abandonedTrial: expect.objectContaining({ id: "air-tap-1" }) });
    expect(runner.beginNextTrial(null, 250)).toBeNull();
    expect(runner.resume(1_200)).toBe(true);
    runner.beginNextTrial(null, 1_300);
    runner.skip(1_400);
    runner.beginNextTrial(null, 2_500);
    runner.skip(2_600);
    expect(runner.snapshot).toMatchObject({ awaitingBlockStart: true, currentBlockIndex: 1 });
    expect(runner.startBlock(5_600)).toBe(true);

    const [first, second] = runner.snapshot.blocks;
    expect(first).toMatchObject({
      startedAtMs: 50,
      finishedAtMs: 2_600,
      restBeforeMs: null,
      pausedMs: 1_000,
      pauses: [{ startedAtMs: 200, resumedAtMs: 1_200, reason: "manual", abandonedTrialId: "air-tap-1" }],
    });
    expect(second).toMatchObject({ startedAtMs: 5_600, restBeforeMs: 3_000, finishedAtMs: null });
    expect(runner.snapshot.results[0]).toMatchObject({ trial: { id: "air-tap-1" }, attempt: 2, timing: { preparedAtMs: 1_300 } });
    expect(runner.snapshot.results[1]).toMatchObject({ attempt: 1 });
  });

  it("does not pause outside a started block", () => {
    const runner = new Phase1ControlledRunner(P1_CONTROLLED_TRIALS.slice(0, 1));
    runner.start();

    expect(runner.pause(10)).toEqual({ paused: false, abandonedTrial: null });
  });

  it("requires the Spotlight variant to match", () => {
    const runner = new Phase1ControlledRunner(P1_CONTROLLED_TRIALS.slice(40, 41));
    runner.start();
    runner.beginNextTrial(null, 0);

    expect(runner.acceptEvent(event("spotlight", 100, { spotlightVariant: "right-up-left-down" }))).toBe(false);
    expect(runner.acceptEvent(event("spotlight", 120, { spotlightVariant: "left-up-right-down" }))).toBe(true);
    expect(runner.snapshot.falseTriggers).toHaveLength(1);
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
