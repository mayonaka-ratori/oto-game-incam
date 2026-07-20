import type { GestureEvent, GestureRejection } from "../gestures/gesture-types";
import type { LandmarkReplayDocument } from "../replay/landmark-replay";
import type { P1RunnerSnapshot } from "./phase1-protocol";
import type { P1Gesture, P1Outcome } from "./phase1-protocol";
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

export interface Phase1SessionDocument {
  readonly schema: "oto-motion-p1-controlled";
  readonly schemaVersion: 2;
  readonly createdAtIso: string;
  readonly privacy: {
    readonly includesCameraFrames: false;
    readonly includesAudio: false;
    readonly derivedLandmarksOnly: true;
  };
  readonly protocol: P1RunnerSnapshot;
  readonly summary: Phase1ProtocolSummary;
  readonly gestureEvents: readonly GestureEvent[];
  readonly rejections: readonly GestureRejection[];
  readonly replay: LandmarkReplayDocument;
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
  readonly offsetP50Ms: number | null;
  readonly offsetP95Ms: number | null;
}

export interface Phase1ProtocolSummary {
  readonly byGesture: Readonly<Record<P1Gesture, Phase1GestureSummary>>;
  readonly falseTriggers: number;
}

export function createPhase1SessionDocument(
  protocol: P1RunnerSnapshot,
  events: readonly GestureEvent[],
  rejections: readonly GestureRejection[],
  replay: LandmarkReplayDocument,
  technicalSummary: Phase1TechnicalSummary,
  technicalSnapshot: DeviceTechnicalSnapshot,
  now = new Date(),
): Phase1SessionDocument {
  return {
    schema: "oto-motion-p1-controlled",
    schemaVersion: 2,
    createdAtIso: now.toISOString(),
    privacy: {
      includesCameraFrames: false,
      includesAudio: false,
      derivedLandmarksOnly: true,
    },
    protocol,
    summary: summarizeProtocol(protocol),
    gestureEvents: [...events],
    rejections: [...rejections],
    replay,
    technicalSummary,
    technicalSnapshot,
  };
}

export function summarizeProtocol(protocol: P1RunnerSnapshot): Phase1ProtocolSummary {
  return {
    byGesture: {
      "air-tap": summarizeGesture(protocol, "air-tap"),
      "ribbon-swipe": summarizeGesture(protocol, "ribbon-swipe"),
      clap: summarizeGesture(protocol, "clap"),
    },
    falseTriggers: protocol.falseTriggers.length,
  };
}

function summarizeGesture(protocol: P1RunnerSnapshot, gesture: P1Gesture): Phase1GestureSummary {
  const results = protocol.results.filter((result) => result.trial.gesture === gesture);
  const count = (outcome: P1Outcome): number => results.filter((result) => result.outcome === outcome).length;
  const offsets = results.flatMap((result) => result.offsetMs === null ? [] : [result.offsetMs]);
  return {
    completed: results.length,
    success: count("success"),
    playerMiss: count("player-miss"),
    machineMiss: count("machine-miss"),
    falseTrigger: protocol.falseTriggers.filter((event) => event.gestureType === gesture).length,
    trackingLoss: count("tracking-loss"),
    unclassified: count("unclassified"),
    offsetP50Ms: percentile(offsets, 0.5),
    offsetP95Ms: percentile(offsets, 0.95),
  };
}
