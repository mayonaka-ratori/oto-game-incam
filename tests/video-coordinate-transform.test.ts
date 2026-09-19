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

  // The preview frame follows the camera image (--video-aspect), so cover crops nothing and
  // a guide drawn at the edge of the frame stays on screen in portrait as well as landscape.
  for (const [videoWidth, videoHeight, viewportWidth, viewportHeight] of [
    [640, 480, 400, 300],
    [480, 640, 300, 400],
  ] as const) {
    it(`shows the whole ${videoWidth}×${videoHeight} image in a matching frame`, () => {
      const transform = createVideoCoverTransform(
        videoWidth,
        videoHeight,
        viewportWidth,
        viewportHeight,
        true,
      )!;
      expect(transform.offsetX).toBeCloseTo(0, 6);
      expect(transform.offsetY).toBeCloseTo(0, 6);
      const topLeft = mapPreviewLandmark(transform, { x: 0, y: 0 });
      const bottomRight = mapPreviewLandmark(transform, { x: 1, y: 1 });
      expect(topLeft.x).toBeCloseTo(0, 6);
      expect(topLeft.y).toBeCloseTo(0, 6);
      expect(bottomRight.x).toBeCloseTo(viewportWidth, 6);
      expect(bottomRight.y).toBeCloseTo(viewportHeight, 6);
    });
  }
});
