import type { MediaPipeProviderConfig } from "../tracking/mediapipe-hand-tracking-provider";
import type { HandTrackingFrame, TrackingProviderInfo, TrackingTimestamp } from "../tracking/tracking-types";

export type TrackingFrameImage = VideoFrame | ImageBitmap;

export type MainToTrackingWorkerMessage =
  | {
      readonly type: "INIT";
      readonly config: MediaPipeProviderConfig;
      readonly mainTimeOriginMs: number;
    }
  | {
      readonly type: "FRAME";
      readonly frameId: number;
      readonly image: TrackingFrameImage;
      readonly timestamp: TrackingTimestamp;
    }
  | { readonly type: "DISPOSE" };

export type TrackingFrameErrorCode = "not-ready" | "inference-failed" | "invalid-frame";

export type TrackingWorkerToMainMessage =
  | {
      readonly type: "READY";
      readonly provider: TrackingProviderInfo;
      readonly initializationTimeMs: number;
    }
  | { readonly type: "RESULT"; readonly result: HandTrackingFrame }
  | {
      readonly type: "FRAME_ERROR";
      readonly frameId: number;
      readonly code: TrackingFrameErrorCode;
      readonly recoverable: boolean;
      readonly detail: string;
    }
  | { readonly type: "FATAL_ERROR"; readonly code: "initialization-failed"; readonly detail: string }
  | { readonly type: "DISPOSED" };

export function assertNever(value: never): never {
  throw new Error(`Unexpected worker message: ${String(value)}`);
}
