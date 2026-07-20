import { describe, expect, it } from "vitest";
import { Phase1LabEngine } from "../src/poc/phase1-lab-engine";
import { LandmarkReplayRecorder } from "../src/replay/landmark-replay";
import { syntheticHand, trackingFrame } from "./helpers/tracking-fixtures";

describe("Phase1LabEngine", () => {
  it("records replay frames and a successful first air-tap trial", () => {
    const engine = new Phase1LabEngine();
    engine.startSession("synthetic", null);
    engine.beginNextTrial(50);
    engine.processFrame(trackingFrame(1, 0, [syntheticHand(0, "left", 0.95, 0.5)]));
    engine.processFrame(trackingFrame(2, 100, [syntheticHand(0, "left", 0.7, 0.5)]));

    expect(engine.snapshot.protocol.completed).toBe(1);
    const document = engine.createDocument({
      inferenceP50Ms: 10,
      inferenceP95Ms: 12,
      trackingHz: 30,
      frameAgeP95Ms: 90,
      oneHandCoverage: 1,
      twoHandCoverage: 0,
      idConflictCount: 0,
    }, {
      pageUrl: "https://example.test/",
      userAgent: "smartphone-test-agent",
      viewport: "844 × 390",
      devicePixelRatio: 3,
      cameraFps: 30,
      trackingHz: 30,
      inferenceP50Ms: 10,
      inferenceP95Ms: 12,
      frameAgeP95Ms: 90,
      oneHandCoverage: 1,
      twoHandCoverage: 0,
      frameSource: "requestVideoFrameCallback",
      delegate: "GPU",
      packageId: "@mediapipe/tasks-vision@0.10.35",
      modelId: "test-model",
      capturedFrames: 2,
      completedFrames: 2,
      replacedFrames: 0,
      erroredFrames: 0,
      inFlightFrames: 0,
      pendingFrames: 0,
      trackingError: null,
    });
    expect(document.protocol.results[0]?.outcome).toBe("success");
    expect(document.schemaVersion).toBe(3);
    expect(document.replay).toMatchObject({ available: true, schemaVersion: 2 });
    expect(JSON.stringify(document)).not.toContain('"frames"');
    expect(engine.createDiagnosticReplay().frames).toHaveLength(2);
    expect(document.privacy.includesCameraFrames).toBe(false);
    expect(document.technicalSnapshot.userAgent).toBe("smartphone-test-agent");
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
    for (let index = 0; index < 10; index += 1) {
      engine.beginNextTrial(null, index);
      engine.recordOutcome("unclassified", [], index);
    }
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
    for (let index = 0; index < 10; index += 1) {
      engine.beginNextTrial(null, index);
      engine.recordOutcome("unclassified", [], index);
    }
    engine.beginNextTrial(1_000, 0);
    engine.processFrame(trackingFrame(1, 500, [syntheticHand(0, "left", 0.7, 0.5)]));
    engine.processFrame(trackingFrame(2, 625, [syntheticHand(0, "left", 0.52, 0.5)]));
    engine.processFrame(trackingFrame(3, 750, [syntheticHand(0, "left", 0.3, 0.5)]));

    expect(engine.snapshot.protocol.results.at(-1)).toMatchObject({
      outcome: "success",
      trial: { swipeDirection: "left-to-right" },
    });
  });

  it("recognizes a mirrored right-to-left swipe with 125ms samples", () => {
    const engine = new Phase1LabEngine();
    engine.startSession("mirror-rtl", null);
    for (let index = 0; index < 11; index += 1) {
      engine.beginNextTrial(null, index);
      engine.recordOutcome("unclassified", [], index);
    }
    engine.beginNextTrial(1_000, 0);
    engine.processFrame(trackingFrame(1, 500, [syntheticHand(0, "left", 0.3, 0.5)]));
    engine.processFrame(trackingFrame(2, 625, [syntheticHand(0, "left", 0.48, 0.5)]));
    engine.processFrame(trackingFrame(3, 750, [syntheticHand(0, "left", 0.7, 0.5)]));

    expect(engine.snapshot.protocol.results.at(-1)).toMatchObject({
      outcome: "success",
      trial: { swipeDirection: "right-to-left" },
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
      timing: { preparedAtMs: 0, windowOpenedAtMs: 0, targetTimeMs: 50, deadlineTimeMs: 30_050 },
    });
    recorder.addFrame(trackingFrame(1, 0, [syntheticHand(0, "left", 0.95, 0.5)]));
    recorder.addFrame(trackingFrame(2, 100, [syntheticHand(0, "left", 0.7, 0.5)]));

    const result = engine.evaluateReplay(recorder.snapshot());

    expect(result.matchingEventCount).toBe(1);
    expect(engine.snapshot.protocol).toMatchObject({ completed: 0, activeTrial: { id: "air-tap-1" } });
    expect(engine.snapshot).toMatchObject({ eventCount: 0, rejectionCount: 0, idConflictCount: 0 });
  });

  it("waits for the contact threshold in a contact-clap trial", () => {
    const engine = new Phase1LabEngine();
    engine.startSession("contact", null);
    for (let index = 0; index < 20; index += 1) {
      engine.beginNextTrial(null);
      engine.recordOutcome("unclassified");
    }
    engine.beginNextTrial(null);
    engine.processFrame(trackingFrame(1, 0, [
      syntheticHand(0, "left", 0.2),
      syntheticHand(1, "right", 0.8),
    ]));
    engine.processFrame(trackingFrame(2, 100, [
      syntheticHand(0, "left", 0.42),
      syntheticHand(1, "right", 0.58),
    ]));
    expect(engine.snapshot.protocol.completed).toBe(20);

    engine.processFrame(trackingFrame(3, 120, [
      syntheticHand(0, "left", 0.465),
      syntheticHand(1, "right", 0.535),
    ]));
    expect(engine.snapshot.protocol.results.at(-1)?.event?.quality.clapKind).toBe("contact-like");
    expect(engine.snapshot.protocol.completed).toBe(21);
  });
});
