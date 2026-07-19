export interface DeviceCheckItem {
  readonly id: string;
  readonly group: "preparation" | "tracking" | "operation";
  readonly label: string;
  readonly help: string;
}

export const DEVICE_CHECK_ITEMS: readonly DeviceCheckItem[] = [
  { id: "device-landscape", group: "preparation", label: "端末を横向きでスタンドに置いた", help: "手で持たず、画面が揺れない状態にします。" },
  { id: "distance", group: "preparation", label: "カメラから70〜100cm離れた", help: "両手を広げても画面に収まる距離を目安にします。" },
  { id: "lighting", group: "preparation", label: "顔と手が明るく映っている", help: "逆光を避け、正面か斜め前から光を当てます。" },
  { id: "privacy", group: "preparation", label: "映像が保存・送信されないことを確認した", help: "この画面は映像を端末内で処理し、録画しません。" },
  { id: "camera-start", group: "tracking", label: "「カメラを開始」で映像が表示された", help: "許可画面が出た場合はカメラの利用を許可します。" },
  { id: "two-hands", group: "tracking", label: "両手に点とカーソルが表示された", help: "左右の手を胸〜肩の高さで広げて確認します。" },
  { id: "hand-labels", group: "tracking", label: "左手と右手のラベルを確認した", help: "片手ずつ上げ、L／R表示と動く点の位置を見ます。" },
  { id: "follow-motion", group: "tracking", label: "手をゆっくり動かすと点が追いかけてきた", help: "映像と点が大きくずれたり、長く止まったりしないか見ます。" },
  { id: "sixty-seconds", group: "tracking", label: "両手を映したまま60秒動かせた", help: "途中で画面が固まる、エラーになる、点が消え続ける場合は未チェックにします。" },
  { id: "stop", group: "operation", label: "「カメラを停止」で映像が止まった", help: "停止後にカメラ利用中の表示が残らないことを確認します。" },
  { id: "restart", group: "operation", label: "もう一度開始して二手表示が戻った", help: "開始→停止→再開を1回行います。" },
] as const;

export interface DeviceCheckTechnicalSnapshot {
  readonly pageUrl: string;
  readonly userAgent: string;
  readonly viewport: string;
  readonly devicePixelRatio: number;
  readonly cameraFps: number | null;
  readonly trackingHz: number | null;
  readonly inferenceP95Ms: number | null;
  readonly frameAgeP95Ms: number | null;
  readonly frameSource: string | null;
  readonly delegate: string | null;
  readonly capturedFrames: number | null;
  readonly completedFrames: number | null;
  readonly replacedFrames: number | null;
  readonly trackingError: string | null;
}

export interface DeviceCheckFormValues {
  readonly sessionId: string;
  readonly testerId: string;
  readonly device: string;
  readonly osBrowser: string;
  readonly distanceCm: number | null;
  readonly environment: string;
  readonly overall: "pass" | "issue" | "pending";
  readonly notes: string;
  readonly completedIds: ReadonlySet<string>;
}

export interface DeviceCheckReport {
  readonly schemaVersion: "1.0";
  readonly reportType: "phase1-device-check";
  readonly exportedAt: string;
  readonly session: Omit<DeviceCheckFormValues, "completedIds">;
  readonly progress: { readonly completed: number; readonly total: number };
  readonly checks: ReadonlyArray<DeviceCheckItem & { readonly completed: boolean }>;
  readonly technical: DeviceCheckTechnicalSnapshot;
  readonly privacy: { readonly includesCameraFrames: false; readonly includesAudio: false };
}

export function createDeviceCheckReport(
  values: DeviceCheckFormValues,
  technical: DeviceCheckTechnicalSnapshot,
  exportedAt = new Date().toISOString(),
): DeviceCheckReport {
  const checks = DEVICE_CHECK_ITEMS.map((item) => ({
    ...item,
    completed: values.completedIds.has(item.id),
  }));
  return {
    schemaVersion: "1.0",
    reportType: "phase1-device-check",
    exportedAt,
    session: {
      sessionId: values.sessionId,
      testerId: values.testerId,
      device: values.device,
      osBrowser: values.osBrowser,
      distanceCm: values.distanceCm,
      environment: values.environment,
      overall: values.overall,
      notes: values.notes,
    },
    progress: {
      completed: checks.filter((item) => item.completed).length,
      total: checks.length,
    },
    checks,
    technical,
    privacy: { includesCameraFrames: false, includesAudio: false },
  };
}

export class DeviceChecklistController {
  readonly #form: HTMLFormElement;
  readonly #list: HTMLElement;
  readonly #progress: HTMLElement;
  readonly #status: HTMLElement;
  readonly #getTechnicalSnapshot: () => DeviceCheckTechnicalSnapshot;

  constructor(root: HTMLElement, getTechnicalSnapshot: () => DeviceCheckTechnicalSnapshot) {
    this.#form = requiredElement(root, "#device-check-form", HTMLFormElement);
    this.#list = requiredElement(root, "#device-check-list", HTMLElement);
    this.#progress = requiredElement(root, "#device-check-progress", HTMLElement);
    this.#status = requiredElement(root, "#device-check-export-status", HTMLElement);
    this.#getTechnicalSnapshot = getTechnicalSnapshot;
    requiredElement(root, "#device-check-session", HTMLInputElement).value = defaultSessionId();
    this.#renderItems();
    this.#form.addEventListener("change", this.#updateProgress);
    this.#form.addEventListener("submit", this.#download);
    this.#updateProgress();
  }

  #renderItems(): void {
    for (const group of ["preparation", "tracking", "operation"] as const) {
      const section = document.createElement("section");
      section.className = "check-group";
      const heading = document.createElement("h3");
      heading.textContent = { preparation: "1. 準備", tracking: "2. 二手表示", operation: "3. 停止と再開" }[group];
      section.append(heading);
      for (const item of DEVICE_CHECK_ITEMS.filter((candidate) => candidate.group === group)) {
        const label = document.createElement("label");
        label.className = "check-item";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.name = "checks";
        input.value = item.id;
        const copy = document.createElement("span");
        const title = document.createElement("strong");
        title.textContent = item.label;
        const help = document.createElement("small");
        help.textContent = item.help;
        copy.append(title, help);
        label.append(input, copy);
        section.append(label);
      }
      this.#list.append(section);
    }
  }

  readonly #updateProgress = (): void => {
    const completed = this.#form.querySelectorAll<HTMLInputElement>('input[name="checks"]:checked').length;
    this.#progress.textContent = `${completed} / ${DEVICE_CHECK_ITEMS.length} 完了`;
  };

  readonly #download = (event: SubmitEvent): void => {
    event.preventDefault();
    if (!this.#form.reportValidity()) return;
    const formData = new FormData(this.#form);
    const completedIds = new Set(formData.getAll("checks").map(String));
    const distanceValue = String(formData.get("distanceCm") ?? "").trim();
    const report = createDeviceCheckReport(
      {
        sessionId: String(formData.get("sessionId") ?? "").trim(),
        testerId: String(formData.get("testerId") ?? "").trim(),
        device: String(formData.get("device") ?? ""),
        osBrowser: String(formData.get("osBrowser") ?? "").trim(),
        distanceCm: distanceValue.length === 0 ? null : Number(distanceValue),
        environment: String(formData.get("environment") ?? "").trim(),
        overall: normalizeOverall(formData.get("overall")),
        notes: String(formData.get("notes") ?? "").trim(),
        completedIds,
      },
      this.#getTechnicalSnapshot(),
    );
    const blob = new Blob([`${JSON.stringify(report, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `oto-motion-device-check-${fileSafe(report.session.sessionId)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    this.#status.textContent = `JSONを保存しました（${report.progress.completed}/${report.progress.total}項目）。このファイルを担当者へ送ってください。`;
    this.#status.hidden = false;
  };
}

function normalizeOverall(value: FormDataEntryValue | null): DeviceCheckFormValues["overall"] {
  return value === "pass" || value === "issue" ? value : "pending";
}

function fileSafe(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "session";
}

function defaultSessionId(): string {
  const now = new Date();
  const parts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
  ];
  return `session-${parts.join("")}`;
}

function requiredElement<T extends Element>(root: ParentNode, selector: string, constructor: { new (): T }): T {
  const element = root.querySelector(selector);
  if (!(element instanceof constructor)) throw new Error(`Required element not found: ${selector}`);
  return element;
}
