export type Handedness = "left" | "right" | "unknown";
export type TrackingTimestampSource = "capture-time" | "presentation-time" | "callback-time";

export interface TrackingTimestamp {
  readonly captureTimeMs: number;
  readonly source: TrackingTimestampSource;
  readonly callbackTimeMs: number;
}

export interface TrackingInput {
  readonly frameId: number;
  readonly image: VideoFrame | ImageBitmap;
  readonly timestamp: TrackingTimestamp;
}

export interface Landmark2D {
  readonly x: number;
  readonly y: number;
  readonly zRelative: number;
}

export interface DetectedHand {
  /** Frame-local index. This is deliberately not a stable track id. */
  readonly detectionIndex: number;
  readonly handedness: Handedness;
  readonly handednessScore: number;
  /**
   * Image landmarks only. MediaPipe's world landmarks are left in the Worker: no judgment and no
   * saved replay uses them, and sending them doubled the landmark data of every result.
   */
  readonly landmarks2D: readonly Landmark2D[];
}

export interface HandTrackingFrame {
  readonly frameId: number;
  readonly captureTimeMs: number;
  readonly callbackTimeMs: number;
  readonly workerReceivedTimeMs: number;
  readonly inferenceStartedTimeMs: number;
  readonly inferenceCompletedTimeMs: number;
  readonly hands: readonly DetectedHand[];
}

export type TrackingDelegate = "GPU" | "CPU";

export interface TrackingProviderInfo {
  readonly delegate: TrackingDelegate;
  readonly fallbackReason: string | null;
  readonly packageId: string;
  readonly modelId: string;
}
