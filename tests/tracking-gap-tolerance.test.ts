import { describe, expect, it } from "vitest";
import {
  HandFeaturePipeline,
  TRACKING_GAP_TOLERANCE_MAXIMUM_MS,
  TRACKING_GAP_TOLERANCE_MINIMUM_MS,
  trackingGapToleranceMs,
} from "../src/tracking/hand-feature-pipeline";
import { BloomStateMachine } from "../src/gestures/bloom-state-machine";
import { RibbonSwipeStateMachine } from "../src/gestures/ribbon-swipe-state-machine";
import { resolveTrackingGapToleranceMs } from "../src/gestures/gesture-types";
import type { TrackedHandFrame } from "../src/tracking/derived-tracking-types";
import type { DetectedHand, Handedness } from "../src/tracking/tracking-types";
import { syntheticHand, trackingFrame } from "./helpers/tracking-fixtures";
import { trackedFrame, trackedHand } from "./helpers/gesture-fixtures";

/**
 * Android reports hands about ten times a second (docs/19 の3.1), so a frame interval alone
 * could exceed the old 150ms tracking grace and throw away a correct movement. These tests fix
 * the new rule: the tolerance follows the measured frame interval, and a thirty-frame device
 * keeps exactly the behaviour it had.
 */

interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Offset between the centerX/centerY of the synthetic fixture and the palm center the pipeline
 * derives from it. Measured through the pipeline so a fixture change cannot silently move it.
 */
const PALM_OFFSET = measurePalmOffset();

function measurePalmOffset(): Point {
  const probe = new HandFeaturePipeline()
    .process(trackingFrame(1, 0, [syntheticHand(0, "left", 0.5, 0.5)])).hands[0];
  if (probe === undefined) throw new Error("The probe frame produced no hand.");
  return { x: probe.palmCenter.x - 0.5, y: probe.palmCenter.y - 0.5 };
}

/** A synthetic hand whose palm center lands on the requested position. */
function handAtPalm(detectionIndex: number, handedness: Handedness, palm: Point): DetectedHand {
  return syntheticHand(detectionIndex, handedness, palm.x - PALM_OFFSET.x, palm.y - PALM_OFFSET.y);
}

/** Runs capture times and palm positions through the real tracker. */
function runPipeline(
  steps: ReadonlyArray<{ readonly timeMs: number; readonly palms: readonly Point[] }>,
): TrackedHandFrame[] {
  const pipeline = new HandFeaturePipeline();
  return steps.map(({ timeMs, palms }, index) => pipeline.process(trackingFrame(
    index + 1,
    timeMs,
    palms.map((palm, handIndex) => handAtPalm(handIndex, handIndex === 0 ? "left" : "right", palm)),
  )));
}

/** Capture times that hold one position, then one long interval, then the movement. */
function steps(
  holdTimesMs: readonly number[],
  movementTimesMs: readonly number[],
  hold: readonly Point[],
  movement: ReadonlyArray<readonly Point[]>,
): Array<{ timeMs: number; palms: readonly Point[] }> {
  return [
    ...holdTimesMs.map((timeMs) => ({ timeMs, palms: hold })),
    ...movementTimesMs.map((timeMs, index) => ({ timeMs, palms: movement[index] ?? hold })),
  ];
}

describe("trackingGapToleranceMs", () => {
  it("leaves a thirty-frame device at the 150ms minimum", () => {
    const intervals = Array.from({ length: 15 }, () => 33);
    expect(trackingGapToleranceMs(intervals)).toBe(TRACKING_GAP_TOLERANCE_MINIMUM_MS);
  });

  it("stretches to two and a half intervals on a ten-frame device", () => {
    const intervals = Array.from({ length: 15 }, () => 99);
    expect(trackingGapToleranceMs(intervals)).toBeCloseTo(247.5, 10);
  });

  it("never goes past 400ms, however slow the device is", () => {
    expect(trackingGapToleranceMs(Array.from({ length: 15 }, () => 400)))
      .toBe(TRACKING_GAP_TOLERANCE_MAXIMUM_MS);
  });

  it("uses the minimum until enough intervals have been seen", () => {
    expect(trackingGapToleranceMs([99, 99, 99, 99])).toBe(TRACKING_GAP_TOLERANCE_MINIMUM_MS);
    expect(trackingGapToleranceMs([99, 99, 99, 99, 99])).toBeCloseTo(247.5, 10);
  });

  it("never falls below a configured floor", () => {
    expect(trackingGapToleranceMs(Array.from({ length: 15 }, () => 33), 300)).toBe(300);
  });
});

describe("HandFeaturePipeline tracking gap tolerance", () => {
  it("reports the tolerance on every frame and keeps it at the minimum while the rate is unknown", () => {
    const frames = runPipeline([{ timeMs: 0, palms: [{ x: 0.3, y: 0.5 }] }]);
    expect(frames[0]?.trackingGapToleranceMs).toBe(TRACKING_GAP_TOLERANCE_MINIMUM_MS);
  });

  it("measures the tolerance from capture times at ten frames a second", () => {
    const times = Array.from({ length: 8 }, (_, index) => index * 100);
    const frames = runPipeline(times.map((timeMs) => ({ timeMs, palms: [{ x: 0.3, y: 0.5 }] })));
    expect(frames.at(-1)?.trackingGapToleranceMs).toBeCloseTo(250, 10);
  });

  it("ignores a pause of more than a second, so a resumed session is not judged as slow", () => {
    const times = [0, 33, 66, 99, 132, 165, 3_000, 3_033, 3_066, 3_099, 3_132];
    const frames = runPipeline(times.map((timeMs) => ({ timeMs, palms: [{ x: 0.3, y: 0.5 }] })));
    expect(frames.at(-1)?.trackingGapToleranceMs).toBe(TRACKING_GAP_TOLERANCE_MINIMUM_MS);
  });

  it("keeps the track id through a 160ms interval at ten frames a second", () => {
    const frames = runPipeline([0, 100, 200, 300, 400, 500, 660, 760]
      .map((timeMs) => ({ timeMs, palms: [{ x: 0.3, y: 0.5 }] })));
    const ids = new Set(frames.map((frame) => frame.hands[0]?.trackId));
    expect(ids.size).toBe(1);
  });

  it("still drops the track after a 160ms interval at thirty frames a second", () => {
    const frames = runPipeline([0, 33, 66, 99, 132, 165, 325, 358]
      .map((timeMs) => ({ timeMs, palms: [{ x: 0.3, y: 0.5 }] })));
    expect(frames.at(-1)?.hands[0]?.trackId).not.toBe(frames[0]?.hands[0]?.trackId);
  });

  it("drops the track after more than 400ms even on a slow device", () => {
    const frames = runPipeline([0, 100, 200, 300, 400, 500, 950]
      .map((timeMs) => ({ timeMs, palms: [{ x: 0.3, y: 0.5 }] })));
    expect(frames.at(-1)?.hands[0]?.trackId).not.toBe(frames[0]?.hands[0]?.trackId);
  });
});

describe("resolveTrackingGapToleranceMs", () => {
  it("keeps the configured value on a frame without a measured tolerance", () => {
    expect(resolveTrackingGapToleranceMs(trackedFrame(0, []), 150)).toBe(150);
  });

  it("takes the larger of the configured and the measured value", () => {
    const measured = { ...trackedFrame(0, []), trackingGapToleranceMs: 250 };
    expect(resolveTrackingGapToleranceMs(measured, 150)).toBe(250);
    expect(resolveTrackingGapToleranceMs(measured, 400)).toBe(400);
  });
});

describe("a single slow frame no longer cancels a movement", () => {
  const swipeHold = [{ x: 0.3, y: 0.5 }];
  const swipeMovement = [[{ x: 0.48, y: 0.5 }], [{ x: 0.7, y: 0.5 }]];

  it("completes a ribbon-swipe interrupted by one 160ms interval at ten frames a second", () => {
    const machine = new RibbonSwipeStateMachine({ direction: "left-to-right" });
    const frames = runPipeline(steps([0, 100, 200, 300, 400, 500], [660, 760], swipeHold, swipeMovement));
    const results = frames.map((frame) => machine.process(frame));
    const ids = new Set(frames.map((frame) => frame.hands[0]?.trackId));

    expect(ids.size).toBe(1);
    expect(results.flatMap(({ rejections }) => rejections)).toHaveLength(0);
    expect(results.at(-1)?.events[0]?.gestureType).toBe("ribbon-swipe");
  });

  it("still loses a ribbon-swipe to a 160ms drop at thirty frames a second", () => {
    const machine = new RibbonSwipeStateMachine({ direction: "left-to-right" });
    const frames = runPipeline(steps([0, 33, 66, 99, 132, 165], [325, 358], swipeHold, swipeMovement));
    const results = frames.map((frame) => machine.process(frame));

    expect(results.flatMap(({ rejections }) => rejections.flatMap(({ reasonCodes }) => reasonCodes)))
      .toContain("tracking-lost");
    expect(results.flatMap(({ events }) => events)).toHaveLength(0);
  });

  const bloomHold = [{ x: 0.37, y: 0.66 }, { x: 0.63, y: 0.66 }];
  const bloomMovement = [[{ x: 0.19, y: 0.55 }, { x: 0.81, y: 0.55 }]];

  it("completes a Bloom interrupted by one 160ms interval at ten frames a second", () => {
    const machine = new BloomStateMachine();
    const frames = runPipeline(steps([0, 100, 200, 300, 400, 500], [660], bloomHold, bloomMovement));
    const results = frames.map((frame) => machine.process(frame));

    expect(results.flatMap(({ rejections }) => rejections)).toHaveLength(0);
    expect(results.at(-1)?.events[0]?.gestureType).toBe("bloom");
  });

  it("still loses a Bloom to a 160ms drop at thirty frames a second", () => {
    const machine = new BloomStateMachine();
    const frames = runPipeline(steps([0, 33, 66, 99, 132, 165], [325], bloomHold, bloomMovement));
    const results = frames.map((frame) => machine.process(frame));

    expect(results.flatMap(({ rejections }) => rejections.flatMap(({ reasonCodes }) => reasonCodes)))
      .toContain("tracking-lost");
    expect(results.flatMap(({ events }) => events)).toHaveLength(0);
  });

  it("still reports a lost hand after more than 400ms on a slow device", () => {
    const machine = new RibbonSwipeStateMachine({ direction: "left-to-right" });
    const frames = runPipeline(steps([0, 100, 200, 300, 400, 500], [950, 1_050], swipeHold, swipeMovement));
    const results = frames.map((frame) => machine.process(frame));

    expect(results.flatMap(({ rejections }) => rejections.flatMap(({ reasonCodes }) => reasonCodes)))
      .toContain("tracking-lost");
    expect(results.flatMap(({ events }) => events)).toHaveLength(0);
  });
});

describe("ribbon-swipe wrong-direction uses the travelled distance only", () => {
  it("accepts a hand that keeps going forward while its one-frame speed dips negative", () => {
    const machine = new RibbonSwipeStateMachine({ direction: "left-to-right" });
    machine.process(trackedFrame(0, [trackedHand("a", 0.3, 0.5)]));
    machine.process(trackedFrame(100, [trackedHand("a", 0.48, 0.5, { x: 1 })]));
    const wobble = machine.process(trackedFrame(200, [trackedHand("a", 0.56, 0.5, { x: -0.5 })]));
    const result = machine.process(trackedFrame(300, [trackedHand("a", 0.7, 0.5, { x: 1 })]));

    expect(wobble.rejections).toHaveLength(0);
    expect(result.events).toHaveLength(1);
  });

  it("keeps an armed hand armed when only its speed dips negative", () => {
    const machine = new RibbonSwipeStateMachine({ direction: "left-to-right" });
    machine.process(trackedFrame(0, [trackedHand("a", 0.3, 0.5)]));
    const wobble = machine.process(trackedFrame(100, [trackedHand("a", 0.31, 0.5, { x: -0.5 })]));
    machine.process(trackedFrame(200, [trackedHand("a", 0.5, 0.5, { x: 1 })]));
    const result = machine.process(trackedFrame(300, [trackedHand("a", 0.7, 0.5, { x: 1 })]));

    expect(wobble.rejections).toHaveLength(0);
    expect(result.events).toHaveLength(1);
  });

  it("still rejects a hand that falls back more than 0.02", () => {
    const machine = new RibbonSwipeStateMachine({ direction: "left-to-right" });
    machine.process(trackedFrame(0, [trackedHand("a", 0.3, 0.5)]));
    machine.process(trackedFrame(100, [trackedHand("a", 0.48, 0.5, { x: 1 })]));
    const rejected = machine.process(trackedFrame(200, [trackedHand("a", 0.45, 0.5, { x: 1 })]));

    expect(rejected.rejections).toEqual([expect.objectContaining({ reasonCodes: ["wrong-direction"] })]);
  });
});
