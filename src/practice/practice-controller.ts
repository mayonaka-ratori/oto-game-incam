import "./practice.css";
import { ScreenWakeLock } from "../app/screen-wake-lock";
import { APP_BUILD_ID } from "../app/app-build";
import { AudioClock } from "../time/audio-clock";
import { createPracticeMusic } from "./practice-music";
import { COUNT_IN_BEATS, COUNT_IN_SEC, PRACTICE_BEAT_SEC, PRACTICE_BPM, PRACTICE_DURATION_SEC, practiceFrame } from "./practice-timeline";
import { createPracticeView, PracticeGuide, required, setText } from "./practice-view";

type PracticeState = "idle" | "loading" | "countdown" | "playing" | "finished" | "interrupted";

export class PracticeController {
  readonly #root: HTMLElement;
  readonly #guide: PracticeGuide;
  readonly #clock = new AudioClock();
  readonly #wakeLock = new ScreenWakeLock();
  #state: PracticeState = "idle";
  #music: AudioBuffer | null = null;
  #source: AudioBufferSourceNode | null = null;
  #gain: GainNode | null = null;
  #startTimeSec = 0;
  #animation = 0;
  #run = 0;
  #finishedAt: string | null = null;
  #disposed = false;

  constructor(root: HTMLElement) {
    this.#root = root;
    document.body.classList.add("practice-page");
    document.title = "Oto 動きの練習 | カメラなしの30秒版";
    createPracticeView(root);
    this.#guide = new PracticeGuide(root);
    this.#get<HTMLButtonElement>("start").addEventListener("click", () => void this.#start());
    this.#get<HTMLButtonElement>("stop").addEventListener("click", () => this.#interrupt("中断しました。もう一度、最初から試せます。"));
    this.#get<HTMLInputElement>("volume").addEventListener("input", this.#changeVolume);
    this.#get<HTMLFormElement>("feedback").addEventListener("submit", this.#saveFeedback);
    document.addEventListener("visibilitychange", this.#visibilityChange);
    window.addEventListener("pagehide", this.#dispose);
  }

  async #start(): Promise<void> {
    if (this.#isActive() || this.#disposed) return;
    const run = ++this.#run;
    this.#finishedAt = null;
    this.#get<HTMLFormElement>("feedback").reset();
    this.#get("save-status").textContent = "";
    this.#setState("loading");
    setText(this.#get("status"), "音を準備しています。");
    try {
      await this.#clock.enable();
      this.#music ??= await createPracticeMusic();
      if (run !== this.#run || this.#disposed) return;
      const context = this.#clock.context!;
      if (context.state !== "running" || document.visibilityState !== "visible") {
        this.#interrupt("音が止まりました。画面に戻って、もう一度はじめてください。");
        return;
      }
      context.removeEventListener("statechange", this.#audioStateChange);
      context.addEventListener("statechange", this.#audioStateChange);
      const gain = context.createGain();
      gain.gain.value = Number(this.#get<HTMLInputElement>("volume").value) / 100;
      gain.connect(context.destination);
      const source = context.createBufferSource();
      source.buffer = this.#music;
      source.connect(gain);
      this.#gain = gain;
      this.#source = source;
      this.#startTimeSec = context.currentTime + 0.15;
      source.start(this.#startTimeSec);
      void this.#wakeLock.acquire();
      this.#setState("countdown");
      setText(this.#get("status"), "4拍の合図のあと、右上へ動かします。");
      this.#tick();
    } catch {
      if (run !== this.#run || this.#disposed) return;
      this.#interrupt("音を開始できませんでした。音を再生できるブラウザで、もう一度はじめてください。");
    }
  }

  readonly #tick = (): void => {
    if (!this.#isActive() || this.#disposed) return;
    const trackElapsed = this.#clock.sample().contextTimeSec - this.#startTimeSec;
    if (trackElapsed < COUNT_IN_SEC) {
      this.#guide.draw({ x: 0, y: 0 });
      const beat = Math.max(0, Math.floor(trackElapsed / PRACTICE_BEAT_SEC));
      this.#guide.beat(beat, COUNT_IN_BEATS);
      setText(this.#get("count-number"), String(COUNT_IN_BEATS - beat));
      setText(this.#get("instruction"), "両手を 楽な高さに");
      setText(this.#get("detail"), "4拍きいたら、画面の右上へ。");
      setText(this.#get("section"), "まもなく はじまります");
      setText(this.#get("next"), "両手を 右上へ");
      this.#get<HTMLProgressElement>("progress").value = 0;
      setText(this.#get("remaining"), "30");
    } else {
      const elapsed = trackElapsed - COUNT_IN_SEC;
      if (elapsed >= PRACTICE_DURATION_SEC) {
        this.#finish();
        return;
      }
      if (this.#state !== "playing") {
        this.#setState("playing");
        setText(this.#get("status"), "曲とお手本に合わせて、楽な幅で動こう。");
      }
      const frame = practiceFrame(elapsed);
      this.#guide.update(frame);
      setText(this.#get("section"), frame.motion === "rest" ? "ひと休み" : elapsed >= 25 ? "最後の8拍" : "曲に合わせて動こう");
      setText(this.#get("remaining"), String(Math.ceil(frame.remainingSec)));
      this.#get<HTMLProgressElement>("progress").value = frame.elapsedSec;
    }
    this.#animation = requestAnimationFrame(this.#tick);
  };

  #finish(): void {
    this.#stopSound();
    this.#finishedAt = new Date().toISOString();
    this.#setState("finished");
    this.#guide.draw({ x: 0, y: 37 });
    this.#guide.beat(-1, 8);
    setText(this.#get("section"), "曲はここまで");
    setText(this.#get("instruction"), "腕を下ろして ひと休み");
    setText(this.#get("detail"), "動きやすさや、腕の疲れを振り返ってみよう。");
    setText(this.#get("next"), "もう一度、同じ曲で試せます");
    setText(this.#get("remaining"), "0");
    this.#get<HTMLProgressElement>("progress").value = PRACTICE_DURATION_SEC;
    setText(this.#get("status"), "30秒の練習が終わりました。採点はありません。");
  }

  #interrupt(message: string): void {
    if (this.#disposed) return;
    ++this.#run;
    this.#stopSound();
    this.#setState("interrupted");
    this.#guide.draw({ x: 0, y: 0 });
    this.#guide.beat(-1, 8);
    setText(this.#get("section"), "いつでも 試し直せます");
    setText(this.#get("instruction"), "両手を 楽な高さに");
    setText(this.#get("detail"), "小さな動きで大丈夫。画面と同じ向きに動きます。");
    setText(this.#get("next"), "両手を 右上へ");
    setText(this.#get("status"), message);
  }

  #stopSound(): void {
    cancelAnimationFrame(this.#animation);
    this.#source?.stop();
    this.#source?.disconnect();
    this.#source = null;
    this.#gain?.disconnect();
    this.#gain = null;
    void this.#wakeLock.release();
  }

  #setState(state: PracticeState): void {
    this.#state = state;
    required<HTMLElement>(this.#root, "[data-practice-state]").dataset.practiceState = state;
    const active = this.#isActive();
    this.#get("intro").hidden = active || state === "finished";
    this.#get("session").hidden = !active;
    this.#get("complete").hidden = state !== "finished";
    this.#get("feedback").hidden = state !== "finished";
    this.#get("countdown").hidden = state !== "countdown";
    this.#get("stop").hidden = !active;
    const start = this.#get<HTMLButtonElement>("start");
    start.hidden = active;
    start.textContent = state === "finished" ? "もう一度 動いてみる →" : "音を出して はじめる →";
  }

  #isActive(): boolean {
    return this.#state === "loading" || this.#state === "countdown" || this.#state === "playing";
  }

  readonly #changeVolume = (): void => {
    const value = Number(this.#get<HTMLInputElement>("volume").value);
    setText(this.#get("volume-value"), `${value}%`);
    if (this.#gain !== null) this.#gain.gain.setTargetAtTime(value / 100, this.#clock.context!.currentTime, 0.025);
  };

  readonly #visibilityChange = (): void => {
    if (document.visibilityState === "hidden" && this.#isActive()) {
      this.#interrupt("画面を離れたため止めました。もう一度、最初から試せます。");
    }
  };

  readonly #audioStateChange = (): void => {
    if ((this.#state === "countdown" || this.#state === "playing") && this.#clock.context?.state !== "running") {
      this.#interrupt("音が止まったため中断しました。もう一度、最初から試せます。");
    }
  };

  readonly #saveFeedback = (event: SubmitEvent): void => {
    event.preventDefault();
    if (this.#finishedAt === null || this.#state !== "finished") return;
    const form = new FormData(this.#get<HTMLFormElement>("feedback"));
    const feedback = {
      schema: "oto-practice-feedback-v1",
      appBuildId: APP_BUILD_ID,
      finishedAt: this.#finishedAt,
      durationSec: PRACTICE_DURATION_SEC,
      bpm: PRACTICE_BPM,
      cameraUsed: false,
      ease: form.get("ease"),
      fatigue: form.get("fatigue"),
      replay: form.get("replay"),
      comment: form.get("comment"),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(feedback, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `oto-practice-${this.#finishedAt.replace(/[:.]/g, "-")}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setText(this.#get("save-status"), "感想のファイルを保存しました。");
  };

  readonly #dispose = (event: PageTransitionEvent): void => {
    // A page restored by Back keeps its DOM and listeners; let it start a fresh audio context.
    if (event.persisted) {
      if (this.#isActive()) this.#interrupt("画面を離れたため止めました。もう一度、最初から試せます。");
      this.#clock.context?.removeEventListener("statechange", this.#audioStateChange);
      void this.#clock.close();
      return;
    }
    if (this.#disposed) return;
    this.#disposed = true;
    ++this.#run;
    this.#stopSound();
    this.#wakeLock.dispose();
    this.#clock.context?.removeEventListener("statechange", this.#audioStateChange);
    void this.#clock.close();
    document.removeEventListener("visibilitychange", this.#visibilityChange);
    window.removeEventListener("pagehide", this.#dispose);
  };

  #get<T extends HTMLElement>(name: string): T {
    return required<T>(this.#root, `#practice-${name}`);
  }
}
