import { describe, expect, it } from "vitest";
import { AirTapStateMachine } from "../src/gestures/air-tap-state-machine";
import { BloomStateMachine } from "../src/gestures/bloom-state-machine";
import { ClapBurstStateMachine } from "../src/gestures/clap-burst-state-machine";
import { GestureArbiter } from "../src/gestures/gesture-arbiter";
import { RIBBON_SWIPE_DEFAULTS, RibbonSwipeStateMachine } from "../src/gestures/ribbon-swipe-state-machine";
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

    expect(RIBBON_SWIPE_DEFAULTS.maximumBackwardFromPeak).toBe(0.06);
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

    expect(RIBBON_SWIPE_DEFAULTS.maximumDurationMs).toBe(850);
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

  it("records per-trial distance, speed, observation, and identity diagnostics for observed contact", () => {
    const machine = new ClapBurstStateMachine({ triggerDistance: 0.075, contactLikeDistance: 0.075 });
    machine.process(trackedFrame(0, [
      trackedHand("left-track", 0.2, 0.5, {}, "left"),
      trackedHand("right-track", 0.8, 0.5, {}, "right"),
    ]));
    machine.process({
      ...trackedFrame(100, [
        trackedHand("left-track", 0.445, 0.5, {}, "left"),
        trackedHand("right-track", 0.555, 0.5, {}, "right"),
      ]),
      identityConflictCount: 1,
    });
    const result = machine.process(trackedFrame(120, [
      trackedHand("left-track", 0.465, 0.5, {}, "left"),
      trackedHand("right-track", 0.535, 0.5, {}, "right"),
    ]));

    expect(result.events[0]).toMatchObject({ quality: { clapKind: "contact-like" } });
    expect(machine.diagnostic).toMatchObject({
      observationFrameCounts: { zeroHands: 0, oneHand: 0, twoHands: 3 },
      lastTwoHandObservedAtMs: 120,
      triggerDistanceReachedAtMs: expect.closeTo(117.5, 8),
      contactLikeDistanceReachedAtMs: expect.closeTo(117.5, 8),
      identityConflictCount: 1,
      identityConflictCountBeforeContact: 1,
      occlusionPrediction: { status: "not-needed", reasonCodes: ["no-occlusion"] },
    });
    expect(machine.diagnostic.minimumPalmDistance).toMatchObject({
      distance: expect.closeTo(0.07, 8),
      atMs: 120,
      hands: [
        { trackId: "left-track", handedness: "left" },
        { trackId: "right-track", handedness: "right" },
      ],
    });
    expect(machine.diagnostic.maximumConvergenceSpeed).toBeGreaterThan(0.28);
  });

  it("records why short-occlusion prediction succeeded for a strict contact trial", () => {
    const machine = new ClapBurstStateMachine({ triggerDistance: 0.075, contactLikeDistance: 0.075 });
    machine.process(trackedFrame(0, [trackedHand("a", 0.2, 0.5), trackedHand("b", 0.8, 0.5)]));
    machine.process(trackedFrame(100, [trackedHand("a", 0.445, 0.5), trackedHand("b", 0.555, 0.5)]));
    const result = machine.process(trackedFrame(125, []));

    expect(result.events[0]).toMatchObject({
      trackingQuality: "short-occlusion-predicted",
      quality: { clapKind: "occlusion-predicted" },
    });
    expect(machine.diagnostic).toMatchObject({
      observationFrameCounts: { zeroHands: 1, oneHand: 0, twoHands: 2 },
      lastTwoHandObservedAtMs: 100,
      triggerDistanceReachedAtMs: expect.closeTo(107.14285714285714, 8),
      contactLikeDistanceReachedAtMs: null,
      occlusionPrediction: { status: "succeeded", reasonCodes: ["occlusion-predicted"] },
      latestOcclusion: {
        lastTwoHandObservedAtMs: 100,
        startedAtMs: 125,
        reacquiredAtMs: null,
        durationMs: null,
        before: [{ trackId: "a" }, { trackId: "b" }],
        after: [],
      },
    });
    expect(machine.diagnostic.maximumConvergenceSpeed).toBeGreaterThan(0.28);
  });

  it("records missing conditions when occlusion prediction fails", () => {
    const machine = new ClapBurstStateMachine({ triggerDistance: 0.075, contactLikeDistance: 0.075 });
    machine.process(trackedFrame(0, [trackedHand("a", 0.2, 0.5), trackedHand("b", 0.8, 0.5)]));
    machine.process(trackedFrame(100, [trackedHand("a", 0.375, 0.5), trackedHand("b", 0.625, 0.5)]));
    machine.process(trackedFrame(200, [trackedHand("a", 0.375, 0.5)]));
    const result = machine.process(trackedFrame(300, []));

    expect(result.rejections).toEqual([expect.objectContaining({ reasonCodes: ["tracking-lost"] })]);
    expect(machine.diagnostic.occlusionPrediction).toMatchObject({ status: "failed" });
    expect(machine.diagnostic.occlusionPrediction.reasonCodes).toEqual(expect.arrayContaining([
      "trigger-distance-not-reached",
      "contact-like-distance-not-reached",
      "occlusion-distance-too-far",
      "occlusion-grace-expired",
    ]));
    expect(machine.diagnostic.observationFrameCounts).toEqual({ zeroHands: 1, oneHand: 1, twoHands: 2 });
  });

  it("keeps track identities before and after reacquisition", () => {
    const machine = new ClapBurstStateMachine();
    machine.process(trackedFrame(0, [
      trackedHand("before-left", 0.2, 0.5, {}, "left"),
      trackedHand("before-right", 0.8, 0.5, {}, "right"),
    ]));
    machine.process(trackedFrame(100, [trackedHand("before-left", 0.2, 0.5, {}, "left")]));
    machine.process(trackedFrame(130, [
      trackedHand("before-left", 0.2, 0.5, {}, "left"),
      trackedHand("after-right", 0.8, 0.5, {}, "right"),
    ]));

    expect(machine.diagnostic.latestOcclusion).toMatchObject({
      lastTwoHandObservedAtMs: 0,
      startedAtMs: 100,
      reacquiredAtMs: 130,
      durationMs: 30,
      before: [{ trackId: "before-left" }, { trackId: "before-right" }],
      after: [{ trackId: "before-left" }, { trackId: "after-right" }],
    });
    expect(machine.diagnostic.occlusionPrediction.reasonCodes).toEqual(expect.arrayContaining([
      "trigger-distance-not-reached",
      "convergence-speed-below-minimum",
    ]));
  });

  it("counts identity conflicts immediately before the contact threshold", () => {
    const machine = new ClapBurstStateMachine();
    machine.process(trackedFrame(0, [
      trackedHand("a", 0.2, 0.5, {}, "left"),
      trackedHand("b", 0.8, 0.5, {}, "right"),
    ]));
    const result = machine.process({
      ...trackedFrame(100, [
        trackedHand("a", 0.43, 0.5, {}, "right"),
        trackedHand("b", 0.57, 0.5, {}, "left"),
      ]),
      identityConflictCount: 2,
    });

    expect(result.events[0]).toMatchObject({ quality: { clapKind: "near-clap" } });
    expect(machine.diagnostic).toMatchObject({
      identityConflictCount: 2,
      identityConflictCountBeforeContact: 2,
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
