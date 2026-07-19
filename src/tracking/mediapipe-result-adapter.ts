import type { Category, HandLandmarkerResult } from "@mediapipe/tasks-vision";
import type { DetectedHand, Handedness } from "./tracking-types";

export function adaptMediaPipeResult(result: HandLandmarkerResult): readonly DetectedHand[] {
  return result.landmarks.slice(0, 2).map((landmarks, detectionIndex) => {
    const category = result.handedness[detectionIndex]?.[0];
    return {
      detectionIndex,
      handedness: normalizeHandedness(category),
      handednessScore: finiteOrZero(category?.score),
      landmarks2D: landmarks.map((landmark) => ({
        x: landmark.x,
        y: landmark.y,
        zRelative: landmark.z,
      })),
      landmarksWorld: (result.worldLandmarks[detectionIndex] ?? []).map((landmark) => ({
        x: landmark.x,
        y: landmark.y,
        z: landmark.z,
      })),
    };
  });
}

function normalizeHandedness(category: Category | undefined): Handedness {
  const label = category?.categoryName.trim().toLowerCase();
  if (label === "left" || label === "right") return label;
  return "unknown";
}

function finiteOrZero(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? value : 0;
}
