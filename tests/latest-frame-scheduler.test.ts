import { describe, expect, it } from "vitest";
import { LatestFrameScheduler } from "../src/camera/latest-frame-scheduler";

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
