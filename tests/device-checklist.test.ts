import { describe, expect, it } from "vitest";
import {
  createDeviceCheckReport,
  DEVICE_CHECK_ITEMS,
  type DeviceCheckTechnicalSnapshot,
} from "../src/testing/device-checklist";

const technical: DeviceCheckTechnicalSnapshot = {
  pageUrl: "https://example.test/",
  userAgent: "test-agent",
  viewport: "844 × 390",
  devicePixelRatio: 2,
  cameraFps: 30,
  trackingHz: 25,
  inferenceP95Ms: 22,
  frameAgeP95Ms: 80,
  frameSource: "requestVideoFrameCallback",
  delegate: "GPU",
  capturedFrames: 100,
  completedFrames: 90,
  replacedFrames: 9,
  trackingError: null,
};

describe("createDeviceCheckReport", () => {
  it("keeps unchecked items and explicitly excludes camera frames", () => {
    const completedIds = new Set([DEVICE_CHECK_ITEMS[0]?.id, DEVICE_CHECK_ITEMS[4]?.id].filter((id): id is string => id !== undefined));
    const report = createDeviceCheckReport({
      sessionId: "session-1",
      testerId: "tester-a",
      device: "iPhone 15",
      osBrowser: "iOS / Safari",
      distanceCm: 80,
      environment: "明るい室内",
      overall: "pending",
      notes: "",
      completedIds,
    }, technical, "2026-07-19T00:00:00.000Z");

    expect(report.progress).toEqual({ completed: 2, total: DEVICE_CHECK_ITEMS.length });
    expect(report.checks).toHaveLength(DEVICE_CHECK_ITEMS.length);
    expect(report.checks.some((item) => !item.completed)).toBe(true);
    expect(report.privacy).toEqual({ includesCameraFrames: false, includesAudio: false });
    expect(JSON.parse(JSON.stringify(report))).toMatchObject({ reportType: "phase1-device-check" });
  });
});
