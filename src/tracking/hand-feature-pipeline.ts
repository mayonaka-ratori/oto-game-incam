import type { DetectedHand, Handedness, HandTrackingFrame, Landmark2D } from "./tracking-types";
import type {
  HandIdentityReason,
  TrackedHandFeatures,
  TrackedHandFrame,
  Vector3,
} from "./derived-tracking-types";

const PALM_INDICES = [0, 5, 9, 13, 17] as const;
const FINGERTIP_INDICES = [4, 8, 12, 16, 20] as const;

interface Observation {
  readonly source: DetectedHand;
  readonly palmCenter: Vector3;
  readonly indexTip: Vector3;
  readonly handScale: number;
  readonly openness: number;
}

interface TrackState {
  readonly id: string;
  lastSeenMs: number;
  palmCenter: Vector3;
  palmVelocity: Vector3;
  indexTip: Vector3;
  indexTipVelocity: Vector3;
  handednessEvidence: number;
  wasMissing: boolean;
}

export interface HandFeaturePipelineOptions {
  /** Lower bound of the tracking gap tolerance. The measured frame rate can only raise it. */
  readonly missingGraceMs?: number;
  readonly maximumAssignmentDistance?: number;
}

/** Floor of the tolerance, and the value used until enough intervals have been measured. */
export const TRACKING_GAP_TOLERANCE_MINIMUM_MS = 150;
/** Ceiling of the tolerance. A hand unseen this long is gone, however slow the device is. */
export const TRACKING_GAP_TOLERANCE_MAXIMUM_MS = 400;
/** A gap of up to this many frame intervals is the device being slow, not the hand leaving. */
export const TRACKING_GAP_INTERVAL_MULTIPLIER = 2.5;
/** How many recent intervals the median is taken over. About 1.5s at ten frames a second. */
export const TRACKING_INTERVAL_SAMPLE_LIMIT = 15;
/** Below this many samples the frame rate is not known yet, so the minimum is used. */
export const TRACKING_INTERVAL_MINIMUM_SAMPLES = 5;
/**
 * A hidden page, a paused camera or a resumed session leaves one huge interval. It says
 * nothing about the frame rate, so it never enters the median.
 */
export const TRACKING_INTERVAL_MAXIMUM_SAMPLE_MS = 1_000;

/**
 * How long a hand may stay unseen before it is treated as lost, from the recent frame intervals.
 * At 33ms intervals (thirty frames a second) 2.5 intervals is 83ms, so the result stays at the
 * 150ms minimum and nothing changes. At 99ms intervals it becomes about 248ms, so a single slow
 * frame no longer looks like a lost hand. Pure function of the intervals and the floor.
 */
export function trackingGapToleranceMs(
  intervalsMs: readonly number[],
  minimumMs: number = TRACKING_GAP_TOLERANCE_MINIMUM_MS,
): number {
  if (intervalsMs.length < TRACKING_INTERVAL_MINIMUM_SAMPLES) return minimumMs;
  const sorted = [...intervalsMs].sort((left, right) => left - right);
  const middle = sorted.length / 2;
  const median = sorted.length % 2 === 1
    ? sorted[(sorted.length - 1) / 2]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
  const measured = Math.min(TRACKING_GAP_TOLERANCE_MAXIMUM_MS, median * TRACKING_GAP_INTERVAL_MULTIPLIER);
  return Math.max(minimumMs, measured);
}

export class HandFeaturePipeline {
  readonly #tracks = new Map<string, TrackState>();
  readonly #missingGraceMs: number;
  readonly #maximumAssignmentDistance: number;
  /** Newest last, at most TRACKING_INTERVAL_SAMPLE_LIMIT entries. Capture times only. */
  readonly #frameIntervalsMs: number[] = [];
  #lastCaptureTimeMs: number | null = null;
  #nextTrackId = 1;

  constructor(options: HandFeaturePipelineOptions = {}) {
    this.#missingGraceMs = options.missingGraceMs ?? TRACKING_GAP_TOLERANCE_MINIMUM_MS;
    this.#maximumAssignmentDistance = options.maximumAssignmentDistance ?? 0.55;
  }

  process(frame: HandTrackingFrame): TrackedHandFrame {
    this.#recordFrameInterval(frame.captureTimeMs);
    const toleranceMs = this.trackingGapToleranceMs;
    this.#expireTracks(frame.captureTimeMs, toleranceMs);
    const observations = frame.hands.map(observe).filter((value): value is Observation => value !== null).slice(0, 2);
    const assignments = this.#assign(observations, frame.captureTimeMs);
    const hands = assignments.map(({ observation, track, isNew }) =>
      this.#updateTrack(track, observation, frame.captureTimeMs, isNew));
    const assignedIds = new Set(assignments.map(({ track }) => track.id));
    for (const track of this.#tracks.values()) {
      if (!assignedIds.has(track.id)) track.wasMissing = true;
    }
    return {
      frameId: frame.frameId,
      captureTimeMs: frame.captureTimeMs,
      hands,
      identityConflictCount: hands.filter((hand) => hand.identityReason === "handedness-conflict").length,
      trackingGapToleranceMs: toleranceMs,
    };
  }

  /** The tolerance the next frame would use, for a screen that wants to record it. */
  get trackingGapToleranceMs(): number {
    return trackingGapToleranceMs(this.#frameIntervalsMs, this.#missingGraceMs);
  }

  reset(): void {
    this.#tracks.clear();
    this.#frameIntervalsMs.length = 0;
    this.#lastCaptureTimeMs = null;
    this.#nextTrackId = 1;
  }

  /** Capture times only: the tolerance must never depend on drawn frames or on the wall clock. */
  #recordFrameInterval(captureTimeMs: number): void {
    const previous = this.#lastCaptureTimeMs;
    this.#lastCaptureTimeMs = captureTimeMs;
    if (previous === null) return;
    const intervalMs = captureTimeMs - previous;
    if (intervalMs <= 0 || intervalMs > TRACKING_INTERVAL_MAXIMUM_SAMPLE_MS) return;
    this.#frameIntervalsMs.push(intervalMs);
    if (this.#frameIntervalsMs.length > TRACKING_INTERVAL_SAMPLE_LIMIT) this.#frameIntervalsMs.shift();
  }

  #assign(
    observations: readonly Observation[],
    timeMs: number,
  ): Array<{ observation: Observation; track: TrackState; isNew: boolean }> {
    const available = [...this.#tracks.values()];
    if (observations.length === 0) return [];
    const pairings = minimumCostPairing(observations, available, timeMs, this.#maximumAssignmentDistance);
    const assignedObservations = new Set(pairings.map(({ observationIndex }) => observationIndex));
    const result = pairings.map(({ observationIndex, trackIndex }) => ({
      observation: observations[observationIndex]!,
      track: available[trackIndex]!,
      isNew: false,
    }));
    observations.forEach((observation, observationIndex) => {
      if (assignedObservations.has(observationIndex)) return;
      const track = createTrack(`hand-${this.#nextTrackId++}`, observation, timeMs);
      this.#tracks.set(track.id, track);
      result.push({ observation, track, isNew: true });
    });
    return result.sort((left, right) => left.observation.source.detectionIndex - right.observation.source.detectionIndex);
  }

  #updateTrack(
    track: TrackState,
    observation: Observation,
    timeMs: number,
    isNew: boolean,
  ): TrackedHandFeatures {
    const deltaMs = timeMs - track.lastSeenMs;
    const monotonic = deltaMs > 0;
    const observedHandedness = observation.source.handedness;
    const previousHandedness = evidenceToHandedness(track.handednessEvidence);
    const conflict = previousHandedness !== "unknown"
      && observedHandedness !== "unknown"
      && previousHandedness !== observedHandedness;
    const identityReason: HandIdentityReason = isNew
      ? "new-track"
      : !monotonic
        ? "non-monotonic-time"
        : conflict
          ? "handedness-conflict"
          : track.wasMissing
            ? "reacquired-within-grace"
            : "position-continuity";
    const palmVelocity = monotonic
      ? velocity(track.palmCenter, observation.palmCenter, deltaMs)
      : zeroVector();
    const indexTipVelocity = monotonic
      ? velocity(track.indexTip, observation.indexTip, deltaMs)
      : zeroVector();
    track.handednessEvidence = updateEvidence(
      track.handednessEvidence,
      observedHandedness,
      observation.source.handednessScore,
    );
    track.lastSeenMs = timeMs;
    track.palmCenter = observation.palmCenter;
    track.palmVelocity = palmVelocity;
    track.indexTip = observation.indexTip;
    track.indexTipVelocity = indexTipVelocity;
    track.wasMissing = false;
    return {
      trackId: track.id,
      handedness: evidenceToHandedness(track.handednessEvidence),
      observedHandedness,
      handednessScore: observation.source.handednessScore,
      identityReason,
      palmCenter: observation.palmCenter,
      palmVelocity,
      indexTip: observation.indexTip,
      indexTipVelocity,
      handScale: observation.handScale,
      openness: observation.openness,
    };
  }

  #expireTracks(nowMs: number, toleranceMs: number): void {
    for (const [id, track] of this.#tracks) {
      if (nowMs - track.lastSeenMs > toleranceMs) this.#tracks.delete(id);
    }
  }
}

function observe(hand: DetectedHand): Observation | null {
  if (hand.landmarks2D.length < 21) return null;
  const palm = average(PALM_INDICES.map((index) => hand.landmarks2D[index]!));
  const indexTip = toVector(hand.landmarks2D[8]!);
  const handScale = Math.max(distance2D(hand.landmarks2D[5]!, hand.landmarks2D[17]!), 0.001);
  const openness = FINGERTIP_INDICES.reduce(
    (sum, index) => sum + distance3D(toVector(hand.landmarks2D[index]!), palm) / handScale,
    0,
  ) / FINGERTIP_INDICES.length;
  return { source: hand, palmCenter: palm, indexTip, handScale, openness };
}

function minimumCostPairing(
  observations: readonly Observation[],
  tracks: readonly TrackState[],
  timeMs: number,
  maximumDistance: number,
): Array<{ observationIndex: number; trackIndex: number }> {
  if (tracks.length === 0) return [];
  const candidates: Array<{ observationIndex: number; trackIndex: number; cost: number }> = [];
  observations.forEach((observation, observationIndex) => {
    tracks.forEach((track, trackIndex) => {
      const elapsedSec = Math.max(0, timeMs - track.lastSeenMs) / 1_000;
      const predicted = add(track.palmCenter, scale(track.palmVelocity, elapsedSec));
      const spatialDistance = distance3D(predicted, observation.palmCenter);
      if (spatialDistance > maximumDistance) return;
      const stableHandedness = evidenceToHandedness(track.handednessEvidence);
      const handednessPenalty = stableHandedness !== "unknown"
        && observation.source.handedness !== "unknown"
        && stableHandedness !== observation.source.handedness
        ? 0.12
        : 0;
      candidates.push({ observationIndex, trackIndex, cost: spatialDistance + handednessPenalty });
    });
  });
  candidates.sort((left, right) => left.cost - right.cost || left.trackIndex - right.trackIndex);
  let best: Array<{ observationIndex: number; trackIndex: number }> = [];
  let bestCost = Number.POSITIVE_INFINITY;

  const search = (
    observationIndex: number,
    usedTracks: ReadonlySet<number>,
    pairings: readonly { observationIndex: number; trackIndex: number }[],
    totalCost: number,
  ): void => {
    if (observationIndex >= observations.length) {
      if (pairings.length > best.length || (pairings.length === best.length && totalCost < bestCost)) {
        best = [...pairings];
        bestCost = totalCost;
      }
      return;
    }
    search(observationIndex + 1, usedTracks, pairings, totalCost);
    for (const candidate of candidates) {
      if (candidate.observationIndex !== observationIndex || usedTracks.has(candidate.trackIndex)) continue;
      const nextUsedTracks = new Set(usedTracks);
      nextUsedTracks.add(candidate.trackIndex);
      search(
        observationIndex + 1,
        nextUsedTracks,
        [...pairings, { observationIndex, trackIndex: candidate.trackIndex }],
        totalCost + candidate.cost,
      );
    }
  };

  search(0, new Set(), [], 0);
  return best;
}

function createTrack(id: string, observation: Observation, timeMs: number): TrackState {
  return {
    id,
    lastSeenMs: timeMs,
    palmCenter: observation.palmCenter,
    palmVelocity: zeroVector(),
    indexTip: observation.indexTip,
    indexTipVelocity: zeroVector(),
    handednessEvidence: updateEvidence(0, observation.source.handedness, observation.source.handednessScore),
    wasMissing: false,
  };
}

function updateEvidence(current: number, handedness: Handedness, score: number): number {
  const observation = handedness === "left" ? score : handedness === "right" ? -score : 0;
  return current * 0.75 + observation;
}

function evidenceToHandedness(evidence: number): Handedness {
  if (Math.abs(evidence) < 0.15) return "unknown";
  return evidence > 0 ? "left" : "right";
}

function average(points: readonly Landmark2D[]): Vector3 {
  const sum = points.reduce((value, point) => ({
    x: value.x + point.x,
    y: value.y + point.y,
    z: value.z + point.zRelative,
  }), zeroVector());
  return scale(sum, 1 / points.length);
}

function toVector(point: Landmark2D): Vector3 {
  return { x: point.x, y: point.y, z: point.zRelative };
}

function velocity(previous: Vector3, current: Vector3, deltaMs: number): Vector3 {
  return scale({ x: current.x - previous.x, y: current.y - previous.y, z: current.z - previous.z }, 1_000 / deltaMs);
}

function add(left: Vector3, right: Vector3): Vector3 {
  return { x: left.x + right.x, y: left.y + right.y, z: left.z + right.z };
}

function scale(value: Vector3, multiplier: number): Vector3 {
  return { x: value.x * multiplier, y: value.y * multiplier, z: value.z * multiplier };
}

function distance2D(left: Landmark2D, right: Landmark2D): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function distance3D(left: Vector3, right: Vector3): number {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function zeroVector(): Vector3 {
  return { x: 0, y: 0, z: 0 };
}
