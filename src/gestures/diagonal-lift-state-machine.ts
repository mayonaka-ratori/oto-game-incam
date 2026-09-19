import type { DiagonalLiftVariant } from "./gesture-types";
import { LIFT_DEFAULTS } from "./lift-state-machine";
import {
  ParallelLiftStateMachine,
  type ParallelLiftConfig,
  type ParallelLiftDiagnosticHand,
  type ParallelLiftReasonCodes,
  type ParallelLiftTrialDiagnostic,
} from "./parallel-lift-state-machine";

/**
 * ななめリフト (diagonal-lift): both hands start apart in the lower left and right of the
 * portrait frame and travel in parallel towards the top right or the top left.
 *
 * It shares {@link ParallelLiftStateMachine} with Lift; only the direction, the tolerances
 * below and the reason codes differ. Lift's own judgment is untouched.
 *
 * Every number in this file is an initial value chosen before any real measurement
 * (2026-09-20). A measured session may change them, and the change belongs in docs.
 */
export type DiagonalLiftDiagnosticHand = ParallelLiftDiagnosticHand;
export type DiagonalLiftTrialDiagnostic = ParallelLiftTrialDiagnostic;

export interface DiagonalLiftConfig extends ParallelLiftConfig {
  readonly variant: DiagonalLiftVariant;
}

/**
 * Unit vectors of the two diagonals, in mirrored preview coordinates (y grows downward).
 * They lean towards straight up, because a portrait camera image is narrow: a 45° diagonal
 * would run a hand off the side of the frame before it travelled far enough.
 *
 * Initial values, not measured.
 */
export const DIAGONAL_LIFT_DIRECTIONS = {
  "up-right": [0.6, -0.8],
  "up-left": [-0.6, -0.8],
} as const satisfies Record<DiagonalLiftVariant, readonly [number, number]>;

/**
 * Horizontal travel both hands must also make, so a straight-up Lift is never read as a
 * diagonal one. Initial value, not measured.
 */
export const DIAGONAL_LIFT_MINIMUM_HORIZONTAL_DISTANCE = 0.06;

/**
 * Judgment constants. Exported read-only so the on-camera guide can place the start circles
 * and the end rings from the same distances. Changing a value changes the judgment.
 *
 * Same as Lift: the start zones, the hand separation, the readiness wait (180ms) and its drift,
 * the stationary tolerance and settle time, the sync window (420ms), the movement limit
 * (1400ms), the tracking gap floor (150ms) and the cooldown.
 *
 * Different from Lift: the travel is measured along the diagonal, the perpendicular drift is
 * capped at 0.12 on its own (Lift allows more as long as the raise is larger), and moving back
 * against the direction is refused after 0.025 (Lift 0.03).
 */
export const DIAGONAL_LIFT_DEFAULTS: Required<ParallelLiftConfig> = {
  ...LIFT_DEFAULTS,
  /** Travel along the diagonal, the same 0.18 the straight-up Lift asks for. */
  minimumUpwardDistance: 0.18,
  /** Drift perpendicular to the diagonal. */
  maximumSidewaysDistance: 0.12,
  /** Travel back against the diagonal. */
  downwardTolerance: 0.025,
};

const DIAGONAL_LIFT_REASON_CODES: ParallelLiftReasonCodes = {
  reached: "diagonal-lift-raised",
  notReady: "diagonal-lift-not-ready",
  wrongDirection: "diagonal-lift-wrong-direction",
  distanceInsufficient: "diagonal-lift-distance-insufficient",
  syncExpired: "diagonal-lift-sync-expired",
};

export class DiagonalLiftStateMachine extends ParallelLiftStateMachine {
  constructor(config: DiagonalLiftConfig) {
    const { variant, ...rest } = config;
    super(
      rest,
      {
        gestureType: "diagonal-lift",
        direction: DIAGONAL_LIFT_DIRECTIONS[variant],
        reasonCodes: DIAGONAL_LIFT_REASON_CODES,
        // Straying off the diagonal is refused on its own, however far the hands travelled.
        lateralRule: "absolute",
        minimumHorizontalDistance: DIAGONAL_LIFT_MINIMUM_HORIZONTAL_DISTANCE,
        quality: { diagonalLiftVariant: variant },
      },
      DIAGONAL_LIFT_DEFAULTS,
    );
  }
}
