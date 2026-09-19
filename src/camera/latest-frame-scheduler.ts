import type { TrackingTimestamp } from "../tracking/tracking-types";

export interface ClosableFrame {
  close(): void;
}

export interface ScheduledFrame<TFrame extends ClosableFrame> {
  readonly frameId: number;
  readonly image: TFrame;
  readonly timestamp: TrackingTimestamp;
}

/**
 * What happens to a frame that arrives while one is already being processed.
 *
 * - `hold` keeps it in the single pending slot, replacing whatever was there. The next frame the
 *   worker sees is the newest one captured during the inference, so no capture interval is lost.
 * - `drop` keeps no pending slot: the frame is closed at once and the worker stays idle until the
 *   next capture arrives. On Android Chrome the MediaStreamTrackProcessor path stops delivering
 *   frames while two are unreleased, which made the held frame roughly one inference old before it
 *   was processed (docs/18 の2.2). Dropping trades output rate for a newer frame.
 *
 * Both policies keep in-flight and pending at one or less.
 */
export type PendingFramePolicy = "hold" | "drop";

export interface SchedulerSnapshot {
  readonly captured: number;
  readonly sent: number;
  readonly completed: number;
  /** `hold`: frames evicted from the pending slot by a newer one. Always 0 under `drop`. */
  readonly replaced: number;
  /** `drop`: frames closed on arrival because one was still being processed. Always 0 under `hold`. */
  readonly dropped: number;
  readonly errored: number;
  readonly inFlight: 0 | 1;
  readonly pending: 0 | 1;
  readonly pendingPolicy: PendingFramePolicy;
}

export class LatestFrameScheduler<TFrame extends ClosableFrame> {
  readonly #send: (frame: ScheduledFrame<TFrame>) => void;
  readonly #pendingPolicy: PendingFramePolicy;
  #inFlight: ScheduledFrame<TFrame> | null = null;
  #pending: ScheduledFrame<TFrame> | null = null;
  #nextFrameId = 1;
  #captured = 0;
  #sent = 0;
  #completed = 0;
  #replaced = 0;
  #dropped = 0;
  #errored = 0;
  #stopped = false;

  constructor(
    send: (frame: ScheduledFrame<TFrame>) => void,
    pendingPolicy: PendingFramePolicy = "hold",
  ) {
    this.#send = send;
    this.#pendingPolicy = pendingPolicy;
  }

  offer(image: TFrame, timestamp: TrackingTimestamp): number | null {
    if (this.#stopped) {
      image.close();
      return null;
    }
    this.#captured += 1;
    if (this.#inFlight === null) {
      const frame = { frameId: this.#nextFrameId++, image, timestamp };
      this.#dispatch(frame);
      return frame.frameId;
    }
    if (this.#pendingPolicy === "drop") {
      // No pending slot, so the frame never ages while the worker is busy.
      image.close();
      this.#dropped += 1;
      return null;
    }
    if (this.#pending !== null) {
      this.#pending.image.close();
      this.#replaced += 1;
    }
    const frame = { frameId: this.#nextFrameId++, image, timestamp };
    this.#pending = frame;
    return frame.frameId;
  }

  complete(frameId: number, errored = false): void {
    if (this.#inFlight?.frameId !== frameId) return;
    this.#inFlight = null;
    if (errored) this.#errored += 1;
    else this.#completed += 1;
    const next = this.#pending;
    this.#pending = null;
    if (next !== null && !this.#stopped) this.#dispatch(next);
    else if (next !== null) next.image.close();
  }

  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#pending?.image.close();
    this.#pending = null;
  }

  get snapshot(): SchedulerSnapshot {
    return {
      captured: this.#captured,
      sent: this.#sent,
      completed: this.#completed,
      replaced: this.#replaced,
      dropped: this.#dropped,
      errored: this.#errored,
      inFlight: this.#inFlight === null ? 0 : 1,
      pending: this.#pending === null ? 0 : 1,
      pendingPolicy: this.#pendingPolicy,
    };
  }

  #dispatch(frame: ScheduledFrame<TFrame>): void {
    this.#inFlight = frame;
    try {
      this.#send(frame);
      this.#sent += 1;
    } catch (error) {
      this.#inFlight = null;
      frame.image.close();
      this.#errored += 1;
      throw error;
    }
  }
}
