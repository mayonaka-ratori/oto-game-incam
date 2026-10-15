import { describe, expect, it } from "vitest";
import { DiagonalLiftStateMachine } from "../src/gestures/diagonal-lift-state-machine";
import type { DiagonalLiftVariant } from "../src/gestures/gesture-types";
import { createGestureGuide, guideDotPosition, type GuidePoint } from "../src/rendering/gesture-guides";
import { Phase1LabEngine } from "../src/poc/phase1-lab-engine";
import { createP1ProtocolDefinition, type P1TrialDefinition } from "../src/poc/phase1-protocol";
import { trackedFrame, trackedHand } from "./helpers/gesture-fixtures";
import { handAtPreviewPoint, trackingFrame } from "./helpers/tracking-fixtures";

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
  // 100ms frames are the coarse case (about ten a second on Android); the engine checks below run at 50ms.
  for (const variant of ["up-right", "up-left"] as const) {
    it(`fires for ${variant} when both hands follow the guide at 100ms frames`, () => {
      const machine = new DiagonalLiftStateMachine({ variant });
      const { events } = runAlongPaths(machine, guidePaths(variant), 100);

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        gestureType: "diagonal-lift",
        reasonCodes: ["diagonal-lift-raised"],
        handIds: ["left-hand", "right-hand"],
        quality: { diagonalLiftVariant: variant },
      });
    });
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
});
