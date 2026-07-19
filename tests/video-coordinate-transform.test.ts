import { describe, expect, it } from "vitest";
import {
  createVideoCoverTransform,
  mapPreviewLandmark,
  mapVideoLandmark,
} from "../src/rendering/video-coordinate-transform";

describe("video cover coordinate transform", () => {
  it("accounts for horizontal cover cropping", () => {
    const transform = createVideoCoverTransform(640, 480, 400, 400, false);
    expect(transform).not.toBeNull();
    expect(mapVideoLandmark(transform!, { x: 0.5, y: 0.5 })).toEqual({ x: 200, y: 200 });
    expect(mapVideoLandmark(transform!, { x: 0, y: 0.5 }).x).toBeCloseTo(-66.67, 1);
  });

  it("mirrors once in viewport space", () => {
    const transform = createVideoCoverTransform(400, 400, 400, 400, true)!;
    expect(mapVideoLandmark(transform, { x: 0.2, y: 0.4 })).toEqual({ x: 320, y: 160 });
    expect(mapPreviewLandmark(transform, { x: 0.2, y: 0.4 })).toEqual({ x: 80, y: 160 });
  });

  it("rejects dimensions that are not ready", () => {
    expect(createVideoCoverTransform(0, 480, 400, 300, true)).toBeNull();
  });
});
