import { describe, expect, it } from "vitest";
import {
  compareP1Sessions,
  parseP1SessionForComparison,
} from "../src/testing/p1-session-comparison";

describe("P1 session comparison", () => {
  it("accepts a complete schema v3 session and preserves experiment metadata", () => {
    const session = parseP1SessionForComparison(
      JSON.stringify(p1Document()),
      "android.json",
    );

    expect(session).toMatchObject({
      sessionId: "session-a",
      appBuildId: "build-a",
      experimentProfileId: "baseline-gpu-640x480-60",
      completed: 30,
      total: 30,
      dataComplete: true,
      controlledCriterionCandidate: true,
      requestedCamera: "640×480 @ 30–60fps",
      actualCamera: "640×480 @ 30fps",
    });
    expect(session.findings).toEqual([]);
  });

  it("accepts schema v4 only when Bloom is explicitly declared as the third input", () => {
    const session = parseP1SessionForComparison(
      JSON.stringify(p1Document({ schemaVersion: 4, thirdGesture: "bloom" })),
      "bloom.json",
    );

    expect(session).toMatchObject({
      schemaVersion: 4,
      thirdGesture: "bloom",
      dataComplete: true,
      controlledCriterionCandidate: true,
    });
    expect(session.gestures.bloom.success).toBe(8);
  });

  it("reports incomplete counts, outcome mismatch, duplicate trials, and privacy errors", () => {
    const document = p1Document() as MutableDocument;
    const airTap = document.summary.byGesture["air-tap"]!;
    airTap.completed = 9;
    airTap.unclassified = 2;
    document.protocol.completed = 29;
    document.protocol.results[1]!.trial.ordinal = 1;
    document.privacy.includesAudio = true;

    const session = parseP1SessionForComparison(JSON.stringify(document), "broken.json");
    const codes = session.findings.map(({ code }) => code);
    expect(codes).toEqual(expect.arrayContaining([
      "air-tap-count",
      "air-tap-outcome-total",
      "protocol-count",
      "result-count",
      "duplicate-trial",
      "raw-media-privacy",
    ]));
    expect(session.dataComplete).toBe(false);
  });

  it("rejects a summary that does not match the recorded trial outcomes", () => {
    const document = p1Document() as MutableDocument;
    document.protocol.results[0]!.outcome = "tracking-loss";
    document.protocol.falseTriggers.push({ gestureType: "clap" });

    const session = parseP1SessionForComparison(JSON.stringify(document), "mismatch.json");

    expect(session.findings.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "air-tap-summary-results-mismatch",
      "clap-summary-results-mismatch",
      "false-trigger-summary-mismatch",
    ]));
    expect(session.dataComplete).toBe(false);
    expect(session.controlledCriterionCandidate).toBe(false);
  });

  it("marks two same-condition sessions as a controlled criterion candidate without auto-pass", () => {
    const first = parseP1SessionForComparison(JSON.stringify(p1Document()), "android.json");
    const second = parseP1SessionForComparison(JSON.stringify(p1Document({
      sessionId: "session-b",
      userAgent: "iphone-test-agent",
    })), "iphone.json");
    const result = compareP1Sessions([first, second]);

    expect(result.controlledCriterionCandidate).toBe(true);
    expect(result.findings.find(({ code }) => code === "controlled-candidate")?.message)
      .toContain("最終判定");
    expect(result.nextAction).toContain("合格／要改善／方針転換");
  });

  it("keeps mixed profiles separate and prioritizes processing load when metrics are low", () => {
    const baseline = parseP1SessionForComparison(JSON.stringify(p1Document({
      trackingHz: 8.4,
      frameAgeP95Ms: 316.6,
    })), "baseline.json");
    const comparison = parseP1SessionForComparison(JSON.stringify(p1Document({
      sessionId: "session-b",
      profileId: "gpu-640x480-30",
    })), "comparison.json");
    const result = compareP1Sessions([baseline, comparison]);

    expect(result.controlledCriterionCandidate).toBe(false);
    expect(result.findings.map(({ code }) => code)).toContain("mixed-profiles");
    expect(result.nextAction).toContain("MediaPipe処理負荷");
  });

  it("reads schema v2 summaries but warns when profile metadata is unavailable", () => {
    const document = p1Document() as MutableDocument;
    document.schemaVersion = 2;
    delete document.technicalSnapshot.experimentProfileId;
    delete document.privacy.includesReplayFrames;
    const session = parseP1SessionForComparison(JSON.stringify(document), "legacy.json");

    expect(session.schemaVersion).toBe(2);
    expect(session.dataComplete).toBe(true);
    expect(session.findings.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "profile-missing",
      "legacy-schema",
    ]));
  });

  it("does not combine legacy clap and current Bloom sessions", () => {
    const legacy = parseP1SessionForComparison(JSON.stringify(p1Document()), "legacy-clap.json");
    const bloom = parseP1SessionForComparison(
      JSON.stringify(p1Document({ sessionId: "session-b", schemaVersion: 4, thirdGesture: "bloom" })),
      "bloom.json",
    );

    const result = compareP1Sessions([legacy, bloom]);

    expect(result.controlledCriterionCandidate).toBe(false);
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "mixed-third-gestures" }),
    ]));
    expect(result.nextAction).toContain("旧clapと新Bloom");
  });
});

interface P1DocumentOptions {
  readonly sessionId?: string;
  readonly schemaVersion?: 2 | 3 | 4;
  readonly thirdGesture?: "clap" | "bloom";
  readonly profileId?: string;
  readonly userAgent?: string;
  readonly trackingHz?: number;
  readonly frameAgeP95Ms?: number;
}

function p1Document(options: P1DocumentOptions = {}): unknown {
  const schemaVersion = options.schemaVersion ?? 3;
  const thirdGesture = options.thirdGesture ?? "clap";
  const gesture = {
    completed: 10,
    success: 8,
    playerMiss: 0,
    machineMiss: 0,
    falseTrigger: 0,
    trackingLoss: 1,
    unclassified: 1,
    manualSkip: 1,
    trialTimeout: 0,
    offsetP50Ms: 0,
    offsetP95Ms: 10,
  };
  return {
    schema: "oto-motion-p1-controlled",
    schemaVersion,
    ...(schemaVersion === 4 ? { gestureVocabulary: { thirdGesture: "bloom" } } : {}),
    createdAtIso: "2026-07-24T00:00:00.000Z",
    session: {
      sessionId: options.sessionId ?? "session-a",
      createdAtIso: "2026-07-24T00:00:00.000Z",
      appVersion: "build-a",
      provider: null,
      notes: "",
    },
    privacy: {
      includesCameraFrames: false,
      includesAudio: false,
      derivedLandmarksOnly: true,
      includesReplayFrames: false,
    },
    protocol: {
      state: "complete",
      activeTrial: null,
      activeTiming: null,
      nextTrial: null,
      completed: 30,
      total: 30,
      results: Array.from({ length: 30 }, (_, index) => {
        const position = index % 10;
        return {
          trial: {
            ordinal: index + 1,
            gesture: index < 10
              ? "air-tap"
              : index < 20
                ? "ribbon-swipe"
                : thirdGesture,
          },
          outcome: position < 8
            ? "success"
            : position === 8
              ? "tracking-loss"
              : "unclassified",
        };
      }),
      falseTriggers: [],
    },
    summary: {
      byGesture: {
        "air-tap": { ...gesture },
        "ribbon-swipe": { ...gesture },
        [thirdGesture]: { ...gesture },
      },
      falseTriggers: 0,
      diagnosticReasonCounts: {},
    },
    technicalSnapshot: {
      appBuildId: "build-a",
      experimentProfileId: options.profileId ?? "baseline-gpu-640x480-60",
      requestedCameraWidth: 640,
      requestedCameraHeight: 480,
      requestedFrameRateMin: 30,
      requestedFrameRateIdeal: 60,
      actualCameraWidth: 640,
      actualCameraHeight: 480,
      actualCameraFrameRate: 30,
      requestedDelegate: "GPU",
      delegate: "GPU",
      requestedModelId: "model-a",
      modelId: "model-a",
      userAgent: options.userAgent ?? "android-test-agent",
      viewport: "844 × 390",
      trackingHz: options.trackingHz ?? 25,
      inferenceP95Ms: 40,
      frameAgeP95Ms: options.frameAgeP95Ms ?? 100,
      twoHandCoverage: 0.95,
      inFlightFrames: 0,
      pendingFrames: 0,
    },
  };
}

interface MutableDocument {
  schemaVersion: number;
  privacy: {
    includesAudio: boolean;
    includesReplayFrames?: boolean;
  };
  protocol: {
    completed: number;
    falseTriggers: Array<{ gestureType: string }>;
    results: Array<{
      trial: {
        ordinal: number;
        gesture: string;
      };
      outcome: string;
    }>;
  };
  summary: {
    byGesture: Record<string, {
      completed: number;
      unclassified: number;
    }>;
  };
  technicalSnapshot: {
    experimentProfileId?: string;
  };
}
