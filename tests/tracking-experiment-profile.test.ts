import { describe, expect, it } from "vitest";
import {
  createCameraConstraints,
  createMediaPipeProviderConfig,
  DEFAULT_TRACKING_EXPERIMENT_PROFILE,
  findTrackingExperimentProfile,
  TRACKING_EXPERIMENT_PROFILES,
} from "../src/experiments/tracking-experiment-profile";

describe("tracking experiment profiles", () => {
  it("falls back to the default for an unknown id, and uses unique ids and one pinned model", () => {
    expect(findTrackingExperimentProfile("unknown")).toBe(DEFAULT_TRACKING_EXPERIMENT_PROFILE);
    expect(new Set(TRACKING_EXPERIMENT_PROFILES.map(({ id }) => id)).size)
      .toBe(TRACKING_EXPERIMENT_PROFILES.length);
    expect(new Set(TRACKING_EXPERIMENT_PROFILES.map(({ tracking }) => tracking.packageId)))
      .toEqual(new Set(["@mediapipe/tasks-vision@0.10.35"]));
    expect(new Set(TRACKING_EXPERIMENT_PROFILES.map(({ tracking }) => tracking.modelId)).size)
      .toBe(1);
  });

  it("creates requested and constraint-error fallback camera settings", () => {
    const profile = findTrackingExperimentProfile("gpu-960x540-30");
    expect(createCameraConstraints(profile)).toEqual({
      audio: false,
      video: {
        facingMode: { ideal: "user" },
        width: { ideal: 960 },
        height: { ideal: 540 },
        frameRate: { ideal: 30, min: 30 },
      },
    });
    expect(createCameraConstraints(profile, true)).toEqual({
      audio: false,
      video: {
        facingMode: { ideal: "user" },
        width: { ideal: 960 },
        height: { ideal: 540 },
        frameRate: { ideal: 30 },
      },
    });
  });

  it("creates a worker config from the selected profile", () => {
    const profile = findTrackingExperimentProfile("cpu-640x480-30");
    expect(createMediaPipeProviderConfig(profile, "https://example.test/lab")).toMatchObject({
      preferredDelegate: "CPU",
      numHands: 2,
      modelUrl: "https://example.test/mediapipe/models/hand_landmarker.task",
      wasmRootUrl: "https://example.test/mediapipe/wasm",
    });
  });
});
