import { describe, expect, it } from "vitest";
import type { HandLandmarkerResult } from "@mediapipe/tasks-vision";
import { adaptMediaPipeResult } from "../src/tracking/mediapipe-result-adapter";

function point(value: number) {
  return { x: value, y: value + 0.1, z: value + 0.2, visibility: 0.9 };
}

describe("adaptMediaPipeResult", () => {
  it("normalizes two hands without inventing a tracking confidence or stable id", () => {
    const fixture = {
      landmarks: [Array.from({ length: 21 }, (_, index) => point(index / 100)), Array.from({ length: 21 }, (_, index) => point(index / 50))],
      worldLandmarks: [Array.from({ length: 21 }, (_, index) => point(index)), Array.from({ length: 21 }, (_, index) => point(-index))],
      handedness: [
        [{ categoryName: "Left", score: 0.93, index: 0, displayName: "Left" }],
        [{ categoryName: "RIGHT", score: 0.81, index: 1, displayName: "Right" }],
      ],
      handednesses: [],
    } as unknown as HandLandmarkerResult;

    const hands = adaptMediaPipeResult(fixture);
    expect(hands).toHaveLength(2);
    expect(hands[0]).toMatchObject({ detectionIndex: 0, handedness: "left", handednessScore: 0.93 });
    expect(hands[0]?.landmarks2D).toHaveLength(21);
    expect(hands[1]?.landmarksWorld).toHaveLength(21);
    expect(hands[0]).not.toHaveProperty("trackingConfidence");
    expect(hands[0]).not.toHaveProperty("trackId");
  });

  it("keeps missing classifications explicitly unknown", () => {
    const fixture = {
      landmarks: [[point(0)]], worldLandmarks: [[]], handedness: [[]], handednesses: [],
    } as unknown as HandLandmarkerResult;
    expect(adaptMediaPipeResult(fixture)[0]).toMatchObject({ handedness: "unknown", handednessScore: 0 });
  });
});
