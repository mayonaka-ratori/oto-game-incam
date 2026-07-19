import { describe, expect, it } from "vitest";
import {
  createDeviceCheckReport,
  DEVICE_CHECK_ITEMS,
  parseDeviceCheckReport,
  type ControlledGestureResult,
  type DeviceCheckFormValues,
  type DeviceCheckTechnicalSnapshot,
} from "../src/testing/device-checklist";

const technical: DeviceCheckTechnicalSnapshot = {
  pageUrl: "https://example.test/",
  userAgent: "test-agent",
  viewport: "844 × 390",
  devicePixelRatio: 2,
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
};

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
    expect(JSON.parse(JSON.stringify(report))).toMatchObject({ schemaVersion: "2.0", reportType: "phase1-device-check" });
  });

  it("round-trips a version 2 report for resume", () => {
    const original = createDeviceCheckReport(formValues({ privacy: "pass" }), technical, "2026-07-19T00:00:00.000Z");
    const parsed = parseDeviceCheckReport(JSON.stringify(original));
    expect(parsed).toEqual(original);
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
    expect(migrated.schemaVersion).toBe("2.0");
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
    controlled: { airTap: gesture(), ribbonSwipe: gesture(), clapNearClap: gesture() },
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
