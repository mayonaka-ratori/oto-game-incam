import { describe, expect, it } from "vitest";
import {
  createDeviceCheckReport,
  DEVICE_CHECK_ITEMS,
  parseDeviceCheckReport,
  readP1SessionForChecklist,
  type ControlledGestureResult,
  type DeviceCheckFormValues,
  type DeviceCheckTechnicalSnapshot,
} from "../src/testing/device-checklist";

const technical: DeviceCheckTechnicalSnapshot = {
  appBuildId: "0.1.0-test",
  experimentProfileId: "baseline-gpu-640x480-60",
  requestedCameraWidth: 640,
  requestedCameraHeight: 480,
  requestedFrameRateIdeal: 60,
  requestedFrameRateMin: 30,
  requestedDelegate: "GPU",
  requestedModelId: "hand-landmarker-test",
  pageUrl: "https://example.test/",
  userAgent: "test-agent",
  viewport: "844 × 390",
  devicePixelRatio: 2,
  actualCameraWidth: 640,
  actualCameraHeight: 480,
  actualCameraFrameRate: 30,
  actualFacingMode: "user",
  cameraFps: 30,
  trackingHz: 25,
  inferenceP50Ms: 16,
  inferenceP95Ms: 22,
  frameAgeP95Ms: 80,
  oneHandCoverage: 0.99,
  twoHandCoverage: 0.96,
  frameSource: "requestVideoFrameCallback",
  delegate: "GPU",
  packageId: "@mediapipe/tasks-vision@0.10.35",
  modelId: "hand-landmarker-test",
  capturedFrames: 100,
  completedFrames: 90,
  replacedFrames: 9,
  erroredFrames: 1,
  inFlightFrames: 0,
  pendingFrames: 0,
  trackingError: null,
  device: null,
  frameSourceOverride: "auto",
  pendingPolicy: "hold",
  droppedFrames: 0,
};

describe("P1 result import for the device check", () => {
  function gestureSummary(success: number): Record<string, number> {
    return {
      completed: 10,
      success,
      playerMiss: 0,
      machineMiss: 0,
      falseTrigger: 0,
      trackingLoss: 0,
      unclassified: 10 - success,
      offsetP50Ms: 12,
      offsetP95Ms: 30,
    };
  }

  function p1Document(schemaVersion: number): Record<string, unknown> {
    const thirdGesture = schemaVersion >= 4 ? "bloom" : "clap";
    return {
      schema: "oto-motion-p1-controlled",
      schemaVersion,
      createdAtIso: "2026-09-14T00:00:00.000Z",
      ...(schemaVersion >= 4 ? { gestureVocabulary: { thirdGesture: "bloom" } } : {}),
      session: { sessionId: `session-v${schemaVersion}` },
      protocol: { id: schemaVersion >= 5 ? "p1-five-gesture-50" : "p1-custom" },
      summary: {
        byGesture: {
          "air-tap": gestureSummary(9),
          "ribbon-swipe": gestureSummary(8),
          [thirdGesture]: gestureSummary(7),
        },
      },
    };
  }

  it("reads the three current inputs and the procedure of a five-gesture session", () => {
    expect(readP1SessionForChecklist(p1Document(5))).toMatchObject({
      schemaVersion: 5,
      protocolId: "p1-five-gesture-50",
      thirdGesture: "bloom",
      airTap: { success: 9, offsetSummary: "p50 12ms / p95 30ms" },
      ribbonSwipe: { success: 8 },
      bloom: { success: 7 },
      sessionId: "session-v5",
      technical: null,
    });
  });

  it("reads a schema v6 session the same way, and keeps v5 readable", () => {
    expect(readP1SessionForChecklist(p1Document(6))).toMatchObject({
      schemaVersion: 6,
      protocolId: "p1-five-gesture-50",
      thirdGesture: "bloom",
      airTap: { success: 9 },
      bloom: { success: 7 },
      sessionId: "session-v6",
    });
    expect(readP1SessionForChecklist(p1Document(5))).toMatchObject({ schemaVersion: 5, thirdGesture: "bloom" });
  });

  it("leaves the Bloom row empty for a legacy clap session and names its procedure", () => {
    expect(readP1SessionForChecklist(p1Document(3))).toMatchObject({
      schemaVersion: 3,
      protocolId: "p1-legacy-clap-30",
      thirdGesture: "clap",
      bloom: null,
    });
  });

  it("refuses unknown schema versions and a new schema without Bloom as the third input", () => {
    const withoutVocabulary = p1Document(5);
    delete withoutVocabulary.gestureVocabulary;

    expect(() => readP1SessionForChecklist(p1Document(9))).toThrow(/schema version/);
    expect(() => readP1SessionForChecklist(withoutVocabulary)).toThrow(/第三入力/);
  });

  it("keeps the P1 procedure in the technical source and reads 2.2 reports without it", () => {
    const report = createDeviceCheckReport(formValues({}), technical, "2026-09-14T00:00:00.000Z", {
      mode: "p1-import",
      capturedAt: "2026-09-14T00:00:00.000Z",
      sessionId: "session-v5",
      p1SchemaVersion: 5,
      p1ProtocolId: "p1-five-gesture-50",
    });
    const legacy = JSON.parse(JSON.stringify(report)) as Record<string, unknown>;
    legacy.schemaVersion = "2.2";
    const legacySource = legacy.technicalSource as Record<string, unknown>;
    delete legacySource.p1SchemaVersion;
    delete legacySource.p1ProtocolId;

    expect(parseDeviceCheckReport(JSON.stringify(report)).technicalSource).toMatchObject({
      p1SchemaVersion: 5,
      p1ProtocolId: "p1-five-gesture-50",
    });
    expect(parseDeviceCheckReport(JSON.stringify(legacy)).technicalSource).toMatchObject({
      mode: "p1-import",
      p1SchemaVersion: null,
      p1ProtocolId: null,
    });
  });
});

describe("device check report", () => {
  it("keeps pending and issue items and explicitly excludes raw media", () => {
    const values = formValues({
      [DEVICE_CHECK_ITEMS[0]!.id]: "pass",
      [DEVICE_CHECK_ITEMS[1]!.id]: "issue",
    });
    const report = createDeviceCheckReport(values, technical, "2026-07-19T00:00:00.000Z");

    expect(report.progress).toMatchObject({
      completed: 2,
      total: DEVICE_CHECK_ITEMS.length,
      pass: 1,
      issue: 1,
      pending: DEVICE_CHECK_ITEMS.length - 2,
    });
    expect(report.checks.some((item) => item.status === "pending")).toBe(true);
    expect(report.privacy).toEqual({ includesCameraFrames: false, includesAudio: false });
    expect(JSON.parse(JSON.stringify(report))).toMatchObject({
      schemaVersion: "2.4",
      reportType: "phase1-device-check",
      technicalSource: { mode: "current-device", sessionId: "session-1" },
    });
  });

  it("round-trips a version 2 report for resume", () => {
    const original = createDeviceCheckReport(formValues({ privacy: "pass" }), technical, "2026-07-19T00:00:00.000Z");
    const parsed = parseDeviceCheckReport(JSON.stringify(original));
    expect(parsed).toEqual(original);
  });

  it("migrates a 2.0 report and marks its technical snapshot as imported", () => {
    const legacy = JSON.parse(JSON.stringify(createDeviceCheckReport(formValues({}), technical))) as Record<string, unknown>;
    legacy.schemaVersion = "2.0";
    delete legacy.technicalSource;
    const parsed = parseDeviceCheckReport(JSON.stringify(legacy));
    expect(parsed.schemaVersion).toBe("2.4");
    expect(parsed.technicalSource).toMatchObject({ mode: "report-import", sessionId: "session-1" });
    expect(parsed.technical.userAgent).toBe("test-agent");
  });

  it("keeps an older clap result separate when reading a 2.1 report", () => {
    const legacy = JSON.parse(JSON.stringify(createDeviceCheckReport(formValues({}), technical))) as Record<string, unknown>;
    legacy.schemaVersion = "2.1";
    const controlled = legacy.controlled as Record<string, unknown>;
    controlled.clapNearClap = controlled.bloom;
    delete controlled.bloom;

    const parsed = parseDeviceCheckReport(JSON.stringify(legacy));

    expect(parsed.controlled.bloom.success).toBeNull();
    expect(parsed.controlled.legacyClapNearClap).toBeDefined();
  });

  it("migrates the previous boolean checklist", () => {
    const migrated = parseDeviceCheckReport(JSON.stringify({
      schemaVersion: "1.0",
      reportType: "phase1-device-check",
      exportedAt: "2026-07-19T00:00:00.000Z",
      session: { sessionId: "old", testerId: "tester", device: "iPhone 15", osBrowser: "iOS / Safari", distanceCm: 80, environment: "明るい", notes: "" },
      checks: [{ id: "privacy", completed: true }],
      technical,
    }));
    expect(migrated.schemaVersion).toBe("2.4");
    expect(migrated.checks.find(({ id }) => id === "privacy")?.status).toBe("pass");
  });
});

function formValues(checkStatuses: Readonly<Record<string, "pending" | "pass" | "issue" | "na">>): DeviceCheckFormValues {
  const gesture = (): ControlledGestureResult => ({
    success: null,
    playerMiss: null,
    machineMiss: null,
    falseTrigger: null,
    trackingLoss: null,
    unclassified: null,
    offsetSummary: "",
  });
  return {
    sessionId: "session-1",
    testerId: "tester-a",
    participantType: "creator",
    device: "iPhone 15",
    osName: "iOS",
    osVersion: "20.0",
    browserName: "Safari",
    browserVersion: "20.0",
    appVersion: "test",
    distanceCm: 80,
    orientation: "landscape",
    lighting: "明るい室内",
    background: "白い壁",
    sleeves: "黒い長袖",
    speakerVolume: "8/16",
    checkStatuses,
    controlled: { airTap: gesture(), ribbonSwipe: gesture(), bloom: gesture() },
    subjective: {
      syncRating: null,
      latencySense: "unsure",
      unclearMoments: "",
      ignoredMoments: "",
      memorableAction: "",
      retryIntent: "unsure",
      shoulderFatigue: null,
      wristFatigue: null,
      eyeFatigue: null,
      headFatigue: null,
      painOrDiscomfort: "",
    },
    decision: { p1: "pending", nextChange: "", reason: "", nextFixedConditions: "" },
    notes: "",
  };
}
