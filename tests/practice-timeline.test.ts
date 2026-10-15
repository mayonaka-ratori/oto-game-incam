import { describe, expect, it } from "vitest";
import { COUNT_IN_SEC, isRestBeat, PRACTICE_BEAT_SEC, PRACTICE_DURATION_SEC, practiceFrame } from "../src/practice/practice-timeline";

describe("camera-free practice", () => {
  it("keeps the four-beat count-in separate from the exact 30-second song", () => {
    expect(COUNT_IN_SEC).toBe(2.5);
    expect(PRACTICE_DURATION_SEC).toBe(30);
    expect(practiceFrame(0)).toMatchObject({ motion: "right", remainingSec: 30, beatInPhrase: 0 });
    expect(practiceFrame(29.9)).toMatchObject({ motion: "return", nextLabel: "おしまい", beatInPhrase: 7 });
    expect(practiceFrame(30).remainingSec).toBe(0);
  });

  it("gives the arms two real rests and brings them home before the next move", () => {
    for (const beat of [16, 36]) {
      const start = practiceFrame(beat * PRACTICE_BEAT_SEC);
      expect(start.motion).toBe("rest");
      expect(start.phraseBeats).toBe(4);
      expect(start.handOffset).toEqual({ x: 0, y: 0 });
      expect(practiceFrame((beat + 2) * PRACTICE_BEAT_SEC).handOffset.y).toBeGreaterThan(30);
      const after = practiceFrame((beat + 4) * PRACTICE_BEAT_SEC);
      expect(after.handOffset).toEqual({ x: 0, y: 0 });
      expect(after.motion).not.toBe("rest");
    }
    for (let beat = 0; beat < 48; beat++) {
      expect(isRestBeat(beat)).toBe(practiceFrame(beat * PRACTICE_BEAT_SEC).motion === "rest");
    }
  });

  it("keeps returning motions continuous and previews the actual next instruction", () => {
    for (let beat = 2; beat < 48; beat += 2) {
      const boundary = beat * PRACTICE_BEAT_SEC;
      const before = practiceFrame(boundary - 0.00001);
      const after = practiceFrame(boundary);
      expect(Math.hypot(before.handOffset.x - after.handOffset.x, before.handOffset.y - after.handOffset.y)).toBeLessThan(0.01);
      if (before.motion !== after.motion) expect(before.nextLabel).toBe(after.label);
    }
  });
});
