import type { FrameHandler, FrameSource, FrameSourceErrorHandler } from "./frame-source";
import { RvfcFrameSource } from "./rvfc-frame-source";
import { TimerFrameSource } from "./timer-frame-source";
import { TrackProcessorFrameSource } from "./track-processor-frame-source";

/**
 * Which capture path to use. `auto` picks the best supported one, the others force a path so that
 * one device can be measured twice with a single change between the runs (docs/18 の5.4).
 * A forced path still falls back when the browser does not support it.
 */
export type FrameSourceOverride = "auto" | "rvfc" | "timer";

export function createBestFrameSource(
  track: MediaStreamTrack,
  video: HTMLVideoElement,
  onFrame: FrameHandler,
  onError: FrameSourceErrorHandler,
  override: FrameSourceOverride = "auto",
): FrameSource {
  if (override === "timer") {
    return new TimerFrameSource(video, onFrame, onError);
  }
  if (override === "auto" && "MediaStreamTrackProcessor" in globalThis && "VideoFrame" in globalThis) {
    try {
      return new TrackProcessorFrameSource(track, onFrame, onError);
    } catch {
      // Continue through feature-detected fallbacks.
    }
  }
  if (typeof video.requestVideoFrameCallback === "function" && typeof createImageBitmap === "function") {
    return new RvfcFrameSource(video, onFrame, onError);
  }
  return new TimerFrameSource(video, onFrame, onError);
}
