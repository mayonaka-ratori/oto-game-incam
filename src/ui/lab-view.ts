import { CAMERA_CONSTRAINTS, type CameraSession } from "../camera/camera-controller";
import type { CameraSupportSnapshot } from "../camera/camera-support";
import type { LabState } from "../app/lab-state";
import type { FrameMetricsSnapshot } from "../metrics/frame-metrics";
import type { TrackingMetricsSnapshot } from "../metrics/tracking-metrics";
import type { OverlayLayers } from "../rendering/overlay-renderer";

export interface LabViewCallbacks {
  readonly onStart: () => void;
  readonly onStop: () => void;
  readonly onTogglePreview: () => void;
  readonly onOverlayLayersChange: (layers: OverlayLayers) => void;
}

export interface LabViewModel {
  readonly state: LabState;
  readonly support: CameraSupportSnapshot;
  readonly session: CameraSession | null;
  readonly metrics: FrameMetricsSnapshot | null;
  readonly previewVisible: boolean;
  readonly tracking: TrackingMetricsSnapshot | null;
}

export class LabView {
  readonly video: HTMLVideoElement;
  readonly overlay: HTMLCanvasElement;
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
  readonly #trackingState: HTMLElement;
  readonly #overlayInputs: readonly HTMLInputElement[];

  constructor(root: HTMLElement, callbacks: LabViewCallbacks) {
    this.#root = root;
    root.innerHTML = template;

    this.video = requiredElement(root, "#camera-preview", HTMLVideoElement);
    this.overlay = requiredElement(root, "#tracking-overlay", HTMLCanvasElement);
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
    this.#trackingState = requiredElement(root, "#tracking-state", HTMLElement);
    this.#overlayInputs = [...root.querySelectorAll<HTMLInputElement>("[data-overlay-layer]")];

    this.#startButton.addEventListener("click", callbacks.onStart);
    this.#stopButton.addEventListener("click", callbacks.onStop);
    this.#previewButton.addEventListener("click", callbacks.onTogglePreview);
    for (const input of this.#overlayInputs) {
      input.addEventListener("change", () => callbacks.onOverlayLayersChange(readOverlayLayers(this.#overlayInputs)));
    }
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
    // Keep the active video renderable so requestVideoFrameCallback continues
    // even when the raw preview is covered by the placeholder.
    this.video.hidden = !active;
    this.overlay.hidden = !active;
    this.#cameraPlaceholder.hidden = active && model.previewVisible;
    this.#cameraPlaceholder.textContent = active
      ? "プレビューは非表示です。計測は継続しています。"
      : "カメラ開始後、ここにインカメ映像を表示します。";

    this.#orientationNotice.hidden = !isPortraitViewport();
    renderTrackingState(this.#trackingState, model.tracking, active);

    renderRequestedSettings(this.#root);
    renderActualSettings(this.#root, model.session);
    renderEnvironment(this.#root, model.support, model.metrics);
    renderSupport(this.#root, model.support);
    renderMetrics(this.#root, model.metrics);
    renderTrackingMetrics(this.#root, model.tracking);
  }
}

function readOverlayLayers(inputs: readonly HTMLInputElement[]): OverlayLayers {
  const enabled = (name: string) => inputs.find((input) => input.dataset.overlayLayer === name)?.checked === true;
  return {
    landmarks: enabled("landmarks"),
    connections: enabled("connections"),
    cursor: enabled("cursor"),
    labels: enabled("labels"),
  };
}

function renderTrackingState(
  element: HTMLElement,
  tracking: TrackingMetricsSnapshot | null,
  active: boolean,
): void {
  const state = active
    ? tracking?.initializationStatus === "error"
      ? "error"
      : (tracking?.state ?? "framing")
    : "framing";
  const copy = {
    framing: "TRACKING · 準備中 / 手を枠内へ",
    ready: "TRACKING · 両手を検出",
    "one-hand-lost": "TRACKING LOSS · 片手のみ検出（MISSではありません）",
    "both-hands-lost": "TRACKING LOSS · 両手を検出できません（MISSではありません）",
    "performance-low": "PERFORMANCE LOW · 追跡出力を確認",
    error: "TRACKING ERROR · Worker diagnosticsを確認",
  }[state];
  element.textContent = copy;
  element.dataset.state = state;
  element.hidden = !active;
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

function renderTrackingMetrics(root: HTMLElement, tracking: TrackingMetricsSnapshot | null): void {
  const scheduler = tracking?.scheduler;
  setText(root, "metric-tracking-hz", formatValue(tracking?.outputHz, 1));
  setText(root, "metric-inference-p50", formatValue(tracking?.inferenceP50, 1, " ms"));
  setText(root, "metric-inference-p95", formatValue(tracking?.inferenceP95, 1, " ms"));
  setText(root, "metric-frame-age-p95", formatValue(tracking?.frameAgeP95, 1, " ms"));
  setText(root, "tracking-init", tracking?.initializationStatus ?? "—");
  setText(root, "tracking-init-time", formatValue(tracking?.initializationTimeMs, 1, " ms"));
  setText(root, "tracking-delegate", tracking?.provider?.delegate ?? "—");
  setText(root, "tracking-fallback", tracking?.provider?.fallbackReason ?? "—");
  setText(root, "tracking-source", tracking?.frameSource ?? "—");
  setText(root, "tracking-inflight", scheduler?.inFlight.toString() ?? "—");
  setText(root, "tracking-pending", scheduler?.pending.toString() ?? "—");
  setText(root, "tracking-counts", scheduler === undefined ? "—" : `${scheduler.captured} / ${scheduler.sent} / ${scheduler.completed}`);
  setText(root, "tracking-replaced", scheduler?.replaced.toString() ?? "—");
  setText(root, "tracking-errored", scheduler?.errored.toString() ?? "—");
  setText(root, "tracking-callback-worker", formatValue(tracking?.callbackToWorkerP50, 1, " ms"));
  setText(root, "tracking-worker-wait", formatValue(tracking?.workerWaitP50, 1, " ms"));
  setText(root, "tracking-inference-max", formatValue(tracking?.inferenceMax, 1, " ms"));
  setText(root, "tracking-frame-age-p50", formatValue(tracking?.frameAgeP50, 1, " ms"));
  setText(root, "tracking-hands", tracking?.handCount?.toString() ?? "—");
  setText(root, "tracking-first-acquisition", formatValue(tracking?.firstAcquisitionMs, 0, " ms"));
  setText(root, "tracking-one-coverage", formatPercent(tracking?.oneHandCoverage));
  setText(root, "tracking-two-coverage", formatPercent(tracking?.twoHandCoverage));
  setText(root, "tracking-left-missing", formatValue(tracking?.leftMissingMs, 0, " ms"));
  setText(root, "tracking-right-missing", formatValue(tracking?.rightMissingMs, 0, " ms"));
  const hands = tracking?.latestFrame?.hands ?? [];
  setText(root, "tracking-handedness", hands.length === 0 ? "—" : hands.map((hand) => `${hand.handedness} ${hand.handednessScore.toFixed(2)}`).join(" · "));
  setText(root, "tracking-error", tracking?.fatalError ?? "—");
}

function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${(value * 100).toFixed(1)}%`;
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
          <canvas id="tracking-overlay" class="tracking-overlay" aria-label="二手ランドマーク表示" hidden></canvas>
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
          <span id="tracking-state" class="tracking-state" data-state="framing" role="status" hidden></span>
        </div>

        <fieldset class="overlay-controls">
          <legend>Developer overlay</legend>
          <label><input type="checkbox" data-overlay-layer="landmarks" checked> 21 points</label>
          <label><input type="checkbox" data-overlay-layer="connections" checked> connections</label>
          <label><input type="checkbox" data-overlay-layer="cursor" checked> cursor</label>
          <label><input type="checkbox" data-overlay-layer="labels" checked> L / R labels</label>
        </fieldset>

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
          <article class="metric-card metric-card--primary"><span>TRACKING HZ</span><strong id="metric-tracking-hz">—</strong></article>
          <article class="metric-card"><span>INFERENCE p50</span><strong id="metric-inference-p50">—</strong></article>
          <article class="metric-card"><span>INFERENCE p95</span><strong id="metric-inference-p95">—</strong></article>
          <article class="metric-card"><span>FRAME AGE p95</span><strong id="metric-frame-age-p95">—</strong></article>
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
            <summary>Tracking Worker</summary>
            <dl class="data-list">
              <div><dt>Initialization</dt><dd id="tracking-init">—</dd></div>
              <div><dt>Init time</dt><dd id="tracking-init-time">—</dd></div>
              <div><dt>Delegate</dt><dd id="tracking-delegate">—</dd></div>
              <div><dt>Fallback reason</dt><dd id="tracking-fallback">—</dd></div>
              <div><dt>Frame source</dt><dd id="tracking-source">—</dd></div>
              <div><dt>In-flight / pending</dt><dd><span id="tracking-inflight">—</span> / <span id="tracking-pending">—</span></dd></div>
              <div><dt>Captured / sent / completed</dt><dd id="tracking-counts">—</dd></div>
              <div><dt>Replaced</dt><dd id="tracking-replaced">—</dd></div>
              <div><dt>Errored</dt><dd id="tracking-errored">—</dd></div>
              <div><dt>Callback → Worker p50</dt><dd id="tracking-callback-worker">—</dd></div>
              <div><dt>Worker wait p50</dt><dd id="tracking-worker-wait">—</dd></div>
              <div><dt>Inference max</dt><dd id="tracking-inference-max">—</dd></div>
              <div><dt>Frame age p50</dt><dd id="tracking-frame-age-p50">—</dd></div>
              <div><dt>Fatal error</dt><dd id="tracking-error">—</dd></div>
            </dl>
          </details>

          <details>
            <summary>Hand tracking</summary>
            <dl class="data-list">
              <div><dt>Hands</dt><dd id="tracking-hands">—</dd></div>
              <div><dt>First acquisition</dt><dd id="tracking-first-acquisition">—</dd></div>
              <div><dt>≥1 hand coverage</dt><dd id="tracking-one-coverage">—</dd></div>
              <div><dt>2 hand coverage</dt><dd id="tracking-two-coverage">—</dd></div>
              <div><dt>Left missing</dt><dd id="tracking-left-missing">—</dd></div>
              <div><dt>Right missing</dt><dd id="tracking-right-missing">—</dd></div>
              <div><dt>Handedness</dt><dd id="tracking-handedness">—</dd></div>
            </dl>
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

        <p class="scope-note">生映像は保存・送信しません。detectionIndexはフレーム内番号で、安定した手IDではありません。gesture eventTimeは次工程です。</p>
      </section>
    </main>
  </div>
`;
