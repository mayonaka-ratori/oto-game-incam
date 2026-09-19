import { describe, expect, it } from "vitest";
import type { DeviceTechnicalSnapshot } from "../src/metrics/device-technical-snapshot";
import { Phase1LabEngine } from "../src/poc/phase1-lab-engine";
import { syntheticHand, trackingFrame } from "./helpers/tracking-fixtures";

// Records added by schema v6: repeat counts on diagnostics, per-trial screen environment,
// and the measurement notes that keep the recent-window values apart from the session-wide ones.

const TECHNICAL_SUMMARY = {
  inferenceP50Ms: 10,
  inferenceP95Ms: 12,
  trackingHz: 30,
  frameAgeP95Ms: 90,
  oneHandCoverage: 1,
  twoHandCoverage: 1,
  idConflictCount: 0,
};

const TECHNICAL_SNAPSHOT: DeviceTechnicalSnapshot = {
  appBuildId: "0.1.0-test",
  experimentProfileId: "gpu-640x480-30",
  requestedCameraWidth: 640,
  requestedCameraHeight: 480,
  requestedFrameRateIdeal: 30,
  requestedFrameRateMin: 30,
  requestedDelegate: "GPU",
  requestedModelId: "model",
  pageUrl: "https://example.test/",
  userAgent: "test-agent",
  viewport: "844 × 390",
  devicePixelRatio: 3,
  actualCameraWidth: 640,
  actualCameraHeight: 480,
  actualCameraFrameRate: 30,
  actualFacingMode: "user",
  cameraFps: 30,
  trackingHz: 30,
  inferenceP50Ms: 10,
  inferenceP95Ms: 12,
  frameAgeP95Ms: 90,
  oneHandCoverage: 1,
  twoHandCoverage: 1,
  frameSource: "requestVideoFrameCallback",
  delegate: "GPU",
  packageId: "@mediapipe/tasks-vision@0.10.35",
  modelId: "model",
  capturedFrames: 1,
  completedFrames: 1,
  replacedFrames: 0,
  erroredFrames: 0,
  inFlightFrames: 0,
  pendingFrames: 0,
  trackingError: null,
};

// Raw camera coordinates; the engine mirrors x.
function liftAt(frameId: number, timeMs: number, y: number) {
  return trackingFrame(frameId, timeMs, [syntheticHand(0, "left", 0.72, y), syntheticHand(1, "right", 0.28, y)]);
}

function skipTrials(engine: Phase1LabEngine, count: number): void {
  for (let index = 0; index < count; index += 1) {
    engine.beginNextTrial(null, index);
    engine.recordOutcome("unclassified", [], index);
  }
}

describe("P1 records of schema v6", () => {
  it("merges consecutive identical diagnostics and keeps the reason totals", () => {
    const engine = new Phase1LabEngine();
    engine.startSession("diagnostic-merge", null);
    engine.beginNextTrial(null, 0);
    // The same hand reported with the other handedness conflicts on two frames in a row.
    // Frames stay 100ms apart so the stable track id survives.
    engine.processFrame(trackingFrame(1, 0, [syntheticHand(0, "left", 0.4, 0.5)]));
    for (let index = 0; index < 3; index += 1) {
      engine.processFrame(trackingFrame(2 + index, 100 + index * 100, [syntheticHand(0, "right", 0.4, 0.5)]));
    }
    engine.timeout(1_000);
    const document = engine.createDocument(TECHNICAL_SUMMARY, TECHNICAL_SNAPSHOT);

    expect(document.trialDiagnostics).toHaveLength(1);
    expect(document.trialDiagnostics[0]).toMatchObject({
      trialId: "air-tap-1",
      attempt: 1,
      kind: "identity-conflict",
      reasonCodes: ["identity-conflict"],
      count: 2,
      timeMs: 100,
      lastTimeMs: 200,
    });
    // The same total as one record per occurrence, so earlier analyses stay reproducible.
    expect(document.summary.diagnosticReasonCounts).toEqual({ "identity-conflict": 2 });
  });

  it("keeps a single occurrence as one record with a count of one", () => {
    const engine = new Phase1LabEngine();
    engine.startSession("diagnostic-single", null);
    skipTrials(engine, 30);
    engine.beginNextTrial(null, 1_000);
    engine.processFrame(liftAt(101, 1_000, 0.62));
    engine.processFrame(liftAt(102, 1_100, 0.62));
    engine.processFrame(liftAt(103, 1_200, 0.62));
    expect(engine.startRecognition(null)).toBe(true);
    engine.processFrame(liftAt(104, 1_300, 0.2));
    engine.timeout(2_000);
    const document = engine.createDocument(TECHNICAL_SUMMARY, TECHNICAL_SNAPSHOT);

    expect(document.trialDiagnostics).toEqual([expect.objectContaining({
      trialId: "lift-1",
      reasonCodes: ["lift-not-ready"],
      count: 1,
      timeMs: 1_300,
      lastTimeMs: 1_300,
    })]);
    expect(document.summary.diagnosticReasonCounts).toEqual({ "lift-not-ready": 1 });
  });

  it("records the screen orientation, viewport, and video size of each attempt", () => {
    const engine = new Phase1LabEngine();
    engine.startSession("environment", null);
    engine.beginNextTrial(null, 0);
    engine.recordTrialEnvironment({
      startedAtMs: 0,
      orientation: "landscape",
      orientationType: "landscape-primary",
      viewportWidth: 844,
      viewportHeight: 390,
      videoWidth: 640,
      videoHeight: 480,
    });
    engine.recordOutcome("unclassified", [], 10);
    const document = engine.createDocument(TECHNICAL_SUMMARY, TECHNICAL_SNAPSHOT);

    expect(document.trialEnvironments).toEqual([{
      trialId: "air-tap-1",
      ordinal: 1,
      attempt: 1,
      startedAtMs: 0,
      orientation: "landscape",
      orientationType: "landscape-primary",
      viewportWidth: 844,
      viewportHeight: 390,
      videoWidth: 640,
      videoHeight: 480,
    }]);
  });

  it("exports replay counts and measurement notes without copying the recorded frames", () => {
    const engine = new Phase1LabEngine();
    engine.startSession("counts", null);
    engine.beginNextTrial(50);
    engine.processFrame(trackingFrame(1, 0, [syntheticHand(0, "left", 0.95, 0.5)]));
    engine.processFrame(trackingFrame(2, 100, [syntheticHand(0, "left", 0.7, 0.5)]));
    const document = engine.createDocument(TECHNICAL_SUMMARY, TECHNICAL_SNAPSHOT);

    expect(document.schemaVersion).toBe(6);
    expect(document.replay).toMatchObject({ available: true, frameCount: 2, trialWindowCount: 1 });
    expect(document.replay.frameCount).toBe(engine.createDiagnosticReplay().frames.length);
    expect(document.measurementNotes).toEqual({
      technicalSummaryScope: "recent-window",
      technicalSummaryWindowSamples: 180,
      performanceScope: "session-and-blocks",
      histogramBucketMs: 1,
    });
    // Nothing was measured by the screen here, so both new blocks stay null instead of guessing.
    expect(document.performance).toBeNull();
    expect(document.environment).toBeNull();
  });
});
