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
    });
    expect(document.protocol.results[0]?.outcome).toBe("success");
    expect(document.replay.frames).toHaveLength(2);
    expect(document.privacy.includesCameraFrames).toBe(false);
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
