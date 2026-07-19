import { describe, expect, it } from "vitest";
import { calculatePalmCursor } from "../src/rendering/palm-cursor";

describe("calculatePalmCursor", () => {
  it("averages wrist and the four MCP landmarks", () => {
    const landmarks = Array.from({ length: 21 }, () => ({ x: 0, y: 0, zRelative: 0 }));
    for (const [value, index] of [0, 5, 9, 13, 17].entries()) {
      landmarks[index] = { x: value, y: value * 2, zRelative: -value };
    }
    expect(calculatePalmCursor(landmarks)).toEqual({ x: 2, y: 4, zRelative: -2 });
  });

  it("does not invent a center for incomplete landmarks", () => {
    expect(calculatePalmCursor([])).toBeNull();
  });
});
