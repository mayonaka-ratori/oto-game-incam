import { createGestureEventId, type GestureEvent } from "../gestures/gesture-types";
import type { HandTrackingFrame, TrackingProviderInfo } from "../tracking/tracking-types";
import { AudioClock, type AudioClockSnapshot } from "../time/audio-clock";
import { BeatTimeline } from "../time/beat-timeline";
import { Metronome } from "../time/metronome";
import { parseLandmarkReplayImport, type LandmarkReplayDocument } from "../replay/landmark-replay";
import { Phase1LabEngine, type Phase1LabSnapshot } from "./phase1-lab-engine";
import type { P1Outcome, P1TrialDefinition } from "./phase1-protocol";
import type { Phase1TechnicalSummary } from "./phase1-session";
import type { DeviceTechnicalSnapshot } from "../metrics/device-technical-snapshot";

const RESULT_HOLD_MS = 1_000;
const TIMER_RENDER_INTERVAL_MS = 250;
const POST_ROLL_POLL_MS = 50;
const POST_ROLL_WAIT_TIMEOUT_MS = 5_000;

export interface Phase1LabControllerOptions {
  readonly getProvider: () => TrackingProviderInfo | null;
  readonly getTechnicalSummary: () => Phase1TechnicalSummary;
  readonly getTechnicalSnapshot: () => DeviceTechnicalSnapshot;
  readonly getPerformanceLow: () => boolean;
  readonly onGuideChange: (trial: P1TrialDefinition | null) => void;
}

export class Phase1LabController {
  readonly #root: HTMLElement;
  readonly #options: Phase1LabControllerOptions;
  readonly #engine = new Phase1LabEngine();
  readonly #audio = new AudioClock();
  #timeline: BeatTimeline | null = null;
  #metronome: Metronome | null = null;
  #audioSnapshot: AudioClockSnapshot | null = null;
  #audioTimer: number | null = null;
  #deadlineTimer: number | null = null;
  #autoAdvanceTimer: number | null = null;
  #renderTimer: number | null = null;
  #autoAdvanceAtMs: number | null = null;
  #sessionStarted = false;
  #replay: LandmarkReplayDocument | null = null;
  #disposed = false;

  constructor(root: HTMLElement, options: Phase1LabControllerOptions) {
    this.#root = root;
    this.#options = options;
    requiredButton(root, "#p1-enable-audio").addEventListener("click", () => void this.#enableAudio());
    requiredButton(root, "#p1-start-session").addEventListener("click", () => this.#startSession());
    requiredButton(root, "#p1-next-trial").addEventListener("click", () => this.#beginNextTrial());
    requiredButton(root, "#p1-skip").addEventListener("click", () => this.#skip());
    requiredButton(root, "#p1-false-trigger").addEventListener("click", () => this.#recordFalseTrigger());
    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-p1-outcome]")) {
      button.addEventListener("click", () => this.#recordOutcome(button.dataset.p1Outcome as Exclude<P1Outcome, "success">));
    }
    requiredButton(root, "#p1-export").addEventListener("click", () => void this.#export());
    requiredButton(root, "#p1-export-replay").addEventListener("click", () => void this.#exportReplay());
    const replayInput = root.querySelector("#p1-replay-file");
    if (!(replayInput instanceof HTMLInputElement)) throw new Error("Required replay input not found.");
    replayInput.addEventListener("change", () => void this.#loadReplay(replayInput));
    requiredButton(root, "#p1-replay-run").addEventListener("click", () => this.#runReplay());
    document.addEventListener("visibilitychange", this.#handleVisibilityChange);
    this.#renderTimer = window.setInterval(() => {
      if (!this.#disposed && document.visibilityState === "visible") this.#render();
    }, TIMER_RENDER_INTERVAL_MS);
    this.#render();
  }

  processFrame(frame: HandTrackingFrame): void {
    if (!this.#sessionStarted || this.#disposed) return;
    const before = this.#engine.snapshot.protocol.completed;
    const snapshot = this.#engine.processFrame(frame);
    if (snapshot.protocol.completed > before) this.#handleTrialFinished(snapshot);
    this.#render(snapshot);
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#clearProgressTimers();
    if (this.#audioTimer !== null) window.clearInterval(this.#audioTimer);
    if (this.#renderTimer !== null) window.clearInterval(this.#renderTimer);
    this.#audioTimer = null;
    this.#renderTimer = null;
    document.removeEventListener("visibilitychange", this.#handleVisibilityChange);
    await this.#audio.close();
  }

  async #enableAudio(): Promise<void> {
    const status = requiredElement(this.#root, "#p1-audio-status");
    try {
      this.#audioSnapshot = await this.#audio.enable();
      const context = this.#audio.context;
      if (context === null) return;
      this.#timeline = new BeatTimeline({ bpm: 120, beatZeroContextTimeSec: context.currentTime + 0.25 });
      this.#metronome = new Metronome(context, this.#timeline);
      if (this.#audioTimer !== null) window.clearInterval(this.#audioTimer);
      this.#audioTimer = window.setInterval(() => {
        this.#audioSnapshot = this.#audio.sample();
        this.#renderAudio();
      }, 500);
      status.textContent = "音声クロック準備完了。試行開始時にカウント音を予約します。";
    } catch (error) {
      status.textContent = `音声クロックを開始できません: ${error instanceof Error ? error.message : String(error)}`;
    }
    this.#renderAudio();
  }

  #startSession(): void {
    this.#clearProgressTimers();
    const sessionId = `p1-${new Date().toISOString().replace(/[-:.TZ]/g, "")}`;
    this.#engine.startSession(sessionId, this.#options.getProvider());
    this.#sessionStarted = true;
    this.#options.onGuideChange(null);
    requiredElement(this.#root, "#p1-session-id").textContent = sessionId;
    requiredElement(this.#root, "#p1-export-status").textContent = "";
    requiredElement(this.#root, "#p1-replay-export-status").textContent = "";
    this.#render();
  }

  #beginNextTrial(): void {
    if (!this.#sessionStarted || this.#disposed || document.visibilityState !== "visible") return;
    this.#clearDeadlineTimer();
    this.#clearAutoAdvanceTimer();
    this.#autoAdvanceAtMs = null;
    const preparedAtMs = performance.now();
    const targetTimeMs = this.#scheduleTarget();
    const trial = this.#engine.beginNextTrial(targetTimeMs, preparedAtMs);
    this.#options.onGuideChange(trial);
    this.#scheduleDeadline();
    this.#render();
  }

  #scheduleTarget(): number | null {
    const context = this.#audio.context;
    const timeline = this.#timeline;
    const metronome = this.#metronome;
    if (context === null || timeline === null || metronome === null) return null;
    const targetBeat = timeline.nextWholeBeat(context.currentTime, 3);
    metronome.scheduleBeat(targetBeat - 2);
    metronome.scheduleBeat(targetBeat - 1);
    metronome.scheduleBeat(targetBeat);
    return this.#audio.toPerformanceTimeMs(timeline.beatToContextTimeSec(targetBeat));
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
    if (this.#engine.timeout(performance.now())) this.#handleTrialFinished();
    this.#render();
  }

  #handleTrialFinished(snapshot: Phase1LabSnapshot = this.#engine.snapshot): void {
    this.#clearDeadlineTimer();
    this.#options.onGuideChange(null);
    if (snapshot.protocol.state === "complete") {
      this.#clearAutoAdvanceTimer();
      this.#autoAdvanceAtMs = null;
      return;
    }
    this.#autoAdvanceAtMs = performance.now() + RESULT_HOLD_MS;
    this.#scheduleAutoAdvance();
  }

  #scheduleDeadline(): void {
    this.#clearDeadlineTimer();
    const timing = this.#engine.snapshot.protocol.activeTiming;
    if (timing === null || document.visibilityState !== "visible") return;
    const delay = Math.max(0, timing.deadlineTimeMs - performance.now());
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
      this.#clearDeadlineTimer();
      this.#clearAutoAdvanceTimer();
      return;
    }
    const timing = this.#engine.snapshot.protocol.activeTiming;
    if (timing !== null && performance.now() >= timing.deadlineTimeMs) {
      this.#timeout();
      return;
    }
    if (timing !== null) this.#scheduleDeadline();
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
    const trial = this.#engine.snapshot.protocol.activeTrial ?? this.#engine.snapshot.protocol.nextTrial;
    const gestureType = trial?.gesture ?? "air-tap";
    const event: GestureEvent = {
      id: createGestureEventId(gestureType),
      gestureType,
      eventTimeMs: performance.now(),
      handIds: [],
      confidence: 0,
      quality: trial?.swipeDirection === undefined ? {} : { direction: trial.swipeDirection },
      trackingQuality: "observed",
      reasonCodes: ["manual-observation"],
    };
    this.#engine.recordFalseTrigger(event);
    this.#render();
  }

  async #export(): Promise<void> {
    const status = requiredElement(this.#root, "#p1-export-status");
    const sessionId = this.#engine.sessionId;
    try {
      if (this.#engine.diagnosticFrameCount > 0) await this.#waitForDiagnosticPostRoll(status);
      if (this.#engine.sessionId !== sessionId) return;
      const document = this.#engine.createDocument(
        this.#options.getTechnicalSummary(),
        this.#options.getTechnicalSnapshot(),
      );
      downloadJson(document, `${document.session.sessionId}.json`);
      status.textContent = "軽量なP1結果JSONを保存しました。映像・音声・リプレイframeは含みません。";
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  async #exportReplay(): Promise<void> {
    const status = requiredElement(this.#root, "#p1-replay-export-status");
    const sessionId = this.#engine.sessionId;
    try {
      await this.#waitForDiagnosticPostRoll(status);
      if (this.#engine.sessionId !== sessionId) return;
      const document = this.#engine.createDiagnosticReplay();
      downloadJson(document, `${document.session.sessionId}-diagnostic-replay.json`);
      status.textContent = `${document.frames.length}フレームの診断リプレイを別ファイルで保存しました。`;
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  async #waitForDiagnosticPostRoll(status: HTMLElement): Promise<void> {
    if (!this.#engine.diagnosticPostRollPending) return;
    status.textContent = "診断用の500ms post-rollを収集中です…";
    const deadline = performance.now() + POST_ROLL_WAIT_TIMEOUT_MS;
    while (this.#engine.diagnosticPostRollPending) {
      if (this.#disposed) throw new Error("P1画面が終了したため保存を中止しました。");
      if (performance.now() >= deadline) {
        throw new Error("post-rollを完了できません。カメラを動作させたまま、もう一度保存してください。");
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
    setText(this.#root, "p1-progress", `${protocol.completed} / ${protocol.total}`);
    setText(this.#root, "p1-state", trialStateLabel(this.#sessionStarted, snapshot, this.#autoAdvanceAtMs, now));
    setText(this.#root, "p1-remaining", remainingLabel(protocol.activeTiming?.deadlineTimeMs ?? null, now));
    setText(this.#root, "p1-trial-number", active === null ? "—" : `${active.ordinal} / ${protocol.total}`);
    setText(this.#root, "p1-gesture", active?.gesture ?? next?.gesture ?? "—");
    setText(this.#root, "p1-instruction", active?.instruction ?? next?.instruction ?? "セッションを開始してください");
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
        : `${latestResult.outcome} / ${latestResult.resolution}${latestResult.offsetMs === null ? "" : ` / ${formatSigned(latestResult.offsetMs)} ms`}`,
    );
    const latestReason = latestVisibleReason(snapshot, latestResult);
    setText(this.#root, "p1-latest-rejection", latestReason);
    const performanceWarning = requiredElement(this.#root, "#p1-performance-warning");
    performanceWarning.hidden = !this.#options.getPerformanceLow();
    const canBegin = this.#sessionStarted
      && protocol.state === "running"
      && active === null
      && next !== null
      && this.#autoAdvanceAtMs === null;
    requiredButton(this.#root, "#p1-next-trial").disabled = !canBegin;
    requiredButton(this.#root, "#p1-skip").disabled = active === null;
    requiredButton(this.#root, "#p1-export").disabled = !this.#sessionStarted;
    requiredButton(this.#root, "#p1-export-replay").disabled = !this.#sessionStarted;
    requiredButton(this.#root, "#p1-replay-run").disabled = this.#replay === null || active === null;
    for (const button of this.#root.querySelectorAll<HTMLButtonElement>("[data-p1-outcome]")) {
      button.disabled = active === null;
    }
    this.#renderAudio();
  }

  #renderAudio(): void {
    const snapshot = this.#audioSnapshot;
    setText(this.#root, "p1-audio-state", snapshot?.state ?? "未開始");
    setText(this.#root, "p1-audio-source", snapshot?.source ?? "—");
    setText(this.#root, "p1-audio-time", snapshot === null ? "—" : `${snapshot.contextTimeSec.toFixed(3)} s`);
    setText(this.#root, "p1-base-latency", formatSeconds(snapshot?.baseLatencySec));
    setText(this.#root, "p1-output-latency", formatSeconds(snapshot?.outputLatencySec));
  }
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
  const timing = protocol.activeTiming;
  if (timing !== null) {
    if (now < timing.windowOpenedAtMs) return "準備中";
    if (timing.targetTimeMs !== null && now < timing.targetTimeMs + 500) return "GO";
    return "判定中";
  }
  if (autoAdvanceAtMs !== null) {
    return protocol.results.at(-1)?.outcome === "success" ? "成立を記録" : "未成立を記録";
  }
  return "次の試行待ち";
}

function remainingLabel(deadlineTimeMs: number | null, now: number): string {
  if (deadlineTimeMs === null) return "—";
  return `${Math.max(0, Math.ceil((deadlineTimeMs - now) / 1_000))}秒`;
}

function latestVisibleReason(
  snapshot: Phase1LabSnapshot,
  latestResult: Phase1LabSnapshot["protocol"]["results"][number] | undefined,
): string {
  if (latestResult?.resolution === "manual-skip") return reasonLabel("manual-skip");
  if (latestResult?.resolution === "trial-timeout") return reasonLabel("trial-timeout");
  const diagnostic = snapshot.latestDiagnostic;
  if (diagnostic === null) return "—";
  return diagnostic.reasonCodes.map(reasonLabel).join(" / ");
}

function reasonLabel(reason: string): string {
  return {
    "tracking-lost": "手を一時的に追跡できませんでした",
    "off-axis": "ガイドの帯から外れました",
    "wrong-direction": "指定と逆方向へ動きました",
    "candidate-timeout": "スワイプの移動時間が上限を超えました",
    "trial-timeout": "30秒で未成立として記録しました",
    "manual-skip": "未成立として次へ進みました",
    "identity-conflict": "手の識別が一時的に競合しました",
  }[reason] ?? reason;
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

function setText(root: ParentNode, id: string, value: string): void {
  requiredElement(root, `#${id}`).textContent = value;
}

function formatSeconds(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${(value * 1_000).toFixed(1)} ms`;
}

function formatSigned(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}
