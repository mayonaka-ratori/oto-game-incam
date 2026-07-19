import type { HandTrackingFrame, TrackingInput, TrackingProviderInfo } from "./tracking-types";

export interface HandTrackingProvider {
  readonly info: TrackingProviderInfo;
  detect(input: TrackingInput, workerReceivedTimeMs: number): HandTrackingFrame;
  close(): void;
}
