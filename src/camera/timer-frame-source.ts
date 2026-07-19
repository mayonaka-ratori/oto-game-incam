import {
  describeFrameSourceError,
  type FrameHandler,
  type FrameSource,
  type FrameSourceErrorHandler,
} from "./frame-source";

export class TimerFrameSource implements FrameSource {
  readonly kind = "timer-fallback" as const;
  readonly #video: HTMLVideoElement;
  readonly #onFrame: FrameHandler;
  readonly #onError: FrameSourceErrorHandler;
  #timerId: number | null = null;
  #running = false;
  #captureInProgress = false;

  constructor(video: HTMLVideoElement, onFrame: FrameHandler, onError: FrameSourceErrorHandler) {
    if (typeof createImageBitmap !== "function") throw new Error("ImageBitmap is unavailable.");
    this.#video = video;
    this.#onFrame = onFrame;
    this.#onError = onError;
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#timerId = window.setInterval(() => void this.#capture(), 100);
    void this.#capture();
  }

  stop(): void {
    this.#running = false;
    if (this.#timerId !== null) clearInterval(this.#timerId);
    this.#timerId = null;
  }

  async #capture(): Promise<void> {
    if (!this.#running || this.#captureInProgress) return;
    this.#captureInProgress = true;
    try {
      const image = await createImageBitmap(this.#video);
      if (!this.#running) {
        image.close();
        return;
      }
      const now = performance.now();
      this.#onFrame({
        image,
        timestamp: { captureTimeMs: now, callbackTimeMs: now, source: "callback-time" },
      });
    } catch (error) {
      if (this.#running) this.#onError(describeFrameSourceError(error));
    } finally {
      this.#captureInProgress = false;
    }
  }
}
