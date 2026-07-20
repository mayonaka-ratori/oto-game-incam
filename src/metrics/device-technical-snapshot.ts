export interface DeviceTechnicalSnapshot {
  readonly pageUrl: string;
  readonly userAgent: string;
  readonly viewport: string;
  readonly devicePixelRatio: number;
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
}
