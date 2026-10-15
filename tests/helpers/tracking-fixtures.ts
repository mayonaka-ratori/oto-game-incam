import { calculatePalmCursor } from "../../src/rendering/palm-cursor";
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
  };
}

/**
 * Places a synthetic hand so that the judged point (palm center or fingertip) lands on the given
 * mirrored-preview position. The engine mirrors x before judging, so the raw landmarks are built
 * from 1 - x.
 */
export function handAtPreviewPoint(
  detectionIndex: number,
  handedness: Handedness,
  target: { readonly x: number; readonly y: number },
  pointer: "palm" | "index-tip" = "palm",
): DetectedHand {
  const probe = syntheticHand(detectionIndex, handedness, 0.5, 0.5);
  const reference = pointer === "index-tip" ? probe.landmarks2D[8]! : calculatePalmCursor(probe.landmarks2D)!;
  return syntheticHand(
    detectionIndex,
    handedness,
    1 - target.x - (reference.x - 0.5),
    target.y - (reference.y - 0.5),
  );
}
