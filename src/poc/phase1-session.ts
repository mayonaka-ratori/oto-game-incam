import type { GestureEvent } from "../gestures/gesture-types";
import type { LandmarkReplayDocumentV2, LandmarkReplaySession } from "../replay/landmark-replay";
import type { P1Gesture, P1Outcome, P1RunnerSnapshot } from "./phase1-protocol";
import { percentile } from "../metrics/statistics";
import type { DeviceTechnicalSnapshot } from "../metrics/device-technical-snapshot";

export interface Phase1TechnicalSummary {
  readonly inferenceP50Ms: number | null;
  readonly inferenceP95Ms: number | null;
  readonly trackingHz: number | null;
  readonly frameAgeP95Ms: number | null;
  readonly oneHandCoverage: number | null;
  readonly twoHandCoverage: number | null;
  readonly idConflictCount: number;
}

export interface P1TrialDiagnosticRecord {
  readonly trialId: string;
  readonly ordinal: number;
  readonly timeMs: number;
  readonly kind: "rejection" | "tracking-gap" | "identity-conflict";
  readonly handIds: readonly string[];
  readonly reasonCodes: readonly string[];
}

export interface Phase1SessionDocument {
  readonly schema: "oto-motion-p1-controlled";
  readonly schemaVersion: 3;
  readonly createdAtIso: string;
  readonly session: LandmarkReplaySession;
  readonly privacy: {
    readonly includesCameraFrames: false;
    readonly includesAudio: false;
    readonly derivedLandmarksOnly: true;
    readonly includesReplayFrames: false;
  };
  readonly protocol: P1RunnerSnapshot;
  readonly summary: Phase1ProtocolSummary;
  readonly gestureEvents: readonly GestureEvent[];
  readonly trialDiagnostics: readonly P1TrialDiagnosticRecord[];
  readonly replay: {
    readonly available: boolean;
    readonly schema: "oto-motion-landmark-replay";
    readonly schemaVersion: 2;
    readonly suggestedFilename: string;
    readonly frameCount: number;
    readonly trialWindowCount: number;
  };
  readonly technicalSummary: Phase1TechnicalSummary;
  readonly technicalSnapshot: DeviceTechnicalSnapshot;
}

export interface Phase1GestureSummary {
  readonly completed: number;
  readonly success: number;
  readonly playerMiss: number;
  readonly machineMiss: number;
  readonly falseTrigger: number;
  readonly trackingLoss: number;
  readonly unclassified: number;
  readonly manualSkip: number;
  readonly trialTimeout: number;
  readonly offsetP50Ms: number | null;
  readonly offsetP95Ms: number | null;
}

export interface Phase1ProtocolSummary {
  readonly byGesture: Readonly<Record<P1Gesture, Phase1GestureSummary>>;
  readonly falseTriggers: number;
  readonly diagnosticReasonCounts: Readonly<Record<string, number>>;
}

export function createPhase1SessionDocument(
  session: LandmarkReplaySession,
  protocol: P1RunnerSnapshot,
  events: readonly GestureEvent[],
  diagnostics: readonly P1TrialDiagnosticRecord[],
  replay: LandmarkReplayDocumentV2,
  technicalSummary: Phase1TechnicalSummary,
  technicalSnapshot: DeviceTechnicalSnapshot,
  now = new Date(),
): Phase1SessionDocument {
  const suggestedFilename = `${session.sessionId}-diagnostic-replay.json`;
  return {
    schema: "oto-motion-p1-controlled",
    schemaVersion: 3,
    createdAtIso: now.toISOString(),
    session: { ...session, provider: session.provider === null ? null : { ...session.provider } },
    privacy: {
      includesCameraFrames: false,
      includesAudio: false,
      derivedLandmarksOnly: true,
      includesReplayFrames: false,
    },
    protocol,
    summary: summarizeProtocol(protocol, diagnostics),
    gestureEvents: [...events],
    trialDiagnostics: diagnostics.map((record) => ({
      ...record,
      handIds: [...record.handIds],
      reasonCodes: [...record.reasonCodes],
    })),
    replay: {
      available: replay.frames.length > 0,
      schema: "oto-motion-landmark-replay",
      schemaVersion: 2,
      suggestedFilename,
      frameCount: replay.frames.length,
      trialWindowCount: replay.trialWindows.length,
    },
    technicalSummary,
    technicalSnapshot,
  };
}

export function summarizeProtocol(
  protocol: P1RunnerSnapshot,
  diagnostics: readonly P1TrialDiagnosticRecord[] = [],
): Phase1ProtocolSummary {
  return {
    byGesture: {
      "air-tap": summarizeGesture(protocol, "air-tap"),
      "ribbon-swipe": summarizeGesture(protocol, "ribbon-swipe"),
      clap: summarizeGesture(protocol, "clap"),
    },
    falseTriggers: protocol.falseTriggers.length,
    diagnosticReasonCounts: countReasons(diagnostics),
  };
}

function summarizeGesture(protocol: P1RunnerSnapshot, gesture: P1Gesture): Phase1GestureSummary {
  const results = protocol.results.filter((result) => result.trial.gesture === gesture);
  const count = (outcome: P1Outcome): number => results.filter((result) => result.outcome === outcome).length;
  const resolutionCount = (resolution: "manual-skip" | "trial-timeout"): number => (
    results.filter((result) => result.resolution === resolution).length
  );
  const offsets = results.flatMap((result) => result.offsetMs === null ? [] : [result.offsetMs]);
  return {
    completed: results.length,
    success: count("success"),
    playerMiss: count("player-miss"),
    machineMiss: count("machine-miss"),
    falseTrigger: protocol.falseTriggers.filter((event) => event.gestureType === gesture).length,
    trackingLoss: count("tracking-loss"),
    unclassified: count("unclassified"),
    manualSkip: resolutionCount("manual-skip"),
    trialTimeout: resolutionCount("trial-timeout"),
    offsetP50Ms: percentile(offsets, 0.5),
    offsetP95Ms: percentile(offsets, 0.95),
  };
}

function countReasons(diagnostics: readonly P1TrialDiagnosticRecord[]): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const diagnostic of diagnostics) {
    for (const reason of diagnostic.reasonCodes) counts[reason] = (counts[reason] ?? 0) + 1;
  }
  return counts;
}
