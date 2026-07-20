import type { DeviceTechnicalSnapshot } from "../metrics/device-technical-snapshot";

export type DeviceCheckStatus = "pending" | "pass" | "issue" | "na";
export type DeviceCheckGroup = "preparation" | "camera" | "tracking" | "operation";

export interface DeviceCheckItem {
  readonly id: string;
  readonly group: DeviceCheckGroup;
  readonly label: string;
  readonly help: string;
  readonly required: boolean;
}

export const DEVICE_CHECK_ITEMS: readonly DeviceCheckItem[] = [
  { id: "bluetooth-off", group: "preparation", label: "Bluetoothを切った", help: "音声は本体スピーカーを使います。Bluetooth接続中はP1の同期評価をしません。", required: true },
  { id: "device-landscape", group: "preparation", label: "端末を横向きでスタンドに置いた", help: "手で持たず、画面が揺れない位置へ固定します。", required: true },
  { id: "distance", group: "preparation", label: "カメラから70〜100cmの距離を実測した", help: "両手を胸〜肩の高さへ広げても画面に収まる距離を記録します。", required: true },
  { id: "lighting", group: "preparation", label: "顔と手へ前方から光が当たっている", help: "逆光を避け、一般室内の明るさ・光源方向を記録します。", required: true },
  { id: "background", group: "preparation", label: "手と背景が極端に同化していない", help: "柄、逆光、袖色も記録し、セッション中は条件を変えません。", required: true },
  { id: "privacy", group: "preparation", label: "生映像・生音声を保存しない設定を確認した", help: "保存するのは派生ランドマーク、イベント、時刻、性能値、回答です。", required: true },
  { id: "tester-briefing", group: "preparation", label: "ずれや誤認識をそのまま伝えるよう説明した", help: "成功させることより、機械側の失敗を区別することが重要だと伝えます。", required: true },

  { id: "secure-context", group: "camera", label: "HTTPSで画面を開けた", help: "スマートフォンのカメラAPIにはsecure contextが必要です。", required: true },
  { id: "camera-permission", group: "camera", label: "カメラ許可後にインカメ映像が表示された", help: "マイク許可は要求しません。拒否時の案内も確認します。", required: true },
  { id: "front-camera", group: "camera", label: "インカメが選択されている", help: "実設定のFacingと映像を確認します。", required: true },
  { id: "frame-source", group: "camera", label: "Frame sourceとdelegateを記録した", help: "TrackProcessor／rVFC／fallback、GPU／CPUをLive diagnosticsで確認します。", required: true },
  { id: "camera-settings", group: "camera", label: "実解像度と実FPSを記録した", help: "要求値ではなくActual settingsの値を使います。", required: true },
  { id: "camera-sixty-seconds", group: "camera", label: "カメラを60秒以上動かして停止・エラーがなかった", help: "画面固着、track終了、継続エラーがあれば「問題あり」にします。", required: true },

  { id: "two-hands", group: "tracking", label: "両手に21点とカーソルが表示された", help: "胸〜肩の高さで両手を広げ、2 hands coverageを確認します。", required: true },
  { id: "hand-labels", group: "tracking", label: "片手ずつ上げてL／Rラベルを確認した", help: "画面上の左右ではなく、解剖学的な左手／右手と一致するか見ます。", required: true },
  { id: "overlay-alignment", group: "tracking", label: "鏡像映像とランドマーク位置が一致した", help: "指先、手首、手のひら中心が映像から大きく外れていないか確認します。", required: true },
  { id: "follow-motion", group: "tracking", label: "ゆっくり動かした手へ表示が追従した", help: "長い停止、別の手への飛び、目立つ遅れを観察します。", required: true },
  { id: "one-hand-loss", group: "tracking", label: "片手を隠すとtracking lossとして表示された", help: "プレイヤーのMISSとして扱われていないことを確認します。", required: true },
  { id: "both-hands-loss", group: "tracking", label: "両手を外すと両手喪失の案内が表示された", help: "両手を戻した時に追跡が復帰することも確認します。", required: true },
  { id: "tracking-metrics", group: "tracking", label: "追跡Hz・推論p95・frame age p95・coverageを記録した", help: "未計測値を0として扱わず、JSONのtechnicalへ保存します。", required: true },
  { id: "queue-bounded", group: "tracking", label: "in-flight／pendingが各1以下で増え続けなかった", help: "captured／completed／replacedも60秒の前後で確認します。", required: true },

  { id: "preview-hidden", group: "operation", label: "プレビューを隠しても追跡が継続した", help: "生映像を隠した後もcompletedと追跡表示が更新されることを見ます。", required: true },
  { id: "stop", group: "operation", label: "カメラ停止後に利用中表示が消えた", help: "映像が止まり、trackや多重streamが残らないことを確認します。", required: true },
  { id: "restart", group: "operation", label: "停止後に再開して二手表示が戻った", help: "開始→停止→再開を1回行い、エラーや二重表示がないか見ます。", required: true },
  { id: "json-privacy", group: "operation", label: "出力JSONに生映像・生音声が含まれない", help: "privacyのfalse値と、ファイル容量・内容を確認します。", required: true },
] as const;

export type DeviceCheckTechnicalSnapshot = DeviceTechnicalSnapshot;

export interface ControlledGestureResult {
  readonly success: number | null;
  readonly playerMiss: number | null;
  readonly machineMiss: number | null;
  readonly falseTrigger: number | null;
  readonly trackingLoss: number | null;
  readonly unclassified: number | null;
  readonly offsetSummary: string;
}

export interface DeviceCheckFormValues {
  readonly sessionId: string;
  readonly testerId: string;
  readonly participantType: "creator" | "target" | "other";
  readonly device: string;
  readonly osName: string;
  readonly osVersion: string;
  readonly browserName: string;
  readonly browserVersion: string;
  readonly appVersion: string;
  readonly distanceCm: number | null;
  readonly orientation: string;
  readonly lighting: string;
  readonly background: string;
  readonly sleeves: string;
  readonly speakerVolume: string;
  readonly checkStatuses: Readonly<Record<string, DeviceCheckStatus>>;
  readonly controlled: Readonly<Record<"airTap" | "ribbonSwipe" | "clapNearClap", ControlledGestureResult>>;
  readonly subjective: {
    readonly syncRating: number | null;
    readonly latencySense: "none" | "late" | "early" | "variable" | "unsure";
    readonly unclearMoments: string;
    readonly ignoredMoments: string;
    readonly memorableAction: string;
    readonly retryIntent: "yes" | "no" | "unsure";
    readonly shoulderFatigue: number | null;
    readonly wristFatigue: number | null;
    readonly eyeFatigue: number | null;
    readonly headFatigue: number | null;
    readonly painOrDiscomfort: string;
  };
  readonly decision: {
    readonly p1: "pass" | "learn" | "pivot" | "pending";
    readonly nextChange: string;
    readonly reason: string;
    readonly nextFixedConditions: string;
  };
  readonly notes: string;
}

export interface DeviceCheckReport {
  readonly schemaVersion: "2.1";
  readonly reportType: "phase1-device-check";
  readonly exportedAt: string;
  readonly session: Omit<DeviceCheckFormValues, "checkStatuses" | "controlled" | "subjective" | "decision" | "notes">;
  readonly progress: {
    readonly completed: number;
    readonly total: number;
    readonly pass: number;
    readonly issue: number;
    readonly na: number;
    readonly pending: number;
    readonly percent: number;
  };
  readonly checks: ReadonlyArray<DeviceCheckItem & { readonly status: DeviceCheckStatus }>;
  readonly controlled: DeviceCheckFormValues["controlled"];
  readonly subjective: DeviceCheckFormValues["subjective"];
  readonly decision: DeviceCheckFormValues["decision"];
  readonly notes: string;
  readonly technical: DeviceCheckTechnicalSnapshot;
  readonly technicalSource: DeviceCheckTechnicalSource;
  readonly privacy: { readonly includesCameraFrames: false; readonly includesAudio: false };
}

export interface DeviceCheckTechnicalSource {
  readonly mode: "current-device" | "p1-import" | "report-import";
  readonly capturedAt: string;
  readonly sessionId: string | null;
}

export function createDeviceCheckReport(
  values: DeviceCheckFormValues,
  technical: DeviceCheckTechnicalSnapshot,
  exportedAt = new Date().toISOString(),
  technicalSource: DeviceCheckTechnicalSource = {
    mode: "current-device",
    capturedAt: exportedAt,
    sessionId: values.sessionId || null,
  },
): DeviceCheckReport {
  const checks = DEVICE_CHECK_ITEMS.map((item) => ({
    ...item,
    status: values.checkStatuses[item.id] ?? "pending",
  }));
  const count = (status: DeviceCheckStatus): number => checks.filter((item) => item.status === status).length;
  const completed = checks.filter((item) => item.status !== "pending").length;
  return {
    schemaVersion: "2.1",
    reportType: "phase1-device-check",
    exportedAt,
    session: {
      sessionId: values.sessionId,
      testerId: values.testerId,
      participantType: values.participantType,
      device: values.device,
      osName: values.osName,
      osVersion: values.osVersion,
      browserName: values.browserName,
      browserVersion: values.browserVersion,
      appVersion: values.appVersion,
      distanceCm: values.distanceCm,
      orientation: values.orientation,
      lighting: values.lighting,
      background: values.background,
      sleeves: values.sleeves,
      speakerVolume: values.speakerVolume,
    },
    progress: {
      completed,
      total: checks.length,
      pass: count("pass"),
      issue: count("issue"),
      na: count("na"),
      pending: count("pending"),
      percent: checks.length === 0 ? 0 : Math.round(completed / checks.length * 100),
    },
    checks,
    controlled: values.controlled,
    subjective: values.subjective,
    decision: values.decision,
    notes: values.notes,
    technical,
    technicalSource,
    privacy: { includesCameraFrames: false, includesAudio: false },
  };
}

export function parseDeviceCheckReport(text: string): DeviceCheckReport {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value) || value.reportType !== "phase1-device-check") {
    throw new TypeError("Phase 1実機確認JSONではありません。");
  }
  if (value.schemaVersion === "2.0" || value.schemaVersion === "2.1") return parseVersion2(value);
  if (value.schemaVersion === "1.0") return migrateVersion1(value);
  throw new TypeError("対応していない実機確認JSONのバージョンです。");
}

export class DeviceChecklistController {
  readonly #form: HTMLFormElement;
  readonly #list: HTMLElement;
  readonly #progress: HTMLElement;
  readonly #status: HTMLElement;
  readonly #getTechnicalSnapshot: () => DeviceCheckTechnicalSnapshot;
  #technicalOverride: { readonly snapshot: DeviceCheckTechnicalSnapshot; readonly source: DeviceCheckTechnicalSource } | null = null;

  constructor(root: HTMLElement, getTechnicalSnapshot: () => DeviceCheckTechnicalSnapshot) {
    this.#form = requiredElement(root, "#device-check-form", HTMLFormElement);
    this.#list = requiredElement(root, "#device-check-list", HTMLElement);
    this.#progress = requiredElement(root, "#device-check-progress", HTMLElement);
    this.#status = requiredElement(root, "#device-check-export-status", HTMLElement);
    this.#getTechnicalSnapshot = getTechnicalSnapshot;
    requiredElement(root, "#device-check-session", HTMLInputElement).value = defaultSessionId();
    this.#renderItems();
    this.#form.addEventListener("change", this.#updateProgress);
    this.#form.addEventListener("input", this.#updateProgress);
    this.#form.addEventListener("submit", this.#download);
    requiredElement(root, "#device-check-import", HTMLInputElement).addEventListener("change", this.#importReport);
    requiredElement(root, "#device-check-p1-import", HTMLInputElement).addEventListener("change", this.#importP1Session);
    requiredElement(root, "#device-check-use-current-technical", HTMLButtonElement).addEventListener("click", this.#useCurrentTechnical);
    this.#renderTechnicalSource();
    this.#updateProgress();
  }

  #renderItems(): void {
    for (const group of ["preparation", "camera", "tracking", "operation"] as const) {
      const section = document.createElement("section");
      section.className = "check-group";
      section.dataset.group = group;
      const heading = document.createElement("h3");
      heading.textContent = groupLabel(group);
      section.append(heading);
      for (const item of DEVICE_CHECK_ITEMS.filter((candidate) => candidate.group === group)) {
        const row = document.createElement("div");
        row.className = "check-item check-item--managed";
        const copy = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = item.label;
        const help = document.createElement("small");
        help.textContent = item.help;
        copy.append(title, help);
        const select = document.createElement("select");
        select.name = `check:${item.id}`;
        select.setAttribute("aria-label", `${item.label}の結果`);
        for (const [value, label] of Object.entries(STATUS_LABELS)) {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = label;
          select.append(option);
        }
        row.append(copy, select);
        section.append(row);
      }
      this.#list.append(section);
    }
  }

  readonly #updateProgress = (): void => {
    const statuses = this.#readCheckStatuses();
    const values = Object.values(statuses);
    const completed = values.filter((status) => status !== "pending").length;
    const issues = values.filter((status) => status === "issue").length;
    this.#progress.textContent = `${completed} / ${DEVICE_CHECK_ITEMS.length}確認 · 問題 ${issues}`;
    this.#progress.dataset.issues = String(issues);
    for (const group of ["preparation", "camera", "tracking", "operation"] as const) {
      const items = DEVICE_CHECK_ITEMS.filter((item) => item.group === group);
      const groupCompleted = items.filter((item) => statuses[item.id] !== "pending").length;
      const section = this.#list.querySelector<HTMLElement>(`[data-group="${group}"]`);
      const heading = section?.querySelector("h3");
      if (heading !== null && heading !== undefined) heading.textContent = `${groupLabel(group)} · ${groupCompleted}/${items.length}`;
    }
    const controlledStatus = requiredElement(this.#form, "#device-check-controlled-status", HTMLElement);
    const gestureStatuses = [
      controlledRowStatus(this.#form, "Air tap", "airTap"),
      controlledRowStatus(this.#form, "Ribbon swipe", "ribbonSwipe"),
      controlledRowStatus(this.#form, "Clap / near", "clapNearClap"),
    ];
    controlledStatus.textContent = gestureStatuses.join(" · ");
    controlledStatus.dataset.complete = String(gestureStatuses.every((status) => status.includes("10/10")));
  };

  readonly #download = (event: SubmitEvent): void => {
    event.preventDefault();
    if (!this.#form.reportValidity()) return;
    const values = this.#readValues();
    const override = this.#technicalOverride;
    const report = createDeviceCheckReport(
      values,
      override?.snapshot ?? this.#getTechnicalSnapshot(),
      new Date().toISOString(),
      override?.source,
    );
    downloadJson(report, `oto-motion-device-check-${fileSafe(report.session.sessionId)}.json`);
    this.#status.textContent = `JSONを保存しました（${report.progress.completed}/${report.progress.total}確認、問題 ${report.progress.issue}件）。このファイルを担当者へ返してください。`;
    this.#status.hidden = false;
  };

  readonly #importReport = async (event: Event): Promise<void> => {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement) || input.files?.[0] === undefined) return;
    try {
      const report = parseDeviceCheckReport(await input.files[0].text());
      this.#applyReport(report);
      this.#technicalOverride = {
        snapshot: report.technical,
        source: {
          mode: "report-import",
          capturedAt: report.technicalSource.capturedAt,
          sessionId: report.technicalSource.sessionId ?? report.session.sessionId,
        },
      };
      this.#renderTechnicalSource();
      this.#status.textContent = `実機確認JSONを読み込みました。${report.progress.completed}/${report.progress.total}項目から再開できます。`;
    } catch (error) {
      this.#status.textContent = `読み込めません: ${describeError(error)}`;
    }
    this.#status.hidden = false;
    input.value = "";
  };

  readonly #importP1Session = async (event: Event): Promise<void> => {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement) || input.files?.[0] === undefined) return;
    try {
      const value: unknown = JSON.parse(await input.files[0].text());
      if (!isRecord(value) || value.schema !== "oto-motion-p1-controlled" || !isRecord(value.summary)) {
        throw new TypeError("P1-ControlledセッションJSONではありません。");
      }
      const byGesture = value.summary.byGesture;
      if (!isRecord(byGesture)) throw new TypeError("P1集計がありません。");
      applyGestureSummary(this.#form, "airTap", byGesture["air-tap"]);
      applyGestureSummary(this.#form, "ribbonSwipe", byGesture["ribbon-swipe"]);
      applyGestureSummary(this.#form, "clapNearClap", byGesture.clap);
      if (isRecord(value.technicalSnapshot)) {
        const sessionId = isRecord(value.session)
          ? nullableString(value.session.sessionId)
          : isRecord(value.replay) && isRecord(value.replay.session)
            ? nullableString(value.replay.session.sessionId)
            : null;
        this.#technicalOverride = {
          snapshot: parseTechnical(value.technicalSnapshot),
          source: {
            mode: "p1-import",
            capturedAt: nullableString(value.createdAtIso) ?? new Date().toISOString(),
            sessionId,
          },
        };
        if (sessionId !== null) setFormValue(this.#form, "sessionId", sessionId);
        this.#renderTechnicalSource();
        this.#status.textContent = "P1セッションから3ジェスチャーとスマホの自動計測値を取り込みました。PCで記入してもスマホ値を保持します。";
      } else {
        this.#status.textContent = "3ジェスチャーを取り込みましたが、この旧P1 JSONには端末の自動計測値がありません。最終保存は計測したスマホで行ってください。";
      }
    } catch (error) {
      this.#status.textContent = `P1結果を読み込めません: ${describeError(error)}`;
    }
    this.#status.hidden = false;
    input.value = "";
  };

  readonly #useCurrentTechnical = (): void => {
    this.#technicalOverride = null;
    this.#renderTechnicalSource();
    this.#status.textContent = "自動計測値を、この画面を開いている端末の値へ戻しました。";
    this.#status.hidden = false;
  };

  #renderTechnicalSource(): void {
    const source = requiredElement(this.#form, "#device-check-technical-source", HTMLElement);
    const reset = requiredElement(this.#form, "#device-check-use-current-technical", HTMLButtonElement);
    const override = this.#technicalOverride;
    if (override === null) {
      source.textContent = "この画面を開いている端末（スマホで計測する場合はスマホ）";
      source.dataset.imported = "false";
      reset.hidden = true;
      return;
    }
    const session = override.source.sessionId === null ? "session不明" : override.source.sessionId;
    source.textContent = `${override.source.mode === "p1-import" ? "P1セッション" : "実機確認レポート"}由来 · ${session} · ${override.snapshot.viewport || "viewport不明"}`;
    source.dataset.imported = "true";
    reset.hidden = false;
  }

  #readValues(): DeviceCheckFormValues {
    const data = new FormData(this.#form);
    return {
      sessionId: field(data, "sessionId"),
      testerId: field(data, "testerId"),
      participantType: participantType(data.get("participantType")),
      device: field(data, "device"),
      osName: field(data, "osName"),
      osVersion: field(data, "osVersion"),
      browserName: field(data, "browserName"),
      browserVersion: field(data, "browserVersion"),
      appVersion: field(data, "appVersion"),
      distanceCm: nullableNumber(data.get("distanceCm")),
      orientation: field(data, "orientation"),
      lighting: field(data, "lighting"),
      background: field(data, "background"),
      sleeves: field(data, "sleeves"),
      speakerVolume: field(data, "speakerVolume"),
      checkStatuses: this.#readCheckStatuses(),
      controlled: {
        airTap: readGestureResult(data, "airTap"),
        ribbonSwipe: readGestureResult(data, "ribbonSwipe"),
        clapNearClap: readGestureResult(data, "clapNearClap"),
      },
      subjective: {
        syncRating: nullableNumber(data.get("syncRating")),
        latencySense: latencySense(data.get("latencySense")),
        unclearMoments: field(data, "unclearMoments"),
        ignoredMoments: field(data, "ignoredMoments"),
        memorableAction: field(data, "memorableAction"),
        retryIntent: retryIntent(data.get("retryIntent")),
        shoulderFatigue: nullableNumber(data.get("shoulderFatigue")),
        wristFatigue: nullableNumber(data.get("wristFatigue")),
        eyeFatigue: nullableNumber(data.get("eyeFatigue")),
        headFatigue: nullableNumber(data.get("headFatigue")),
        painOrDiscomfort: field(data, "painOrDiscomfort"),
      },
      decision: {
        p1: decision(data.get("p1Decision")),
        nextChange: field(data, "nextChange"),
        reason: field(data, "decisionReason"),
        nextFixedConditions: field(data, "nextFixedConditions"),
      },
      notes: field(data, "notes"),
    };
  }

  #readCheckStatuses(): Record<string, DeviceCheckStatus> {
    return Object.fromEntries(DEVICE_CHECK_ITEMS.map((item) => {
      const select = this.#form.elements.namedItem(`check:${item.id}`);
      return [item.id, select instanceof HTMLSelectElement ? checkStatus(select.value) : "pending"];
    }));
  }

  #applyReport(report: DeviceCheckReport): void {
    const fields: Record<string, string | number | null> = {
      sessionId: report.session.sessionId,
      testerId: report.session.testerId,
      participantType: report.session.participantType,
      device: report.session.device,
      osName: report.session.osName,
      osVersion: report.session.osVersion,
      browserName: report.session.browserName,
      browserVersion: report.session.browserVersion,
      appVersion: report.session.appVersion,
      distanceCm: report.session.distanceCm,
      orientation: report.session.orientation,
      lighting: report.session.lighting,
      background: report.session.background,
      sleeves: report.session.sleeves,
      speakerVolume: report.session.speakerVolume,
      syncRating: report.subjective.syncRating,
      latencySense: report.subjective.latencySense,
      unclearMoments: report.subjective.unclearMoments,
      ignoredMoments: report.subjective.ignoredMoments,
      memorableAction: report.subjective.memorableAction,
      retryIntent: report.subjective.retryIntent,
      shoulderFatigue: report.subjective.shoulderFatigue,
      wristFatigue: report.subjective.wristFatigue,
      eyeFatigue: report.subjective.eyeFatigue,
      headFatigue: report.subjective.headFatigue,
      painOrDiscomfort: report.subjective.painOrDiscomfort,
      p1Decision: report.decision.p1,
      nextChange: report.decision.nextChange,
      decisionReason: report.decision.reason,
      nextFixedConditions: report.decision.nextFixedConditions,
      notes: report.notes,
    };
    for (const [name, value] of Object.entries(fields)) setFormValue(this.#form, name, value);
    for (const check of report.checks) setFormValue(this.#form, `check:${check.id}`, check.status);
    for (const [key, result] of Object.entries(report.controlled)) applyGestureResult(this.#form, key, result);
    this.#updateProgress();
  }
}

const STATUS_LABELS: Readonly<Record<DeviceCheckStatus, string>> = {
  pending: "未確認",
  pass: "問題なし",
  issue: "問題あり",
  na: "対象外",
};

function groupLabel(group: DeviceCheckGroup): string {
  return {
    preparation: "1. 条件を固定",
    camera: "2. カメラ経路",
    tracking: "3. 二手追跡",
    operation: "4. 停止・復帰・データ",
  }[group];
}

function readGestureResult(data: FormData, prefix: string): ControlledGestureResult {
  return {
    success: nullableNumber(data.get(`${prefix}Success`)),
    playerMiss: nullableNumber(data.get(`${prefix}PlayerMiss`)),
    machineMiss: nullableNumber(data.get(`${prefix}MachineMiss`)),
    falseTrigger: nullableNumber(data.get(`${prefix}FalseTrigger`)),
    trackingLoss: nullableNumber(data.get(`${prefix}TrackingLoss`)),
    unclassified: nullableNumber(data.get(`${prefix}Unclassified`)),
    offsetSummary: field(data, `${prefix}OffsetSummary`),
  };
}

function controlledRowStatus(form: HTMLFormElement, label: string, prefix: string): string {
  const value = (suffix: string): number | null => {
    const element = form.elements.namedItem(`${prefix}${suffix}`);
    return element instanceof HTMLInputElement ? nullableNumber(element.value) : null;
  };
  const success = value("Success");
  const classified = [success, value("PlayerMiss"), value("MachineMiss"), value("TrackingLoss"), value("Unclassified")];
  if (classified.every((item) => item === null)) return `${label}: 未入力`;
  const total = classified.reduce<number>((sum, item) => sum + (item ?? 0), 0);
  return `${label}: ${total}/10${success === null ? "" : `・success ${success}`}`;
}

function applyGestureSummary(form: HTMLFormElement, key: string, value: unknown): void {
  if (!isRecord(value)) throw new TypeError("ジェスチャー集計が不正です。");
  setFormValue(form, `${key}Success`, finite(value.success));
  setFormValue(form, `${key}PlayerMiss`, finite(value.playerMiss));
  setFormValue(form, `${key}MachineMiss`, finite(value.machineMiss));
  setFormValue(form, `${key}FalseTrigger`, finite(value.falseTrigger));
  setFormValue(form, `${key}TrackingLoss`, finite(value.trackingLoss));
  setFormValue(form, `${key}Unclassified`, finite(value.unclassified));
  const p50 = finite(value.offsetP50Ms);
  const p95 = finite(value.offsetP95Ms);
  setFormValue(form, `${key}OffsetSummary`, p50 === null && p95 === null ? "" : `p50 ${p50 ?? "—"}ms / p95 ${p95 ?? "—"}ms`);
}

function applyGestureResult(form: HTMLFormElement, key: string, result: ControlledGestureResult): void {
  setFormValue(form, `${key}Success`, result.success);
  setFormValue(form, `${key}PlayerMiss`, result.playerMiss);
  setFormValue(form, `${key}MachineMiss`, result.machineMiss);
  setFormValue(form, `${key}FalseTrigger`, result.falseTrigger);
  setFormValue(form, `${key}TrackingLoss`, result.trackingLoss);
  setFormValue(form, `${key}Unclassified`, result.unclassified);
  setFormValue(form, `${key}OffsetSummary`, result.offsetSummary);
}

function parseVersion2(value: Record<string, unknown>): DeviceCheckReport {
  if (!isRecord(value.session) || !Array.isArray(value.checks) || !isRecord(value.technical)) {
    throw new TypeError("実機確認JSONの必須項目がありません。");
  }
  const base = emptyValues();
  const report = createDeviceCheckReport({
    ...base,
    sessionId: stringValue(value.session.sessionId),
    testerId: stringValue(value.session.testerId),
    participantType: participantType(value.session.participantType),
    device: stringValue(value.session.device),
    osName: stringValue(value.session.osName),
    osVersion: stringValue(value.session.osVersion),
    browserName: stringValue(value.session.browserName),
    browserVersion: stringValue(value.session.browserVersion),
    appVersion: stringValue(value.session.appVersion),
    distanceCm: finite(value.session.distanceCm),
    orientation: stringValue(value.session.orientation),
    lighting: stringValue(value.session.lighting),
    background: stringValue(value.session.background),
    sleeves: stringValue(value.session.sleeves),
    speakerVolume: stringValue(value.session.speakerVolume),
    checkStatuses: Object.fromEntries(value.checks.flatMap((check) => {
      if (!isRecord(check) || typeof check.id !== "string") return [];
      return [[check.id, checkStatus(check.status)]];
    })),
    controlled: parseControlled(value.controlled),
    subjective: parseSubjective(value.subjective),
    decision: parseDecision(value.decision),
    notes: stringValue(value.notes),
  }, parseTechnical(value.technical), stringValue(value.exportedAt) || new Date().toISOString(), parseTechnicalSource(value.technicalSource, value));
  return report;
}

function migrateVersion1(value: Record<string, unknown>): DeviceCheckReport {
  const session = isRecord(value.session) ? value.session : {};
  const checks = Array.isArray(value.checks) ? value.checks : [];
  const base = emptyValues();
  return createDeviceCheckReport({
    ...base,
    sessionId: stringValue(session.sessionId),
    testerId: stringValue(session.testerId),
    device: stringValue(session.device),
    osName: stringValue(session.osBrowser),
    lighting: stringValue(session.environment),
    distanceCm: finite(session.distanceCm),
    notes: stringValue(session.notes),
    checkStatuses: Object.fromEntries(checks.flatMap((check) => {
      if (!isRecord(check) || typeof check.id !== "string") return [];
      return [[check.id, check.completed === true ? "pass" : "pending"]];
    })),
  }, isRecord(value.technical) ? parseTechnical(value.technical) : emptyTechnical(), stringValue(value.exportedAt) || new Date().toISOString(), {
    mode: "report-import",
    capturedAt: stringValue(value.exportedAt) || new Date().toISOString(),
    sessionId: stringValue(session.sessionId) || null,
  });
}

function parseTechnicalSource(value: unknown, report: Record<string, unknown>): DeviceCheckTechnicalSource {
  const record = isRecord(value) ? value : {};
  const session = isRecord(report.session) ? report.session : {};
  const mode = record.mode === "p1-import" || record.mode === "report-import" || record.mode === "current-device"
    ? record.mode
    : "report-import";
  return {
    mode,
    capturedAt: stringValue(record.capturedAt) || stringValue(report.exportedAt) || new Date().toISOString(),
    sessionId: nullableString(record.sessionId) ?? (stringValue(session.sessionId) || null),
  };
}

function parseControlled(value: unknown): DeviceCheckFormValues["controlled"] {
  const record = isRecord(value) ? value : {};
  return {
    airTap: parseGestureResult(record.airTap),
    ribbonSwipe: parseGestureResult(record.ribbonSwipe),
    clapNearClap: parseGestureResult(record.clapNearClap),
  };
}

function parseGestureResult(value: unknown): ControlledGestureResult {
  const record = isRecord(value) ? value : {};
  return {
    success: finite(record.success),
    playerMiss: finite(record.playerMiss),
    machineMiss: finite(record.machineMiss),
    falseTrigger: finite(record.falseTrigger),
    trackingLoss: finite(record.trackingLoss),
    unclassified: finite(record.unclassified),
    offsetSummary: stringValue(record.offsetSummary),
  };
}

function parseSubjective(value: unknown): DeviceCheckFormValues["subjective"] {
  const record = isRecord(value) ? value : {};
  return {
    syncRating: finite(record.syncRating),
    latencySense: latencySense(record.latencySense),
    unclearMoments: stringValue(record.unclearMoments),
    ignoredMoments: stringValue(record.ignoredMoments),
    memorableAction: stringValue(record.memorableAction),
    retryIntent: retryIntent(record.retryIntent),
    shoulderFatigue: finite(record.shoulderFatigue),
    wristFatigue: finite(record.wristFatigue),
    eyeFatigue: finite(record.eyeFatigue),
    headFatigue: finite(record.headFatigue),
    painOrDiscomfort: stringValue(record.painOrDiscomfort),
  };
}

function parseDecision(value: unknown): DeviceCheckFormValues["decision"] {
  const record = isRecord(value) ? value : {};
  return {
    p1: decision(record.p1),
    nextChange: stringValue(record.nextChange),
    reason: stringValue(record.reason),
    nextFixedConditions: stringValue(record.nextFixedConditions),
  };
}

function parseTechnical(value: Record<string, unknown>): DeviceCheckTechnicalSnapshot {
  return {
    pageUrl: stringValue(value.pageUrl),
    userAgent: stringValue(value.userAgent),
    viewport: stringValue(value.viewport),
    devicePixelRatio: finite(value.devicePixelRatio) ?? 1,
    cameraFps: finite(value.cameraFps),
    trackingHz: finite(value.trackingHz),
    inferenceP50Ms: finite(value.inferenceP50Ms),
    inferenceP95Ms: finite(value.inferenceP95Ms),
    frameAgeP95Ms: finite(value.frameAgeP95Ms),
    oneHandCoverage: finite(value.oneHandCoverage),
    twoHandCoverage: finite(value.twoHandCoverage),
    frameSource: nullableString(value.frameSource),
    delegate: nullableString(value.delegate),
    packageId: nullableString(value.packageId),
    modelId: nullableString(value.modelId),
    capturedFrames: finite(value.capturedFrames),
    completedFrames: finite(value.completedFrames),
    replacedFrames: finite(value.replacedFrames),
    erroredFrames: finite(value.erroredFrames),
    inFlightFrames: finite(value.inFlightFrames),
    pendingFrames: finite(value.pendingFrames),
    trackingError: nullableString(value.trackingError),
  };
}

function emptyValues(): DeviceCheckFormValues {
  const emptyGesture = (): ControlledGestureResult => ({ success: null, playerMiss: null, machineMiss: null, falseTrigger: null, trackingLoss: null, unclassified: null, offsetSummary: "" });
  return {
    sessionId: "", testerId: "", participantType: "other", device: "", osName: "", osVersion: "", browserName: "", browserVersion: "", appVersion: "", distanceCm: null, orientation: "landscape", lighting: "", background: "", sleeves: "", speakerVolume: "",
    checkStatuses: {},
    controlled: { airTap: emptyGesture(), ribbonSwipe: emptyGesture(), clapNearClap: emptyGesture() },
    subjective: { syncRating: null, latencySense: "unsure", unclearMoments: "", ignoredMoments: "", memorableAction: "", retryIntent: "unsure", shoulderFatigue: null, wristFatigue: null, eyeFatigue: null, headFatigue: null, painOrDiscomfort: "" },
    decision: { p1: "pending", nextChange: "", reason: "", nextFixedConditions: "" },
    notes: "",
  };
}

function emptyTechnical(): DeviceCheckTechnicalSnapshot {
  return { pageUrl: "", userAgent: "", viewport: "", devicePixelRatio: 1, cameraFps: null, trackingHz: null, inferenceP50Ms: null, inferenceP95Ms: null, frameAgeP95Ms: null, oneHandCoverage: null, twoHandCoverage: null, frameSource: null, delegate: null, packageId: null, modelId: null, capturedFrames: null, completedFrames: null, replacedFrames: null, erroredFrames: null, inFlightFrames: null, pendingFrames: null, trackingError: null };
}

function downloadJson(value: unknown, filename: string): void {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function setFormValue(form: HTMLFormElement, name: string, value: string | number | null): void {
  const element = form.elements.namedItem(name);
  if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
    element.value = value === null ? "" : String(value);
  }
}

function field(data: FormData, name: string): string {
  return String(data.get(name) ?? "").trim();
}

function nullableNumber(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? "").trim();
  if (text.length === 0) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function checkStatus(value: unknown): DeviceCheckStatus {
  return value === "pass" || value === "issue" || value === "na" ? value : "pending";
}

function participantType(value: unknown): DeviceCheckFormValues["participantType"] {
  return value === "creator" || value === "target" ? value : "other";
}

function latencySense(value: unknown): DeviceCheckFormValues["subjective"]["latencySense"] {
  return value === "none" || value === "late" || value === "early" || value === "variable" ? value : "unsure";
}

function retryIntent(value: unknown): DeviceCheckFormValues["subjective"]["retryIntent"] {
  return value === "yes" || value === "no" ? value : "unsure";
}

function decision(value: unknown): DeviceCheckFormValues["decision"]["p1"] {
  return value === "pass" || value === "learn" || value === "pivot" ? value : "pending";
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function fileSafe(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "session";
}

function defaultSessionId(): string {
  const now = new Date();
  const parts = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0"), "-", String(now.getHours()).padStart(2, "0"), String(now.getMinutes()).padStart(2, "0")];
  return `session-${parts.join("")}`;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requiredElement<T extends Element>(root: ParentNode, selector: string, constructor: { new (): T }): T {
  const element = root.querySelector(selector);
  if (!(element instanceof constructor)) throw new Error(`Required element not found: ${selector}`);
  return element;
}
