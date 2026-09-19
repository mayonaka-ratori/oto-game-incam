import { HAND_CONNECTIONS } from "../tracking/hand-connections";
import type { P1TrialDefinition } from "../poc/phase1-protocol";
import type { DetectedHand, HandTrackingFrame } from "../tracking/tracking-types";
import {
  anchorGuidePaths,
  createGestureGuide,
  guideDotPosition,
  guideDotProgress,
  type GestureGuide,
  type GuidePoint,
  type GuideZone,
} from "./gesture-guides";
import { calculatePalmCursor } from "./palm-cursor";
import {
  createVideoCoverTransform,
  mapPreviewLandmark,
  mapVideoLandmark,
} from "./video-coordinate-transform";

export interface OverlayLayers {
  readonly landmarks: boolean;
  readonly connections: boolean;
  readonly cursor: boolean;
  readonly labels: boolean;
}

/**
 * What the camera overlay needs to draw the guide of one attempt. The guide shape comes from
 * the trial, and the travelling dot from the GO time, which is the audio clock's time on the
 * performance clock. Null means no trial is being shown.
 */
export interface P1GuideView {
  readonly trial: P1TrialDefinition;
  readonly goTimeMs: number | null;
  /** preview: shown before the attempt starts. readiness: waiting for the start pose. */
  readonly phase: "preview" | "readiness" | "recognition";
  /**
   * Where the hands settled once the start position was confirmed, screen-left hand first.
   * The paths are redrawn from here so the guide and the judgment start from the same place.
   * Null before the start position settles, and for gestures without one.
   */
  readonly anchors: readonly GuidePoint[] | null;
}

type Transform = NonNullable<ReturnType<typeof createVideoCoverTransform>>;

const GUIDE_COLOR = "#ffc56d";
const GUIDE_REACHED_COLOR = "#62f2dc";
const GUIDE_DOT_COLOR = "#ffffff";
/** The dot stays visible for a moment after it lands, so a late glance still shows the target. */
const DOT_HOLD_MS = 300;
/**
 * Before GO the path and the end ring are drawn faintly, so the count-in does not read as an
 * invitation to set off early (docs/19 の3.3 と4.4). The start circle keeps its full brightness.
 */
const GUIDE_PENDING_ALPHA = 0.25;
const GUIDE_PATH_ALPHA = 0.85;
/**
 * Until the start position is confirmed, the circle is the only thing to aim at, so it is drawn
 * larger still. Display only: the judgment never reads a radius.
 */
const READINESS_START_SCALE = 1.35;

export const DEFAULT_OVERLAY_LAYERS: OverlayLayers = {
  landmarks: true,
  connections: true,
  cursor: true,
  labels: true,
};

/**
 * A phone with devicePixelRatio 3 would make the overlay canvas nine times the CSS area.
 * Two is enough for dashed guides and 3px landmark dots.
 */
const MAXIMUM_DEVICE_PIXEL_RATIO = 2;

export class OverlayRenderer {
  readonly #video: HTMLVideoElement;
  readonly #canvas: HTMLCanvasElement;
  readonly #context: CanvasRenderingContext2D;
  /** The tester screen keeps the camera image readable: only the palm cursor, no skeleton. */
  readonly #minimalHands: boolean;
  #frame: HandTrackingFrame | null = null;
  #guide: P1GuideView | null = null;
  #gestureGuide: GestureGuide | null = null;
  /** When both Spotlight zones have been occupied without a break, for the hold indicator. */
  #holdSinceMs: number | null = null;
  #layers: OverlayLayers = DEFAULT_OVERLAY_LAYERS;
  #rafId: number | null = null;
  #resizeObserver: ResizeObserver | null = null;
  #cssWidth = 0;
  #cssHeight = 0;
  #pixelRatio = 0;
  #videoWidth = 0;
  #videoHeight = 0;
  /** Nothing is drawn until something that changes the picture happens. */
  #dirty = true;

  constructor(video: HTMLVideoElement, canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("Canvas 2D is unavailable.");
    this.#video = video;
    this.#canvas = canvas;
    this.#context = context;
    this.#minimalHands = canvas.closest(".tester-view") !== null;
    if (typeof ResizeObserver !== "undefined") {
      // Reading clientWidth every frame forces a layout; the observer reports the size instead.
      const observer = new ResizeObserver((entries) => {
        const entry = entries[entries.length - 1];
        if (entry === undefined) return;
        this.#setCanvasSize(entry.contentRect.width, entry.contentRect.height);
      });
      observer.observe(canvas);
      this.#resizeObserver = observer;
    }
    this.#measureCanvas();
    this.#rafId = requestAnimationFrame(this.#draw);
  }

  setFrame(frame: HandTrackingFrame | null): void {
    if (!(frame === null || this.#frame === null || frame.frameId > this.#frame.frameId)) return;
    if (frame === null && this.#frame === null) return;
    this.#frame = frame;
    this.#dirty = true;
  }

  setLayers(layers: OverlayLayers): void {
    if (sameLayers(this.#layers, layers)) return;
    this.#layers = layers;
    this.#dirty = true;
  }

  setP1Guide(guide: P1GuideView | null): void {
    if (sameGuide(this.#guide, guide)) return;
    if (guide === null || this.#guide?.trial !== guide.trial) this.#holdSinceMs = null;
    this.#guide = guide;
    // Anchoring happens once per guide change, not once per drawn frame.
    const shape = guide === null ? null : createGestureGuide(guide.trial);
    this.#gestureGuide = shape === null || guide === null || guide.anchors === null
      ? shape
      : anchorGuidePaths(shape, guide.anchors);
    this.#dirty = true;
  }

  dispose(): void {
    if (this.#rafId !== null) cancelAnimationFrame(this.#rafId);
    this.#rafId = null;
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    this.#frame = null;
    this.#context.clearRect(0, 0, this.#canvas.width, this.#canvas.height);
  }

  readonly #draw = (): void => {
    this.#rafId = requestAnimationFrame(this.#draw);
    if (this.#resizeObserver === null) this.#measureCanvas();
    this.#syncPixelRatio();
    this.#syncVideoSize();
    // Only the travelling dot and the hold indicator move on their own; everything else
    // is redrawn when the picture changes.
    if (this.#animating()) this.#dirty = true;
    if (!this.#dirty) return;
    this.#dirty = false;
    this.#renderFrame();
  };

  #animating(): boolean {
    if (this.#holdSinceMs !== null) return true;
    const guide = this.#guide;
    const gestureGuide = this.#gestureGuide;
    if (guide === null || gestureGuide === null || guide.goTimeMs === null) return false;
    const now = performance.now();
    return now >= guide.goTimeMs && now <= guide.goTimeMs + gestureGuide.travelMs + DOT_HOLD_MS;
  }

  /** Fallback for browsers without ResizeObserver, and the first size before the observer reports. */
  #measureCanvas(): void {
    this.#setCanvasSize(this.#canvas.clientWidth, this.#canvas.clientHeight);
  }

  #setCanvasSize(cssWidth: number, cssHeight: number): void {
    if (this.#cssWidth === cssWidth && this.#cssHeight === cssHeight) return;
    this.#cssWidth = cssWidth;
    this.#cssHeight = cssHeight;
    this.#dirty = true;
  }

  #syncPixelRatio(): void {
    const ratio = Math.min(MAXIMUM_DEVICE_PIXEL_RATIO, window.devicePixelRatio || 1);
    if (this.#pixelRatio === ratio) return;
    this.#pixelRatio = ratio;
    this.#dirty = true;
  }

  /** The camera can hand over a different size, and rotating the device swaps width and height. */
  #syncVideoSize(): void {
    const width = this.#video.videoWidth;
    const height = this.#video.videoHeight;
    if (this.#videoWidth === width && this.#videoHeight === height) return;
    this.#videoWidth = width;
    this.#videoHeight = height;
    this.#dirty = true;
  }

  #renderFrame(): void {
    const cssWidth = this.#cssWidth;
    const cssHeight = this.#cssHeight;
    const dpr = this.#pixelRatio;
    const pixelWidth = Math.max(1, Math.round(cssWidth * dpr));
    const pixelHeight = Math.max(1, Math.round(cssHeight * dpr));
    if (this.#canvas.width !== pixelWidth || this.#canvas.height !== pixelHeight) {
      this.#canvas.width = pixelWidth;
      this.#canvas.height = pixelHeight;
    }
    this.#context.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.#context.clearRect(0, 0, cssWidth, cssHeight);
    const transform = createVideoCoverTransform(
      this.#videoWidth,
      this.#videoHeight,
      cssWidth,
      cssHeight,
      true,
    );
    if (transform === null) return;
    const guide = this.#guide;
    const gestureGuide = this.#gestureGuide;
    if (guide !== null && gestureGuide !== null) this.#drawGuide(guide, gestureGuide, transform);
    else this.#holdSinceMs = null;
    if (this.#frame !== null) {
      for (const hand of this.#frame.hands) this.#drawHand(hand, transform);
    }
  }

  /**
   * The guide is drawn where the movement really has to happen: a circle to start from, a line
   * with an arrow to follow, and a ring to reach. All of it comes from the judgment constants
   * (`createGestureGuide`), in the same mirrored coordinates the judgment reads.
   */
  #drawGuide(guide: P1GuideView, shape: GestureGuide, transform: Transform): void {
    const pointers = this.#pointerPositions(shape.pointer);
    const context = this.#context;
    const unit = transform.videoWidth * transform.scale;
    // Before GO the way to go is only a hint; on GO it turns bright. The GO time is the one the
    // count-in on screen uses, so the picture and the count change together.
    const goReached = guide.goTimeMs !== null && performance.now() >= guide.goTimeMs;
    const pathAlpha = goReached ? GUIDE_PATH_ALPHA : GUIDE_PENDING_ALPHA;
    const endAlpha = goReached ? 1 : GUIDE_PENDING_ALPHA;
    // Waiting for the start position: the circle is the whole instruction, so it is drawn bigger.
    const startRadius = shape.startRadius * (guide.phase === "recognition" ? 1 : READINESS_START_SCALE);
    context.save();
    context.lineJoin = "round";
    for (const zone of shape.zones) this.#drawZone(zone, transform, pointers);
    if (shape.holdMs !== null) this.#drawHold(shape, transform, pointers);
    for (const ring of shape.rings) {
      const reached = pointers.some((point) => distance(point, ring.center) <= ring.radius);
      this.#strokeCircle(mapPreviewLandmark(transform, ring.center), ring.radius * unit, reached, true, endAlpha);
    }
    for (const path of shape.paths) {
      const start = mapPreviewLandmark(transform, path.start);
      const end = mapPreviewLandmark(transform, path.end);
      context.globalAlpha = pathAlpha;
      context.strokeStyle = GUIDE_COLOR;
      context.lineWidth = 3;
      context.setLineDash([10, 8]);
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
      context.stroke();
      this.#drawArrowHead(start.x, start.y, end.x, end.y);
      const onStart = pointers.some((point) => distance(point, path.start) <= startRadius);
      const onEnd = pointers.some((point) => distance(point, path.end) <= shape.endRadius);
      this.#strokeCircle(start, startRadius * unit, onStart, false);
      if (shape.rings.length === 0) this.#strokeCircle(end, shape.endRadius * unit, onEnd, true, endAlpha);
    }
    const progress = guideDotProgress(performance.now(), guide.goTimeMs, shape.travelMs);
    if (guide.goTimeMs !== null && progress > 0) {
      for (const path of shape.paths) {
        const dot = mapPreviewLandmark(transform, guideDotPosition(path, progress));
        this.#drawDot(dot);
      }
    }
    context.restore();
  }

  /** Mirrored-preview positions of the point each gesture judges: palm center or index fingertip. */
  #pointerPositions(pointer: "palm" | "index-tip"): readonly GuidePoint[] {
    const hands = this.#frame?.hands ?? [];
    const points: GuidePoint[] = [];
    for (const hand of hands) {
      const source = pointer === "index-tip" ? hand.landmarks2D[8] : calculatePalmCursor(hand.landmarks2D);
      // The judgment reads mirrored preview coordinates, so the guide compares the same value.
      if (source !== undefined && source !== null) points.push({ x: 1 - source.x, y: source.y });
    }
    return points;
  }

  #drawZone(zone: GuideZone, transform: Transform, pointers: readonly GuidePoint[]): void {
    const occupied = pointers.some((point) => (
      point.x >= zone.minX && point.x <= zone.maxX && point.y >= zone.minY && point.y <= zone.maxY
    ));
    const color = occupied ? GUIDE_REACHED_COLOR : GUIDE_COLOR;
    this.#context.globalAlpha = 0.9;
    this.#context.strokeStyle = color;
    this.#context.fillStyle = occupied ? "rgba(98, 242, 220, 0.16)" : "rgba(255, 197, 109, 0.1)";
    this.#context.lineWidth = 3;
    this.#context.setLineDash(occupied ? [] : [10, 8]);
    this.#strokeZone(transform, { x: zone.minX, y: zone.minY }, { x: zone.maxX, y: zone.maxY });
  }

  /**
   * How much of the hold is done, drawn as a bar that fills along the bottom of each zone.
   * It is a display only: the judgment measures its own hold from the capture times.
   */
  #drawHold(shape: GestureGuide, transform: Transform, pointers: readonly GuidePoint[]): void {
    const holdMs = shape.holdMs ?? 0;
    const held = shape.zones.length > 0 && shape.zones.every((zone) => pointers.some((point) => (
      point.x >= zone.minX && point.x <= zone.maxX && point.y >= zone.minY && point.y <= zone.maxY
    )));
    if (!held) {
      this.#holdSinceMs = null;
      return;
    }
    const now = performance.now();
    if (this.#holdSinceMs === null) this.#holdSinceMs = now;
    const progress = holdMs <= 0 ? 1 : Math.min(1, (now - this.#holdSinceMs) / holdMs);
    for (const zone of shape.zones) {
      const start = mapPreviewLandmark(transform, { x: zone.minX, y: zone.maxY });
      const end = mapPreviewLandmark(transform, { x: zone.maxX, y: zone.maxY });
      const left = Math.min(start.x, end.x);
      const width = Math.abs(end.x - start.x);
      this.#context.globalAlpha = 1;
      this.#context.setLineDash([]);
      this.#context.fillStyle = progress >= 1 ? GUIDE_REACHED_COLOR : "rgba(98, 242, 220, 0.6)";
      this.#context.fillRect(left, start.y - 8, width * progress, 6);
    }
  }

  #strokeCircle(
    center: { readonly x: number; readonly y: number },
    radius: number,
    reached: boolean,
    solid: boolean,
    alpha = 1,
  ): void {
    const context = this.#context;
    context.globalAlpha = alpha;
    context.strokeStyle = reached ? GUIDE_REACHED_COLOR : GUIDE_COLOR;
    context.fillStyle = reached ? "rgba(98, 242, 220, 0.28)" : "rgba(255, 197, 109, 0.12)";
    context.lineWidth = reached ? 4 : 3;
    context.setLineDash(solid || reached ? [] : [8, 6]);
    context.beginPath();
    context.arc(center.x, center.y, Math.max(8, radius), 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }

  /** The travelling dot: the pace to follow, placed from the time, not from the frame count. */
  #drawDot(center: { readonly x: number; readonly y: number }): void {
    const context = this.#context;
    context.globalAlpha = 1;
    context.setLineDash([]);
    context.fillStyle = "rgba(98, 242, 220, 0.35)";
    context.beginPath();
    context.arc(center.x, center.y, 16, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = GUIDE_DOT_COLOR;
    context.beginPath();
    context.arc(center.x, center.y, 8, 0, Math.PI * 2);
    context.fill();
  }

  #strokeZone(
    transform: Transform,
    first: { readonly x: number; readonly y: number },
    second: { readonly x: number; readonly y: number },
  ): void {
    const a = mapPreviewLandmark(transform, first);
    const b = mapPreviewLandmark(transform, second);
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const width = Math.abs(a.x - b.x);
    const height = Math.abs(a.y - b.y);
    this.#context.fillRect(x, y, width, height);
    this.#context.strokeRect(x, y, width, height);
  }

  #drawArrowHead(startX: number, startY: number, endX: number, endY: number): void {
    const angle = Math.atan2(endY - startY, endX - startX);
    this.#context.setLineDash([]);
    this.#context.beginPath();
    this.#context.moveTo(endX, endY);
    this.#context.lineTo(endX - 18 * Math.cos(angle - 0.55), endY - 18 * Math.sin(angle - 0.55));
    this.#context.moveTo(endX, endY);
    this.#context.lineTo(endX - 18 * Math.cos(angle + 0.55), endY - 18 * Math.sin(angle + 0.55));
    this.#context.stroke();
  }

  #drawHand(
    hand: DetectedHand,
    transform: NonNullable<ReturnType<typeof createVideoCoverTransform>>,
  ): void {
    const color = hand.handedness === "left" ? "#62f2dc" : hand.handedness === "right" ? "#e57ad9" : "#ffc56d";
    if (this.#minimalHands) {
      // The tester follows the guide, so the skeleton would only cover it: the palm cursor is enough.
      this.#drawPalmCursor(hand, transform, color);
      return;
    }
    const points = hand.landmarks2D.map((point) => mapVideoLandmark(transform, point));
    if (this.#layers.connections) {
      this.#context.strokeStyle = color;
      this.#context.globalAlpha = 0.72;
      this.#context.lineWidth = 2;
      for (const [start, end] of HAND_CONNECTIONS) {
        const a = points[start];
        const b = points[end];
        if (a === undefined || b === undefined) continue;
        this.#context.beginPath();
        this.#context.moveTo(a.x, a.y);
        this.#context.lineTo(b.x, b.y);
        this.#context.stroke();
      }
    }
    if (this.#layers.landmarks) {
      this.#context.globalAlpha = 1;
      this.#context.fillStyle = color;
      for (const point of points) {
        this.#context.beginPath();
        this.#context.arc(point.x, point.y, 3, 0, Math.PI * 2);
        this.#context.fill();
      }
    }
    const palm = calculatePalmCursor(hand.landmarks2D);
    if (palm === null) return;
    const center = mapVideoLandmark(transform, palm);
    if (this.#layers.cursor) {
      this.#context.globalAlpha = 1;
      this.#context.strokeStyle = color;
      this.#context.lineWidth = 3;
      this.#context.beginPath();
      this.#context.arc(center.x, center.y, 18, 0, Math.PI * 2);
      this.#context.stroke();
      this.#context.beginPath();
      this.#context.moveTo(center.x - 24, center.y);
      this.#context.lineTo(center.x + 24, center.y);
      this.#context.moveTo(center.x, center.y - 24);
      this.#context.lineTo(center.x, center.y + 24);
      this.#context.stroke();
    }
    if (this.#layers.labels) {
      const label = hand.handedness === "left" ? "L" : hand.handedness === "right" ? "R" : "?";
      this.#context.font = "700 13px ui-monospace, monospace";
      this.#context.fillStyle = "rgba(3, 7, 9, 0.82)";
      this.#context.fillRect(center.x + 20, center.y - 22, 70, 21);
      this.#context.fillStyle = color;
      this.#context.fillText(`${label} ${hand.handednessScore.toFixed(2)}`, center.x + 25, center.y - 7);
    }
    this.#context.globalAlpha = 1;
  }

  /** A thin ring on the palm: enough to see that the hand is tracked, thin enough to see the guide. */
  #drawPalmCursor(hand: DetectedHand, transform: Transform, color: string): void {
    const palm = calculatePalmCursor(hand.landmarks2D);
    if (palm === null) return;
    const center = mapVideoLandmark(transform, palm);
    this.#context.globalAlpha = 0.9;
    this.#context.setLineDash([]);
    this.#context.strokeStyle = color;
    this.#context.lineWidth = 2;
    this.#context.beginPath();
    this.#context.arc(center.x, center.y, 13, 0, Math.PI * 2);
    this.#context.stroke();
    this.#context.globalAlpha = 1;
  }
}

function sameLayers(first: OverlayLayers, second: OverlayLayers): boolean {
  return first.landmarks === second.landmarks
    && first.connections === second.connections
    && first.cursor === second.cursor
    && first.labels === second.labels;
}

function sameGuide(first: P1GuideView | null, second: P1GuideView | null): boolean {
  if (first === null || second === null) return first === second;
  return first.trial === second.trial
    && first.goTimeMs === second.goTimeMs
    && first.phase === second.phase
    && samePoints(first.anchors, second.anchors);
}

function samePoints(first: readonly GuidePoint[] | null, second: readonly GuidePoint[] | null): boolean {
  if (first === null || second === null) return first === second;
  return first.length === second.length
    && first.every((point, index) => point.x === second[index]?.x && point.y === second[index]?.y);
}

function distance(first: GuidePoint, second: GuidePoint): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}
