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

export interface Phase1LabControllerOptions {
  readonly getProvider: () => TrackingProviderInfo | null;
  readonly getTechnicalSummary: () => Phase1TechnicalSummary;
  readonly getTechnicalSnapshot: () => DeviceTechnicalSnapshot;
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
  #sessionStarted = false;
  #replay: LandmarkReplayDocument | null = null;

  constructor(root: HTMLElement, options: Phase1LabControllerOptions) {
    this.#root = root;
    this.#options = options;
    requiredButton(root, "#p1-enable-audio").addEventListener("click", () => void this.#enableAudio());
    requiredButton(root, "#p1-start-session").addEventListener("click", () => this.#startSession());
    requiredButton(root, "#p1-next-trial").addEventListener("click", () => this.#beginNextTrial());
    requiredButton(root, "#p1-false-trigger").addEventListener("click", () => this.#recordFalseTrigger());
    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-p1-outcome]")) {
      button.addEventListener("click", () => this.#recordOutcome(button.dataset.p1Outcome as Exclude<P1Outcome, "success">));
    }
    requiredButton(root, "#p1-export").addEventListener("click", () => this.#export());
    const replayInput = root.querySelector("#p1-replay-file");
    if (!(replayInput instanceof HTMLInputElement)) throw new Error("Required replay input not found.");
    replayInput.addEventListener("change", () => void this.#loadReplay(replayInput));
    requiredButton(root, "#p1-replay-run").addEventListener("click", () => this.#runReplay());
    this.#render();
  }

  processFrame(frame: HandTrackingFrame): void {
    if (!this.#sessionStarted) return;
    const before = this.#engine.snapshot.protocol.completed;
    const snapshot = this.#engine.processFrame(frame);
    if (snapshot.protocol.completed > before) this.#options.onGuideChange(null);
    this.#render(snapshot);
  }

  async dispose(): Promise<void> {
    if (this.#audioTimer !== null) window.clearInterval(this.#audioTimer);
    this.#audioTimer = null;
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
    const sessionId = `p1-${new Date().toISOString().replace(/[-:.TZ]/g, "")}`;
    this.#engine.startSession(sessionId, this.#options.getProvider());
    this.#sessionStarted = true;
    this.#options.onGuideChange(null);
    requiredElement(this.#root, "#p1-session-id").textContent = sessionId;
    requiredElement(this.#root, "#p1-export-status").textContent = "";
    this.#render();
  }

  #beginNextTrial(): void {
    if (!this.#sessionStarted) return;
    const targetTimeMs = this.#scheduleTarget();
    const trial = this.#engine.beginNextTrial(targetTimeMs);
    this.#options.onGuideChange(trial);
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
    try {
      const reasonCodes = outcome === "tracking-loss" ? ["tracking-lost"] : ["manual-observation"];
      this.#engine.recordOutcome(outcome, reasonCodes);
      this.#options.onGuideChange(null);
      this.#render();
    } catch (error) {
      requiredElement(this.#root, "#p1-export-status").textContent = error instanceof Error ? error.message : String(error);
    }
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

  #export(): void {
    try {
      const document = this.#engine.createDocument(
        this.#options.getTechnicalSummary(),
        this.#options.getTechnicalSnapshot(),
      );
      const blob = new Blob([JSON.stringify(document, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = `${document.replay.session.sessionId}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      requiredElement(this.#root, "#p1-export-status").textContent = "P1セッションJSONを保存しました。生映像・音声は含みません。";
    } catch (error) {
      requiredElement(this.#root, "#p1-export-status").textContent = error instanceof Error ? error.message : String(error);
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
    setText(this.#root, "p1-progress", `${protocol.completed} / ${protocol.total}`);
    setText(this.#root, "p1-state", this.#sessionStarted ? stateLabel(protocol.state) : "未開始");
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
        : `${latestResult.outcome}${latestResult.offsetMs === null ? "" : ` / ${formatSigned(latestResult.offsetMs)} ms`}`,
    );
    const canBegin = this.#sessionStarted && protocol.state === "running" && active === null && next !== null;
    requiredButton(this.#root, "#p1-next-trial").disabled = !canBegin;
    requiredButton(this.#root, "#p1-export").disabled = !this.#sessionStarted;
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

function stateLabel(state: "idle" | "running" | "complete"): string {
  return { idle: "待機", running: "制御試験中", complete: "30試行完了" }[state];
}

function formatSeconds(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${(value * 1_000).toFixed(1)} ms`;
}

function formatSigned(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}
