import type { GestureEvent } from "../../src/gestures/gesture-types";
import type { DeviceTechnicalSnapshot } from "../../src/metrics/device-technical-snapshot";
import type { Phase1LabEngine } from "../../src/poc/phase1-lab-engine";
import {
  Phase1ControlledRunner,
  type P1Gesture,
  type P1ProtocolDefinition,
  type P1TrialDefinition,
} from "../../src/poc/phase1-protocol";
import { createPhase1SessionDocument } from "../../src/poc/phase1-session";
import { LandmarkReplayRecorder } from "../../src/replay/landmark-replay";
import {
  parseP1SessionForComparison,
  type P1ComparisonSession,
} from "../../src/testing/p1-session-comparison";
import { TECHNICAL_SUMMARY, technicalSnapshot } from "./technical-snapshot";

/** Records the given number of trials as unclassified, to reach a later block quickly. */
export function skipTrials(engine: Phase1LabEngine, count: number): void {
  for (let index = 0; index < count; index += 1) {
    engine.beginNextTrial(null, index);
    engine.recordOutcome("unclassified", [], index);
  }
}

export function gestureEvent(
  gestureType: GestureEvent["gestureType"],
  eventTimeMs: number,
  quality: GestureEvent["quality"] = {},
): GestureEvent {
  return {
    id: `event-${gestureType}-${eventTimeMs}`,
    gestureType,
    eventTimeMs,
    handIds: ["hand-1"],
    confidence: 0.9,
    quality,
    trackingQuality: "observed",
    reasonCodes: ["target-crossed"],
  };
}

/** An event that the runner accepts for the given trial, including its direction or variant. */
export function matchingEvent(trial: P1TrialDefinition, eventTimeMs: number): GestureEvent {
  return gestureEvent(trial.gesture, eventTimeMs, trial.swipeDirection !== undefined
    ? { direction: trial.swipeDirection }
    : trial.spotlightVariant !== undefined
      ? { spotlightVariant: trial.spotlightVariant }
      : trial.diagonalLiftVariant !== undefined
        ? { diagonalLiftVariant: trial.diagonalLiftVariant }
        : {});
}

export interface SessionDocumentOptions {
  /** How many trials of each gesture succeed; the rest time out. Default: all of them. */
  readonly successFor?: (gesture: P1Gesture) => number;
  readonly technical?: Partial<DeviceTechnicalSnapshot>;
  /** Trials, by ordinal, on which a false trigger is recorded before the outcome. */
  readonly falseTriggerOrdinals?: readonly number[];
}

/**
 * Runs the real protocol runner, exports the standard P1 document, and round-trips it through
 * JSON, so a test can change the saved file the way an older build or a broken export would.
 */
export function sessionDocument(
  sessionId: string,
  protocol: P1ProtocolDefinition | readonly P1TrialDefinition[],
  options: SessionDocumentOptions = {},
): Record<string, unknown> {
  const runner = new Phase1ControlledRunner(protocol);
  const trials = "blocks" in protocol ? protocol.trials : protocol;
  const successFor = options.successFor ?? (() => Number.POSITIVE_INFINITY);
  runner.start();
  const seen = new Map<P1Gesture, number>();
  let timeMs = 0;
  for (const trial of trials) {
    const index = seen.get(trial.gesture) ?? 0;
    seen.set(trial.gesture, index + 1);
    runner.beginNextTrial(null, timeMs);
    if (trial.requiresReadiness === true) runner.startRecognition(timeMs + 100, null);
    if (options.falseTriggerOrdinals?.includes(trial.ordinal) === true) {
      runner.recordFalseTrigger(gestureEvent(trial.gesture, timeMs + 150));
    }
    if (index < successFor(trial.gesture)) runner.acceptEvent(matchingEvent(trial, timeMs + 200));
    else runner.timeout(timeMs + 10_100);
    timeMs += 20_000;
  }
  const session = {
    sessionId,
    createdAtIso: "2026-09-19T00:00:00.000Z",
    appVersion: "build-test",
    provider: null,
    notes: "",
  };
  const document = createPhase1SessionDocument(
    session,
    runner.snapshot,
    [],
    [],
    new LandmarkReplayRecorder(session).counts(),
    TECHNICAL_SUMMARY,
    technicalSnapshot(options.technical),
    { now: new Date("2026-09-19T01:00:00.000Z") },
  );
  return JSON.parse(JSON.stringify(document)) as Record<string, unknown>;
}

export function parseSession(document: Record<string, unknown>, fileName = "session.json"): P1ComparisonSession {
  return parseP1SessionForComparison(JSON.stringify(document), fileName);
}

export function findingCodes(findings: readonly { readonly code: string }[]): string[] {
  return findings.map(({ code }) => code);
}

export function protocolOf(document: Record<string, unknown>): Record<string, unknown> {
  return document.protocol as Record<string, unknown>;
}

export function resultsOf(document: Record<string, unknown>): Array<Record<string, unknown>> {
  return protocolOf(document).results as Array<Record<string, unknown>>;
}
