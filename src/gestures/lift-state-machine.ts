import {
  ParallelLiftStateMachine,
  type ParallelLiftConfig,
  type ParallelLiftDiagnosticHand,
  type ParallelLiftReasonCodes,
  type ParallelLiftSettings,
  type ParallelLiftTrialDiagnostic,
} from "./parallel-lift-state-machine";

/**
 * Lift: both hands start in the lower left/right zones and rise roughly in
 * parallel. Distances are normalized preview coordinates (y grows downward);
 * the absolute arm height or speed is not scored.
 *
 * The movement itself is judged by {@link ParallelLiftStateMachine}, which Lift shares with
 * ななめリフト (`diagonal-lift-state-machine.ts`). Lift is the case where the direction is
 * straight up, so every value and rule below is exactly what it was before that machine existed.
 */
export type LiftConfig = ParallelLiftConfig;
export type LiftDiagnosticHand = ParallelLiftDiagnosticHand;
export type LiftTrialDiagnostic = ParallelLiftTrialDiagnostic;

/**
 * Judgment constants. Exported read-only so the on-camera guide can place the start circles
 * and the end rings from the same zones and distances. Changing a value changes the judgment.
 */
export const LIFT_DEFAULTS: Required<LiftConfig> = {
  startZoneMinY: 0.58,
  startZoneMaxY: 0.97,
  leftZoneMinX: 0.03,
  leftZoneMaxX: 0.47,
  rightZoneMinX: 0.53,
  rightZoneMaxX: 0.97,
  minimumHandSeparation: 0.12,
  readinessStableMs: 180,
  readinessMaximumDrift: 0.05,
  stationaryTolerance: 0.02,
  settleMs: 250,
  minimumUpwardDistance: 0.18,
  maximumSidewaysDistance: 0.14,
  downwardTolerance: 0.03,
  maximumSyncWindowMs: 420,
  maximumDurationMs: 1_400,
  /** Floor of the tracking gap tolerance; a slow device raises it through the frame. */
  maximumTrackingGapMs: 150,
  cooldownMs: 280,
};

/** Straight up, in mirrored preview coordinates where y grows downward. */
export const LIFT_DIRECTION: readonly [number, number] = [0, -1];

const LIFT_REASON_CODES: ParallelLiftReasonCodes = {
  reached: "lift-raised",
  notReady: "lift-not-ready",
  wrongDirection: "lift-not-upward",
  distanceInsufficient: "lift-distance-insufficient",
  syncExpired: "lift-sync-expired",
};

const LIFT_SETTINGS: ParallelLiftSettings = {
  gestureType: "lift",
  direction: LIFT_DIRECTION,
  reasonCodes: LIFT_REASON_CODES,
  // A high raise with some sway still counts, as it always has.
  lateralRule: "relative",
  minimumHorizontalDistance: 0,
  quality: {},
};

export class LiftStateMachine extends ParallelLiftStateMachine {
  constructor(config: LiftConfig = {}) {
    super(config, LIFT_SETTINGS, LIFT_DEFAULTS);
  }
}
