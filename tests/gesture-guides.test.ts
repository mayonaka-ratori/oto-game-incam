import { describe, expect, it } from "vitest";
import { AIR_TAP_DEFAULTS, AirTapStateMachine } from "../src/gestures/air-tap-state-machine";
import { BLOOM_DEFAULTS, BloomStateMachine } from "../src/gestures/bloom-state-machine";
import { LIFT_DEFAULTS, LiftStateMachine } from "../src/gestures/lift-state-machine";
import {
  RIBBON_SWIPE_CENTER,
  RIBBON_SWIPE_DEFAULTS,
  RibbonSwipeStateMachine,
} from "../src/gestures/ribbon-swipe-state-machine";
import { SPOTLIGHT_DEFAULTS, SpotlightStateMachine } from "../src/gestures/spotlight-state-machine";
import { createBloomGuideGeometry } from "../src/rendering/bloom-guide";
import {
  AIR_TAP_APPROACH_MARGIN,
  AIR_TAP_TRIAL_CENTER,
  GUIDE_FRAME_MAXIMUM,
  GUIDE_FRAME_MINIMUM,
  GUIDE_TARGET_MARGIN,
  createGestureGuide,
  guideDotPosition,
  guideDotProgress,
  guideInstruction,
  type GestureGuide,
  type GuidePoint,
} from "../src/rendering/gesture-guides";
import { Phase1LabEngine } from "../src/poc/phase1-lab-engine";
import { createP1ProtocolDefinition, type P1TrialDefinition } from "../src/poc/phase1-protocol";
import { calculatePalmCursor } from "../src/rendering/palm-cursor";
import { syntheticHand, trackingFrame } from "./helpers/tracking-fixtures";
import { trackedFrame, trackedHand } from "./helpers/gesture-fixtures";
import type { TrackedHandFeatures } from "../src/tracking/derived-tracking-types";

/** Frames must stay within the 150ms tracking grace, otherwise a track is dropped and re-created. */
const FRAME_STEP_MS = 50;

function trial(definition: Omit<P1TrialDefinition, "ordinal" | "id"> & { id?: string }): P1TrialDefinition {
  return { id: definition.id ?? `${definition.gesture}-1`, ordinal: 1, ...definition };
}

function guideOf(definition: Omit<P1TrialDefinition, "ordinal" | "id"> & { id?: string }): GestureGuide {
  const guide = createGestureGuide(trial(definition));
  if (guide === null) throw new Error("This gesture has no guide.");
  return guide;
}

function pointAt(path: { start: GuidePoint; end: GuidePoint }, ratio: number): GuidePoint {
  return guideDotPosition(path, ratio);
}

describe("guide geometry follows the judgment constants", () => {
  it("puts the bloom end rings one margin past the outward and upward thresholds", () => {
    const geometry = createBloomGuideGeometry();
    const guide = guideOf({ gesture: "bloom", requiresReadiness: true, instruction: "" });
    const [left, right] = guide.paths;
    expect(left?.start).toEqual(geometry.leftTarget);
    expect(right?.start).toEqual(geometry.rightTarget);
    expect(left!.start.x - left!.end.x).toBeCloseTo(BLOOM_DEFAULTS.minimumOutwardDistance + GUIDE_TARGET_MARGIN, 10);
    expect(right!.end.x - right!.start.x).toBeCloseTo(BLOOM_DEFAULTS.minimumOutwardDistance + GUIDE_TARGET_MARGIN, 10);
    for (const path of guide.paths) {
      expect(path.start.y - path.end.y).toBeCloseTo(BLOOM_DEFAULTS.minimumUpwardDistance + GUIDE_TARGET_MARGIN, 10);
    }
  });

  it("puts the ribbon-swipe start and end one margin outside the judged half distance", () => {
    const guide = guideOf({ gesture: "ribbon-swipe", swipeDirection: "left-to-right", instruction: "" });
    const path = guide.paths[0]!;
    const reach = RIBBON_SWIPE_DEFAULTS.minimumDistance / 2 + GUIDE_TARGET_MARGIN;
    expect(path.start).toEqual({ x: RIBBON_SWIPE_CENTER.x - reach, y: RIBBON_SWIPE_CENTER.y });
    expect(path.end).toEqual({ x: RIBBON_SWIPE_CENTER.x + reach, y: RIBBON_SWIPE_CENTER.y });
  });

  it("puts the lift end rings one margin above the minimum upward distance", () => {
    const guide = guideOf({ gesture: "lift", requiresReadiness: true, instruction: "" });
    for (const path of guide.paths) {
      expect(path.start.y).toBeCloseTo((LIFT_DEFAULTS.startZoneMinY + LIFT_DEFAULTS.startZoneMaxY) / 2, 10);
      expect(path.start.y - path.end.y).toBeCloseTo(LIFT_DEFAULTS.minimumUpwardDistance + GUIDE_TARGET_MARGIN, 10);
      expect(path.start.x).toBe(path.end.x);
    }
    expect(guide.paths[0]!.start.x).toBeCloseTo((LIFT_DEFAULTS.leftZoneMinX + LIFT_DEFAULTS.leftZoneMaxX) / 2, 10);
    expect(guide.paths[1]!.start.x).toBeCloseTo((LIFT_DEFAULTS.rightZoneMinX + LIFT_DEFAULTS.rightZoneMaxX) / 2, 10);
  });

  it("draws the air-tap ring at the judged radius and starts outside it", () => {
    const guide = guideOf({ gesture: "air-tap", airTapSide: "right", instruction: "" });
    const ring = guide.rings[0]!;
    expect(ring.center).toEqual(AIR_TAP_TRIAL_CENTER.right);
    expect(ring.radius).toBe(AIR_TAP_DEFAULTS.radius);
    const path = guide.paths[0]!;
    expect(path.end).toEqual(AIR_TAP_TRIAL_CENTER.right);
    expect(path.start.x - ring.center.x).toBeCloseTo(AIR_TAP_DEFAULTS.radius + AIR_TAP_APPROACH_MARGIN, 10);
  });

  it("uses the judged zones and hold time for spotlight", () => {
    const guide = guideOf({ gesture: "spotlight", spotlightVariant: "left-up-right-down", instruction: "" });
    expect(guide.holdMs).toBe(SPOTLIGHT_DEFAULTS.holdMs);
    expect(guide.zones[0]).toMatchObject({
      maxX: SPOTLIGHT_DEFAULTS.centerLineX - SPOTLIGHT_DEFAULTS.minimumHandSeparation / 2,
      maxY: SPOTLIGHT_DEFAULTS.upperZoneMaxY,
    });
    expect(guide.zones[1]).toMatchObject({
      minX: SPOTLIGHT_DEFAULTS.centerLineX + SPOTLIGHT_DEFAULTS.minimumHandSeparation / 2,
      minY: SPOTLIGHT_DEFAULTS.lowerZoneMinY,
    });
  });

  it("keeps every point inside the camera image", () => {
    const definitions: Array<Omit<P1TrialDefinition, "ordinal" | "id">> = [
      { gesture: "air-tap", airTapSide: "left", instruction: "" },
      { gesture: "air-tap", airTapSide: "right", instruction: "" },
      { gesture: "ribbon-swipe", swipeDirection: "left-to-right", instruction: "" },
      { gesture: "ribbon-swipe", swipeDirection: "right-to-left", instruction: "" },
      { gesture: "ribbon-swipe", swipeDirection: "lower-left-to-upper-right", instruction: "" },
      { gesture: "ribbon-swipe", swipeDirection: "lower-right-to-upper-left", instruction: "" },
      { gesture: "bloom", requiresReadiness: true, instruction: "" },
      { gesture: "lift", requiresReadiness: true, instruction: "" },
      { gesture: "spotlight", spotlightVariant: "left-up-right-down", instruction: "" },
      { gesture: "spotlight", spotlightVariant: "right-up-left-down", instruction: "" },
    ];
    for (const definition of definitions) {
      const guide = guideOf(definition);
      const points = guide.paths.flatMap((path) => [path.start, path.end])
        .concat(guide.rings.map(({ center }) => center))
        .concat(guide.zones.flatMap((zone) => [{ x: zone.minX, y: zone.minY }, { x: zone.maxX, y: zone.maxY }]));
      for (const point of points) {
        expect(point.x).toBeGreaterThanOrEqual(GUIDE_FRAME_MINIMUM);
        expect(point.x).toBeLessThanOrEqual(GUIDE_FRAME_MAXIMUM);
        expect(point.y).toBeGreaterThanOrEqual(GUIDE_FRAME_MINIMUM);
        expect(point.y).toBeLessThanOrEqual(GUIDE_FRAME_MAXIMUM);
      }
      expect(guideInstruction(trial(definition)).length).toBeGreaterThan(0);
    }
  });

  it("lets the dot finish in half of the movement limit or less", () => {
    expect(guideOf({ gesture: "bloom", requiresReadiness: true, instruction: "" }).travelMs * 2)
      .toBeLessThanOrEqual(BLOOM_DEFAULTS.maximumDurationMs);
    expect(guideOf({ gesture: "lift", requiresReadiness: true, instruction: "" }).travelMs * 2)
      .toBeLessThanOrEqual(LIFT_DEFAULTS.maximumDurationMs);
    expect(guideOf({ gesture: "ribbon-swipe", swipeDirection: "left-to-right", instruction: "" }).travelMs * 2)
      .toBeLessThanOrEqual(RIBBON_SWIPE_DEFAULTS.maximumDurationMs);
  });
});

describe("the travelling dot is placed from the time", () => {
  const path = { start: { x: 0.2, y: 0.8 }, end: { x: 0.6, y: 0.4 } };

  it("waits at the start until GO and stops at the end ring", () => {
    expect(guideDotProgress(900, 1_000, 600)).toBe(0);
    expect(guideDotProgress(1_000, 1_000, 600)).toBe(0);
    expect(guideDotProgress(1_300, 1_000, 600)).toBeCloseTo(0.5, 10);
    expect(guideDotProgress(5_000, 1_000, 600)).toBe(1);
    expect(guideDotPosition(path, 0)).toEqual(path.start);
    expect(guideDotPosition(path, 1)).toEqual(path.end);
    const middle = guideDotPosition(path, 0.5);
    expect(middle.x).toBeCloseTo(0.4, 10);
    expect(middle.y).toBeCloseTo(0.6, 10);
  });

  it("gives the same position for the same time, however often it is asked", () => {
    const first = guideDotPosition(path, guideDotProgress(1_234, 1_000, 600));
    const second = guideDotPosition(path, guideDotProgress(1_234, 1_000, 600));
    expect(second).toEqual(first);
  });

  it("stands still without a GO time", () => {
    expect(guideDotProgress(5_000, null, 600)).toBe(0);
  });
});

describe("a hand moved along the guide is accepted by the judgment", () => {
  it("fires bloom when both hands follow their paths", () => {
    const guide = guideOf({ gesture: "bloom", requiresReadiness: true, instruction: "" });
    const machine = new BloomStateMachine();
    const [left, right] = guide.paths;
    const events = runPair(
      (ratio) => [pointAt(left!, ratio), pointAt(right!, ratio)],
      guide.travelMs,
      (timeMs, points) => machine.process(trackedFrame(timeMs, [
        trackedHand("left-hand", points[0]!.x, points[0]!.y, {}, "left"),
        trackedHand("right-hand", points[1]!.x, points[1]!.y, {}, "right"),
      ])).events,
    );
    expect(events.map(({ gestureType }) => gestureType)).toContain("bloom");
  });

  it("fires lift when both hands follow their paths", () => {
    const guide = guideOf({ gesture: "lift", requiresReadiness: true, instruction: "" });
    const machine = new LiftStateMachine();
    const [left, right] = guide.paths;
    const events = runPair(
      (ratio) => [pointAt(left!, ratio), pointAt(right!, ratio)],
      guide.travelMs,
      (timeMs, points) => machine.process(trackedFrame(timeMs, [
        trackedHand("left-hand", points[0]!.x, points[0]!.y, {}, "left"),
        trackedHand("right-hand", points[1]!.x, points[1]!.y, {}, "right"),
      ])).events,
    );
    expect(events.map(({ gestureType }) => gestureType)).toContain("lift");
  });

  it("fires the requested ribbon-swipe direction when one hand follows the path", () => {
    const guide = guideOf({ gesture: "ribbon-swipe", swipeDirection: "lower-left-to-upper-right", instruction: "" });
    const machine = new RibbonSwipeStateMachine({ direction: "lower-left-to-upper-right" });
    const path = guide.paths[0]!;
    const speed = {
      x: (path.end.x - path.start.x) * 1_000 / guide.travelMs,
      y: (path.end.y - path.start.y) * 1_000 / guide.travelMs,
    };
    const events = runPair(
      (ratio) => [pointAt(path, ratio)],
      guide.travelMs,
      (timeMs, points, moving) => machine.process(trackedFrame(timeMs, [
        trackedHand("hand", points[0]!.x, points[0]!.y, moving ? speed : {}),
      ])).events,
    );
    expect(events[0]?.gestureType).toBe("ribbon-swipe");
    expect(events[0]?.quality.direction).toBe("lower-left-to-upper-right");
  });

  it("fires air-tap when the fingertip follows the path into the ring", () => {
    const guide = guideOf({ gesture: "air-tap", airTapSide: "left", instruction: "" });
    const machine = new AirTapStateMachine({
      centerX: AIR_TAP_TRIAL_CENTER.left.x,
      centerY: AIR_TAP_TRIAL_CENTER.left.y,
    });
    const path = guide.paths[0]!;
    const speed = { x: (path.end.x - path.start.x) * 1_000 / guide.travelMs, y: 0 };
    const events = runPair(
      (ratio) => [pointAt(path, ratio)],
      guide.travelMs,
      (timeMs, points, moving) => machine.process(trackedFrame(timeMs, [
        trackedHand("hand", points[0]!.x, points[0]!.y, moving ? speed : {}),
      ])).events,
    );
    expect(events[0]?.gestureType).toBe("air-tap");
  });

  it("fires spotlight when both hands hold the two zones", () => {
    const guide = guideOf({ gesture: "spotlight", spotlightVariant: "left-up-right-down", instruction: "" });
    const machine = new SpotlightStateMachine({ variant: "left-up-right-down" });
    const centers = guide.zones.map((zone) => ({
      x: (zone.minX + zone.maxX) / 2,
      y: (zone.minY + zone.maxY) / 2,
    }));
    const events = [];
    for (let timeMs = 0; timeMs <= (guide.holdMs ?? 0) + 200; timeMs += FRAME_STEP_MS) {
      const hands: TrackedHandFeatures[] = centers.map((center, index) =>
        trackedHand(`hand-${index}`, center.x, center.y, {}, index === 0 ? "left" : "right"));
      events.push(...machine.process(trackedFrame(timeMs, hands)).events);
    }
    expect(events[0]?.gestureType).toBe("spotlight");
    expect(events[0]?.quality.spotlightVariant).toBe("left-up-right-down");
  });
});

describe("the guide matches the trial the engine really judges", () => {
  it("accepts an air-tap driven along the guide, mirrored preview included", () => {
    const guide = guideOf({ gesture: "air-tap", airTapSide: "left", instruction: "" });
    expect(runEngineAlongPath(trial({
      gesture: "air-tap",
      airTapSide: "left",
      instruction: "左手の人差し指を、外からリングの中へ通す",
    }), guide)).toBe("success");
  });

  it("accepts a ribbon-swipe driven along the guide, mirrored preview included", () => {
    const guide = guideOf({ gesture: "ribbon-swipe", swipeDirection: "left-to-right", instruction: "" });
    expect(runEngineAlongPath(trial({
      gesture: "ribbon-swipe",
      swipeDirection: "left-to-right",
      instruction: "左から右へスワイプ",
    }), guide)).toBe("success");
  });
});

/**
 * Holds the hands at the start of the path, then moves them to the end over the travel time
 * of the guide, and collects everything the judgment reported.
 */
function runPair<T>(
  positions: (ratio: number) => readonly GuidePoint[],
  travelMs: number,
  step: (timeMs: number, points: readonly GuidePoint[], moving: boolean) => readonly T[],
): T[] {
  const collected: T[] = [];
  for (let timeMs = -300; timeMs < 0; timeMs += FRAME_STEP_MS) {
    collected.push(...step(timeMs + 300, positions(0), false));
  }
  for (let elapsed = FRAME_STEP_MS; elapsed <= travelMs; elapsed += FRAME_STEP_MS) {
    collected.push(...step(300 + elapsed, positions(elapsed / travelMs), true));
  }
  return collected;
}

/** Runs one trial through the real engine, with hands placed where the guide asks. */
function runEngineAlongPath(definition: P1TrialDefinition, guide: GestureGuide): string {
  const engine = new Phase1LabEngine(createP1ProtocolDefinition([definition], "guide-check"));
  engine.startSession("guide-check", null);
  engine.startBlock(0);
  const startedAtMs = 1_000;
  engine.beginNextTrial(null, startedAtMs);
  const path = guide.paths[0]!;
  let frameId = 0;
  const send = (timeMs: number, ratio: number): void => {
    frameId += 1;
    engine.processFrame(trackingFrame(frameId, timeMs, [
      handAtPreviewPoint(0, "right", guideDotPosition(path, ratio), guide.pointer),
    ]));
  };
  for (let timeMs = startedAtMs; timeMs < startedAtMs + 300; timeMs += FRAME_STEP_MS) send(timeMs, 0);
  for (let elapsed = FRAME_STEP_MS; elapsed <= guide.travelMs; elapsed += FRAME_STEP_MS) {
    send(startedAtMs + 300 + elapsed, elapsed / guide.travelMs);
  }
  return engine.snapshot.protocol.results[0]?.outcome ?? "none";
}

/**
 * Places a synthetic hand so that the judged point (palm center or fingertip) lands on the
 * given mirrored-preview position. The engine mirrors x before judging, so the raw landmarks
 * are built from 1 - x.
 */
function handAtPreviewPoint(
  detectionIndex: number,
  handedness: "left" | "right",
  target: GuidePoint,
  pointer: "palm" | "index-tip",
): ReturnType<typeof syntheticHand> {
  const probe = syntheticHand(detectionIndex, handedness, 0.5, 0.5);
  const reference = pointer === "index-tip" ? probe.landmarks2D[8]! : calculatePalmCursor(probe.landmarks2D)!;
  return syntheticHand(
    detectionIndex,
    handedness,
    1 - target.x - (reference.x - 0.5),
    target.y - (reference.y - 0.5),
  );
}
