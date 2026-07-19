import {
  describeFrameSourceError,
  type FrameHandler,
  type FrameSource,
  type FrameSourceErrorHandler,
} from "./frame-source";

interface ExtendedVideoFrameMetadata extends VideoFrameCallbackMetadata {
  readonly captureTime?: number;
}

export class RvfcFrameSource implements FrameSource {
  readonly kind = "requestVideoFrameCallback" as const;
  readonly #video: HTMLVideoElement;
  readonly #onFrame: FrameHandler;
  readonly #onError: FrameSourceErrorHandler;
  #callbackId: number | null = null;
  #captureInProgress = false;
  #running = false;

  constructor(video: HTMLVideoElement, onFrame: FrameHandler, onError: FrameSourceErrorHandler) {
    if (typeof video.requestVideoFrameCallback !== "function" || typeof createImageBitmap !== "function") {
      throw new Error("requestVideoFrameCallback/ImageBitmap is unavailable.");
    }
    this.#video = video;
    this.#onFrame = onFrame;
    this.#onError = onError;
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#schedule();
  }

  stop(): void {
    this.#running = false;
    if (this.#callbackId !== null) this.#video.cancelVideoFrameCallback(this.#callbackId);
    this.#callbackId = null;
  }

  #schedule(): void {
    if (!this.#running) return;
    this.#callbackId = this.#video.requestVideoFrameCallback((now, metadata) => {
      this.#schedule();
      if (this.#captureInProgress) return;
      this.#captureInProgress = true;
      void this.#capture(now, metadata).finally(() => {
        this.#captureInProgress = false;
      });
    });
  }

  async #capture(now: number, metadata: ExtendedVideoFrameMetadata): Promise<void> {
    try {
      const image = await createImageBitmap(this.#video);
      if (!this.#running) {
        image.close();
        return;
      }
      const captureTime = finite(metadata.captureTime);
      const presentationTime = finite(metadata.presentationTime ?? metadata.expectedDisplayTime);
      this.#onFrame({
        image,
        timestamp: {
          captureTimeMs: captureTime ?? presentationTime ?? now,
          callbackTimeMs: now,
          source: captureTime !== null
            ? "capture-time"
            : presentationTime !== null
              ? "presentation-time"
              : "callback-time",
        },
      });
    } catch (error) {
      if (this.#running) this.#onError(describeFrameSourceError(error));
    }
  }
}

function finite(value: number | undefined): number | null {
  return value !== undefined && Number.isFinite(value) ? value : null;
}
