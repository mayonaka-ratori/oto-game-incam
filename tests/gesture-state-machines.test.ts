import { describe, expect, it } from "vitest";
import { AirTapStateMachine } from "../src/gestures/air-tap-state-machine";
import { ClapBurstStateMachine } from "../src/gestures/clap-burst-state-machine";
import { GestureArbiter } from "../src/gestures/gesture-arbiter";
import { RibbonSwipeStateMachine } from "../src/gestures/ribbon-swipe-state-machine";
import type { GestureEvent } from "../src/gestures/gesture-types";
import { trackedFrame, trackedHand } from "./helpers/gesture-fixtures";

describe("AirTapStateMachine", () => {
  it("interpolates the target boundary time and enforces speed", () => {
    const machine = new AirTapStateMachine({ centerX: 0.3, centerY: 0.5, radius: 0.1 });
    machine.process(trackedFrame(0, [trackedHand("a", 0.1, 0.5, { x: 1 })]));
    const result = machine.process(trackedFrame(100, [trackedHand("a", 0.25, 0.5, { x: 1.5 })]));
    expect(result.events[0]?.gestureType).toBe("air-tap");
    expect(result.events[0]?.eventTimeMs).toBeCloseTo(66.67);
  });
});

describe("RibbonSwipeStateMachine", () => {
  it("requires the specified direction and records center crossing time", () => {
    const machine = new RibbonSwipeStateMachine({ direction: "left-to-right" });
    machine.process(trackedFrame(0, [trackedHand("a", 0.3, 0.5, { x: 1 })]));
    machine.process(trackedFrame(100, [trackedHand("a", 0.48, 0.5, { x: 1 })]));
    const result = machine.process(trackedFrame(200, [trackedHand("a", 0.7, 0.5, { x: 1 })]));
    expect(result.events[0]).toMatchObject({
      gestureType: "ribbon-swipe",
      eventTimeMs: 109.0909090909091,
      quality: { direction: "left-to-right" },
    });
  });
});

describe("ClapBurstStateMachine", () => {
  it("emits a near clap and a later burst from an unordered pair", () => {
    const machine = new ClapBurstStateMachine();
    machine.process(trackedFrame(0, [trackedHand("a", 0.2, 0.5), trackedHand("b", 0.8, 0.5)]));
    machine.process(trackedFrame(100, [trackedHand("b", 0.58, 0.5), trackedHand("a", 0.42, 0.5)]));
    const clap = machine.process(trackedFrame(120, [trackedHand("a", 0.45, 0.5), trackedHand("b", 0.55, 0.5)]));
    const burst = machine.process(trackedFrame(300, [trackedHand("a", 0.25, 0.5), trackedHand("b", 0.75, 0.5)]));
    expect(clap.events[0]).toMatchObject({ gestureType: "clap", handIds: ["a", "b"] });
    expect(burst.events[0]).toMatchObject({ gestureType: "burst", handIds: ["a", "b"] });
  });

  it("uses only a short observed convergence to predict an occluded clap", () => {
    const machine = new ClapBurstStateMachine();
    machine.process(trackedFrame(0, [trackedHand("a", 0.2, 0.5), trackedHand("b", 0.8, 0.5)]));
    machine.process(trackedFrame(100, [trackedHand("a", 0.4, 0.5), trackedHand("b", 0.6, 0.5)]));
    const result = machine.process(trackedFrame(120, []));
    expect(result.events[0]).toMatchObject({
      gestureType: "clap",
      handIds: ["a", "b"],
      trackingQuality: "short-occlusion-predicted",
      quality: { clapKind: "occlusion-predicted" },
    });
  });
});

describe("GestureArbiter", () => {
  it("prefers a two-hand clap over simultaneous single-hand candidates", () => {
    const arbiter = new GestureArbiter();
    const base = {
      eventTimeMs: 100,
      confidence: 0.8,
      quality: {},
      trackingQuality: "observed" as const,
      reasonCodes: ["target-crossed" as const],
    };
    const events: GestureEvent[] = [
      { ...base, id: "tap", gestureType: "air-tap", handIds: ["a"] },
      { ...base, id: "clap", gestureType: "clap", handIds: ["a", "b"] },
    ];
    expect(arbiter.select(events).map(({ id }) => id)).toEqual(["clap"]);
  });
});
