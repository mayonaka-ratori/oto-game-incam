import type { Landmark2D } from "../tracking/tracking-types";

export interface VideoCoverTransform {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly videoWidth: number;
  readonly videoHeight: number;
  readonly viewportWidth: number;
  readonly mirror: boolean;
}

export function createVideoCoverTransform(
  videoWidth: number,
  videoHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  mirror: boolean,
): VideoCoverTransform | null {
  if ([videoWidth, videoHeight, viewportWidth, viewportHeight].some((value) => value <= 0)) return null;
  const scale = Math.max(viewportWidth / videoWidth, viewportHeight / videoHeight);
  return {
    scale,
    offsetX: (viewportWidth - videoWidth * scale) / 2,
    offsetY: (viewportHeight - videoHeight * scale) / 2,
    videoWidth,
    videoHeight,
    viewportWidth,
    mirror,
  };
}

export function mapVideoLandmark(
  transform: VideoCoverTransform,
  landmark: Pick<Landmark2D, "x" | "y">,
): { readonly x: number; readonly y: number } {
  const sourceX = landmark.x * transform.videoWidth * transform.scale + transform.offsetX;
  return {
    x: transform.mirror ? transform.viewportWidth - sourceX : sourceX,
    y: landmark.y * transform.videoHeight * transform.scale + transform.offsetY,
  };
}

export function mapPreviewLandmark(
  transform: VideoCoverTransform,
  landmark: Pick<Landmark2D, "x" | "y">,
): { readonly x: number; readonly y: number } {
  return mapVideoLandmark(transform, {
    x: transform.mirror ? 1 - landmark.x : landmark.x,
    y: landmark.y,
  });
}
