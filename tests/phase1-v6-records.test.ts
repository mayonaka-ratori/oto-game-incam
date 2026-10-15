import { describe, expect, it } from "vitest";
import { Phase1LabEngine } from "../src/poc/phase1-lab-engine";
import { TECHNICAL_SUMMARY, technicalSnapshot } from "./helpers/technical-snapshot";
import { syntheticHand, trackingFrame } from "./helpers/tracking-fixtures";

// Records added by schema v6: repeat counts on diagnostics and the per-trial screen environment.
// The measurement notes are checked with the rest of the saved document in phase1-lab-engine.

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
    const document = engine.createDocument(TECHNICAL_SUMMARY, technicalSnapshot());

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
    const document = engine.createDocument(TECHNICAL_SUMMARY, technicalSnapshot());

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
});
