import type { TrackingTimestamp } from "../tracking/tracking-types";
import type { TrackingFrameImage } from "../worker/tracking-worker-messages";

export type TrackingFrameSourceKind =
  | "MediaStreamTrackProcessor"
  | "requestVideoFrameCallback"
  | "timer-fallback";

export interface CapturedTrackingFrame {
  readonly image: TrackingFrameImage;
  readonly timestamp: TrackingTimestamp;
}

export interface FrameSource {
  readonly kind: TrackingFrameSourceKind;
  start(): void;
  stop(): void;
}

export type FrameHandler = (frame: CapturedTrackingFrame) => void;
export type FrameSourceErrorHandler = (detail: string) => void;

export function describeFrameSourceError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
