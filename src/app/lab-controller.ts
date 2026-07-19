import {
  CameraController,
  type CameraSession,
  type CameraTrackEvent,
} from "../camera/camera-controller";
import { classifyCameraError } from "../camera/camera-errors";
import {
  getBlockingSupportIssues,
  inspectCameraSupport,
  type CameraSupportSnapshot,
} from "../camera/camera-support";
import { FrameMetricsCollector, type FrameMetricsSnapshot } from "../metrics/frame-metrics";
import type { TrackingMetricsSnapshot } from "../metrics/tracking-metrics";
import { DEFAULT_OVERLAY_LAYERS, OverlayRenderer } from "../rendering/overlay-renderer";
import { LabView } from "../ui/lab-view";
import { TrackingWorkerClient } from "../worker/tracking-worker-client";
import {
  DeviceChecklistController,
  type DeviceCheckTechnicalSnapshot,
} from "../testing/device-checklist";
import { initialLabState, transitionLabState, type LabState } from "./lab-state";

export class LabController {
  readonly #support: CameraSupportSnapshot;
  readonly #camera: CameraController;
  readonly #view: LabView;
  #state: LabState = initialLabState;
  #session: CameraSession | null = null;
  #metrics: FrameMetricsSnapshot | null = null;
  #metricsCollector: FrameMetricsCollector | null = null;
  #tracking: TrackingMetricsSnapshot | null = null;
  #trackingClient: TrackingWorkerClient | null = null;
  readonly #overlayRenderer: OverlayRenderer;
  #previewVisible = true;
  #disposed = false;

  constructor(root: HTMLElement) {
    this.#support = inspectCameraSupport();
    this.#camera = new CameraController((event) => this.#handleTrackEvent(event));
    this.#view = new LabView(root, {
      onStart: () => void this.#startCamera(),
      onStop: () => this.#stopCamera(),
      onTogglePreview: () => this.#togglePreview(),
      onOverlayLayersChange: (layers) => this.#overlayRenderer.setLayers(layers),
    });
    this.#overlayRenderer = new OverlayRenderer(this.#view.video, this.#view.overlay);
    this.#overlayRenderer.setLayers(DEFAULT_OVERLAY_LAYERS);
    new DeviceChecklistController(root, () => this.#technicalSnapshot());

    const issues = getBlockingSupportIssues(this.#support);
    this.#state = transitionLabState(
      this.#state,
      issues.length === 0 ? { type: "SUPPORT_OK" } : { type: "SUPPORT_FAILED", issues },
    );

    window.addEventListener("resize", this.#handleViewportChange);
    window.addEventListener("orientationchange", this.#handleViewportChange);
    window.addEventListener("pagehide", this.#dispose);
    document.addEventListener("visibilitychange", this.#render);
    this.#render();
  }

  async #startCamera(): Promise<void> {
    if (this.#disposed || this.#state.kind === "requesting" || this.#state.kind === "active") {
      return;
    }

    this.#state = transitionLabState(this.#state, { type: "REQUEST_CAMERA" });
    this.#render();

    try {
      this.#session = await this.#camera.start(this.#view.video);
      if (this.#disposed) {
        this.#camera.stop();
        return;
      }
      this.#metricsCollector?.stop();
      this.#metricsCollector = new FrameMetricsCollector(this.#view.video, (metrics) => {
        this.#metrics = metrics;
        this.#render();
      });
      this.#metricsCollector.start();
      this.#state = transitionLabState(this.#state, { type: "CAMERA_STARTED" });
      this.#render();
      const trackingClient = new TrackingWorkerClient((update) => {
        this.#tracking = update.metrics;
        this.#overlayRenderer.setFrame(update.frame);
        this.#render();
      });
      this.#trackingClient = trackingClient;
      try {
        await trackingClient.start(this.#session.track, this.#view.video);
      } catch {
        // The tracking diagnostics already contain the classified initialization error.
      }
    } catch (error) {
      if (this.#disposed) {
        return;
      }
      this.#session = null;
      this.#metrics = null;
      this.#state = transitionLabState(this.#state, {
        type: "CAMERA_FAILED",
        error: classifyCameraError(error),
      });
    }

    this.#render();
  }

  #stopCamera(): void {
    this.#metricsCollector?.stop();
    this.#metricsCollector = null;
    this.#metrics = null;
    this.#trackingClient?.stop();
    this.#trackingClient = null;
    this.#tracking = null;
    this.#overlayRenderer.setFrame(null);
    this.#session = null;
    this.#camera.stop();
    this.#state = transitionLabState(this.#state, { type: "CAMERA_STOPPED" });
    this.#render();
  }

  #handleTrackEvent(event: CameraTrackEvent): void {
    if (event.type === "ended") {
      this.#metricsCollector?.stop();
      this.#metricsCollector = null;
      this.#metrics = null;
      this.#trackingClient?.stop();
      this.#trackingClient = null;
      this.#tracking = null;
      this.#overlayRenderer.setFrame(null);
      this.#session = null;
      this.#camera.stop();
      this.#state = transitionLabState(this.#state, {
        type: "CAMERA_INTERRUPTED",
        technicalDetail: "MediaStreamTrack ended",
      });
    }
    this.#render();
  }

  #togglePreview(): void {
    this.#previewVisible = !this.#previewVisible;
    this.#render();
  }

  readonly #handleViewportChange = (): void => {
    this.#render();
  };

  readonly #render = (): void => {
    if (this.#disposed) {
      return;
    }
    this.#view.render({
      state: this.#state,
      support: this.#support,
      session: this.#session,
      metrics: this.#metrics,
      previewVisible: this.#previewVisible,
      tracking: this.#tracking,
    });
  };

  readonly #dispose = (): void => {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#metricsCollector?.stop();
    this.#trackingClient?.stop();
    this.#overlayRenderer.dispose();
    this.#camera.stop();
    window.removeEventListener("resize", this.#handleViewportChange);
    window.removeEventListener("orientationchange", this.#handleViewportChange);
    window.removeEventListener("pagehide", this.#dispose);
    document.removeEventListener("visibilitychange", this.#render);
  };

  #technicalSnapshot(): DeviceCheckTechnicalSnapshot {
    const scheduler = this.#tracking?.scheduler;
    return {
      pageUrl: window.location.href,
      userAgent: navigator.userAgent,
      viewport: `${window.innerWidth} × ${window.innerHeight}`,
      devicePixelRatio: window.devicePixelRatio,
      cameraFps: this.#metrics?.cameraFps ?? null,
      trackingHz: this.#tracking?.outputHz ?? null,
      inferenceP95Ms: this.#tracking?.inferenceP95 ?? null,
      frameAgeP95Ms: this.#tracking?.frameAgeP95 ?? null,
      frameSource: this.#tracking?.frameSource ?? null,
      delegate: this.#tracking?.provider?.delegate ?? null,
      capturedFrames: scheduler?.captured ?? null,
      completedFrames: scheduler?.completed ?? null,
      replacedFrames: scheduler?.replaced ?? null,
      trackingError: this.#tracking?.fatalError ?? null,
    };
  }
}
