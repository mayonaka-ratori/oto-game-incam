import { describe, expect, it } from "vitest";
import { HandFeaturePipeline } from "../src/tracking/hand-feature-pipeline";
import { syntheticHand, trackingFrame } from "./helpers/tracking-fixtures";

describe("HandFeaturePipeline", () => {
  it("keeps stable ids when detector order and handedness temporarily flip", () => {
    const pipeline = new HandFeaturePipeline();
    const first = pipeline.process(trackingFrame(1, 0, [
      syntheticHand(0, "left", 0.25),
      syntheticHand(1, "right", 0.75),
    ]));
    const second = pipeline.process(trackingFrame(2, 33, [
      syntheticHand(0, "left", 0.72),
      syntheticHand(1, "right", 0.28),
    ]));

    expect(second.hands[0]!.trackId).toBe(first.hands[1]!.trackId);
    expect(second.hands[1]!.trackId).toBe(first.hands[0]!.trackId);
    expect(second.identityConflictCount).toBe(2);
  });

  it("reuses an id within grace and creates a new id after grace", () => {
    const pipeline = new HandFeaturePipeline({ missingGraceMs: 150 });
    const first = pipeline.process(trackingFrame(1, 0, [syntheticHand(0, "left", 0.3)]));
    pipeline.process(trackingFrame(2, 80, []));
    const reacquired = pipeline.process(trackingFrame(3, 120, [syntheticHand(0, "left", 0.31)]));
    pipeline.process(trackingFrame(4, 300, []));
    const late = pipeline.process(trackingFrame(5, 301, [syntheticHand(0, "left", 0.31)]));

    expect(reacquired.hands[0]!.trackId).toBe(first.hands[0]!.trackId);
    expect(reacquired.hands[0]!.identityReason).toBe("reacquired-within-grace");
    expect(late.hands[0]!.trackId).not.toBe(first.hands[0]!.trackId);
  });

  it("derives velocity from timestamps rather than frame count", () => {
    const fastFrames = new HandFeaturePipeline();
    fastFrames.process(trackingFrame(1, 0, [syntheticHand(0, "left", 0.2)]));
    const at60Hz = fastFrames.process(trackingFrame(2, 20, [syntheticHand(0, "left", 0.22)]));
    const slowFrames = new HandFeaturePipeline();
    slowFrames.process(trackingFrame(1, 0, [syntheticHand(0, "left", 0.2)]));
    const at30Hz = slowFrames.process(trackingFrame(2, 40, [syntheticHand(0, "left", 0.24)]));

    expect(at60Hz.hands[0]!.palmVelocity.x).toBeCloseTo(1);
    expect(at30Hz.hands[0]!.palmVelocity.x).toBeCloseTo(1);
  });

  it("maximizes preserved tracks before minimizing total assignment cost", () => {
    const pipeline = new HandFeaturePipeline({ maximumAssignmentDistance: 0.3 });
    const first = pipeline.process(trackingFrame(1, 0, [
      syntheticHand(0, "unknown", 0.4),
      syntheticHand(1, "unknown", 0.1),
    ]));
    const second = pipeline.process(trackingFrame(2, 33, [
      syntheticHand(0, "unknown", 0.3),
      syntheticHand(1, "unknown", 0.65),
    ]));

    expect(second.hands.map(({ trackId }) => trackId)).toEqual([
      first.hands[1]!.trackId,
      first.hands[0]!.trackId,
    ]);
  });
});
