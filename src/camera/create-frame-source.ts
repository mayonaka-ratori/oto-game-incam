import type { FrameHandler, FrameSource, FrameSourceErrorHandler } from "./frame-source";
import { RvfcFrameSource } from "./rvfc-frame-source";
import { TimerFrameSource } from "./timer-frame-source";
import { TrackProcessorFrameSource } from "./track-processor-frame-source";

export function createBestFrameSource(
  track: MediaStreamTrack,
  video: HTMLVideoElement,
  onFrame: FrameHandler,
  onError: FrameSourceErrorHandler,
): FrameSource {
  if ("MediaStreamTrackProcessor" in globalThis && "VideoFrame" in globalThis) {
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
