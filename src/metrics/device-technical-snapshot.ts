import type { PendingFramePolicy } from "../camera/latest-frame-scheduler";
import type { FrameSourceOverride } from "../camera/create-frame-source";
import type { DeviceInfo } from "./device-info";

export interface DeviceTechnicalSnapshot {
  readonly appBuildId: string;
  readonly experimentProfileId: string;
  readonly requestedCameraWidth: number;
  readonly requestedCameraHeight: number;
  readonly requestedFrameRateIdeal: number;
  readonly requestedFrameRateMin: number;
  readonly requestedDelegate: string;
  readonly requestedModelId: string;
  readonly pageUrl: string;
  readonly userAgent: string;
  readonly viewport: string;
  readonly devicePixelRatio: number;
  readonly actualCameraWidth: number | null;
  readonly actualCameraHeight: number | null;
  readonly actualCameraFrameRate: number | null;
  readonly actualFacingMode: string | null;
  readonly cameraFps: number | null;
  readonly trackingHz: number | null;
  readonly inferenceP50Ms: number | null;
  readonly inferenceP95Ms: number | null;
  readonly frameAgeP95Ms: number | null;
  readonly oneHandCoverage: number | null;
  readonly twoHandCoverage: number | null;
  readonly frameSource: string | null;
  readonly delegate: string | null;
  readonly packageId: string | null;
  readonly modelId: string | null;
  readonly capturedFrames: number | null;
  readonly completedFrames: number | null;
  readonly replacedFrames: number | null;
  readonly erroredFrames: number | null;
  readonly inFlightFrames: number | null;
  readonly pendingFrames: number | null;
  readonly trackingError: string | null;
  /**
   * v7: what the browser says about the phone, collected automatically so the tester types
   * nothing. Null while the collection is still running, and every field inside it can be null.
   */
  readonly device: DeviceInfo | null;
  /** v7: `?frameSource=`. "auto" means the best supported capture path was chosen. */
  readonly frameSourceOverride: FrameSourceOverride;
  /** v7: `?pending=`. "hold" is the long-standing behaviour. */
  readonly pendingPolicy: PendingFramePolicy;
  /** v7: frames closed on arrival under the `drop` policy. 0 under `hold`. */
  readonly droppedFrames: number | null;
}
