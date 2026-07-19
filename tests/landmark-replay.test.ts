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
    recorder.addFrame(trackingFrame(1, 100, [syntheticHand(0, "left", 0.3)]));
    const document = parseLandmarkReplay(serializeLandmarkReplay(recorder.snapshot()));

    expect(document.privacy).toEqual({
      includesCameraFrames: false,
      includesAudio: false,
      derivedLandmarksOnly: true,
    });
    expect(document.frames[0]!.hands[0]!.landmarks2D).toHaveLength(21);
    expect(JSON.stringify(document)).not.toContain("data:image");
  });

  it("replays deterministic cloned frames and can reset", () => {
    const recorder = new LandmarkReplayRecorder(session);
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
    recorder.addFrame(trackingFrame(1, 100, []));
    const imported = parseLandmarkReplayImport(JSON.stringify({
      schema: "oto-motion-p1-controlled",
      replay: recorder.snapshot(),
    }));

    expect(imported.session.sessionId).toBe("session-1");
    expect(imported.frames).toHaveLength(1);
  });

  it("rejects non-monotonic and malformed input", () => {
    const recorder = new LandmarkReplayRecorder(session);
    recorder.addFrame(trackingFrame(1, 100, []));
    expect(() => recorder.addFrame(trackingFrame(2, 99, []))).toThrow(RangeError);
    expect(() => parseLandmarkReplay("{}")) .toThrow(TypeError);
  });
});
