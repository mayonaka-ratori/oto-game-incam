import type {
  DiagonalLiftVariant,
  GestureEvent,
  RibbonSwipeDirection,
  SpotlightVariant,
} from "../gestures/gesture-types";
import type { ClapTrialDiagnostic } from "../gestures/clap-burst-state-machine";
import type { BloomTrialDiagnostic } from "../gestures/bloom-state-machine";
import type { DiagonalLiftTrialDiagnostic } from "../gestures/diagonal-lift-state-machine";
import type { LiftTrialDiagnostic } from "../gestures/lift-state-machine";
import type { SpotlightTrialDiagnostic } from "../gestures/spotlight-state-machine";

export type P1Gesture =
  | "air-tap"
  | "ribbon-swipe"
  | "bloom"
  | "lift"
  | "spotlight"
  | "diagonal-lift"
  | "clap";

export const P1_TRIAL_TIMEOUT_MS = 10_000;
/** Upper limit for settling into the start position of a readiness-gated trial. */
export const P1_READINESS_TIMEOUT_MS = 10_000;
export const P1_EARLY_WINDOW_MS = 500;
export const P1_TRIALS_PER_GESTURE = 10;
export const P1_FIVE_GESTURE_PROTOCOL_ID = "p1-five-gesture-50";
/** Routine protocol from 2026-09-19 to 2026-09-20: only the two gestures that had not passed. */
export const P1_REMAINING_TWO_PROTOCOL_ID = "p1-remaining-two-20";
/**
 * Routine protocol after 2026-09-20. The phone is held upright, where Bloom has no room to open
 * sideways, so the vertical Lift and the new ななめリフト take its place next to ribbon-swipe.
 */
export const P1_PORTRAIT_THREE_PROTOCOL_ID = "p1-portrait-three-30";
/** Short regression run for the three gestures whose confirmation is already complete. */
export const P1_REGRESSION_THREE_PROTOCOL_ID = "p1-regression-three-9";
export const P1_REMAINING_TWO_GESTURES: readonly P1Gesture[] = ["ribbon-swipe", "bloom"];
export const P1_PORTRAIT_THREE_GESTURES: readonly P1Gesture[] = ["ribbon-swipe", "lift", "diagonal-lift"];
export const P1_REGRESSION_GESTURES: readonly P1Gesture[] = ["air-tap", "lift", "spotlight"];
export const P1_REGRESSION_TRIALS_PER_GESTURE = 3;
/**
 * The ten ribbon-swipe directions of the five-gesture protocol. Every protocol that runs
 * ribbon-swipe takes the first n of them, so the same trial number always means the same
 * direction and results stay comparable across procedures.
 */
const RIBBON_SWIPE_DIRECTIONS: readonly RibbonSwipeDirection[] = [
  "left-to-right", "right-to-left",
  "left-to-right", "right-to-left",
  "left-to-right", "right-to-left",
  "lower-left-to-upper-right", "lower-right-to-upper-left",
  "lower-left-to-upper-right", "lower-right-to-upper-left",
];
/** Current MVP inputs. Their 8/10 results feed the P1-Controlled starting criterion. */
export const P1_CORE_GESTURES: readonly P1Gesture[] = ["air-tap", "ribbon-swipe", "bloom"];
/** Experimental candidates measured to choose the Interaction POC vocabulary. */
export const P1_CANDIDATE_GESTURES: readonly P1Gesture[] = ["lift", "spotlight", "diagonal-lift"];
/** Initial stability requirement before the count-in. Measured values may change it in a later session. */
export const P1_READINESS_STABLE_MS = { bloom: 200, lift: 180, "diagonal-lift": 180 } as const;

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

export type P1PauseReason = "manual" | "page-hidden" | "camera-stopped";
export type P1TimeoutPhase = "readiness" | "recognition";

export interface P1ActiveTrialTiming {
  readonly preparedAtMs: number;
  /** Readiness-gated trials only: when both hands settled in the start position. */
  readonly readyAtMs: number | null;
  readonly windowOpenedAtMs: number;
  readonly targetTimeMs: number | null;
  readonly deadlineTimeMs: number;
}

export interface P1TrialTiming extends P1ActiveTrialTiming {
  readonly finishedAtMs: number;
}

export interface P1ReadinessTiming {
  readonly startedAtMs: number;
  readonly deadlineTimeMs: number;
  readonly requiredStableMs: number;
  readonly readyAtMs: number | null;
}

/** What the start-position check saw during the readiness phase of one attempt. */
export interface P1ReadinessDiagnostic {
  readonly frameCount: number;
  readonly twoHandFrameCount: number;
  readonly inZoneFrameCount: number;
  /** Longest continuous time the hands stayed settled in the start position. */
  readonly longestStableMs: number;
  readonly lastVisibleHands: number | null;
  readonly lastInZone: boolean | null;
}

export interface P1TrialDefinition {
  readonly id: string;
  readonly ordinal: number;
  readonly gesture: P1Gesture;
  readonly instruction: string;
  readonly airTapSide?: "left" | "right";
  readonly swipeDirection?: RibbonSwipeDirection;
  readonly spotlightVariant?: SpotlightVariant;
  readonly diagonalLiftVariant?: DiagonalLiftVariant;
  /** The count-in starts only after both hands settle in the start position. */
  readonly requiresReadiness?: boolean;
  readonly clapMode?: "contact" | "near-clap";
}

export interface P1BlockDefinition {
  readonly id: string;
  readonly index: number;
  readonly gesture: P1Gesture;
  readonly firstOrdinal: number;
  readonly lastOrdinal: number;
  readonly trialCount: number;
  /** Older exports used standard/extended; new sessions advance without mandatory rest. */
  readonly restAfter: "standard" | "extended" | "none";
}

export interface P1PauseRecord {
  readonly startedAtMs: number;
  readonly resumedAtMs: number | null;
  readonly reason: P1PauseReason;
  readonly abandonedTrialId: string | null;
}

export interface P1BlockRecord extends P1BlockDefinition {
  readonly startedAtMs: number | null;
  readonly finishedAtMs: number | null;
  /** Time between the previous block finishing and this block starting. */
  readonly restBeforeMs: number | null;
  readonly pausedMs: number;
  readonly pauses: readonly P1PauseRecord[];
}

export interface P1ProtocolDefinition {
  readonly id: string;
  readonly trialsPerGesture: number;
  readonly gestures: readonly P1Gesture[];
  readonly trials: readonly P1TrialDefinition[];
  readonly blocks: readonly P1BlockDefinition[];
}

export interface P1TrialExtras {
  readonly rejectionCount?: number;
  readonly trackingLossCount?: number;
  readonly readinessReasonCodes?: readonly string[];
  readonly readinessDiagnostic?: P1ReadinessDiagnostic;
  readonly clapDiagnostic?: ClapTrialDiagnostic;
  readonly bloomDiagnostic?: BloomTrialDiagnostic;
  readonly liftDiagnostic?: LiftTrialDiagnostic;
  readonly diagonalLiftDiagnostic?: DiagonalLiftTrialDiagnostic;
  readonly spotlightDiagnostic?: SpotlightTrialDiagnostic;
}

export interface P1TrialResult {
  readonly trial: P1TrialDefinition;
  /** 1 unless a pause abandoned earlier attempts of the same trial. */
  readonly attempt: number;
  readonly outcome: P1Outcome;
  readonly resolution: P1Resolution;
  /** Recognition timing. Null only when the readiness phase ended before the count-in. */
  readonly timing: P1TrialTiming | null;
  readonly readiness: P1ReadinessTiming | null;
  readonly timeoutPhase: P1TimeoutPhase | null;
  readonly finishedAtMs: number;
  readonly targetTimeMs: number | null;
  readonly event: GestureEvent | null;
  readonly offsetMs: number | null;
  readonly reasonCodes: readonly string[];
  /** Player-motion rejections recorded in this attempt's recognition window before it finished. */
  readonly rejectionCount: number;
  /** Tracking losses in the same window. They are machine-side failures and never count as rejections. */
  readonly trackingLossCount: number;
  /** Readiness-gated trials: what the start-position check saw before the count-in. */
  readonly readinessDiagnostic?: P1ReadinessDiagnostic;
  readonly clapDiagnostic?: ClapTrialDiagnostic;
  readonly bloomDiagnostic?: BloomTrialDiagnostic;
  readonly liftDiagnostic?: LiftTrialDiagnostic;
  readonly diagonalLiftDiagnostic?: DiagonalLiftTrialDiagnostic;
  readonly spotlightDiagnostic?: SpotlightTrialDiagnostic;
}

export interface P1PauseResult {
  readonly paused: boolean;
  readonly abandonedTrial: P1TrialDefinition | null;
}

export interface P1RunnerSnapshot {
  readonly id: string;
  readonly trialsPerGesture: number;
  readonly gestures: readonly P1Gesture[];
  readonly state: "idle" | "running" | "complete";
  readonly activeTrial: P1TrialDefinition | null;
  readonly activeTiming: P1ActiveTrialTiming | null;
  readonly activeReadiness: P1ReadinessTiming | null;
  readonly nextTrial: P1TrialDefinition | null;
  readonly completed: number;
  readonly total: number;
  readonly results: readonly P1TrialResult[];
  readonly falseTriggers: readonly GestureEvent[];
  /** Automatic false triggers of attempts that a pause discarded. Kept for the record, excluded from counts. */
  readonly abandonedFalseTriggers: readonly GestureEvent[];
  readonly blocks: readonly P1BlockRecord[];
  readonly currentBlockIndex: number | null;
  /** The next trial opens a block that the tester has not started yet. */
  readonly awaitingBlockStart: boolean;
  readonly paused: boolean;
}

interface MutablePauseRecord {
  readonly startedAtMs: number;
  resumedAtMs: number | null;
  readonly reason: P1PauseReason;
  readonly abandonedTrialId: string | null;
}

interface MutableBlockRecord {
  readonly definition: P1BlockDefinition;
  startedAtMs: number | null;
  finishedAtMs: number | null;
  restBeforeMs: number | null;
  readonly pauses: MutablePauseRecord[];
}

export const P1_FIVE_GESTURE_PROTOCOL: P1ProtocolDefinition = createP1ProtocolDefinition(
  buildFiveGestureTrials(),
  P1_FIVE_GESTURE_PROTOCOL_ID,
);

/** Default from 2026-09-19 to 2026-09-20: ribbon-swipe and Bloom, the two gestures short of 8/10. */
export const P1_REMAINING_TWO_PROTOCOL: P1ProtocolDefinition = createP1ProtocolDefinition(
  buildRemainingTwoTrials(),
  P1_REMAINING_TWO_PROTOCOL_ID,
);

/** Default since 2026-09-20: ribbon-swipe, Lift and ななめリフト, ten trials each in three blocks. */
export const P1_PORTRAIT_THREE_PROTOCOL: P1ProtocolDefinition = createP1ProtocolDefinition(
  buildPortraitThreeTrials(),
  P1_PORTRAIT_THREE_PROTOCOL_ID,
);

/** Re-checks air-tap, Lift and Spotlight after a change to timing constants or coordinates. */
export const P1_REGRESSION_THREE_PROTOCOL: P1ProtocolDefinition = createP1ProtocolDefinition(
  buildRegressionTrials(),
  P1_REGRESSION_THREE_PROTOCOL_ID,
);

export const P1_CONTROLLED_TRIALS: readonly P1TrialDefinition[] = P1_FIVE_GESTURE_PROTOCOL.trials;

export type P1ProtocolSelector = "portrait-three" | "remaining-two" | "five" | "regression";

/** Default when the query string names no protocol, or names one that does not exist. */
export const DEFAULT_P1_PROTOCOL_SELECTOR: P1ProtocolSelector = "portrait-three";

const P1_PROTOCOLS_BY_SELECTOR: Readonly<Record<P1ProtocolSelector, P1ProtocolDefinition>> = {
  "portrait-three": P1_PORTRAIT_THREE_PROTOCOL,
  "remaining-two": P1_REMAINING_TWO_PROTOCOL,
  five: P1_FIVE_GESTURE_PROTOCOL,
  regression: P1_REGRESSION_THREE_PROTOCOL,
};

function isP1ProtocolSelector(value: string): value is P1ProtocolSelector {
  return Object.prototype.hasOwnProperty.call(P1_PROTOCOLS_BY_SELECTOR, value);
}

/** Reads `?protocol=` and falls back to the default for a missing or unknown value. */
export function resolveP1ProtocolSelector(search: string): P1ProtocolSelector {
  const requested = new URLSearchParams(search).get("protocol");
  if (requested === null) return DEFAULT_P1_PROTOCOL_SELECTOR;
  const normalized = requested.trim().toLowerCase();
  return isP1ProtocolSelector(normalized) ? normalized : DEFAULT_P1_PROTOCOL_SELECTOR;
}

export function resolveP1Protocol(search: string): P1ProtocolDefinition {
  return P1_PROTOCOLS_BY_SELECTOR[resolveP1ProtocolSelector(search)];
}

/**
 * Retained only for replaying and interpreting pre-Bloom P1 sessions.
 * It is deliberately not part of the current protocol.
 */
export const P1_LEGACY_CLAP_TRIALS: readonly P1TrialDefinition[] = buildLegacyClapTrials();

export class Phase1ControlledRunner {
  readonly #protocol: P1ProtocolDefinition;
  readonly #blockIndexByTrial: readonly number[];
  readonly #results: P1TrialResult[] = [];
  readonly #falseTriggers: GestureEvent[] = [];
  readonly #abandonedFalseTriggers: GestureEvent[] = [];
  /** Automatic false triggers of the active attempt; a pause moves them to the abandoned list. */
  readonly #attemptFalseTriggers = new Set<GestureEvent>();
  readonly #abandonedAttempts = new Map<string, number>();
  #blocks: MutableBlockRecord[];
  #activeTrial: P1TrialDefinition | null = null;
  #activeTiming: P1ActiveTrialTiming | null = null;
  #activeReadiness: P1ReadinessTiming | null = null;
  #state: P1RunnerSnapshot["state"] = "idle";
  #paused = false;

  constructor(protocol: P1ProtocolDefinition | readonly P1TrialDefinition[] = P1_FIVE_GESTURE_PROTOCOL) {
    this.#protocol = isProtocolDefinition(protocol) ? protocol : createP1ProtocolDefinition(protocol);
    this.#blockIndexByTrial = mapTrialsToBlocks(this.#protocol.blocks);
    this.#blocks = createBlockRecords(this.#protocol.blocks);
  }

  start(): void {
    this.#results.length = 0;
    this.#falseTriggers.length = 0;
    this.#abandonedFalseTriggers.length = 0;
    this.#attemptFalseTriggers.clear();
    this.#abandonedAttempts.clear();
    this.#blocks = createBlockRecords(this.#protocol.blocks);
    this.#activeTrial = null;
    this.#activeTiming = null;
    this.#activeReadiness = null;
    this.#paused = false;
    this.#state = "running";
  }

  /** Records that the tester started the next block. Trials of a block begin only after this. */
  startBlock(nowMs: number): boolean {
    if (this.#state !== "running" || this.#paused || this.#activeTrial !== null) return false;
    const blockIndex = this.#blockIndexByTrial[this.#results.length];
    const block = blockIndex === undefined ? undefined : this.#blocks[blockIndex];
    if (blockIndex === undefined || block === undefined || block.startedAtMs !== null) return false;
    this.#markBlockStarted(blockIndex, nowMs);
    return true;
  }

  /**
   * Starts the next trial. For readiness-gated trials the target argument is
   * ignored: the trial waits in the readiness phase until startRecognition().
   */
  beginNextTrial(targetTimeMs: number | null, preparedAtMs = 0): P1TrialDefinition | null {
    if (this.#state !== "running" || this.#paused || this.#activeTrial !== null) return null;
    const index = this.#results.length;
    const trial = this.#protocol.trials[index] ?? null;
    if (trial === null) {
      this.#state = "complete";
      return null;
    }
    const blockIndex = this.#blockIndexByTrial[index];
    if (blockIndex !== undefined && this.#blocks[blockIndex]?.startedAtMs === null) {
      this.#markBlockStarted(blockIndex, preparedAtMs);
    }
    this.#activeTrial = trial;
    this.#attemptFalseTriggers.clear();
    if (trial.requiresReadiness === true) {
      this.#activeTiming = null;
      this.#activeReadiness = {
        startedAtMs: preparedAtMs,
        deadlineTimeMs: preparedAtMs + P1_READINESS_TIMEOUT_MS,
        requiredStableMs: readinessStableMs(trial.gesture),
        readyAtMs: null,
      };
    } else {
      this.#activeReadiness = null;
      this.#activeTiming = recognitionTiming(preparedAtMs, null, targetTimeMs);
    }
    return trial;
  }

  /** Ends the readiness phase; the recognition window is derived from the scheduled GO target. */
  startRecognition(readyAtMs: number, targetTimeMs: number | null): boolean {
    const readiness = this.#activeReadiness;
    if (this.#activeTrial === null || readiness === null || this.#activeTiming !== null) return false;
    this.#activeReadiness = { ...readiness, readyAtMs };
    this.#activeTiming = recognitionTiming(readiness.startedAtMs, readyAtMs, targetTimeMs);
    return true;
  }

  acceptEvent(event: GestureEvent, extras: P1TrialExtras = {}): boolean {
    const trial = this.#activeTrial;
    const timing = this.#activeTiming;
    if (trial === null || timing === null) return false;
    if (event.eventTimeMs < timing.windowOpenedAtMs || event.eventTimeMs > timing.deadlineTimeMs) return false;
    if (!eventMatchesTrial(event, trial)) {
      this.#falseTriggers.push(event);
      this.#attemptFalseTriggers.add(event);
      return false;
    }
    return this.#finish("success", "gesture-event", event, event.reasonCodes, event.eventTimeMs, extras, null);
  }

  recordOutcome(
    outcome: Exclude<P1Outcome, "success">,
    reasonCodes: readonly string[] = [],
    finishedAtMs = performance.now(),
    extras: P1TrialExtras = {},
  ): boolean {
    return this.#finish(outcome, "manual-classification", null, reasonCodes, finishedAtMs, extras, null);
  }

  skip(finishedAtMs = performance.now(), extras: P1TrialExtras = {}): boolean {
    return this.#finish("unclassified", "manual-skip", null, ["manual-skip"], finishedAtMs, extras, null);
  }

  /** Resolves the active deadline: the readiness deadline before the count-in, otherwise the recognition deadline. */
  timeout(finishedAtMs = performance.now(), extras: P1TrialExtras = {}): boolean {
    if (this.#activeTrial !== null && this.#activeTiming === null && this.#activeReadiness !== null) {
      return this.#finish(
        "unclassified",
        "trial-timeout",
        null,
        ["readiness-timeout", ...(extras.readinessReasonCodes ?? [])],
        finishedAtMs,
        extras,
        "readiness",
      );
    }
    return this.#finish("unclassified", "trial-timeout", null, ["trial-timeout"], finishedAtMs, extras, "recognition");
  }

  /** Pauses inside a started block. An active attempt is discarded and repeated after resume. */
  pause(nowMs: number, reason: P1PauseReason = "manual"): P1PauseResult {
    const notPaused: P1PauseResult = { paused: false, abandonedTrial: null };
    if (this.#state !== "running" || this.#paused) return notPaused;
    const blockIndex = this.#blockIndexByTrial[this.#results.length];
    const block = blockIndex === undefined ? undefined : this.#blocks[blockIndex];
    if (block === undefined || block.startedAtMs === null || block.finishedAtMs !== null) return notPaused;
    const abandoned = this.#activeTrial;
    if (abandoned !== null) {
      this.#abandonedAttempts.set(abandoned.id, (this.#abandonedAttempts.get(abandoned.id) ?? 0) + 1);
      // The retry is judged on its own, so automatic false triggers of the discarded attempt leave the counts.
      for (const event of this.#attemptFalseTriggers) {
        const index = this.#falseTriggers.indexOf(event);
        if (index >= 0) this.#falseTriggers.splice(index, 1);
        this.#abandonedFalseTriggers.push(event);
      }
    }
    this.#attemptFalseTriggers.clear();
    this.#activeTrial = null;
    this.#activeTiming = null;
    this.#activeReadiness = null;
    block.pauses.push({ startedAtMs: nowMs, resumedAtMs: null, reason, abandonedTrialId: abandoned?.id ?? null });
    this.#paused = true;
    return { paused: true, abandonedTrial: abandoned };
  }

  resume(nowMs: number): boolean {
    if (!this.#paused) return false;
    const blockIndex = this.#blockIndexByTrial[this.#results.length];
    const pause = blockIndex === undefined ? undefined : this.#blocks[blockIndex]?.pauses.at(-1);
    if (pause !== undefined && pause.resumedAtMs === null) pause.resumedAtMs = nowMs;
    this.#paused = false;
    return true;
  }

  recordFalseTrigger(event: GestureEvent): void {
    this.#falseTriggers.push(event);
  }

  get activeTrial(): P1TrialDefinition | null {
    return this.#activeTrial;
  }

  get activeTiming(): P1ActiveTrialTiming | null {
    return this.#activeTiming;
  }

  get activeReadiness(): P1ReadinessTiming | null {
    return this.#activeReadiness;
  }

  /** Attempt number of the active (or next) trial. */
  get activeAttempt(): number {
    const trial = this.#activeTrial ?? this.#protocol.trials[this.#results.length];
    return trial === undefined ? 1 : (this.#abandonedAttempts.get(trial.id) ?? 0) + 1;
  }

  get snapshot(): P1RunnerSnapshot {
    const index = this.#results.length;
    const nextTrial = this.#activeTrial ?? this.#protocol.trials[index] ?? null;
    const currentBlockIndex = this.#state === "running" ? this.#blockIndexByTrial[index] ?? null : null;
    const currentBlock = currentBlockIndex === null ? undefined : this.#blocks[currentBlockIndex];
    return {
      id: this.#protocol.id,
      trialsPerGesture: this.#protocol.trialsPerGesture,
      gestures: [...this.#protocol.gestures],
      state: this.#state,
      activeTrial: this.#activeTrial,
      activeTiming: this.#activeTiming === null ? null : { ...this.#activeTiming },
      activeReadiness: this.#activeReadiness === null ? null : { ...this.#activeReadiness },
      nextTrial,
      completed: index,
      total: this.#protocol.trials.length,
      results: [...this.#results],
      falseTriggers: [...this.#falseTriggers],
      abandonedFalseTriggers: [...this.#abandonedFalseTriggers],
      blocks: this.#blocks.map(blockSnapshot),
      currentBlockIndex,
      awaitingBlockStart: this.#state === "running"
        && !this.#paused
        && this.#activeTrial === null
        && currentBlock !== undefined
        && currentBlock.startedAtMs === null,
      paused: this.#paused,
    };
  }

  #finish(
    outcome: P1Outcome,
    resolution: P1Resolution,
    event: GestureEvent | null,
    reasonCodes: readonly string[],
    finishedAtMs: number,
    extras: P1TrialExtras,
    timeoutPhase: P1TimeoutPhase | null,
  ): boolean {
    const trial = this.#activeTrial;
    const timing = this.#activeTiming;
    const readiness = this.#activeReadiness;
    if (trial === null || (timing === null && readiness === null)) return false;
    const offsetMs = event === null || timing === null || timing.targetTimeMs === null
      ? null
      : event.eventTimeMs - timing.targetTimeMs;
    this.#results.push({
      trial,
      attempt: (this.#abandonedAttempts.get(trial.id) ?? 0) + 1,
      outcome,
      resolution,
      timing: timing === null ? null : { ...timing, finishedAtMs },
      readiness: readiness === null ? null : { ...readiness },
      timeoutPhase,
      finishedAtMs,
      targetTimeMs: timing?.targetTimeMs ?? null,
      event,
      offsetMs,
      reasonCodes: [...reasonCodes],
      rejectionCount: extras.rejectionCount ?? 0,
      trackingLossCount: extras.trackingLossCount ?? 0,
      ...(extras.readinessDiagnostic === undefined ? {} : { readinessDiagnostic: { ...extras.readinessDiagnostic } }),
      ...(extras.clapDiagnostic === undefined ? {} : { clapDiagnostic: cloneClapDiagnostic(extras.clapDiagnostic) }),
      ...(extras.bloomDiagnostic === undefined ? {} : { bloomDiagnostic: cloneBloomDiagnostic(extras.bloomDiagnostic) }),
      ...(extras.liftDiagnostic === undefined ? {} : { liftDiagnostic: extras.liftDiagnostic }),
      ...(extras.diagonalLiftDiagnostic === undefined
        ? {}
        : { diagonalLiftDiagnostic: extras.diagonalLiftDiagnostic }),
      ...(extras.spotlightDiagnostic === undefined ? {} : { spotlightDiagnostic: extras.spotlightDiagnostic }),
    });
    this.#activeTrial = null;
    this.#activeTiming = null;
    this.#activeReadiness = null;
    this.#attemptFalseTriggers.clear();
    const index = this.#results.length - 1;
    const blockIndex = this.#blockIndexByTrial[index];
    if (blockIndex !== undefined && this.#blockIndexByTrial[index + 1] !== blockIndex) {
      const block = this.#blocks[blockIndex];
      if (block !== undefined) block.finishedAtMs = finishedAtMs;
    }
    if (this.#results.length >= this.#protocol.trials.length) this.#state = "complete";
    return true;
  }

  #markBlockStarted(blockIndex: number, nowMs: number): void {
    const block = this.#blocks[blockIndex];
    if (block === undefined) return;
    block.startedAtMs = nowMs;
    const previousFinishedAtMs = this.#blocks[blockIndex - 1]?.finishedAtMs ?? null;
    block.restBeforeMs = previousFinishedAtMs === null ? null : Math.max(0, nowMs - previousFinishedAtMs);
  }
}

export function createP1ProtocolDefinition(
  trials: readonly P1TrialDefinition[],
  id = "p1-custom",
): P1ProtocolDefinition {
  validateTrials(trials);
  const gestures = [...new Set(trials.map(({ gesture }) => gesture))];
  const counts = gestures.map((gesture) => trials.filter((trial) => trial.gesture === gesture).length);
  const first = counts[0] ?? 0;
  return {
    id,
    trialsPerGesture: counts.every((count) => count === first) ? first : 0,
    gestures,
    trials: [...trials],
    blocks: deriveBlocks(trials),
  };
}

export function eventMatchesTrial(event: GestureEvent, trial: P1TrialDefinition): boolean {
  if (trial.gesture === "bloom") return event.gestureType === "bloom";
  if (trial.gesture === "lift") return event.gestureType === "lift";
  if (trial.gesture === "diagonal-lift") {
    return event.gestureType === "diagonal-lift" && event.quality.diagonalLiftVariant === trial.diagonalLiftVariant;
  }
  if (trial.gesture === "spotlight") {
    return event.gestureType === "spotlight" && event.quality.spotlightVariant === trial.spotlightVariant;
  }
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

export function swipeDirectionLabel(direction: RibbonSwipeDirection): string {
  return {
    "left-to-right": "左から右へスワイプ",
    "right-to-left": "右から左へスワイプ",
    "lower-left-to-upper-right": "左下から右上へスワイプ",
    "lower-right-to-upper-left": "右下から左上へスワイプ",
  }[direction];
}

export function spotlightVariantLabel(variant: SpotlightVariant): string {
  return variant === "left-up-right-down" ? "左手を上・右手を下" : "右手を上・左手を下";
}

/** Named as the player sees it on the mirrored preview. */
export function diagonalLiftVariantLabel(variant: DiagonalLiftVariant): string {
  return variant === "up-right" ? "右上へ" : "左上へ";
}

type P1TrialTemplate = Omit<P1TrialDefinition, "ordinal">;

/** Every protocol builds its trials here, so the same gesture always has the same definition. */
function airTapTrials(count: number): readonly P1TrialTemplate[] {
  return Array.from({ length: count }, (_, index) => {
    const side = index % 2 === 0 ? "left" as const : "right" as const;
    return {
      id: `air-tap-${index + 1}`,
      gesture: "air-tap" as const,
      airTapSide: side,
      instruction: `${side === "left" ? "左" : "右"}手の人差し指を、外からリングの中へ通す`,
    };
  });
}

function ribbonSwipeTrials(count: number): readonly P1TrialTemplate[] {
  return RIBBON_SWIPE_DIRECTIONS.slice(0, count).map((direction, index) => ({
    id: `ribbon-swipe-${index + 1}`,
    gesture: "ribbon-swipe" as const,
    swipeDirection: direction,
    instruction: `${swipeDirectionLabel(direction)}、片手を帯に沿って素早く動かす`,
  }));
}

function bloomTrials(count: number): readonly P1TrialTemplate[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `bloom-${index + 1}`,
    gesture: "bloom" as const,
    requiresReadiness: true,
    instruction: "両手を離して画面中央の左右の丸印に合わせて止め、GOで左右斜め上へ開く",
  }));
}

function liftTrials(count: number): readonly P1TrialTemplate[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `lift-${index + 1}`,
    gesture: "lift" as const,
    requiresReadiness: true,
    instruction: "両手を画面の下側に構えて止め、GOで両手をそろえて真上へ上げる",
  }));
}

/** Alternates the two diagonals, starting with the top right, so ten trials are five of each. */
function diagonalLiftTrials(count: number): readonly P1TrialTemplate[] {
  return Array.from({ length: count }, (_, index) => {
    const variant: DiagonalLiftVariant = index % 2 === 0 ? "up-right" : "up-left";
    return {
      id: `diagonal-lift-${index + 1}`,
      gesture: "diagonal-lift" as const,
      diagonalLiftVariant: variant,
      requiresReadiness: true,
      instruction: `両手を下側の左右に離して構えて止め、GOで両手をそろえて${diagonalLiftVariantLabel(variant)}動かす`,
    };
  });
}

function spotlightTrials(
  count: number,
  firstVariant: SpotlightVariant = "left-up-right-down",
): readonly P1TrialTemplate[] {
  const other: SpotlightVariant = firstVariant === "left-up-right-down"
    ? "right-up-left-down"
    : "left-up-right-down";
  return Array.from({ length: count }, (_, index) => {
    const variant = index % 2 === 0 ? firstVariant : other;
    return {
      id: `spotlight-${index + 1}`,
      gesture: "spotlight" as const,
      spotlightVariant: variant,
      instruction: `GOで${spotlightVariantLabel(variant)}へ動かし、その形で一瞬止める`,
    };
  });
}

function numberTrials(groups: readonly (readonly P1TrialTemplate[])[]): readonly P1TrialDefinition[] {
  return groups.flat().map((trial, index) => ({ ...trial, ordinal: index + 1 }));
}

function buildFiveGestureTrials(): readonly P1TrialDefinition[] {
  return numberTrials([
    airTapTrials(P1_TRIALS_PER_GESTURE),
    ribbonSwipeTrials(P1_TRIALS_PER_GESTURE),
    bloomTrials(P1_TRIALS_PER_GESTURE),
    liftTrials(P1_TRIALS_PER_GESTURE),
    spotlightTrials(P1_TRIALS_PER_GESTURE),
  ]);
}

function buildRemainingTwoTrials(): readonly P1TrialDefinition[] {
  return numberTrials([
    ribbonSwipeTrials(P1_TRIALS_PER_GESTURE),
    bloomTrials(P1_TRIALS_PER_GESTURE),
  ]);
}

/**
 * The upright-phone routine: the same ten ribbon-swipe trials as every other procedure, the
 * unchanged Lift, and ななめリフト alternating between the two diagonals.
 */
function buildPortraitThreeTrials(): readonly P1TrialDefinition[] {
  return numberTrials([
    ribbonSwipeTrials(P1_TRIALS_PER_GESTURE),
    liftTrials(P1_TRIALS_PER_GESTURE),
    diagonalLiftTrials(P1_TRIALS_PER_GESTURE),
  ]);
}

/**
 * Three trials cannot split a side evenly, so air-tap starts on the left and spotlight starts on
 * the right. Across the six two-sided trials each leading side appears three times.
 */
function buildRegressionTrials(): readonly P1TrialDefinition[] {
  return numberTrials([
    airTapTrials(P1_REGRESSION_TRIALS_PER_GESTURE),
    liftTrials(P1_REGRESSION_TRIALS_PER_GESTURE),
    spotlightTrials(P1_REGRESSION_TRIALS_PER_GESTURE, "right-up-left-down"),
  ]);
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

/** Trial ids and ordinals identify results and blocks, and only Bloom, Lift and ななめリフト wait for readiness. */
function validateTrials(trials: readonly P1TrialDefinition[]): void {
  const ids = new Set<string>();
  const ordinals = new Set<number>();
  for (const trial of trials) {
    if (ids.has(trial.id)) throw new RangeError(`P1 trial id is duplicated: ${trial.id}`);
    if (ordinals.has(trial.ordinal)) throw new RangeError(`P1 trial ordinal is duplicated: ${trial.ordinal}`);
    if (trial.requiresReadiness === true && readinessStableMs(trial.gesture) === 0) {
      throw new RangeError(`${trial.gesture} has no readiness check: ${trial.id}`);
    }
    ids.add(trial.id);
    ordinals.add(trial.ordinal);
  }
}

/** Consecutive trials of the same gesture form one block. */
function deriveBlocks(trials: readonly P1TrialDefinition[]): readonly P1BlockDefinition[] {
  const blocks: P1BlockDefinition[] = [];
  let start = 0;
  for (let index = 1; index <= trials.length; index += 1) {
    const previous = trials[index - 1];
    const current = trials[index];
    const first = trials[start];
    if (previous === undefined || first === undefined) continue;
    if (current !== undefined && current.gesture === previous.gesture) continue;
    const number = blocks.length + 1;
    blocks.push({
      id: `block-${number}-${previous.gesture}`,
      index: number,
      gesture: previous.gesture,
      firstOrdinal: first.ordinal,
      lastOrdinal: previous.ordinal,
      trialCount: index - start,
      restAfter: "none",
    });
    start = index;
  }
  return blocks;
}

function isProtocolDefinition(
  value: P1ProtocolDefinition | readonly P1TrialDefinition[],
): value is P1ProtocolDefinition {
  return !Array.isArray(value);
}

function recognitionTiming(
  preparedAtMs: number,
  readyAtMs: number | null,
  targetTimeMs: number | null,
): P1ActiveTrialTiming {
  const base = readyAtMs ?? preparedAtMs;
  return {
    preparedAtMs,
    readyAtMs,
    windowOpenedAtMs: targetTimeMs === null ? base : targetTimeMs - P1_EARLY_WINDOW_MS,
    targetTimeMs,
    deadlineTimeMs: (targetTimeMs ?? base) + P1_TRIAL_TIMEOUT_MS,
  };
}

function readinessStableMs(gesture: P1Gesture): number {
  if (gesture === "bloom") return P1_READINESS_STABLE_MS.bloom;
  if (gesture === "lift") return P1_READINESS_STABLE_MS.lift;
  if (gesture === "diagonal-lift") return P1_READINESS_STABLE_MS["diagonal-lift"];
  return 0;
}

function mapTrialsToBlocks(blocks: readonly P1BlockDefinition[]): readonly number[] {
  return blocks.flatMap((block, index) => Array.from({ length: block.trialCount }, () => index));
}

function createBlockRecords(blocks: readonly P1BlockDefinition[]): MutableBlockRecord[] {
  return blocks.map((definition) => ({
    definition,
    startedAtMs: null,
    finishedAtMs: null,
    restBeforeMs: null,
    pauses: [],
  }));
}

function blockSnapshot(record: MutableBlockRecord): P1BlockRecord {
  return {
    ...record.definition,
    startedAtMs: record.startedAtMs,
    finishedAtMs: record.finishedAtMs,
    restBeforeMs: record.restBeforeMs,
    pausedMs: record.pauses.reduce((sum, pause) => (
      sum + (pause.resumedAtMs === null ? 0 : Math.max(0, pause.resumedAtMs - pause.startedAtMs))
    ), 0),
    pauses: record.pauses.map((pause) => ({ ...pause })),
  };
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
    identitySwapCount: diagnostic.identitySwapCount,
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
