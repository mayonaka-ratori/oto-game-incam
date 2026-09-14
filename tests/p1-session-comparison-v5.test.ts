import { describe, expect, it } from "vitest";
import type { GestureEvent } from "../src/gestures/gesture-types";
import type { DeviceTechnicalSnapshot } from "../src/metrics/device-technical-snapshot";
import {
  P1_CONTROLLED_TRIALS,
  P1_FIVE_GESTURE_PROTOCOL,
  Phase1ControlledRunner,
  type P1Gesture,
  type P1TrialDefinition,
} from "../src/poc/phase1-protocol";
import { createPhase1SessionDocument } from "../src/poc/phase1-session";
import { LandmarkReplayRecorder } from "../src/replay/landmark-replay";
import {
  compareP1Sessions,
  parseP1SessionForComparison,
} from "../src/testing/p1-session-comparison";

const TECHNICAL_SNAPSHOT: DeviceTechnicalSnapshot = {
  appBuildId: "build-v5",
  experimentProfileId: "baseline-gpu-640x480-60",
  requestedCameraWidth: 640,
  requestedCameraHeight: 480,
  requestedFrameRateIdeal: 60,
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
  trackingHz: 25,
  inferenceP50Ms: 20,
  inferenceP95Ms: 40,
  frameAgeP95Ms: 100,
  oneHandCoverage: 1,
  twoHandCoverage: 0.95,
  frameSource: "requestVideoFrameCallback",
  delegate: "GPU",
  packageId: "@mediapipe/tasks-vision@0.10.35",
  modelId: "model",
  capturedFrames: 100,
  completedFrames: 100,
  replacedFrames: 0,
  erroredFrames: 0,
  inFlightFrames: 0,
  pendingFrames: 0,
  trackingError: null,
};

/** Runs the real protocol runner and exports the standard document, then round-trips it through JSON. */
function sessionDocument(
  sessionId: string,
  trials: readonly P1TrialDefinition[],
  successFor: (gesture: P1Gesture) => number,
): Record<string, unknown> {
  const runner = new Phase1ControlledRunner(trials === P1_CONTROLLED_TRIALS ? P1_FIVE_GESTURE_PROTOCOL : trials);
  runner.start();
  let timeMs = 0;
  for (const trial of trials) {
    runner.beginNextTrial(null, timeMs);
    if (trial.requiresReadiness === true) runner.startRecognition(timeMs + 100, null);
    if ((trial.ordinal - 1) % 10 < successFor(trial.gesture)) {
      runner.acceptEvent(matchingEvent(trial, timeMs + 200));
    } else {
      runner.timeout(timeMs + 10_100);
    }
    timeMs += 20_000;
  }
  const session = {
    sessionId,
    createdAtIso: "2026-09-14T00:00:00.000Z",
    appVersion: "build-v5",
    provider: null,
    notes: "",
  };
  const document = createPhase1SessionDocument(
    session,
    runner.snapshot,
    [],
    [],
    new LandmarkReplayRecorder(session).snapshot(),
    {
      inferenceP50Ms: 20,
      inferenceP95Ms: 40,
      trackingHz: 25,
      frameAgeP95Ms: 100,
      oneHandCoverage: 1,
      twoHandCoverage: 0.95,
      idConflictCount: 0,
    },
    TECHNICAL_SNAPSHOT,
  );
  return JSON.parse(JSON.stringify(document)) as Record<string, unknown>;
}

function matchingEvent(trial: P1TrialDefinition, eventTimeMs: number): GestureEvent {
  return {
    id: `event-${trial.id}`,
    gestureType: trial.gesture,
    eventTimeMs,
    handIds: ["hand-1"],
    confidence: 0.9,
    quality: trial.swipeDirection !== undefined
      ? { direction: trial.swipeDirection }
      : trial.spotlightVariant !== undefined
        ? { spotlightVariant: trial.spotlightVariant }
        : {},
    trackingQuality: "observed",
    reasonCodes: [],
  };
}

describe("P1 session comparison for the five-gesture protocol (schema v5)", () => {
  it("round-trips a complete 50-trial export and keeps candidates out of the controlled criterion", () => {
    const document = sessionDocument("five-a", P1_CONTROLLED_TRIALS, () => 8);
    const session = parseP1SessionForComparison(JSON.stringify(document), "five-a.json");

    expect(document).toMatchObject({
      schemaVersion: 5,
      gestureVocabulary: {
        thirdGesture: "bloom",
        gestures: ["air-tap", "ribbon-swipe", "bloom", "lift", "spotlight"],
        candidateGestures: ["lift", "spotlight"],
      },
      protocol: { id: "p1-five-gesture-50", trialsPerGesture: 10, total: 50 },
    });
    expect(session).toMatchObject({
      schemaVersion: 5,
      protocolId: "p1-five-gesture-50",
      completed: 50,
      total: 50,
      candidateGestures: ["lift", "spotlight"],
      dataComplete: true,
      controlledCriterionCandidate: true,
    });
    expect(session.gestures.lift.success).toBe(8);
    expect(session.gestures.spotlight.success).toBe(8);
    expect(session.findings).toEqual([]);
  });

  it("reports weak candidate gestures as information without blocking the three current inputs", () => {
    const document = sessionDocument("five-b", P1_CONTROLLED_TRIALS, (gesture) => (
      gesture === "lift" || gesture === "spotlight" ? 5 : 8
    ));
    const session = parseP1SessionForComparison(JSON.stringify(document), "five-b.json");

    expect(session.controlledCriterionCandidate).toBe(true);
    expect(session.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "lift-candidate-under-8", severity: "info" }),
      expect.objectContaining({ code: "spotlight-candidate-under-8", severity: "info" }),
    ]));
  });

  it("keeps the 3-input Bloom protocol and the five-gesture protocol apart", () => {
    const threeInput = sessionDocument("bloom-30", P1_CONTROLLED_TRIALS.slice(0, 30), () => 8);
    threeInput.schemaVersion = 4;
    threeInput.gestureVocabulary = { thirdGesture: "bloom" };
    const legacy = parseP1SessionForComparison(JSON.stringify(threeInput), "bloom-30.json");
    const five = parseP1SessionForComparison(
      JSON.stringify(sessionDocument("five-c", P1_CONTROLLED_TRIALS, () => 8)),
      "five-c.json",
    );
    const result = compareP1Sessions([legacy, five]);

    expect(legacy).toMatchObject({ schemaVersion: 4, protocolId: "p1-bloom-30", total: 30, dataComplete: true });
    expect(result.findings.map(({ code }) => code)).toContain("mixed-protocols");
    expect(result.controlledCriterionCandidate).toBe(false);
    expect(result.nextAction).toContain("5動作・50試行");
  });

  it("marks a v5 export without the candidate vocabulary or protocol id as incomplete", () => {
    const document = sessionDocument("five-d", P1_CONTROLLED_TRIALS, () => 8);
    document.gestureVocabulary = { thirdGesture: "bloom", gestures: ["air-tap", "ribbon-swipe", "bloom", "lift"] };
    (document.protocol as Record<string, unknown>).id = "";
    const session = parseP1SessionForComparison(JSON.stringify(document), "five-d.json");

    expect(session.dataComplete).toBe(false);
    expect(session.findings.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "gesture-vocabulary-candidates",
      "protocol-id-missing",
    ]));
  });
});
