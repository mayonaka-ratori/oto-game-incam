import { describe, expect, it } from "vitest";
import { LiftStateMachine } from "../src/gestures/lift-state-machine";
import { SpotlightStateMachine } from "../src/gestures/spotlight-state-machine";
import { trackedFrame, trackedHand } from "./helpers/gesture-fixtures";

function low() {
  return [trackedHand("left", 0.28, 0.72), trackedHand("right", 0.72, 0.72)];
}

function raised(leftY: number, rightY: number, leftX = 0.28, rightX = 0.72) {
  return [trackedHand("left", leftX, leftY), trackedHand("right", rightX, rightY)];
}

describe("LiftStateMachine", () => {
  it("confirms readiness only in the lower start zones", () => {
    const machine = new LiftStateMachine();
    machine.observeReadiness(trackedFrame(0, low()));

    expect(machine.observeReadiness(trackedFrame(179, low())).ready).toBe(false);
    expect(machine.observeReadiness(trackedFrame(180, low()))).toMatchObject({ ready: true, readyAtMs: 180 });
    expect(new LiftStateMachine().observeReadiness(trackedFrame(0, raised(0.4, 0.4))).inZone).toBe(false);
  });

  it("recognizes a parallel raise and interpolates the later threshold crossing", () => {
    const machine = new LiftStateMachine();
    machine.process(trackedFrame(0, low()));
    machine.process(trackedFrame(100, raised(0.62, 0.64)));
    const result = machine.process(trackedFrame(200, raised(0.5, 0.52, 0.29, 0.71)));

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ gestureType: "lift", reasonCodes: ["lift-raised"], handIds: ["left", "right"] });
    expect(result.events[0]?.eventTimeMs).toBeCloseTo(183.33, 1);
    expect(result.events[0]?.quality.syncSpreadMs).toBeCloseTo(16.67, 1);
  });

  it("rejects downward and sideways motion as not upward", () => {
    const down = new LiftStateMachine();
    down.process(trackedFrame(0, low()));
    const sideways = new LiftStateMachine();
    sideways.process(trackedFrame(0, low()));

    expect(down.process(trackedFrame(100, raised(0.78, 0.72))).rejections)
      .toEqual([expect.objectContaining({ gestureType: "lift", reasonCodes: ["lift-not-upward"] })]);
    expect(sideways.process(trackedFrame(100, raised(0.7, 0.7, 0.12))).rejections)
      .toEqual([expect.objectContaining({ reasonCodes: ["lift-not-upward"] })]);
  });

  it("reports insufficient height when the raise stalls and sync expiry when one hand lags", () => {
    const stalled = new LiftStateMachine();
    stalled.process(trackedFrame(0, low()));
    stalled.process(trackedFrame(100, raised(0.66, 0.66)));
    const lagging = new LiftStateMachine();
    lagging.process(trackedFrame(0, low()));
    lagging.process(trackedFrame(100, raised(0.5, 0.7)));

    expect(stalled.process(trackedFrame(1_501, raised(0.64, 0.64))).rejections)
      .toEqual([expect.objectContaining({ reasonCodes: ["lift-distance-insufficient"] })]);
    expect(lagging.process(trackedFrame(600, raised(0.5, 0.66))).rejections)
      .toEqual([expect.objectContaining({ reasonCodes: ["lift-sync-expired"] })]);
  });

  it("keeps waiting in the start position without consuming the Lift duration", () => {
    const machine = new LiftStateMachine();
    machine.process(trackedFrame(0, low()));
    const waitingRejections = [600, 1_200, 1_800].flatMap((timeMs) => (
      machine.process(trackedFrame(timeMs, raised(0.715, 0.72, 0.285))).rejections
    ));
    machine.process(trackedFrame(1_900, raised(0.6, 0.6)));
    const result = machine.process(trackedFrame(2_000, raised(0.5, 0.5)));

    expect(waitingRejections).toEqual([]);
    expect(result.events).toHaveLength(1);
  });

  it("records lift-not-ready once when the window opens outside the start zones", () => {
    const machine = new LiftStateMachine();
    machine.prepare(trackedFrame(0, low()));
    const first = machine.process(trackedFrame(100, raised(0.4, 0.4)));
    const second = machine.process(trackedFrame(200, raised(0.4, 0.4)));

    expect(first.rejections).toEqual([expect.objectContaining({ reasonCodes: ["lift-not-ready"] })]);
    expect(second.rejections).toEqual([]);
  });

  it("continues through a short gap and reports tracking-lost after a long one", () => {
    const machine = new LiftStateMachine();
    machine.process(trackedFrame(0, low()));
    machine.process(trackedFrame(100, raised(0.62, 0.62)));
    const lost = new LiftStateMachine();
    lost.process(trackedFrame(0, low()));
    lost.process(trackedFrame(100, raised(0.62, 0.62)));

    expect(machine.process(trackedFrame(200, [])).rejections).toEqual([]);
    expect(machine.process(trackedFrame(230, raised(0.5, 0.5))).events).toHaveLength(1);
    expect(machine.diagnostic.latestTrackingGap).toMatchObject({ startedAtMs: 200, reacquiredAtMs: 230, durationMs: 30 });
    expect(lost.process(trackedFrame(260, [])).rejections)
      .toEqual([expect.objectContaining({ reasonCodes: ["tracking-lost"] })]);
    expect(lost.diagnostic.rejectionReasonCodes).toEqual(["tracking-lost"]);
  });
});

describe("SpotlightStateMachine", () => {
  const leftUp = () => [trackedHand("left", 0.28, 0.3), trackedHand("right", 0.72, 0.72)];
  const rightUp = () => [trackedHand("left", 0.28, 0.72), trackedHand("right", 0.72, 0.3)];
  const neutral = () => [trackedHand("left", 0.3, 0.5), trackedHand("right", 0.7, 0.5)];

  it("records eventTime at the first frame where both hands entered their zones", () => {
    const machine = new SpotlightStateMachine({ variant: "left-up-right-down" });
    machine.prepare(trackedFrame(0, neutral()));
    machine.process(trackedFrame(100, neutral()));
    machine.process(trackedFrame(200, leftUp()));

    expect(machine.process(trackedFrame(400, leftUp())).events).toHaveLength(0);
    expect(machine.process(trackedFrame(500, leftUp())).events).toEqual([expect.objectContaining({
      gestureType: "spotlight",
      eventTimeMs: 200,
      reasonCodes: ["spotlight-held"],
      quality: { holdDurationMs: 300, spotlightVariant: "left-up-right-down" },
    })]);
    expect(machine.diagnostic).toMatchObject({ entryTimeMs: 200, holdCompletedAtMs: 500, poseBeforeGo: false });
  });

  it("rejects a pose released before the hold time and reports the mirrored pose once", () => {
    const released = new SpotlightStateMachine({ variant: "left-up-right-down" });
    released.process(trackedFrame(0, leftUp()));
    const mirrored = new SpotlightStateMachine({ variant: "left-up-right-down" });
    mirrored.process(trackedFrame(0, rightUp()));

    // A pose change shorter than 60ms is landmark jitter; the release is confirmed once it lasts that long.
    expect(released.process(trackedFrame(150, neutral())).rejections).toEqual([]);
    expect(released.process(trackedFrame(210, neutral())).rejections)
      .toEqual([expect.objectContaining({ reasonCodes: ["spotlight-pose-not-held"] })]);
    expect(mirrored.process(trackedFrame(200, rightUp())).rejections).toEqual([]);
    expect(mirrored.process(trackedFrame(300, rightUp())).rejections)
      .toEqual([expect.objectContaining({ reasonCodes: ["spotlight-wrong-side"] })]);
    expect(mirrored.process(trackedFrame(700, rightUp()))).toMatchObject({ events: [], rejections: [] });
  });

  it("reports both hands at the same level as a wrong zone", () => {
    const machine = new SpotlightStateMachine({ variant: "right-up-left-down" });
    const bothUp = () => [trackedHand("left", 0.28, 0.3), trackedHand("right", 0.72, 0.3)];
    machine.process(trackedFrame(0, bothUp()));

    expect(machine.process(trackedFrame(300, bothUp())).rejections)
      .toEqual([expect.objectContaining({ reasonCodes: ["spotlight-wrong-zone"] })]);
  });

  it("requires a pose formed before GO to be released and formed again", () => {
    const machine = new SpotlightStateMachine({ variant: "left-up-right-down" });
    machine.prepare(trackedFrame(0, leftUp()));

    expect(machine.process(trackedFrame(100, leftUp())).rejections)
      .toEqual([expect.objectContaining({ reasonCodes: ["spotlight-pose-before-go"] })]);
    expect(machine.process(trackedFrame(500, leftUp())).events).toEqual([]);
    machine.process(trackedFrame(600, neutral()));
    machine.process(trackedFrame(700, neutral()));
    machine.process(trackedFrame(800, leftUp()));
    expect(machine.process(trackedFrame(1_100, leftUp())).events).toEqual([expect.objectContaining({ eventTimeMs: 800 })]);
    expect(machine.diagnostic.poseBeforeGo).toBe(true);
  });

  it("keeps the hold through a short gap and reports tracking-lost after a long one", () => {
    const machine = new SpotlightStateMachine({ variant: "right-up-left-down" });
    machine.process(trackedFrame(0, rightUp()));
    const lost = new SpotlightStateMachine({ variant: "right-up-left-down" });
    lost.process(trackedFrame(0, rightUp()));

    expect(machine.process(trackedFrame(60, [trackedHand("left", 0.28, 0.72)])).rejections).toEqual([]);
    machine.process(trackedFrame(120, rightUp()));
    expect(machine.process(trackedFrame(300, rightUp())).events).toEqual([expect.objectContaining({ eventTimeMs: 0 })]);
    expect(machine.diagnostic.latestTrackingGap).toMatchObject({ startedAtMs: 60, reacquiredAtMs: 120, durationMs: 60 });
    expect(lost.process(trackedFrame(100, [])).rejections).toEqual([]);
    expect(lost.process(trackedFrame(200, [])).rejections)
      .toEqual([expect.objectContaining({ reasonCodes: ["tracking-lost"] })]);
  });
});
