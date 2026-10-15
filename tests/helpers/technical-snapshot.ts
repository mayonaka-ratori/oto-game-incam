import type { DeviceInfo } from "../../src/metrics/device-info";
import type { DeviceTechnicalSnapshot } from "../../src/metrics/device-technical-snapshot";
import type { Phase1TechnicalSummary } from "../../src/poc/phase1-session";

/** The recent-window values a saved P1 document carries. Healthy enough for a criterion candidate. */
export const TECHNICAL_SUMMARY: Phase1TechnicalSummary = {
  inferenceP50Ms: 20,
  inferenceP95Ms: 40,
  trackingHz: 25,
  frameAgeP95Ms: 100,
  oneHandCoverage: 1,
  twoHandCoverage: 0.95,
  idConflictCount: 0,
};

/** What an Android Chrome reports about the phone. Chrome hides the model unless asked, so it is null. */
export function deviceInfo(overrides: Partial<DeviceInfo> = {}): DeviceInfo {
  return {
    source: "userAgentData",
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
    ...overrides,
  };
}

/**
 * One device snapshot for every test that saves or reads a P1 document. A test that depends on
 * a value (the user agent, the delegate, the pipeline) passes it explicitly as an override.
 */
export function technicalSnapshot(overrides: Partial<DeviceTechnicalSnapshot> = {}): DeviceTechnicalSnapshot {
  return {
    appBuildId: "build-test",
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
    ...overrides,
  };
}
