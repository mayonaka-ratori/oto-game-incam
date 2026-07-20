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

  it("only arms at the start position during preparation", () => {
    const machine = new RibbonSwipeStateMachine({ direction: "left-to-right" });
    const start = machine.prepare(trackedFrame(0, [trackedHand("a", 0.3, 0.5)]));
    const earlyMovement = machine.prepare(trackedFrame(100, [trackedHand("a", 0.7, 0.5, { x: 1 })]));
    machine.process(trackedFrame(200, [trackedHand("a", 0.3, 0.5)]));
    machine.process(trackedFrame(300, [trackedHand("a", 0.5, 0.5, { x: 1 })]));
    const active = machine.process(trackedFrame(400, [trackedHand("a", 0.7, 0.5, { x: 1 })]));

    expect(start).toMatchObject({ events: [], rejections: [] });
    expect(earlyMovement).toMatchObject({ events: [], rejections: [] });
    expect(active.events).toHaveLength(1);
  });

  it("recognizes right-to-left at low tracking frequency", () => {
    const machine = new RibbonSwipeStateMachine({ direction: "right-to-left" });
    machine.process(trackedFrame(0, [trackedHand("a", 0.7, 0.5, { x: -1 })]));
    machine.process(trackedFrame(125, [trackedHand("a", 0.52, 0.5, { x: -1 })]));
    const result = machine.process(trackedFrame(250, [trackedHand("a", 0.3, 0.5, { x: -1 })]));

    expect(result.events[0]).toMatchObject({
      gestureType: "ribbon-swipe",
      quality: { direction: "right-to-left" },
    });
  });

  it("does not time out while the hand holds the start position", () => {
    const machine = new RibbonSwipeStateMachine({ direction: "left-to-right" });
    machine.process(trackedFrame(0, [trackedHand("a", 0.3, 0.5)]));
    const held = machine.process(trackedFrame(1_500, [trackedHand("a", 0.3, 0.5)]));
    machine.process(trackedFrame(1_625, [trackedHand("a", 0.48, 0.5, { x: 1 })]));
    const result = machine.process(trackedFrame(1_750, [trackedHand("a", 0.7, 0.5, { x: 1 })]));

    expect(held.rejections).toHaveLength(0);
    expect(result.events).toHaveLength(1);
  });

  it("keeps a traversing candidate through a 150ms tracking gap", () => {
    const machine = new RibbonSwipeStateMachine({ direction: "left-to-right" });
    machine.process(trackedFrame(0, [trackedHand("a", 0.3, 0.5)]));
    machine.process(trackedFrame(100, [trackedHand("a", 0.48, 0.5, { x: 1 })]));
    const gap = machine.process(trackedFrame(225, []));
    const result = machine.process(trackedFrame(250, [trackedHand("a", 0.7, 0.5, { x: 1 })]));

    expect(gap.rejections).toHaveLength(0);
    expect(result.events).toHaveLength(1);
  });

  it("records one tracking-lost rejection after a long gap and can rearm", () => {
    const machine = new RibbonSwipeStateMachine({ direction: "left-to-right" });
    machine.process(trackedFrame(0, [trackedHand("a", 0.3, 0.5)]));
    machine.process(trackedFrame(100, [trackedHand("a", 0.48, 0.5, { x: 1 })]));
    const lost = machine.process(trackedFrame(251, []));
    const stillLost = machine.process(trackedFrame(400, []));
    machine.process(trackedFrame(500, [trackedHand("a", 0.3, 0.5)]));
    machine.process(trackedFrame(625, [trackedHand("a", 0.52, 0.5, { x: 1 })]));
    const result = machine.process(trackedFrame(750, [trackedHand("a", 0.7, 0.5, { x: 1 })]));

    expect(lost.rejections).toEqual([expect.objectContaining({ reasonCodes: ["tracking-lost"] })]);
    expect(stillLost.rejections).toHaveLength(0);
    expect(result.events).toHaveLength(1);
  });

  it("records off-axis once and can rearm", () => {
    const machine = new RibbonSwipeStateMachine({ direction: "left-to-right" });
    machine.process(trackedFrame(0, [trackedHand("a", 0.3, 0.5)]));
    const rejected = machine.process(trackedFrame(100, [trackedHand("a", 0.48, 0.75, { x: 1 })]));
    machine.process(trackedFrame(200, [trackedHand("a", 0.3, 0.5)]));
    machine.process(trackedFrame(325, [trackedHand("a", 0.52, 0.5, { x: 1 })]));
    const result = machine.process(trackedFrame(450, [trackedHand("a", 0.7, 0.5, { x: 1 })]));

    expect(rejected.rejections).toEqual([expect.objectContaining({ reasonCodes: ["off-axis"] })]);
    expect(result.events).toHaveLength(1);
  });

  it("records wrong-direction only when moving away from an armed start", () => {
    const machine = new RibbonSwipeStateMachine({ direction: "left-to-right" });
    machine.process(trackedFrame(0, [trackedHand("a", 0.3, 0.5)]));
    const rejected = machine.process(trackedFrame(100, [trackedHand("a", 0.2, 0.5, { x: -1 })]));
    const followUp = machine.process(trackedFrame(200, []));

    expect(rejected.rejections).toEqual([expect.objectContaining({ reasonCodes: ["wrong-direction"] })]);
    expect(followUp.rejections).toHaveLength(0);
  });

  it("starts the 850ms timeout when traversal begins", () => {
    const machine = new RibbonSwipeStateMachine({ direction: "left-to-right" });
    machine.process(trackedFrame(0, [trackedHand("a", 0.3, 0.5)]));
    machine.process(trackedFrame(1_500, [trackedHand("a", 0.3, 0.5)]));
    machine.process(trackedFrame(1_600, [trackedHand("a", 0.4, 0.5, { x: 1 })]));
    const rejected = machine.process(trackedFrame(2_451, [trackedHand("a", 0.45, 0.5)]));

    expect(rejected.rejections).toEqual([expect.objectContaining({ reasonCodes: ["candidate-timeout"] })]);
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
