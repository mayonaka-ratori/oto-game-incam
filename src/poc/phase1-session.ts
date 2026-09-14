import type { GestureEvent } from "../gestures/gesture-types";
import {
  LANDMARK_REPLAY_SCHEMA_VERSION,
  type LandmarkReplayDocumentV2,
  type LandmarkReplaySession,
} from "../replay/landmark-replay";
import {
  P1_CANDIDATE_GESTURES,
  type P1Gesture,
  type P1Outcome,
  type P1RunnerSnapshot,
} from "./phase1-protocol";
import { percentile } from "../metrics/statistics";
import type { DeviceTechnicalSnapshot } from "../metrics/device-technical-snapshot";

/** v5: five-gesture protocol with blocks, readiness timing, and pause records. v2-v4 remain readable elsewhere. */
export const P1_SESSION_SCHEMA_VERSION = 5 as const;

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
  /** 1 for the first attempt; larger when a pause abandoned an earlier attempt of the same trial. */
  readonly attempt: number;
  readonly timeMs: number;
  readonly kind: "rejection" | "tracking-gap" | "identity-conflict";
  readonly handIds: readonly string[];
  readonly reasonCodes: readonly string[];
}

export interface Phase1SessionDocument {
  readonly schema: "oto-motion-p1-controlled";
  readonly schemaVersion: typeof P1_SESSION_SCHEMA_VERSION;
  readonly createdAtIso: string;
  readonly gestureVocabulary: {
    /** "clap" only for documents rebuilt from the legacy clap trials. */
    readonly thirdGesture: "bloom" | "clap";
    readonly gestures: readonly P1Gesture[];
    readonly candidateGestures: readonly P1Gesture[];
  };
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
    readonly schemaVersion: typeof LANDMARK_REPLAY_SCHEMA_VERSION;
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
  /** Subset of trialTimeout: the start position never settled, so no count-in was played. */
  readonly readinessTimeout: number;
  /** Subset of trialTimeout: the recognition deadline passed after the count-in. */
  readonly recognitionTimeout: number;
  /** Successful trials that recorded at least one player-motion rejection before the success. */
  readonly trialsWithRejectionBeforeSuccess: number;
  /** Successful trials that lost tracking before the success. Machine-side, so kept apart from rejections. */
  readonly trialsWithTrackingLossBeforeSuccess: number;
  readonly offsetP50Ms: number | null;
  readonly offsetP95Ms: number | null;
  /** Time from showing the trial to a settled start position. Readiness timeouts are excluded; see readinessTimeout. */
  readonly readinessP50Ms: number | null;
  readonly readinessP95Ms: number | null;
}

export interface Phase1ProtocolSummary {
  readonly byGesture: Readonly<Partial<Record<P1Gesture, Phase1GestureSummary>>>;
  readonly falseTriggers: number;
  /** Automatic false triggers of attempts that a pause discarded. Not included in falseTriggers. */
  readonly abandonedFalseTriggers: number;
  /** Reason counts of the attempts that produced results (and of an attempt still in progress). */
  readonly diagnosticReasonCounts: Readonly<Record<string, number>>;
  /** Reason counts of attempts that a pause discarded. */
  readonly abandonedAttemptReasonCounts: Readonly<Record<string, number>>;
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
  const gestures = [...protocol.gestures];
  return {
    schema: "oto-motion-p1-controlled",
    schemaVersion: P1_SESSION_SCHEMA_VERSION,
    createdAtIso: now.toISOString(),
    gestureVocabulary: {
      thirdGesture: gestures.includes("clap") && !gestures.includes("bloom") ? "clap" : "bloom",
      gestures,
      candidateGestures: gestures.filter((gesture) => P1_CANDIDATE_GESTURES.includes(gesture)),
    },
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
      schemaVersion: LANDMARK_REPLAY_SCHEMA_VERSION,
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
  const gestures = [...protocol.gestures];
  for (const result of protocol.results) {
    if (!gestures.includes(result.trial.gesture)) gestures.push(result.trial.gesture);
  }
  const abandonedAttempts = abandonedAttemptCounts(protocol);
  const abandoned = (record: P1TrialDiagnosticRecord): boolean => (
    record.attempt <= (abandonedAttempts.get(record.trialId) ?? 0)
  );
  return {
    byGesture: Object.fromEntries(
      gestures.map((gesture) => [gesture, summarizeGesture(protocol, gesture)]),
    ) as Partial<Record<P1Gesture, Phase1GestureSummary>>,
    falseTriggers: protocol.falseTriggers.length,
    abandonedFalseTriggers: protocol.abandonedFalseTriggers.length,
    diagnosticReasonCounts: countReasons(diagnostics.filter((record) => !abandoned(record))),
    abandonedAttemptReasonCounts: countReasons(diagnostics.filter(abandoned)),
  };
}

function summarizeGesture(protocol: P1RunnerSnapshot, gesture: P1Gesture): Phase1GestureSummary {
  const results = protocol.results.filter((result) => result.trial.gesture === gesture);
  const count = (outcome: P1Outcome): number => results.filter((result) => result.outcome === outcome).length;
  const resolutionCount = (resolution: "manual-skip" | "trial-timeout"): number => (
    results.filter((result) => result.resolution === resolution).length
  );
  const offsets = results.flatMap((result) => result.offsetMs === null ? [] : [result.offsetMs]);
  const readinessDurations = results.flatMap((result) => (
    result.readiness === null || result.readiness.readyAtMs === null
      ? []
      : [result.readiness.readyAtMs - result.readiness.startedAtMs]
  ));
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
    readinessTimeout: results.filter((result) => result.timeoutPhase === "readiness").length,
    recognitionTimeout: results.filter((result) => result.timeoutPhase === "recognition").length,
    trialsWithRejectionBeforeSuccess: results.filter((result) => (
      result.outcome === "success" && result.rejectionCount > 0
    )).length,
    trialsWithTrackingLossBeforeSuccess: results.filter((result) => (
      result.outcome === "success" && result.trackingLossCount > 0
    )).length,
    offsetP50Ms: percentile(offsets, 0.5),
    offsetP95Ms: percentile(offsets, 0.95),
    readinessP50Ms: percentile(readinessDurations, 0.5),
    readinessP95Ms: percentile(readinessDurations, 0.95),
  };
}

/** Attempts 1..n of a trial were discarded when n pauses abandoned that trial. */
function abandonedAttemptCounts(protocol: P1RunnerSnapshot): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const block of protocol.blocks) {
    for (const { abandonedTrialId } of block.pauses) {
      if (abandonedTrialId !== null) counts.set(abandonedTrialId, (counts.get(abandonedTrialId) ?? 0) + 1);
    }
  }
  return counts;
}

function countReasons(diagnostics: readonly P1TrialDiagnosticRecord[]): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const diagnostic of diagnostics) {
    for (const reason of diagnostic.reasonCodes) counts[reason] = (counts[reason] ?? 0) + 1;
  }
  return counts;
}
