import { describe, expect, it } from "vitest";
import {
  P1_CONTROLLED_TRIALS,
  P1_FIVE_GESTURE_PROTOCOL,
  P1_PORTRAIT_THREE_PROTOCOL,
  P1_REGRESSION_THREE_PROTOCOL,
  P1_REMAINING_TWO_PROTOCOL,
  type P1Gesture,
} from "../src/poc/phase1-protocol";
import { compareP1Sessions } from "../src/testing/p1-session-comparison";
import {
  findingCodes as codes,
  parseSession as parse,
  protocolOf,
  resultsOf,
  sessionDocument,
} from "./helpers/p1-fixtures";
import { deviceInfo } from "./helpers/technical-snapshot";

// Sessions exported by the real runner (schema v5 and later), grouped by the rule they check.
// Older hand-built files are covered in p1-session-comparison-legacy.test.ts.

/** The 30-trial, 3-input Bloom session saved as schema v4, before the five-gesture procedure. */
function threeInputDocument(sessionId: string): Record<string, unknown> {
  const document = sessionDocument(sessionId, P1_CONTROLLED_TRIALS.slice(0, 30), { successFor: () => 8 });
  document.schemaVersion = 4;
  document.gestureVocabulary = { thirdGesture: "bloom" };
  return document;
}

describe("reading one session", () => {
  it("round-trips a complete 50-trial export and keeps candidates out of the controlled criterion", () => {
    const document = sessionDocument("five-a", P1_FIVE_GESTURE_PROTOCOL, { successFor: () => 8 });
    const session = parse(document, "five-a.json");

    expect(document).toMatchObject({
      gestureVocabulary: {
        thirdGesture: "bloom",
        gestures: ["air-tap", "ribbon-swipe", "bloom", "lift", "spotlight"],
        candidateGestures: ["lift", "spotlight"],
      },
      protocol: { id: "p1-five-gesture-50", trialsPerGesture: 10, total: 50 },
    });
    expect(session).toMatchObject({
      protocolId: "p1-five-gesture-50",
      completed: 50,
      total: 50,
      candidateGestures: ["lift", "spotlight"],
      dataComplete: true,
      controlledCriterionCandidate: true,
    });
    expect(session.gestures.lift.success).toBe(8);
    expect(session.gestures.spotlight.success).toBe(8);
    expect(session.findings).toEqual([]);
  });

  it("records what the 20-trial and the 9-trial procedures actually ran", () => {
    expect(sessionDocument("remaining", P1_REMAINING_TWO_PROTOCOL)).toMatchObject({
      gestureVocabulary: { gestures: ["ribbon-swipe", "bloom"], candidateGestures: [] },
      protocol: { id: "p1-remaining-two-20", trialsPerGesture: 10, total: 20 },
    });
    expect(sessionDocument("regression", P1_REGRESSION_THREE_PROTOCOL)).toMatchObject({
      gestureVocabulary: { gestures: ["air-tap", "lift", "spotlight"], candidateGestures: ["lift", "spotlight"] },
      protocol: { id: "p1-regression-three-9", trialsPerGesture: 3, total: 9 },
    });
  });

  it("accepts the upright-phone 30-trial session and shows ななめリフト, never alone as a pass candidate", () => {
    const document = sessionDocument("portrait", P1_PORTRAIT_THREE_PROTOCOL, {
      successFor: (gesture) => (gesture === "diagonal-lift" ? 7 : 10),
    });
    const session = parse(document);

    expect(document).toMatchObject({
      gestureVocabulary: {
        gestures: ["ribbon-swipe", "lift", "diagonal-lift"],
        candidateGestures: ["lift", "diagonal-lift"],
      },
      protocol: { id: "p1-portrait-three-30", trialsPerGesture: 10, total: 30 },
    });
    expect(session).toMatchObject({
      protocolId: "p1-portrait-three-30",
      protocolLabel: "縦向き3動作・30試行",
      trialsPerGesture: 10,
      successThreshold: 8,
      sessionGestures: ["ribbon-swipe", "lift", "diagonal-lift"],
      candidateGestures: ["lift", "diagonal-lift"],
      completed: 30,
      total: 30,
      dataComplete: true,
      controlledCriterionCandidate: false,
    });
    expect(session.gestures["diagonal-lift"].success).toBe(7);
    // Bloom was never run here, so it must not read as 0/10.
    expect(session.gestures.bloom.completed).toBe(0);
    const reason = session.findings.find(({ code }) => code === "protocol-not-criterion");
    expect(reason).toMatchObject({ severity: "info" });
    expect(reason?.message).toContain("3入力");
    // A candidate short of 8/10 is information, not an error.
    expect(codes(session.findings)).toContain("diagonal-lift-candidate-under-8");
    expect(session.findings.filter(({ severity }) => severity !== "info")).toEqual([]);
    expect(codes(compareP1Sessions([session]).findings)).toContain("candidate-gestures");
  });

  it("accepts a 20-trial session and shows its two rates, but never alone as a pass candidate", () => {
    const session = parse(sessionDocument("remaining", P1_REMAINING_TWO_PROTOCOL, {
      successFor: (gesture) => (gesture === "bloom" ? 9 : 10),
    }));

    expect(session).toMatchObject({
      protocolId: "p1-remaining-two-20",
      trialsPerGesture: 10,
      successThreshold: 8,
      sessionGestures: ["ribbon-swipe", "bloom"],
      completed: 20,
      total: 20,
      dataComplete: true,
      controlledCriterionCandidate: false,
    });
    expect(session.gestures["ribbon-swipe"].success).toBe(10);
    expect(session.gestures.bloom.success).toBe(9);
    // Air-tap was never run here, so it must not read as 0/10.
    expect(session.gestures["air-tap"].completed).toBe(0);
    const reason = session.findings.find(({ code }) => code === "protocol-not-criterion");
    expect(reason).toMatchObject({ severity: "info" });
    expect(reason?.message).toContain("3入力");
    // Nothing is reported as broken: the 20-trial procedure is a complete procedure of its own.
    expect(session.findings.filter(({ severity }) => severity !== "info")).toEqual([]);
  });

  it("accepts a 9-trial regression session and treats all three successes as the target", () => {
    const clean = parse(sessionDocument("regression-clean", P1_REGRESSION_THREE_PROTOCOL));
    const broken = parse(sessionDocument("regression-broken", P1_REGRESSION_THREE_PROTOCOL, {
      successFor: (gesture) => (gesture === "air-tap" ? 2 : 3),
    }));

    expect(clean).toMatchObject({
      protocolId: "p1-regression-three-9",
      trialsPerGesture: 3,
      successThreshold: 3,
      completed: 9,
      total: 9,
      dataComplete: true,
      controlledCriterionCandidate: false,
    });
    expect(clean.findings.filter(({ severity }) => severity !== "info")).toEqual([]);
    expect(codes(broken.findings)).toContain("air-tap-under-controlled");
    expect(broken.findings.find(({ code }) => code === "air-tap-under-controlled")?.message).toContain("2/3");
  });

  it("reads whole-session performance from schema v6 and leaves it unrecorded for v5", () => {
    const withPerformance = sessionDocument("six-a", P1_FIVE_GESTURE_PROTOCOL);
    withPerformance.performance = {
      histogramBucketMs: 1,
      longTaskSupported: true,
      session: {
        trackingHz: 24,
        inferenceP50Ms: 18,
        inferenceP95Ms: 42,
        inferenceMaxMs: 130,
        frameAgeP50Ms: 70,
        frameAgeP95Ms: 110,
        cameraFps: 29,
        twoHandCoverage: 0.9,
        durationMs: 600_000,
        longTask: { supported: true, count: 12, totalMs: 900, maxMs: 180 },
      },
      blocks: [{ blockIndex: 1 }, { blockIndex: 2 }, { blockIndex: 3 }, { blockIndex: 4 }, { blockIndex: 5 }],
    };
    const six = parse(withPerformance, "six-a.json");

    expect(six.sessionWide).toMatchObject({
      trackingHz: 24,
      inferenceP95Ms: 42,
      frameAgeP95Ms: 110,
      cameraFps: 29,
      blockCount: 5,
      longTaskCount: 12,
      longTaskTotalMs: 900,
    });
    // The whole-session block is a record only: the recent-window values still decide the criterion.
    expect(six.trackingHz).toBe(25);
    expect(six.controlledCriterionCandidate).toBe(true);

    // The same session saved by the earlier build: the new items read as 記録なし.
    const asVersion5 = sessionDocument("five-e", P1_FIVE_GESTURE_PROTOCOL);
    asVersion5.schemaVersion = 5;
    delete asVersion5.performance;
    delete asVersion5.environment;
    delete asVersion5.trialEnvironments;
    delete asVersion5.measurementNotes;
    const five = parse(asVersion5, "five-e.json");

    expect(five.schemaVersion).toBe(5);
    expect(five.sessionWide).toBeNull();
    expect(five.dataComplete).toBe(true);
    expect(five.controlledCriterionCandidate).toBe(true);
  });
});

describe("the controlled criterion of one session", () => {
  it("does not make a session a candidate when Bloom is at 7/10, however strong the candidate gestures are", () => {
    const session = parse(sessionDocument("bloom-7", P1_FIVE_GESTURE_PROTOCOL, {
      successFor: (gesture) => (gesture === "bloom" ? 7 : gesture === "lift" || gesture === "spotlight" ? 10 : 8),
    }));

    expect(session).toMatchObject({ dataComplete: true, controlledCriterionCandidate: false });
    expect(codes(session.findings)).toContain("bloom-under-controlled");
  });

  it("accepts false triggers of the candidate gestures as a consistent record", () => {
    const session = parse(sessionDocument("candidate-false-triggers", P1_FIVE_GESTURE_PROTOCOL, {
      falseTriggerOrdinals: [31, 45],
    }));

    expect(session).toMatchObject({ dataComplete: true, controlledCriterionCandidate: true });
    expect(session.gestures.lift.falseTrigger).toBe(1);
    expect(session.gestures.spotlight.falseTrigger).toBe(1);
  });

  it("flags each part of a v5 procedure record that does not match the five-gesture protocol", () => {
    const cases: Array<[string, (document: Record<string, unknown>) => void]> = [
      ["protocol-id-unknown", (document) => { protocolOf(document).id = "p1-custom"; }],
      ["trials-per-gesture", (document) => { protocolOf(document).trialsPerGesture = 5; }],
      ["v5-blocks-incomplete", (document) => { delete protocolOf(document).blocks; }],
      ["v5-attempt-missing", (document) => { for (const result of resultsOf(document)) delete result.attempt; }],
      ["v5-spotlight-variants", (document) => {
        for (const result of resultsOf(document).slice(40)) {
          (result.trial as Record<string, unknown>).spotlightVariant = "left-up-right-down";
        }
      }],
    ];
    for (const [code, mutate] of cases) {
      const document = sessionDocument(code, P1_FIVE_GESTURE_PROTOCOL);
      mutate(document);
      const session = parse(document);

      expect(codes(session.findings), code).toContain(code);
      expect(session.dataComplete, code).toBe(true);
      expect(session.controlledCriterionCandidate, code).toBe(false);
    }
  });

  it("reports a missing candidate vocabulary and a missing protocol ID as separate errors", () => {
    const vocabulary = sessionDocument("vocabulary", P1_FIVE_GESTURE_PROTOCOL);
    vocabulary.gestureVocabulary = { thirdGesture: "bloom", gestures: ["air-tap", "ribbon-swipe", "bloom", "lift"] };
    const protocolId = sessionDocument("protocol-id", P1_FIVE_GESTURE_PROTOCOL);
    protocolOf(protocolId).id = "";

    expect(parse(vocabulary).findings).toContainEqual(expect.objectContaining({
      code: "gesture-vocabulary-candidates",
      severity: "error",
    }));
    expect(parse(vocabulary).dataComplete).toBe(false);
    expect(parse(protocolId).findings).toContainEqual(expect.objectContaining({ code: "protocol-id-missing", severity: "error" }));
    expect(parse(protocolId).dataComplete).toBe(false);
  });

  it("keeps a session that fell back from GPU to CPU apart from GPU sessions", () => {
    const cpu = parse(sessionDocument("iphone", P1_FIVE_GESTURE_PROTOCOL, {
      technical: { userAgent: "iphone-agent", delegate: "CPU" },
    }));
    const result = compareP1Sessions([parse(sessionDocument("android", P1_FIVE_GESTURE_PROTOCOL)), cpu]);

    expect(cpu.controlledCriterionCandidate).toBe(false);
    expect(codes(cpu.findings)).toContain("delegate-fallback");
    expect(result.controlledCriterionCandidate).toBe(false);
    expect(codes(result.findings)).toContain("mixed-delegates");
    expect(result.nextAction).toContain("CPU");
  });
});

describe("comparing sessions", () => {
  it("reports weak candidate gestures as information and leaves two devices a criterion candidate without auto-pass", () => {
    const weakCandidates = (gesture: P1Gesture): number => (gesture === "lift" || gesture === "spotlight" ? 5 : 8);
    const android = parse(sessionDocument("android", P1_FIVE_GESTURE_PROTOCOL, { successFor: weakCandidates }));
    const iphone = parse(sessionDocument("iphone", P1_FIVE_GESTURE_PROTOCOL, {
      successFor: weakCandidates,
      technical: { userAgent: "iphone-agent" },
    }));

    expect(android.controlledCriterionCandidate).toBe(true);
    expect(android.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "lift-candidate-under-8", severity: "info" }),
      expect.objectContaining({ code: "spotlight-candidate-under-8", severity: "info" }),
    ]));
    const result = compareP1Sessions([android, iphone]);
    expect(result.controlledCriterionCandidate).toBe(true);
    expect(codes(result.findings)).toContain("candidate-gestures");
    expect(result.findings.find(({ code }) => code === "controlled-candidate")?.message).toContain("最終判定");
    expect(result.nextAction).toContain("合格／要改善／方針転換");
  });

  it("counts a session saved twice as one session", () => {
    const first = sessionDocument("android", P1_FIVE_GESTURE_PROTOCOL);
    const second = { ...first, createdAtIso: "2026-09-19T02:00:00.000Z" };
    const result = compareP1Sessions([parse(first, "android.json"), parse(second, "android (1).json")]);

    expect(result.controlledCriterionCandidate).toBe(false);
    expect(codes(result.findings)).toContain("duplicate-sessions");
    expect(result.nextAction).toContain("もう一方の対象端末");
  });

  it("suspects one device behind two sessions by the model, or by the user agent without one", () => {
    const withModel = (model: string) => ({ device: deviceInfo({ model }) });
    const pixel = parse(sessionDocument("pixel", P1_FIVE_GESTURE_PROTOCOL, { technical: withModel("Pixel 7") }));
    const pixelAgain = parse(sessionDocument("pixel-2", P1_FIVE_GESTURE_PROTOCOL, { technical: withModel("Pixel 7") }));
    const xperia = parse(sessionDocument("xperia", P1_FIVE_GESTURE_PROTOCOL, { technical: withModel("SO-51C") }));

    expect(pixel.deviceModel).toBe("Pixel 7");
    // The same user agent, different models: not treated as one device.
    expect(codes(compareP1Sessions([pixel, xperia]).findings)).not.toContain("same-device-suspected");
    expect(codes(compareP1Sessions([pixel, pixelAgain]).findings)).toContain("same-device-suspected");
    // Without a model the check falls back to the user agent.
    const sameAgent = compareP1Sessions([
      parse(sessionDocument("first", P1_FIVE_GESTURE_PROTOCOL)),
      parse(sessionDocument("second", P1_FIVE_GESTURE_PROTOCOL)),
    ]);
    expect(codes(sameAgent.findings)).toContain("same-device-suspected");
    expect(sameAgent.controlledCriterionCandidate).toBe(false);
    expect(sameAgent.nextAction).toContain("別の対象端末");
  });

  it("does not merge sessions of different procedures into one table", () => {
    const five = parse(sessionDocument("five", P1_FIVE_GESTURE_PROTOCOL, {
      technical: { userAgent: "iphone-agent" },
    }), "five.json");
    const threeInput = parse(threeInputDocument("bloom-30"), "bloom-30.json");
    const remaining = parse(sessionDocument("remaining", P1_REMAINING_TWO_PROTOCOL), "remaining.json");

    expect(threeInput).toMatchObject({ schemaVersion: 4, protocolId: "p1-bloom-30", total: 30, dataComplete: true });
    for (const [other, advice] of [[threeInput, "5動作・50試行"], [remaining, "試験手順ごとに分け"]] as const) {
      const result = compareP1Sessions([other, five]);
      expect(codes(result.findings), other.protocolId).toContain("mixed-protocols");
      expect(result.controlledCriterionCandidate, other.protocolId).toBe(false);
      expect(result.nextAction, other.protocolId).toContain(advice);
    }
  });

  it("does not merge a 50-trial session labeled with the 30-trial ID into the 30-trial procedure", () => {
    const mislabeled = sessionDocument("five", P1_FIVE_GESTURE_PROTOCOL);
    protocolOf(mislabeled).id = "p1-bloom-30";
    const result = compareP1Sessions([parse(mislabeled), parse(threeInputDocument("bloom-30"))]);

    expect(codes(result.findings)).toContain("mixed-protocols");
    expect(result.controlledCriterionCandidate).toBe(false);
  });

  it("keeps sessions measured with different frame pipelines out of one condition", () => {
    const hold = parse(sessionDocument("hold", P1_REMAINING_TWO_PROTOCOL), "hold.json");
    const drop = parse(sessionDocument("drop", P1_REMAINING_TWO_PROTOCOL, {
      technical: { pendingPolicy: "drop", frameSourceOverride: "rvfc", droppedFrames: 812 },
    }), "drop.json");

    expect(hold).toMatchObject({ frameSourceOverride: "auto", pendingPolicy: "hold" });
    expect(drop).toMatchObject({ frameSourceOverride: "rvfc", pendingPolicy: "drop" });
    const result = compareP1Sessions([hold, drop]);
    expect(codes(result.findings)).toEqual(expect.arrayContaining(["mixed-frame-sources", "mixed-pending-policies"]));
    expect(result.controlledCriterionCandidate).toBe(false);
  });

  it("asks for the current procedure when only an old 30-trial session is loaded", () => {
    // The current app no longer always runs 50 trials, so the wording names no trial count.
    const result = compareP1Sessions([parse(threeInputDocument("bloom-30"))]);

    expect(result.nextAction).toBe("現行の試験手順で、両方の対象端末を同じビルドとプロファイルで測る");
  });
});
