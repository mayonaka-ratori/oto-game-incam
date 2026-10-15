import { COUNT_IN_BEATS, COUNT_IN_SEC, isRestBeat, PRACTICE_BEAT_SEC, PRACTICE_BEATS, PRACTICE_DURATION_SEC } from "./practice-timeline";

/** Original instrumental for this exercise. No recordings, downloads or microphones. */
export async function createPracticeMusic(): Promise<AudioBuffer> {
  const context = new OfflineAudioContext(1, Math.ceil((COUNT_IN_SEC + PRACTICE_DURATION_SEC) * 44_100), 44_100);
  const master = context.createGain();
  master.gain.value = 0.7;
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -22;
  compressor.knee.value = 18;
  compressor.ratio.value = 3;
  compressor.attack.value = 0.005;
  compressor.release.value = 0.14;
  master.connect(compressor).connect(context.destination);
  const end = COUNT_IN_SEC + PRACTICE_DURATION_SEC;
  master.gain.setValueAtTime(0.7, end - 0.12);
  master.gain.linearRampToValueAtTime(0, end);

  const noise = context.createBuffer(1, Math.ceil(context.sampleRate * 0.2), context.sampleRate);
  const samples = noise.getChannelData(0);
  let seed = 12345;
  for (let i = 0; i < samples.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    samples[i] = (seed >>> 0) / 2_147_483_648 - 1;
  }

  for (let beat = 0; beat < COUNT_IN_BEATS; beat++) {
    note(beat * PRACTICE_BEAT_SEC, beat === 3 ? 81 : 76, 0.12, 0.18, "sine");
  }

  // D minor, B-flat, C, A minor. Three four-bar phrases with a small melodic variation.
  const chords = [[50, 57, 60, 65], [46, 53, 57, 62], [48, 55, 60, 64], [45, 52, 57, 60]];
  const melody = [
    [74, 77, 76, 72, 74, 69, 72, 76],
    [74, 77, 81, 77, 76, 72, 69, 72],
    [77, 76, 74, 72, 69, 72, 74, 74],
  ];
  for (let beat = 0; beat < PRACTICE_BEATS; beat++) {
    const at = COUNT_IN_SEC + beat * PRACTICE_BEAT_SEC;
    const inBar = beat % 4;
    const chord = chords[Math.floor(beat / 4) % chords.length]!;
    const resting = isRestBeat(beat);
    if (inBar === 0) {
      for (const pitch of chord) note(at, pitch + 12, PRACTICE_BEAT_SEC * 3.7, 0.034, "triangle", true);
    }
    note(at, chord[0]! - 12 + (inBar === 3 ? 7 : 0), PRACTICE_BEAT_SEC * 0.65, 0.15, "sine");
    if (inBar % 2 === 0) kick(at, resting ? 0.18 : 0.4);
    else percussion(at, 0.13, 1700, resting ? 0.025 : 0.075);
    percussion(at, 0.045, 6500, 0.035);
    if (!resting) {
      percussion(at + PRACTICE_BEAT_SEC / 2, 0.035, 7500, 0.019);
      const phrase = melody[Math.floor(beat / 16)]!;
      const pitch = phrase[beat % phrase.length]!;
      note(at, pitch, PRACTICE_BEAT_SEC * 0.8, 0.1, "triangle");
      if (inBar === 3 && beat < PRACTICE_BEATS - 1) {
        note(at + PRACTICE_BEAT_SEC / 2, pitch + 3, PRACTICE_BEAT_SEC * 0.4, 0.055, "sine");
      }
    }
  }
  const buffer = await context.startRendering();
  const rendered = buffer.getChannelData(0);
  let peak = 0;
  for (const sample of rendered) peak = Math.max(peak, Math.abs(sample));
  if (peak > 0) {
    const scale = 0.86 / peak;
    for (let index = 0; index < rendered.length; index++) rendered[index] = rendered[index]! * scale;
  }
  return buffer;

  function note(at: number, midi: number, duration: number, volume: number, type: OscillatorType, soft = false): void {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.value = 440 * 2 ** ((midi - 69) / 12);
    const stop = Math.min(end, at + duration);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(volume, at + (soft ? 0.06 : 0.008));
    if (soft) gain.gain.setValueAtTime(volume * 0.7, Math.max(at + 0.06, stop - 0.18));
    gain.gain.exponentialRampToValueAtTime(0.0001, stop);
    oscillator.connect(gain).connect(master);
    oscillator.start(at);
    oscillator.stop(stop);
  }

  function kick(at: number, volume: number): void {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.setValueAtTime(125, at);
    oscillator.frequency.exponentialRampToValueAtTime(44, at + 0.16);
    gain.gain.setValueAtTime(volume, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.24);
    oscillator.connect(gain).connect(master);
    oscillator.start(at);
    oscillator.stop(at + 0.25);
  }

  function percussion(at: number, duration: number, frequency: number, volume: number): void {
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = noise;
    filter.type = "highpass";
    filter.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    source.connect(filter).connect(gain).connect(master);
    source.start(at);
    source.stop(at + duration);
  }
}
