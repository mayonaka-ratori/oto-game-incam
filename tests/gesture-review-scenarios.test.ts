import { describe, expect, it } from "vitest";
import { BloomStateMachine } from "../src/gestures/bloom-state-machine";
import type { GestureEvaluation } from "../src/gestures/gesture-types";
import { LiftStateMachine } from "../src/gestures/lift-state-machine";
import { SpotlightStateMachine } from "../src/gestures/spotlight-state-machine";
import { StillnessWindow } from "../src/gestures/stillness-window";
import type { TrackedHandFeatures } from "../src/tracking/derived-tracking-types";
import { trackedFrame, trackedHand } from "./helpers/gesture-fixtures";

// Scenarios from the 2026-09-14 code review. Coordinates are mirrored preview coordinates.

function pair(leftX: number, leftY: number, rightX: number, rightY: number): TrackedHandFeatures[] {
  return [trackedHand("L", leftX, leftY), trackedHand("R", rightX, rightY)];
}

function reasonsOf(results: readonly GestureEvaluation[]): string[] {
  return results.flatMap(({ rejections }) => rejections.flatMap(({ reasonCodes }) => reasonCodes));
}

function eventsOf(results: readonly GestureEvaluation[]): GestureEvaluation["events"][number][] {
  return results.flatMap(({ events }) => events);
}

describe("StillnessWindow", () => {
  it("reports still only after the points stay within the tolerance for the whole window", () => {
    const window = new StillnessWindow(250, 0.02);

    expect(window.observe(0, ["a"], [{ x: 0.5, y: 0.5 }])).toBe(false);
    expect(window.observe(200, ["a"], [{ x: 0.51, y: 0.5 }])).toBe(false);
    expect(window.observe(250, ["a"], [{ x: 0.51, y: 0.51 }])).toBe(true);
    expect(window.observe(300, ["a"], [{ x: 0.535, y: 0.51 }])).toBe(false);
  });

  it("never reports a motion of 0.1 normalized units per second as still", () => {
    const window = new StillnessWindow(250, 0.02);
    const results = Array.from({ length: 30 }, (_, index) => (
      window.observe(index * 33, ["a"], [{ x: 0.2 + index * 33 * 0.0001, y: 0.5 }])
    ));

    expect(results.some(Boolean)).toBe(false);
  });

  it("starts over when the hand identities change", () => {
    const window = new StillnessWindow(250, 0.02);
    window.observe(0, ["a", "b"], [{ x: 0.3, y: 0.5 }, { x: 0.7, y: 0.5 }]);

    expect(window.observe(300, ["a", "c"], [{ x: 0.3, y: 0.5 }, { x: 0.7, y: 0.5 }])).toBe(false);
  });
});

describe("Lift review scenarios", () => {
  it("does not start the duration early when a hand drifts and stops before GO", () => {
    const machine = new LiftStateMachine();
    const results: GestureEvaluation[] = [];
    for (let timeMs = 0; timeMs <= 2_000; timeMs += 33) {
      const rise = timeMs >= 800 ? 0.25 * Math.min(1, (timeMs - 800) / 900) : 0;
      const leftStart = timeMs >= 33 ? 0.725 : 0.75;
      const result = machine.process(trackedFrame(timeMs, pair(0.28, leftStart - rise, 0.72, 0.75 - rise)));
      results.push(result);
      if (result.events.length > 0) break;
    }

    expect(reasonsOf(results)).toEqual([]);
    expect(eventsOf(results)).toHaveLength(1);
    expect(eventsOf(results)[0]?.eventTimeMs).toBeGreaterThan(1_440);
    expect(eventsOf(results)[0]?.eventTimeMs).toBeLessThan(1_456);
  });

  it("does not judge lowering the hands into the start zones as a Lift", () => {
    const machine = new LiftStateMachine();
    const results: GestureEvaluation[] = [];
    let timeMs = 0;
    for (let y = 0.45; y <= 0.7801; y += 0.015) {
      results.push(machine.process(trackedFrame(timeMs, pair(0.28, y, 0.72, y))));
      timeMs += 33;
    }
    for (let index = 0; index < 10; index += 1) {
      results.push(machine.process(trackedFrame(timeMs, pair(0.28, 0.78, 0.72, 0.78))));
      timeMs += 33;
    }
    for (const y of [0.7, 0.62, 0.53]) {
      results.push(machine.process(trackedFrame(timeMs, pair(0.28, y, 0.72, y))));
      timeMs += 33;
    }

    expect(reasonsOf(results)).toEqual(["lift-not-ready"]);
    expect(eventsOf(results)).toHaveLength(1);
  });

  it("re-arms only after the hands settle when a hand is lowered back after a sync rejection", () => {
    const machine = new LiftStateMachine();
    const results: GestureEvaluation[] = [];
    let timeMs = 0;
    const step = (leftY: number, rightY: number): void => {
      results.push(machine.process(trackedFrame(timeMs, pair(0.28, leftY, 0.72, rightY))));
      timeMs += 33;
    };
    step(0.75, 0.75);
    for (const y of [0.68, 0.6, 0.52, 0.5]) step(y, 0.75);
    for (let index = 0; index < 16; index += 1) step(0.5, 0.75);
    for (let y = 0.515; y <= 0.7801; y += 0.015) step(y, 0.75);
    for (let index = 0; index < 10; index += 1) step(0.78, 0.75);
    step(0.7, 0.67);
    step(0.62, 0.59);
    step(0.53, 0.5);

    expect(reasonsOf(results)).toEqual(["lift-sync-expired"]);
    expect(eventsOf(results)).toHaveLength(1);
  });

  it("keeps the first threshold crossing while the early hand hovers near the threshold", () => {
    const machine = new LiftStateMachine();
    machine.process(trackedFrame(0, pair(0.28, 0.75, 0.72, 0.75)));
    machine.process(trackedFrame(33, pair(0.28, 0.66, 0.72, 0.74)));
    machine.process(trackedFrame(66, pair(0.28, 0.575, 0.72, 0.73)));
    machine.process(trackedFrame(99, pair(0.28, 0.565, 0.72, 0.72)));
    const results: GestureEvaluation[] = [];
    for (let index = 4; index < 40; index += 1) {
      const timeMs = index * 33;
      const leftY = index % 2 === 0 ? 0.565 : 0.575;
      const rightY = Math.max(0.55, 0.72 - (timeMs - 99) * 0.15 / 600);
      const result = machine.process(trackedFrame(timeMs, pair(0.28, leftY, 0.72, rightY)));
      results.push(result);
      if (result.events.length > 0 || result.rejections.length > 0) break;
    }

    // The hands reach the threshold about 616ms apart, more than the 420ms sync window.
    expect(eventsOf(results)).toEqual([]);
    expect(reasonsOf(results)).toEqual(["lift-sync-expired"]);
    expect(machine.diagnostic.hands.find(({ side }) => side === "left")?.upwardThresholdReachedAtMs).toBeCloseTo(82.5, 5);
  });

  it("closes the tracking gap record when the hands return after tracking-lost", () => {
    const machine = new LiftStateMachine();
    machine.process(trackedFrame(0, pair(0.28, 0.75, 0.72, 0.75)));
    machine.process(trackedFrame(33, pair(0.28, 0.72, 0.72, 0.72)));
    const results: GestureEvaluation[] = [];
    for (let timeMs = 66; timeMs <= 300; timeMs += 33) results.push(machine.process(trackedFrame(timeMs, [])));
    for (let timeMs = 330; timeMs <= 600; timeMs += 33) {
      results.push(machine.process(trackedFrame(timeMs, pair(0.28, 0.75, 0.72, 0.75))));
    }
    const diagnostic = machine.diagnosticAt(10_000);

    expect(reasonsOf(results)).toEqual(["tracking-lost"]);
    expect(diagnostic.latestTrackingGap).toMatchObject({ startedAtMs: 66, reacquiredAtMs: 330, durationMs: 264 });
    expect(diagnostic.rejectionReasonCodes).toEqual(["tracking-lost"]);
  });

  it("judges lift-not-ready on the first frame of the window where both hands are visible", () => {
    const machine = new LiftStateMachine();
    machine.prepare(trackedFrame(0, pair(0.28, 0.4, 0.72, 0.4)));
    const oneHand = machine.process(trackedFrame(100, [trackedHand("L", 0.28, 0.4)]));
    const results: GestureEvaluation[] = [];
    for (let timeMs = 133; timeMs <= 2_000; timeMs += 33) {
      results.push(machine.process(trackedFrame(timeMs, pair(0.28, 0.4, 0.72, 0.4))));
    }

    expect(oneHand.rejections).toEqual([]);
    expect(results[0]?.rejections).toEqual([expect.objectContaining({ reasonCodes: ["lift-not-ready"] })]);
    expect(reasonsOf(results)).toEqual(["lift-not-ready"]);
  });

  it("clears the motion start of a rejected candidate when the hands re-arm", () => {
    const machine = new LiftStateMachine();
    machine.process(trackedFrame(0, pair(0.28, 0.75, 0.72, 0.75)));
    machine.process(trackedFrame(33, pair(0.28, 0.7, 0.72, 0.7)));
    const rejected = machine.process(trackedFrame(66, pair(0.28, 0.79, 0.72, 0.79)));
    for (let timeMs = 100; timeMs <= 600; timeMs += 33) machine.process(trackedFrame(timeMs, pair(0.28, 0.79, 0.72, 0.79)));
    const diagnostic = machine.diagnostic;

    expect(rejected.rejections).toEqual([expect.objectContaining({ reasonCodes: ["lift-not-upward"] })]);
    expect(diagnostic.armedAtMs).toBeGreaterThanOrEqual(350);
    expect(diagnostic.motionStartedAtMs).toBeNull();
    expect(diagnostic.hands.every(({ maximumUpwardDistance }) => maximumUpwardDistance === 0)).toBe(true);
  });

  it("follows the hand positions when the tracker swaps the two identities", () => {
    const machine = new LiftStateMachine();
    machine.process(trackedFrame(0, pair(0.28, 0.75, 0.72, 0.75)));
    machine.process(trackedFrame(33, pair(0.28, 0.7, 0.72, 0.7)));
    const swapped = machine.process(trackedFrame(66, [trackedHand("R", 0.28, 0.66), trackedHand("L", 0.72, 0.66)]));
    const raised = machine.process(trackedFrame(99, [trackedHand("R", 0.28, 0.52), trackedHand("L", 0.72, 0.52)]));

    expect(swapped.rejections).toEqual([]);
    expect(raised.events).toEqual([expect.objectContaining({ gestureType: "lift", handIds: ["L", "R"] })]);
    expect(machine.diagnostic.identitySwapCount).toBe(1);
  });

  it("accepts a sync spread of exactly 420ms and rejects 421ms", () => {
    const run = (rightReachMs: number): GestureEvaluation => {
      const machine = new LiftStateMachine({ minimumUpwardDistance: 0.25 });
      machine.process(trackedFrame(0, pair(0.25, 0.75, 0.75, 0.75)));
      machine.process(trackedFrame(100, pair(0.25, 0.5, 0.75, 0.75)));
      machine.process(trackedFrame(300, pair(0.25, 0.5, 0.75, 0.625)));
      return machine.process(trackedFrame(rightReachMs, pair(0.25, 0.5, 0.75, 0.5)));
    };

    expect(run(520).events).toEqual([expect.objectContaining({ quality: expect.objectContaining({ syncSpreadMs: 420 }) })]);
    expect(run(521).rejections).toEqual([expect.objectContaining({ reasonCodes: ["lift-sync-expired"] })]);
  });
});

describe("Bloom review scenarios", () => {
  it("does not start the duration early when a hand drifts and stops before GO", () => {
    const machine = new BloomStateMachine();
    const results: GestureEvaluation[] = [];
    for (let timeMs = 0; timeMs <= 2_000; timeMs += 33) {
      const open = timeMs >= 800 ? Math.min(1, (timeMs - 800) / 700) : 0;
      const leftY = timeMs >= 33 ? 0.535 : 0.56;
      const result = machine.process(trackedFrame(timeMs, pair(
        0.42 - 0.18 * open,
        leftY - 0.12 * open,
        0.58 + 0.18 * open,
        0.56 - 0.12 * open,
      )));
      results.push(result);
      if (result.events.length > 0) break;
    }

    expect(reasonsOf(results)).toEqual([]);
    expect(eventsOf(results)).toHaveLength(1);
    expect(eventsOf(results)[0]?.eventTimeMs).toBeGreaterThan(1_415);
    expect(eventsOf(results)[0]?.eventTimeMs).toBeLessThan(1_430);
  });

  it("does not judge returning the hands to the center as a Bloom", () => {
    const machine = new BloomStateMachine();
    const results: GestureEvaluation[] = [];
    for (let index = 0; index <= 20; index += 1) {
      const progress = index / 20;
      results.push(machine.process(trackedFrame(index * 33, pair(
        0.2 + 0.22 * progress,
        0.44 + 0.12 * progress,
        0.8 - 0.22 * progress,
        0.44 + 0.12 * progress,
      ))));
    }
    for (let timeMs = 693; timeMs <= 990; timeMs += 33) {
      results.push(machine.process(trackedFrame(timeMs, pair(0.42, 0.56, 0.58, 0.56))));
    }
    results.push(machine.process(trackedFrame(1_023, pair(0.3, 0.48, 0.7, 0.48))));
    results.push(machine.process(trackedFrame(1_056, pair(0.24, 0.44, 0.76, 0.44))));

    expect(reasonsOf(results)).toEqual([]);
    expect(eventsOf(results)).toHaveLength(1);
  });

  it("uses the earlier crossing when one axis was already past its threshold", () => {
    const eventTime = (upY: number): number | undefined => {
      const machine = new BloomStateMachine();
      machine.process(trackedFrame(0, pair(0.42, 0.56, 0.58, 0.56)));
      machine.process(trackedFrame(33, pair(0.3, 0.44, 0.7, 0.44)));
      return machine.process(trackedFrame(66, pair(0.22, upY, 0.78, upY))).events[0]?.eventTimeMs;
    };

    // The upward threshold was passed at 33ms either way; the outward crossing at 49.5ms decides.
    expect(eventTime(0.45)).toBeCloseTo(49.5, 5);
    expect(eventTime(0.43)).toBeCloseTo(49.5, 5);
  });

  it("closes the tracking gap record when the hands return after tracking-lost", () => {
    const machine = new BloomStateMachine();
    machine.process(trackedFrame(0, pair(0.42, 0.56, 0.58, 0.56)));
    machine.process(trackedFrame(33, pair(0.38, 0.52, 0.62, 0.52)));
    for (let timeMs = 66; timeMs <= 300; timeMs += 33) machine.process(trackedFrame(timeMs, []));
    for (let timeMs = 330; timeMs <= 600; timeMs += 33) machine.process(trackedFrame(timeMs, pair(0.42, 0.56, 0.58, 0.56)));

    expect(machine.diagnosticAt(10_000).latestTrackingGap).toMatchObject({ startedAtMs: 66, reacquiredAtMs: 330 });
    expect(machine.diagnosticAt(10_000).rejectionReasonCodes).toEqual(["tracking-lost"]);
  });

  it("follows the hand positions when the tracker swaps the two identities", () => {
    const machine = new BloomStateMachine();
    machine.process(trackedFrame(0, pair(0.42, 0.56, 0.58, 0.56)));
    machine.process(trackedFrame(33, pair(0.38, 0.53, 0.62, 0.53)));
    const swapped = machine.process(trackedFrame(66, [trackedHand("R", 0.34, 0.5), trackedHand("L", 0.66, 0.5)]));
    const opened = machine.process(trackedFrame(99, [trackedHand("R", 0.24, 0.44), trackedHand("L", 0.76, 0.44)]));

    expect(swapped.rejections).toEqual([]);
    expect(opened.events).toHaveLength(1);
    expect(machine.diagnostic.identitySwapCount).toBe(1);
  });

  it("restarts the readiness timer when a hand disappears", () => {
    const machine = new BloomStateMachine();
    const centered = (): TrackedHandFeatures[] => pair(0.42, 0.56, 0.58, 0.56);
    machine.observeReadiness(trackedFrame(0, centered()));
    machine.observeReadiness(trackedFrame(100, [trackedHand("L", 0.42, 0.56)]));
    machine.observeReadiness(trackedFrame(150, centered()));

    // Without the restart, 290ms after the first frame would already count as 200ms of stability.
    expect(machine.observeReadiness(trackedFrame(290, centered()))).toMatchObject({ ready: false, stableMs: 140 });
    expect(machine.observeReadiness(trackedFrame(350, centered()))).toMatchObject({ ready: true, readyAtMs: 350 });
  });
});

describe("Spotlight review scenarios", () => {
  const target = (): TrackedHandFeatures[] => pair(0.28, 0.3, 0.72, 0.72);
  const mirrored = (): TrackedHandFeatures[] => pair(0.28, 0.72, 0.72, 0.3);
  const neutral = (): TrackedHandFeatures[] => pair(0.3, 0.5, 0.7, 0.5);
  const jitter = (): TrackedHandFeatures[] => pair(0.28, 0.43, 0.72, 0.72);
  const oneHand = (): TrackedHandFeatures[] => [trackedHand("L", 0.28, 0.3)];
  const run = (
    machine: SpotlightStateMachine,
    fromMs: number,
    toMs: number,
    hands: () => TrackedHandFeatures[],
  ): GestureEvaluation[] => {
    const results: GestureEvaluation[] = [];
    for (let timeMs = fromMs; timeMs <= toMs; timeMs += 33) results.push(machine.process(trackedFrame(timeMs, hands())));
    return results;
  };

  it("keeps the hold and its entry time through a one-frame jitter across the zone boundary", () => {
    const machine = new SpotlightStateMachine({ variant: "left-up-right-down" });
    machine.prepare(trackedFrame(0, neutral()));
    const results = [
      ...run(machine, 100, 199, target),
      machine.process(trackedFrame(232, jitter())),
      ...run(machine, 265, 700, target),
    ];

    expect(reasonsOf(results)).toEqual([]);
    expect(eventsOf(results)).toEqual([expect.objectContaining({ eventTimeMs: 100 })]);
  });

  it("does not take a one-frame jitter as releasing a pose formed before GO", () => {
    const machine = new SpotlightStateMachine({ variant: "left-up-right-down" });
    machine.prepare(trackedFrame(0, target()));
    const results = [
      machine.process(trackedFrame(100, target())),
      machine.process(trackedFrame(133, jitter())),
      ...run(machine, 166, 600, target),
    ];

    expect(reasonsOf(results)).toEqual(["spotlight-pose-before-go"]);
    expect(eventsOf(results)).toEqual([]);
  });

  it("detects a pose formed before GO when the last count-in frame had one hand", () => {
    const machine = new SpotlightStateMachine({ variant: "left-up-right-down" });
    machine.prepare(trackedFrame(0, target()));
    machine.prepare(trackedFrame(33, target()));
    machine.prepare(trackedFrame(66, oneHand()));
    const results = run(machine, 100, 600, target);

    expect(reasonsOf(results)).toEqual(["spotlight-pose-before-go"]);
    expect(eventsOf(results)).toEqual([]);
    expect(machine.diagnostic.poseBeforeGo).toBe(true);
  });

  it("detects a pose formed before GO when the first window frame had one hand", () => {
    const machine = new SpotlightStateMachine({ variant: "left-up-right-down" });
    machine.prepare(trackedFrame(0, target()));
    machine.prepare(trackedFrame(66, target()));
    const results = [machine.process(trackedFrame(100, oneHand())), ...run(machine, 133, 600, target)];

    expect(reasonsOf(results)).toEqual(["spotlight-pose-before-go"]);
    expect(eventsOf(results)).toEqual([]);
  });

  it("closes a short tracking gap when the hands come back in another pose", () => {
    const machine = new SpotlightStateMachine({ variant: "left-up-right-down" });
    machine.process(trackedFrame(0, target()));
    machine.process(trackedFrame(33, oneHand()));
    machine.process(trackedFrame(66, neutral()));

    expect(machine.diagnosticAt(10_000).latestTrackingGap).toMatchObject({
      startedAtMs: 33,
      reacquiredAtMs: 66,
      durationMs: 33,
    });
  });

  it("closes the tracking gap record when a new hold starts after tracking-lost", () => {
    const machine = new SpotlightStateMachine({ variant: "left-up-right-down" });
    machine.process(trackedFrame(0, target()));
    const results = [...run(machine, 33, 198, oneHand), ...run(machine, 231, 600, target)];

    expect(reasonsOf(results)).toEqual(["tracking-lost"]);
    expect(eventsOf(results)).toEqual([expect.objectContaining({ eventTimeMs: 231 })]);
    expect(machine.diagnostic.latestTrackingGap).toMatchObject({ startedAtMs: 33, reacquiredAtMs: 231 });
  });

  it("reports hands on the same side of the center line once", () => {
    const machine = new SpotlightStateMachine({ variant: "left-up-right-down" });
    machine.prepare(trackedFrame(0, neutral()));
    const results = run(machine, 100, 3_000, () => pair(0.3, 0.3, 0.47, 0.75));

    expect(reasonsOf(results)).toEqual(["spotlight-hands-not-separated"]);
    expect(machine.diagnostic.latestPose).toBe("off-center");
  });

  it("keeps counting a wrong pose through a one-frame interruption", () => {
    const machine = new SpotlightStateMachine({ variant: "left-up-right-down" });
    machine.process(trackedFrame(0, mirrored()));
    machine.process(trackedFrame(150, pair(0.28, 0.72, 0.72, 0.43)));
    machine.process(trackedFrame(180, mirrored()));

    expect(machine.process(trackedFrame(300, mirrored())).rejections)
      .toEqual([expect.objectContaining({ reasonCodes: ["spotlight-wrong-side"] })]);
  });

  it("completes the hold at exactly 300ms", () => {
    const machine = new SpotlightStateMachine({ variant: "left-up-right-down" });
    machine.process(trackedFrame(0, target()));

    expect(machine.process(trackedFrame(299, target())).events).toEqual([]);
    expect(machine.process(trackedFrame(300, target())).events).toEqual([expect.objectContaining({ eventTimeMs: 0 })]);
  });
});
