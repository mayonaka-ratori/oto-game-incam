import "./speed-check.css";

export interface SpeedCheckViewCallbacks {
  readonly onStart: () => void;
  readonly onStop: () => void;
  readonly onSave: () => void;
}

export type SpeedCheckPhase = "intro" | "running" | "finished";

export interface SpeedCheckRunningModel {
  /** 1-based. Shown as "3 / 7 を計測中". */
  readonly stepNumber: number;
  readonly stepCount: number;
  readonly remainingSeconds: number;
  readonly handCount: number | null;
}

export interface SpeedCheckFinishedModel {
  readonly title: string;
  /** Non-null when the run stopped early; shown in red above the save button. */
  readonly abortReason: string | null;
  readonly fastestLine: string;
}

/**
 * The whole screen a tester sees at `?mode=speedcheck`: one explanation, one start button, the
 * camera image while it measures, and one save button at the end. No numbers to read, nothing to
 * type. The controller owns every decision; this class only writes text and toggles sections.
 */
export class SpeedCheckView {
  readonly video: HTMLVideoElement;
  readonly #intro: HTMLElement;
  readonly #running: HTMLElement;
  readonly #finished: HTMLElement;
  readonly #startButton: HTMLButtonElement;
  readonly #stopButton: HTMLButtonElement;
  readonly #saveButton: HTMLButtonElement;
  readonly #hands: HTMLElement;
  readonly #progress: HTMLElement;
  readonly #remaining: HTMLElement;
  readonly #finishedTitle: HTMLElement;
  readonly #abortReason: HTMLElement;
  readonly #fastest: HTMLElement;
  readonly #saveStatus: HTMLElement;
  readonly #preview: HTMLElement;
  readonly #introError: HTMLElement;
  #videoAspect = "";

  constructor(root: HTMLElement, callbacks: SpeedCheckViewCallbacks) {
    root.innerHTML = TEMPLATE;
    this.video = requiredElement(root, "#speed-video", HTMLVideoElement);
    this.#intro = requiredElement(root, "#speed-intro", HTMLElement);
    this.#running = requiredElement(root, "#speed-running", HTMLElement);
    this.#finished = requiredElement(root, "#speed-finished", HTMLElement);
    this.#startButton = requiredElement(root, "#speed-start", HTMLButtonElement);
    this.#stopButton = requiredElement(root, "#speed-stop", HTMLButtonElement);
    this.#saveButton = requiredElement(root, "#speed-save", HTMLButtonElement);
    this.#hands = requiredElement(root, "#speed-hands", HTMLElement);
    this.#progress = requiredElement(root, "#speed-progress", HTMLElement);
    this.#remaining = requiredElement(root, "#speed-remaining", HTMLElement);
    this.#finishedTitle = requiredElement(root, "#speed-finished-title", HTMLElement);
    this.#abortReason = requiredElement(root, "#speed-abort-reason", HTMLElement);
    this.#fastest = requiredElement(root, "#speed-fastest", HTMLElement);
    this.#saveStatus = requiredElement(root, "#speed-save-status", HTMLElement);
    this.#preview = requiredElement(root, "#speed-preview", HTMLElement);
    this.#introError = requiredElement(root, "#speed-intro-error", HTMLElement);

    this.#startButton.addEventListener("click", callbacks.onStart);
    this.#stopButton.addEventListener("click", callbacks.onStop);
    this.#saveButton.addEventListener("click", callbacks.onSave);
  }

  showPhase(phase: SpeedCheckPhase): void {
    this.#intro.hidden = phase !== "intro";
    this.#running.hidden = phase !== "running";
    this.#finished.hidden = phase !== "finished";
  }

  /** The start button is disabled while the camera is being asked for, so one tap means one run. */
  setStartEnabled(enabled: boolean): void {
    this.#startButton.disabled = !enabled;
  }

  setIntroError(message: string): void {
    setText(this.#introError, message);
    this.#introError.hidden = message.length === 0;
  }

  renderRunning(model: SpeedCheckRunningModel): void {
    setText(this.#progress, `${model.stepNumber} / ${model.stepCount} を計測中`);
    setText(this.#remaining, `残りおよそ ${Math.max(0, Math.ceil(model.remainingSeconds))} 秒です`);
    const twoHands = model.handCount !== null && model.handCount >= 2;
    setText(this.#hands, twoHands ? "両手が映っています" : "両手を映してください");
    if (this.#hands.dataset.hands !== (twoHands ? "two" : "few")) {
      this.#hands.dataset.hands = twoHands ? "two" : "few";
    }
    this.#syncVideoAspect();
  }

  renderFinished(model: SpeedCheckFinishedModel): void {
    setText(this.#finishedTitle, model.title);
    setText(this.#abortReason, model.abortReason ?? "");
    this.#abortReason.hidden = model.abortReason === null;
    setText(this.#fastest, model.fastestLine);
  }

  setSaveStatus(message: string): void {
    setText(this.#saveStatus, message);
    this.#saveStatus.hidden = message.length === 0;
  }

  /** The frame follows the camera image, so the picture is never cropped or stretched. */
  #syncVideoAspect(): void {
    const { videoWidth, videoHeight } = this.video;
    if (videoWidth <= 0 || videoHeight <= 0) return;
    const aspect = `${videoWidth} / ${videoHeight}`;
    if (aspect === this.#videoAspect) return;
    this.#videoAspect = aspect;
    this.#preview.style.setProperty("--speed-video-aspect", aspect);
  }
}

function setText(element: HTMLElement, value: string): void {
  if (element.textContent !== value) element.textContent = value;
}

function requiredElement<T extends Element>(
  root: ParentNode,
  selector: string,
  constructor: { new (): T },
): T {
  const element = root.querySelector(selector);
  if (!(element instanceof constructor)) {
    throw new Error(`Required element not found: ${selector}`);
  }
  return element;
}

const TEMPLATE = `
<main class="speed-shell">
  <section class="speed-section" id="speed-intro">
    <h1 class="speed-title">端末の速さを自動で測ります</h1>
    <div class="speed-card">
      <p class="speed-lead">
        端末の処理の速さを、設定を変えながら自動で測ります。約2分かかります。はじめるを押したら、両手をカメラに映したままお待ちください。映像は保存・送信しません。
      </p>
    </div>
    <p class="speed-note">
      途中で画面をほかのアプリへ切り替えると、計測は止まります。明るい場所で、両手が画面に入るように端末を置いてください。
    </p>
    <p class="speed-warning" id="speed-intro-error" hidden></p>
    <div class="speed-spacer"></div>
    <div class="speed-actions">
      <button class="speed-button" id="speed-start" type="button">はじめる</button>
    </div>
  </section>

  <section class="speed-section" id="speed-running" hidden>
    <div class="speed-preview" id="speed-preview">
      <video id="speed-video" playsinline muted></video>
    </div>
    <div class="speed-status">
      <p class="speed-hands" id="speed-hands" data-hands="few">両手を映してください</p>
      <p class="speed-progress" id="speed-progress">1 / 7 を計測中</p>
      <p class="speed-remaining" id="speed-remaining">残りおよそ 120 秒です</p>
    </div>
    <p class="speed-note">両手をカメラに映したまま、そのままお待ちください。</p>
    <div class="speed-spacer"></div>
    <div class="speed-actions">
      <button class="speed-button speed-button--quiet" id="speed-stop" type="button">やめる</button>
    </div>
  </section>

  <section class="speed-section" id="speed-finished" hidden>
    <h1 class="speed-title" id="speed-finished-title">計測が終わりました</h1>
    <p class="speed-warning" id="speed-abort-reason" hidden></p>
    <div class="speed-card">
      <p class="speed-fastest" id="speed-fastest">いちばん速かった設定: 測れませんでした</p>
      <p class="speed-note" id="speed-save-status" hidden></p>
    </div>
    <p class="speed-note">結果は数値だけのファイルです。映像も音声も入っていません。</p>
    <div class="speed-spacer"></div>
    <div class="speed-actions">
      <button class="speed-button" id="speed-save" type="button">結果を保存</button>
    </div>
  </section>
</main>
`;
