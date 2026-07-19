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
  readonly missingGraceMs?: number;
  readonly maximumAssignmentDistance?: number;
}

export class HandFeaturePipeline {
  readonly #tracks = new Map<string, TrackState>();
  readonly #missingGraceMs: number;
  readonly #maximumAssignmentDistance: number;
  #nextTrackId = 1;

  constructor(options: HandFeaturePipelineOptions = {}) {
    this.#missingGraceMs = options.missingGraceMs ?? 150;
    this.#maximumAssignmentDistance = options.maximumAssignmentDistance ?? 0.55;
  }

  process(frame: HandTrackingFrame): TrackedHandFrame {
    this.#expireTracks(frame.captureTimeMs);
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
    };
  }

  reset(): void {
    this.#tracks.clear();
    this.#nextTrackId = 1;
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

  #expireTracks(nowMs: number): void {
    for (const [id, track] of this.#tracks) {
      if (nowMs - track.lastSeenMs > this.#missingGraceMs) this.#tracks.delete(id);
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
