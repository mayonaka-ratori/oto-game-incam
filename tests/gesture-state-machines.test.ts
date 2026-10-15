import { describe, expect, it } from "vitest";
import { AirTapStateMachine } from "../src/gestures/air-tap-state-machine";
import { BloomStateMachine } from "../src/gestures/bloom-state-machine";
import { RibbonSwipeStateMachine } from "../src/gestures/ribbon-swipe-state-machine";
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

  // wrong-direction after 2026-09-20: a hand that has not set off is never judged, and a hand
  // that has is measured from the furthest point it reached, not between two frames.
  it("lets an armed hand sway without judging it, and still accepts the swipe that follows", () => {
    const machine = new RibbonSwipeStateMachine({ direction: "left-to-right" });
    machine.process(trackedFrame(0, [trackedHand("a", 0.3, 0.5)]));
    const swaying = [
      machine.process(trackedFrame(100, [trackedHand("a", 0.25, 0.5, { x: -0.5 })])),
      machine.process(trackedFrame(200, [trackedHand("a", 0.28, 0.5, { x: 0.3 })])),
      machine.process(trackedFrame(300, [trackedHand("a", 0.25, 0.5, { x: -0.3 })])),
    ];
    machine.process(trackedFrame(400, [trackedHand("a", 0.45, 0.5, { x: 2 })]));
    const result = machine.process(trackedFrame(500, [trackedHand("a", 0.7, 0.5, { x: 2 })]));

    expect(swaying.flatMap(({ rejections }) => rejections)).toEqual([]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.quality.direction).toBe("left-to-right");
  });

  it("accepts a swipe that falls back for one frame and then carries on", () => {
    const machine = new RibbonSwipeStateMachine({ direction: "left-to-right" });
    machine.process(trackedFrame(0, [trackedHand("a", 0.3, 0.5)]));
    machine.process(trackedFrame(100, [trackedHand("a", 0.45, 0.5, { x: 1.5 })]));
    const dip = machine.process(trackedFrame(200, [trackedHand("a", 0.42, 0.5, { x: -0.3 })]));
    const result = machine.process(trackedFrame(300, [trackedHand("a", 0.7, 0.5, { x: 2 })]));

    expect(dip.rejections).toEqual([]);
    expect(result.events).toHaveLength(1);
  });

  it("records wrong-direction when a started swipe falls back past the peak tolerance", () => {
    const machine = new RibbonSwipeStateMachine({ direction: "left-to-right" });
    machine.process(trackedFrame(0, [trackedHand("a", 0.3, 0.5)]));
    machine.process(trackedFrame(100, [trackedHand("a", 0.45, 0.5, { x: 1.5 })]));
    const rejected = machine.process(trackedFrame(200, [trackedHand("a", 0.37, 0.5, { x: -0.8 })]));
    const followUp = machine.process(trackedFrame(300, []));

    expect(rejected.rejections).toEqual([expect.objectContaining({ reasonCodes: ["wrong-direction"] })]);
    expect(followUp.rejections).toHaveLength(0);
  });

  it("never fires for a swipe run from the end back to the start", () => {
    const machine = new RibbonSwipeStateMachine({ direction: "left-to-right" });
    const frames = [0.7, 0.6, 0.5, 0.4, 0.3].map((x, index) => (
      machine.process(trackedFrame(index * 100, [trackedHand("a", x, 0.5, { x: -1.5 })]))
    ));

    expect(frames.flatMap(({ events }) => events)).toEqual([]);
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

describe("BloomStateMachine", () => {
  it("opens from a central preparation with symmetric diagonal motion and interpolates event time", () => {
    const machine = new BloomStateMachine();
    machine.process(trackedFrame(0, [
      trackedHand("left", 0.42, 0.56),
      trackedHand("right", 0.58, 0.56),
    ]));
    machine.process(trackedFrame(100, [
      trackedHand("right", 0.7, 0.48),
      trackedHand("left", 0.3, 0.48),
    ]));
    const result = machine.process(trackedFrame(200, [
      trackedHand("left", 0.24, 0.44),
      trackedHand("right", 0.76, 0.44),
    ]));

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      gestureType: "bloom",
      handIds: ["left", "right"],
      reasonCodes: ["bloom-opened"],
      quality: {
        outwardDistance: expect.closeTo(0.18, 8),
        upwardDistance: expect.closeTo(0.12, 8),
        preparationSpan: expect.closeTo(0.16, 8),
      },
    });
    expect(result.events[0]?.eventTimeMs).toBeCloseTo(166.67, 1);
  });

  it("accepts the hands reaching the end point in reverse order within the sync window", () => {
    const machine = new BloomStateMachine();
    machine.process(trackedFrame(0, [
      trackedHand("left", 0.42, 0.56),
      trackedHand("right", 0.58, 0.56),
    ]));
    machine.process(trackedFrame(100, [
      trackedHand("left", 0.3, 0.48),
      trackedHand("right", 0.62, 0.52),
    ]));
    const result = machine.process(trackedFrame(250, [
      trackedHand("right", 0.76, 0.44),
      trackedHand("left", 0.24, 0.44),
    ]));

    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.quality.syncSpreadMs).toBeLessThan(420);
  });

  it("does not trigger with one hand only", () => {
    const machine = new BloomStateMachine();
    machine.process(trackedFrame(0, [trackedHand("left", 0.42, 0.56)]));
    const result = machine.process(trackedFrame(200, [trackedHand("left", 0.2, 0.35)]));

    expect(result.events).toHaveLength(0);
    expect(result.rejections).toHaveLength(0);
    expect(machine.diagnostic.observationFrameCounts).toEqual({ zeroHands: 0, oneHand: 2, twoHands: 0 });
  });

  it("rejects inward and downward motion with distinct reasons", () => {
    const inward = new BloomStateMachine();
    inward.process(trackedFrame(0, [
      trackedHand("left", 0.42, 0.56),
      trackedHand("right", 0.58, 0.56),
    ]));
    const inwardResult = inward.process(trackedFrame(100, [
      trackedHand("left", 0.45, 0.54),
      trackedHand("right", 0.68, 0.54),
    ]));

    const downward = new BloomStateMachine();
    downward.process(trackedFrame(0, [
      trackedHand("left", 0.42, 0.5),
      trackedHand("right", 0.58, 0.5),
    ]));
    const downwardResult = downward.process(trackedFrame(100, [
      trackedHand("left", 0.3, 0.56),
      trackedHand("right", 0.7, 0.56),
    ]));

    expect(inwardResult.rejections).toEqual([expect.objectContaining({ reasonCodes: ["bloom-not-outward"] })]);
    expect(downwardResult.rejections).toEqual([expect.objectContaining({ reasonCodes: ["bloom-not-upward"] })]);
  });

  it("reports insufficient distances when the armed pair times out", () => {
    const machine = new BloomStateMachine();
    machine.process(trackedFrame(0, [
      trackedHand("left", 0.42, 0.56),
      trackedHand("right", 0.58, 0.56),
    ]));
    const result = machine.process(trackedFrame(1_401, [
      trackedHand("left", 0.45, 0.55),
      trackedHand("right", 0.55, 0.55),
    ]));

    expect(result.rejections).toEqual([expect.objectContaining({
      reasonCodes: ["bloom-outward-distance-insufficient", "bloom-upward-distance-insufficient"],
    })]);
  });

  it("rejects a hand that reaches the threshold too far ahead of the other", () => {
    const machine = new BloomStateMachine();
    machine.process(trackedFrame(0, [
      trackedHand("left", 0.42, 0.56),
      trackedHand("right", 0.58, 0.56),
    ]));
    machine.process(trackedFrame(100, [
      trackedHand("left", 0.24, 0.44),
      trackedHand("right", 0.58, 0.56),
    ]));
    const result = machine.process(trackedFrame(600, [
      trackedHand("left", 0.24, 0.44),
      trackedHand("right", 0.76, 0.44),
    ]));

    expect(result.rejections).toEqual([expect.objectContaining({ reasonCodes: ["bloom-sync-expired"] })]);
  });

  it("continues through a short tracking gap", () => {
    const machine = new BloomStateMachine();
    machine.process(trackedFrame(0, [
      trackedHand("left", 0.42, 0.56),
      trackedHand("right", 0.58, 0.56),
    ]));
    machine.process(trackedFrame(100, [
      trackedHand("left", 0.3, 0.48),
      trackedHand("right", 0.7, 0.48),
    ]));
    const gap = machine.process(trackedFrame(200, []));
    const result = machine.process(trackedFrame(225, [
      trackedHand("left", 0.24, 0.44),
      trackedHand("right", 0.76, 0.44),
    ]));

    expect(gap.rejections).toHaveLength(0);
    expect(result.events).toHaveLength(1);
    expect(machine.diagnostic.latestTrackingGap).toMatchObject({
      startedAtMs: 200,
      reacquiredAtMs: 225,
      durationMs: 25,
    });
  });

  it("emits one tracking-lost rejection after a long gap and can rearm", () => {
    const machine = new BloomStateMachine();
    machine.process(trackedFrame(0, [
      trackedHand("left", 0.42, 0.56),
      trackedHand("right", 0.58, 0.56),
    ]));
    machine.process(trackedFrame(100, [
      trackedHand("left", 0.3, 0.48),
      trackedHand("right", 0.7, 0.48),
    ]));
    const lost = machine.process(trackedFrame(251, []));
    const stillLost = machine.process(trackedFrame(400, []));
    // After a rejection the pair re-arms only once it has settled for 250ms.
    for (const timeMs of [500, 760]) {
      machine.process(trackedFrame(timeMs, [
        trackedHand("left", 0.42, 0.56),
        trackedHand("right", 0.58, 0.56),
      ]));
    }
    const result = machine.process(trackedFrame(860, [
      trackedHand("left", 0.24, 0.44),
      trackedHand("right", 0.76, 0.44),
    ]));

    expect(lost.rejections).toEqual([expect.objectContaining({ reasonCodes: ["tracking-lost"] })]);
    expect(stillLost.rejections).toHaveLength(0);
    expect(result.events).toHaveLength(1);
  });

  it("does not carry preparation motion into the active recognition window", () => {
    const machine = new BloomStateMachine();
    machine.prepare(trackedFrame(0, [
      trackedHand("left", 0.42, 0.56),
      trackedHand("right", 0.58, 0.56),
    ]));
    machine.prepare(trackedFrame(100, [
      trackedHand("left", 0.24, 0.44),
      trackedHand("right", 0.76, 0.44),
    ]));
    expect(machine.process(trackedFrame(200, [
      trackedHand("left", 0.24, 0.44),
      trackedHand("right", 0.76, 0.44),
    ])).events).toHaveLength(0);

    // The window opened without the central preparation, so the pair must settle there before it arms.
    for (const timeMs of [300, 560]) {
      machine.process(trackedFrame(timeMs, [
        trackedHand("left", 0.42, 0.56),
        trackedHand("right", 0.58, 0.56),
      ]));
    }
    const result = machine.process(trackedFrame(660, [
      trackedHand("left", 0.24, 0.44),
      trackedHand("right", 0.76, 0.44),
    ]));
    expect(result.events).toHaveLength(1);
  });

  it("requires a new central preparation before a second event", () => {
    const machine = new BloomStateMachine();
    machine.process(trackedFrame(0, [
      trackedHand("left", 0.42, 0.56),
      trackedHand("right", 0.58, 0.56),
    ]));
    const first = machine.process(trackedFrame(100, [
      trackedHand("left", 0.24, 0.44),
      trackedHand("right", 0.76, 0.44),
    ]));
    const held = machine.process(trackedFrame(200, [
      trackedHand("left", 0.24, 0.44),
      trackedHand("right", 0.76, 0.44),
    ]));

    expect(first.events).toHaveLength(1);
    expect(held.events).toHaveLength(0);
    for (const timeMs of [500, 760]) {
      machine.process(trackedFrame(timeMs, [
        trackedHand("left", 0.42, 0.56),
        trackedHand("right", 0.58, 0.56),
      ]));
    }
    expect(machine.process(trackedFrame(860, [
      trackedHand("left", 0.24, 0.44),
      trackedHand("right", 0.76, 0.44),
    ])).events).toHaveLength(1);
  });
});
