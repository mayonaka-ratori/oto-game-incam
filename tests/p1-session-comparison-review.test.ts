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
  type P1ComparisonFinding,
  type P1ComparisonSession,
} from "../src/testing/p1-session-comparison";

// Cases from the 2026-09-14 code review of the session comparison.

const TECHNICAL_SNAPSHOT: DeviceTechnicalSnapshot = {
  appBuildId: "build-v5",
  experimentProfileId: "gpu-640x480-30",
  requestedCameraWidth: 640,
  requestedCameraHeight: 480,
  requestedFrameRateIdeal: 30,
  requestedFrameRateMin: 30,
  requestedDelegate: "GPU",
  requestedModelId: "model",
  pageUrl: "https://example.test/",
  userAgent: "android-agent",
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
  device: null,
  frameSourceOverride: "auto",
  pendingPolicy: "hold",
  droppedFrames: 0,
};

interface DocumentOptions {
  readonly successFor?: (gesture: P1Gesture) => number;
  readonly technical?: Partial<DeviceTechnicalSnapshot>;
  readonly falseTriggerOrdinals?: readonly number[];
}

/** Runs the real protocol runner and exports the standard document, then round-trips it through JSON. */
function sessionDocument(
  sessionId: string,
  trials: readonly P1TrialDefinition[],
  options: DocumentOptions = {},
): Record<string, unknown> {
  const successFor = options.successFor ?? (() => 8);
  const runner = new Phase1ControlledRunner(trials === P1_CONTROLLED_TRIALS ? P1_FIVE_GESTURE_PROTOCOL : trials);
  runner.start();
  let timeMs = 0;
  for (const trial of trials) {
    runner.beginNextTrial(null, timeMs);
    if (trial.requiresReadiness === true) runner.startRecognition(timeMs + 100, null);
    if (options.falseTriggerOrdinals?.includes(trial.ordinal) === true) {
      runner.recordFalseTrigger(event(trial.gesture, timeMs + 150));
    }
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
    new LandmarkReplayRecorder(session).counts(),
    {
      inferenceP50Ms: 20,
      inferenceP95Ms: 40,
      trackingHz: 25,
      frameAgeP95Ms: 100,
      oneHandCoverage: 1,
      twoHandCoverage: 0.95,
      idConflictCount: 0,
    },
    { ...TECHNICAL_SNAPSHOT, ...options.technical },
    { now: new Date("2026-09-14T01:00:00.000Z") },
  );
  return JSON.parse(JSON.stringify(document)) as Record<string, unknown>;
}

function fiveGestureDocument(sessionId: string, options: DocumentOptions = {}): Record<string, unknown> {
  return sessionDocument(sessionId, P1_CONTROLLED_TRIALS, options);
}

function threeInputDocument(sessionId: string): Record<string, unknown> {
  const document = sessionDocument(sessionId, P1_CONTROLLED_TRIALS.slice(0, 30));
  document.schemaVersion = 4;
  document.gestureVocabulary = { thirdGesture: "bloom" };
  return document;
}

function event(gestureType: P1Gesture, eventTimeMs: number, quality: GestureEvent["quality"] = {}): GestureEvent {
  return {
    id: `event-${gestureType}-${eventTimeMs}`,
    gestureType,
    eventTimeMs,
    handIds: ["hand-1"],
    confidence: 0.9,
    quality,
    trackingQuality: "observed",
    reasonCodes: [],
  };
}

function matchingEvent(trial: P1TrialDefinition, eventTimeMs: number): GestureEvent {
  return event(trial.gesture, eventTimeMs, trial.swipeDirection !== undefined
    ? { direction: trial.swipeDirection }
    : trial.spotlightVariant !== undefined
      ? { spotlightVariant: trial.spotlightVariant }
      : {});
}

function parse(document: Record<string, unknown>, fileName = "session.json"): P1ComparisonSession {
  return parseP1SessionForComparison(JSON.stringify(document), fileName);
}

function codes(findings: readonly P1ComparisonFinding[]): string[] {
  return findings.map(({ code }) => code);
}

function protocolOf(document: Record<string, unknown>): Record<string, unknown> {
  return document.protocol as Record<string, unknown>;
}

function resultsOf(document: Record<string, unknown>): Array<Record<string, unknown>> {
  return protocolOf(document).results as Array<Record<string, unknown>>;
}

describe("P1 session comparison after the review fixes", () => {
  it("does not make a session a candidate when Bloom is at 7/10, however strong the candidate gestures are", () => {
    const session = parse(fiveGestureDocument("bloom-7", {
      successFor: (gesture) => (gesture === "bloom" ? 7 : gesture === "lift" || gesture === "spotlight" ? 10 : 8),
    }));

    expect(session).toMatchObject({ dataComplete: true, controlledCriterionCandidate: false });
    expect(codes(session.findings)).toContain("bloom-under-controlled");
  });

  it("keeps weak candidate gestures out of the criterion and the next action of two devices", () => {
    const weakCandidates = (gesture: P1Gesture): number => (gesture === "lift" || gesture === "spotlight" ? 5 : 8);
    const result = compareP1Sessions([
      parse(fiveGestureDocument("android", { successFor: weakCandidates })),
      parse(fiveGestureDocument("iphone", { successFor: weakCandidates, technical: { userAgent: "iphone-agent" } })),
    ]);

    expect(result.controlledCriterionCandidate).toBe(true);
    expect(result.nextAction).toContain("合格／要改善／方針転換");
    expect(codes(result.findings)).toContain("candidate-gestures");
  });

  it("accepts false triggers of the candidate gestures as a consistent record", () => {
    const session = parse(fiveGestureDocument("candidate-false-triggers", { falseTriggerOrdinals: [31, 45] }));

    expect(session).toMatchObject({ dataComplete: true, controlledCriterionCandidate: true });
    expect(session.gestures.lift.falseTrigger).toBe(1);
    expect(session.gestures.spotlight.falseTrigger).toBe(1);
  });

  it("counts a session saved twice as one session", () => {
    const first = fiveGestureDocument("android");
    const second = { ...first, createdAtIso: "2026-09-14T02:00:00.000Z" };
    const result = compareP1Sessions([parse(first, "android.json"), parse(second, "android (1).json")]);

    expect(result.controlledCriterionCandidate).toBe(false);
    expect(codes(result.findings)).toContain("duplicate-sessions");
    expect(result.nextAction).toContain("もう一方の対象端末");
  });

  it("does not make two sessions with the same device agent a candidate", () => {
    const result = compareP1Sessions([parse(fiveGestureDocument("first")), parse(fiveGestureDocument("second"))]);

    expect(result.controlledCriterionCandidate).toBe(false);
    expect(codes(result.findings)).toContain("same-device-suspected");
    expect(result.nextAction).toContain("別の対象端末");
  });

  it("keeps a session that fell back from GPU to CPU apart from GPU sessions", () => {
    const cpu = parse(fiveGestureDocument("iphone", { technical: { userAgent: "iphone-agent", delegate: "CPU" } }));
    const result = compareP1Sessions([parse(fiveGestureDocument("android")), cpu]);

    expect(cpu.controlledCriterionCandidate).toBe(false);
    expect(codes(cpu.findings)).toContain("delegate-fallback");
    expect(result.controlledCriterionCandidate).toBe(false);
    expect(codes(result.findings)).toContain("mixed-delegates");
    expect(result.nextAction).toContain("CPU");
  });

  it("does not merge a 50-trial session labeled with the 30-trial ID into the 30-trial procedure", () => {
    const mislabeled = fiveGestureDocument("five");
    protocolOf(mislabeled).id = "p1-bloom-30";
    const result = compareP1Sessions([parse(mislabeled), parse(threeInputDocument("bloom-30"))]);

    expect(codes(result.findings)).toContain("mixed-protocols");
    expect(result.controlledCriterionCandidate).toBe(false);
  });

  it("flags each part of a v5 procedure record that does not match the five-gesture protocol", () => {
    const cases: Array<[string, (document: Record<string, unknown>) => void]> = [
      ["protocol-id-unknown", (document) => { protocolOf(document).id = "p1-custom"; }],
      ["trials-per-gesture", (document) => { protocolOf(document).trialsPerGesture = 5; }],
      ["v5-blocks-incomplete", (document) => { delete protocolOf(document).blocks; }],
      ["v5-attempt-missing", (document) => { for (const result of resultsOf(document)) delete result.attempt; }],
      ["v5-spotlight-variants", (document) => {
        for (const result of resultsOf(document).slice(40)) {
          (result.trial as Record<string, unknown>).spotlightVariant = "left-up-right-down";
        }
      }],
    ];
    for (const [code, mutate] of cases) {
      const document = fiveGestureDocument(code);
      mutate(document);
      const session = parse(document);

      expect(codes(session.findings), code).toContain(code);
      expect(session.dataComplete, code).toBe(true);
      expect(session.controlledCriterionCandidate, code).toBe(false);
    }
  });

  it("reports a missing candidate vocabulary and a missing protocol ID as separate errors", () => {
    const vocabulary = fiveGestureDocument("vocabulary");
    vocabulary.gestureVocabulary = { thirdGesture: "bloom", gestures: ["air-tap", "ribbon-swipe", "bloom", "lift"] };
    const protocolId = fiveGestureDocument("protocol-id");
    protocolOf(protocolId).id = "";

    expect(parse(vocabulary).findings).toContainEqual(expect.objectContaining({
      code: "gesture-vocabulary-candidates",
      severity: "error",
    }));
    expect(parse(protocolId).findings).toContainEqual(expect.objectContaining({ code: "protocol-id-missing", severity: "error" }));
    expect(parse(protocolId).dataComplete).toBe(false);
  });

  it("asks for the current procedure when only an old 30-trial session is loaded", () => {
    // The current app no longer always runs 50 trials, so the wording names no trial count.
    const result = compareP1Sessions([parse(threeInputDocument("bloom-30"))]);

    expect(result.nextAction).toBe("現行の試験手順で、両方の対象端末を同じビルドとプロファイルで測る");
  });
});
