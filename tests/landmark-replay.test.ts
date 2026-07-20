import { describe, expect, it } from "vitest";
import {
  LandmarkReplayCursor,
  LandmarkReplayRecorder,
  parseLandmarkReplay,
  parseLandmarkReplayImport,
  serializeLandmarkReplay,
} from "../src/replay/landmark-replay";
import { syntheticHand, trackingFrame } from "./helpers/tracking-fixtures";

const session = {
  sessionId: "session-1",
  createdAtIso: "2026-07-19T00:00:00.000Z",
  appVersion: "test",
  provider: null,
  notes: "synthetic",
};

describe("landmark replay", () => {
  it("round-trips derived landmarks without camera or audio data", () => {
    const recorder = new LandmarkReplayRecorder(session);
    beginTrialWindow(recorder);
    recorder.addFrame(trackingFrame(1, 100, [syntheticHand(0, "left", 0.3)]));
    const document = parseLandmarkReplay(serializeLandmarkReplay(recorder.snapshot()));

    expect(document.privacy).toEqual({
      includesCameraFrames: false,
      includesAudio: false,
      derivedLandmarksOnly: true,
    });
    expect(document.frames[0]!.hands[0]!.landmarks2D).toHaveLength(21);
    expect(document.schemaVersion).toBe(2);
    expect(document.frames[0]!.hands[0]).not.toHaveProperty("landmarksWorld");
    expect(JSON.stringify(document)).not.toContain("data:image");
  });

  it("replays deterministic cloned frames and can reset", () => {
    const recorder = new LandmarkReplayRecorder(session);
    beginTrialWindow(recorder);
    recorder.addFrame(trackingFrame(1, 100, []));
    recorder.addFrame(trackingFrame(2, 130, []));
    const cursor = new LandmarkReplayCursor(recorder.snapshot());
    expect(cursor.next()?.frameId).toBe(1);
    expect(cursor.next()?.frameId).toBe(2);
    expect(cursor.next()).toBeNull();
    cursor.reset();
    expect(cursor.next()?.frameId).toBe(1);
  });

  it("imports replay data nested in an exported P1 session", () => {
    const recorder = new LandmarkReplayRecorder(session);
    beginTrialWindow(recorder);
    recorder.addFrame(trackingFrame(1, 100, []));
    const imported = parseLandmarkReplayImport(JSON.stringify({
      schema: "oto-motion-p1-controlled",
      replay: recorder.snapshot(),
    }));

    expect(imported.session.sessionId).toBe("session-1");
    expect(imported.frames).toHaveLength(1);
  });

  it("keeps version 1 replay import compatibility", () => {
    const legacyFrame = trackingFrame(1, 100, [syntheticHand(0, "left", 0.3)]);
    const imported = parseLandmarkReplay(JSON.stringify({
      schema: "oto-motion-landmark-replay",
      schemaVersion: 1,
      privacy: { includesCameraFrames: false, includesAudio: false, derivedLandmarksOnly: true },
      session,
      frames: [legacyFrame],
    }));

    expect(imported.schemaVersion).toBe(1);
    expect(new LandmarkReplayCursor(imported).next()?.hands[0]?.landmarksWorld).toHaveLength(21);
  });

  it("records only trial windows with pre-roll and resolution metadata", () => {
    const recorder = new LandmarkReplayRecorder(session);
    recorder.addFrame(trackingFrame(1, 0, []));
    recorder.addFrame(trackingFrame(2, 400, []));
    recorder.beginTrial({
      trialId: "trial-1",
      ordinal: 1,
      timing: { preparedAtMs: 500, windowOpenedAtMs: 500, targetTimeMs: null, deadlineTimeMs: 30_500 },
    });
    recorder.addFrame(trackingFrame(3, 500, []));
    recorder.finishTrial({
      trialId: "trial-1",
      resolution: "manual-skip",
      finishedAtMs: 600,
    });
    recorder.addFrame(trackingFrame(4, 700, []));
    const document = recorder.snapshot();

    expect(document.frames.map(({ frameId }) => frameId)).toEqual([1, 2, 3, 4]);
    expect(document.trialWindows[0]).toMatchObject({
      trialId: "trial-1",
      ordinal: 1,
      startFrameIndex: 0,
      endFrameIndex: 3,
      resolution: "manual-skip",
    });
  });

  it("keeps post-roll pending until a frame passes the 500ms boundary", () => {
    const recorder = new LandmarkReplayRecorder(session);
    beginTrialWindow(recorder);
    recorder.addFrame(trackingFrame(1, 100, []));
    recorder.finishTrial({
      trialId: "trial-1",
      resolution: "gesture-event",
      finishedAtMs: 100,
    });
    recorder.addFrame(trackingFrame(2, 600, []));
    expect(recorder.postRollPending).toBe(true);

    recorder.addFrame(trackingFrame(3, 601, []));

    expect(recorder.postRollPending).toBe(false);
    expect(recorder.snapshot().frames.map(({ frameId }) => frameId)).toEqual([1, 2]);
  });

  it("does not carry stale pre-roll into a later trial", () => {
    const recorder = new LandmarkReplayRecorder(session);
    recorder.addFrame(trackingFrame(1, 0, []));
    recorder.beginTrial({
      trialId: "trial-late",
      ordinal: 1,
      timing: { preparedAtMs: 1_000, windowOpenedAtMs: 1_000, targetTimeMs: null, deadlineTimeMs: 31_000 },
    });
    recorder.addFrame(trackingFrame(2, 1_000, []));

    expect(recorder.snapshot().frames.map(({ frameId }) => frameId)).toEqual([2]);
  });

  it("rejects non-monotonic and malformed input", () => {
    const recorder = new LandmarkReplayRecorder(session);
    recorder.addFrame(trackingFrame(1, 100, []));
    expect(() => recorder.addFrame(trackingFrame(2, 99, []))).toThrow(RangeError);
    expect(() => parseLandmarkReplay("{}")) .toThrow(TypeError);
  });
});

function beginTrialWindow(recorder: LandmarkReplayRecorder): void {
  recorder.beginTrial({
    trialId: "trial-1",
    ordinal: 1,
    timing: { preparedAtMs: 0, windowOpenedAtMs: 0, targetTimeMs: null, deadlineTimeMs: 30_000 },
  });
}
