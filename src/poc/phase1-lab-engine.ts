import { AirTapStateMachine } from "../gestures/air-tap-state-machine";
import { ClapBurstStateMachine } from "../gestures/clap-burst-state-machine";
import type { GestureEvaluation, GestureEvent } from "../gestures/gesture-types";
import { RibbonSwipeStateMachine } from "../gestures/ribbon-swipe-state-machine";
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
  eventMatchesTrial,
  type P1Outcome,
  type P1RunnerSnapshot,
  type P1TrialDefinition,
} from "./phase1-protocol";
import {
  createPhase1SessionDocument,
  type P1TrialDiagnosticRecord,
  type Phase1SessionDocument,
  type Phase1TechnicalSummary,
} from "./phase1-session";
import type { DeviceTechnicalSnapshot } from "../metrics/device-technical-snapshot";

type TrialMachine = AirTapStateMachine | RibbonSwipeStateMachine | ClapBurstStateMachine;

export interface Phase1LabSnapshot {
  readonly protocol: P1RunnerSnapshot;
  readonly latestTrackedFrame: TrackedHandFrame | null;
  readonly latestEvaluation: GestureEvaluation | null;
  readonly latestDiagnostic: P1TrialDiagnosticRecord | null;
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
  readonly #runner = new Phase1ControlledRunner();
  readonly #events: GestureEvent[] = [];
  readonly #diagnostics: P1TrialDiagnosticRecord[] = [];
  #session: LandmarkReplaySession | null = null;
  #recorder: LandmarkReplayRecorder | null = null;
  #machine: TrialMachine | null = null;
  #latestTrackedFrame: TrackedHandFrame | null = null;
  #latestEvaluation: GestureEvaluation | null = null;
  #idConflictCount = 0;
  #rejectionCount = 0;

  startSession(sessionId: string, provider: TrackingProviderInfo | null, notes = ""): void {
    this.#pipeline.reset();
    this.#runner.start();
    this.#events.length = 0;
    this.#diagnostics.length = 0;
    this.#latestTrackedFrame = null;
    this.#latestEvaluation = null;
    this.#idConflictCount = 0;
    this.#rejectionCount = 0;
    this.#machine = null;
    this.#session = {
      sessionId,
      createdAtIso: new Date().toISOString(),
      appVersion: "0.1.0",
      provider,
      notes,
    };
    this.#recorder = new LandmarkReplayRecorder(this.#session);
  }

  beginNextTrial(targetTimeMs: number | null, preparedAtMs = 0): P1TrialDefinition | null {
    const trial = this.#runner.beginNextTrial(targetTimeMs, preparedAtMs);
    this.#machine = trial === null ? null : createMachine(trial);
    const timing = this.#runner.snapshot.activeTiming;
    if (trial !== null && timing !== null) {
      this.#recorder?.beginTrial({ trialId: trial.id, ordinal: trial.ordinal, timing });
    }
    return trial;
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
    const protocol = this.#runner.snapshot;
    const trial = protocol.activeTrial;
    const timing = protocol.activeTiming;
    if (trial === null || timing === null || this.#machine === null) {
      this.#latestEvaluation = null;
      return this.snapshot;
    }
    if (frame.captureTimeMs < timing.windowOpenedAtMs) {
      this.#latestEvaluation = this.#machine instanceof RibbonSwipeStateMachine
        ? this.#machine.prepare(tracked)
        : null;
      return this.snapshot;
    }
    if (frame.captureTimeMs > timing.deadlineTimeMs) {
      this.#latestEvaluation = null;
      return this.snapshot;
    }
    const evaluation = this.#machine.process(tracked);
    this.#latestEvaluation = evaluation;

    if (tracked.identityConflictCount > 0) {
      this.#diagnostics.push({
        trialId: trial.id,
        ordinal: trial.ordinal,
        timeMs: frame.captureTimeMs,
        kind: "identity-conflict",
        handIds: tracked.hands.map(({ trackId }) => trackId),
        reasonCodes: ["identity-conflict"],
      });
    }
    for (const rejection of evaluation.rejections) {
      this.#rejectionCount += 1;
      this.#diagnostics.push({
        trialId: trial.id,
        ordinal: trial.ordinal,
        timeMs: rejection.timeMs,
        kind: rejection.reasonCodes.includes("tracking-lost") ? "tracking-gap" : "rejection",
        handIds: [...rejection.handIds],
        reasonCodes: [...rejection.reasonCodes],
      });
    }
    for (const event of evaluation.events) {
      if (event.eventTimeMs < timing.windowOpenedAtMs || event.eventTimeMs > timing.deadlineTimeMs) continue;
      this.#events.push(event);
      if (this.#runner.acceptEvent(event)) {
        this.#machine = null;
        this.#finishReplayWindow();
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
    const finished = this.#runner.recordOutcome(outcome, reasonCodes, finishedAtMs);
    if (finished) {
      this.#machine = null;
      this.#finishReplayWindow();
    }
    return finished;
  }

  skip(finishedAtMs = performance.now()): boolean {
    const finished = this.#runner.skip(finishedAtMs);
    if (finished) {
      this.#machine = null;
      this.#finishReplayWindow();
    }
    return finished;
  }

  timeout(finishedAtMs = performance.now()): boolean {
    const finished = this.#runner.timeout(finishedAtMs);
    if (finished) {
      this.#machine = null;
      this.#finishReplayWindow();
    }
    return finished;
  }

  recordFalseTrigger(event: GestureEvent): void {
    this.#events.push(event);
    this.#runner.recordFalseTrigger(event);
  }

  createDocument(technicalSummary: Phase1TechnicalSummary, technicalSnapshot: DeviceTechnicalSnapshot): Phase1SessionDocument {
    if (this.#recorder === null || this.#session === null) throw new Error("Start a P1 session before exporting.");
    return createPhase1SessionDocument(
      this.#session,
      this.#runner.snapshot,
      this.#events,
      this.#diagnostics,
      this.#recorder.snapshot(),
      { ...technicalSummary, idConflictCount: this.#idConflictCount },
      technicalSnapshot,
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
    return {
      protocol: this.#runner.snapshot,
      latestTrackedFrame: this.#latestTrackedFrame,
      latestEvaluation: this.#latestEvaluation,
      latestDiagnostic: this.#diagnostics.at(-1) ?? null,
      eventCount: this.#events.length,
      rejectionCount: this.#rejectionCount,
      idConflictCount: this.#idConflictCount,
    };
  }

  #finishReplayWindow(): void {
    const result = this.#runner.snapshot.results.at(-1);
    if (result === undefined) return;
    this.#recorder?.finishTrial({
      trialId: result.trial.id,
      resolution: result.resolution,
      finishedAtMs: result.timing.finishedAtMs,
    });
  }
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
    case "clap":
      return new ClapBurstStateMachine(trial.clapMode === "contact"
        ? { triggerDistance: 0.075, contactLikeDistance: 0.075 }
        : undefined);
  }
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
