import type { TrackedHandFrame } from "../tracking/derived-tracking-types";

export type GestureType = "air-tap" | "ribbon-swipe" | "clap" | "burst";

export type GestureReasonCode =
  | "target-crossed"
  | "center-crossed"
  | "near-clap-distance"
  | "contact-like-distance"
  | "occlusion-predicted"
  | "two-hand-release"
  | "cooldown-active"
  | "movement-too-slow"
  | "wrong-direction"
  | "off-axis"
  | "candidate-timeout"
  | "tracking-lost"
  | "manual-observation";

export interface GestureQuality {
  readonly speed?: number;
  readonly pathDistance?: number;
  readonly perpendicularError?: number;
  readonly minimumHandDistance?: number;
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

export type RibbonSwipeDirection =
  | "left-to-right"
  | "right-to-left"
  | "lower-left-to-upper-right"
  | "lower-right-to-upper-left";

let nextGestureEventId = 1;

export function createGestureEventId(type: GestureType): string {
  return `${type}-${nextGestureEventId++}`;
}
