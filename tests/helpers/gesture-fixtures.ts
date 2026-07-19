import type {
  TrackedHandFeatures,
  TrackedHandFrame,
  Vector3,
} from "../../src/tracking/derived-tracking-types";
import type { Handedness } from "../../src/tracking/tracking-types";

export function trackedFrame(timeMs: number, hands: readonly TrackedHandFeatures[]): TrackedHandFrame {
  return { frameId: Math.round(timeMs), captureTimeMs: timeMs, hands, identityConflictCount: 0 };
}

export function trackedHand(
  id: string,
  x: number,
  y: number,
  velocity: Partial<Vector3> = {},
  handedness: Handedness = "unknown",
): TrackedHandFeatures {
  const vector = { x: velocity.x ?? 0, y: velocity.y ?? 0, z: velocity.z ?? 0 };
  return {
    trackId: id,
    handedness,
    observedHandedness: handedness,
    handednessScore: 0.9,
    identityReason: "position-continuity",
    palmCenter: { x, y, z: 0 },
    palmVelocity: vector,
    indexTip: { x, y, z: 0 },
    indexTipVelocity: vector,
    handScale: 0.1,
    openness: 1,
  };
}
