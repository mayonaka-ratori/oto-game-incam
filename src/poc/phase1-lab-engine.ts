import { AirTapStateMachine } from "../gestures/air-tap-state-machine";
import { ClapBurstStateMachine } from "../gestures/clap-burst-state-machine";
import type { GestureEvaluation, GestureEvent, GestureRejection } from "../gestures/gesture-types";
import { RibbonSwipeStateMachine } from "../gestures/ribbon-swipe-state-machine";
import { LandmarkReplayRecorder, type LandmarkReplayDocument } from "../replay/landmark-replay";
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
  type Phase1SessionDocument,
  type Phase1TechnicalSummary,
} from "./phase1-session";

type TrialMachine = AirTapStateMachine | RibbonSwipeStateMachine | ClapBurstStateMachine;

export interface Phase1LabSnapshot {
  readonly protocol: P1RunnerSnapshot;
  readonly latestTrackedFrame: TrackedHandFrame | null;
  readonly latestEvaluation: GestureEvaluation | null;
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
  readonly #rejections: GestureRejection[] = [];
  #recorder: LandmarkReplayRecorder | null = null;
  #machine: TrialMachine | null = null;
  #latestTrackedFrame: TrackedHandFrame | null = null;
  #latestEvaluation: GestureEvaluation | null = null;
  #idConflictCount = 0;

  startSession(sessionId: string, provider: TrackingProviderInfo | null, notes = ""): void {
    this.#pipeline.reset();
    this.#runner.start();
    this.#events.length = 0;
    this.#rejections.length = 0;
    this.#latestTrackedFrame = null;
    this.#latestEvaluation = null;
    this.#idConflictCount = 0;
    this.#machine = null;
    this.#recorder = new LandmarkReplayRecorder({
      sessionId,
      createdAtIso: new Date().toISOString(),
      appVersion: "0.1.0",
      provider,
      notes,
    });
  }

  beginNextTrial(targetTimeMs: number | null): P1TrialDefinition | null {
    const trial = this.#runner.beginNextTrial(targetTimeMs);
    this.#machine = trial === null ? null : createMachine(trial);
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
    for (const frame of document.frames) {
      const tracked = toMirroredPreviewFrame(pipeline.process(frame));
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
    const evaluation = this.#machine?.process(tracked) ?? null;
    this.#latestEvaluation = evaluation;
    if (evaluation !== null) {
      this.#rejections.push(...evaluation.rejections);
      for (const event of evaluation.events) {
        this.#events.push(event);
        if (this.#runner.acceptEvent(event)) this.#machine = null;
      }
    }
    return this.snapshot;
  }

  recordOutcome(outcome: Exclude<P1Outcome, "success">, reasonCodes: readonly string[] = []): void {
    this.#runner.recordOutcome(outcome, reasonCodes);
    this.#machine = null;
  }

  recordFalseTrigger(event: GestureEvent): void {
    this.#events.push(event);
    this.#runner.recordFalseTrigger(event);
  }

  createDocument(technicalSummary: Phase1TechnicalSummary): Phase1SessionDocument {
    if (this.#recorder === null) throw new Error("Start a P1 session before exporting.");
    return createPhase1SessionDocument(
      this.#runner.snapshot,
      this.#events,
      this.#rejections,
      this.#recorder.snapshot(),
      { ...technicalSummary, idConflictCount: this.#idConflictCount },
    );
  }

  get snapshot(): Phase1LabSnapshot {
    return {
      protocol: this.#runner.snapshot,
      latestTrackedFrame: this.#latestTrackedFrame,
      latestEvaluation: this.#latestEvaluation,
      eventCount: this.#events.length,
      rejectionCount: this.#rejections.length,
      idConflictCount: this.#idConflictCount,
    };
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
