import { describe, expect, it } from "vitest";
import {
  DEFAULT_P1_PROTOCOL_SELECTOR,
  P1_FIVE_GESTURE_PROTOCOL,
  P1_REGRESSION_THREE_PROTOCOL,
  P1_REMAINING_TWO_PROTOCOL,
  Phase1ControlledRunner,
  resolveP1Protocol,
  resolveP1ProtocolSelector,
} from "../src/poc/phase1-protocol";

// The three procedures a tester can run from the URL, and what each one is supposed to contain.
// Their trial definitions are reused from the five-gesture protocol, so a ribbon-swipe result of
// the 20-trial run can be read against the same trial of the 50-trial run.

describe("P1 protocol selection from the query string", () => {
  it("defaults to the remaining two gestures", () => {
    expect(DEFAULT_P1_PROTOCOL_SELECTOR).toBe("remaining-two");
    for (const search of ["", "?", "?view=analysis", "?protocol=", "?protocol=unknown", "?protocol=FIVEX"]) {
      expect(resolveP1Protocol(search).id, search).toBe("p1-remaining-two-20");
    }
  });

  it("selects the five-gesture and regression procedures by name, ignoring case and spaces", () => {
    expect(resolveP1Protocol("?protocol=five")).toBe(P1_FIVE_GESTURE_PROTOCOL);
    expect(resolveP1Protocol("?protocol=Five")).toBe(P1_FIVE_GESTURE_PROTOCOL);
    expect(resolveP1Protocol("?protocol=regression")).toBe(P1_REGRESSION_THREE_PROTOCOL);
    expect(resolveP1Protocol("?view=analysis&protocol=%20regression%20")).toBe(P1_REGRESSION_THREE_PROTOCOL);
    expect(resolveP1ProtocolSelector("?protocol=five")).toBe("five");
  });

  it("runs ribbon-swipe 10 times and Bloom 10 times in two blocks by default", () => {
    expect(P1_REMAINING_TWO_PROTOCOL).toMatchObject({
      id: "p1-remaining-two-20",
      trialsPerGesture: 10,
      gestures: ["ribbon-swipe", "bloom"],
    });
    expect(P1_REMAINING_TWO_PROTOCOL.trials).toHaveLength(20);
    expect(P1_REMAINING_TWO_PROTOCOL.blocks.map(({ gesture, firstOrdinal, lastOrdinal }) => (
      { gesture, firstOrdinal, lastOrdinal }
    ))).toEqual([
      { gesture: "ribbon-swipe", firstOrdinal: 1, lastOrdinal: 10 },
      { gesture: "bloom", firstOrdinal: 11, lastOrdinal: 20 },
    ]);
  });

  it("keeps the ribbon-swipe directions, the Bloom readiness gate, and the trial ids of the five-gesture run", () => {
    const fiveSwipes = P1_FIVE_GESTURE_PROTOCOL.trials.filter(({ gesture }) => gesture === "ribbon-swipe");
    const twoSwipes = P1_REMAINING_TWO_PROTOCOL.trials.filter(({ gesture }) => gesture === "ribbon-swipe");
    const fiveBlooms = P1_FIVE_GESTURE_PROTOCOL.trials.filter(({ gesture }) => gesture === "bloom");
    const twoBlooms = P1_REMAINING_TWO_PROTOCOL.trials.filter(({ gesture }) => gesture === "bloom");
    const withoutOrdinal = (trial: { ordinal: number }): unknown => {
      const copy: Record<string, unknown> = { ...trial };
      delete copy.ordinal;
      return copy;
    };

    expect(twoSwipes.map(withoutOrdinal)).toEqual(fiveSwipes.map(withoutOrdinal));
    expect(twoBlooms.map(withoutOrdinal)).toEqual(fiveBlooms.map(withoutOrdinal));
    expect(twoSwipes.map(({ id }) => id)).toEqual(Array.from({ length: 10 }, (_, index) => `ribbon-swipe-${index + 1}`));
    expect(twoBlooms.every(({ requiresReadiness }) => requiresReadiness === true)).toBe(true);
    expect(twoSwipes.map(({ swipeDirection }) => swipeDirection)).toEqual([
      "left-to-right", "right-to-left",
      "left-to-right", "right-to-left",
      "left-to-right", "right-to-left",
      "lower-left-to-upper-right", "lower-right-to-upper-left",
      "lower-left-to-upper-right", "lower-right-to-upper-left",
    ]);
  });

  it("runs the three confirmed gestures three times each, with the sides evenly split overall", () => {
    expect(P1_REGRESSION_THREE_PROTOCOL).toMatchObject({
      id: "p1-regression-three-9",
      trialsPerGesture: 3,
      gestures: ["air-tap", "lift", "spotlight"],
    });
    expect(P1_REGRESSION_THREE_PROTOCOL.trials).toHaveLength(9);
    expect(P1_REGRESSION_THREE_PROTOCOL.blocks).toHaveLength(3);
    const airTapSides = P1_REGRESSION_THREE_PROTOCOL.trials.flatMap(({ airTapSide }) => airTapSide ?? []);
    const variants = P1_REGRESSION_THREE_PROTOCOL.trials.flatMap(({ spotlightVariant }) => spotlightVariant ?? []);
    expect(airTapSides).toEqual(["left", "right", "left"]);
    expect(variants).toEqual(["right-up-left-down", "left-up-right-down", "right-up-left-down"]);
    // Three trials cannot split a side evenly, so the two gestures start on opposite sides and the
    // six two-sided trials come out three left-leading and three right-leading.
    const leftLeading = airTapSides.filter((side) => side === "left").length
      + variants.filter((variant) => variant === "left-up-right-down").length;
    expect(leftLeading).toBe(3);
  });

  it("lets the runner finish a protocol whose length is not 50 trials", () => {
    const runner = new Phase1ControlledRunner(P1_REGRESSION_THREE_PROTOCOL);
    runner.start();
    for (let index = 0; index < 9; index += 1) {
      const trial = runner.beginNextTrial(null, index * 100);
      expect(trial).not.toBeNull();
      if (trial?.requiresReadiness === true) runner.startRecognition(index * 100 + 50, null);
      runner.timeout(index * 100 + 60);
    }
    const snapshot = runner.snapshot;

    expect(snapshot).toMatchObject({ id: "p1-regression-three-9", state: "complete", completed: 9, total: 9 });
    expect(snapshot.blocks).toHaveLength(3);
    expect(snapshot.blocks.every(({ startedAtMs, finishedAtMs }) => (
      startedAtMs !== null && finishedAtMs !== null
    ))).toBe(true);
  });
});
