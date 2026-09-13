import type { TrackedHandFrame } from "../tracking/derived-tracking-types";
import type { Handedness } from "../tracking/tracking-types";
import {
  createGestureEventId,
  type GestureEvaluation,
  type GestureEvent,
  type GestureRejection,
} from "./gesture-types";

export interface ClapBurstConfig {
  readonly armDistance?: number;
  readonly triggerDistance?: number;
  readonly contactLikeDistance?: number;
  readonly releaseDistance?: number;
  readonly minimumConvergenceSpeed?: number;
  readonly occlusionGraceMs?: number;
}

export type ClapDiagnosticReasonCode =
  | "no-occlusion"
  | "occlusion-predicted"
  | "no-two-hand-observation"
  | "trigger-distance-not-reached"
  | "contact-like-distance-not-reached"
  | "convergence-speed-below-minimum"
  | "occlusion-distance-too-far"
  | "occlusion-grace-expired"
  | "reacquired-before-prediction";

export interface ClapDiagnosticHand {
  readonly trackId: string;
  readonly handedness: Handedness;
  readonly observedHandedness: Handedness;
}

export interface ClapOcclusionDiagnostic {
  readonly lastTwoHandObservedAtMs: number | null;
  readonly startedAtMs: number;
  readonly reacquiredAtMs: number | null;
  readonly durationMs: number | null;
  readonly before: readonly ClapDiagnosticHand[];
  readonly after: readonly ClapDiagnosticHand[];
}

export interface ClapOcclusionPredictionDiagnostic {
  readonly status: "not-needed" | "succeeded" | "failed";
  readonly reasonCodes: readonly ClapDiagnosticReasonCode[];
}

export interface ClapTrialDiagnostic {
  readonly observationFrameCounts: {
    readonly zeroHands: number;
    readonly oneHand: number;
    readonly twoHands: number;
  };
  readonly lastTwoHandObservedAtMs: number | null;
  readonly minimumPalmDistance: {
    readonly distance: number;
    readonly atMs: number;
    readonly hands: readonly ClapDiagnosticHand[];
  } | null;
  readonly maximumConvergenceSpeed: number;
  readonly convergenceSpeedAtTriggerDistance: number | null;
  readonly triggerDistanceReachedAtMs: number | null;
  readonly contactLikeDistanceReachedAtMs: number | null;
  readonly identityConflictCount: number;
  readonly identityConflictCountBeforeContact: number;
  readonly latestOcclusion: ClapOcclusionDiagnostic | null;
  readonly occlusionPrediction: ClapOcclusionPredictionDiagnostic;
}

type Phase = "idle" | "armed" | "compressed";

interface MutableOcclusionDiagnostic {
  readonly lastTwoHandObservedAtMs: number | null;
  readonly startedAtMs: number;
  reacquiredAtMs: number | null;
  durationMs: number | null;
  readonly before: readonly ClapDiagnosticHand[];
  after: readonly ClapDiagnosticHand[];
  readonly predictionCandidate: boolean;
  predictionSucceeded: boolean;
  predictionFailureReasons: readonly ClapDiagnosticReasonCode[];
}

export class ClapBurstStateMachine {
  readonly #config: Required<ClapBurstConfig>;
  #phase: Phase = "idle";
  #lastDistance: number | null = null;
  #lastTimeMs: number | null = null;
  #lastConvergenceSpeed = 0;
  #activeHandIds: readonly string[] = [];
  #observationFrameCounts = { zeroHands: 0, oneHand: 0, twoHands: 0 };
  #lastTwoHandObservedAtMs: number | null = null;
  #lastTwoHandIdentities: readonly ClapDiagnosticHand[] = [];
  #minimumPalmDistance: ClapTrialDiagnostic["minimumPalmDistance"] = null;
  #maximumConvergenceSpeed = 0;
  #convergenceSpeedAtTriggerDistance: number | null = null;
  #triggerDistanceReachedAtMs: number | null = null;
  #contactLikeDistanceReachedAtMs: number | null = null;
  #identityConflictCount = 0;
  #identityConflictCountAtTriggerDistance: number | null = null;
  #latestOcclusion: MutableOcclusionDiagnostic | null = null;
  #occlusionPredictionStatus: ClapOcclusionPredictionDiagnostic["status"] = "not-needed";
  #occlusionPredictionReasons: readonly ClapDiagnosticReasonCode[] = ["no-occlusion"];

  constructor(config: ClapBurstConfig = {}) {
    this.#config = {
      armDistance: config.armDistance ?? 0.34,
      triggerDistance: config.triggerDistance ?? 0.14,
      contactLikeDistance: config.contactLikeDistance ?? 0.075,
      releaseDistance: config.releaseDistance ?? 0.3,
      minimumConvergenceSpeed: config.minimumConvergenceSpeed ?? 0.28,
      occlusionGraceMs: config.occlusionGraceMs ?? 150,
    };
  }

  process(frame: TrackedHandFrame): GestureEvaluation {
    const events: GestureEvent[] = [];
    const rejections: GestureRejection[] = [];
    this.#recordObservation(frame);
    if (frame.hands.length < 2) {
      this.#handleOcclusion(frame, events, rejections);
      return { frame, events, rejections };
    }
    this.#handleReacquisition(frame);
    const [first, second] = frame.hands;
    if (first === undefined || second === undefined) return { frame, events, rejections };
    const distance = Math.hypot(
      first.palmCenter.x - second.palmCenter.x,
      first.palmCenter.y - second.palmCenter.y,
    );
    const deltaMs = this.#lastTimeMs === null ? 0 : frame.captureTimeMs - this.#lastTimeMs;
    const convergenceSpeed = deltaMs > 0 && this.#lastDistance !== null
      ? (this.#lastDistance - distance) * 1_000 / deltaMs
      : 0;
    const handIds = [first.trackId, second.trackId].sort();
    const convergenceForDecision = Math.max(convergenceSpeed, this.#lastConvergenceSpeed);
    this.#maximumConvergenceSpeed = Math.max(
      this.#maximumConvergenceSpeed,
      Math.max(0, convergenceSpeed),
      Math.max(0, this.#lastConvergenceSpeed),
    );
    this.#recordDistanceDiagnostics(
      frame,
      distance,
      convergenceForDecision,
      [first, second].map(toDiagnosticHand),
    );
    if (distance >= this.#config.armDistance && this.#phase === "idle") {
      this.#phase = "armed";
      this.#activeHandIds = handIds;
    }
    if (this.#phase === "armed" && distance <= this.#config.triggerDistance) {
      if (convergenceForDecision >= this.#config.minimumConvergenceSpeed) {
        const eventTimeMs = interpolateDistanceTime(
          this.#lastTimeMs,
          frame.captureTimeMs,
          this.#lastDistance,
          distance,
          this.#config.triggerDistance,
        );
        const contactLike = distance <= this.#config.contactLikeDistance;
        events.push({
          id: createGestureEventId("clap"),
          gestureType: "clap",
          eventTimeMs,
          handIds,
          confidence: clamp01(0.62 + convergenceForDecision * 0.18),
          quality: {
            speed: convergenceForDecision,
            minimumHandDistance: distance,
            clapKind: contactLike ? "contact-like" : "near-clap",
          },
          trackingQuality: "observed",
          reasonCodes: [contactLike ? "contact-like-distance" : "near-clap-distance"],
        });
        this.#phase = "compressed";
        this.#activeHandIds = handIds;
      } else {
        rejections.push({
          gestureType: "clap",
          timeMs: frame.captureTimeMs,
          handIds,
          reasonCodes: ["movement-too-slow"],
        });
      }
    } else if (this.#phase === "compressed" && distance >= this.#config.releaseDistance && convergenceSpeed < 0) {
      events.push({
        id: createGestureEventId("burst"),
        gestureType: "burst",
        eventTimeMs: frame.captureTimeMs,
        handIds: this.#activeHandIds,
        confidence: clamp01(0.6 + Math.abs(convergenceSpeed) * 0.15),
        quality: { speed: Math.abs(convergenceSpeed), minimumHandDistance: distance },
        trackingQuality: "observed",
        reasonCodes: ["two-hand-release"],
      });
      this.#phase = "idle";
      this.#activeHandIds = [];
    }
    this.#lastDistance = distance;
    this.#lastTimeMs = frame.captureTimeMs;
    this.#lastConvergenceSpeed = convergenceSpeed;
    return { frame, events, rejections };
  }

  reset(): void {
    this.#resetGestureState();
    this.#observationFrameCounts = { zeroHands: 0, oneHand: 0, twoHands: 0 };
    this.#lastTwoHandObservedAtMs = null;
    this.#lastTwoHandIdentities = [];
    this.#minimumPalmDistance = null;
    this.#maximumConvergenceSpeed = 0;
    this.#convergenceSpeedAtTriggerDistance = null;
    this.#triggerDistanceReachedAtMs = null;
    this.#contactLikeDistanceReachedAtMs = null;
    this.#identityConflictCount = 0;
    this.#identityConflictCountAtTriggerDistance = null;
    this.#latestOcclusion = null;
    this.#occlusionPredictionStatus = "not-needed";
    this.#occlusionPredictionReasons = ["no-occlusion"];
  }

  get diagnostic(): ClapTrialDiagnostic {
    return this.#createDiagnostic(null);
  }

  diagnosticAt(finishedAtMs: number): ClapTrialDiagnostic {
    return this.#createDiagnostic(finishedAtMs);
  }

  #createDiagnostic(finishedAtMs: number | null): ClapTrialDiagnostic {
    const occlusionPrediction = this.#resolvedOcclusionPrediction(finishedAtMs);
    const latestOcclusion = this.#latestOcclusion;
    const latestOcclusionDurationMs = latestOcclusion === null || latestOcclusion.reacquiredAtMs !== null
      ? latestOcclusion?.durationMs ?? null
      : finishedAtMs === null
        ? null
        : Math.max(0, finishedAtMs - latestOcclusion.startedAtMs);
    return {
      observationFrameCounts: { ...this.#observationFrameCounts },
      lastTwoHandObservedAtMs: this.#lastTwoHandObservedAtMs,
      minimumPalmDistance: this.#minimumPalmDistance === null
        ? null
        : {
          distance: this.#minimumPalmDistance.distance,
          atMs: this.#minimumPalmDistance.atMs,
          hands: this.#minimumPalmDistance.hands.map(cloneDiagnosticHand),
        },
      maximumConvergenceSpeed: this.#maximumConvergenceSpeed,
      convergenceSpeedAtTriggerDistance: this.#convergenceSpeedAtTriggerDistance,
      triggerDistanceReachedAtMs: this.#triggerDistanceReachedAtMs,
      contactLikeDistanceReachedAtMs: this.#contactLikeDistanceReachedAtMs,
      identityConflictCount: this.#identityConflictCount,
      identityConflictCountBeforeContact: this.#identityConflictCountAtTriggerDistance
        ?? this.#identityConflictCount,
      latestOcclusion: latestOcclusion === null
        ? null
        : {
          lastTwoHandObservedAtMs: latestOcclusion.lastTwoHandObservedAtMs,
          startedAtMs: latestOcclusion.startedAtMs,
          reacquiredAtMs: latestOcclusion.reacquiredAtMs,
          durationMs: latestOcclusionDurationMs,
          before: latestOcclusion.before.map(cloneDiagnosticHand),
          after: latestOcclusion.after.map(cloneDiagnosticHand),
        },
      occlusionPrediction: {
        status: occlusionPrediction.status,
        reasonCodes: [...occlusionPrediction.reasonCodes],
      },
    };
  }

  #resetGestureState(): void {
    this.#phase = "idle";
    this.#lastDistance = null;
    this.#lastTimeMs = null;
    this.#lastConvergenceSpeed = 0;
    this.#activeHandIds = [];
  }

  #recordObservation(frame: TrackedHandFrame): void {
    if (frame.hands.length === 0) this.#observationFrameCounts.zeroHands += 1;
    else if (frame.hands.length === 1) this.#observationFrameCounts.oneHand += 1;
    else this.#observationFrameCounts.twoHands += 1;
    this.#identityConflictCount += frame.identityConflictCount;
    if (frame.hands.length >= 2) {
      this.#lastTwoHandObservedAtMs = frame.captureTimeMs;
      this.#lastTwoHandIdentities = frame.hands.slice(0, 2).map(toDiagnosticHand);
    } else if (this.#latestOcclusion === null || this.#latestOcclusion.reacquiredAtMs !== null) {
      this.#latestOcclusion = {
        lastTwoHandObservedAtMs: this.#lastTwoHandObservedAtMs,
        startedAtMs: frame.captureTimeMs,
        reacquiredAtMs: null,
        durationMs: null,
        before: this.#lastTwoHandIdentities.map(cloneDiagnosticHand),
        after: [],
        predictionCandidate: this.#phase === "armed",
        predictionSucceeded: false,
        predictionFailureReasons: [],
      };
      if (this.#phase === "armed") {
        this.#occlusionPredictionStatus = "failed";
        this.#occlusionPredictionReasons = [];
      }
    }
  }

  #recordDistanceDiagnostics(
    frame: TrackedHandFrame,
    distance: number,
    convergenceSpeed: number,
    hands: readonly ClapDiagnosticHand[],
  ): void {
    if (this.#minimumPalmDistance === null || distance < this.#minimumPalmDistance.distance) {
      this.#minimumPalmDistance = { distance, atMs: frame.captureTimeMs, hands };
    }
    if (distance <= this.#config.triggerDistance && this.#triggerDistanceReachedAtMs === null) {
      this.#triggerDistanceReachedAtMs = interpolateDistanceTime(
        this.#lastTimeMs,
        frame.captureTimeMs,
        this.#lastDistance,
        distance,
        this.#config.triggerDistance,
      );
      this.#convergenceSpeedAtTriggerDistance = convergenceSpeed;
      this.#identityConflictCountAtTriggerDistance = this.#identityConflictCount;
    }
    if (distance <= this.#config.contactLikeDistance && this.#contactLikeDistanceReachedAtMs === null) {
      this.#contactLikeDistanceReachedAtMs = interpolateDistanceTime(
        this.#lastTimeMs,
        frame.captureTimeMs,
        this.#lastDistance,
        distance,
        this.#config.contactLikeDistance,
      );
    }
  }

  #handleReacquisition(frame: TrackedHandFrame): void {
    const occlusion = this.#latestOcclusion;
    if (occlusion === null || occlusion.reacquiredAtMs !== null) return;
    occlusion.reacquiredAtMs = frame.captureTimeMs;
    occlusion.durationMs = Math.max(0, frame.captureTimeMs - occlusion.startedAtMs);
    occlusion.after = frame.hands.slice(0, 2).map(toDiagnosticHand);
    if (!occlusion.predictionCandidate || occlusion.predictionSucceeded) return;
    occlusion.predictionFailureReasons = this.#deriveOcclusionFailureReasons(occlusion.durationMs);
    if (occlusion.predictionFailureReasons.length === 0) {
      occlusion.predictionFailureReasons = ["reacquired-before-prediction"];
    }
    this.#occlusionPredictionStatus = "failed";
    this.#occlusionPredictionReasons = [...occlusion.predictionFailureReasons];
  }

  #handleOcclusion(
    frame: TrackedHandFrame,
    events: GestureEvent[],
    rejections: GestureRejection[],
  ): void {
    if (this.#phase !== "armed" || this.#lastTimeMs === null || this.#lastDistance === null) return;
    const elapsed = frame.captureTimeMs - this.#lastTimeMs;
    if (elapsed <= this.#config.occlusionGraceMs
      && this.#lastDistance <= this.#config.triggerDistance * 1.55
      && this.#lastConvergenceSpeed >= this.#config.minimumConvergenceSpeed) {
      const predictedDelayMs = Math.min(
        this.#config.occlusionGraceMs,
        Math.max(0, (this.#lastDistance - this.#config.triggerDistance) / this.#lastConvergenceSpeed * 1_000),
      );
      const predictedEventTimeMs = this.#lastTimeMs + predictedDelayMs;
      if (this.#triggerDistanceReachedAtMs === null) {
        this.#triggerDistanceReachedAtMs = predictedEventTimeMs;
        this.#convergenceSpeedAtTriggerDistance = this.#lastConvergenceSpeed;
        this.#identityConflictCountAtTriggerDistance = this.#identityConflictCount;
      }
      events.push({
        id: createGestureEventId("clap"),
        gestureType: "clap",
        eventTimeMs: predictedEventTimeMs,
        handIds: this.#activeHandIds,
        confidence: 0.58,
        quality: {
          speed: this.#lastConvergenceSpeed,
          minimumHandDistance: this.#lastDistance,
          clapKind: "occlusion-predicted",
        },
        trackingQuality: "short-occlusion-predicted",
        reasonCodes: ["occlusion-predicted"],
      });
      this.#phase = "compressed";
      const occlusion = this.#latestOcclusion;
      if (occlusion !== null) {
        occlusion.predictionSucceeded = true;
        occlusion.predictionFailureReasons = [];
      }
      this.#occlusionPredictionStatus = "succeeded";
      this.#occlusionPredictionReasons = ["occlusion-predicted"];
      return;
    }
    if (elapsed > this.#config.occlusionGraceMs) {
      const reasons = this.#deriveOcclusionFailureReasons(elapsed);
      const occlusion = this.#latestOcclusion;
      if (occlusion !== null) occlusion.predictionFailureReasons = reasons;
      this.#occlusionPredictionStatus = "failed";
      this.#occlusionPredictionReasons = reasons;
      rejections.push({
        gestureType: "clap",
        timeMs: frame.captureTimeMs,
        handIds: this.#activeHandIds,
        reasonCodes: ["tracking-lost"],
      });
      this.#resetGestureState();
    }
  }

  #deriveOcclusionFailureReasons(elapsedMs: number | null): ClapDiagnosticReasonCode[] {
    const reasons: ClapDiagnosticReasonCode[] = [];
    if (this.#triggerDistanceReachedAtMs === null) reasons.push("trigger-distance-not-reached");
    if (this.#contactLikeDistanceReachedAtMs === null) reasons.push("contact-like-distance-not-reached");
    if (this.#maximumConvergenceSpeed < this.#config.minimumConvergenceSpeed) {
      reasons.push("convergence-speed-below-minimum");
    }
    if (this.#lastDistance === null) reasons.push("no-two-hand-observation");
    else if (this.#lastDistance > this.#config.triggerDistance * 1.55) reasons.push("occlusion-distance-too-far");
    if (elapsedMs !== null && elapsedMs > this.#config.occlusionGraceMs) reasons.push("occlusion-grace-expired");
    return uniqueReasons(reasons);
  }

  #resolvedOcclusionPrediction(finishedAtMs: number | null): ClapOcclusionPredictionDiagnostic {
    if (this.#occlusionPredictionStatus === "not-needed"
      && this.#observationFrameCounts.twoHands === 0) {
      return { status: "failed", reasonCodes: ["no-two-hand-observation"] };
    }
    if (this.#occlusionPredictionStatus !== "failed" || this.#occlusionPredictionReasons.length > 0) {
      return {
        status: this.#occlusionPredictionStatus,
        reasonCodes: this.#occlusionPredictionReasons,
      };
    }
    const occlusion = this.#latestOcclusion;
    const elapsed = occlusion === null
      ? null
      : (occlusion.reacquiredAtMs ?? finishedAtMs ?? this.#lastTimeMs) === null
        ? null
        : (occlusion.reacquiredAtMs ?? finishedAtMs ?? this.#lastTimeMs)! - occlusion.startedAtMs;
    const reasons = this.#deriveOcclusionFailureReasons(elapsed);
    return {
      status: "failed",
      reasonCodes: reasons.length > 0 ? reasons : ["reacquired-before-prediction"],
    };
  }
}

function interpolateDistanceTime(
  previousTimeMs: number | null,
  currentTimeMs: number,
  previousDistance: number | null,
  currentDistance: number,
  targetDistance: number,
): number {
  if (previousTimeMs === null || previousDistance === null || previousDistance <= currentDistance) return currentTimeMs;
  const ratio = clamp01((previousDistance - targetDistance) / (previousDistance - currentDistance));
  return previousTimeMs + (currentTimeMs - previousTimeMs) * ratio;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function toDiagnosticHand(hand: {
  readonly trackId: string;
  readonly handedness: Handedness;
  readonly observedHandedness: Handedness;
}): ClapDiagnosticHand {
  return {
    trackId: hand.trackId,
    handedness: hand.handedness,
    observedHandedness: hand.observedHandedness,
  };
}

function cloneDiagnosticHand(hand: ClapDiagnosticHand): ClapDiagnosticHand {
  return { ...hand };
}

function uniqueReasons(reasons: readonly ClapDiagnosticReasonCode[]): ClapDiagnosticReasonCode[] {
  return [...new Set(reasons)];
}
