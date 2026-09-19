/**
 * The words shown in the middle of the camera image: the count-in, GO, and the result.
 *
 * The count comes from `targetTimeMs`, which is the GO time on the performance clock. The
 * lab controller derives that value from the audio clock (`AudioClock#toPerformanceTimeMs`
 * of the beat time) and hands the very same number to the metronome, which schedules the
 * three clicks at that beat and the two before it. Screen and speaker therefore read one
 * clock: nothing here re-derives a time of its own, and nothing counts drawn frames.
 */

export const COUNT_IN_BPM = 120;
export const BEAT_MS = 60_000 / COUNT_IN_BPM;
/** The count-in clicks two beats before GO and on GO itself. */
export const COUNT_IN_LEAD_MS = 2 * BEAT_MS;
/** How long "GO" stays on the image after the target time. */
export const GO_DISPLAY_MS = 600;
/** How long "GOOD" stays on the image after a trial succeeds. */
export const GOOD_DISPLAY_MS = 600;

export interface StageCueTiming {
  /** GO on the performance clock, or null when the trial runs without a count-in. */
  readonly targetTimeMs: number | null;
  /** When the recognition window opened; it stands in for GO when there is no count-in. */
  readonly windowOpenedAtMs: number;
}

export type StageCueKind = "none" | "count" | "go" | "good";

export interface StageCue {
  readonly text: string;
  readonly kind: StageCueKind;
}

const NOTHING: StageCue = { text: "", kind: "none" };

/**
 * What to show at `nowMs`. `goodUntilMs` is when the "GOOD" of the last successful trial
 * runs out; a trial that timed out shows nothing at all.
 */
export function stageCue(
  nowMs: number,
  timing: StageCueTiming | null,
  goodUntilMs: number,
): StageCue {
  if (nowMs < goodUntilMs) return { text: "GOOD", kind: "good" };
  if (timing === null) return NOTHING;
  if (timing.targetTimeMs === null) {
    // Without a count-in there is nothing to count down: GO is the moment the window opens.
    const inGoWindow = nowMs >= timing.windowOpenedAtMs && nowMs < timing.windowOpenedAtMs + GO_DISPLAY_MS;
    return inGoWindow ? { text: "GO", kind: "go" } : NOTHING;
  }
  const remainingMs = timing.targetTimeMs - nowMs;
  if (remainingMs > COUNT_IN_LEAD_MS) return NOTHING;
  if (remainingMs > 0) return { text: String(Math.ceil(remainingMs / BEAT_MS)), kind: "count" };
  return nowMs < timing.targetTimeMs + GO_DISPLAY_MS ? { text: "GO", kind: "go" } : NOTHING;
}
