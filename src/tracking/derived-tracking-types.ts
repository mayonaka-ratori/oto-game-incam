import type { Handedness } from "./tracking-types";

export interface Vector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export type HandIdentityReason =
  | "new-track"
  | "position-continuity"
  | "reacquired-within-grace"
  | "handedness-conflict"
  | "non-monotonic-time";

export interface TrackedHandFeatures {
  readonly trackId: string;
  readonly handedness: Handedness;
  readonly observedHandedness: Handedness;
  readonly handednessScore: number;
  readonly identityReason: HandIdentityReason;
  readonly palmCenter: Vector3;
  readonly palmVelocity: Vector3;
  readonly indexTip: Vector3;
  readonly indexTipVelocity: Vector3;
  readonly handScale: number;
  readonly openness: number;
}

export interface TrackedHandFrame {
  readonly frameId: number;
  readonly captureTimeMs: number;
  readonly hands: readonly TrackedHandFeatures[];
  readonly identityConflictCount: number;
}
