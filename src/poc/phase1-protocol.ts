import type { GestureEvent, RibbonSwipeDirection } from "../gestures/gesture-types";
import type { ClapTrialDiagnostic } from "../gestures/clap-burst-state-machine";
import type { BloomTrialDiagnostic } from "../gestures/bloom-state-machine";

export type P1Gesture = "air-tap" | "ribbon-swipe" | "bloom" | "clap";
export const P1_TRIAL_TIMEOUT_MS = 10_000;
export const P1_EARLY_WINDOW_MS = 500;

export type P1Outcome =
  | "success"
  | "player-miss"
  | "machine-miss"
  | "tracking-loss"
  | "unclassified";

export type P1Resolution =
  | "gesture-event"
  | "manual-classification"
  | "manual-skip"
  | "trial-timeout";

export interface P1ActiveTrialTiming {
  readonly preparedAtMs: number;
  readonly windowOpenedAtMs: number;
  readonly targetTimeMs: number | null;
  readonly deadlineTimeMs: number;
}

export interface P1TrialTiming extends P1ActiveTrialTiming {
  readonly finishedAtMs: number;
}

export interface P1TrialDefinition {
  readonly id: string;
  readonly ordinal: number;
  readonly gesture: P1Gesture;
  readonly instruction: string;
  readonly airTapSide?: "left" | "right";
  readonly swipeDirection?: RibbonSwipeDirection;
  readonly clapMode?: "contact" | "near-clap";
}

export interface P1TrialResult {
  readonly trial: P1TrialDefinition;
  readonly outcome: P1Outcome;
  readonly resolution: P1Resolution;
  readonly timing: P1TrialTiming;
  readonly targetTimeMs: number | null;
  readonly event: GestureEvent | null;
  readonly offsetMs: number | null;
  readonly reasonCodes: readonly string[];
  readonly clapDiagnostic?: ClapTrialDiagnostic;
  readonly bloomDiagnostic?: BloomTrialDiagnostic;
}

export interface P1RunnerSnapshot {
  readonly state: "idle" | "running" | "complete";
  readonly activeTrial: P1TrialDefinition | null;
  readonly activeTiming: P1ActiveTrialTiming | null;
  readonly nextTrial: P1TrialDefinition | null;
  readonly completed: number;
  readonly total: number;
  readonly results: readonly P1TrialResult[];
  readonly falseTriggers: readonly GestureEvent[];
}

export const P1_CONTROLLED_TRIALS: readonly P1TrialDefinition[] = buildTrials();

/**
 * Retained only for replaying and interpreting pre-Bloom P1 sessions.
 * It is deliberately not part of the current 30-trial protocol.
 */
export const P1_LEGACY_CLAP_TRIALS: readonly P1TrialDefinition[] = buildLegacyClapTrials();

export class Phase1ControlledRunner {
  readonly #trials: readonly P1TrialDefinition[];
  readonly #results: P1TrialResult[] = [];
  readonly #falseTriggers: GestureEvent[] = [];
  #activeTrial: P1TrialDefinition | null = null;
  #activeTiming: P1ActiveTrialTiming | null = null;
  #state: P1RunnerSnapshot["state"] = "idle";

  constructor(trials: readonly P1TrialDefinition[] = P1_CONTROLLED_TRIALS) {
    this.#trials = trials;
  }

  start(): void {
    this.#results.length = 0;
    this.#falseTriggers.length = 0;
    this.#activeTrial = null;
    this.#activeTiming = null;
    this.#state = "running";
  }

  beginNextTrial(targetTimeMs: number | null, preparedAtMs = 0): P1TrialDefinition | null {
    if (this.#state !== "running" || this.#activeTrial !== null) return null;
    const trial = this.#trials[this.#results.length] ?? null;
    if (trial === null) {
      this.#state = "complete";
      return null;
    }
    this.#activeTrial = trial;
    const windowOpenedAtMs = targetTimeMs === null
      ? preparedAtMs
      : targetTimeMs - P1_EARLY_WINDOW_MS;
    this.#activeTiming = {
      preparedAtMs,
      windowOpenedAtMs,
      targetTimeMs,
      deadlineTimeMs: (targetTimeMs ?? preparedAtMs) + P1_TRIAL_TIMEOUT_MS,
    };
    return trial;
  }

  acceptEvent(
    event: GestureEvent,
    clapDiagnostic?: ClapTrialDiagnostic,
    bloomDiagnostic?: BloomTrialDiagnostic,
  ): boolean {
    const trial = this.#activeTrial;
    const timing = this.#activeTiming;
    if (trial === null || timing === null) return false;
    if (event.eventTimeMs < timing.windowOpenedAtMs || event.eventTimeMs > timing.deadlineTimeMs) return false;
    if (!eventMatchesTrial(event, trial)) {
      this.#falseTriggers.push(event);
      return false;
    }
    return this.#finish(
      "success",
      "gesture-event",
      event,
      event.reasonCodes,
      event.eventTimeMs,
      clapDiagnostic,
      bloomDiagnostic,
    );
  }

  recordOutcome(
    outcome: Exclude<P1Outcome, "success">,
    reasonCodes: readonly string[] = [],
    finishedAtMs = performance.now(),
    clapDiagnostic?: ClapTrialDiagnostic,
    bloomDiagnostic?: BloomTrialDiagnostic,
  ): boolean {
    return this.#finish(
      outcome,
      "manual-classification",
      null,
      reasonCodes,
      finishedAtMs,
      clapDiagnostic,
      bloomDiagnostic,
    );
  }

  skip(
    finishedAtMs = performance.now(),
    clapDiagnostic?: ClapTrialDiagnostic,
    bloomDiagnostic?: BloomTrialDiagnostic,
  ): boolean {
    return this.#finish(
      "unclassified",
      "manual-skip",
      null,
      ["manual-skip"],
      finishedAtMs,
      clapDiagnostic,
      bloomDiagnostic,
    );
  }

  timeout(
    finishedAtMs = performance.now(),
    clapDiagnostic?: ClapTrialDiagnostic,
    bloomDiagnostic?: BloomTrialDiagnostic,
  ): boolean {
    return this.#finish(
      "unclassified",
      "trial-timeout",
      null,
      ["trial-timeout"],
      finishedAtMs,
      clapDiagnostic,
      bloomDiagnostic,
    );
  }

  recordFalseTrigger(event: GestureEvent): void {
    this.#falseTriggers.push(event);
  }

  get snapshot(): P1RunnerSnapshot {
    const nextTrial = this.#activeTrial ?? this.#trials[this.#results.length] ?? null;
    return {
      state: this.#state,
      activeTrial: this.#activeTrial,
      activeTiming: this.#activeTiming === null ? null : { ...this.#activeTiming },
      nextTrial,
      completed: this.#results.length,
      total: this.#trials.length,
      results: [...this.#results],
      falseTriggers: [...this.#falseTriggers],
    };
  }

  #finish(
    outcome: P1Outcome,
    resolution: P1Resolution,
    event: GestureEvent | null,
    reasonCodes: readonly string[],
    finishedAtMs: number,
    clapDiagnostic?: ClapTrialDiagnostic,
    bloomDiagnostic?: BloomTrialDiagnostic,
  ): boolean {
    const trial = this.#activeTrial;
    const timing = this.#activeTiming;
    if (trial === null || timing === null) return false;
    const offsetMs = event === null || timing.targetTimeMs === null
      ? null
      : event.eventTimeMs - timing.targetTimeMs;
    this.#results.push({
      trial,
      outcome,
      resolution,
      timing: { ...timing, finishedAtMs },
      targetTimeMs: timing.targetTimeMs,
      event,
      offsetMs,
      reasonCodes: [...reasonCodes],
      ...(clapDiagnostic === undefined ? {} : { clapDiagnostic: cloneClapDiagnostic(clapDiagnostic) }),
      ...(bloomDiagnostic === undefined ? {} : { bloomDiagnostic: cloneBloomDiagnostic(bloomDiagnostic) }),
    });
    this.#activeTrial = null;
    this.#activeTiming = null;
    if (this.#results.length >= this.#trials.length) this.#state = "complete";
    return true;
  }
}

function cloneBloomDiagnostic(diagnostic: BloomTrialDiagnostic): BloomTrialDiagnostic {
  return {
    observationFrameCounts: { ...diagnostic.observationFrameCounts },
    lastTwoHandObservedAtMs: diagnostic.lastTwoHandObservedAtMs,
    armedAtMs: diagnostic.armedAtMs,
    triggerTimeMs: diagnostic.triggerTimeMs,
    maximumSyncSpreadMs: diagnostic.maximumSyncSpreadMs,
    preparationSpan: diagnostic.preparationSpan,
    hands: diagnostic.hands.map((hand) => ({ ...hand })),
    latestTrackingGap: diagnostic.latestTrackingGap === null
      ? null
      : { ...diagnostic.latestTrackingGap, handIds: [...diagnostic.latestTrackingGap.handIds] },
    rejectionReasonCodes: [...diagnostic.rejectionReasonCodes],
  };
}

function cloneClapDiagnostic(diagnostic: ClapTrialDiagnostic): ClapTrialDiagnostic {
  return {
    observationFrameCounts: { ...diagnostic.observationFrameCounts },
    lastTwoHandObservedAtMs: diagnostic.lastTwoHandObservedAtMs,
    minimumPalmDistance: diagnostic.minimumPalmDistance === null
      ? null
      : {
        distance: diagnostic.minimumPalmDistance.distance,
        atMs: diagnostic.minimumPalmDistance.atMs,
        hands: diagnostic.minimumPalmDistance.hands.map((hand) => ({ ...hand })),
      },
    maximumConvergenceSpeed: diagnostic.maximumConvergenceSpeed,
    convergenceSpeedAtTriggerDistance: diagnostic.convergenceSpeedAtTriggerDistance,
    triggerDistanceReachedAtMs: diagnostic.triggerDistanceReachedAtMs,
    contactLikeDistanceReachedAtMs: diagnostic.contactLikeDistanceReachedAtMs,
    identityConflictCount: diagnostic.identityConflictCount,
    identityConflictCountBeforeContact: diagnostic.identityConflictCountBeforeContact,
    latestOcclusion: diagnostic.latestOcclusion === null
      ? null
      : {
        lastTwoHandObservedAtMs: diagnostic.latestOcclusion.lastTwoHandObservedAtMs,
        startedAtMs: diagnostic.latestOcclusion.startedAtMs,
        reacquiredAtMs: diagnostic.latestOcclusion.reacquiredAtMs,
        durationMs: diagnostic.latestOcclusion.durationMs,
        before: diagnostic.latestOcclusion.before.map((hand) => ({ ...hand })),
        after: diagnostic.latestOcclusion.after.map((hand) => ({ ...hand })),
      },
    occlusionPrediction: {
      status: diagnostic.occlusionPrediction.status,
      reasonCodes: [...diagnostic.occlusionPrediction.reasonCodes],
    },
  };
}

export function eventMatchesTrial(event: GestureEvent, trial: P1TrialDefinition): boolean {
  if (trial.gesture === "bloom") return event.gestureType === "bloom";
  if (trial.gesture === "clap") {
    if (event.gestureType !== "clap") return false;
    return trial.clapMode === "contact"
      ? event.quality.clapKind === "contact-like" || event.quality.clapKind === "occlusion-predicted"
      : event.quality.clapKind === "near-clap";
  }
  if (event.gestureType !== trial.gesture) return false;
  if (trial.gesture === "ribbon-swipe") return event.quality.direction === trial.swipeDirection;
  return true;
}

function buildTrials(): readonly P1TrialDefinition[] {
  const trials: P1TrialDefinition[] = [];
  for (let index = 0; index < 10; index += 1) {
    const side = index % 2 === 0 ? "left" : "right";
    trials.push({
      id: `air-tap-${index + 1}`,
      ordinal: trials.length + 1,
      gesture: "air-tap",
      airTapSide: side,
      instruction: `${side === "left" ? "左" : "右"}手の人差し指を、外からリングの中へ通す`,
    });
  }
  const swipeDirections: readonly RibbonSwipeDirection[] = [
    "left-to-right", "right-to-left",
    "left-to-right", "right-to-left",
    "left-to-right", "right-to-left",
    "lower-left-to-upper-right", "lower-right-to-upper-left",
    "lower-left-to-upper-right", "lower-right-to-upper-left",
  ];
  for (const [index, direction] of swipeDirections.entries()) {
    trials.push({
      id: `ribbon-swipe-${index + 1}`,
      ordinal: trials.length + 1,
      gesture: "ribbon-swipe",
      swipeDirection: direction,
      instruction: `${swipeDirectionLabel(direction)}、片手を帯に沿って素早く動かす`,
    });
  }
  for (let index = 0; index < 10; index += 1) {
    trials.push({
      id: `bloom-${index + 1}`,
      ordinal: trials.length + 1,
      gesture: "bloom",
      instruction: "両手を中央寄りに構え、左右斜め上へ開いて花を咲かせる",
    });
  }
  return trials;
}

function buildLegacyClapTrials(): readonly P1TrialDefinition[] {
  return Array.from({ length: 10 }, (_, index) => ({
    id: `legacy-clap-${index + 1}`,
    ordinal: index + 1,
    gesture: "clap" as const,
    clapMode: index < 5 ? "contact" as const : "near-clap" as const,
    instruction: index < 5
      ? "両手を中央へ寄せ、手のひらをそっと合わせる（旧クラップ）"
      : "両手を中央へ寄せ、光球を挟んで止める（旧ニアクラップ）",
  }));
}

export function swipeDirectionLabel(direction: RibbonSwipeDirection): string {
  return {
    "left-to-right": "左から右へスワイプ",
    "right-to-left": "右から左へスワイプ",
    "lower-left-to-upper-right": "左下から右上へスワイプ",
    "lower-right-to-upper-left": "右下から左上へスワイプ",
  }[direction];
}
