import type { CameraSession } from "../camera/camera-controller";
import type { CameraSupportSnapshot } from "../camera/camera-support";
import type { LabState } from "../app/lab-state";
import { APP_BUILD_ID } from "../app/app-build";
import {
  findTrackingExperimentProfile,
  TRACKING_EXPERIMENT_PROFILES,
  type TrackingExperimentProfile,
  type TrackingExperimentProfileId,
} from "../experiments/tracking-experiment-profile";
import type { FrameMetricsSnapshot } from "../metrics/frame-metrics";
import type { TrackingMetricsSnapshot } from "../metrics/tracking-metrics";
import type { OverlayLayers } from "../rendering/overlay-renderer";

export interface LabViewCallbacks {
  readonly onStart: () => void;
  readonly onStop: () => void;
  readonly onRequestLandscape: () => void;
  readonly onTogglePreview: () => void;
  readonly onOverlayLayersChange: (layers: OverlayLayers) => void;
  readonly onExperimentProfileChange: (id: TrackingExperimentProfileId) => void;
}

export interface LabViewModel {
  readonly state: LabState;
  readonly support: CameraSupportSnapshot;
  readonly session: CameraSession | null;
  readonly metrics: FrameMetricsSnapshot | null;
  readonly previewVisible: boolean;
  readonly tracking: TrackingMetricsSnapshot | null;
  readonly experimentProfile: TrackingExperimentProfile;
  readonly orientationMessage: string;
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
  readonly #orientationMessage: HTMLElement;
  readonly #orientationButton: HTMLButtonElement;
  readonly #trackingState: HTMLElement;
  readonly #experimentProfileSelect: HTMLSelectElement;
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
    this.#orientationMessage = requiredElement(root, "#orientation-message", HTMLElement);
    this.#orientationButton = requiredElement(root, "#request-landscape", HTMLButtonElement);
    this.#trackingState = requiredElement(root, "#tracking-state", HTMLElement);
    this.#experimentProfileSelect = requiredElement(root, "#experiment-profile", HTMLSelectElement);
    this.#overlayInputs = [...root.querySelectorAll<HTMLInputElement>("[data-overlay-layer]")];
    for (const profile of TRACKING_EXPERIMENT_PROFILES) {
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent = profile.label;
      this.#experimentProfileSelect.append(option);
    }

    this.#startButton.addEventListener("click", callbacks.onStart);
    this.#stopButton.addEventListener("click", callbacks.onStop);
    this.#orientationButton.addEventListener("click", callbacks.onRequestLandscape);
    this.#previewButton.addEventListener("click", callbacks.onTogglePreview);
    this.#experimentProfileSelect.addEventListener("change", () => {
      const profile = findTrackingExperimentProfile(this.#experimentProfileSelect.value);
      callbacks.onExperimentProfileChange(profile.id);
    });
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
    this.#experimentProfileSelect.value = model.experimentProfile.id;
    this.#experimentProfileSelect.disabled = active || requesting;
    setText(this.#root, "experiment-profile-purpose", model.experimentProfile.purpose);

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
    this.#orientationMessage.textContent = model.orientationMessage;
    renderTrackingState(this.#trackingState, model.tracking, active);

    renderRequestedSettings(this.#root, model.experimentProfile);
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
    framing: "手の追跡を準備中 · 両手を枠内へ入れてください",
    ready: "両手を追跡しています",
    "one-hand-lost": "片手だけを検出しています（プレイヤーの失敗ではありません）",
    "both-hands-lost": "両手を検出できません（プレイヤーの失敗ではありません）",
    "performance-low": "追跡性能が低下しています · 計測値を確認してください",
    error: "手の追跡でエラーが発生しました · 詳細情報を確認してください",
  }[state];
  element.textContent = copy;
  element.dataset.state = state;
  element.hidden = !active;
}

function renderRequestedSettings(
  root: HTMLElement,
  profile: TrackingExperimentProfile,
): void {
  setText(root, "requested-profile", profile.id);
  setText(root, "requested-build", APP_BUILD_ID);
  setText(root, "requested-facing", "インカメ");
  setText(root, "requested-size", `${profile.camera.width} × ${profile.camera.height}`);
  setText(root, "requested-fps", `${profile.camera.frameRateMin}–${profile.camera.frameRateIdeal} fps`);
  setText(root, "requested-delegate", profile.tracking.preferredDelegate);
  setText(root, "requested-model", profile.tracking.modelId);
  setText(root, "requested-audio", "使用しない");
}

function renderActualSettings(root: HTMLElement, session: CameraSession | null): void {
  const settings = session?.track.getSettings() ?? null;
  setText(root, "actual-facing", cameraFacingLabel(settings?.facingMode));
  setText(
    root,
    "actual-size",
    settings?.width !== undefined && settings.height !== undefined
      ? `${settings.width} × ${settings.height}`
      : "—",
  );
  setText(root, "actual-fps", formatValue(settings?.frameRate, 1, " fps"));
  setText(root, "actual-label", session?.track.label || "—");
  setText(root, "track-state", trackStateLabel(session?.track.readyState));
  setText(root, "track-muted", session === null ? "—" : session.track.muted ? "はい" : "いいえ");
}

function renderEnvironment(
  root: HTMLElement,
  support: CameraSupportSnapshot,
  metrics: FrameMetricsSnapshot | null,
): void {
  const orientation = screen.orientation?.type ?? (isPortraitViewport() ? "portrait" : "landscape");
  setText(root, "environment-secure", support.secureContext ? "有効" : "無効");
  setText(root, "environment-visibility", visibilityLabel(metrics?.pageVisible === false ? "hidden" : document.visibilityState));
  setText(root, "environment-orientation", orientationLabel(orientation));
  setText(root, "environment-viewport", `${window.innerWidth} × ${window.innerHeight}`);
  setText(root, "environment-dpr", window.devicePixelRatio.toFixed(2));
  setText(root, "environment-frame-source", frameSourceLabel(metrics?.source));
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
    element.textContent = available ? "利用可能" : "利用不可";
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
  setText(root, "tracking-init", initializationLabel(tracking?.initializationStatus));
  setText(root, "tracking-init-time", formatValue(tracking?.initializationTimeMs, 1, " ms"));
  setText(root, "tracking-delegate", tracking?.provider?.delegate ?? "—");
  setText(root, "tracking-fallback", tracking?.provider?.fallbackReason ?? "—");
  setText(root, "tracking-source", frameSourceLabel(tracking?.frameSource));
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
  setText(root, "tracking-handedness", hands.length === 0 ? "—" : hands.map((hand) => `${handednessLabel(hand.handedness)} ${hand.handednessScore.toFixed(2)}`).join(" · "));
  setText(root, "tracking-error", tracking?.fatalError ?? "—");
}

function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${(value * 100).toFixed(1)}%`;
}

function cameraFacingLabel(value: string | undefined): string {
  if (value === undefined) return "—";
  if (value === "user") return "インカメ";
  if (value === "environment") return "外向きカメラ";
  return value;
}

function trackStateLabel(value: MediaStreamTrackState | undefined): string {
  if (value === undefined) return "—";
  return value === "live" ? "動作中" : "終了";
}

function visibilityLabel(value: string): string {
  return { visible: "表示中", hidden: "非表示", prerender: "表示前" }[value] ?? value;
}

function orientationLabel(value: string): string {
  if (value.startsWith("portrait")) return "縦向き";
  if (value.startsWith("landscape")) return "横向き";
  return value;
}

function initializationLabel(value: string | undefined): string {
  if (value === undefined) return "—";
  return {
    idle: "未開始",
    initializing: "初期化中",
    ready: "準備完了",
    error: "エラー",
  }[value] ?? value;
}

function frameSourceLabel(value: string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return {
    requestVideoFrameCallback: "映像フレーム通知",
    "animationFrame-fallback": "画面描画に合わせる代替経路",
    MediaStreamTrackProcessor: "カメラフレーム処理",
    "timer-fallback": "タイマーによる代替経路",
  }[value] ?? value;
}

function handednessLabel(value: string): string {
  return { left: "左手", right: "右手", unknown: "左右不明" }[value] ?? value;
}

function stateLabel(kind: LabState["kind"]): string {
  switch (kind) {
    case "active":
      return "計測中";
    case "requesting":
      return "許可待ち";
    case "unsupported":
      return "利用不可";
    case "permission-denied":
    case "no-device":
    case "interrupted":
    case "error":
      return "要確認";
    case "checking":
      return "確認中";
    case "permission-required":
      return "準備完了";
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
          <p class="eyebrow">フェーズ1 · 技術計測ラボ</p>
          <h1>手の追跡・時刻・ジェスチャー検証</h1>
        </div>
      </div>
      <div class="privacy-note"><span aria-hidden="true">◆</span> 映像・音声は保存しません</div>
    </header>

    <main class="lab-layout">
      <section class="camera-panel" aria-labelledby="camera-heading">
        <div class="section-heading">
          <div>
            <p class="section-index">01 / カメラ入力</p>
            <h2 id="camera-heading">インカメ映像</h2>
          </div>
          <span class="live-indicator"><span aria-hidden="true"></span> この端末内のみ</span>
        </div>

        <div id="orientation-notice" class="orientation-notice" hidden>
          <span id="orientation-message" role="status">横向き表示に切り替えてから、端末をスタンドへ置いてください。</span>
          <button id="request-landscape" class="button button--quiet" type="button">横向き表示を試す</button>
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
          <span class="preview-label">検証用プレビュー · 鏡像表示</span>
          <span id="tracking-state" class="tracking-state" data-state="framing" role="status" hidden></span>
        </div>

        <fieldset class="overlay-controls">
          <legend>検証用の重ね表示</legend>
          <label><input type="checkbox" data-overlay-layer="landmarks" checked> 手の21点</label>
          <label><input type="checkbox" data-overlay-layer="connections" checked> 点を結ぶ線</label>
          <label><input type="checkbox" data-overlay-layer="cursor" checked> 手のカーソル</label>
          <label><input type="checkbox" data-overlay-layer="labels" checked> 左手／右手ラベル</label>
        </fieldset>

        <div id="state-card" class="state-card" data-state="checking" aria-live="polite">
          <div class="state-copy">
            <span id="state-badge" class="state-badge">確認中</span>
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

      <details class="diagnostics-panel" aria-labelledby="diagnostics-heading">
        <summary class="section-heading">
          <div>
            <p class="section-index">02 / 計測情報</p>
            <h2 id="diagnostics-heading">リアルタイム計測値</h2>
          </div>
          <span class="sample-window">必要なときだけ開く</span>
        </summary>

        <div class="metric-grid" aria-label="フレーム計測値">
          <article class="metric-card metric-card--primary"><span>カメラ FPS</span><strong id="metric-camera-fps">—</strong></article>
          <article class="metric-card"><span>フレーム間隔 p50</span><strong id="metric-frame-p50">—</strong></article>
          <article class="metric-card"><span>フレーム間隔 p95</span><strong id="metric-frame-p95">—</strong></article>
          <article class="metric-card"><span>画面描画 FPS</span><strong id="metric-display-fps">—</strong></article>
          <article class="metric-card"><span>取得フレーム数</span><strong id="metric-frame-count">—</strong></article>
          <article class="metric-card"><span>計測時間</span><strong id="metric-elapsed">—</strong></article>
          <article class="metric-card metric-card--primary"><span>追跡出力 Hz</span><strong id="metric-tracking-hz">—</strong></article>
          <article class="metric-card"><span>推論時間 p50</span><strong id="metric-inference-p50">—</strong></article>
          <article class="metric-card"><span>推論時間 p95</span><strong id="metric-inference-p95">—</strong></article>
          <article class="metric-card"><span>フレームの古さ p95</span><strong id="metric-frame-age-p95">—</strong></article>
        </div>

        <div class="data-sections">
          <details open>
            <summary>カメラ設定</summary>
            <label class="experiment-profile-control" for="experiment-profile">
              <span>実験プロファイル</span>
              <select id="experiment-profile" aria-describedby="experiment-profile-purpose"></select>
              <small id="experiment-profile-purpose">現行条件。最初のP1セッションはこの条件を使います。</small>
            </label>
            <div class="settings-columns">
              <div>
                <h3>要求した設定</h3>
                <dl class="data-list">
                  <div><dt>プロファイルID</dt><dd id="requested-profile">—</dd></div>
                  <div><dt>ビルドID</dt><dd id="requested-build">—</dd></div>
                  <div><dt>カメラの向き</dt><dd id="requested-facing">—</dd></div>
                  <div><dt>解像度</dt><dd id="requested-size">—</dd></div>
                  <div><dt>フレームレート</dt><dd id="requested-fps">—</dd></div>
                  <div><dt>処理先</dt><dd id="requested-delegate">—</dd></div>
                  <div><dt>モデルID</dt><dd id="requested-model">—</dd></div>
                  <div><dt>音声入力</dt><dd id="requested-audio">—</dd></div>
                </dl>
              </div>
              <div>
                <h3>実際の設定</h3>
                <dl class="data-list">
                  <div><dt>カメラの向き</dt><dd id="actual-facing">—</dd></div>
                  <div><dt>解像度</dt><dd id="actual-size">—</dd></div>
                  <div><dt>フレームレート</dt><dd id="actual-fps">—</dd></div>
                  <div><dt>カメラ名</dt><dd id="actual-label">—</dd></div>
                  <div><dt>カメラ状態</dt><dd id="track-state">—</dd></div>
                  <div><dt>一時停止中</dt><dd id="track-muted">—</dd></div>
                </dl>
              </div>
            </div>
          </details>

          <details>
            <summary>手の追跡処理</summary>
            <dl class="data-list">
              <div><dt>初期化状態</dt><dd id="tracking-init">—</dd></div>
              <div><dt>初期化時間</dt><dd id="tracking-init-time">—</dd></div>
              <div><dt>実際の処理先</dt><dd id="tracking-delegate">—</dd></div>
              <div><dt>切り替え理由</dt><dd id="tracking-fallback">—</dd></div>
              <div><dt>フレーム取得元</dt><dd id="tracking-source">—</dd></div>
              <div><dt>処理中／次に処理</dt><dd><span id="tracking-inflight">—</span> / <span id="tracking-pending">—</span></dd></div>
              <div><dt>取得／送信／完了</dt><dd id="tracking-counts">—</dd></div>
              <div><dt>新しいフレームへ置換</dt><dd id="tracking-replaced">—</dd></div>
              <div><dt>エラー件数</dt><dd id="tracking-errored">—</dd></div>
              <div><dt>取得から追跡処理まで p50</dt><dd id="tracking-callback-worker">—</dd></div>
              <div><dt>追跡処理の待ち時間 p50</dt><dd id="tracking-worker-wait">—</dd></div>
              <div><dt>最大推論時間</dt><dd id="tracking-inference-max">—</dd></div>
              <div><dt>フレームの古さ p50</dt><dd id="tracking-frame-age-p50">—</dd></div>
              <div><dt>重大エラー</dt><dd id="tracking-error">—</dd></div>
            </dl>
          </details>

          <details>
            <summary>両手の検出状況</summary>
            <dl class="data-list">
              <div><dt>検出した手の数</dt><dd id="tracking-hands">—</dd></div>
              <div><dt>初回検出まで</dt><dd id="tracking-first-acquisition">—</dd></div>
              <div><dt>片手以上を検出した割合</dt><dd id="tracking-one-coverage">—</dd></div>
              <div><dt>両手を検出した割合</dt><dd id="tracking-two-coverage">—</dd></div>
              <div><dt>左手の未検出時間</dt><dd id="tracking-left-missing">—</dd></div>
              <div><dt>右手の未検出時間</dt><dd id="tracking-right-missing">—</dd></div>
              <div><dt>左右判定</dt><dd id="tracking-handedness">—</dd></div>
            </dl>
          </details>

          <details>
            <summary>端末・表示環境</summary>
            <dl class="data-list">
              <div><dt>安全な接続</dt><dd id="environment-secure">—</dd></div>
              <div><dt>ページの表示状態</dt><dd id="environment-visibility">—</dd></div>
              <div><dt>画面の向き</dt><dd id="environment-orientation">—</dd></div>
              <div><dt>表示領域</dt><dd id="environment-viewport">—</dd></div>
              <div><dt>画面の画素密度</dt><dd id="environment-dpr">—</dd></div>
              <div><dt>フレーム取得元</dt><dd id="environment-frame-source">—</dd></div>
            </dl>
          </details>

          <details>
            <summary>使用APIの対応状況</summary>
            <dl class="data-list support-list">
              <div><dt>getUserMedia</dt><dd id="support-media">—</dd></div>
              <div><dt>requestVideoFrameCallback</dt><dd id="support-rvfc">—</dd></div>
              <div><dt>MediaStreamTrackProcessor</dt><dd id="support-processor">—</dd></div>
              <div><dt>VideoFrame</dt><dd id="support-video-frame">—</dd></div>
              <div><dt>createImageBitmap</dt><dd id="support-image-bitmap">—</dd></div>
            </dl>
          </details>
        </div>

        <p class="scope-note">生映像は保存・送信しません。MediaPipeのdetectionIndexは安定ID層へ変換してからジェスチャー判定へ渡します。</p>
      </details>

      <section class="p1-panel" aria-labelledby="p1-heading">
        <div class="section-heading p1-heading">
          <div>
            <p class="section-index">03 / P1制御試験</p>
            <h2 id="p1-heading">単体ジェスチャー制御試験</h2>
          </div>
          <span id="p1-progress" class="check-progress">0 / 30</span>
        </div>
        <p class="check-intro">正本の順序で、エアタップ10回、リボンスワイプ10回、Bloom10回を記録します。この画面の結果だけで合格とは判定しません。</p>

        <div class="p1-grid">
          <article class="p1-card p1-audio-card">
            <div class="p1-card-heading">
              <div><span>音声の基準時刻</span><strong id="p1-audio-state">未開始</strong></div>
              <button id="p1-enable-audio" class="button button--quiet" type="button">音を有効にする</button>
            </div>
            <p id="p1-audio-status" class="p1-support-copy">画面操作後にだけAudioContextを開始します。BluetoothはP1対象外です。</p>
            <dl class="p1-mini-metrics">
              <div><dt>時刻の対応方法</dt><dd id="p1-audio-source">—</dd></div>
              <div><dt>音声時刻</dt><dd id="p1-audio-time">—</dd></div>
              <div><dt>基本出力遅延（baseLatency）</dt><dd id="p1-base-latency">—</dd></div>
              <div><dt>出力遅延（outputLatency）</dt><dd id="p1-output-latency">—</dd></div>
            </dl>
          </article>

          <article class="p1-card p1-trial-card">
            <div class="p1-card-heading">
              <div><span>試験セッション</span><strong id="p1-state">未開始</strong></div>
              <button id="p1-start-session" class="button button--primary" type="button" disabled>テストを開始</button>
            </div>
            <dl class="p1-mini-metrics">
              <div><dt>セッションID</dt><dd id="p1-session-id">—</dd></div>
              <div><dt>試行</dt><dd id="p1-trial-number">—</dd></div>
              <div><dt>ジェスチャー</dt><dd id="p1-gesture">—</dd></div>
              <div><dt>残り時間</dt><dd id="p1-remaining">—</dd></div>
              <div><dt>直前の結果</dt><dd id="p1-last-result">—</dd></div>
            </dl>
            <div class="p1-instruction" aria-live="polite">
              <div class="p1-instruction-copy">
                <span>次に行うこと</span>
                <strong id="p1-instruction">セッションを開始してください</strong>
              </div>
              <div id="p1-motion-sample" class="p1-motion-sample" data-gesture="idle" data-variant="none">
                <div class="p1-motion-stage" aria-hidden="true">
                  <span class="p1-motion-path"></span>
                  <span class="p1-motion-target"></span>
                  <span class="p1-motion-orb"></span>
                  <span class="p1-motion-contact"></span>
                  <span class="p1-motion-hand p1-motion-hand--single">☝️</span>
                  <span class="p1-motion-hand p1-motion-hand--left">✋</span>
                  <span class="p1-motion-hand p1-motion-hand--right">✋</span>
                </div>
                <div class="p1-motion-copy">
                  <span>動作見本</span>
                  <strong id="p1-motion-caption">試行を始めると、ここに手の動きを表示します</strong>
                  <small>見本を確認 → GOで動く</small>
                </div>
              </div>
            </div>
            <div class="p1-live-diagnostic" aria-live="polite">
              <span>直近の拒否理由</span>
              <strong id="p1-latest-rejection">—</strong>
            </div>
            <p id="p1-performance-warning" class="p1-performance-warning" role="status" hidden>追跡出力が低いためジェスチャーが途切れる可能性があります</p>
            <div class="p1-trial-actions">
              <button id="p1-next-trial" class="button button--primary p1-next" type="button" disabled>次の試行を開始</button>
              <button id="p1-skip" class="button button--quiet p1-skip" type="button" disabled>未成立として次へ</button>
            </div>
          </article>
        </div>

        <div class="p1-observation-row" aria-label="試行結果の手動分類">
          <span>自動成立しなかった場合:</span>
          <button class="button button--quiet" type="button" data-p1-outcome="player-miss" disabled>操作が条件外</button>
          <button class="button button--quiet" type="button" data-p1-outcome="machine-miss" disabled>正しく操作したが未検出</button>
          <button class="button button--quiet" type="button" data-p1-outcome="tracking-loss" disabled>手の追跡失敗</button>
          <button class="button button--quiet" type="button" data-p1-outcome="unclassified" disabled>分類できない</button>
          <button id="p1-false-trigger" class="button button--danger" type="button">誤検出を記録</button>
        </div>

        <div class="p1-footer">
          <dl class="p1-counters">
            <div><dt>成立イベント</dt><dd id="p1-event-count">0</dd></div>
            <div><dt>不成立</dt><dd id="p1-rejection-count">0</dd></div>
            <div><dt>誤検出</dt><dd id="p1-false-trigger-count">0</dd></div>
            <div><dt>手の識別競合</dt><dd id="p1-id-conflicts">0</dd></div>
          </dl>
          <div class="p1-replay-block">
            <label class="button button--quiet" for="p1-replay-file">ランドマークリプレイを読込</label>
            <input id="p1-replay-file" type="file" accept="application/json,.json" hidden>
            <button id="p1-replay-run" class="button button--quiet" type="button" disabled>現在の試行条件で評価</button>
            <p id="p1-replay-status" class="export-status" role="status"></p>
          </div>
          <div class="p1-export-block">
            <button id="p1-export" class="button button--quiet" type="button" disabled>P1結果JSONを保存</button>
            <button id="p1-export-replay" class="button button--quiet" type="button" disabled>診断リプレイを保存</button>
            <p id="p1-export-status" class="export-status" role="status"></p>
            <p id="p1-replay-export-status" class="export-status" role="status"></p>
          </div>
        </div>
      </section>

      <section class="test-checklist-panel" aria-labelledby="device-check-heading">
        <div class="section-heading checklist-heading">
          <div>
            <p class="section-index">04 / 実機確認</p>
            <h2 id="device-check-heading">実機確認レポート</h2>
          </div>
          <span id="device-check-progress" class="check-progress">0 / 25確認 · 問題 0</span>
        </div>
        <p class="check-intro">上から順に進め、各項目を「未確認／問題なし／問題あり／対象外」で管理します。途中でJSONを保存し、同じJSONを読み込んで続きから再開できます。生映像・生音声はJSONに入りません。</p>

        <form id="device-check-form" class="device-check-form">
          <div class="report-toolbar" aria-label="レポートの読み込み">
            <div>
              <strong>途中から再開</strong>
              <span>以前保存した実機確認JSONを読み込みます。</span>
            </div>
            <label class="button button--quiet" for="device-check-import">実機確認JSONを読込</label>
            <input id="device-check-import" type="file" accept="application/json,.json" hidden>
            <label class="button button--quiet" for="device-check-p1-import">P1セッション結果を取込</label>
            <input id="device-check-p1-import" type="file" accept="application/json,.json" hidden>
          </div>
          <div class="technical-source-row" aria-live="polite">
            <div>
              <strong>自動計測値の出所</strong>
              <span id="device-check-technical-source">この画面を開いている端末</span>
            </div>
            <button id="device-check-use-current-technical" class="button button--quiet" type="button" hidden>この端末の値へ戻す</button>
          </div>

          <details class="report-section" open>
            <summary><span>1</span> セッション条件</summary>
            <fieldset class="session-fields report-fields">
              <legend>条件を変えた試験は別のセッションIDにしてください</legend>
              <label><span>セッションID</span><input id="device-check-session" name="sessionId" type="text" required></label>
              <label><span>確認した人（匿名ID）</span><input name="testerId" type="text" autocomplete="off" required placeholder="例: tester-a"></label>
              <label><span>参加者種別</span><select name="participantType"><option value="creator">開発者</option><option value="target">対象テスター</option><option value="other" selected>その他</option></select></label>
              <label><span>端末</span><select name="device" required><option value="">選択</option><option value="iPhone 15">iPhone 15</option><option value="Google Pixel 10 Pro XL">Google Pixel 10 Pro XL</option><option value="other">その他</option></select></label>
              <label><span>OS名</span><input name="osName" type="text" required placeholder="例: iOS"></label>
              <label><span>OS完全バージョン</span><input name="osVersion" type="text" required placeholder="例: 20.0.1"></label>
              <label><span>ブラウザ名</span><input name="browserName" type="text" required placeholder="例: Safari"></label>
              <label><span>ブラウザ完全バージョン</span><input name="browserVersion" type="text" required></label>
              <label><span>アプリ／ビルドID</span><input name="appVersion" type="text" placeholder="画面または担当者指定の値"></label>
              <label><span>カメラ距離（cm）</span><input name="distanceCm" type="number" min="30" max="300" inputmode="numeric" placeholder="80"></label>
              <label><span>向き</span><select name="orientation"><option value="landscape">横向き</option><option value="portrait">縦向き比較</option></select></label>
              <label><span>本体音量段階</span><input name="speakerVolume" type="text" placeholder="例: 8/16"></label>
              <label><span>照明</span><input name="lighting" type="text" placeholder="例: 正面から一般室内光"></label>
              <label><span>背景</span><input name="background" type="text" placeholder="例: 白い壁、柄なし"></label>
              <label><span>袖・服装</span><input name="sleeves" type="text" placeholder="例: 黒い長袖"></label>
            </fieldset>
          </details>

          <details class="report-section" open>
            <summary><span>2</span> セットアップ・カメラ・二手追跡</summary>
            <p class="report-help">「問題あり」を選んだ項目は、最後のメモに発生時刻や見え方を残してください。手の追跡失敗をプレイヤーの操作失敗として扱わないでください。</p>
            <div id="device-check-list" class="device-check-list device-check-list--managed"></div>
          </details>

          <details class="report-section" open>
            <summary><span>3</span> P1制御試験の結果</summary>
            <p class="report-help">上の制御試験画面で30試行を行い、P1セッションJSONを取り込むと自動入力できます。未分類を除外して成功率を良く見せないでください。</p>
            <div class="controlled-table-wrap">
              <table class="controlled-table">
                <thead><tr><th>ジェスチャー</th><th>成功</th><th>操作が条件外</th><th>正しく操作したが未検出</th><th>誤検出</th><th>手の追跡失敗</th><th>分類不能</th><th>時刻差</th></tr></thead>
                <tbody>
                  <tr><th>エアタップ</th><td><input name="airTapSuccess" type="number" min="0" max="10"></td><td><input name="airTapPlayerMiss" type="number" min="0" max="10"></td><td><input name="airTapMachineMiss" type="number" min="0" max="10"></td><td><input name="airTapFalseTrigger" type="number" min="0"></td><td><input name="airTapTrackingLoss" type="number" min="0" max="10"></td><td><input name="airTapUnclassified" type="number" min="0" max="10"></td><td><input name="airTapOffsetSummary" type="text" placeholder="p50 / p95"></td></tr>
                  <tr><th>リボンスワイプ</th><td><input name="ribbonSwipeSuccess" type="number" min="0" max="10"></td><td><input name="ribbonSwipePlayerMiss" type="number" min="0" max="10"></td><td><input name="ribbonSwipeMachineMiss" type="number" min="0" max="10"></td><td><input name="ribbonSwipeFalseTrigger" type="number" min="0"></td><td><input name="ribbonSwipeTrackingLoss" type="number" min="0" max="10"></td><td><input name="ribbonSwipeUnclassified" type="number" min="0" max="10"></td><td><input name="ribbonSwipeOffsetSummary" type="text" placeholder="p50 / p95"></td></tr>
                  <tr><th>Bloom</th><td><input name="bloomSuccess" type="number" min="0" max="10"></td><td><input name="bloomPlayerMiss" type="number" min="0" max="10"></td><td><input name="bloomMachineMiss" type="number" min="0" max="10"></td><td><input name="bloomFalseTrigger" type="number" min="0"></td><td><input name="bloomTrackingLoss" type="number" min="0" max="10"></td><td><input name="bloomUnclassified" type="number" min="0" max="10"></td><td><input name="bloomOffsetSummary" type="text" placeholder="p50 / p95"></td></tr>
                </tbody>
              </table>
            </div>
            <p id="device-check-controlled-status" class="report-validation" role="status">エアタップ: 未入力 · リボンスワイプ: 未入力 · Bloom: 未入力</p>
          </details>

          <details class="report-section">
            <summary><span>4</span> 同期感・分かりやすさ・疲労</summary>
            <fieldset class="result-fields report-fields">
              <legend>プレイ直後に、誘導せず回答を記録します</legend>
              <label><span>音と動きの合い方（1〜5）</span><input name="syncRating" type="number" min="1" max="5"></label>
              <label><span>ずれの感じ方</span><select name="latencySense"><option value="unsure">判断できない</option><option value="none">感じない</option><option value="late">遅い</option><option value="early">早い</option><option value="variable">ばらつく</option></select></label>
              <label><span>もう一度遊びたい？</span><select name="retryIntent"><option value="unsure">判断保留</option><option value="yes">はい</option><option value="no">いいえ</option></select></label>
              <label><span>肩の疲労（0〜10）</span><input name="shoulderFatigue" type="number" min="0" max="10"></label>
              <label><span>手首の疲労（0〜10）</span><input name="wristFatigue" type="number" min="0" max="10"></label>
              <label><span>目の疲労（0〜10）</span><input name="eyeFatigue" type="number" min="0" max="10"></label>
              <label><span>頭の疲労（0〜10）</span><input name="headFatigue" type="number" min="0" max="10"></label>
              <label class="field-wide"><span>何をすべきか分からなかった場面</span><textarea name="unclearMoments" rows="2"></textarea></label>
              <label class="field-wide"><span>分かって動いたのに無視された場面</span><textarea name="ignoredMoments" rows="2"></textarea></label>
              <label class="field-wide"><span>一番印象に残った動作</span><input name="memorableAction" type="text"></label>
              <label class="field-wide"><span>痛み・不快感</span><textarea name="painOrDiscomfort" rows="2"></textarea></label>
            </fieldset>
          </details>

          <details class="report-section" open>
            <summary><span>5</span> 判定と次の一手</summary>
            <fieldset class="result-fields report-fields">
              <legend>合格を急がず、要改善なら次に変えるものを一つだけ記録します</legend>
              <label><span>P1制御試験</span><select name="p1Decision"><option value="pending">未判定</option><option value="pass">合格</option><option value="learn">要改善</option><option value="pivot">方針転換</option></select></label>
              <label><span>次に変えるもの（一つ）</span><input name="nextChange" type="text" placeholder="例: Bloom minimumOutwardDistance"></label>
              <label class="field-wide"><span>判定・変更理由</span><textarea name="decisionReason" rows="3"></textarea></label>
              <label class="field-wide"><span>次セッションで固定する条件</span><textarea name="nextFixedConditions" rows="2"></textarea></label>
              <label class="field-wide"><span>補足メモ</span><textarea name="notes" rows="4" placeholder="問題の発生時刻、端末固有の挙動、再現手順など"></textarea></label>
            </fieldset>
          </details>

          <div class="export-row">
            <p>未確認・問題あり・対象外もそのままJSONへ残ります。保存したJSONをこの画面へ読み戻せます。</p>
            <button class="button button--primary export-button" type="submit">実機確認JSONを保存</button>
          </div>
          <p id="device-check-export-status" class="export-status" role="status" hidden></p>
        </form>
      </section>

      <section class="p1-comparison-panel" aria-labelledby="p1-comparison-heading">
        <div class="section-heading comparison-heading">
          <div>
            <p class="section-index">05 / セッション比較</p>
            <h2 id="p1-comparison-heading">P1セッション比較</h2>
          </div>
          <span id="p1-comparison-status" class="check-progress" data-candidate="false">0セッション</span>
        </div>
        <p class="check-intro">Android／iPhone等のP1結果JSONを追加し、30試行、3入力（air-tap／ribbon-swipe／Bloom）、分類合計、プライバシー設定、ビルド／プロファイル条件、技術値を比較します。旧clapセッションとBloomセッションは同じ合否条件へ混ぜません。</p>
        <div class="comparison-toolbar">
          <label class="button button--primary" for="p1-comparison-import">P1結果JSONを追加</label>
          <input id="p1-comparison-import" type="file" accept="application/json,.json" multiple hidden>
          <button id="p1-comparison-clear" class="button button--quiet" type="button" disabled>比較をクリア</button>
          <span>複数ファイルを同時選択できます。追加読込も可能です。</span>
        </div>
        <div class="comparison-table-wrap">
          <table class="comparison-table">
            <thead>
              <tr>
                <th>セッション</th>
                <th>形式／ビルド</th>
                <th>プロファイル</th>
                <th>試行数</th>
                <th>エアタップ</th>
                <th>スワイプ</th>
                <th>第三入力</th>
                <th>追跡出力</th>
                <th>フレームの古さ</th>
                <th>両手検出率</th>
                <th>整合性</th>
              </tr>
            </thead>
            <tbody id="p1-comparison-body"></tbody>
          </table>
        </div>
        <ul id="p1-comparison-findings" class="comparison-findings" aria-live="polite"></ul>
      </section>
    </main>
  </div>
`;
