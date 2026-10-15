export const PRACTICE_BPM = 96;
export const PRACTICE_BEAT_SEC = 60 / PRACTICE_BPM;
export const PRACTICE_BEATS = 48;
export const PRACTICE_DURATION_SEC = PRACTICE_BEATS * PRACTICE_BEAT_SEC;
export const COUNT_IN_BEATS = 4;
export const COUNT_IN_SEC = COUNT_IN_BEATS * PRACTICE_BEAT_SEC;

export type PracticeMotion = "right" | "left" | "up" | "return" | "rest";

export interface HandOffset {
  readonly x: number;
  readonly y: number;
}

interface PracticeStep {
  readonly beat: number;
  readonly duration: number;
  readonly motion: PracticeMotion;
  readonly from: HandOffset;
  readonly to: HandOffset;
}

const HOME = { x: 0, y: 0 };
const RIGHT = { x: 48, y: -70 };
const LEFT = { x: -48, y: -70 };
const UP = { x: 0, y: -86 };
const REST = { x: 0, y: 37 };

function diagonal(beat: number): PracticeStep[] {
  return [
    { beat, duration: 2, motion: "right", from: HOME, to: RIGHT },
    { beat: beat + 2, duration: 2, motion: "return", from: RIGHT, to: HOME },
    { beat: beat + 4, duration: 2, motion: "left", from: HOME, to: LEFT },
    { beat: beat + 6, duration: 2, motion: "return", from: LEFT, to: HOME },
  ];
}

/** One score drives both the guide and the music. Beats are zero-based internally. */
const STEPS: readonly PracticeStep[] = [
  ...diagonal(0),
  ...diagonal(8),
  { beat: 16, duration: 4, motion: "rest", from: HOME, to: HOME },
  { beat: 20, duration: 2, motion: "up", from: HOME, to: UP },
  { beat: 22, duration: 2, motion: "return", from: UP, to: HOME },
  { beat: 24, duration: 2, motion: "up", from: HOME, to: UP },
  { beat: 26, duration: 2, motion: "return", from: UP, to: HOME },
  ...diagonal(28),
  { beat: 36, duration: 4, motion: "rest", from: HOME, to: HOME },
  ...diagonal(40),
];

export const MOTION_LABELS: Readonly<Record<PracticeMotion, string>> = {
  right: "両手を 右上へ",
  left: "両手を 左上へ",
  up: "両手を 上へ",
  return: "両手を 戻す",
  rest: "腕を下ろして ひと休み",
};

export interface PracticeFrame {
  readonly motion: PracticeMotion;
  readonly label: string;
  readonly nextLabel: string;
  readonly handOffset: HandOffset;
  readonly targetOffset: HandOffset;
  readonly beatInPhrase: number;
  readonly phraseBeats: number;
  readonly beatFraction: number;
  readonly elapsedSec: number;
  readonly remainingSec: number;
}

export function practiceFrame(elapsedSec: number): PracticeFrame {
  const elapsed = Math.max(0, Math.min(PRACTICE_DURATION_SEC, elapsedSec));
  const beat = Math.min(PRACTICE_BEATS - 0.000001, elapsed / PRACTICE_BEAT_SEC);
  const index = STEPS.findIndex((step) => beat < step.beat + step.duration);
  const step = STEPS[index]!;
  const progress = (beat - step.beat) / step.duration;
  let handOffset: HandOffset;
  if (step.motion === "rest") {
    // Lower the arms for three beats, then bring them back during the fourth.
    const localBeat = beat - step.beat;
    handOffset = localBeat < 1
      ? interpolate(HOME, REST, localBeat)
      : localBeat < 3 ? REST : interpolate(REST, HOME, localBeat - 3);
  } else {
    handOffset = interpolate(step.from, step.to, progress);
  }
  const phraseStart = beat < 16 ? Math.floor(beat / 8) * 8
    : beat < 20 ? 16 : beat < 28 ? 20 : beat < 36 ? 28 : beat < 40 ? 36 : 40;
  return {
    motion: step.motion,
    label: MOTION_LABELS[step.motion],
    nextLabel: STEPS[index + 1] === undefined ? "おしまい" : MOTION_LABELS[STEPS[index + 1]!.motion],
    handOffset,
    targetOffset: step.motion === "rest" ? REST : step.to,
    beatInPhrase: Math.floor(beat - phraseStart),
    phraseBeats: step.motion === "rest" ? 4 : 8,
    beatFraction: beat % 1,
    elapsedSec: elapsed,
    remainingSec: PRACTICE_DURATION_SEC - elapsed,
  };
}

export function isRestBeat(beat: number): boolean {
  return (beat >= 16 && beat < 20) || (beat >= 36 && beat < 40);
}

function interpolate(from: HandOffset, to: HandOffset, progress: number): HandOffset {
  const amount = (1 - Math.cos(Math.PI * Math.max(0, Math.min(1, progress)))) / 2;
  return { x: from.x + (to.x - from.x) * amount, y: from.y + (to.y - from.y) * amount };
}
