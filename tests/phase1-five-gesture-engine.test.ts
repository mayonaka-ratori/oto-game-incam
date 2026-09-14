import { describe, expect, it } from "vitest";
import { Phase1LabEngine } from "../src/poc/phase1-lab-engine";
import { syntheticHand, trackingFrame } from "./helpers/tracking-fixtures";

function skipTrials(engine: Phase1LabEngine, count: number): void {
  for (let index = 0; index < count; index += 1) {
    engine.beginNextTrial(null, index);
    engine.recordOutcome("unclassified", [], index);
  }
}

// Raw camera coordinates; the engine mirrors x so the screen-left hand is the player left hand.
function bloomStart(frameId: number, timeMs: number) {
  return trackingFrame(frameId, timeMs, [
    syntheticHand(0, "left", 0.58, 0.56),
    syntheticHand(1, "right", 0.42, 0.56),
  ]);
}

function liftStart(frameId: number, timeMs: number) {
  return trackingFrame(frameId, timeMs, [
    syntheticHand(0, "left", 0.72, 0.62),
    syntheticHand(1, "right", 0.28, 0.62),
  ]);
}

describe("Phase1LabEngine five-gesture protocol", () => {
  it("waits for Bloom readiness before recognition and counts no preparation rejections", () => {
    const engine = new Phase1LabEngine();
    engine.startSession("bloom-ready", null);
    skipTrials(engine, 20);

    expect(engine.beginNextTrial(null, 0)?.gesture).toBe("bloom");
    engine.processFrame(bloomStart(1, 0));
    expect(engine.snapshot).toMatchObject({ readinessReached: false, readiness: { inZone: true, ready: false } });
    engine.processFrame(bloomStart(2, 100));
    engine.processFrame(bloomStart(3, 200));
    expect(engine.snapshot).toMatchObject({ readinessReached: true, readiness: { ready: true, readyAtMs: 200 } });

    expect(engine.startRecognition(null)).toBe(true);
    expect(engine.snapshot.protocol.activeTiming).toMatchObject({
      readyAtMs: 200,
      windowOpenedAtMs: 200,
      deadlineTimeMs: 10_200,
    });
    engine.processFrame(bloomStart(4, 300));
    engine.processFrame(trackingFrame(5, 400, [syntheticHand(0, "left", 0.7, 0.48), syntheticHand(1, "right", 0.3, 0.48)]));
    engine.processFrame(trackingFrame(6, 500, [syntheticHand(0, "left", 0.76, 0.44), syntheticHand(1, "right", 0.24, 0.44)]));

    expect(engine.snapshot.protocol.results.at(-1)).toMatchObject({
      outcome: "success",
      trial: { gesture: "bloom", requiresReadiness: true },
      rejectionCount: 0,
      readiness: { startedAtMs: 0, readyAtMs: 200, requiredStableMs: 200 },
      timing: { readyAtMs: 200 },
      event: { gestureType: "bloom", reasonCodes: ["bloom-opened"] },
      bloomDiagnostic: { triggerTimeMs: expect.any(Number) },
    });
    expect(engine.snapshot.rejectionCount).toBe(0);
  });

  it("records a Lift readiness timeout separately from a recognition timeout", () => {
    const engine = new Phase1LabEngine();
    engine.startSession("lift-timeout", null);
    skipTrials(engine, 30);

    expect(engine.beginNextTrial(null, 0)?.gesture).toBe("lift");
    engine.processFrame(trackingFrame(1, 100, [syntheticHand(0, "left", 0.72, 0.2), syntheticHand(1, "right", 0.28, 0.2)]));
    expect(engine.snapshot.readinessReached).toBe(false);
    expect(engine.timeout(10_000)).toBe(true);

    expect(engine.snapshot.protocol.results.at(-1)).toMatchObject({
      trial: { gesture: "lift" },
      outcome: "unclassified",
      resolution: "trial-timeout",
      timeoutPhase: "readiness",
      timing: null,
      readiness: { readyAtMs: null },
      reasonCodes: ["readiness-timeout", "readiness-outside-zone", "lift-not-ready"],
      readinessDiagnostic: { frameCount: 1, twoHandFrameCount: 1, inZoneFrameCount: 0, lastInZone: false },
    });
    // The recognition window never opened, so no all-zero Lift diagnostic is saved.
    expect(engine.snapshot.protocol.results.at(-1)).not.toHaveProperty("liftDiagnostic");
    expect(engine.snapshot.rejectionCount).toBe(0);
  });

  it("recognizes Lift after readiness and Spotlight with the zone-entry eventTime", () => {
    const engine = new Phase1LabEngine();
    engine.startSession("lift-spotlight", null);
    skipTrials(engine, 30);
    engine.beginNextTrial(null, 0);
    engine.processFrame(liftStart(1, 0));
    engine.processFrame(liftStart(2, 100));
    engine.processFrame(liftStart(3, 200));
    expect(engine.snapshot.readinessReached).toBe(true);
    engine.startRecognition(null);
    engine.processFrame(liftStart(4, 300));
    engine.processFrame(trackingFrame(5, 400, [syntheticHand(0, "left", 0.72, 0.5), syntheticHand(1, "right", 0.28, 0.5)]));
    engine.processFrame(trackingFrame(6, 500, [syntheticHand(0, "left", 0.72, 0.4), syntheticHand(1, "right", 0.28, 0.4)]));

    expect(engine.snapshot.protocol.results.at(-1)).toMatchObject({
      outcome: "success",
      trial: { gesture: "lift" },
      event: { gestureType: "lift", reasonCodes: ["lift-raised"] },
      liftDiagnostic: { triggerTimeMs: expect.any(Number) },
    });

    skipTrials(engine, 9);
    expect(engine.beginNextTrial(null, 1_000)).toMatchObject({ gesture: "spotlight", spotlightVariant: "left-up-right-down" });
    const leftUp = [syntheticHand(0, "left", 0.72, 0.2), syntheticHand(1, "right", 0.28, 0.6)];
    engine.processFrame(trackingFrame(7, 1_100, [syntheticHand(0, "left", 0.72, 0.4), syntheticHand(1, "right", 0.28, 0.4)]));
    engine.processFrame(trackingFrame(8, 1_200, leftUp));
    engine.processFrame(trackingFrame(9, 1_500, leftUp));

    expect(engine.snapshot.protocol.results.at(-1)).toMatchObject({
      outcome: "success",
      trial: { gesture: "spotlight" },
      event: { eventTimeMs: 1_200, quality: { spotlightVariant: "left-up-right-down" } },
      spotlightDiagnostic: { entryTimeMs: 1_200, holdCompletedAtMs: 1_500 },
    });
  });

  it("discards an attempt on pause and repeats it after resume", () => {
    const engine = new Phase1LabEngine();
    engine.startSession("pause", null);
    expect(engine.startBlock(0)).toBe(true);
    engine.beginNextTrial(null, 10);
    engine.processFrame(trackingFrame(1, 20, [syntheticHand(0, "left", 0.95, 0.5)]));

    expect(engine.pause(100)).toBe(true);
    expect(engine.snapshot.protocol).toMatchObject({ paused: true, activeTrial: null, completed: 0 });
    expect(engine.beginNextTrial(null, 200)).toBeNull();
    expect(engine.resume(5_000)).toBe(true);
    engine.beginNextTrial(null, 5_000);
    engine.processFrame(trackingFrame(2, 5_050, [syntheticHand(0, "left", 0.95, 0.5)]));
    engine.processFrame(trackingFrame(3, 5_150, [syntheticHand(0, "left", 0.7, 0.5)]));

    expect(engine.snapshot.protocol.results[0]).toMatchObject({ outcome: "success", attempt: 2, timing: { preparedAtMs: 5_000 } });
    expect(engine.snapshot.protocol.blocks[0]).toMatchObject({
      pausedMs: 4_900,
      pauses: [{ startedAtMs: 100, resumedAtMs: 5_000, reason: "manual", abandonedTrialId: "air-tap-1" }],
    });
    const windows = engine.createDiagnosticReplay().trialWindows;
    expect(windows[0]).toMatchObject({ trialId: "air-tap-1", abandoned: true, resolution: null });
    expect(windows.at(-1)).toMatchObject({ trialId: "air-tap-1", abandoned: false, resolution: "gesture-event" });
  });
});
