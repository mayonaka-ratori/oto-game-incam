import { describe, expect, it } from "vitest";
import { Phase1LabEngine } from "../src/poc/phase1-lab-engine";
import { LandmarkReplayRecorder } from "../src/replay/landmark-replay";
import { skipTrials } from "./helpers/p1-fixtures";
import { TECHNICAL_SUMMARY, technicalSnapshot } from "./helpers/technical-snapshot";
import { syntheticHand, trackingFrame } from "./helpers/tracking-fixtures";

describe("Phase1LabEngine", () => {
  it("saves a successful first air-tap with replay counts, but without the recorded frames", () => {
    const engine = new Phase1LabEngine();
    engine.startSession("synthetic", null);
    engine.beginNextTrial(50);
    engine.processFrame(trackingFrame(1, 0, [syntheticHand(0, "left", 0.95, 0.5)]));
    engine.processFrame(trackingFrame(2, 100, [syntheticHand(0, "left", 0.7, 0.5)]));

    expect(engine.snapshot.protocol.completed).toBe(1);
    const document = engine.createDocument(TECHNICAL_SUMMARY, technicalSnapshot({ userAgent: "smartphone-test-agent" }));
    expect(document.protocol.results[0]?.outcome).toBe("success");
    // The one place that pins the saved format: change it only together with the readers.
    expect(document.schemaVersion).toBe(8);
    expect(document.replay).toMatchObject({ available: true, schemaVersion: 3, frameCount: 2, trialWindowCount: 1 });
    expect(document.replay.frameCount).toBe(engine.createDiagnosticReplay().frames.length);
    expect(JSON.stringify(document)).not.toContain('"frames"');
    expect(document.privacy.includesCameraFrames).toBe(false);
    expect(document.technicalSnapshot.userAgent).toBe("smartphone-test-agent");
    expect(document.measurementNotes).toEqual({
      technicalSummaryScope: "recent-window",
      technicalSummaryWindowSamples: 180,
      performanceScope: "session-and-blocks",
      histogramBucketMs: 1,
    });
    // Nothing was measured by the screen here, so both blocks stay null instead of guessing.
    expect(document.performance).toBeNull();
    expect(document.environment).toBeNull();
  });

  it("does not count events or rejections before the recognition window", () => {
    const engine = new Phase1LabEngine();
    engine.startSession("phase", null);
    engine.beginNextTrial(1_000, 0);
    engine.processFrame(trackingFrame(1, 100, [syntheticHand(0, "left", 0.95, 0.5)]));
    engine.processFrame(trackingFrame(2, 200, [syntheticHand(0, "left", 0.7, 0.5)]));

    expect(engine.snapshot.protocol.completed).toBe(0);
    expect(engine.snapshot).toMatchObject({ eventCount: 0, rejectionCount: 0 });
  });

  it("does not carry an air-tap cooldown from preparation into the recognition window", () => {
    const engine = new Phase1LabEngine();
    engine.startSession("preparation-tap", null);
    engine.beginNextTrial(1_000, 0);
    engine.processFrame(trackingFrame(1, 300, [syntheticHand(0, "left", 0.95, 0.5)]));
    engine.processFrame(trackingFrame(2, 400, [syntheticHand(0, "left", 0.7, 0.5)]));
    engine.processFrame(trackingFrame(3, 500, [syntheticHand(0, "left", 0.95, 0.5)]));
    engine.processFrame(trackingFrame(4, 600, [syntheticHand(0, "left", 0.7, 0.5)]));

    expect(engine.snapshot.protocol.results[0]).toMatchObject({ outcome: "success" });
    expect(engine.snapshot.rejectionCount).toBe(0);
  });

  it("does not record an interpolated swipe event from before the recognition window", () => {
    const engine = new Phase1LabEngine();
    engine.startSession("window-boundary", null);
    skipTrials(engine, 10);
    engine.beginNextTrial(1_000, 0);
    engine.processFrame(trackingFrame(1, 400, [syntheticHand(0, "left", 0.7, 0.5)]));
    engine.processFrame(trackingFrame(2, 550, [syntheticHand(0, "left", 0.3, 0.5)]));

    expect(engine.snapshot.protocol.completed).toBe(10);
    expect(engine.snapshot.eventCount).toBe(0);
    expect(engine.snapshot.protocol.falseTriggers).toHaveLength(0);
  });

  it("accepts an event inside the early window with a negative target offset", () => {
    const engine = new Phase1LabEngine();
    engine.startSession("early", null);
    engine.beginNextTrial(1_000, 0);
    engine.processFrame(trackingFrame(1, 500, [syntheticHand(0, "left", 0.95, 0.5)]));
    engine.processFrame(trackingFrame(2, 600, [syntheticHand(0, "left", 0.7, 0.5)]));

    expect(engine.snapshot.protocol.results[0]).toMatchObject({ outcome: "success" });
    expect(engine.snapshot.protocol.results[0]!.offsetMs).toBeLessThan(0);
  });

  it("recognizes a mirrored left-to-right swipe with 125ms samples", () => {
    const engine = new Phase1LabEngine();
    engine.startSession("mirror", null);
    skipTrials(engine, 10);
    engine.beginNextTrial(1_000, 0);
    engine.processFrame(trackingFrame(1, 500, [syntheticHand(0, "left", 0.7, 0.5)]));
    engine.processFrame(trackingFrame(2, 625, [syntheticHand(0, "left", 0.52, 0.5)]));
    engine.processFrame(trackingFrame(3, 750, [syntheticHand(0, "left", 0.3, 0.5)]));

    expect(engine.snapshot.protocol.results.at(-1)).toMatchObject({
      outcome: "success",
      trial: { swipeDirection: "left-to-right" },
    });
  });

  it("evaluates replay in isolation without completing the live trial", () => {
    const engine = new Phase1LabEngine();
    engine.startSession("live", null);
    engine.beginNextTrial(50);
    const recorder = new LandmarkReplayRecorder({
      sessionId: "replay",
      createdAtIso: "2026-07-19T00:00:00.000Z",
      appVersion: "test",
      provider: null,
      notes: "synthetic",
    });
    recorder.beginTrial({
      trialId: "air-tap-1",
      ordinal: 1,
      timing: { preparedAtMs: 0, readyAtMs: null, windowOpenedAtMs: 0, targetTimeMs: 50, deadlineTimeMs: 30_050 },
    });
    recorder.addFrame(trackingFrame(1, 0, [syntheticHand(0, "left", 0.95, 0.5)]));
    recorder.addFrame(trackingFrame(2, 100, [syntheticHand(0, "left", 0.7, 0.5)]));

    const result = engine.evaluateReplay(recorder.snapshot());

    expect(result.matchingEventCount).toBe(1);
    expect(engine.snapshot.protocol).toMatchObject({ completed: 0, activeTrial: { id: "air-tap-1" } });
    expect(engine.snapshot).toMatchObject({ eventCount: 0, rejectionCount: 0, idConflictCount: 0 });
  });
});
