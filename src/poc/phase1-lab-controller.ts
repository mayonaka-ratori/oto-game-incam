import { createGestureEventId, type GestureEvent } from "../gestures/gesture-types";
import type { HandTrackingFrame, TrackingProviderInfo } from "../tracking/tracking-types";
import { AudioClock, type AudioClockSnapshot } from "../time/audio-clock";
import { BeatTimeline } from "../time/beat-timeline";
import { Metronome } from "../time/metronome";
import { parseLandmarkReplayImport, type LandmarkReplayDocument } from "../replay/landmark-replay";
import { Phase1LabEngine, type Phase1LabSnapshot } from "./phase1-lab-engine";
import {
  P1_READINESS_TIMEOUT_MS,
  P1_TRIAL_TIMEOUT_MS,
  diagonalLiftVariantLabel,
  resolveP1Protocol,
  spotlightVariantLabel,
  type P1BlockRecord,
  type P1Outcome,
  type P1PauseReason,
  type P1RunnerSnapshot,
  type P1TrialDefinition,
} from "./phase1-protocol";
import { guideInstruction, guideReadinessHint } from "../rendering/gesture-guides";
import {
  COUNT_IN_BPM,
  COUNT_IN_LEAD_MS,
  GOOD_DISPLAY_MS,
  GO_DISPLAY_MS,
  stageCue,
  type StageCueTiming,
} from "../rendering/stage-cue";
import type { P1GuideView } from "../rendering/overlay-renderer";
import type {
  Phase1EnvironmentReport,
  Phase1TechnicalSummary,
} from "./phase1-session";
import type { P1TrialEnvironmentInput } from "./phase1-lab-engine";
import {
  Phase1PerformanceRecorder,
  type Phase1PerformanceInputs,
} from "./phase1-performance-recorder";
import { ScreenWakeLock } from "../app/screen-wake-lock";
import type { DeviceTechnicalSnapshot } from "../metrics/device-technical-snapshot";

const RESULT_HOLD_MS = 1_000;
const TIMER_RENDER_INTERVAL_MS = 250;
const POST_ROLL_POLL_MS = 50;
const POST_ROLL_WAIT_TIMEOUT_MS = 5_000;
/** The diagnostic file follows the result file after a short pause, so both downloads are offered. */
const SECOND_EXPORT_DELAY_MS = 500;
/** A GO target must leave room for the whole count-in; a nearer or much later target means a stale audio clock. */
const MIN_TARGET_LEAD_MS = COUNT_IN_LEAD_MS;
const MAX_TARGET_LEAD_MS = 4_000;
/** Frames captured just before a deadline arrive after inference; the deadline timer waits this long for them. */
const DEADLINE_FRAME_GRACE_MS = 200;
/** Block buttons ignore presses right after they appear, so a double tap cannot pause and resume at once. */
const BLOCK_ACTION_LOCK_MS = 400;
/** Resuming audio may wait on the OS (for example after an interruption); the trial does not wait longer than this. */
const AUDIO_RESUME_TIMEOUT_MS = 600;

type BlockPanelState = "idle" | "running" | "rest" | "paused" | "complete";

/** Values the lab screen already measures and the P1 session saves once per session. */
export interface Phase1EnvironmentInputs {
  readonly displayFps: number | null;
  readonly cameraFrameSource: string | null;
  readonly trackingFrameSource: string | null;
  readonly firstAcquisitionMs: number | null;
}

export interface Phase1LabControllerOptions {
  readonly appBuildId: string;
  readonly getProvider: () => TrackingProviderInfo | null;
  readonly getTechnicalSummary: () => Phase1TechnicalSummary;
  readonly getTechnicalSnapshot: () => DeviceTechnicalSnapshot;
  readonly getPerformanceInputs: () => Phase1PerformanceInputs;
  readonly getEnvironmentInputs: () => Phase1EnvironmentInputs;
  /** Real pixel size of the camera video, for checking a trial against the aspect ratio afterwards. */
  readonly getVideoSize: () => { readonly width: number; readonly height: number } | null;
  readonly getPerformanceLow: () => boolean;
  readonly getCameraActive: () => boolean;
  readonly requestLandscape: () => Promise<void>;
  readonly onGuideChange: (guide: P1GuideView | null) => void;
}

export class Phase1LabController {
  readonly #root: HTMLElement;
  readonly #options: Phase1LabControllerOptions;
  readonly #engine = new Phase1LabEngine(resolveP1Protocol(window.location.search));
  /** The tester screen starts with one button and advances on a tap; the analysis screen keeps its buttons. */
  readonly #testerView: boolean;
  readonly #audio = new AudioClock();
  readonly #performance: Phase1PerformanceRecorder;
  readonly #wakeLock = new ScreenWakeLock();
  #boundAudioContext: AudioContext | null = null;
  #timeline: BeatTimeline | null = null;
  #metronome: Metronome | null = null;
  #audioSnapshot: AudioClockSnapshot | null = null;
  #audioTimer: number | null = null;
  #deadlineTimer: number | null = null;
  #autoAdvanceTimer: number | null = null;
  #renderTimer: number | null = null;
  #unlockTimer: number | null = null;
  #autoAdvanceAtMs: number | null = null;
  #sessionStarted = false;
  #sessionExperimentProfileId: string | null = null;
  #replay: LandmarkReplayDocument | null = null;
  #starting = false;
  #blockActionPending = false;
  #disposed = false;
  #revealBlockOnRender = false;
  #blockPanelState: BlockPanelState | null = null;
  #blockActionsLockedUntilMs = 0;
  /** Why the latest trial ran without a count-in: the audio stopped, or there is no audio clock at all. */
  #audioNotice: "stopped" | "unavailable" | null = null;
  #exportNotice: string | null = null;
  /** What a tap on the camera image starts: the session, the next movement, or nothing. */
  #tapStart: "session" | "block" | null = null;
  /** A freshly shown prompt ignores taps for a moment, so a double tap cannot skip a step. */
  #tapArmedAtMs = 0;
  /** "はじめる" was pressed: the camera and the tracking are being prepared. */
  #startRequested = false;
  #trackingReady = false;
  #goodUntilMs = Number.NEGATIVE_INFINITY;
  #cueTiming: StageCueTiming | null = null;
  #cueRafId: number | null = null;
  #cueText = "";
  /** Where the hands settled for the attempt on screen, screen-left first. Null until confirmed. */
  #guideAnchors: readonly { readonly x: number; readonly y: number }[] | null = null;
  #saving = false;
  #savedFileNames: readonly string[] = [];

  constructor(root: HTMLElement, options: Phase1LabControllerOptions) {
    this.#root = root;
    this.#options = options;
    this.#testerView = root.classList.contains("tester-view");
    this.#performance = new Phase1PerformanceRecorder(() => options.getPerformanceInputs());
    requiredButton(root, "#p1-enable-audio").addEventListener("click", () => void this.#enableAudio());
    requiredButton(root, "#p1-start-session").addEventListener("click", () => void this.#startTest());
    requiredButton(root, "#p1-start-block").addEventListener("click", () => void this.#startBlock());
    requiredButton(root, "#p1-pause").addEventListener("click", () => {
      if (this.#blockActionAllowed()) this.#pause("manual");
    });
    requiredButton(root, "#p1-resume").addEventListener("click", () => void this.#resume());
    requiredButton(root, "#p1-block-export").addEventListener("click", () => void this.#saveResults());
    requiredButton(root, "#p1-next-trial").addEventListener("click", () => this.#beginNextTrial());
    requiredButton(root, "#p1-skip").addEventListener("click", () => this.#skip());
    requiredButton(root, "#p1-false-trigger").addEventListener("click", () => this.#recordFalseTrigger());
    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-p1-outcome]")) {
      button.addEventListener("click", () => this.#recordOutcome(button.dataset.p1Outcome as Exclude<P1Outcome, "success">));
    }
    requiredButton(root, "#p1-export").addEventListener("click", () => void this.#saveResults());
    requiredButton(root, "#p1-export-replay").addEventListener("click", () => void this.#exportReplay());
    // "はじめる" starts the camera through the lab view; the audio clock may only start inside
    // the same press, and the test itself starts on the tap that follows the guide.
    requiredButton(root, "#start-camera").addEventListener("click", () => this.#handleStartPressed());
    root.addEventListener("click", this.#handleStageTap);
    const replayInput = root.querySelector("#p1-replay-file");
    if (!(replayInput instanceof HTMLInputElement)) throw new Error("Required replay input not found.");
    replayInput.addEventListener("change", () => void this.#loadReplay(replayInput));
    requiredButton(root, "#p1-replay-run").addEventListener("click", () => this.#runReplay());
    document.addEventListener("visibilitychange", this.#handleVisibilityChange);
    this.#renderTimer = window.setInterval(() => {
      if (!this.#disposed && document.visibilityState === "visible") this.#render();
    }, TIMER_RENDER_INTERVAL_MS);
    this.#cueRafId = requestAnimationFrame(this.#tickCue);
    this.#render();
  }

  processFrame(frame: HandTrackingFrame): void {
    if (this.#disposed) return;
    if (!this.#trackingReady) {
      // The first tracking frame means the worker is running: the test may be offered now.
      this.#trackingReady = true;
      this.#render();
    }
    if (!this.#sessionStarted) return;
    // One snapshot per frame: building it copies the results and blocks.
    const previous = this.#engine.snapshot;
    const before = previous.protocol.completed;
    // Measured before the frame is judged, so a frame never lands in an already finished block.
    // A finished block is closed in #handleTrialFinished, which every completed trial reaches.
    this.#performance.syncBlocks(previous.protocol);
    this.#performance.addResult(frame);
    let snapshot = this.#engine.processFrame(frame);
    const toleranceMs = snapshot.latestTrackedFrame?.trackingGapToleranceMs;
    if (toleranceMs !== undefined) this.#performance.addTrackingGapTolerance(toleranceMs);
    if (snapshot.protocol.completed > before) {
      this.#handleTrialFinished(snapshot);
      snapshot = this.#engine.snapshot;
    } else if (snapshot.readinessReached) {
      this.#startRecognition();
      snapshot = this.#engine.snapshot;
    }
    this.#render(snapshot);
  }

  /** Called when the camera starts, stops, or loses its track. Trials never run without camera frames. */
  cameraStateChanged(): void {
    if (this.#disposed) return;
    if (!this.#options.getCameraActive()) {
      this.#trackingReady = false;
      if (this.#sessionStarted) this.#pause("camera-stopped");
      else this.#tapStart = null;
    }
    this.#render();
  }

  /** "はじめる": the camera starts through the lab view, and the audio clock starts on this press. */
  #handleStartPressed(): void {
    if (this.#disposed || !this.#testerView) return;
    this.#startRequested = true;
    // A browser starts an AudioContext only inside a user gesture, so it cannot wait for the tap.
    void this.#enableAudio();
    this.#render();
  }

  /**
   * A tap on the camera image starts the session or the next movement. Taps on buttons keep their
   * own meaning, and while a trial is running a tap does nothing, so a moving hand cannot skip it.
   */
  readonly #handleStageTap = (event: MouseEvent): void => {
    const pending = this.#tapStart;
    if (pending === null || this.#disposed || performance.now() < this.#tapArmedAtMs) return;
    const target = event.target;
    if (target instanceof Element && target.closest("button, a, input, select, textarea, label") !== null) return;
    this.#tapStart = null;
    if (pending === "session") void this.#startTest();
    else void this.#startNextBlock();
  };

  /** Shows a prompt and waits for the tap that starts the next part of the test. */
  #armTap(kind: "session" | "block"): void {
    this.#tapStart = kind;
    this.#tapArmedAtMs = performance.now() + BLOCK_ACTION_LOCK_MS;
  }

  experimentProfileChanged(): void {
    if (this.#sessionStarted && !this.#sessionProfileMatches()) {
      requiredElement(this.#root, "#p1-export-status").textContent = "実験プロファイルが変わりました。結果を混ぜないため、テストを最初からやり直してください。";
    }
    this.#render();
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#clearProgressTimers();
    this.#cancelCountIn();
    if (this.#audioTimer !== null) window.clearInterval(this.#audioTimer);
    if (this.#renderTimer !== null) window.clearInterval(this.#renderTimer);
    if (this.#unlockTimer !== null) window.clearTimeout(this.#unlockTimer);
    if (this.#cueRafId !== null) cancelAnimationFrame(this.#cueRafId);
    this.#cueRafId = null;
    this.#root.removeEventListener("click", this.#handleStageTap);
    this.#audioTimer = null;
    this.#renderTimer = null;
    this.#unlockTimer = null;
    document.removeEventListener("visibilitychange", this.#handleVisibilityChange);
    this.#performance.stop();
    this.#wakeLock.dispose();
    await this.#audio.close();
  }

  async #enableAudio(): Promise<void> {
    const status = requiredElement(this.#root, "#p1-audio-status");
    try {
      this.#audioSnapshot = await this.#audio.enable();
      this.#bindAudioContext();
      status.textContent = "音声クロック準備完了。試行開始時にカウント音を予約します。";
    } catch (error) {
      status.textContent = `音声クロックを開始できません: ${error instanceof Error ? error.message : String(error)}`;
    }
    this.#renderAudio();
  }

  /** Builds the beat timeline and metronome once per audio context. */
  #bindAudioContext(): void {
    const context = this.#audio.context;
    if (context === null || context === this.#boundAudioContext) return;
    this.#boundAudioContext = context;
    this.#timeline = new BeatTimeline({ bpm: COUNT_IN_BPM, beatZeroContextTimeSec: context.currentTime + 0.25 });
    this.#metronome = new Metronome(context, this.#timeline);
    if (this.#audioTimer !== null) window.clearInterval(this.#audioTimer);
    this.#audioTimer = window.setInterval(() => {
      if (this.#audio.context === null) return;
      this.#audioSnapshot = this.#audio.sample();
      this.#renderAudio();
    }, 500);
  }

  /**
   * Resumes suspended or interrupted audio from a button press. Browsers resume audio only on a user gesture,
   * and iOS Safari may stop it while the page is hidden. The trial does not wait long for it.
   */
  async #resumeAudio(): Promise<void> {
    if (this.#audio.context === null) return;
    try {
      const snapshot = await Promise.race([
        this.#audio.enable(),
        new Promise<null>((resolve) => window.setTimeout(() => resolve(null), AUDIO_RESUME_TIMEOUT_MS)),
      ]);
      if (snapshot !== null) this.#audioSnapshot = snapshot;
      this.#bindAudioContext();
    } catch {
      // Without running audio, trials fall back to timing without a count-in.
    }
  }

  async #startTest(): Promise<void> {
    if (this.#starting || this.#disposed || !this.#options.getCameraActive()) return;
    if (this.#sessionStarted && !this.#confirmRestart()) return;
    this.#starting = true;
    this.#render();
    const landscapeRequest = this.#root.classList.contains("tester-view")
      ? Promise.resolve() : this.#options.requestLandscape();
    await Promise.allSettled([landscapeRequest, this.#enableAudio()]);
    if (this.#disposed) return;
    if (!this.#options.getCameraActive()) {
      this.#starting = false;
      this.#render();
      return;
    }

    this.#clearProgressTimers();
    this.#cancelCountIn();
    const sessionId = `p1-${new Date().toISOString().replace(/[-:.TZ]/g, "")}`;
    this.#engine.startSession(sessionId, this.#options.getProvider(), {
      appVersion: this.#options.appBuildId,
      notes: "同じ動作の中の試行は自動進行。動作の切り替わりは画面タップで開始。必須休憩なし。",
    });
    this.#performance.start();
    // A trial can run 10 seconds without a touch, so the screen must not dim in the middle of one.
    void this.#wakeLock.acquire();
    this.#sessionExperimentProfileId = this.#options.getTechnicalSnapshot().experimentProfileId;
    this.#sessionStarted = true;
    this.#audioNotice = null;
    this.#exportNotice = null;
    this.#savedFileNames = [];
    this.#goodUntilMs = Number.NEGATIVE_INFINITY;
    this.#tapStart = null;
    this.#guideAnchors = null;
    this.#options.onGuideChange(null);
    requiredElement(this.#root, "#p1-session-id").textContent = sessionId;
    requiredElement(this.#root, "#p1-export-status").textContent = "";
    requiredElement(this.#root, "#p1-replay-export-status").textContent = "";
    this.#starting = false;
    // Block boundaries advance automatically after showing the next movement.
    this.#engine.startBlock(performance.now());
    this.#beginNextTrial();
  }

  /** Restarting discards the results, so it asks first whenever at least one trial was recorded. */
  #confirmRestart(): boolean {
    const completed = this.#engine.snapshot.protocol.completed;
    if (completed === 0) return true;
    return window.confirm(
      `記録した${completed}回分の結果を消して、テストを最初からやり直しますか？\n結果を残したい場合は「キャンセル」を押し、先に結果JSONを保存してください。`,
    );
  }

  async #startBlock(): Promise<void> {
    if (!this.#blockActionAllowed()) return;
    this.#blockActionPending = true;
    this.#render();
    try {
      await this.#resumeAudio();
      if (!this.#blockActionCanContinue()) return;
      void this.#wakeLock.acquire();
      if (this.#engine.startBlock(performance.now())) this.#beginNextTrial();
    } finally {
      this.#blockActionPending = false;
      this.#render();
    }
  }

  /**
   * Starts the movement the tap prompt is showing. The block itself was opened when the previous
   * one ended, so a pause, a hidden page, or a stopped camera work while the prompt waits.
   */
  async #startNextBlock(): Promise<void> {
    if (!this.#blockActionAllowed()) return;
    this.#blockActionPending = true;
    this.#render();
    try {
      await this.#resumeAudio();
      if (!this.#blockActionCanContinue()) return;
      void this.#wakeLock.acquire();
      this.#engine.startBlock(performance.now());
      this.#beginNextTrial();
    } finally {
      this.#blockActionPending = false;
      this.#render();
    }
  }

  async #resume(): Promise<void> {
    if (!this.#blockActionAllowed()) return;
    this.#blockActionPending = true;
    this.#render();
    try {
      await this.#resumeAudio();
      if (!this.#blockActionCanContinue()) return;
      void this.#wakeLock.acquire();
      if (this.#engine.resume(performance.now())) this.#beginNextTrial();
    } finally {
      this.#blockActionPending = false;
      this.#render();
    }
  }

  #blockActionAllowed(): boolean {
    return this.#sessionStarted
      && !this.#disposed
      && !this.#blockActionPending
      && document.visibilityState === "visible"
      && this.#options.getCameraActive()
      && performance.now() >= this.#blockActionsLockedUntilMs;
  }

  #blockActionCanContinue(): boolean {
    return !this.#disposed && document.visibilityState === "visible" && this.#options.getCameraActive();
  }

  #beginNextTrial(): void {
    if (!this.#sessionStarted || this.#disposed || document.visibilityState !== "visible") return;
    if (!this.#options.getCameraActive()) return;
    const protocol = this.#engine.snapshot.protocol;
    if (protocol.paused || protocol.awaitingBlockStart || protocol.activeTrial !== null) return;
    this.#clearDeadlineTimer();
    this.#clearAutoAdvanceTimer();
    this.#autoAdvanceAtMs = null;
    const preparedAtMs = performance.now();
    // Readiness-gated trials schedule the count-in only after the start position settles.
    const targetTimeMs = protocol.nextTrial?.requiresReadiness === true ? null : this.#scheduleTarget();
    const trial = this.#engine.beginNextTrial(targetTimeMs, preparedAtMs);
    if (trial !== null) this.#engine.recordTrialEnvironment(this.#trialEnvironment(preparedAtMs));
    this.#guideAnchors = null;
    this.#pushGuide();
    this.#scheduleDeadline();
    this.#render();
  }

  /**
   * Hands the camera overlay the guide of the attempt on screen. The GO time is the audio clock's
   * time on the performance clock, so the travelling dot and the count-in clicks share one clock.
   */
  #pushGuide(): void {
    const protocol = this.#engine.snapshot.protocol;
    const active = protocol.activeTrial;
    if (active === null) {
      this.#cueTiming = null;
      const next = this.#sessionStarted || this.#tapStart !== null ? protocol.nextTrial : null;
      this.#options.onGuideChange(
        next === null ? null : { trial: next, goTimeMs: null, phase: "preview", anchors: null },
      );
      return;
    }
    const timing = protocol.activeTiming;
    this.#cueTiming = timing === null
      ? null
      : { targetTimeMs: timing.targetTimeMs, windowOpenedAtMs: timing.windowOpenedAtMs };
    this.#options.onGuideChange({
      trial: active,
      goTimeMs: timing === null ? null : timing.targetTimeMs ?? timing.windowOpenedAtMs,
      phase: timing === null ? "readiness" : "recognition",
      anchors: this.#guideAnchors,
    });
  }

  /**
   * Remembers where the hands really settled, so the path and the end rings are drawn from there.
   * The state machine measures the gesture from the same positions, which is what makes the guide
   * and the judgment agree (docs/19 の4.3). Falls back to the palm centers of the latest tracked
   * frame when the start-position check did not report positions.
   */
  #captureGuideAnchors(): void {
    const snapshot = this.#engine.snapshot;
    const settled = snapshot.readiness?.settledPositions ?? [];
    const positions = settled.length > 0
      ? settled
      : (snapshot.latestTrackedFrame?.hands ?? []).map(({ palmCenter }) => palmCenter);
    if (positions.length < 2) {
      this.#guideAnchors = null;
      return;
    }
    // Screen-left hand first, matching the order of the guide paths.
    this.#guideAnchors = [...positions]
      .sort((left, right) => left.x - right.x)
      .slice(0, 2)
      .map(({ x, y }) => ({ x, y }));
  }

  /** Orientation and video size decide how the guide maps to the camera image, so each attempt records them. */
  #trialEnvironment(startedAtMs: number): P1TrialEnvironmentInput {
    const video = this.#options.getVideoSize();
    const orientationType = typeof screen !== "undefined" ? screen.orientation?.type ?? null : null;
    return {
      startedAtMs,
      orientation: window.innerWidth >= window.innerHeight ? "landscape" : "portrait",
      orientationType,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      videoWidth: video === null || video.width === 0 ? null : video.width,
      videoHeight: video === null || video.height === 0 ? null : video.height,
    };
  }

  #startRecognition(): void {
    // Read before the recognition window opens, while the start-position check still holds
    // the positions the hands settled at.
    this.#captureGuideAnchors();
    const targetTimeMs = this.#scheduleTarget();
    if (this.#engine.startRecognition(targetTimeMs)) {
      this.#scheduleDeadline();
      this.#pushGuide();
    } else {
      this.#guideAnchors = null;
      this.#cancelCountIn();
    }
  }

  /**
   * Schedules the count-in and returns the GO time, or null to run the trial without a count-in.
   * A suspended context does not advance its clock, and its output timestamp can be stale for a moment
   * after resuming. Either would put GO in the past, so such targets are refused.
   */
  #scheduleTarget(): number | null {
    const context = this.#audio.context;
    const timeline = this.#timeline;
    const metronome = this.#metronome;
    if (context === null || timeline === null || metronome === null || context !== this.#boundAudioContext) {
      this.#audioNotice = "unavailable";
      return null;
    }
    if (context.state !== "running") {
      this.#audioNotice = "stopped";
      return null;
    }
    const targetBeat = timeline.nextWholeBeat(context.currentTime, 3);
    const targetTimeMs = this.#audio.toPerformanceTimeMs(timeline.beatToContextTimeSec(targetBeat));
    const leadMs = targetTimeMs === null ? null : targetTimeMs - performance.now();
    if (targetTimeMs === null || leadMs === null || leadMs < MIN_TARGET_LEAD_MS || leadMs > MAX_TARGET_LEAD_MS) {
      this.#audioNotice = "stopped";
      return null;
    }
    this.#audioNotice = null;
    metronome.scheduleBeat(targetBeat - 2);
    metronome.scheduleBeat(targetBeat - 1);
    metronome.scheduleBeat(targetBeat);
    return targetTimeMs;
  }

  #cancelCountIn(): void {
    this.#metronome?.cancelScheduled();
  }

  #recordOutcome(outcome: Exclude<P1Outcome, "success">): void {
    const reasonCodes = outcome === "tracking-loss" ? ["tracking-lost"] : ["manual-observation"];
    if (this.#engine.recordOutcome(outcome, reasonCodes, performance.now())) this.#handleTrialFinished();
    this.#render();
  }

  #skip(): void {
    if (this.#engine.skip(performance.now())) this.#handleTrialFinished();
    this.#render();
  }

  #timeout(): void {
    const deadline = currentDeadline(this.#engine.snapshot.protocol);
    // The trial ends at its deadline; the timer only waited for frames captured before it.
    if (this.#engine.timeout(deadline ?? performance.now())) this.#handleTrialFinished();
    this.#render();
  }

  #pause(reason: P1PauseReason): void {
    if (!this.#sessionStarted) return;
    if (this.#engine.pause(performance.now(), reason)) {
      this.#clearProgressTimers();
      this.#cancelCountIn();
      this.#tapStart = null;
      this.#cueTiming = null;
      this.#goodUntilMs = Number.NEGATIVE_INFINITY;
      this.#guideAnchors = null;
      this.#options.onGuideChange(null);
      this.#revealBlockOnRender = true;
      // No trial is running while paused, so the screen may sleep again until "再開".
      void this.#wakeLock.release();
    }
    this.#render();
  }

  #handleTrialFinished(snapshot: Phase1LabSnapshot = this.#engine.snapshot): void {
    this.#clearDeadlineTimer();
    this.#cancelCountIn();
    this.#cueTiming = null;
    // The next attempt has its own start position; the guide goes back to the drawn circles.
    this.#guideAnchors = null;
    const protocol = snapshot.protocol;
    // A trial that succeeded says so over the camera image; a timeout shows nothing and moves on.
    if (protocol.results.at(-1)?.outcome === "success") this.#goodUntilMs = performance.now() + GOOD_DISPLAY_MS;
    this.#performance.syncBlocks(protocol);
    if (protocol.state === "complete") {
      this.#clearAutoAdvanceTimer();
      this.#autoAdvanceAtMs = null;
      this.#options.onGuideChange(null);
      this.#revealBlockOnRender = true;
      void this.#wakeLock.release();
      return;
    }
    const blockChange = protocol.awaitingBlockStart;
    // Open the next block now so manual/visibility/camera pauses work while the guide is shown.
    if (blockChange) this.#engine.startBlock(performance.now());
    // The next circles and path appear at once, so the tester can get into position.
    this.#pushGuide();
    if (blockChange) {
      // A new movement waits for a tap: nobody is rushed into a gesture they have not read yet.
      this.#clearAutoAdvanceTimer();
      this.#autoAdvanceAtMs = null;
      this.#armTap("block");
      this.#render();
      return;
    }
    this.#autoAdvanceAtMs = performance.now() + RESULT_HOLD_MS;
    this.#scheduleAutoAdvance();
  }

  #scheduleDeadline(): void {
    this.#clearDeadlineTimer();
    const deadline = currentDeadline(this.#engine.snapshot.protocol);
    if (deadline === null || document.visibilityState !== "visible") return;
    const delay = Math.max(0, deadline + DEADLINE_FRAME_GRACE_MS - performance.now());
    this.#deadlineTimer = window.setTimeout(() => {
      this.#deadlineTimer = null;
      if (document.visibilityState === "visible") this.#timeout();
    }, delay);
  }

  #scheduleAutoAdvance(): void {
    this.#clearAutoAdvanceTimer();
    if (this.#autoAdvanceAtMs === null || document.visibilityState !== "visible") return;
    const delay = Math.max(0, this.#autoAdvanceAtMs - performance.now());
    this.#autoAdvanceTimer = window.setTimeout(() => {
      this.#autoAdvanceTimer = null;
      if (document.visibilityState === "visible") this.#beginNextTrial();
    }, delay);
  }

  readonly #handleVisibilityChange = (): void => {
    if (document.visibilityState !== "visible") {
      const protocol = this.#engine.snapshot.protocol;
      if (this.#sessionStarted && protocol.state === "running" && !protocol.paused && !protocol.awaitingBlockStart) {
        // Hidden time must not count toward a trial, also between the trials of a block.
        // An active attempt is discarded and repeated after "再開".
        this.#pause("page-hidden");
      }
      this.#clearDeadlineTimer();
      this.#clearAutoAdvanceTimer();
      return;
    }
    if (this.#engine.snapshot.protocol.paused) {
      this.#render();
      return;
    }
    if (this.#autoAdvanceAtMs !== null && performance.now() >= this.#autoAdvanceAtMs) {
      this.#beginNextTrial();
    } else {
      this.#scheduleAutoAdvance();
    }
    this.#render();
  };

  #clearProgressTimers(): void {
    this.#clearDeadlineTimer();
    this.#clearAutoAdvanceTimer();
    this.#autoAdvanceAtMs = null;
  }

  #clearDeadlineTimer(): void {
    if (this.#deadlineTimer !== null) window.clearTimeout(this.#deadlineTimer);
    this.#deadlineTimer = null;
  }

  #clearAutoAdvanceTimer(): void {
    if (this.#autoAdvanceTimer !== null) window.clearTimeout(this.#autoAdvanceTimer);
    this.#autoAdvanceTimer = null;
  }

  #recordFalseTrigger(): void {
    const protocol = this.#engine.snapshot.protocol;
    // Between trials, during a rest, and after completion, a reaction belongs to the gesture just performed.
    // While paused, it belongs to the trial that will be repeated.
    const trial = protocol.activeTrial
      ?? (protocol.paused ? protocol.nextTrial : protocol.results.at(-1)?.trial ?? protocol.nextTrial);
    const gestureType = trial?.gesture ?? "air-tap";
    const event: GestureEvent = {
      id: createGestureEventId(gestureType),
      gestureType,
      eventTimeMs: performance.now(),
      handIds: [],
      confidence: 0,
      quality: trial?.swipeDirection !== undefined
        ? { direction: trial.swipeDirection }
        : trial?.spotlightVariant !== undefined
          ? { spotlightVariant: trial.spotlightVariant }
          : trial?.diagonalLiftVariant !== undefined
            ? { diagonalLiftVariant: trial.diagonalLiftVariant }
            : {},
      trackingQuality: "observed",
      reasonCodes: ["manual-observation"],
    };
    this.#engine.recordFalseTrigger(event);
    this.#render();
  }

  /**
   * The tester screen has one save button. It writes the result JSON and then, a moment later,
   * the diagnostic file, and names both files so the tester knows what to send back.
   */
  async #saveResults(): Promise<void> {
    if (!this.#testerView) {
      await this.#export();
      return;
    }
    if (this.#saving) return;
    this.#saving = true;
    this.#savedFileNames = [];
    this.#render();
    const status = requiredElement(this.#root, "#p1-export-status");
    const names = requiredElement(this.#root, "#p1-replay-export-status");
    try {
      const resultName = await this.#export();
      if (resultName === null) return;
      status.textContent = "結果を保存しました。診断データを保存しています…";
      // Chrome asks once before a second download; the pause keeps that prompt away from the first file.
      await new Promise<void>((resolve) => window.setTimeout(resolve, SECOND_EXPORT_DELAY_MS));
      const replayName = await this.#exportReplay();
      this.#savedFileNames = replayName === null ? [resultName] : [resultName, replayName];
      status.textContent = replayName === null
        ? "結果は保存できましたが、診断データを保存できませんでした。「診断データだけをもう一度保存」を押してください。"
        : "保存した2つのファイルを送ってください。";
      names.textContent = this.#savedFileNames.join(" ／ ");
    } finally {
      this.#saving = false;
      this.#render();
    }
  }

  /** Saves the result JSON and returns its file name, or null when it could not be written. */
  async #export(): Promise<string | null> {
    const status = requiredElement(this.#root, "#p1-export-status");
    const sessionId = this.#engine.sessionId;
    try {
      if (!this.#sessionProfileMatches()) {
        throw new Error("実験プロファイルが変わっています。テストを最初からやり直してから保存してください。");
      }
      if (this.#engine.diagnosticFrameCount > 0) await this.#waitForDiagnosticPostRoll(status);
      if (this.#engine.sessionId !== sessionId) return null;
      this.#performance.syncBlocks(this.#engine.snapshot.protocol);
      const document = this.#engine.createDocument(
        this.#options.getTechnicalSummary(),
        this.#options.getTechnicalSnapshot(),
        { performance: this.#performance.report(), environment: this.#environmentReport() },
      );
      const fileName = `${document.session.sessionId}.json`;
      downloadJson(document, fileName);
      status.textContent = "軽量なP1結果JSONを保存しました。映像・音声・リプレイ用フレームは含みません。";
      this.#exportNotice = "結果JSONを保存しました。映像と音声は含みません。";
      this.#render();
      return fileName;
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
      this.#exportNotice = status.textContent;
      this.#render();
      return null;
    }
  }

  /** Saves the diagnostic replay and returns its file name, or null when it could not be written. */
  async #exportReplay(): Promise<string | null> {
    const status = requiredElement(this.#root, "#p1-replay-export-status");
    const sessionId = this.#engine.sessionId;
    try {
      if (!this.#sessionProfileMatches()) {
        throw new Error("実験プロファイルが変わっています。テストを最初からやり直してから保存してください。");
      }
      await this.#waitForDiagnosticPostRoll(status);
      if (this.#engine.sessionId !== sessionId) return null;
      const document = this.#engine.createDiagnosticReplay();
      const fileName = `${document.session.sessionId}-diagnostic-replay.json`;
      downloadJson(document, fileName);
      status.textContent = `${document.frames.length}フレームの診断リプレイを別ファイルで保存しました。`;
      return fileName;
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
      return null;
    }
  }

  async #waitForDiagnosticPostRoll(status: HTMLElement): Promise<void> {
    if (!this.#engine.diagnosticPostRollPending) return;
    status.textContent = "診断用に操作後500ミリ秒分のデータを収集中です…";
    const deadline = performance.now() + POST_ROLL_WAIT_TIMEOUT_MS;
    while (this.#engine.diagnosticPostRollPending) {
      if (this.#disposed) throw new Error("P1画面が終了したため保存を中止しました。");
      if (performance.now() >= deadline) {
        throw new Error("操作後の診断データを収集できません。カメラを動作させたまま、もう一度保存してください。");
      }
      await new Promise<void>((resolve) => window.setTimeout(resolve, POST_ROLL_POLL_MS));
    }
  }

  async #loadReplay(input: HTMLInputElement): Promise<void> {
    const status = requiredElement(this.#root, "#p1-replay-status");
    const file = input.files?.[0];
    if (file === undefined) return;
    try {
      this.#replay = parseLandmarkReplayImport(await file.text());
      status.textContent = `${this.#replay.frames.length}フレームを検証しました。現在の試行へ独立評価できます。`;
    } catch (error) {
      this.#replay = null;
      status.textContent = `読み込めません: ${error instanceof Error ? error.message : String(error)}`;
    }
    this.#render();
  }

  #runReplay(): void {
    if (this.#replay === null || this.#engine.snapshot.protocol.activeTrial === null) return;
    const result = this.#engine.evaluateReplay(this.#replay);
    requiredElement(this.#root, "#p1-replay-status").textContent = result.matchingEventCount > 0
      ? `リプレイ内で対象ジェスチャーを検出しました（拒否 ${result.rejectionCount}件）。実機試行の結果には加算していません。`
      : `対象ジェスチャーは未検出です（拒否 ${result.rejectionCount}件）。実機試行の結果には加算していません。`;
    this.#render();
  }

  #render(snapshot: Phase1LabSnapshot = this.#engine.snapshot): void {
    const protocol = snapshot.protocol;
    const active = protocol.activeTrial;
    const next = protocol.nextTrial;
    const now = performance.now();
    const block = currentBlock(protocol);
    const cameraActive = this.#options.getCameraActive();
    // The very first movement is offered the same way as every later one: guide first, then a tap.
    if (this.#testerView
      && this.#tapStart === null
      && !this.#sessionStarted
      && this.#startRequested
      && this.#trackingReady
      && cameraActive) {
      this.#armTap("session");
      this.#pushGuide();
    }
    setData(this.#root, "testState", !this.#sessionStarted ? "idle"
      : protocol.state === "complete" ? "complete" : protocol.paused ? "paused" : "running");
    setText(this.#root, "p1-progress", `${protocol.completed} / ${protocol.total}`);
    setText(
      this.#root,
      "p1-state",
      this.#tapStart !== null && this.#options.getCameraActive()
        ? "画面をタップして開始"
        : trialStateLabel(this.#sessionStarted, snapshot, this.#autoAdvanceAtMs, now),
    );
    setText(this.#root, "p1-remaining", remainingLabel(currentDeadline(protocol), now));
    setText(this.#root, "p1-trial-number", active === null ? "—" : `${active.ordinal} / ${protocol.total}`);
    setText(
      this.#root,
      "p1-block-trial",
      block === undefined ? "—" : `${completedInBlock(protocol, block)} / ${block.trialCount}`,
    );
    setText(this.#root, "p1-gesture", gestureLabel(active?.gesture ?? next?.gesture));
    setText(this.#root, "p1-instruction", instructionLabel(this.#sessionStarted, snapshot));
    renderMotionSample(this.#root, active ?? next);
    this.#renderBlock(protocol, block, cameraActive, now);
    if (this.#revealBlockOnRender) {
      this.#revealBlockOnRender = false;
      this.#revealBlock();
    }
    setText(this.#root, "p1-event-count", String(snapshot.eventCount));
    setText(this.#root, "p1-rejection-count", String(snapshot.rejectionCount));
    setText(this.#root, "p1-false-trigger-count", String(protocol.falseTriggers.length));
    setText(this.#root, "p1-id-conflicts", String(snapshot.idConflictCount));
    const latestResult = protocol.results.at(-1);
    setText(
      this.#root,
      "p1-last-result",
      latestResult === undefined
        ? "—"
        : `${outcomeLabel(latestResult.outcome)}／${resolutionLabel(latestResult.resolution)}${latestResult.offsetMs === null ? "" : `／時刻差 ${formatSigned(latestResult.offsetMs)} ms`}`,
    );
    setText(this.#root, "p1-latest-rejection", latestVisibleReason(snapshot, latestResult));
    const performanceWarning = requiredElement(this.#root, "#p1-performance-warning");
    const notices = [
      this.#options.getPerformanceLow() ? "手の認識が遅れています" : "",
      this.#audioNotice !== null ? "音なし。画面のGOで動いてください" : "",
    ].filter(Boolean);
    setText(this.#root, "p1-performance-warning", notices.join("。"));
    performanceWarning.hidden = notices.length === 0;
    const canBegin = this.#sessionStarted
      && cameraActive
      && protocol.state === "running"
      && !protocol.paused
      && !protocol.awaitingBlockStart
      && active === null
      && next !== null
      && this.#autoAdvanceAtMs === null;
    requiredButton(this.#root, "#p1-next-trial").disabled = !canBegin;
    const startButton = requiredButton(this.#root, "#p1-start-session");
    startButton.disabled = this.#starting || !cameraActive;
    const startLabel = this.#starting
      ? "準備中…"
      : this.#sessionStarted
        ? "テストを最初からやり直す"
        : "テストを開始";
    if (startButton.textContent !== startLabel) startButton.textContent = startLabel;
    requiredButton(this.#root, "#p1-skip").disabled = active === null;
    const sessionProfileMatches = this.#sessionProfileMatches();
    const canExport = this.#sessionStarted && sessionProfileMatches && !this.#saving;
    requiredButton(this.#root, "#p1-export").disabled = !canExport;
    requiredButton(this.#root, "#p1-block-export").disabled = !canExport;
    const replayButton = requiredButton(this.#root, "#p1-export-replay");
    replayButton.disabled = !canExport;
    // The tester only needs the diagnostic file on its own when the second save failed.
    if (this.#testerView) replayButton.hidden = this.#savedFileNames.length === 0;
    this.#renderStage(protocol, cameraActive, now);
    requiredButton(this.#root, "#p1-replay-run").disabled = this.#replay === null || active === null;
    for (const button of this.#root.querySelectorAll<HTMLButtonElement>("[data-p1-outcome]")) {
      button.disabled = active === null;
    }
    this.#renderAudio();
  }

  /**
   * Writes what belongs on the camera image: the one-line instruction, the hint before the
   * count-in, the tap prompt, and the warnings. The count-in itself is written by #tickCue,
   * which reads the same GO time the count-in clicks were scheduled from.
   */
  #renderStage(protocol: P1RunnerSnapshot, cameraActive: boolean, now: number): void {
    const active = protocol.activeTrial;
    const trial = active ?? protocol.nextTrial;
    const running = this.#sessionStarted && protocol.state === "running" && !protocol.paused;
    const showGuideText = trial !== null && (running || this.#tapStart !== null);
    setText(this.#root, "stage-instruction", showGuideText ? guideInstruction(trial) : "");
    const waitingForReady = running && active !== null && protocol.activeTiming === null;
    const preparing = this.#startRequested && !this.#sessionStarted && this.#tapStart === null;
    setText(
      this.#root,
      "stage-hint",
      preparing
        ? "準備しています"
        : waitingForReady
          ? guideReadinessHint(active.gesture)
          : "",
    );
    const tapPrompt = requiredElement(this.#root, "#stage-tap");
    tapPrompt.hidden = this.#tapStart === null || !cameraActive;
    this.#writeCue(now);
  }

  readonly #tickCue = (): void => {
    this.#cueRafId = requestAnimationFrame(this.#tickCue);
    if (this.#disposed) return;
    this.#writeCue(performance.now());
  };

  /**
   * "2", "1", "GO" and "GOOD" over the middle of the camera image. The count is derived from the
   * GO time, which #scheduleTarget computed from the audio clock and gave to the metronome, so the
   * number on screen and the click in the speaker come from the same instant.
   */
  #writeCue(now: number): void {
    const cue = stageCue(now, this.#cueTiming, this.#goodUntilMs);
    if (cue.text === this.#cueText) return;
    this.#cueText = cue.text;
    const element = requiredElement(this.#root, "#stage-cue");
    element.textContent = cue.text;
    element.dataset.kind = cue.kind;
  }

  #renderBlock(
    protocol: P1RunnerSnapshot,
    block: P1BlockRecord | undefined,
    cameraActive: boolean,
    now: number,
  ): void {
    const totalBlocks = protocol.blocks.length;
    const cameraNotice = cameraActive ? "" : "カメラが止まっています。「カメラを開始」を押してから続けてください。";
    let state: BlockPanelState;
    let label: string;
    let title: string;
    let message: string;
    if (!this.#sessionStarted || protocol.state === "idle" || block === undefined) {
      const first = protocol.blocks[0];
      state = "idle";
      label = `ブロック 1 / ${totalBlocks}`;
      title = first === undefined ? "—" : blockTitle(first);
      message = `${first === undefined ? "最初の動き" : gestureLabel(first.gesture)}から始めます。${totalBlocks}つの動きで合計${protocol.total}回です。`;
    } else if (protocol.state === "complete") {
      state = "complete";
      label = `全${totalBlocks}ブロック完了`;
      title = `${protocol.total}回すべて記録しました`;
      message = this.#exportNotice
        ?? (this.#testerView
          ? "「結果を保存」を押すと、結果と診断データの2つのファイルを保存します。"
          : "結果と詳しい診断データを保存してください。");
    } else if (protocol.paused) {
      state = "paused";
      label = `ブロック ${block.index} / ${totalBlocks}・中断中`;
      title = blockTitle(block);
      message = cameraNotice || "中断している時間は判定に含めません。「再開」を押すと、止めた試行を最初からやり直します。";
    } else if (protocol.awaitingBlockStart) {
      const previous = protocol.blocks[block.index - 2];
      state = "rest";
      label = `次はブロック ${block.index} / ${totalBlocks}`;
      title = blockTitle(block);
      message = `${previous === undefined ? "" : `${gestureLabel(previous.gesture)}の結果: 成立 ${successInBlock(protocol, previous)} / ${previous.trialCount}。`}${cameraNotice || restMessage(previous)}`;
    } else {
      state = "running";
      label = `ブロック ${block.index} / ${totalBlocks}`;
      title = blockTitle(block);
      const remaining = `このブロックの残りは${block.trialCount - completedInBlock(protocol, block)}回です。途中で止めたいときは「中断」を押します。`;
      message = this.#audioNotice === "stopped"
        ? `音が止まっているため、カウント音なしで進めています。「中断」→「再開」で音を戻せます。${remaining}`
        : this.#audioNotice === "unavailable"
          ? `カウント音を使えないため、GOの表示だけで進めています。${remaining}`
          : remaining;
    }
    if (state !== this.#blockPanelState) {
      // Newly shown buttons ignore presses for a moment, so the second tap of a double tap is not taken.
      this.#blockPanelState = state;
      this.#blockActionsLockedUntilMs = now + BLOCK_ACTION_LOCK_MS;
      this.#scheduleUnlockRender();
    }
    const locked = now < this.#blockActionsLockedUntilMs || this.#blockActionPending;
    requiredElement(this.#root, "#p1-block").dataset.state = state;
    setText(this.#root, "p1-block-label", label);
    setText(this.#root, "p1-block-title", title);
    setText(this.#root, "p1-block-message", message);
    const startBlockButton = requiredButton(this.#root, "#p1-start-block");
    startBlockButton.hidden = state !== "rest";
    startBlockButton.disabled = state !== "rest" || locked || !cameraActive;
    const pauseButton = requiredButton(this.#root, "#p1-pause");
    pauseButton.hidden = state !== "running";
    pauseButton.disabled = locked;
    const resumeButton = requiredButton(this.#root, "#p1-resume");
    resumeButton.hidden = state !== "paused";
    resumeButton.disabled = locked || !cameraActive;
    requiredButton(this.#root, "#p1-block-export").hidden = state !== "complete";
  }

  #scheduleUnlockRender(): void {
    if (this.#unlockTimer !== null) window.clearTimeout(this.#unlockTimer);
    this.#unlockTimer = window.setTimeout(() => {
      this.#unlockTimer = null;
      if (!this.#disposed) this.#render();
    }, BLOCK_ACTION_LOCK_MS + 10);
  }

  /**
   * Brings the block panel into view at a rest, a pause, or the end. In landscape the card heading sticks to
   * the top of the scrolling panel, so the panel is scrolled below the heading: otherwise the heading, with its
   * restart button, would cover the block buttons.
   */
  #revealBlock(): void {
    if (this.#root.classList.contains("tester-view")) return;
    const block = requiredElement(this.#root, "#p1-block");
    const heading = this.#root.querySelector<HTMLElement>(".p1-trial-card .p1-card-heading");
    const stickyHeight = heading !== null && getComputedStyle(heading).position === "sticky"
      ? heading.getBoundingClientRect().height
      : 0;
    block.style.scrollMarginTop = `${Math.ceil(stickyHeight) + 6}px`;
    block.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  /** Audio latency, drawing fps, and the wake lock outcome were only on screen until schema v6. */
  #environmentReport(): Phase1EnvironmentReport {
    const audio = this.#audioSnapshot;
    const inputs = this.#options.getEnvironmentInputs();
    return {
      audio: {
        state: audio?.state ?? null,
        source: audio?.source ?? null,
        baseLatencySec: audio?.baseLatencySec ?? null,
        outputLatencySec: audio?.outputLatencySec ?? null,
      },
      displayFps: inputs.displayFps,
      cameraFrameSource: inputs.cameraFrameSource,
      trackingFrameSource: inputs.trackingFrameSource,
      firstAcquisitionMs: inputs.firstAcquisitionMs,
      screenWakeLock: this.#wakeLock.status,
    };
  }

  #sessionProfileMatches(): boolean {
    return this.#sessionExperimentProfileId === null
      || this.#sessionExperimentProfileId === this.#options.getTechnicalSnapshot().experimentProfileId;
  }

  #renderAudio(): void {
    const snapshot = this.#audioSnapshot;
    setText(this.#root, "p1-audio-state", audioStateLabel(snapshot?.state));
    setText(this.#root, "p1-audio-source", audioSourceLabel(snapshot?.source));
    setText(this.#root, "p1-audio-time", snapshot === null ? "—" : `${snapshot.contextTimeSec.toFixed(3)} s`);
    setText(this.#root, "p1-base-latency", formatSeconds(snapshot?.baseLatencySec));
    setText(this.#root, "p1-output-latency", formatSeconds(snapshot?.outputLatencySec));
  }
}

function currentDeadline(protocol: P1RunnerSnapshot): number | null {
  return protocol.activeTiming?.deadlineTimeMs ?? protocol.activeReadiness?.deadlineTimeMs ?? null;
}

function currentBlock(protocol: P1RunnerSnapshot): P1BlockRecord | undefined {
  if (protocol.currentBlockIndex !== null) return protocol.blocks[protocol.currentBlockIndex];
  return protocol.state === "complete" ? protocol.blocks.at(-1) : protocol.blocks[0];
}

function completedInBlock(protocol: P1RunnerSnapshot, block: P1BlockRecord): number {
  return protocol.results.filter(({ trial }) => (
    trial.ordinal >= block.firstOrdinal && trial.ordinal <= block.lastOrdinal
  )).length;
}

function successInBlock(protocol: P1RunnerSnapshot, block: P1BlockRecord): number {
  return protocol.results.filter(({ trial, outcome }) => (
    outcome === "success" && trial.ordinal >= block.firstOrdinal && trial.ordinal <= block.lastOrdinal
  )).length;
}

function blockTitle(block: P1BlockRecord): string {
  return `${gestureLabel(block.gesture)} ${block.trialCount}回`;
}

function restMessage(previous: P1BlockRecord | undefined): string {
  if (previous?.restAfter === "extended") {
    return "腕を下ろして肩と手首を休め、準備ができたら画面をタップしてください。";
  }
  return "準備ができたら画面をタップしてください。";
}

function trialStateLabel(
  sessionStarted: boolean,
  snapshot: Phase1LabSnapshot,
  autoAdvanceAtMs: number | null,
  now: number,
): string {
  const protocol = snapshot.protocol;
  if (!sessionStarted) return "未開始";
  if (protocol.state === "complete") return "完了";
  if (protocol.paused) return "中断中";
  if (protocol.activeTrial !== null) {
    const timing = protocol.activeTiming;
    if (timing === null) {
      return snapshot.readiness !== null && snapshot.readiness.visibleHands < 2 ? "追跡待ち" : "準備中";
    }
    if (timing.targetTimeMs !== null) {
      // "準備OK" lasts until the first count-in click; the count is shown while the clicks play.
      if (now < timing.targetTimeMs - COUNT_IN_LEAD_MS) return timing.readyAtMs === null ? "カウント" : "準備OK";
      if (now < timing.targetTimeMs) return String(Math.ceil((timing.targetTimeMs - now) / (60_000 / COUNT_IN_BPM)));
      if (now < timing.targetTimeMs + GO_DISPLAY_MS) return "GO";
      return "判定中";
    }
    if (now < timing.windowOpenedAtMs + GO_DISPLAY_MS) return "GO";
    return "判定中";
  }
  if (autoAdvanceAtMs !== null) {
    return `次の動きまで ${Math.max(1, Math.ceil((autoAdvanceAtMs - now) / 1_000))}秒`;
  }
  if (protocol.awaitingBlockStart) return protocol.results.length === 0 ? "ブロック開始待ち" : "休憩中";
  return "次の試行待ち";
}

function instructionLabel(sessionStarted: boolean, snapshot: Phase1LabSnapshot): string {
  const protocol = snapshot.protocol;
  const active = protocol.activeTrial;
  if (!sessionStarted) return protocol.nextTrial?.instruction ?? "セッションを開始してください";
  if (protocol.state === "complete") return "すべての試行が終わりました。結果JSONを保存してください";
  if (protocol.paused) return "「再開」で、止めた試行を最初からやり直します";
  if (active !== null && protocol.activeTiming === null) {
    if (snapshot.readiness !== null && snapshot.readiness.visibleHands < 2) {
      return "両手が映るのを待っています。両手をカメラに向けてください";
    }
    return active.gesture === "lift" || active.gesture === "diagonal-lift"
      ? "両手を画面の下側、左右の枠に構えて止めてください。そろうと合図が始まります"
      : "両手を離して左右の丸印に合わせて止めてください。そろうと合図が始まります";
  }
  if (active === null && protocol.awaitingBlockStart) {
    return `次の動き: ${protocol.nextTrial?.instruction ?? "—"}`;
  }
  return active?.instruction ?? protocol.nextTrial?.instruction ?? "—";
}

function remainingLabel(deadlineTimeMs: number | null, now: number): string {
  if (deadlineTimeMs === null) return "—";
  return `${Math.max(0, Math.ceil((deadlineTimeMs - now) / 1_000))}秒`;
}

function latestVisibleReason(
  snapshot: Phase1LabSnapshot,
  latestResult: P1RunnerSnapshot["results"][number] | undefined,
): string {
  const diagnostic = snapshot.latestDiagnostic;
  if (diagnostic !== null && (latestResult === undefined || diagnostic.timeMs > latestResult.finishedAtMs)) {
    return diagnostic.reasonCodes.map(reasonLabel).join(" / ");
  }
  if (latestResult?.resolution === "manual-skip") return reasonLabel("manual-skip");
  if (latestResult?.resolution === "trial-timeout") {
    if (latestResult.timeoutPhase !== "readiness") return reasonLabel("trial-timeout");
    const cause = latestResult.reasonCodes.find((code) => READINESS_CAUSES.includes(code));
    return cause === undefined
      ? reasonLabel("readiness-timeout")
      : `${reasonLabel("readiness-timeout")}（${reasonLabel(cause)}）`;
  }
  if (diagnostic === null) return "—";
  return diagnostic.reasonCodes.map(reasonLabel).join(" / ");
}

const READINESS_CAUSES: readonly string[] = [
  "readiness-hands-missing",
  "readiness-outside-zone",
  "readiness-not-still",
];

function reasonLabel(reason: string): string {
  return {
    "tracking-lost": "手を一時的に追跡できませんでした",
    "off-axis": "ガイドの帯から外れました",
    "wrong-direction": "指定と逆方向へ動きました",
    "candidate-timeout": "動作の移動時間が上限を超えました",
    "bloom-not-outward": "両手を左右外向きへ開く動きになっていません",
    "bloom-not-upward": "両手を斜め上へ開く動きになっていません",
    "bloom-outward-distance-insufficient": "左右への開きが足りません",
    "bloom-upward-distance-insufficient": "上向きの移動が足りません",
    "bloom-sync-expired": "両手の開くタイミングが離れすぎています",
    "lift-not-ready": "両手が下側の開始位置にありません",
    "lift-not-upward": "両手を真上へ上げる動きになっていません",
    "lift-distance-insufficient": "上げる高さが足りません",
    "lift-sync-expired": "両手の上がるタイミングが離れすぎています",
    "diagonal-lift-not-ready": "両手が下側の開始位置にありません",
    "diagonal-lift-wrong-direction": "指定した斜めの向きから外れました",
    "diagonal-lift-distance-insufficient": "斜めに動かす距離が足りません",
    "diagonal-lift-sync-expired": "両手の動くタイミングが離れすぎています",
    "spotlight-wrong-zone": "両手が上と下に分かれていません",
    "spotlight-pose-not-held": "形を約0.3秒止める前に手が動きました",
    "spotlight-wrong-side": "上下の左右が逆です",
    "spotlight-pose-before-go": "GOの前に形ができていました。一度ほどいて、GOの後に作り直してください",
    "spotlight-hands-not-separated": "左右の手が中央の線の両側に分かれていません",
    "movement-too-slow": "動きがゆっくりすぎます",
    "trial-timeout": `${P1_TRIAL_TIMEOUT_MS / 1_000}秒で未成立として記録しました`,
    "readiness-timeout": `${P1_READINESS_TIMEOUT_MS / 1_000}秒以内に開始の構えがそろわず、未成立として記録しました`,
    "readiness-hands-missing": "両手がそろって映りませんでした",
    "readiness-outside-zone": "両手が開始位置の枠に入りませんでした",
    "readiness-not-still": "開始位置で手が止まりませんでした",
    "manual-skip": "未成立として次へ進みました",
    "identity-conflict": "手の識別が一時的に競合しました",
  }[reason] ?? reason;
}

function gestureLabel(gesture: string | null | undefined): string {
  return {
    "air-tap": "エアタップ",
    "ribbon-swipe": "リボンスワイプ",
    bloom: "Bloom",
    lift: "Lift",
    spotlight: "Spotlight",
    "diagonal-lift": "ななめリフト",
    clap: "旧クラップ",
  }[gesture ?? ""] ?? "—";
}

function outcomeLabel(outcome: string): string {
  return {
    success: "成功",
    "player-miss": "操作が条件外",
    "machine-miss": "正しく操作したが未検出",
    "tracking-loss": "手の追跡失敗",
    unclassified: "分類不能",
  }[outcome] ?? outcome;
}

function renderMotionSample(root: ParentNode, trial: P1TrialDefinition | null): void {
  const sample = requiredElement(root, "#p1-motion-sample");
  if (trial === null) {
    setData(sample, "gesture", "idle");
    setData(sample, "variant", "none");
    setLabel(sample, "試行を始めると、ここに手の動きを表示します");
    setText(root, "p1-motion-caption", "試行を始めると、ここに手の動きを表示します");
    return;
  }

  const variant = trial.gesture === "air-tap"
    ? trial.airTapSide ?? "left"
    : trial.gesture === "ribbon-swipe"
      ? trial.swipeDirection ?? "left-to-right"
      : trial.gesture === "spotlight"
        ? trial.spotlightVariant ?? "left-up-right-down"
        : trial.gesture === "diagonal-lift"
          ? trial.diagonalLiftVariant ?? "up-right"
          : trial.gesture === "lift"
            ? "raise"
            : "open-up";
  const caption = motionSampleCaption(trial);
  setData(sample, "gesture", trial.gesture);
  setData(sample, "variant", variant);
  setLabel(sample, caption);
  setText(root, "p1-motion-caption", caption);
}

function motionSampleCaption(trial: P1TrialDefinition): string {
  if (trial.gesture === "air-tap") {
    return `${trial.airTapSide === "right" ? "右" : "左"}手の人差し指を、リングの外から中へ通す`;
  }
  if (trial.gesture === "ribbon-swipe") {
    return {
      "left-to-right": "片手を左から右へ、帯に沿って動かす",
      "right-to-left": "片手を右から左へ、帯に沿って動かす",
      "lower-left-to-upper-right": "片手を左下から右上へ、帯に沿って動かす",
      "lower-right-to-upper-left": "片手を右下から左上へ、帯に沿って動かす",
    }[trial.swipeDirection ?? "left-to-right"];
  }
  if (trial.gesture === "lift") return "両手を下側にそろえて構え、GOで平行に真上へ上げる";
  if (trial.gesture === "diagonal-lift") {
    const variant = trial.diagonalLiftVariant ?? "up-right";
    return `両手を下側の左右に離して構え、GOで平行に${diagonalLiftVariantLabel(variant)}動かす`;
  }
  if (trial.gesture === "spotlight") {
    return `GOで${spotlightVariantLabel(trial.spotlightVariant ?? "left-up-right-down")}の位置へ動かし、約0.3秒止める`;
  }
  return "両手を離して画面中央の左右の丸印に構え、GOで左右斜め上へ開く";
}

function resolutionLabel(resolution: string): string {
  return {
    "gesture-event": "自動判定",
    "manual-classification": "手動分類",
    "manual-skip": "手動で次へ",
    "trial-timeout": "時間切れ",
  }[resolution] ?? resolution;
}

function audioStateLabel(state: string | undefined): string {
  if (state === undefined) return "未開始";
  return {
    suspended: "一時停止中",
    running: "動作中",
    closed: "終了",
    interrupted: "中断",
  }[state] ?? state;
}

function audioSourceLabel(source: string | undefined): string {
  if (source === undefined) return "—";
  return {
    "output-timestamp": "出力時刻を取得",
    "current-time-sample": "現在時刻から推定",
  }[source] ?? source;
}

function downloadJson(value: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(value)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function requiredButton(root: ParentNode, selector: string): HTMLButtonElement {
  const element = root.querySelector(selector);
  if (!(element instanceof HTMLButtonElement)) throw new Error(`Required button not found: ${selector}`);
  return element;
}

function requiredElement(root: ParentNode, selector: string): HTMLElement {
  const element = root.querySelector(selector);
  if (!(element instanceof HTMLElement)) throw new Error(`Required element not found: ${selector}`);
  return element;
}

/** Writes only changed text, so live regions do not announce the same words on every frame. */
function setText(root: ParentNode, id: string, value: string): void {
  const element = requiredElement(root, `#${id}`);
  if (element.textContent !== value) element.textContent = value;
}

function setData(element: HTMLElement, key: string, value: string): void {
  if (element.dataset[key] !== value) element.dataset[key] = value;
}

function setLabel(element: HTMLElement, value: string): void {
  if (element.getAttribute("aria-label") !== value) element.setAttribute("aria-label", value);
}

function formatSeconds(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${(value * 1_000).toFixed(1)} ms`;
}

function formatSigned(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}
