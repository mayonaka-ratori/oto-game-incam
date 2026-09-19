import { AIR_TAP_DEFAULTS } from "../gestures/air-tap-state-machine";
import { BLOOM_DEFAULTS } from "../gestures/bloom-state-machine";
import {
  DIAGONAL_LIFT_DEFAULTS,
  DIAGONAL_LIFT_DIRECTIONS,
} from "../gestures/diagonal-lift-state-machine";
import type { DiagonalLiftVariant } from "../gestures/gesture-types";
import { LIFT_DEFAULTS } from "../gestures/lift-state-machine";
import {
  RIBBON_SWIPE_CENTER,
  RIBBON_SWIPE_DEFAULTS,
  ribbonSwipeDirectionVector,
} from "../gestures/ribbon-swipe-state-machine";
import { SPOTLIGHT_DEFAULTS } from "../gestures/spotlight-state-machine";
import type { P1Gesture, P1TrialDefinition } from "../poc/phase1-protocol";
import { createBloomGuideGeometry } from "./bloom-guide";

/**
 * Where the on-camera guide puts the hands, in the same normalized mirrored-preview
 * coordinates the judgment uses (`toMirroredPreviewFrame` in phase1-lab-engine.ts).
 * Every distance here is derived from a judgment constant, so a threshold change moves
 * the guide with it. Nothing in this file decides whether a trial succeeds.
 */

export interface GuidePoint {
  readonly x: number;
  readonly y: number;
}

export interface GuidePath {
  readonly start: GuidePoint;
  readonly end: GuidePoint;
}

export interface GuideZone {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface GuideRing {
  readonly center: GuidePoint;
  /** Radius along x, in normalized units. The judgment ring is a circle in this space. */
  readonly radius: number;
}

export interface GestureGuide {
  readonly gesture: P1Gesture;
  /** Which tracked point the tester has to move: the palm center, or the index fingertip. */
  readonly pointer: "palm" | "index-tip";
  /** One entry per hand: the start circle, the line to follow, and the end ring. */
  readonly paths: readonly GuidePath[];
  /** Rectangles the hands have to reach (Spotlight). */
  readonly zones: readonly GuideZone[];
  /** Rings drawn at the judgment radius (air-tap). */
  readonly rings: readonly GuideRing[];
  /** How long the travelling dot takes from the start circle to the end ring. */
  readonly travelMs: number;
  /** How long the pose has to be held after it is reached, or null when nothing is held. */
  readonly holdMs: number | null;
  /** Radius of the start circle, in normalized units. */
  readonly startRadius: number;
  /** Radius of the end ring, in normalized units. */
  readonly endRadius: number;
}

/**
 * How far past the judgment threshold the end ring sits. Aiming exactly at the threshold
 * would fail on every small undershoot, so the guide asks for a little more.
 */
export const GUIDE_TARGET_MARGIN = 0.06;
/** How far outside the air-tap ring the hand starts, so the crossing has room to build up speed. */
export const AIR_TAP_APPROACH_MARGIN = 0.09;
/** The guide never leaves the camera image; a circle drawn at the very edge cannot be reached. */
export const GUIDE_FRAME_MINIMUM = 0.04;
export const GUIDE_FRAME_MAXIMUM = 0.96;
/**
 * Testers reported the marks as too small to aim at (docs/19 の2と4.4). The circles are drawn
 * 1.6 times larger, and the "the hand is on the mark" colour change follows the drawn size.
 * The judgment never reads these radii.
 */
export const GUIDE_CIRCLE_SCALE = 1.6;
const START_RADIUS = 0.045 * GUIDE_CIRCLE_SCALE;
const END_RADIUS = 0.055 * GUIDE_CIRCLE_SCALE;

/**
 * Time from GO to the end ring. Every value is at most half of the movement limit of its
 * gesture, so a tester who follows the dot still has the same time again in reserve.
 */
export const GUIDE_TRAVEL_MS = {
  "air-tap": 400,
  "ribbon-swipe": 400,
  bloom: 600,
  lift: 600,
  "diagonal-lift": 600,
  spotlight: 400,
  clap: 400,
} as const satisfies Record<P1Gesture, number>;

/**
 * Where ななめリフト asks the hands to wait, on the same line as the Lift circles. The pair is
 * shifted against the travel, so the hand that ends up nearest the side of the frame still has
 * room: moving up and to the right starts further left, and the other way round. Both points
 * stay inside the unchanged Lift start zones.
 *
 * Initial values, not measured (2026-09-20).
 */
export const DIAGONAL_LIFT_GUIDE_START_X = {
  "up-right": { left: 0.22, right: 0.66 },
  "up-left": { left: 0.34, right: 0.78 },
} as const satisfies Record<DiagonalLiftVariant, { readonly left: number; readonly right: number }>;

/**
 * The air-tap ring centers the engine gives the state machine
 * (`createMachine` in phase1-lab-engine.ts). They are not a state machine constant,
 * so they are repeated here and checked against the engine in tests/gesture-guides.test.ts.
 */
export const AIR_TAP_TRIAL_CENTER = {
  left: { x: 0.3, y: 0.5 },
  right: { x: 0.7, y: 0.5 },
} as const satisfies Record<"left" | "right", GuidePoint>;

export function clampGuidePoint(point: GuidePoint): GuidePoint {
  return { x: clampToFrame(point.x), y: clampToFrame(point.y) };
}

/**
 * Redraws every path from where the hands actually settled, keeping each path's direction and
 * length. The judgment measures a two-hand gesture from the settled position, not from the
 * circle the guide drew, so after the start position is confirmed the two must agree
 * (docs/19 の4.3). Anchors are in the same order as the paths: screen-left hand first.
 * A mismatched count leaves the guide untouched.
 */
export function anchorGuidePaths(guide: GestureGuide, anchors: readonly GuidePoint[]): GestureGuide {
  if (anchors.length === 0 || anchors.length !== guide.paths.length) return guide;
  return {
    ...guide,
    paths: guide.paths.map((path, index) => {
      const anchor = anchors[index]!;
      return {
        start: clampGuidePoint(anchor),
        end: clampGuidePoint({
          x: anchor.x + (path.end.x - path.start.x),
          y: anchor.y + (path.end.y - path.start.y),
        }),
      };
    }),
  };
}

/** The guide for one trial, or null for a gesture without an on-camera guide. */
export function createGestureGuide(trial: P1TrialDefinition): GestureGuide | null {
  switch (trial.gesture) {
    case "air-tap":
      return airTapGuide(trial.airTapSide ?? "left");
    case "ribbon-swipe":
      return ribbonSwipeGuide(trial);
    case "bloom":
      return bloomGuide();
    case "lift":
      return liftGuide();
    case "diagonal-lift":
      return diagonalLiftGuide(trial.diagonalLiftVariant ?? "up-right");
    case "spotlight":
      return spotlightGuide(trial);
    case "clap":
      return null;
  }
}

/**
 * Position of the travelling dot as a share of the path, from the audio-clock GO time.
 * It depends on the time only, never on how many frames were drawn.
 */
export function guideDotProgress(nowMs: number, goTimeMs: number | null, travelMs: number): number {
  if (goTimeMs === null || travelMs <= 0) return 0;
  return clamp01((nowMs - goTimeMs) / travelMs);
}

export function guideDotPosition(path: GuidePath, progress: number): GuidePoint {
  const ratio = clamp01(progress);
  return {
    x: path.start.x + (path.end.x - path.start.x) * ratio,
    y: path.start.y + (path.end.y - path.start.y) * ratio,
  };
}

/** The one line shown over the camera image. Short enough to read while moving. */
export function guideInstruction(trial: P1TrialDefinition): string {
  switch (trial.gesture) {
    case "air-tap":
      return `${trial.airTapSide === "right" ? "右手" : "左手"}の指を 丸印からリングへ`;
    case "ribbon-swipe":
      return `片手で 帯を${swipeWording(trial)}へ`;
    case "bloom":
      return "丸印から輪まで 両手を開く";
    case "lift":
      return "丸印から輪まで 両手を上げる";
    case "diagonal-lift":
      return trial.diagonalLiftVariant === "up-left"
        ? "丸印から輪まで 両手を左上へ"
        : "丸印から輪まで 両手を右上へ";
    case "spotlight":
      return trial.spotlightVariant === "right-up-left-down"
        ? "右手を上・左手を下で 止める"
        : "左手を上・右手を下で 止める";
    case "clap":
      return "両手を中央で合わせる";
  }
}

/** What to do before the count-in starts, for the gestures that wait for a start pose. */
export function guideReadinessHint(gesture: P1Gesture): string {
  return gesture === "lift" || gesture === "diagonal-lift"
    ? "下の丸印に 両手を合わせて止める"
    : "丸印に 両手を合わせて止める";
}

function airTapGuide(side: "left" | "right"): GestureGuide {
  const center = AIR_TAP_TRIAL_CENTER[side];
  // The fingertip comes in from the outer edge, so the ring is crossed on the way to the middle.
  const direction = side === "left" ? -1 : 1;
  const start = clampGuidePoint({
    x: center.x + direction * (AIR_TAP_DEFAULTS.radius + AIR_TAP_APPROACH_MARGIN),
    y: center.y,
  });
  return {
    gesture: "air-tap",
    pointer: "index-tip",
    paths: [{ start, end: clampGuidePoint(center) }],
    zones: [],
    rings: [{ center: clampGuidePoint(center), radius: AIR_TAP_DEFAULTS.radius }],
    travelMs: GUIDE_TRAVEL_MS["air-tap"],
    holdMs: null,
    startRadius: START_RADIUS,
    endRadius: END_RADIUS,
  };
}

function ribbonSwipeGuide(trial: P1TrialDefinition): GestureGuide {
  const direction = ribbonSwipeDirectionVector(trial.swipeDirection ?? "left-to-right");
  // The judgment arms below -minimumDistance/2 and fires above +minimumDistance/2.
  const reach = RIBBON_SWIPE_DEFAULTS.minimumDistance / 2 + GUIDE_TARGET_MARGIN;
  const start = clampGuidePoint({
    x: RIBBON_SWIPE_CENTER.x - direction[0] * reach,
    y: RIBBON_SWIPE_CENTER.y - direction[1] * reach,
  });
  const end = clampGuidePoint({
    x: RIBBON_SWIPE_CENTER.x + direction[0] * reach,
    y: RIBBON_SWIPE_CENTER.y + direction[1] * reach,
  });
  return {
    gesture: "ribbon-swipe",
    pointer: "palm",
    paths: [{ start, end }],
    zones: [],
    rings: [],
    travelMs: GUIDE_TRAVEL_MS["ribbon-swipe"],
    holdMs: null,
    startRadius: START_RADIUS,
    endRadius: END_RADIUS,
  };
}

function bloomGuide(): GestureGuide {
  const geometry = createBloomGuideGeometry();
  const outward = BLOOM_DEFAULTS.minimumOutwardDistance + GUIDE_TARGET_MARGIN;
  const upward = BLOOM_DEFAULTS.minimumUpwardDistance + GUIDE_TARGET_MARGIN;
  const paths = [
    { start: geometry.leftTarget, offset: -outward },
    { start: geometry.rightTarget, offset: outward },
  ].map(({ start, offset }) => ({
    start: clampGuidePoint(start),
    end: clampGuidePoint({ x: start.x + offset, y: start.y - upward }),
  }));
  return {
    gesture: "bloom",
    pointer: "palm",
    paths,
    zones: [],
    rings: [],
    travelMs: GUIDE_TRAVEL_MS.bloom,
    holdMs: null,
    startRadius: START_RADIUS,
    endRadius: END_RADIUS,
  };
}

function liftGuide(): GestureGuide {
  const startY = (LIFT_DEFAULTS.startZoneMinY + LIFT_DEFAULTS.startZoneMaxY) / 2;
  const upward = LIFT_DEFAULTS.minimumUpwardDistance + GUIDE_TARGET_MARGIN;
  const paths = [
    (LIFT_DEFAULTS.leftZoneMinX + LIFT_DEFAULTS.leftZoneMaxX) / 2,
    (LIFT_DEFAULTS.rightZoneMinX + LIFT_DEFAULTS.rightZoneMaxX) / 2,
  ].map((x) => ({
    start: clampGuidePoint({ x, y: startY }),
    end: clampGuidePoint({ x, y: startY - upward }),
  }));
  return {
    gesture: "lift",
    pointer: "palm",
    paths,
    zones: [
      {
        minX: clampToFrame(LIFT_DEFAULTS.leftZoneMinX),
        maxX: clampToFrame(LIFT_DEFAULTS.leftZoneMaxX),
        minY: clampToFrame(LIFT_DEFAULTS.startZoneMinY),
        maxY: clampToFrame(LIFT_DEFAULTS.startZoneMaxY),
      },
      {
        minX: clampToFrame(LIFT_DEFAULTS.rightZoneMinX),
        maxX: clampToFrame(LIFT_DEFAULTS.rightZoneMaxX),
        minY: clampToFrame(LIFT_DEFAULTS.startZoneMinY),
        maxY: clampToFrame(LIFT_DEFAULTS.startZoneMaxY),
      },
    ],
    rings: [],
    travelMs: GUIDE_TRAVEL_MS.lift,
    holdMs: null,
    startRadius: START_RADIUS,
    endRadius: END_RADIUS,
  };
}

/**
 * ななめリフト: the same lower start line as Lift, but shifted sideways so neither hand runs
 * into the edge, and a path that follows the judged diagonal one margin past its threshold.
 */
function diagonalLiftGuide(variant: DiagonalLiftVariant): GestureGuide {
  const startY = (DIAGONAL_LIFT_DEFAULTS.startZoneMinY + DIAGONAL_LIFT_DEFAULTS.startZoneMaxY) / 2;
  const direction = DIAGONAL_LIFT_DIRECTIONS[variant];
  const reach = DIAGONAL_LIFT_DEFAULTS.minimumUpwardDistance + GUIDE_TARGET_MARGIN;
  const startX = DIAGONAL_LIFT_GUIDE_START_X[variant];
  const paths = [startX.left, startX.right].map((x) => ({
    start: clampGuidePoint({ x, y: startY }),
    end: clampGuidePoint({ x: x + direction[0] * reach, y: startY + direction[1] * reach }),
  }));
  return {
    gesture: "diagonal-lift",
    pointer: "palm",
    paths,
    zones: [],
    rings: [],
    travelMs: GUIDE_TRAVEL_MS["diagonal-lift"],
    holdMs: null,
    startRadius: START_RADIUS,
    endRadius: END_RADIUS,
  };
}

/**
 * Spotlight has no path to follow: the hands only have to end up in the two zones and stay
 * there. The zones are the judgment zones, split at the center line by the minimum separation.
 */
function spotlightGuide(trial: P1TrialDefinition): GestureGuide {
  const leftUp = trial.spotlightVariant !== "right-up-left-down";
  const halfGap = SPOTLIGHT_DEFAULTS.minimumHandSeparation / 2;
  const upper = { minY: GUIDE_FRAME_MINIMUM, maxY: SPOTLIGHT_DEFAULTS.upperZoneMaxY };
  const lower = { minY: SPOTLIGHT_DEFAULTS.lowerZoneMinY, maxY: GUIDE_FRAME_MAXIMUM };
  const screenLeft = { minX: GUIDE_FRAME_MINIMUM, maxX: SPOTLIGHT_DEFAULTS.centerLineX - halfGap };
  const screenRight = { minX: SPOTLIGHT_DEFAULTS.centerLineX + halfGap, maxX: GUIDE_FRAME_MAXIMUM };
  return {
    gesture: "spotlight",
    pointer: "palm",
    paths: [],
    zones: [
      { ...screenLeft, ...(leftUp ? upper : lower) },
      { ...screenRight, ...(leftUp ? lower : upper) },
    ],
    rings: [],
    travelMs: GUIDE_TRAVEL_MS.spotlight,
    holdMs: SPOTLIGHT_DEFAULTS.holdMs,
    startRadius: START_RADIUS,
    endRadius: END_RADIUS,
  };
}

function swipeWording(trial: P1TrialDefinition): string {
  return {
    "left-to-right": "左から右",
    "right-to-left": "右から左",
    "lower-left-to-upper-right": "左下から右上",
    "lower-right-to-upper-left": "右下から左上",
  }[trial.swipeDirection ?? "left-to-right"];
}

function clampToFrame(value: number): number {
  return Math.min(GUIDE_FRAME_MAXIMUM, Math.max(GUIDE_FRAME_MINIMUM, value));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
