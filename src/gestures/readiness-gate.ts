import type { TrackedHandFeatures } from "../tracking/derived-tracking-types";
import type { GestureReadinessObservation } from "./gesture-types";

export interface ReadinessGateConfig {
  /** How long the hands must stay in the start position before the count-in may begin. */
  readonly requiredStableMs: number;
  /** Movement from the settled position that restarts the stability timer. */
  readonly maximumDriftDistance: number;
}

interface Anchor {
  readonly trackId: string;
  readonly x: number;
  readonly y: number;
}

/**
 * Confirms that the required hands stayed in their start zone for a short,
 * continuous period. A missing hand, a zone exit, an identity change, or drift
 * beyond the tolerance restarts the timer. Once ready, the result is latched
 * for the rest of the trial so the count-in is scheduled exactly once.
 */
export class ReadinessGate {
  readonly #config: ReadinessGateConfig;
  #stableSinceMs: number | null = null;
  #anchors: readonly Anchor[] = [];
  #readyAtMs: number | null = null;

  constructor(config: ReadinessGateConfig) {
    this.#config = config;
  }

  observe(
    timeMs: number,
    visibleHands: number,
    zoneHands: readonly TrackedHandFeatures[] | null,
  ): GestureReadinessObservation {
    if (this.#readyAtMs === null) {
      if (zoneHands === null) {
        this.#stableSinceMs = null;
        this.#anchors = [];
      } else {
        if (this.#stableSinceMs === null || this.#drifted(zoneHands)) {
          this.#stableSinceMs = timeMs;
          this.#anchors = zoneHands.map((hand) => ({
            trackId: hand.trackId,
            x: hand.palmCenter.x,
            y: hand.palmCenter.y,
          }));
        }
        if (timeMs - this.#stableSinceMs >= this.#config.requiredStableMs) this.#readyAtMs = timeMs;
      }
    }
    return {
      visibleHands,
      inZone: zoneHands !== null,
      stableMs: this.#stableSinceMs === null ? 0 : Math.max(0, timeMs - this.#stableSinceMs),
      ready: this.#readyAtMs !== null,
      readyAtMs: this.#readyAtMs,
      handIds: zoneHands?.map(({ trackId }) => trackId) ?? [],
    };
  }

  reset(): void {
    this.#stableSinceMs = null;
    this.#anchors = [];
    this.#readyAtMs = null;
  }

  #drifted(hands: readonly TrackedHandFeatures[]): boolean {
    if (hands.length !== this.#anchors.length) return true;
    return hands.some((hand, index) => {
      const anchor = this.#anchors[index];
      return anchor === undefined
        || anchor.trackId !== hand.trackId
        || Math.hypot(hand.palmCenter.x - anchor.x, hand.palmCenter.y - anchor.y) > this.#config.maximumDriftDistance;
    });
  }
}
