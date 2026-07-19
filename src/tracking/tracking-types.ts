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

export interface LandmarkWorld {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface DetectedHand {
  /** Frame-local index. This is deliberately not a stable track id. */
  readonly detectionIndex: number;
  readonly handedness: Handedness;
  readonly handednessScore: number;
  readonly landmarks2D: readonly Landmark2D[];
  readonly landmarksWorld: readonly LandmarkWorld[];
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
