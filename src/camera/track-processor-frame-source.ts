import {
  describeFrameSourceError,
  type FrameHandler,
  type FrameSource,
  type FrameSourceErrorHandler,
} from "./frame-source";

interface TrackProcessorConstructor {
  new (options: { track: MediaStreamTrack }): { readable: ReadableStream<VideoFrame> };
}

export class TrackProcessorFrameSource implements FrameSource {
  readonly kind = "MediaStreamTrackProcessor" as const;
  readonly #reader: ReadableStreamDefaultReader<VideoFrame>;
  readonly #onFrame: FrameHandler;
  readonly #onError: FrameSourceErrorHandler;
  #running = false;

  constructor(track: MediaStreamTrack, onFrame: FrameHandler, onError: FrameSourceErrorHandler) {
    const Constructor = Reflect.get(globalThis, "MediaStreamTrackProcessor") as
      | TrackProcessorConstructor
      | undefined;
    if (Constructor === undefined || typeof VideoFrame === "undefined") {
      throw new Error("MediaStreamTrackProcessor is unavailable.");
    }
    this.#reader = new Constructor({ track }).readable.getReader();
    this.#onFrame = onFrame;
    this.#onError = onError;
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    void this.#readLoop();
  }

  stop(): void {
    if (!this.#running) return;
    this.#running = false;
    void this.#reader.cancel().catch(() => undefined);
  }

  async #readLoop(): Promise<void> {
    try {
      while (this.#running) {
        const { done, value } = await this.#reader.read();
        if (done) break;
        if (!this.#running) {
          value.close();
          break;
        }
        const callbackTimeMs = performance.now();
        this.#onFrame({
          image: value,
          timestamp: {
            captureTimeMs: callbackTimeMs,
            callbackTimeMs,
            source: "callback-time",
          },
        });
      }
    } catch (error) {
      if (this.#running) this.#onError(describeFrameSourceError(error));
    }
  }
}
