import { HAND_CONNECTIONS } from "../tracking/hand-connections";
import type { P1TrialDefinition } from "../poc/phase1-protocol";
import type { DetectedHand, HandTrackingFrame } from "../tracking/tracking-types";
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

export const DEFAULT_OVERLAY_LAYERS: OverlayLayers = {
  landmarks: true,
  connections: true,
  cursor: true,
  labels: true,
};

export class OverlayRenderer {
  readonly #video: HTMLVideoElement;
  readonly #canvas: HTMLCanvasElement;
  readonly #context: CanvasRenderingContext2D;
  #frame: HandTrackingFrame | null = null;
  #guide: P1TrialDefinition | null = null;
  #layers: OverlayLayers = DEFAULT_OVERLAY_LAYERS;
  #rafId: number | null = null;
  #visible = true;

  constructor(video: HTMLVideoElement, canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("Canvas 2D is unavailable.");
    this.#video = video;
    this.#canvas = canvas;
    this.#context = context;
    this.#rafId = requestAnimationFrame(this.#draw);
  }

  setFrame(frame: HandTrackingFrame | null): void {
    if (frame === null || this.#frame === null || frame.frameId > this.#frame.frameId) this.#frame = frame;
  }

  setLayers(layers: OverlayLayers): void {
    this.#layers = layers;
  }

  setP1Guide(guide: P1TrialDefinition | null): void {
    this.#guide = guide;
  }

  setVisible(visible: boolean): void {
    this.#visible = visible;
    this.#canvas.hidden = !visible;
  }

  dispose(): void {
    if (this.#rafId !== null) cancelAnimationFrame(this.#rafId);
    this.#rafId = null;
    this.#frame = null;
    this.#context.clearRect(0, 0, this.#canvas.width, this.#canvas.height);
  }

  readonly #draw = (): void => {
    if (this.#visible) this.#renderFrame();
    this.#rafId = requestAnimationFrame(this.#draw);
  };

  #renderFrame(): void {
    const cssWidth = this.#canvas.clientWidth;
    const cssHeight = this.#canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.max(1, Math.round(cssWidth * dpr));
    const pixelHeight = Math.max(1, Math.round(cssHeight * dpr));
    if (this.#canvas.width !== pixelWidth || this.#canvas.height !== pixelHeight) {
      this.#canvas.width = pixelWidth;
      this.#canvas.height = pixelHeight;
    }
    this.#context.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.#context.clearRect(0, 0, cssWidth, cssHeight);
    const transform = createVideoCoverTransform(
      this.#video.videoWidth,
      this.#video.videoHeight,
      cssWidth,
      cssHeight,
      true,
    );
    if (transform === null) return;
    if (this.#guide !== null) this.#drawGuide(this.#guide, transform);
    if (this.#frame !== null) {
      for (const hand of this.#frame.hands) this.#drawHand(hand, transform);
    }
  }

  #drawGuide(
    guide: P1TrialDefinition,
    transform: NonNullable<ReturnType<typeof createVideoCoverTransform>>,
  ): void {
    this.#context.save();
    this.#context.globalAlpha = 0.9;
    this.#context.strokeStyle = "#ffc56d";
    this.#context.fillStyle = "rgba(255, 197, 109, 0.14)";
    this.#context.lineWidth = 3;
    this.#context.setLineDash([9, 7]);
    if (guide.gesture === "air-tap") {
      const center = mapPreviewLandmark(transform, {
        x: guide.airTapSide === "left" ? 0.3 : 0.7,
        y: 0.5,
      });
      this.#context.beginPath();
      this.#context.arc(center.x, center.y, 44, 0, Math.PI * 2);
      this.#context.fill();
      this.#context.stroke();
    } else if (guide.gesture === "ribbon-swipe") {
      const [start, end] = swipeGuide(guide, transform);
      this.#context.beginPath();
      this.#context.moveTo(start.x, start.y);
      this.#context.lineTo(end.x, end.y);
      this.#context.stroke();
      this.#drawArrowHead(start.x, start.y, end.x, end.y);
    } else {
      const left = mapPreviewLandmark(transform, { x: 0.3, y: 0.5 });
      const right = mapPreviewLandmark(transform, { x: 0.7, y: 0.5 });
      const center = mapPreviewLandmark(transform, { x: 0.5, y: 0.5 });
      this.#context.beginPath();
      this.#context.arc(center.x, center.y, 34, 0, Math.PI * 2);
      this.#context.fill();
      this.#context.stroke();
      this.#context.beginPath();
      this.#context.moveTo(left.x, left.y);
      this.#context.lineTo(center.x - 38, center.y);
      this.#context.moveTo(right.x, right.y);
      this.#context.lineTo(center.x + 38, center.y);
      this.#context.stroke();
    }
    this.#context.restore();
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
}

function swipeGuide(
  guide: P1TrialDefinition,
  transform: NonNullable<ReturnType<typeof createVideoCoverTransform>>,
): readonly [{ x: number; y: number }, { x: number; y: number }] {
  const points = {
    "left-to-right": [{ x: 0.25, y: 0.5 }, { x: 0.75, y: 0.5 }],
    "right-to-left": [{ x: 0.75, y: 0.5 }, { x: 0.25, y: 0.5 }],
    "lower-left-to-upper-right": [{ x: 0.28, y: 0.7 }, { x: 0.72, y: 0.3 }],
    "lower-right-to-upper-left": [{ x: 0.72, y: 0.7 }, { x: 0.28, y: 0.3 }],
  }[guide.swipeDirection ?? "left-to-right"];
  return [
    mapPreviewLandmark(transform, points[0]!),
    mapPreviewLandmark(transform, points[1]!),
  ];
}
