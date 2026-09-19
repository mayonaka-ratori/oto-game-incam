import { describe, expect, it } from "vitest";
import {
  LatestFrameScheduler,
  type ScheduledFrame,
} from "../src/camera/latest-frame-scheduler";

class FakeFrame {
  closeCount = 0;
  close(): void { this.closeCount += 1; }
}

const timestamp = { captureTimeMs: 1, callbackTimeMs: 1, source: "callback-time" as const };

describe("LatestFrameScheduler", () => {
  it("keeps one in-flight and only the newest pending frame", () => {
    const sent: number[] = [];
    const scheduler = new LatestFrameScheduler<FakeFrame>((frame) => sent.push(frame.frameId));
    const first = new FakeFrame();
    const replaced = new FakeFrame();
    const latest = new FakeFrame();

    scheduler.offer(first, timestamp);
    scheduler.offer(replaced, timestamp);
    scheduler.offer(latest, timestamp);

    expect(sent).toEqual([1]);
    expect(replaced.closeCount).toBe(1);
    expect(scheduler.snapshot).toMatchObject({ inFlight: 1, pending: 1, replaced: 1 });

    scheduler.complete(1);
    expect(sent).toEqual([1, 3]);
    expect(scheduler.snapshot).toMatchObject({ inFlight: 1, pending: 0, completed: 1 });
  });

  it("keeps only one in-flight and one pending frame during a long synthetic burst", () => {
    const sent: Array<ScheduledFrame<FakeFrame>> = [];
    const scheduler = new LatestFrameScheduler<FakeFrame>((frame) => sent.push(frame));
    const frames = Array.from({ length: 10_000 }, () => new FakeFrame());

    for (const frame of frames) {
      scheduler.offer(frame, timestamp);
      expect(scheduler.snapshot.inFlight).toBe(1);
      expect(scheduler.snapshot.pending).toBeLessThanOrEqual(1);
    }

    scheduler.complete(sent[0]!.frameId);
    const finalSent = sent[1]!;
    scheduler.complete(finalSent.frameId);

    expect(scheduler.snapshot).toMatchObject({
      captured: 10_000,
      sent: 2,
      completed: 2,
      replaced: 9_998,
      inFlight: 0,
      pending: 0,
    });
    expect(frames.filter((frame) => frame.closeCount === 1).length).toBe(9_998);
  });

  it("holds no pending frame under the drop policy and counts what it threw away", () => {
    const sent: number[] = [];
    const scheduler = new LatestFrameScheduler<FakeFrame>((frame) => sent.push(frame.frameId), "drop");
    const first = new FakeFrame();
    const duringInference = new FakeFrame();
    const alsoDuringInference = new FakeFrame();
    const afterInference = new FakeFrame();

    scheduler.offer(first, timestamp);
    expect(scheduler.offer(duringInference, timestamp)).toBeNull();
    scheduler.offer(alsoDuringInference, timestamp);

    // Nothing waits: both frames are closed at once, so neither can grow stale.
    expect(duringInference.closeCount).toBe(1);
    expect(alsoDuringInference.closeCount).toBe(1);
    expect(scheduler.snapshot).toMatchObject({
      captured: 3,
      sent: 1,
      inFlight: 1,
      pending: 0,
      replaced: 0,
      dropped: 2,
      pendingPolicy: "drop",
    });

    // The first frame that arrives after the inference is the one that gets processed.
    scheduler.complete(1);
    expect(scheduler.snapshot).toMatchObject({ inFlight: 0, pending: 0, completed: 1 });
    scheduler.offer(afterInference, timestamp);
    expect(sent).toEqual([1, 2]);
    expect(afterInference.closeCount).toBe(0);
  });

  it("keeps in-flight and pending at one or less under both policies during a burst", () => {
    for (const policy of ["hold", "drop"] as const) {
      const scheduler = new LatestFrameScheduler<FakeFrame>(() => undefined, policy);
      for (let index = 0; index < 1_000; index += 1) {
        scheduler.offer(new FakeFrame(), timestamp);
        expect(scheduler.snapshot.inFlight, policy).toBeLessThanOrEqual(1);
        expect(scheduler.snapshot.pending, policy).toBeLessThanOrEqual(1);
      }
      const snapshot = scheduler.snapshot;
      expect(snapshot.captured, policy).toBe(1_000);
      // Every captured frame is either sent, held for later, replaced, or dropped. None leak.
      expect(snapshot.sent + snapshot.pending + snapshot.replaced + snapshot.dropped, policy).toBe(1_000);
      expect(policy === "drop" ? snapshot.replaced : snapshot.dropped, policy).toBe(0);
    }
  });

  it("closes pending and future frames when stopped", () => {
    const scheduler = new LatestFrameScheduler<FakeFrame>(() => undefined);
    const pending = new FakeFrame();
    const afterStop = new FakeFrame();
    scheduler.offer(new FakeFrame(), timestamp);
    scheduler.offer(pending, timestamp);
    scheduler.stop();
    scheduler.offer(afterStop, timestamp);
    expect(pending.closeCount).toBe(1);
    expect(afterStop.closeCount).toBe(1);
  });
});
