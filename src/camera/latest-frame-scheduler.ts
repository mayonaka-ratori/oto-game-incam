import type { TrackingTimestamp } from "../tracking/tracking-types";

export interface ClosableFrame {
  close(): void;
}

export interface ScheduledFrame<TFrame extends ClosableFrame> {
  readonly frameId: number;
  readonly image: TFrame;
  readonly timestamp: TrackingTimestamp;
}

export interface SchedulerSnapshot {
  readonly captured: number;
  readonly sent: number;
  readonly completed: number;
  readonly replaced: number;
  readonly errored: number;
  readonly inFlight: 0 | 1;
  readonly pending: 0 | 1;
}

export class LatestFrameScheduler<TFrame extends ClosableFrame> {
  readonly #send: (frame: ScheduledFrame<TFrame>) => void;
  #inFlight: ScheduledFrame<TFrame> | null = null;
  #pending: ScheduledFrame<TFrame> | null = null;
  #nextFrameId = 1;
  #captured = 0;
  #sent = 0;
  #completed = 0;
  #replaced = 0;
  #errored = 0;
  #stopped = false;

  constructor(send: (frame: ScheduledFrame<TFrame>) => void) {
    this.#send = send;
  }

  offer(image: TFrame, timestamp: TrackingTimestamp): number | null {
    if (this.#stopped) {
      image.close();
      return null;
    }
    const frame = { frameId: this.#nextFrameId++, image, timestamp };
    this.#captured += 1;
    if (this.#inFlight === null) {
      this.#dispatch(frame);
    } else {
      if (this.#pending !== null) {
        this.#pending.image.close();
        this.#replaced += 1;
      }
      this.#pending = frame;
    }
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
      errored: this.#errored,
      inFlight: this.#inFlight === null ? 0 : 1,
      pending: this.#pending === null ? 0 : 1,
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
