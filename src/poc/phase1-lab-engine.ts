import { AirTapStateMachine } from "../gestures/air-tap-state-machine";
import { BloomStateMachine } from "../gestures/bloom-state-machine";
import { ClapBurstStateMachine } from "../gestures/clap-burst-state-machine";
import { DiagonalLiftStateMachine } from "../gestures/diagonal-lift-state-machine";
import type { GestureEvaluation, GestureEvent, GestureReadinessObservation } from "../gestures/gesture-types";
import { LiftStateMachine } from "../gestures/lift-state-machine";
import { RibbonSwipeStateMachine } from "../gestures/ribbon-swipe-state-machine";
import { SpotlightStateMachine } from "../gestures/spotlight-state-machine";
import {
  LandmarkReplayRecorder,
  toHandTrackingFrame,
  type LandmarkReplayDocument,
  type LandmarkReplayDocumentV2,
  type LandmarkReplaySession,
} from "../replay/landmark-replay";
import { HandFeaturePipeline } from "../tracking/hand-feature-pipeline";
import type { HandTrackingFrame, TrackingProviderInfo } from "../tracking/tracking-types";
import type { TrackedHandFrame } from "../tracking/derived-tracking-types";
import {
  Phase1ControlledRunner,
  P1_FIVE_GESTURE_PROTOCOL,
  P1_READINESS_STABLE_MS,
  eventMatchesTrial,
  type P1Outcome,
  type P1PauseReason,
  type P1ProtocolDefinition,
  type P1ReadinessDiagnostic,
  type P1RunnerSnapshot,
  type P1TrialDefinition,
  type P1TrialExtras,
} from "./phase1-protocol";
import {
  createPhase1SessionDocument,
  type P1TrialDiagnosticRecord,
  type P1TrialEnvironmentRecord,
  type Phase1DocumentExtras,
  type Phase1SessionDocument,
  type Phase1TechnicalSummary,
} from "./phase1-session";
import type { DeviceTechnicalSnapshot } from "../metrics/device-technical-snapshot";

type TrialMachine =
  | AirTapStateMachine
  | BloomStateMachine
  | RibbonSwipeStateMachine
  | LiftStateMachine
  | DiagonalLiftStateMachine
  | SpotlightStateMachine
  | ClapBurstStateMachine;

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** What the screen contributes to a trial environment record; the engine adds the trial identity. */
export type P1TrialEnvironmentInput = Omit<P1TrialEnvironmentRecord, "trialId" | "ordinal" | "attempt">;

type DiagnosticOccurrence = Omit<P1TrialDiagnosticRecord, "count" | "lastTimeMs">;

export interface Phase1LabSnapshot {
  readonly protocol: P1RunnerSnapshot;
  readonly latestTrackedFrame: TrackedHandFrame | null;
  readonly latestEvaluation: GestureEvaluation | null;
  readonly latestDiagnostic: P1TrialDiagnosticRecord | null;
  /** Latest start-position check of a readiness-gated trial. */
  readonly readiness: GestureReadinessObservation | null;
  /** The start position settled and the recognition window has not been scheduled yet. */
  readonly readinessReached: boolean;
  readonly eventCount: number;
  readonly rejectionCount: number;
  readonly idConflictCount: number;
}

export interface Phase1ReplayEvaluation {
  readonly frameCount: number;
  readonly matchingEventCount: number;
  readonly rejectionCount: number;
  readonly idConflictCount: number;
  readonly latestTrackedFrame: TrackedHandFrame | null;
  readonly latestEvaluation: GestureEvaluation | null;
}

export class Phase1LabEngine {
  readonly #pipeline = new HandFeaturePipeline();
  readonly #runner: Phase1ControlledRunner;
  readonly #events: GestureEvent[] = [];
  readonly #diagnostics: Mutable<P1TrialDiagnosticRecord>[] = [];
  readonly #trialEnvironments: P1TrialEnvironmentRecord[] = [];
  #session: LandmarkReplaySession | null = null;
  #recorder: LandmarkReplayRecorder | null = null;
  #machine: TrialMachine | null = null;
  #latestTrackedFrame: TrackedHandFrame | null = null;
  #latestEvaluation: GestureEvaluation | null = null;
  #latestReadiness: GestureReadinessObservation | null = null;
  #pendingReadyAtMs: number | null = null;
  #readinessStats: Mutable<P1ReadinessDiagnostic> = emptyReadinessStats();
  #attemptRejectionCount = 0;
  #attemptTrackingLossCount = 0;
  /** The first recognition-window frame of the attempt has been handled. */
  #windowPrimed = false;
  #idConflictCount = 0;
  #rejectionCount = 0;

  constructor(protocol: P1ProtocolDefinition | readonly P1TrialDefinition[] = P1_FIVE_GESTURE_PROTOCOL) {
    this.#runner = new Phase1ControlledRunner(protocol);
  }

  startSession(
    sessionId: string,
    provider: TrackingProviderInfo | null,
    options: { readonly notes?: string; readonly appVersion?: string } = {},
  ): void {
    this.#pipeline.reset();
    this.#runner.start();
    this.#events.length = 0;
    this.#diagnostics.length = 0;
    this.#trialEnvironments.length = 0;
    this.#latestTrackedFrame = null;
    this.#latestEvaluation = null;
    this.#resetAttemptState();
    this.#idConflictCount = 0;
    this.#rejectionCount = 0;
    this.#machine = null;
    this.#session = {
      sessionId,
      createdAtIso: new Date().toISOString(),
      appVersion: options.appVersion ?? "0.1.0",
      provider,
      notes: options.notes ?? "",
    };
    this.#recorder = new LandmarkReplayRecorder(this.#session);
  }

  startBlock(nowMs: number): boolean {
    return this.#runner.startBlock(nowMs);
  }

  beginNextTrial(targetTimeMs: number | null, preparedAtMs = 0): P1TrialDefinition | null {
    const trial = this.#runner.beginNextTrial(targetTimeMs, preparedAtMs);
    // A refused start (for example while a trial is active) leaves the active attempt untouched.
    if (trial === null) return null;
    this.#machine = createMachine(trial);
    this.#resetAttemptState();
    const timing = this.#runner.activeTiming;
    const readiness = this.#runner.activeReadiness;
    if (timing !== null) {
      this.#recorder?.beginTrial({ trialId: trial.id, ordinal: trial.ordinal, timing, readiness });
    } else if (readiness !== null) {
      this.#recorder?.beginTrial({ trialId: trial.id, ordinal: trial.ordinal, timing: null, readiness });
    }
    return trial;
  }

  /** Opens the recognition window of a readiness-gated trial after its start position settled. */
  startRecognition(targetTimeMs: number | null): boolean {
    const readyAtMs = this.#pendingReadyAtMs;
    if (readyAtMs === null || !this.#runner.startRecognition(readyAtMs, targetTimeMs)) return false;
    this.#pendingReadyAtMs = null;
    const protocol = this.#runner.snapshot;
    const trial = protocol.activeTrial;
    if (trial !== null) {
      this.#recorder?.updateTrial({
        trialId: trial.id,
        timing: protocol.activeTiming,
        readiness: protocol.activeReadiness,
      });
    }
    return true;
  }

  processFrame(frame: HandTrackingFrame): Phase1LabSnapshot {
    this.#recorder?.addFrame(frame);
    return this.#processFrame(frame);
  }

  evaluateReplay(document: LandmarkReplayDocument): Phase1ReplayEvaluation {
    const trial = this.#runner.snapshot.activeTrial;
    if (trial === null) throw new Error("Begin a P1 trial before evaluating a replay.");
    const pipeline = new HandFeaturePipeline();
    let machine: TrialMachine | null = createMachine(trial);
    let latestTrackedFrame: TrackedHandFrame | null = null;
    let latestEvaluation: GestureEvaluation | null = null;
    let matchingEventCount = 0;
    let rejectionCount = 0;
    let idConflictCount = 0;
    for (const replayFrame of document.frames) {
      const tracked = toMirroredPreviewFrame(pipeline.process(toHandTrackingFrame(replayFrame)));
      latestTrackedFrame = tracked;
      idConflictCount += tracked.identityConflictCount;
      const evaluation = machine?.process(tracked) ?? null;
      latestEvaluation = evaluation;
      if (evaluation === null) continue;
      rejectionCount += evaluation.rejections.length;
      if (evaluation.events.some((event) => eventMatchesTrial(event, trial))) {
        matchingEventCount += 1;
        machine = null;
      }
    }
    return {
      frameCount: document.frames.length,
      matchingEventCount,
      rejectionCount,
      idConflictCount,
      latestTrackedFrame,
      latestEvaluation,
    };
  }

  #processFrame(frame: HandTrackingFrame): Phase1LabSnapshot {
    const tracked = toMirroredPreviewFrame(this.#pipeline.process(frame));
    this.#latestTrackedFrame = tracked;
    this.#idConflictCount += tracked.identityConflictCount;
    const trial = this.#runner.activeTrial;
    const machine = this.#machine;
    if (trial === null || machine === null) {
      this.#latestEvaluation = null;
      return this.snapshot;
    }
    const protocol = this.#runner.snapshot;
    const timing = protocol.activeTiming;
    if (timing === null) {
      // Readiness phase: only the start position is observed. Nothing here counts as a rejection.
      this.#latestEvaluation = null;
      const readiness = protocol.activeReadiness;
      if (readiness !== null
        && this.#pendingReadyAtMs === null
        && frame.captureTimeMs >= readiness.startedAtMs
        && frame.captureTimeMs <= readiness.deadlineTimeMs
        && hasReadinessGate(machine)) {
        const observation = machine.observeReadiness(tracked);
        this.#latestReadiness = observation;
        this.#recordReadiness(observation);
        if (observation.readyAtMs !== null) this.#pendingReadyAtMs = observation.readyAtMs;
      }
      return this.snapshot;
    }
    if (frame.captureTimeMs < timing.windowOpenedAtMs) {
      this.#latestEvaluation = preparesBeforeWindow(machine) ? machine.prepare(tracked) : null;
      return this.snapshot;
    }
    if (frame.captureTimeMs > timing.deadlineTimeMs) {
      this.#latestEvaluation = null;
      return this.snapshot;
    }
    if (!this.#windowPrimed) {
      this.#windowPrimed = true;
      // Without a GO target the window opens with the trial, so its first frame stands in for the count-in:
      // a Spotlight pose already formed then must be released and formed again.
      if (timing.targetTimeMs === null && machine instanceof SpotlightStateMachine) machine.prepare(tracked);
    }
    const evaluation = machine.process(tracked);
    this.#latestEvaluation = evaluation;
    const attempt = this.#runner.activeAttempt;

    if (tracked.identityConflictCount > 0) {
      this.#pushDiagnostic({
        trialId: trial.id,
        ordinal: trial.ordinal,
        attempt,
        timeMs: frame.captureTimeMs,
        kind: "identity-conflict",
        handIds: tracked.hands.map(({ trackId }) => trackId),
        reasonCodes: ["identity-conflict"],
      });
    }
    for (const rejection of evaluation.rejections) {
      // Tracking losses are machine-side failures: recorded, but never counted as rejections of the player's motion.
      const trackingLoss = rejection.reasonCodes.includes("tracking-lost");
      this.#rejectionCount += 1;
      if (trackingLoss) this.#attemptTrackingLossCount += 1;
      else this.#attemptRejectionCount += 1;
      this.#pushDiagnostic({
        trialId: trial.id,
        ordinal: trial.ordinal,
        attempt,
        timeMs: rejection.timeMs,
        kind: trackingLoss ? "tracking-gap" : "rejection",
        handIds: [...rejection.handIds],
        reasonCodes: [...rejection.reasonCodes],
      });
    }
    for (const event of evaluation.events) {
      if (event.eventTimeMs < timing.windowOpenedAtMs || event.eventTimeMs > timing.deadlineTimeMs) continue;
      this.#events.push(event);
      if (this.#runner.acceptEvent(event, this.#extras())) {
        this.#afterTrialFinished(frame.captureTimeMs);
        break;
      }
    }
    return this.snapshot;
  }

  recordOutcome(
    outcome: Exclude<P1Outcome, "success">,
    reasonCodes: readonly string[] = [],
    finishedAtMs = performance.now(),
  ): boolean {
    const finished = this.#runner.recordOutcome(outcome, reasonCodes, finishedAtMs, this.#extras(finishedAtMs));
    if (finished) this.#afterTrialFinished();
    return finished;
  }

  skip(finishedAtMs = performance.now()): boolean {
    const finished = this.#runner.skip(finishedAtMs, this.#extras(finishedAtMs));
    if (finished) this.#afterTrialFinished();
    return finished;
  }

  /** Readiness deadline before the count-in, recognition deadline afterwards. */
  timeout(finishedAtMs = performance.now()): boolean {
    const finished = this.#runner.timeout(finishedAtMs, this.#extras(finishedAtMs));
    if (finished) this.#afterTrialFinished();
    return finished;
  }

  /** Pauses inside a started block. An active attempt is discarded, and its pause time never counts as trial time. */
  pause(nowMs: number, reason: P1PauseReason = "manual"): boolean {
    const result = this.#runner.pause(nowMs, reason);
    if (result.abandonedTrial !== null) {
      this.#recorder?.abandonTrial({ trialId: result.abandonedTrial.id, abandonedAtMs: nowMs });
      this.#machine = null;
      this.#resetAttemptState();
    }
    return result.paused;
  }

  resume(nowMs: number): boolean {
    return this.#runner.resume(nowMs);
  }

  recordFalseTrigger(event: GestureEvent): void {
    this.#events.push(event);
    this.#runner.recordFalseTrigger(event);
  }

  /** Records what the screen looked like at the start of the attempt that just began. */
  recordTrialEnvironment(environment: P1TrialEnvironmentInput): void {
    const trial = this.#runner.activeTrial;
    if (trial === null) return;
    this.#trialEnvironments.push({
      trialId: trial.id,
      ordinal: trial.ordinal,
      attempt: this.#runner.activeAttempt,
      ...environment,
    });
  }

  createDocument(
    technicalSummary: Phase1TechnicalSummary,
    technicalSnapshot: DeviceTechnicalSnapshot,
    extras: Phase1DocumentExtras = { performance: null, environment: null },
  ): Phase1SessionDocument {
    if (this.#recorder === null || this.#session === null) throw new Error("Start a P1 session before exporting.");
    return createPhase1SessionDocument(
      this.#session,
      this.#runner.snapshot,
      this.#events,
      this.#diagnostics,
      // Counts only: the light result JSON must never deep-copy every recorded replay frame.
      this.#recorder.counts(),
      { ...technicalSummary, idConflictCount: this.#idConflictCount },
      technicalSnapshot,
      { extras, trialEnvironments: this.#trialEnvironments },
    );
  }

  createDiagnosticReplay(): LandmarkReplayDocumentV2 {
    if (this.#recorder === null) throw new Error("Start a P1 session before exporting a diagnostic replay.");
    return this.#recorder.snapshot();
  }

  get diagnosticPostRollPending(): boolean {
    return this.#recorder?.postRollPending ?? false;
  }

  get diagnosticFrameCount(): number {
    return this.#recorder?.frameCount ?? 0;
  }

  get sessionId(): string | null {
    return this.#session?.sessionId ?? null;
  }

  get snapshot(): Phase1LabSnapshot {
    const protocol = this.#runner.snapshot;
    return {
      protocol,
      latestTrackedFrame: this.#latestTrackedFrame,
      latestEvaluation: this.#latestEvaluation,
      latestDiagnostic: this.#diagnostics.at(-1) ?? null,
      readiness: protocol.activeReadiness === null ? null : this.#latestReadiness,
      readinessReached: this.#pendingReadyAtMs !== null
        && protocol.activeTrial !== null
        && protocol.activeTiming === null,
      eventCount: this.#events.length,
      rejectionCount: this.#rejectionCount,
      idConflictCount: this.#idConflictCount,
    };
  }

  #afterTrialFinished(confirmedAtMs: number | null = null): void {
    this.#machine = null;
    const result = this.#runner.snapshot.results.at(-1);
    if (result !== undefined) {
      this.#recorder?.finishTrial({
        trialId: result.trial.id,
        resolution: result.resolution,
        // Post-roll follows the frame that confirmed the result; a Spotlight hold is confirmed after its entry time.
        finishedAtMs: confirmedAtMs === null ? result.finishedAtMs : Math.max(result.finishedAtMs, confirmedAtMs),
      });
    }
    this.#resetAttemptState();
  }

  /**
   * A 10-second trial at 30fps could otherwise append 300 records. Consecutive occurrences that are
   * identical (same attempt, kind, hands and reason codes) share one record with a count and the
   * first and last time, so reason-code totals stay the same as one record per occurrence.
   */
  #pushDiagnostic(occurrence: DiagnosticOccurrence): void {
    const previous = this.#diagnostics.at(-1);
    if (previous !== undefined
      && previous.trialId === occurrence.trialId
      && previous.attempt === occurrence.attempt
      && previous.kind === occurrence.kind
      && sameStrings(previous.reasonCodes, occurrence.reasonCodes)
      && sameStrings(previous.handIds, occurrence.handIds)) {
      previous.count += 1;
      previous.lastTimeMs = occurrence.timeMs;
      return;
    }
    this.#diagnostics.push({ ...occurrence, count: 1, lastTimeMs: occurrence.timeMs });
  }

  #resetAttemptState(): void {
    this.#latestReadiness = null;
    this.#pendingReadyAtMs = null;
    this.#readinessStats = emptyReadinessStats();
    this.#attemptRejectionCount = 0;
    this.#attemptTrackingLossCount = 0;
    this.#windowPrimed = false;
  }

  #recordReadiness(observation: GestureReadinessObservation): void {
    const stats = this.#readinessStats;
    stats.frameCount += 1;
    if (observation.visibleHands >= 2) stats.twoHandFrameCount += 1;
    if (observation.inZone) stats.inZoneFrameCount += 1;
    stats.longestStableMs = Math.max(stats.longestStableMs, observation.stableMs);
    stats.lastVisibleHands = observation.visibleHands;
    stats.lastInZone = observation.inZone;
  }

  #extras(finishedAtMs?: number): P1TrialExtras {
    const trial = this.#runner.activeTrial;
    const machine = this.#machine;
    const recognitionStarted = this.#runner.activeTiming !== null;
    return {
      // A gesture diagnostic is saved only when the recognition window opened; otherwise it would be all zeros.
      ...(trial === null || machine === null || !recognitionStarted ? {} : machineDiagnostics(machine, trial, finishedAtMs)),
      rejectionCount: this.#attemptRejectionCount,
      trackingLossCount: this.#attemptTrackingLossCount,
      ...(trial?.requiresReadiness === true ? { readinessDiagnostic: { ...this.#readinessStats } } : {}),
      ...(trial !== null && !recognitionStarted
        ? { readinessReasonCodes: readinessTimeoutReasons(trial, this.#readinessStats) }
        : {}),
    };
  }
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function emptyReadinessStats(): Mutable<P1ReadinessDiagnostic> {
  return {
    frameCount: 0,
    twoHandFrameCount: 0,
    inZoneFrameCount: 0,
    longestStableMs: 0,
    lastVisibleHands: null,
    lastInZone: null,
  };
}

/** Why the start position never settled: hands missing, hands outside the zone, or hands not held still. */
function readinessTimeoutReasons(trial: P1TrialDefinition, stats: P1ReadinessDiagnostic): readonly string[] {
  const cause = stats.twoHandFrameCount === 0
    ? "readiness-hands-missing"
    : stats.inZoneFrameCount === 0
      ? "readiness-outside-zone"
      : "readiness-not-still";
  if (trial.gesture === "lift") return [cause, "lift-not-ready"];
  if (trial.gesture === "diagonal-lift") return [cause, "diagonal-lift-not-ready"];
  return [cause];
}

function createMachine(trial: P1TrialDefinition): TrialMachine {
  switch (trial.gesture) {
    case "air-tap":
      return new AirTapStateMachine({
        centerX: trial.airTapSide === "left" ? 0.3 : 0.7,
        centerY: 0.5,
      });
    case "ribbon-swipe":
      return new RibbonSwipeStateMachine({ direction: trial.swipeDirection ?? "left-to-right" });
    case "bloom":
      return new BloomStateMachine({ readinessStableMs: P1_READINESS_STABLE_MS.bloom });
    case "lift":
      return new LiftStateMachine({ readinessStableMs: P1_READINESS_STABLE_MS.lift });
    case "diagonal-lift":
      return new DiagonalLiftStateMachine({
        variant: trial.diagonalLiftVariant ?? "up-right",
        readinessStableMs: P1_READINESS_STABLE_MS["diagonal-lift"],
      });
    case "spotlight":
      return new SpotlightStateMachine({ variant: trial.spotlightVariant ?? "left-up-right-down" });
    case "clap":
      return new ClapBurstStateMachine(trial.clapMode === "contact"
        ? { triggerDistance: 0.075, contactLikeDistance: 0.075 }
        : undefined);
  }
}

function hasReadinessGate(
  machine: TrialMachine,
): machine is BloomStateMachine | LiftStateMachine | DiagonalLiftStateMachine {
  return machine instanceof BloomStateMachine
    || machine instanceof LiftStateMachine
    || machine instanceof DiagonalLiftStateMachine;
}

function preparesBeforeWindow(
  machine: TrialMachine,
): machine is RibbonSwipeStateMachine
  | BloomStateMachine
  | LiftStateMachine
  | DiagonalLiftStateMachine
  | SpotlightStateMachine {
  return machine instanceof RibbonSwipeStateMachine
    || machine instanceof BloomStateMachine
    || machine instanceof LiftStateMachine
    || machine instanceof DiagonalLiftStateMachine
    || machine instanceof SpotlightStateMachine;
}

function machineDiagnostics(
  machine: TrialMachine,
  trial: P1TrialDefinition,
  finishedAtMs: number | undefined,
): P1TrialExtras {
  if (machine instanceof ClapBurstStateMachine) {
    if (trial.gesture !== "clap" || trial.clapMode !== "contact") return {};
    return { clapDiagnostic: finishedAtMs === undefined ? machine.diagnostic : machine.diagnosticAt(finishedAtMs) };
  }
  if (machine instanceof BloomStateMachine) {
    return { bloomDiagnostic: finishedAtMs === undefined ? machine.diagnostic : machine.diagnosticAt(finishedAtMs) };
  }
  if (machine instanceof DiagonalLiftStateMachine) {
    return {
      diagonalLiftDiagnostic: finishedAtMs === undefined ? machine.diagnostic : machine.diagnosticAt(finishedAtMs),
    };
  }
  if (machine instanceof LiftStateMachine) {
    return { liftDiagnostic: finishedAtMs === undefined ? machine.diagnostic : machine.diagnosticAt(finishedAtMs) };
  }
  if (machine instanceof SpotlightStateMachine) {
    return { spotlightDiagnostic: finishedAtMs === undefined ? machine.diagnostic : machine.diagnosticAt(finishedAtMs) };
  }
  return {};
}

function toMirroredPreviewFrame(frame: TrackedHandFrame): TrackedHandFrame {
  return {
    ...frame,
    hands: frame.hands.map((hand) => ({
      ...hand,
      palmCenter: { ...hand.palmCenter, x: 1 - hand.palmCenter.x },
      palmVelocity: { ...hand.palmVelocity, x: -hand.palmVelocity.x },
      indexTip: { ...hand.indexTip, x: 1 - hand.indexTip.x },
      indexTipVelocity: { ...hand.indexTipVelocity, x: -hand.indexTipVelocity.x },
    })),
  };
}
