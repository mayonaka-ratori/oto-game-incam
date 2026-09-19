import { describe, expect, it } from "vitest";
import type { GestureEvent } from "../src/gestures/gesture-types";
import type { DeviceTechnicalSnapshot } from "../src/metrics/device-technical-snapshot";
import {
  P1_FIVE_GESTURE_PROTOCOL,
  P1_REGRESSION_THREE_PROTOCOL,
  P1_REMAINING_TWO_PROTOCOL,
  Phase1ControlledRunner,
  type P1Gesture,
  type P1ProtocolDefinition,
  type P1TrialDefinition,
} from "../src/poc/phase1-protocol";
import { createPhase1SessionDocument } from "../src/poc/phase1-session";
import { LandmarkReplayRecorder } from "../src/replay/landmark-replay";
import { readP1SessionForChecklist } from "../src/testing/device-checklist";
import {
  compareP1Sessions,
  parseP1SessionForComparison,
  type P1ComparisonSession,
} from "../src/testing/p1-session-comparison";

// Schema v7: the app no longer always runs the five-gesture, 50-trial procedure, and the result
// JSON records what the phone is and how the frames reached the Worker.

const TECHNICAL_SNAPSHOT: DeviceTechnicalSnapshot = {
  appBuildId: "build-v7",
  experimentProfileId: "gpu-640x480-30",
  requestedCameraWidth: 640,
  requestedCameraHeight: 480,
  requestedFrameRateIdeal: 30,
  requestedFrameRateMin: 30,
  requestedDelegate: "GPU",
  requestedModelId: "model",
  pageUrl: "https://example.test/",
  userAgent: "Mozilla/5.0 (Linux; Android 10; K)",
  viewport: "1023 × 403",
  devicePixelRatio: 2.19,
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
  frameSource: "MediaStreamTrackProcessor",
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

function sessionDocument(
  sessionId: string,
  protocol: P1ProtocolDefinition,
  options: {
    readonly successFor?: (gesture: P1Gesture) => number;
    readonly technical?: Partial<DeviceTechnicalSnapshot>;
  } = {},
): Record<string, unknown> {
  const successFor = options.successFor ?? (() => protocol.trialsPerGesture);
  const runner = new Phase1ControlledRunner(protocol);
  runner.start();
  const seen = new Map<P1Gesture, number>();
  let timeMs = 0;
  for (const trial of protocol.trials) {
    const index = seen.get(trial.gesture) ?? 0;
    seen.set(trial.gesture, index + 1);
    runner.beginNextTrial(null, timeMs);
    if (trial.requiresReadiness === true) runner.startRecognition(timeMs + 100, null);
    if (index < successFor(trial.gesture)) runner.acceptEvent(matchingEvent(trial, timeMs + 200));
    else runner.timeout(timeMs + 10_100);
    timeMs += 20_000;
  }
  const session = {
    sessionId,
    createdAtIso: "2026-09-19T00:00:00.000Z",
    appVersion: "build-v7",
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
    { now: new Date("2026-09-19T01:00:00.000Z") },
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

function parse(document: Record<string, unknown>, fileName = "session.json"): P1ComparisonSession {
  return parseP1SessionForComparison(JSON.stringify(document), fileName);
}

const codes = (findings: readonly { readonly code: string }[]): string[] => findings.map(({ code }) => code);

describe("P1 session comparison of the schema v7 procedures", () => {
  it("records what was actually run in the result JSON", () => {
    const remaining = sessionDocument("remaining", P1_REMAINING_TWO_PROTOCOL);
    const regression = sessionDocument("regression", P1_REGRESSION_THREE_PROTOCOL);

    expect(remaining).toMatchObject({
      schemaVersion: 7,
      gestureVocabulary: { gestures: ["ribbon-swipe", "bloom"], candidateGestures: [] },
      protocol: { id: "p1-remaining-two-20", trialsPerGesture: 10, total: 20 },
    });
    expect(regression).toMatchObject({
      schemaVersion: 7,
      gestureVocabulary: { gestures: ["air-tap", "lift", "spotlight"], candidateGestures: ["lift", "spotlight"] },
      protocol: { id: "p1-regression-three-9", trialsPerGesture: 3, total: 9 },
    });
  });

  it("accepts a 20-trial session and shows its two rates, but never alone as a pass candidate", () => {
    const session = parse(sessionDocument("remaining", P1_REMAINING_TWO_PROTOCOL, {
      successFor: (gesture) => (gesture === "bloom" ? 9 : 10),
    }));

    expect(session).toMatchObject({
      protocolId: "p1-remaining-two-20",
      trialsPerGesture: 10,
      successThreshold: 8,
      sessionGestures: ["ribbon-swipe", "bloom"],
      completed: 20,
      total: 20,
      dataComplete: true,
      controlledCriterionCandidate: false,
    });
    expect(session.gestures["ribbon-swipe"].success).toBe(10);
    expect(session.gestures.bloom.success).toBe(9);
    // Air-tap was never run here, so it must not read as 0/10.
    expect(session.gestures["air-tap"].completed).toBe(0);
    const reason = session.findings.find(({ code }) => code === "protocol-not-criterion");
    expect(reason).toMatchObject({ severity: "info" });
    expect(reason?.message).toContain("3入力");
    // Nothing is reported as broken: the 20-trial procedure is a complete procedure of its own.
    expect(session.findings.filter(({ severity }) => severity !== "info")).toEqual([]);
  });

  it("accepts a 9-trial regression session and treats all three successes as the target", () => {
    const clean = parse(sessionDocument("regression-clean", P1_REGRESSION_THREE_PROTOCOL));
    const broken = parse(sessionDocument("regression-broken", P1_REGRESSION_THREE_PROTOCOL, {
      successFor: (gesture) => (gesture === "air-tap" ? 2 : 3),
    }));

    expect(clean).toMatchObject({
      protocolId: "p1-regression-three-9",
      trialsPerGesture: 3,
      successThreshold: 3,
      completed: 9,
      total: 9,
      dataComplete: true,
      controlledCriterionCandidate: false,
    });
    expect(clean.findings.filter(({ severity }) => severity !== "info")).toEqual([]);
    expect(codes(broken.findings)).toContain("air-tap-under-controlled");
    expect(broken.findings.find(({ code }) => code === "air-tap-under-controlled")?.message).toContain("2/3");
  });

  it("does not merge the 20-trial results into the 50-trial table", () => {
    const remaining = parse(sessionDocument("remaining", P1_REMAINING_TWO_PROTOCOL), "remaining.json");
    const five = parse(
      sessionDocument("five", P1_FIVE_GESTURE_PROTOCOL, { technical: { userAgent: "iphone-agent" } }),
      "five.json",
    );
    const result = compareP1Sessions([remaining, five]);

    expect(codes(result.findings)).toContain("mixed-protocols");
    expect(result.controlledCriterionCandidate).toBe(false);
    expect(result.nextAction).toContain("試験手順ごとに分け");
  });

  it("keeps sessions measured with different frame pipelines out of one condition", () => {
    const hold = parse(sessionDocument("hold", P1_REMAINING_TWO_PROTOCOL), "hold.json");
    const drop = parse(sessionDocument("drop", P1_REMAINING_TWO_PROTOCOL, {
      technical: { pendingPolicy: "drop", frameSourceOverride: "rvfc", droppedFrames: 812 },
    }), "drop.json");

    expect(hold).toMatchObject({ frameSourceOverride: "auto", pendingPolicy: "hold" });
    expect(drop).toMatchObject({ frameSourceOverride: "rvfc", pendingPolicy: "drop" });
    const result = compareP1Sessions([hold, drop]);
    expect(codes(result.findings)).toEqual(expect.arrayContaining(["mixed-frame-sources", "mixed-pending-policies"]));
    expect(result.controlledCriterionCandidate).toBe(false);
  });

  it("tells two phones apart by the model when Chrome hides it in the user agent", () => {
    const withModel = (model: string): Partial<DeviceTechnicalSnapshot> => ({
      device: { ...EMPTY_DEVICE, model },
    });
    const pixel = parse(sessionDocument("pixel", P1_FIVE_GESTURE_PROTOCOL, { technical: withModel("Pixel 7") }));
    const xperia = parse(sessionDocument("xperia", P1_FIVE_GESTURE_PROTOCOL, { technical: withModel("SO-51C") }));
    const noModel = parse(sessionDocument("no-model-a", P1_FIVE_GESTURE_PROTOCOL));
    const alsoNoModel = parse(sessionDocument("no-model-b", P1_FIVE_GESTURE_PROTOCOL));

    expect(pixel.deviceModel).toBe("Pixel 7");
    // Same user agent "Android 10; K", different models: no longer treated as one device.
    expect(codes(compareP1Sessions([pixel, xperia]).findings)).not.toContain("same-device-suspected");
    expect(codes(compareP1Sessions([pixel, parse(sessionDocument("pixel-2", P1_FIVE_GESTURE_PROTOCOL, {
      technical: withModel("Pixel 7"),
    }))]).findings)).toContain("same-device-suspected");
    // Without a model the check falls back to the user agent, exactly as before.
    expect(codes(compareP1Sessions([noModel, alsoNoModel]).findings)).toContain("same-device-suspected");
  });

  it("fills only the rows the procedure ran when the device checklist imports a 20-trial session", () => {
    const imported = readP1SessionForChecklist(sessionDocument("remaining", P1_REMAINING_TWO_PROTOCOL));

    expect(imported).toMatchObject({
      schemaVersion: 7,
      protocolId: "p1-remaining-two-20",
      ranGestures: ["ribbon-swipe", "bloom"],
      airTap: null,
    });
    expect(imported.ribbonSwipe).toMatchObject({ success: 10 });
    expect(imported.bloom).toMatchObject({ success: 10 });
    expect(imported.technical).toMatchObject({ frameSourceOverride: "auto", pendingPolicy: "hold", device: null });
  });

  it("reads the v7 device record and pipeline settings back out of the checklist snapshot", () => {
    const document = sessionDocument("device", P1_FIVE_GESTURE_PROTOCOL, {
      technical: {
        device: { ...EMPTY_DEVICE, model: "Pixel 7", gpuRenderer: "Adreno (TM) 730" },
        frameSourceOverride: "timer",
        pendingPolicy: "drop",
        droppedFrames: 3,
      },
    });
    const imported = readP1SessionForChecklist(document);

    expect(imported.technical).toMatchObject({
      frameSourceOverride: "timer",
      pendingPolicy: "drop",
      droppedFrames: 3,
      device: { model: "Pixel 7", gpuRenderer: "Adreno (TM) 730" },
    });
  });
});

const EMPTY_DEVICE = {
  source: "userAgentData" as const,
  mobile: true,
  model: null,
  platform: "Android",
  platformVersion: "14.0.0",
  architecture: "arm",
  bitness: "64",
  formFactors: ["Mobile"],
  browserName: "Google Chrome",
  browserVersion: "140.0.7339.80",
  fullVersionList: null,
  hardwareConcurrency: 8,
  deviceMemoryGb: 8,
  maxTouchPoints: 5,
  language: "ja-JP",
  screen: {
    width: 412,
    height: 915,
    availWidth: 412,
    availHeight: 915,
    devicePixelRatio: 2.19,
    physicalWidth: 902,
    physicalHeight: 2004,
  },
  gpuRenderer: null,
  gpuVendor: null,
  batteryAtStart: null,
  batteryAtExport: null,
};
