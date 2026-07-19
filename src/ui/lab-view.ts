import { CAMERA_CONSTRAINTS, type CameraSession } from "../camera/camera-controller";
import type { CameraSupportSnapshot } from "../camera/camera-support";
import type { LabState } from "../app/lab-state";
import type { FrameMetricsSnapshot } from "../metrics/frame-metrics";

export interface LabViewCallbacks {
  readonly onStart: () => void;
  readonly onStop: () => void;
  readonly onTogglePreview: () => void;
}

export interface LabViewModel {
  readonly state: LabState;
  readonly support: CameraSupportSnapshot;
  readonly session: CameraSession | null;
  readonly metrics: FrameMetricsSnapshot | null;
  readonly previewVisible: boolean;
}

export class LabView {
  readonly video: HTMLVideoElement;
  readonly #root: HTMLElement;
  readonly #startButton: HTMLButtonElement;
  readonly #stopButton: HTMLButtonElement;
  readonly #previewButton: HTMLButtonElement;
  readonly #stateCard: HTMLElement;
  readonly #stateBadge: HTMLElement;
  readonly #stateTitle: HTMLElement;
  readonly #stateMessage: HTMLElement;
  readonly #technicalDetail: HTMLElement;
  readonly #previewShell: HTMLElement;
  readonly #cameraPlaceholder: HTMLElement;
  readonly #orientationNotice: HTMLElement;

  constructor(root: HTMLElement, callbacks: LabViewCallbacks) {
    this.#root = root;
    root.innerHTML = template;

    this.video = requiredElement(root, "#camera-preview", HTMLVideoElement);
    this.#startButton = requiredElement(root, "#start-camera", HTMLButtonElement);
    this.#stopButton = requiredElement(root, "#stop-camera", HTMLButtonElement);
    this.#previewButton = requiredElement(root, "#toggle-preview", HTMLButtonElement);
    this.#stateCard = requiredElement(root, "#state-card", HTMLElement);
    this.#stateBadge = requiredElement(root, "#state-badge", HTMLElement);
    this.#stateTitle = requiredElement(root, "#state-title", HTMLElement);
    this.#stateMessage = requiredElement(root, "#state-message", HTMLElement);
    this.#technicalDetail = requiredElement(root, "#technical-detail", HTMLElement);
    this.#previewShell = requiredElement(root, "#preview-shell", HTMLElement);
    this.#cameraPlaceholder = requiredElement(root, "#camera-placeholder", HTMLElement);
    this.#orientationNotice = requiredElement(root, "#orientation-notice", HTMLElement);

    this.#startButton.addEventListener("click", callbacks.onStart);
    this.#stopButton.addEventListener("click", callbacks.onStop);
    this.#previewButton.addEventListener("click", callbacks.onTogglePreview);
  }

  render(model: LabViewModel): void {
    const active = model.state.kind === "active";
    const requesting = model.state.kind === "requesting";
    const blocked = model.state.kind === "unsupported";

    this.#stateCard.dataset.state = model.state.kind;
    this.#stateBadge.textContent = stateLabel(model.state.kind);
    this.#stateTitle.textContent = model.state.title;
    this.#stateMessage.textContent = model.state.message;
    this.#technicalDetail.textContent = model.state.technicalDetail;
    this.#technicalDetail.hidden = model.state.technicalDetail.length === 0;

    this.#startButton.hidden = active;
    this.#startButton.disabled = blocked || requesting || model.state.kind === "checking";
    this.#startButton.textContent = requesting ? "許可を待っています…" : startButtonLabel(model.state.kind);
    this.#stopButton.hidden = !active;
    this.#previewButton.hidden = !active;
    this.#previewButton.setAttribute("aria-pressed", String(model.previewVisible));
    this.#previewButton.textContent = model.previewVisible ? "プレビューを隠す" : "プレビューを表示";

    this.#previewShell.dataset.active = String(active);
    this.#previewShell.dataset.previewVisible = String(model.previewVisible);
    this.video.hidden = !active || !model.previewVisible;
    this.#cameraPlaceholder.hidden = active && model.previewVisible;
    this.#cameraPlaceholder.textContent = active
      ? "プレビューは非表示です。計測は継続しています。"
      : "カメラ開始後、ここにインカメ映像を表示します。";

    this.#orientationNotice.hidden = !isPortraitViewport();

    renderRequestedSettings(this.#root);
    renderActualSettings(this.#root, model.session);
    renderEnvironment(this.#root, model.support, model.metrics);
    renderSupport(this.#root, model.support);
    renderMetrics(this.#root, model.metrics);
  }
}

function renderRequestedSettings(root: HTMLElement): void {
  const video = CAMERA_CONSTRAINTS.video;
  setText(root, "requested-facing", constraintValue(video.facingMode));
  setText(root, "requested-size", `${constraintValue(video.width)} × ${constraintValue(video.height)}`);
  setText(root, "requested-fps", `${video.frameRate.min}–${video.frameRate.ideal} fps`);
  setText(root, "requested-audio", "off");
}

function renderActualSettings(root: HTMLElement, session: CameraSession | null): void {
  const settings = session?.track.getSettings() ?? null;
  setText(root, "actual-facing", settings?.facingMode ?? "—");
  setText(
    root,
    "actual-size",
    settings?.width !== undefined && settings.height !== undefined
      ? `${settings.width} × ${settings.height}`
      : "—",
  );
  setText(root, "actual-fps", formatValue(settings?.frameRate, 1, " fps"));
  setText(root, "actual-label", session?.track.label || "—");
  setText(root, "track-state", session?.track.readyState ?? "—");
  setText(root, "track-muted", session === null ? "—" : session.track.muted ? "yes" : "no");
}

function renderEnvironment(
  root: HTMLElement,
  support: CameraSupportSnapshot,
  metrics: FrameMetricsSnapshot | null,
): void {
  const orientation = screen.orientation?.type ?? (isPortraitViewport() ? "portrait" : "landscape");
  setText(root, "environment-secure", support.secureContext ? "yes" : "no");
  setText(root, "environment-visibility", metrics?.pageVisible === false ? "hidden" : document.visibilityState);
  setText(root, "environment-orientation", orientation);
  setText(root, "environment-viewport", `${window.innerWidth} × ${window.innerHeight}`);
  setText(root, "environment-dpr", window.devicePixelRatio.toFixed(2));
  setText(root, "environment-frame-source", metrics?.source ?? "—");
}

function renderSupport(root: HTMLElement, support: CameraSupportSnapshot): void {
  const entries: ReadonlyArray<readonly [string, boolean]> = [
    ["support-media", support.getUserMedia],
    ["support-rvfc", support.requestVideoFrameCallback],
    ["support-processor", support.mediaStreamTrackProcessor],
    ["support-video-frame", support.videoFrame],
    ["support-image-bitmap", support.imageBitmap],
  ];

  for (const [id, available] of entries) {
    const element = requiredElement(root, `#${id}`, HTMLElement);
    element.textContent = available ? "available" : "unavailable";
    element.dataset.available = String(available);
  }
}

function renderMetrics(root: HTMLElement, metrics: FrameMetricsSnapshot | null): void {
  setText(root, "metric-camera-fps", formatValue(metrics?.cameraFps, 1));
  setText(root, "metric-frame-p50", formatValue(metrics?.frameIntervalP50, 1, " ms"));
  setText(root, "metric-frame-p95", formatValue(metrics?.frameIntervalP95, 1, " ms"));
  setText(root, "metric-display-fps", formatValue(metrics?.displayFps, 1));
  setText(root, "metric-frame-count", metrics?.cameraFrames.toLocaleString("ja-JP") ?? "—");
  setText(root, "metric-elapsed", formatDuration(metrics?.elapsedMs));
}

function stateLabel(kind: LabState["kind"]): string {
  switch (kind) {
    case "active":
      return "MEASURING";
    case "requesting":
      return "WAITING";
    case "unsupported":
      return "UNSUPPORTED";
    case "permission-denied":
    case "no-device":
    case "interrupted":
    case "error":
      return "ATTENTION";
    case "checking":
      return "CHECKING";
    case "permission-required":
      return "READY";
  }
}

function startButtonLabel(kind: LabState["kind"]): string {
  return kind === "permission-required" ? "カメラを開始" : "もう一度試す";
}

function formatValue(
  value: number | null | undefined,
  fractionDigits: number,
  suffix = "",
): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : `${value.toFixed(fractionDigits)}${suffix}`;
}

function formatDuration(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "—";
  }
  const seconds = Math.floor(value / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function constraintValue(value: ConstrainULong | ConstrainDOMString): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  if ("exact" in value && value.exact !== undefined) {
    return String(value.exact);
  }
  if ("ideal" in value && value.ideal !== undefined) {
    return String(value.ideal);
  }
  return "—";
}

function setText(root: HTMLElement, id: string, value: string): void {
  requiredElement(root, `#${id}`, HTMLElement).textContent = value;
}

function isPortraitViewport(): boolean {
  return window.innerHeight > window.innerWidth;
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

const template = `
  <div class="app-shell">
    <header class="topbar">
      <div class="brand-block">
        <span class="brand-mark" aria-hidden="true">O</span>
        <div>
          <p class="eyebrow">PHASE 1 · STEP 1.1</p>
          <h1>Camera Diagnostics</h1>
        </div>
      </div>
      <div class="privacy-note"><span aria-hidden="true">◆</span> 映像・音声は保存しません</div>
    </header>

    <main class="lab-layout">
      <section class="camera-panel" aria-labelledby="camera-heading">
        <div class="section-heading">
          <div>
            <p class="section-index">01 / INPUT</p>
            <h2 id="camera-heading">Front camera</h2>
          </div>
          <span class="live-indicator"><span aria-hidden="true"></span> LOCAL ONLY</span>
        </div>

        <div id="orientation-notice" class="orientation-notice" role="status" hidden>
          端末を横向きにして、スタンドへ置いてください。計測は続けられます。
        </div>

        <div id="preview-shell" class="preview-shell" data-active="false" data-preview-visible="true">
          <video id="camera-preview" aria-label="インカメの開発用プレビュー" autoplay muted playsinline hidden></video>
          <div id="camera-placeholder" class="camera-placeholder">
            カメラ開始後、ここにインカメ映像を表示します。
          </div>
          <div class="frame-guide" aria-hidden="true">
            <span class="guide-corner guide-corner--tl"></span>
            <span class="guide-corner guide-corner--tr"></span>
            <span class="guide-corner guide-corner--bl"></span>
            <span class="guide-corner guide-corner--br"></span>
            <span class="guide-center"></span>
          </div>
          <span class="preview-label">DEV PREVIEW · MIRRORED</span>
        </div>

        <div id="state-card" class="state-card" data-state="checking" aria-live="polite">
          <div class="state-copy">
            <span id="state-badge" class="state-badge">CHECKING</span>
            <h3 id="state-title">対応環境を確認しています</h3>
            <p id="state-message">カメラAPIと接続状態を確認しています。</p>
            <code id="technical-detail" class="technical-detail" hidden></code>
          </div>
          <div class="action-row">
            <button id="start-camera" class="button button--primary" type="button" disabled>カメラを開始</button>
            <button id="stop-camera" class="button button--danger" type="button" hidden>カメラを停止</button>
            <button id="toggle-preview" class="button button--quiet" type="button" aria-pressed="true" hidden>プレビューを隠す</button>
          </div>
        </div>
      </section>

      <section class="diagnostics-panel" aria-labelledby="diagnostics-heading">
        <div class="section-heading">
          <div>
            <p class="section-index">02 / TELEMETRY</p>
            <h2 id="diagnostics-heading">Live diagnostics</h2>
          </div>
          <span class="sample-window">rolling window</span>
        </div>

        <div class="metric-grid" aria-label="フレーム計測値">
          <article class="metric-card metric-card--primary"><span>CAMERA FPS</span><strong id="metric-camera-fps">—</strong></article>
          <article class="metric-card"><span>FRAME p50</span><strong id="metric-frame-p50">—</strong></article>
          <article class="metric-card"><span>FRAME p95</span><strong id="metric-frame-p95">—</strong></article>
          <article class="metric-card"><span>DISPLAY FPS</span><strong id="metric-display-fps">—</strong></article>
          <article class="metric-card"><span>FRAMES</span><strong id="metric-frame-count">—</strong></article>
          <article class="metric-card"><span>ELAPSED</span><strong id="metric-elapsed">—</strong></article>
        </div>

        <div class="data-sections">
          <details open>
            <summary>Camera settings</summary>
            <div class="settings-columns">
              <div>
                <h3>REQUESTED</h3>
                <dl class="data-list">
                  <div><dt>Facing</dt><dd id="requested-facing">—</dd></div>
                  <div><dt>Resolution</dt><dd id="requested-size">—</dd></div>
                  <div><dt>Frame rate</dt><dd id="requested-fps">—</dd></div>
                  <div><dt>Audio</dt><dd id="requested-audio">—</dd></div>
                </dl>
              </div>
              <div>
                <h3>ACTUAL</h3>
                <dl class="data-list">
                  <div><dt>Facing</dt><dd id="actual-facing">—</dd></div>
                  <div><dt>Resolution</dt><dd id="actual-size">—</dd></div>
                  <div><dt>Frame rate</dt><dd id="actual-fps">—</dd></div>
                  <div><dt>Device</dt><dd id="actual-label">—</dd></div>
                  <div><dt>Track</dt><dd id="track-state">—</dd></div>
                  <div><dt>Muted</dt><dd id="track-muted">—</dd></div>
                </dl>
              </div>
            </div>
          </details>

          <details>
            <summary>Environment</summary>
            <dl class="data-list">
              <div><dt>Secure context</dt><dd id="environment-secure">—</dd></div>
              <div><dt>Page visibility</dt><dd id="environment-visibility">—</dd></div>
              <div><dt>Orientation</dt><dd id="environment-orientation">—</dd></div>
              <div><dt>Viewport</dt><dd id="environment-viewport">—</dd></div>
              <div><dt>Device pixel ratio</dt><dd id="environment-dpr">—</dd></div>
              <div><dt>Frame source</dt><dd id="environment-frame-source">—</dd></div>
            </dl>
          </details>

          <details>
            <summary>Next-stage API support</summary>
            <dl class="data-list support-list">
              <div><dt>getUserMedia</dt><dd id="support-media">—</dd></div>
              <div><dt>requestVideoFrameCallback</dt><dd id="support-rvfc">—</dd></div>
              <div><dt>MediaStreamTrackProcessor</dt><dd id="support-processor">—</dd></div>
              <div><dt>VideoFrame</dt><dd id="support-video-frame">—</dd></div>
              <div><dt>createImageBitmap</dt><dd id="support-image-bitmap">—</dd></div>
            </dl>
          </details>
        </div>

        <p class="scope-note">Tracking Worker、ランドマーク、gesture eventTimeは次ステップで追加します。</p>
      </section>
    </main>
  </div>
`;

