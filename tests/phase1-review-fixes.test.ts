import { describe, expect, it } from "vitest";
import type { GestureEvent } from "../src/gestures/gesture-types";
import type { DeviceTechnicalSnapshot } from "../src/metrics/device-technical-snapshot";
import { Phase1LabEngine } from "../src/poc/phase1-lab-engine";
import {
  P1_CONTROLLED_TRIALS,
  P1_LEGACY_CLAP_TRIALS,
  Phase1ControlledRunner,
  createP1ProtocolDefinition,
} from "../src/poc/phase1-protocol";
import { summarizeProtocol } from "../src/poc/phase1-session";
import { parseLandmarkReplay, serializeLandmarkReplay } from "../src/replay/landmark-replay";
import { syntheticHand, trackingFrame } from "./helpers/tracking-fixtures";

// Scenarios from the 2026-09-14 code review of the five-gesture protocol.

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

function skipTrials(engine: Phase1LabEngine, count: number): void {
  for (let index = 0; index < count; index += 1) {
    engine.beginNextTrial(null, index);
    engine.recordOutcome("unclassified", [], index);
  }
}

// Raw camera coordinates. The engine mirrors x, so raw 0.72 appears on the screen's left.
function liftAt(frameId: number, timeMs: number, y: number) {
  return trackingFrame(frameId, timeMs, [syntheticHand(0, "left", 0.72, y), syntheticHand(1, "right", 0.28, y)]);
}

function bloomAt(frameId: number, timeMs: number, leftRawX: number, rightRawX: number, y: number) {
  return trackingFrame(frameId, timeMs, [syntheticHand(0, "left", leftRawX, y), syntheticHand(1, "right", rightRawX, y)]);
}

const bloomStart = (frameId: number, timeMs: number) => bloomAt(frameId, timeMs, 0.58, 0.42, 0.56);
const bloomHalf = (frameId: number, timeMs: number) => bloomAt(frameId, timeMs, 0.7, 0.3, 0.48);
const bloomOpen = (frameId: number, timeMs: number) => bloomAt(frameId, timeMs, 0.76, 0.24, 0.44);
const bloomInward = (frameId: number, timeMs: number) => bloomAt(frameId, timeMs, 0.55, 0.45, 0.56);
const spotlightLeftUp = () => [syntheticHand(0, "left", 0.72, 0.2), syntheticHand(1, "right", 0.28, 0.6)];
const spotlightRightUp = () => [syntheticHand(0, "left", 0.72, 0.6), syntheticHand(1, "right", 0.28, 0.2)];
const spotlightNeutral = () => [syntheticHand(0, "left", 0.7, 0.4), syntheticHand(1, "right", 0.3, 0.4)];

/** Settles the Bloom start position, opens the recognition window without audio, and arms at the given time. */
function readyBloom(engine: Phase1LabEngine, startMs: number): void {
  engine.beginNextTrial(null, startMs);
  engine.processFrame(bloomStart(startMs + 1, startMs));
  engine.processFrame(bloomStart(startMs + 2, startMs + 100));
  engine.processFrame(bloomStart(startMs + 3, startMs + 200));
  expect(engine.startRecognition(null)).toBe(true);
}

function event(
  gestureType: GestureEvent["gestureType"],
  eventTimeMs: number,
  quality: GestureEvent["quality"] = {},
): GestureEvent {
  return {
    id: `event-${gestureType}-${eventTimeMs}`,
    gestureType,
    eventTimeMs,
    handIds: [],
    confidence: 0.9,
    quality,
    trackingQuality: "observed",
    reasonCodes: [],
  };
}

describe("P1 records after the review fixes", () => {
  it("keeps rejections of a discarded attempt out of the reason counts of the results", () => {
    const engine = new Phase1LabEngine();
    engine.startSession("abandoned-reasons", null);
    skipTrials(engine, 30);
    engine.beginNextTrial(null, 1_000);
    engine.processFrame(liftAt(101, 1_000, 0.62));
    engine.processFrame(liftAt(102, 1_100, 0.62));
    engine.processFrame(liftAt(103, 1_200, 0.62));
    expect(engine.startRecognition(null)).toBe(true);
    engine.processFrame(liftAt(104, 1_300, 0.2));
    expect(engine.snapshot.latestDiagnostic?.reasonCodes).toEqual(["lift-not-ready"]);
    expect(engine.pause(1_400)).toBe(true);
    expect(engine.resume(2_000)).toBe(true);
    engine.beginNextTrial(null, 2_000);
    engine.processFrame(liftAt(105, 2_000, 0.62));
    engine.processFrame(liftAt(106, 2_100, 0.62));
    engine.processFrame(liftAt(107, 2_200, 0.62));
    expect(engine.startRecognition(null)).toBe(true);
    engine.processFrame(liftAt(108, 2_300, 0.62));
    engine.processFrame(liftAt(109, 2_400, 0.5));
    engine.processFrame(liftAt(110, 2_500, 0.4));
    const document = engine.createDocument(TECHNICAL_SUMMARY, TECHNICAL_SNAPSHOT);

    expect(document.protocol.results.at(-1)).toMatchObject({ attempt: 2, outcome: "success", rejectionCount: 0 });
    expect(document.summary.diagnosticReasonCounts).toEqual({});
    expect(document.summary.abandonedAttemptReasonCounts).toEqual({ "lift-not-ready": 1 });
    expect(document.trialDiagnostics.map(({ trialId, attempt }) => [trialId, attempt])).toEqual([["lift-1", 1]]);
  });

  it("moves automatic false triggers of a discarded attempt apart and keeps manual ones", () => {
    const runner = new Phase1ControlledRunner(P1_CONTROLLED_TRIALS.slice(40, 42));
    runner.start();
    runner.startBlock(0);
    runner.beginNextTrial(null, 0);
    expect(runner.acceptEvent(event("spotlight", 100, { spotlightVariant: "right-up-left-down" }))).toBe(false);
    expect(runner.snapshot.falseTriggers).toHaveLength(1);
    expect(runner.pause(200).paused).toBe(true);
    runner.resume(300);
    runner.beginNextTrial(null, 300);
    runner.recordFalseTrigger(event("spotlight", 350));
    runner.pause(400);

    expect(runner.snapshot.falseTriggers).toEqual([expect.objectContaining({ eventTimeMs: 350 })]);
    expect(runner.snapshot.abandonedFalseTriggers).toEqual([expect.objectContaining({ eventTimeMs: 100 })]);
    expect(summarizeProtocol(runner.snapshot)).toMatchObject({ falseTriggers: 1, abandonedFalseTriggers: 1 });
  });

  it("records why the start position never settled", () => {
    const engine = new Phase1LabEngine();
    engine.startSession("readiness-causes", null);
    skipTrials(engine, 30);
    engine.beginNextTrial(null, 0);
    for (let index = 0; index < 20; index += 1) {
      engine.processFrame(trackingFrame(index + 1, index * 400, [syntheticHand(0, "left", 0.72, 0.62)]));
    }
    engine.timeout(10_000);
    engine.beginNextTrial(null, 20_000);
    for (let index = 0; index < 20; index += 1) {
      engine.processFrame(liftAt(index + 100, 20_000 + index * 100, index % 2 === 0 ? 0.62 : 0.7));
    }
    engine.timeout(30_000);
    const [handsMissing, notStill] = engine.snapshot.protocol.results.slice(-2);

    expect(handsMissing).toMatchObject({
      reasonCodes: ["readiness-timeout", "readiness-hands-missing", "lift-not-ready"],
      readinessDiagnostic: { frameCount: 20, twoHandFrameCount: 0, inZoneFrameCount: 0, lastVisibleHands: 1 },
    });
    expect(notStill).toMatchObject({
      reasonCodes: ["readiness-timeout", "readiness-not-still", "lift-not-ready"],
      readinessDiagnostic: { frameCount: 20, twoHandFrameCount: 20, inZoneFrameCount: 20, longestStableMs: 0 },
    });
    expect(handsMissing).not.toHaveProperty("liftDiagnostic");
  });

  it("accepts a settling frame captured 1ms before the readiness deadline and ignores one 1ms after it", () => {
    // Frames 60ms apart keep the hand identities; the pipeline starts new tracks after a longer gap.
    const readyWithLastFrameAt = (lastMs: number): boolean => {
      const engine = new Phase1LabEngine();
      engine.startSession(`deadline-${lastMs}`, null);
      skipTrials(engine, 30);
      engine.beginNextTrial(null, 0);
      for (const [index, offsetMs] of [180, 120, 60, 0].entries()) {
        engine.processFrame(liftAt(index + 1, lastMs - offsetMs, 0.62));
      }
      return engine.snapshot.readinessReached;
    };

    expect(readyWithLastFrameAt(9_999)).toBe(true);
    expect(readyWithLastFrameAt(10_001)).toBe(false);
  });

  it("counts a tracking loss before a success apart from rejections", () => {
    const engine = new Phase1LabEngine();
    engine.startSession("tracking-loss", null);
    skipTrials(engine, 20);
    readyBloom(engine, 0);
    engine.processFrame(bloomStart(4, 300));
    engine.processFrame(trackingFrame(5, 400, []));
    engine.processFrame(trackingFrame(6, 600, []));
    // After the loss the pair re-arms once it has settled for 250ms.
    for (let timeMs = 700; timeMs <= 1_000; timeMs += 50) engine.processFrame(bloomStart(timeMs, timeMs));
    engine.processFrame(bloomHalf(1_100, 1_100));
    engine.processFrame(bloomOpen(1_200, 1_200));
    const document = engine.createDocument(TECHNICAL_SUMMARY, TECHNICAL_SNAPSHOT);

    expect(document.protocol.results.at(-1)).toMatchObject({ outcome: "success", rejectionCount: 0, trackingLossCount: 1 });
    expect(document.summary.byGesture.bloom).toMatchObject({
      trialsWithRejectionBeforeSuccess: 0,
      trialsWithTrackingLossBeforeSuccess: 1,
    });
    expect(document.trialDiagnostics.map(({ kind, reasonCodes }) => [kind, reasonCodes.join()]))
      .toEqual([["tracking-gap", "tracking-lost"]]);
  });

  it("counts a player rejection before a success and summarizes readiness times and skips", () => {
    const engine = new Phase1LabEngine();
    engine.startSession("rejection-before-success", null);
    skipTrials(engine, 20);
    readyBloom(engine, 0);
    engine.processFrame(bloomStart(4, 300));
    engine.processFrame(bloomInward(5, 400));
    for (let timeMs = 450; timeMs <= 700; timeMs += 50) engine.processFrame(bloomStart(timeMs, timeMs));
    engine.processFrame(bloomHalf(800, 800));
    engine.processFrame(bloomOpen(900, 900));
    engine.beginNextTrial(null, 2_000);
    // One hand only at first, so the start position settles 300ms after the trial appears.
    engine.processFrame(trackingFrame(2_000, 2_000, [syntheticHand(0, "left", 0.58, 0.56)]));
    for (let timeMs = 2_100; timeMs <= 2_300; timeMs += 100) engine.processFrame(bloomStart(timeMs, timeMs));
    expect(engine.startRecognition(null)).toBe(true);
    engine.skip(2_400);
    const document = engine.createDocument(TECHNICAL_SUMMARY, TECHNICAL_SNAPSHOT);

    expect(document.protocol.results[20]).toMatchObject({ outcome: "success", rejectionCount: 1, trackingLossCount: 0 });
    expect(document.summary.byGesture.bloom).toMatchObject({
      completed: 2,
      success: 1,
      manualSkip: 1,
      trialsWithRejectionBeforeSuccess: 1,
      readinessP50Ms: 250,
      readinessP95Ms: 295,
    });
    expect(document.summary.diagnosticReasonCounts).toEqual({ "bloom-not-outward": 1 });
  });

  it("numbers diagnostics with the attempt that produced them", () => {
    const engine = new Phase1LabEngine();
    engine.startSession("attempts", null);
    skipTrials(engine, 20);
    readyBloom(engine, 0);
    engine.pause(250, "page-hidden");
    engine.resume(1_000);
    readyBloom(engine, 1_000);
    engine.processFrame(bloomStart(4, 1_300));
    engine.processFrame(bloomInward(5, 1_400));

    expect(engine.snapshot.latestDiagnostic).toMatchObject({ trialId: "bloom-1", attempt: 2, reasonCodes: ["bloom-not-outward"] });
  });

  it("keeps the active attempt when a second start is refused", () => {
    const engine = new Phase1LabEngine();
    engine.startSession("refused-start", null);
    engine.beginNextTrial(1_000, 0);
    expect(engine.beginNextTrial(1_000, 10)).toBeNull();
    engine.processFrame(trackingFrame(1, 500, [syntheticHand(0, "left", 0.95, 0.5)]));
    engine.processFrame(trackingFrame(2, 600, [syntheticHand(0, "left", 0.7, 0.5)]));
    expect(engine.snapshot.protocol.completed).toBe(1);

    const gated = new Phase1LabEngine();
    gated.startSession("refused-gated", null);
    skipTrials(gated, 30);
    gated.beginNextTrial(null, 0);
    gated.processFrame(liftAt(1, 0, 0.62));
    gated.processFrame(liftAt(2, 100, 0.62));
    gated.processFrame(liftAt(3, 200, 0.62));
    expect(gated.beginNextTrial(null, 250)).toBeNull();
    expect(gated.snapshot.readinessReached).toBe(true);
    expect(gated.startRecognition(null)).toBe(true);
  });

  it("records the legacy clap as the third gesture of a document rebuilt from clap trials", () => {
    const engine = new Phase1LabEngine(P1_LEGACY_CLAP_TRIALS);
    engine.startSession("legacy-clap", null);
    skipTrials(engine, 10);

    expect(engine.createDocument(TECHNICAL_SUMMARY, TECHNICAL_SNAPSHOT).gestureVocabulary).toEqual({
      thirdGesture: "clap",
      gestures: ["clap"],
      candidateGestures: [],
    });
  });

  it("refuses trial lists with duplicated ordinals or a readiness check on a gesture without one", () => {
    expect(() => createP1ProtocolDefinition([...P1_CONTROLLED_TRIALS.slice(0, 20), ...P1_LEGACY_CLAP_TRIALS]))
      .toThrow(/ordinal is duplicated/);
    expect(() => new Phase1ControlledRunner([{ ...P1_CONTROLLED_TRIALS[0]!, requiresReadiness: true }]))
      .toThrow(/no readiness check/);
  });

  it("alternates air-tap sides and Spotlight diagonals exactly", () => {
    const alternating = <T>(first: T, second: T): T[] => Array.from({ length: 10 }, (_, index) => (index % 2 === 0 ? first : second));

    expect(P1_CONTROLLED_TRIALS.slice(0, 10).map(({ airTapSide }) => airTapSide)).toEqual(alternating("left", "right"));
    expect(P1_CONTROLLED_TRIALS.slice(40).map(({ spotlightVariant }) => spotlightVariant))
      .toEqual(alternating("left-up-right-down", "right-up-left-down"));
  });

  it("recognizes the right-side air-tap only through the right ring", () => {
    const engine = new Phase1LabEngine();
    engine.startSession("air-tap-right", null);
    skipTrials(engine, 1);
    expect(engine.beginNextTrial(null, 1_000)).toMatchObject({ id: "air-tap-2", airTapSide: "right" });
    engine.processFrame(trackingFrame(1, 1_050, [syntheticHand(0, "left", 0.95, 0.5)]));
    engine.processFrame(trackingFrame(2, 1_150, [syntheticHand(0, "left", 0.7, 0.5)]));
    expect(engine.snapshot.protocol.completed).toBe(1);
    engine.processFrame(trackingFrame(3, 1_500, [syntheticHand(0, "right", 0.05, 0.5)]));
    engine.processFrame(trackingFrame(4, 1_600, [syntheticHand(0, "right", 0.3, 0.5)]));

    expect(engine.snapshot.protocol.results.at(-1)).toMatchObject({ trial: { id: "air-tap-2" }, outcome: "success" });
  });

  it("recognizes the right-hand-up Spotlight trial only with that diagonal", () => {
    const engine = new Phase1LabEngine();
    engine.startSession("spotlight-right-up", null);
    skipTrials(engine, 41);
    expect(engine.beginNextTrial(null, 1_000)).toMatchObject({ id: "spotlight-2", spotlightVariant: "right-up-left-down" });
    engine.processFrame(trackingFrame(1, 1_000, spotlightNeutral()));
    engine.processFrame(trackingFrame(2, 1_100, spotlightLeftUp()));
    engine.processFrame(trackingFrame(3, 1_400, spotlightLeftUp()));
    expect(engine.snapshot.protocol.completed).toBe(41);
    expect(engine.snapshot.latestDiagnostic?.reasonCodes).toEqual(["spotlight-wrong-side"]);
    engine.processFrame(trackingFrame(4, 1_500, spotlightRightUp()));
    engine.processFrame(trackingFrame(5, 1_800, spotlightRightUp()));

    expect(engine.snapshot.protocol.results.at(-1)).toMatchObject({
      outcome: "success",
      event: { eventTimeMs: 1_500, quality: { spotlightVariant: "right-up-left-down" } },
    });
  });

  it("treats a Spotlight pose already formed at the start of a trial without audio as formed before GO", () => {
    const engine = new Phase1LabEngine();
    engine.startSession("spotlight-no-audio", null);
    skipTrials(engine, 40);
    engine.beginNextTrial(null, 1_000);
    engine.processFrame(trackingFrame(1, 1_000, spotlightLeftUp()));
    engine.processFrame(trackingFrame(2, 1_300, spotlightLeftUp()));
    expect(engine.snapshot.protocol.completed).toBe(40);
    expect(engine.snapshot.latestDiagnostic?.reasonCodes).toEqual(["spotlight-pose-before-go"]);
    engine.processFrame(trackingFrame(3, 1_400, spotlightNeutral()));
    engine.processFrame(trackingFrame(4, 1_500, spotlightNeutral()));
    engine.processFrame(trackingFrame(5, 1_600, spotlightLeftUp()));
    engine.processFrame(trackingFrame(6, 1_900, spotlightLeftUp()));

    expect(engine.snapshot.protocol.results.at(-1)).toMatchObject({
      outcome: "success",
      event: { eventTimeMs: 1_600 },
      spotlightDiagnostic: { poseBeforeGo: true },
    });
  });

  it("starts the replay post-roll after the frame that confirmed a Spotlight hold", () => {
    const engine = new Phase1LabEngine();
    engine.startSession("spotlight-post-roll", null);
    skipTrials(engine, 40);
    engine.beginNextTrial(null, 1_000);
    engine.processFrame(trackingFrame(1, 1_100, spotlightNeutral()));
    engine.processFrame(trackingFrame(2, 1_200, spotlightLeftUp()));
    engine.processFrame(trackingFrame(3, 1_500, spotlightLeftUp()));
    for (const [frameId, timeMs] of [[4, 1_600], [5, 1_700], [6, 1_750]] as const) {
      engine.processFrame(trackingFrame(frameId, timeMs, spotlightLeftUp()));
    }

    expect(engine.snapshot.protocol.results.at(-1)).toMatchObject({ finishedAtMs: 1_200, spotlightDiagnostic: { holdCompletedAtMs: 1_500 } });
    expect(engine.createDiagnosticReplay().trialWindows.at(-1)).toMatchObject({ trialId: "spotlight-1", finishedAtMs: 1_500 });
    expect(engine.diagnosticPostRollPending).toBe(true);
  });
});

describe("Diagnostic replay after the review fixes", () => {
  it("closes a discarded window at once, so saving never waits for post-roll frames", () => {
    const engine = new Phase1LabEngine();
    engine.startSession("abandoned-window", null);
    engine.startBlock(0);
    engine.beginNextTrial(null, 10);
    engine.processFrame(trackingFrame(1, 20, [syntheticHand(0, "left", 0.95, 0.5)]));
    engine.pause(100, "page-hidden");

    expect(engine.diagnosticPostRollPending).toBe(false);
    expect(engine.createDiagnosticReplay().trialWindows).toEqual([
      expect.objectContaining({ trialId: "air-tap-1", abandoned: true, finishedAtMs: 100 }),
    ]);
  });

  it("writes version 3 and round-trips readiness-only and discarded windows", () => {
    const engine = new Phase1LabEngine();
    engine.startSession("replay-v3", null);
    skipTrials(engine, 30);
    engine.beginNextTrial(null, 1_000);
    engine.processFrame(liftAt(1, 1_000, 0.2));
    engine.timeout(11_000);
    engine.processFrame(liftAt(2, 11_600, 0.2));
    engine.beginNextTrial(null, 12_000);
    engine.processFrame(liftAt(3, 12_100, 0.2));
    engine.pause(12_200);
    const reparsed = parseLandmarkReplay(serializeLandmarkReplay(engine.createDiagnosticReplay()));

    expect(reparsed.schemaVersion).toBe(3);
    if (reparsed.schemaVersion === 1) throw new Error("A version 3 replay was expected.");
    expect(reparsed.trialWindows.filter(({ trialId }) => trialId.startsWith("lift")).map((window) => (
      [window.trialId, window.timing, window.readiness?.readyAtMs, window.resolution, window.abandoned]
    ))).toEqual([
      ["lift-1", null, null, "trial-timeout", false],
      ["lift-2", null, null, null, true],
    ]);
  });

  it("still reads version 2 windows and refuses a version 2 window without timing", () => {
    const frame = {
      frameId: 1,
      captureTimeMs: 50,
      callbackTimeMs: 52,
      workerReceivedTimeMs: 54,
      inferenceStartedTimeMs: 55,
      inferenceCompletedTimeMs: 60,
      hands: [],
    };
    const window = {
      trialId: "bloom-1",
      ordinal: 21,
      startFrameIndex: 0,
      endFrameIndex: 0,
      timing: { preparedAtMs: 0, windowOpenedAtMs: 0, targetTimeMs: null, deadlineTimeMs: 10_000 },
      resolution: "gesture-event",
      finishedAtMs: 100,
    };
    const document = (trialWindow: Record<string, unknown>) => JSON.stringify({
      schema: "oto-motion-landmark-replay",
      schemaVersion: 2,
      privacy: { includesCameraFrames: false, includesAudio: false, derivedLandmarksOnly: true },
      session: { sessionId: "s", createdAtIso: "2026-09-13T00:00:00.000Z", appVersion: "v", provider: null, notes: "" },
      frames: [frame],
      trialWindows: [trialWindow],
    });
    const parsed = parseLandmarkReplay(document(window));

    expect(parsed.schemaVersion).toBe(2);
    if (parsed.schemaVersion === 1) throw new Error("A version 2 replay was expected.");
    expect(parsed.trialWindows[0]).toMatchObject({ timing: { readyAtMs: null }, readiness: null, abandoned: false });
    expect(() => parseLandmarkReplay(document({
      ...window,
      timing: null,
      readiness: { startedAtMs: 0, deadlineTimeMs: 10_000, requiredStableMs: 200, readyAtMs: null },
    }))).toThrow(/Invalid replay trial window/);
  });
});
