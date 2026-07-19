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
import { LabView } from "../ui/lab-view";
import { initialLabState, transitionLabState, type LabState } from "./lab-state";

export class LabController {
  readonly #support: CameraSupportSnapshot;
  readonly #camera: CameraController;
  readonly #view: LabView;
  #state: LabState = initialLabState;
  #session: CameraSession | null = null;
  #metrics: FrameMetricsSnapshot | null = null;
  #metricsCollector: FrameMetricsCollector | null = null;
  #previewVisible = true;
  #disposed = false;

  constructor(root: HTMLElement) {
    this.#support = inspectCameraSupport();
    this.#camera = new CameraController((event) => this.#handleTrackEvent(event));
    this.#view = new LabView(root, {
      onStart: () => void this.#startCamera(),
      onStop: () => this.#stopCamera(),
      onTogglePreview: () => this.#togglePreview(),
    });

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
    });
  };

  readonly #dispose = (): void => {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#metricsCollector?.stop();
    this.#camera.stop();
    window.removeEventListener("resize", this.#handleViewportChange);
    window.removeEventListener("orientationchange", this.#handleViewportChange);
    window.removeEventListener("pagehide", this.#dispose);
    document.removeEventListener("visibilitychange", this.#render);
  };
}
