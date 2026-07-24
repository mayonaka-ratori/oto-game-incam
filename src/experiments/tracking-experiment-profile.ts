import type { MediaPipeProviderConfig } from "../tracking/mediapipe-hand-tracking-provider";
import type { TrackingDelegate } from "../tracking/tracking-types";

export type TrackingExperimentProfileId =
  | "baseline-gpu-640x480-60"
  | "gpu-640x480-30"
  | "gpu-960x540-30"
  | "gpu-1280x720-30"
  | "cpu-640x480-30";

export interface TrackingExperimentProfile {
  readonly id: TrackingExperimentProfileId;
  readonly label: string;
  readonly purpose: string;
  readonly camera: {
    readonly width: number;
    readonly height: number;
    readonly frameRateIdeal: number;
    readonly frameRateMin: number;
  };
  readonly tracking: {
    readonly preferredDelegate: TrackingDelegate;
    readonly numHands: 2;
    readonly minHandDetectionConfidence: number;
    readonly minHandPresenceConfidence: number;
    readonly minTrackingConfidence: number;
    readonly packageId: string;
    readonly modelId: string;
    readonly modelPath: string;
  };
}

const DEFAULT_TRACKING = {
  preferredDelegate: "GPU",
  numHands: 2,
  minHandDetectionConfidence: 0.5,
  minHandPresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
  packageId: "@mediapipe/tasks-vision@0.10.35",
  modelId: "hand_landmarker/full/float16/1#fbc2a30080c3",
  modelPath: "/mediapipe/models/hand_landmarker.task",
} as const;

export const TRACKING_EXPERIMENT_PROFILES: readonly TrackingExperimentProfile[] = [
  {
    id: "baseline-gpu-640x480-60",
    label: "基準条件 · GPU · 640×480 · 最大60fps",
    purpose: "現行条件。最初のP1セッションはこの条件を使います。",
    camera: { width: 640, height: 480, frameRateIdeal: 60, frameRateMin: 30 },
    tracking: DEFAULT_TRACKING,
  },
  {
    id: "gpu-640x480-30",
    label: "比較条件 · GPU · 640×480 · 30fps",
    purpose: "カメラ供給を30fpsへ固定した負荷比較候補です。品質は未検証です。",
    camera: { width: 640, height: 480, frameRateIdeal: 30, frameRateMin: 30 },
    tracking: DEFAULT_TRACKING,
  },
  {
    id: "gpu-960x540-30",
    label: "比較条件 · GPU · 960×540 · 30fps",
    purpose: "16:9取得解像度の比較候補です。品質は未検証です。",
    camera: { width: 960, height: 540, frameRateIdeal: 30, frameRateMin: 30 },
    tracking: DEFAULT_TRACKING,
  },
  {
    id: "gpu-1280x720-30",
    label: "比較条件 · GPU · 1280×720 · 30fps",
    purpose: "高い取得解像度の比較候補です。品質と負荷は未検証です。",
    camera: { width: 1280, height: 720, frameRateIdeal: 30, frameRateMin: 30 },
    tracking: DEFAULT_TRACKING,
  },
  {
    id: "cpu-640x480-30",
    label: "原因切り分け用 · CPU · 640×480 · 30fps",
    purpose: "GPU fallbackとの原因切り分け用です。通常経路としては未検証です。",
    camera: { width: 640, height: 480, frameRateIdeal: 30, frameRateMin: 30 },
    tracking: { ...DEFAULT_TRACKING, preferredDelegate: "CPU" },
  },
] as const;

export const DEFAULT_TRACKING_EXPERIMENT_PROFILE = TRACKING_EXPERIMENT_PROFILES[0]!;

export function findTrackingExperimentProfile(
  id: string | null | undefined,
): TrackingExperimentProfile {
  return TRACKING_EXPERIMENT_PROFILES.find((profile) => profile.id === id)
    ?? DEFAULT_TRACKING_EXPERIMENT_PROFILE;
}

export function createCameraConstraints(
  profile: TrackingExperimentProfile,
  fallback = false,
): MediaStreamConstraints {
  const frameRate = fallback
    ? { ideal: Math.min(profile.camera.frameRateIdeal, 30) }
    : { ideal: profile.camera.frameRateIdeal, min: profile.camera.frameRateMin };
  return {
    audio: false,
    video: {
      facingMode: { ideal: "user" },
      width: { ideal: profile.camera.width },
      height: { ideal: profile.camera.height },
      frameRate,
    },
  };
}

export function createMediaPipeProviderConfig(
  profile: TrackingExperimentProfile,
  baseUrl: string,
): MediaPipeProviderConfig {
  return {
    wasmRootUrl: new URL("/mediapipe/wasm", baseUrl).href,
    modelUrl: new URL(profile.tracking.modelPath, baseUrl).href,
    preferredDelegate: profile.tracking.preferredDelegate,
    numHands: profile.tracking.numHands,
    minHandDetectionConfidence: profile.tracking.minHandDetectionConfidence,
    minHandPresenceConfidence: profile.tracking.minHandPresenceConfidence,
    minTrackingConfidence: profile.tracking.minTrackingConfidence,
    packageId: profile.tracking.packageId,
    modelId: profile.tracking.modelId,
  };
}

export function requestedCameraLabel(profile: TrackingExperimentProfile): string {
  const camera = profile.camera;
  return `${camera.width}×${camera.height} @ ${camera.frameRateMin}–${camera.frameRateIdeal}fps`;
}
