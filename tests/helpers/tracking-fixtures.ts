import type { DetectedHand, HandTrackingFrame, Handedness } from "../../src/tracking/tracking-types";

export function trackingFrame(
  frameId: number,
  captureTimeMs: number,
  hands: readonly DetectedHand[],
): HandTrackingFrame {
  return {
    frameId,
    captureTimeMs,
    callbackTimeMs: captureTimeMs + 2,
    workerReceivedTimeMs: captureTimeMs + 4,
    inferenceStartedTimeMs: captureTimeMs + 5,
    inferenceCompletedTimeMs: captureTimeMs + 10,
    hands,
  };
}

export function syntheticHand(
  detectionIndex: number,
  handedness: Handedness,
  centerX: number,
  centerY = 0.5,
  openness = 1,
): DetectedHand {
  const landmarks2D = Array.from({ length: 21 }, (_, index) => {
    const finger = Math.max(0, Math.ceil(index / 4));
    const joint = index === 0 ? 0 : ((index - 1) % 4) + 1;
    const spread = (finger - 2.5) * 0.02 * openness;
    return {
      x: centerX + spread,
      y: centerY + 0.12 - joint * 0.035 * openness,
      zRelative: -joint * 0.008 * openness,
    };
  });
  return {
    detectionIndex,
    handedness,
    handednessScore: 0.95,
    landmarks2D,
    landmarksWorld: landmarks2D.map(({ x, y, zRelative }) => ({ x, y, z: zRelative })),
  };
}
