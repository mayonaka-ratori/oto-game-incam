import { BLOOM_DEFAULTS } from "../gestures/bloom-state-machine";

/**
 * Bloom arms only while the pair midpoint sits near the middle of the frame
 * (`BloomStateMachine#inPreparationZone` compares it against 0.5 on both axes).
 */
export const BLOOM_PREPARATION_CENTER = { x: 0.5, y: 0.5 } as const;

/**
 * How far above the lowest accepted midpoint the guide puts the waiting hands. Holding the arms
 * at the middle of the image tires them out, and testers let them sink before GO (docs/19 の3.2).
 * The judgment zone is unchanged; only the circle the guide draws moves down inside it.
 */
export const BLOOM_GUIDE_BOTTOM_MARGIN = 0.09;

/** Where the guide asks the hands to wait: inside the judgment zone, near its lower edge. */
export const BLOOM_GUIDE_START_Y = BLOOM_PREPARATION_CENTER.y
  + BLOOM_DEFAULTS.preparationCenterToleranceY
  - BLOOM_GUIDE_BOTTOM_MARGIN;

export interface BloomGuidePoint {
  readonly x: number;
  readonly y: number;
}

export interface BloomGuideGeometry {
  /** Where the midpoint between the two hands has to sit, in normalized frame coordinates. */
  readonly midpointZone: {
    readonly minX: number;
    readonly maxX: number;
    readonly minY: number;
    readonly maxY: number;
  };
  /** Accepted distance between the two hands along x. */
  readonly spanRange: { readonly minimum: number; readonly maximum: number };
  /** Middle of the accepted span: the distance the guide asks the player for. */
  readonly targetSpan: number;
  /** Height of both waiting circles. Inside the zone, but low enough to rest the arms. */
  readonly startY: number;
  readonly leftTarget: BloomGuidePoint;
  readonly rightTarget: BloomGuidePoint;
}

/**
 * The preparation zone drawn over the camera image. The Bloom zone is symmetric around the
 * frame center, so the mirrored preview shows the same rectangle and the same hand targets.
 */
export function createBloomGuideGeometry(): BloomGuideGeometry {
  const minimum = BLOOM_DEFAULTS.minimumPreparationSpan;
  const maximum = BLOOM_DEFAULTS.maximumPreparationSpan;
  const targetSpan = (minimum + maximum) / 2;
  return {
    midpointZone: {
      minX: BLOOM_PREPARATION_CENTER.x - BLOOM_DEFAULTS.preparationCenterToleranceX,
      maxX: BLOOM_PREPARATION_CENTER.x + BLOOM_DEFAULTS.preparationCenterToleranceX,
      minY: BLOOM_PREPARATION_CENTER.y - BLOOM_DEFAULTS.preparationCenterToleranceY,
      maxY: BLOOM_PREPARATION_CENTER.y + BLOOM_DEFAULTS.preparationCenterToleranceY,
    },
    spanRange: { minimum, maximum },
    targetSpan,
    startY: BLOOM_GUIDE_START_Y,
    leftTarget: { x: BLOOM_PREPARATION_CENTER.x - targetSpan / 2, y: BLOOM_GUIDE_START_Y },
    rightTarget: { x: BLOOM_PREPARATION_CENTER.x + targetSpan / 2, y: BLOOM_GUIDE_START_Y },
  };
}

/** The same check the state machine makes on the starting pose, for a pair of positions. */
export function isBloomPreparationPose(left: BloomGuidePoint, right: BloomGuidePoint): boolean {
  const geometry = createBloomGuideGeometry();
  const span = right.x - left.x;
  const midX = (left.x + right.x) / 2;
  const midY = (left.y + right.y) / 2;
  return span >= geometry.spanRange.minimum
    && span <= geometry.spanRange.maximum
    && midX >= geometry.midpointZone.minX
    && midX <= geometry.midpointZone.maxX
    && midY >= geometry.midpointZone.minY
    && midY <= geometry.midpointZone.maxY;
}
