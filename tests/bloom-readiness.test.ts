import { describe, expect, it } from "vitest";
import { BloomStateMachine } from "../src/gestures/bloom-state-machine";
import { trackedFrame, trackedHand } from "./helpers/gesture-fixtures";

function centered() {
  return [trackedHand("left", 0.42, 0.56), trackedHand("right", 0.58, 0.56)];
}

describe("BloomStateMachine readiness gate", () => {
  it("becomes ready only after both hands stay in the central start position for 200ms", () => {
    const machine = new BloomStateMachine();

    expect(machine.observeReadiness(trackedFrame(0, centered()))).toMatchObject({ inZone: true, ready: false, stableMs: 0 });
    expect(machine.observeReadiness(trackedFrame(150, centered()))).toMatchObject({ ready: false, stableMs: 150 });
    expect(machine.observeReadiness(trackedFrame(200, centered()))).toMatchObject({
      ready: true,
      readyAtMs: 200,
      handIds: ["left", "right"],
    });
  });

  it("restarts the stability timer when a hand is missing or drifts", () => {
    const machine = new BloomStateMachine();
    const shifted = () => [trackedHand("left", 0.36, 0.5), trackedHand("right", 0.58, 0.56)];
    machine.observeReadiness(trackedFrame(0, centered()));

    expect(machine.observeReadiness(trackedFrame(100, [trackedHand("left", 0.42, 0.56)]))).toMatchObject({
      visibleHands: 1,
      inZone: false,
      ready: false,
    });
    machine.observeReadiness(trackedFrame(150, centered()));
    expect(machine.observeReadiness(trackedFrame(300, shifted()))).toMatchObject({ inZone: true, ready: false, stableMs: 0 });
    expect(machine.observeReadiness(trackedFrame(450, shifted()))).toMatchObject({ ready: false, stableMs: 150 });
    expect(machine.observeReadiness(trackedFrame(500, shifted()))).toMatchObject({ ready: true, readyAtMs: 500 });
  });

  it("does not treat widely separated hands as the central start position", () => {
    const machine = new BloomStateMachine();
    const wide = () => [trackedHand("left", 0.2, 0.56), trackedHand("right", 0.8, 0.56)];
    machine.observeReadiness(trackedFrame(0, wide()));

    expect(machine.observeReadiness(trackedFrame(300, wide()))).toMatchObject({ inZone: false, ready: false });
  });

  it("keeps an armed pair waiting for GO without a candidate timeout", () => {
    const machine = new BloomStateMachine();
    machine.process(trackedFrame(0, centered()));
    const waitingRejections = [500, 1_000, 1_500, 2_000].flatMap((timeMs) => machine.process(trackedFrame(timeMs, [
      trackedHand("left", 0.425, 0.555),
      trackedHand("right", 0.585, 0.56),
    ])).rejections);
    machine.process(trackedFrame(2_100, [trackedHand("left", 0.3, 0.48), trackedHand("right", 0.7, 0.48)]));
    const result = machine.process(trackedFrame(2_200, [trackedHand("left", 0.24, 0.44), trackedHand("right", 0.76, 0.44)]));

    expect(waitingRejections).toEqual([]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.eventTimeMs).toBeGreaterThan(2_100);
  });
});
