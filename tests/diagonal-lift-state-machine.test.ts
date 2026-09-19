import { describe, expect, it } from "vitest";
import {
  DIAGONAL_LIFT_DEFAULTS,
  DIAGONAL_LIFT_DIRECTIONS,
  DIAGONAL_LIFT_MINIMUM_HORIZONTAL_DISTANCE,
  DiagonalLiftStateMachine,
} from "../src/gestures/diagonal-lift-state-machine";
import { LIFT_DEFAULTS, LiftStateMachine } from "../src/gestures/lift-state-machine";
import type { DiagonalLiftVariant } from "../src/gestures/gesture-types";
import {
  DIAGONAL_LIFT_GUIDE_START_X,
  GUIDE_TARGET_MARGIN,
  createGestureGuide,
  guideDotPosition,
  type GuidePoint,
} from "../src/rendering/gesture-guides";
import { Phase1LabEngine } from "../src/poc/phase1-lab-engine";
import { createP1ProtocolDefinition, type P1TrialDefinition } from "../src/poc/phase1-protocol";
import { calculatePalmCursor } from "../src/rendering/palm-cursor";
import { trackedFrame, trackedHand } from "./helpers/gesture-fixtures";
import { syntheticHand, trackingFrame } from "./helpers/tracking-fixtures";

function diagonalTrial(variant: DiagonalLiftVariant): P1TrialDefinition {
  return {
    id: `diagonal-lift-${variant}`,
    ordinal: 1,
    gesture: "diagonal-lift",
    diagonalLiftVariant: variant,
    requiresReadiness: true,
    instruction: "",
  };
}

function guidePaths(variant: DiagonalLiftVariant): readonly { start: GuidePoint; end: GuidePoint }[] {
  const guide = createGestureGuide(diagonalTrial(variant));
  if (guide === null) throw new Error("ななめリフト has no guide.");
  return guide.paths;
}

/**
 * Holds the hands at the start of their paths, then walks them to the end at the given frame
 * spacing, and returns everything the judgment reported.
 */
function runAlongPaths(
  machine: { process: (frame: ReturnType<typeof trackedFrame>) => { events: readonly unknown[]; rejections: readonly unknown[] } },
  paths: readonly { start: GuidePoint; end: GuidePoint }[],
  stepMs: number,
  travelMs = 600,
  offset: (ratio: number, index: number) => GuidePoint = () => ({ x: 0, y: 0 }),
): { events: unknown[]; rejections: unknown[] } {
  const events: unknown[] = [];
  const rejections: unknown[] = [];
  const send = (timeMs: number, ratio: number): void => {
    const hands = paths.map((path, index) => {
      const point = guideDotPosition(path, ratio);
      const shift = offset(ratio, index);
      return trackedHand(index === 0 ? "left-hand" : "right-hand", point.x + shift.x, point.y + shift.y);
    });
    const result = machine.process(trackedFrame(timeMs, hands));
    events.push(...result.events);
    rejections.push(...result.rejections);
  };
  for (let timeMs = 0; timeMs < 400; timeMs += stepMs) send(timeMs, 0);
  for (let elapsed = stepMs; elapsed <= travelMs; elapsed += stepMs) send(400 + elapsed, elapsed / travelMs);
  return { events, rejections };
}

describe("DiagonalLiftStateMachine", () => {
  it("keeps the shared values of Lift and only changes the three it has to", () => {
    expect(DIAGONAL_LIFT_DEFAULTS).toMatchObject({
      startZoneMinY: LIFT_DEFAULTS.startZoneMinY,
      startZoneMaxY: LIFT_DEFAULTS.startZoneMaxY,
      leftZoneMinX: LIFT_DEFAULTS.leftZoneMinX,
      rightZoneMaxX: LIFT_DEFAULTS.rightZoneMaxX,
      minimumHandSeparation: LIFT_DEFAULTS.minimumHandSeparation,
      readinessStableMs: LIFT_DEFAULTS.readinessStableMs,
      settleMs: LIFT_DEFAULTS.settleMs,
      maximumSyncWindowMs: LIFT_DEFAULTS.maximumSyncWindowMs,
      maximumDurationMs: LIFT_DEFAULTS.maximumDurationMs,
      maximumTrackingGapMs: LIFT_DEFAULTS.maximumTrackingGapMs,
      minimumUpwardDistance: 0.18,
      maximumSidewaysDistance: 0.12,
      downwardTolerance: 0.025,
    });
    expect(DIAGONAL_LIFT_DIRECTIONS["up-right"]).toEqual([0.6, -0.8]);
    expect(DIAGONAL_LIFT_DIRECTIONS["up-left"]).toEqual([-0.6, -0.8]);
    expect(DIAGONAL_LIFT_MINIMUM_HORIZONTAL_DISTANCE).toBe(0.06);
  });

  for (const variant of ["up-right", "up-left"] as const) {
    for (const stepMs of [100, 33]) {
      it(`fires for ${variant} when both hands follow the guide at ${stepMs}ms frames`, () => {
        const machine = new DiagonalLiftStateMachine({ variant });
        const { events } = runAlongPaths(machine, guidePaths(variant), stepMs);

        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
          gestureType: "diagonal-lift",
          reasonCodes: ["diagonal-lift-raised"],
          handIds: ["left-hand", "right-hand"],
          quality: { diagonalLiftVariant: variant },
        });
      });
    }
  }

  it("does not fire when the hands go straight up instead", () => {
    const machine = new DiagonalLiftStateMachine({ variant: "up-right" });
    const paths = guidePaths("up-right").map((path) => ({
      start: path.start,
      // Same height as the diagonal guide asks for, without any sideways travel.
      end: { x: path.start.x, y: path.start.y - 0.24 },
    }));
    const { events, rejections } = runAlongPaths(machine, paths, 100);

    expect(events).toEqual([]);
    expect(rejections).toContainEqual(expect.objectContaining({
      gestureType: "diagonal-lift",
      reasonCodes: ["diagonal-lift-wrong-direction"],
    }));
  });

  it("does not fire when an up-right trial is answered with an up-left movement", () => {
    const machine = new DiagonalLiftStateMachine({ variant: "up-right" });
    const { events, rejections } = runAlongPaths(machine, guidePaths("up-left"), 100);

    expect(events).toEqual([]);
    expect(rejections).toContainEqual(expect.objectContaining({
      reasonCodes: ["diagonal-lift-wrong-direction"],
    }));
  });

  it("refuses a hand that strays more than 0.12 off the diagonal", () => {
    const machine = new DiagonalLiftStateMachine({ variant: "up-right" });
    const { events, rejections } = runAlongPaths(
      machine,
      guidePaths("up-right"),
      100,
      600,
      // Only the screen-left hand drifts, perpendicular to the diagonal.
      (ratio, index) => (index === 0 ? { x: ratio * 0.16 * 0.8, y: ratio * 0.16 * 0.6 } : { x: 0, y: 0 }),
    );

    expect(events).toEqual([]);
    expect(rejections).toContainEqual(expect.objectContaining({
      reasonCodes: ["diagonal-lift-wrong-direction"],
    }));
  });
});

describe("Lift is unchanged by ななめリフト", () => {
  it("still accepts a diagonal raise whose height exceeds its sideways travel", () => {
    // Recorded as it is today, not as a new rule: Lift's sideways check only refuses a drift
    // that is both over its tolerance and larger than the raise (LIFT_DEFAULTS unchanged).
    const machine = new LiftStateMachine();
    const { events } = runAlongPaths(machine, guidePaths("up-right"), 100);

    expect(LIFT_DEFAULTS.maximumSidewaysDistance).toBe(0.14);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ gestureType: "lift", reasonCodes: ["lift-raised"] });
  });

  it("still refuses a sideways move that outgrows the raise", () => {
    const machine = new LiftStateMachine();
    const paths = [
      { start: { x: 0.28, y: 0.775 }, end: { x: 0.52, y: 0.72 } },
      { start: { x: 0.72, y: 0.775 }, end: { x: 0.96, y: 0.72 } },
    ];
    const { events, rejections } = runAlongPaths(machine, paths, 100);

    expect(events).toEqual([]);
    expect(rejections).toContainEqual(expect.objectContaining({ reasonCodes: ["lift-not-upward"] }));
  });
});

describe("the ななめリフト guide matches the trial the engine really judges", () => {
  for (const variant of ["up-right", "up-left"] as const) {
    it(`accepts a ${variant} movement driven along the guide, mirrored preview included`, () => {
      const trial = diagonalTrial(variant);
      const engine = new Phase1LabEngine(createP1ProtocolDefinition([trial], "diagonal-guide-check"));
      engine.startSession("diagonal-guide-check", null);
      engine.startBlock(0);
      engine.beginNextTrial(null, 0);
      const paths = guidePaths(variant);
      let frameId = 0;
      const send = (timeMs: number, ratio: number): void => {
        frameId += 1;
        engine.processFrame(trackingFrame(frameId, timeMs, paths.map((path, index) => (
          // Index 0 is the screen-left path; the preview is mirrored, so it is the player's left hand.
          handAtPreviewPoint(index, index === 0 ? "left" : "right", guideDotPosition(path, ratio))
        ))));
      };
      // Settle in the start position until the readiness gate opens the recognition window.
      for (let timeMs = 0; timeMs <= 400; timeMs += 50) send(timeMs, 0);
      expect(engine.snapshot.readinessReached).toBe(true);
      expect(engine.startRecognition(null)).toBe(true);
      for (let elapsed = 0; elapsed <= 600; elapsed += 50) send(500 + elapsed, elapsed / 600);

      expect(engine.snapshot.protocol.results[0]).toMatchObject({
        outcome: "success",
        trial: { gesture: "diagonal-lift", diagonalLiftVariant: variant },
        event: { gestureType: "diagonal-lift", quality: { diagonalLiftVariant: variant } },
        diagonalLiftDiagnostic: { triggerTimeMs: expect.any(Number) },
      });
    });
  }

  it("puts the start circles inside the Lift start zones and the end rings inside the image", () => {
    for (const variant of ["up-right", "up-left"] as const) {
      const paths = guidePaths(variant);
      const [left, right] = paths;
      const startX = DIAGONAL_LIFT_GUIDE_START_X[variant];
      const startY = (LIFT_DEFAULTS.startZoneMinY + LIFT_DEFAULTS.startZoneMaxY) / 2;
      expect(left!.start.x).toBeCloseTo(startX.left, 10);
      expect(right!.start.x).toBeCloseTo(startX.right, 10);
      for (const path of paths) expect(path.start.y).toBeCloseTo(startY, 10);
      for (const path of paths) {
        const travel = Math.hypot(path.end.x - path.start.x, path.end.y - path.start.y);
        expect(travel, variant).toBeCloseTo(DIAGONAL_LIFT_DEFAULTS.minimumUpwardDistance + GUIDE_TARGET_MARGIN, 10);
      }
      expect(left!.start.x).toBeGreaterThanOrEqual(LIFT_DEFAULTS.leftZoneMinX);
      expect(left!.start.x).toBeLessThanOrEqual(LIFT_DEFAULTS.leftZoneMaxX);
      expect(right!.start.x).toBeGreaterThanOrEqual(LIFT_DEFAULTS.rightZoneMinX);
      expect(right!.start.x).toBeLessThanOrEqual(LIFT_DEFAULTS.rightZoneMaxX);
    }
  });
});

/**
 * Places a synthetic hand so that its palm center lands on the given mirrored-preview position.
 * The engine mirrors x before judging, so the raw landmarks are built from 1 - x.
 */
function handAtPreviewPoint(
  detectionIndex: number,
  handedness: "left" | "right",
  target: GuidePoint,
): ReturnType<typeof syntheticHand> {
  const probe = syntheticHand(detectionIndex, handedness, 0.5, 0.5);
  const reference = calculatePalmCursor(probe.landmarks2D)!;
  return syntheticHand(
    detectionIndex,
    handedness,
    1 - target.x - (reference.x - 0.5),
    target.y - (reference.y - 0.5),
  );
}
