import type { TrackedHandFrame } from "../tracking/derived-tracking-types";

export type GestureType =
  | "air-tap"
  | "ribbon-swipe"
  | "bloom"
  | "lift"
  | "spotlight"
  | "clap"
  | "burst";

export type GestureReasonCode =
  | "target-crossed"
  | "center-crossed"
  | "bloom-opened"
  | "lift-raised"
  | "spotlight-held"
  | "near-clap-distance"
  | "contact-like-distance"
  | "occlusion-predicted"
  | "two-hand-release"
  | "cooldown-active"
  | "movement-too-slow"
  | "wrong-direction"
  | "off-axis"
  | "candidate-timeout"
  | "bloom-not-outward"
  | "bloom-not-upward"
  | "bloom-outward-distance-insufficient"
  | "bloom-upward-distance-insufficient"
  | "bloom-sync-expired"
  | "lift-not-ready"
  | "lift-not-upward"
  | "lift-distance-insufficient"
  | "lift-sync-expired"
  | "spotlight-wrong-zone"
  | "spotlight-pose-not-held"
  | "spotlight-wrong-side"
  | "spotlight-pose-before-go"
  | "spotlight-hands-not-separated"
  | "tracking-lost"
  | "manual-observation";

/** Player-facing hand placement. The preview is mirrored, so the player's left hand is on the screen's left. */
export type SpotlightVariant = "left-up-right-down" | "right-up-left-down";

export interface GestureQuality {
  readonly speed?: number;
  readonly pathDistance?: number;
  readonly perpendicularError?: number;
  readonly minimumHandDistance?: number;
  readonly outwardDistance?: number;
  readonly upwardDistance?: number;
  readonly syncSpreadMs?: number;
  readonly preparationSpan?: number;
  readonly holdDurationMs?: number;
  readonly spotlightVariant?: SpotlightVariant;
  readonly direction?: RibbonSwipeDirection;
  readonly clapKind?: "contact-like" | "near-clap" | "occlusion-predicted";
}

export interface GestureEvent {
  readonly id: string;
  readonly gestureType: GestureType;
  readonly eventTimeMs: number;
  readonly handIds: readonly string[];
  readonly confidence: number;
  readonly quality: GestureQuality;
  readonly trackingQuality: "observed" | "short-occlusion-predicted";
  readonly reasonCodes: readonly GestureReasonCode[];
}

export interface GestureRejection {
  readonly gestureType: GestureType;
  readonly timeMs: number;
  readonly handIds: readonly string[];
  readonly reasonCodes: readonly GestureReasonCode[];
}

export interface GestureEvaluation {
  readonly frame: TrackedHandFrame;
  readonly events: readonly GestureEvent[];
  readonly rejections: readonly GestureRejection[];
}

/** Result of checking whether the hands have settled in a gesture's start position. */
export interface GestureReadinessObservation {
  readonly visibleHands: number;
  readonly inZone: boolean;
  readonly stableMs: number;
  readonly ready: boolean;
  readonly readyAtMs: number | null;
  readonly handIds: readonly string[];
  /**
   * Where the hands settled, in the same order as handIds. The judgment measures the gesture
   * from these positions, so the on-camera guide can draw its path from them. Empty while no
   * hands are in the start position.
   */
  readonly settledPositions: readonly { readonly x: number; readonly y: number }[];
}

/**
 * How long the judgment lets a hand stay unseen on this frame: the larger of the state machine's
 * own configured value and the tracker's measured tolerance. A frame without a measured value
 * (a synthetic fixture, or a replay rebuilt outside the tracker) keeps the configured value, and
 * a test that sets the config explicitly always gets at least what it asked for.
 */
export function resolveTrackingGapToleranceMs(frame: TrackedHandFrame, configuredMs: number): number {
  const measured = frame.trackingGapToleranceMs;
  return measured === undefined ? configuredMs : Math.max(configuredMs, measured);
}

export interface TrackingGapDiagnostic {
  readonly startedAtMs: number;
  readonly reacquiredAtMs: number | null;
  readonly durationMs: number | null;
  readonly handIds: readonly string[];
}

export type RibbonSwipeDirection =
  | "left-to-right"
  | "right-to-left"
  | "lower-left-to-upper-right"
  | "lower-right-to-upper-left";

let nextGestureEventId = 1;

export function createGestureEventId(type: GestureType): string {
  return `${type}-${nextGestureEventId++}`;
}
