import { P1_FIVE_GESTURE_PROTOCOL_ID } from "../poc/phase1-protocol";

type P1ComparisonGesture = "air-tap" | "ribbon-swipe" | "clap" | "bloom" | "lift" | "spotlight";
type P1ThirdGesture = "clap" | "bloom";
type P1SchemaVersion = 2 | 3 | 4 | 5;
type FindingSeverity = "error" | "warning" | "info";

export interface P1ComparisonFinding {
  readonly code: string;
  readonly severity: FindingSeverity;
  readonly message: string;
}

export interface P1ComparisonGestureSummary {
  readonly completed: number;
  readonly success: number;
  readonly playerMiss: number;
  readonly machineMiss: number;
  readonly trackingLoss: number;
  readonly unclassified: number;
  readonly falseTrigger: number;
}

export interface P1ComparisonSession {
  readonly fileName: string;
  readonly schemaVersion: P1SchemaVersion;
  /** Distinguishes the legacy clap protocol, the 3-input Bloom protocol, and the 5-gesture protocol. */
  readonly protocolId: string;
  readonly thirdGesture: P1ThirdGesture;
  /** Experimental inputs recorded in addition to the three current inputs (schema v5). */
  readonly candidateGestures: readonly P1ComparisonGesture[];
  readonly sessionId: string;
  readonly createdAtIso: string;
  readonly appBuildId: string;
  readonly experimentProfileId: string;
  readonly userAgent: string;
  readonly viewport: string;
  readonly requestedCamera: string;
  readonly actualCamera: string;
  readonly requestedDelegate: string;
  readonly actualDelegate: string;
  readonly requestedModelId: string;
  readonly actualModelId: string;
  readonly completed: number;
  readonly total: number;
  readonly gestures: Readonly<Record<P1ComparisonGesture, P1ComparisonGestureSummary>>;
  readonly trackingHz: number | null;
  readonly inferenceP95Ms: number | null;
  readonly frameAgeP95Ms: number | null;
  readonly twoHandCoverage: number | null;
  readonly findings: readonly P1ComparisonFinding[];
  readonly dataComplete: boolean;
  readonly controlledCriterionCandidate: boolean;
}

export interface P1ComparisonResult {
  readonly sessions: readonly P1ComparisonSession[];
  readonly findings: readonly P1ComparisonFinding[];
  readonly nextAction: string;
  readonly controlledCriterionCandidate: boolean;
}

const ALL_GESTURES: readonly P1ComparisonGesture[] = [
  "air-tap",
  "ribbon-swipe",
  "clap",
  "bloom",
  "lift",
  "spotlight",
];

const BASE_GESTURES: readonly P1ComparisonGesture[] = [
  "air-tap",
  "ribbon-swipe",
];

const CANDIDATE_GESTURES: readonly P1ComparisonGesture[] = ["lift", "spotlight"];
const TRIALS_PER_GESTURE = 10;
/** Protocol IDs of sessions saved before schema v5 recorded one. */
export const P1_LEGACY_PROTOCOL_IDS: Readonly<Record<P1ThirdGesture, string>> = {
  clap: "p1-legacy-clap-30",
  bloom: "p1-bloom-30",
};
/** Findings that keep a v5 session out of the controlled criterion: its record of the procedure does not match. */
const FIVE_GESTURE_RECORD_FINDINGS: readonly string[] = [
  "protocol-id-unknown",
  "trials-per-gesture",
  "v5-blocks-incomplete",
  "v5-attempt-missing",
  "v5-spotlight-variants",
];

export function parseP1SessionForComparison(
  text: string,
  fileName: string,
): P1ComparisonSession {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value) || value.schema !== "oto-motion-p1-controlled") {
    throw new TypeError("P1-ControlledセッションJSONではありません。");
  }
  const schemaVersion = value.schemaVersion;
  if (schemaVersion !== 2 && schemaVersion !== 3 && schemaVersion !== 4 && schemaVersion !== 5) {
    throw new TypeError("対応していないP1 schema versionです。");
  }
  const findings: P1ComparisonFinding[] = [];
  const thirdGesture = parseThirdGesture(value, schemaVersion, findings);
  const candidateGestures = parseCandidateGestures(value, schemaVersion, findings);
  const sessionGestures = [...comparisonGestures(thirdGesture), ...candidateGestures];
  const session = sessionRecord(value);
  const sessionId = stringValue(session.sessionId);
  if (sessionId.length === 0) throw new TypeError("sessionIdがありません。");
  const summary = requiredRecord(value.summary, "P1集計がありません。");
  const byGesture = requiredRecord(summary.byGesture, "ジェスチャー集計がありません。");
  const gestures = createEmptyGestureSummaries();
  for (const gesture of sessionGestures) {
    gestures[gesture] = parseGestureSummary(
      byGesture[gesture],
      gesture,
      findings,
      CANDIDATE_GESTURES.includes(gesture),
    );
  }
  const protocol = isRecord(value.protocol) ? value.protocol : {};
  const protocolId = parseProtocolId(schemaVersion, protocol, thirdGesture, findings);
  if (schemaVersion === 5) validateFiveGestureRecords(protocol, protocolId, findings);
  const expectedTotal = sessionGestures.length * TRIALS_PER_GESTURE;
  const completed = finiteNumber(protocol.completed) ?? sumGesture(gestures, "completed", sessionGestures);
  const total = finiteNumber(protocol.total) ?? expectedTotal;
  validateProtocol(
    protocol,
    completed,
    total,
    expectedTotal,
    sessionGestures,
    gestures,
    countValue(summary.falseTriggers),
    findings,
  );
  validatePrivacy(value, schemaVersion, findings);

  const technical = isRecord(value.technicalSnapshot) ? value.technicalSnapshot : {};
  const appBuildId = stringValue(technical.appBuildId) || stringValue(session.appVersion);
  const experimentProfileId = stringValue(technical.experimentProfileId);
  if (appBuildId.length === 0) {
    findings.push(finding("build-missing", "warning", "アプリのビルドIDがありません。"));
  }
  if (experimentProfileId.length === 0) {
    findings.push(finding("profile-missing", "warning", "実験プロファイルIDがありません。旧形式の結果として比較します。"));
  }
  if (schemaVersion === 2) {
    findings.push(finding("legacy-schema", "warning", "データ形式がv2です。プロファイル／実カメラ設定が不足する場合があります。"));
  }
  const requestedConfigurationComplete = [
    technical.requestedCameraWidth,
    technical.requestedCameraHeight,
    technical.requestedFrameRateMin,
    technical.requestedFrameRateIdeal,
  ].every((item) => finiteNumber(item) !== null)
    && stringValue(technical.requestedDelegate).length > 0
    && stringValue(technical.requestedModelId).length > 0;
  const actualConfigurationComplete = [
    technical.actualCameraWidth,
    technical.actualCameraHeight,
    technical.actualCameraFrameRate,
  ].every((item) => finiteNumber(item) !== null)
    && stringValue(technical.delegate).length > 0
    && stringValue(technical.modelId).length > 0;
  if (schemaVersion >= 3 && (!requestedConfigurationComplete || !actualConfigurationComplete)) {
    findings.push(finding(
      "configuration-missing",
      "warning",
      "要求設定またはブラウザが選んだ実設定の記録が不足しています。",
    ));
  }

  const trackingHz = nullableFinite(technical.trackingHz);
  const inferenceP95Ms = nullableFinite(technical.inferenceP95Ms);
  const frameAgeP95Ms = nullableFinite(technical.frameAgeP95Ms);
  const twoHandCoverage = nullableFinite(technical.twoHandCoverage);
  if (trackingHz === null || frameAgeP95Ms === null || twoHandCoverage === null) {
    findings.push(finding(
      "technical-missing",
      "warning",
      "追跡出力Hz、フレームの古さp95、両手検出率のいずれかが未計測です。",
    ));
  }
  if (trackingHz !== null && trackingHz < 15) {
    findings.push(finding(
      "tracking-hz-low",
      "warning",
      `追跡出力が15Hz未満です（${formatNumber(trackingHz)}Hz）。`,
    ));
  }
  if (frameAgeP95Ms !== null && frameAgeP95Ms > 140) {
    findings.push(finding(
      "frame-age-high",
      "warning",
      `フレームの古さp95が140msを超えています（${formatNumber(frameAgeP95Ms)}ms）。`,
    ));
  }
  const inFlight = nullableFinite(technical.inFlightFrames);
  const pending = nullableFinite(technical.pendingFrames);
  if ((inFlight !== null && inFlight > 1) || (pending !== null && pending > 1)) {
    findings.push(finding("queue-unbounded", "error", "保存時点で「処理中」または「次に処理」が1を超えています。"));
  }

  const requestedDelegate = stringValue(technical.requestedDelegate);
  const actualDelegate = stringValue(technical.delegate);
  const delegateFallback = requestedDelegate.length > 0 && actualDelegate.length > 0 && requestedDelegate !== actualDelegate;
  if (delegateFallback) {
    findings.push(finding(
      "delegate-fallback",
      "warning",
      `手の認識処理が要求した${requestedDelegate}ではなく${actualDelegate}で動きました。通常の${requestedDelegate}の実測と同じ条件にせず、合否候補にしません。`,
    ));
  }

  const dataComplete = findings.every(({ severity }) => severity !== "error");
  // Lift and Spotlight are candidates. Only the three current inputs form the P1-Controlled starting criterion.
  const controlledCriterionCandidate = dataComplete
    && !delegateFallback
    && !findings.some(({ code }) => FIVE_GESTURE_RECORD_FINDINGS.includes(code))
    && appBuildId.length > 0
    && experimentProfileId.length > 0
    && requestedConfigurationComplete
    && actualConfigurationComplete
    && trackingHz !== null
    && frameAgeP95Ms !== null
    && twoHandCoverage !== null
    && comparisonGestures(thirdGesture).every((gesture) => gestures[gesture].success >= 8);
  return {
    fileName,
    schemaVersion,
    protocolId,
    sessionId,
    createdAtIso: stringValue(value.createdAtIso) || stringValue(session.createdAtIso),
    appBuildId,
    experimentProfileId,
    userAgent: stringValue(technical.userAgent),
    viewport: stringValue(technical.viewport),
    requestedCamera: cameraLabel(
      nullableFinite(technical.requestedCameraWidth),
      nullableFinite(technical.requestedCameraHeight),
      nullableFinite(technical.requestedFrameRateMin),
      nullableFinite(technical.requestedFrameRateIdeal),
    ),
    actualCamera: cameraLabel(
      nullableFinite(technical.actualCameraWidth),
      nullableFinite(technical.actualCameraHeight),
      nullableFinite(technical.actualCameraFrameRate),
      nullableFinite(technical.actualCameraFrameRate),
    ),
    requestedDelegate,
    actualDelegate,
    requestedModelId: stringValue(technical.requestedModelId),
    actualModelId: stringValue(technical.modelId),
    completed,
    total,
    thirdGesture,
    candidateGestures,
    gestures,
    trackingHz,
    inferenceP95Ms,
    frameAgeP95Ms,
    twoHandCoverage,
    findings,
    dataComplete,
    controlledCriterionCandidate,
  };
}

export function compareP1Sessions(
  sessions: readonly P1ComparisonSession[],
): P1ComparisonResult {
  const findings: P1ComparisonFinding[] = [];
  if (sessions.length === 0) {
    return {
      sessions: [],
      findings: [finding("no-sessions", "info", "比較するP1結果JSONを追加してください。")],
      nextAction: "AndroidとiPhoneのP1結果JSONを追加する",
      controlledCriterionCandidate: false,
    };
  }
  const complete = sessions.filter(({ dataComplete }) => dataComplete);
  const buildIds = distinctNonEmpty(sessions.map(({ appBuildId }) => appBuildId));
  const profileIds = distinctNonEmpty(sessions.map(({ experimentProfileId }) => experimentProfileId));
  // A procedure is the ID with its schema version and trial count, so a wrong ID cannot merge 30 and 50 trials.
  const protocolIds = distinctNonEmpty(sessions.map(protocolLabel));
  const delegates = distinctNonEmpty(sessions.map(({ actualDelegate }) => actualDelegate));
  const sessionIds = sessions.map(({ sessionId }) => sessionId);
  const duplicateIds = distinctNonEmpty(sessionIds.filter((id, index) => sessionIds.indexOf(id) !== index));
  const distinctSessionCount = new Set(sessionIds).size;
  const userAgents = sessions.map(({ userAgent }) => userAgent);
  const sameDeviceSuspected = distinctSessionCount >= 2
    && userAgents.every((agent) => agent.length > 0)
    && new Set(userAgents).size === 1;
  if (buildIds.length > 1) {
    findings.push(finding(
      "mixed-builds",
      "warning",
      `ビルドが混在しています（${buildIds.join(" / ")}）。同一条件のP1合格結果としてまとめません。`,
    ));
  }
  if (profileIds.length > 1) {
    findings.push(finding(
      "mixed-profiles",
      "warning",
      `プロファイルが混在しています（${profileIds.join(" / ")}）。性能比較として扱い、同一条件の結果へまとめません。`,
    ));
  }
  const thirdGestures = distinctNonEmpty(sessions.map(({ thirdGesture }) => thirdGesture));
  if (thirdGestures.length > 1) {
    findings.push(finding(
      "mixed-third-gestures",
      "warning",
      "旧clapセッションと新Bloomセッションが混在しています。第三入力の合否候補を同じ条件へまとめません。",
    ));
  }
  if (protocolIds.length > 1) {
    findings.push(finding(
      "mixed-protocols",
      "warning",
      `試験手順が混在しています（${protocolIds.join(" / ")}）。Bloomの準備完了待ちの有無なども異なるため、同じ条件の結果へまとめません。`,
    ));
  }
  if (delegates.length > 1) {
    findings.push(finding(
      "mixed-delegates",
      "warning",
      `手の認識処理が混在しています（${delegates.join(" / ")}）。CPUに切り替わった結果はGPUの結果と同じ条件にまとめません。`,
    ));
  }
  if (duplicateIds.length > 0) {
    findings.push(finding(
      "duplicate-sessions",
      "warning",
      `同じsessionIdのファイルが複数あります（${duplicateIds.join(" / ")}）。同じ試験を2回保存したものとして1件に数えます。`,
    ));
  }
  if (sameDeviceSuspected) {
    findings.push(finding(
      "same-device-suspected",
      "warning",
      "すべてのセッションで端末情報（userAgent）が同じです。同じ端末の結果だけの可能性があるため、合否候補にしません。別の対象端末の結果を加えてください。",
    ));
  }
  if (complete.length < sessions.length) {
    findings.push(finding(
      "incomplete-sessions",
      "error",
      `${sessions.length - complete.length}件のセッションに整合性エラーがあります。`,
    ));
  }
  const candidateSessions = sessions.filter(({ controlledCriterionCandidate }) => controlledCriterionCandidate);
  const hasComparableMetadata = sessions.every(({ appBuildId, experimentProfileId }) => (
    appBuildId.length > 0 && experimentProfileId.length > 0
  ));
  const sameConditions = hasComparableMetadata
    && buildIds.length === 1
    && profileIds.length === 1
    && thirdGestures.length === 1
    && protocolIds.length === 1
    && delegates.length <= 1;
  const controlledCriterionCandidate = distinctSessionCount >= 2
    && candidateSessions.length === sessions.length
    && sameConditions
    && !sameDeviceSuspected;
  if (controlledCriterionCandidate) {
    findings.push(finding(
      "controlled-candidate",
      "info",
      "2件以上の完全な同一条件セッションで3入力（エアタップ・リボンスワイプ・第三入力）が8/10以上です。対象端末／テスター、手動分類、同期感を確認して最終判定してください。",
    ));
  } else if (candidateSessions.length > 0) {
    findings.push(finding(
      "partial-controlled-candidate",
      "info",
      `${candidateSessions.length}件は3入力8/10以上ですが、自動的に合格とは判定しません。`,
    ));
  }
  if (sessions.some(({ candidateGestures }) => candidateGestures.length > 0)) {
    findings.push(finding(
      "candidate-gestures",
      "info",
      "Lift／Spotlightは候補動作です。8/10以上でもP1合否の条件には含めず、Interaction POCへ持ち込む動作を選ぶ材料として比べます。",
    ));
  }

  return {
    sessions: [...sessions],
    findings,
    nextAction: chooseNextAction(sessions, findings),
    controlledCriterionCandidate,
  };
}

export class P1SessionComparisonController {
  readonly #input: HTMLInputElement;
  readonly #clearButton: HTMLButtonElement;
  readonly #status: HTMLElement;
  readonly #body: HTMLElement;
  readonly #findings: HTMLElement;
  readonly #sessions = new Map<string, P1ComparisonSession>();

  constructor(root: HTMLElement) {
    this.#input = requiredElement(root, "#p1-comparison-import", HTMLInputElement);
    this.#clearButton = requiredElement(root, "#p1-comparison-clear", HTMLButtonElement);
    this.#status = requiredElement(root, "#p1-comparison-status", HTMLElement);
    this.#body = requiredElement(root, "#p1-comparison-body", HTMLElement);
    this.#findings = requiredElement(root, "#p1-comparison-findings", HTMLElement);
    this.#input.addEventListener("change", this.#import);
    this.#clearButton.addEventListener("click", this.#clear);
    this.#render();
  }

  readonly #import = async (): Promise<void> => {
    const files = [...(this.#input.files ?? [])];
    const importErrors: string[] = [];
    const notices: string[] = [];
    for (const file of files) {
      try {
        const session = parseP1SessionForComparison(await file.text(), file.name);
        const existing = this.#sessions.get(session.sessionId);
        // A session saved twice is one session: the more complete file, or else the later one, is compared.
        if (existing !== undefined) {
          notices.push(`${file.name}: ${session.sessionId}は読込済みです。試行数の多い方（同じなら後で保存した方）だけを比較します。`);
        }
        this.#sessions.set(session.sessionId, existing === undefined ? session : preferredSession(existing, session));
      } catch (error) {
        importErrors.push(`${file.name}: ${describeError(error)}`);
      }
    }
    this.#input.value = "";
    this.#render(importErrors, notices);
  };

  readonly #clear = (): void => {
    this.#sessions.clear();
    this.#render();
  };

  #render(importErrors: readonly string[] = [], notices: readonly string[] = []): void {
    const result = compareP1Sessions([...this.#sessions.values()]);
    this.#body.replaceChildren(...result.sessions.map(renderSessionRow));
    this.#findings.replaceChildren();
    for (const session of result.sessions) {
      for (const item of session.findings) {
        this.#findings.append(renderFinding(`${session.sessionId}: ${item.message}`, item.severity));
      }
    }
    for (const item of result.findings) {
      this.#findings.append(renderFinding(item.message, item.severity));
    }
    for (const message of importErrors) {
      this.#findings.append(renderFinding(message, "error"));
    }
    for (const message of notices) {
      this.#findings.append(renderFinding(message, "info"));
    }
    this.#findings.append(renderFinding(`次の一手: ${result.nextAction}`, "info"));
    this.#status.textContent = result.sessions.length === 0
      ? "0セッション"
      : `${result.sessions.length}セッション · 完全 ${result.sessions.filter(({ dataComplete }) => dataComplete).length} · 8/10候補 ${result.sessions.filter(({ controlledCriterionCandidate }) => controlledCriterionCandidate).length}`;
    this.#status.dataset.candidate = String(result.controlledCriterionCandidate);
    this.#clearButton.disabled = result.sessions.length === 0;
  }
}

function parseGestureSummary(
  value: unknown,
  gesture: P1ComparisonGesture,
  findings: P1ComparisonFinding[],
  candidate: boolean,
): P1ComparisonGestureSummary {
  if (!isRecord(value)) throw new TypeError(`${gesture}の集計がありません。`);
  const summary = {
    completed: countValue(value.completed),
    success: countValue(value.success),
    playerMiss: countValue(value.playerMiss),
    machineMiss: countValue(value.machineMiss),
    trackingLoss: countValue(value.trackingLoss),
    unclassified: countValue(value.unclassified),
    falseTrigger: countValue(value.falseTrigger),
  };
  const outcomeTotal = summary.success
    + summary.playerMiss
    + summary.machineMiss
    + summary.trackingLoss
    + summary.unclassified;
  if (summary.completed !== TRIALS_PER_GESTURE) {
    findings.push(finding(`${gesture}-count`, "error", `${gesture}が10試行ではありません（${summary.completed}件）。`));
  }
  if (outcomeTotal !== summary.completed) {
    findings.push(finding(
      `${gesture}-outcome-total`,
      "error",
      `${gesture}のoutcome合計${outcomeTotal}件とcompleted ${summary.completed}件が一致しません。`,
    ));
  }
  if (summary.success < 8) {
    findings.push(candidate
      ? finding(
        `${gesture}-candidate-under-8`,
        "info",
        `候補動作${gestureLabel(gesture)}のsuccessは${summary.success}/10です。採否判断の材料として記録します。`,
      )
      : finding(
        `${gesture}-under-controlled`,
        "warning",
        `${gesture}のsuccessが8/10未満です（${summary.success}/10）。`,
      ));
  }
  return summary;
}

function validateProtocol(
  protocol: Record<string, unknown>,
  completed: number,
  total: number,
  expectedTotal: number,
  sessionGestures: readonly P1ComparisonGesture[],
  summaries: Readonly<Record<P1ComparisonGesture, P1ComparisonGestureSummary>>,
  summaryFalseTriggers: number,
  findings: P1ComparisonFinding[],
): void {
  if (completed !== expectedTotal || total !== expectedTotal) {
    findings.push(finding(
      "protocol-count",
      "error",
      `P1進捗が${expectedTotal}/${expectedTotal}ではありません（${completed}/${total}）。`,
    ));
  }
  if (!Array.isArray(protocol.results)) {
    findings.push(finding("results-missing", "error", "trial results配列がないため集計を検証できません。"));
    return;
  }
  if (protocol.results.length !== completed) {
    findings.push(finding(
      "result-count",
      "error",
      `results ${protocol.results.length}件とcompleted ${completed}件が一致しません。`,
    ));
  }

  const derived = createEmptyGestureCounts();
  const ordinals: number[] = [];
  for (const [index, result] of protocol.results.entries()) {
    if (!isRecord(result) || !isRecord(result.trial)) {
      findings.push(finding("trial-result-invalid", "error", `result ${index + 1}のtrial情報が不正です。`));
      continue;
    }
    const ordinal = finiteNumber(result.trial.ordinal);
    if (ordinal !== null && Number.isInteger(ordinal)) ordinals.push(ordinal);
    const gesture = comparisonGesture(result.trial.gesture, sessionGestures);
    const outcome = comparisonOutcome(result.outcome);
    if (gesture === null || outcome === null) {
      findings.push(finding(
        "trial-result-invalid",
        "error",
        `result ${index + 1}のgestureまたはoutcomeが不正です。`,
      ));
      continue;
    }
    derived[gesture].completed += 1;
    derived[gesture][outcome] += 1;
  }
  if (ordinals.length !== protocol.results.length) {
    findings.push(finding("trial-ordinal-missing", "error", "有効なtrial ordinalがないresultがあります。"));
  }
  if (new Set(ordinals).size !== ordinals.length) {
    findings.push(finding("duplicate-trial", "error", "重複するtrial ordinalがあります。"));
  }

  validateFalseTriggers(protocol.falseTriggers, derived, summaryFalseTriggers, findings, sessionGestures);
  for (const gesture of sessionGestures) {
    const mismatches = SUMMARY_RESULT_FIELDS.filter((field) => (
      summaries[gesture][field] !== derived[gesture][field]
    ));
    if (mismatches.length > 0) {
      findings.push(finding(
        `${gesture}-summary-results-mismatch`,
        "error",
        `${gesture}のsummaryとresultsが一致しません（${mismatches.join(", ")}）。`,
      ));
    }
  }
}

const SUMMARY_RESULT_FIELDS = [
  "completed",
  "success",
  "playerMiss",
  "machineMiss",
  "trackingLoss",
  "unclassified",
  "falseTrigger",
] as const satisfies readonly (keyof P1ComparisonGestureSummary)[];

type ComparisonOutcomeField = Exclude<
  (typeof SUMMARY_RESULT_FIELDS)[number],
  "completed" | "falseTrigger"
>;

type MutableGestureCounts = Record<
  P1ComparisonGesture,
  Record<(typeof SUMMARY_RESULT_FIELDS)[number], number>
>;

function createEmptyGestureCounts(): MutableGestureCounts {
  return Object.fromEntries(ALL_GESTURES.map((gesture) => [
    gesture,
    {
      completed: 0,
      success: 0,
      playerMiss: 0,
      machineMiss: 0,
      trackingLoss: 0,
      unclassified: 0,
      falseTrigger: 0,
    },
  ])) as MutableGestureCounts;
}

function comparisonGesture(
  value: unknown,
  allowed: readonly P1ComparisonGesture[],
): P1ComparisonGesture | null {
  return typeof value === "string" && allowed.includes(value as P1ComparisonGesture)
    ? value as P1ComparisonGesture
    : null;
}

function comparisonOutcome(value: unknown): ComparisonOutcomeField | null {
  return {
    success: "success",
    "player-miss": "playerMiss",
    "machine-miss": "machineMiss",
    "tracking-loss": "trackingLoss",
    unclassified: "unclassified",
  }[typeof value === "string" ? value : ""] as ComparisonOutcomeField | undefined ?? null;
}

function validateFalseTriggers(
  value: unknown,
  derived: MutableGestureCounts,
  summaryFalseTriggers: number,
  findings: P1ComparisonFinding[],
  allowed: readonly P1ComparisonGesture[],
): void {
  if (!Array.isArray(value)) {
    findings.push(finding("false-triggers-missing", "error", "falseTriggers配列がないため集計を検証できません。"));
    return;
  }
  let validCount = 0;
  for (const [index, event] of value.entries()) {
    const gesture = isRecord(event) ? comparisonGesture(event.gestureType, allowed) : null;
    if (gesture === null) {
      findings.push(finding("false-trigger-invalid", "error", `false trigger ${index + 1}のgestureが不正です。`));
      continue;
    }
    derived[gesture].falseTrigger += 1;
    validCount += 1;
  }
  if (summaryFalseTriggers !== validCount) {
    findings.push(finding(
      "false-trigger-summary-mismatch",
      "error",
      `false triggerのsummary ${summaryFalseTriggers}件とevents ${validCount}件が一致しません。`,
    ));
  }
}

function validatePrivacy(
  document: Record<string, unknown>,
  schemaVersion: P1SchemaVersion,
  findings: P1ComparisonFinding[],
): void {
  const privacy = isRecord(document.privacy) ? document.privacy : null;
  if (privacy === null
    || privacy.includesCameraFrames !== false
    || privacy.includesAudio !== false) {
    findings.push(finding("raw-media-privacy", "error", "生映像・生音声を含まないprivacy宣言を確認できません。"));
  }
  if (schemaVersion >= 3 && privacy?.includesReplayFrames !== false) {
    findings.push(finding("replay-privacy", "error", `schema v${schemaVersion}標準結果のreplay frame非同梱を確認できません。`));
  }
}

function chooseNextAction(
  sessions: readonly P1ComparisonSession[],
  findings: readonly P1ComparisonFinding[],
): string {
  if (sessions.some((session) => session.findings.some(({ severity }) => severity === "error"))) {
    return "整合性エラーのあるセッションを再保存または再試験する";
  }
  if (findings.some(({ code }) => code === "mixed-third-gestures")) {
    return "旧clapと新Bloomのセッションを分け、同じ第三入力どうしで比較する";
  }
  if (findings.some(({ code }) => code === "mixed-protocols")) {
    return "3入力・30試行と5動作・50試行を分け、同じ試験手順のセッションどうしで比較する";
  }
  if (sessions.some((session) => session.findings.some(({ code }) => (
    code === "tracking-hz-low" || code === "frame-age-high"
  )))) {
    return "ジェスチャー閾値より先にMediaPipe処理負荷を一項目だけ比較する";
  }
  const thirdGesture = sessions[0]?.thirdGesture ?? "bloom";
  const lowest = comparisonGestures(thirdGesture)
    .map((gesture) => ({
      gesture,
      success: Math.min(...sessions.map((session) => session.gestures[gesture].success)),
    }))
    .sort((a, b) => a.success - b.success)[0];
  if (lowest !== undefined && lowest.success < 8) {
    return `${gestureLabel(lowest.gesture)}の失敗理由を確認し、画角・ガイド・状態機械から一項目だけ選ぶ`;
  }
  if (findings.some(({ code }) => code === "mixed-delegates")
    || sessions.some((session) => session.findings.some(({ code }) => code === "delegate-fallback"))) {
    return "手の認識処理がCPUへ切り替わった原因を確認し、要求どおりの処理で測り直す";
  }
  if (findings.some(({ code }) => code === "mixed-builds" || code === "mixed-profiles")) {
    return "同じビルドとプロファイルのセッションを揃える";
  }
  if (sessions.some((session) => session.findings.some(({ code }) => (
    code === "build-missing" || code === "profile-missing"
  )))) {
    return "ビルドとプロファイルを記録できるデータ形式v4以降でセッションを揃える";
  }
  if (sessions.some((session) => session.findings.some(({ code }) => FIVE_GESTURE_RECORD_FINDINGS.includes(code)))) {
    return "試験手順の記録が合わないセッションを、現行の画面で測り直す";
  }
  if (new Set(sessions.map(({ sessionId }) => sessionId)).size < 2) {
    // The current app runs only the five-gesture, 50-trial procedure.
    return sessions.every(({ schemaVersion }) => schemaVersion < 5)
      ? "現行の5動作・50試行で、両方の対象端末を同じビルドとプロファイルで測る"
      : "もう一方の対象端末／テスターで同じビルドとプロファイルの50試行を行う";
  }
  if (findings.some(({ code }) => code === "same-device-suspected")) {
    return "別の対象端末（AndroidとiPhoneなど）で同じビルドとプロファイルの50試行を行う";
  }
  return "対象端末／テスター、手動分類、同期感を確認して合格／要改善／方針転換を記録する";
}

function renderSessionRow(session: P1ComparisonSession): HTMLTableRowElement {
  const row = document.createElement("tr");
  row.dataset.complete = String(session.dataComplete);
  const candidate = (gesture: P1ComparisonGesture): string => (
    session.candidateGestures.includes(gesture) ? `${session.gestures[gesture].success}/10` : "—"
  );
  const values = [
    session.sessionId,
    `v${session.schemaVersion} / ${session.appBuildId || "ビルド不明"}`,
    session.experimentProfileId || "プロファイル不明",
    `${session.completed}/${session.total}`,
    `${session.gestures["air-tap"].success}/10`,
    `${session.gestures["ribbon-swipe"].success}/10`,
    `${gestureLabel(session.thirdGesture)} ${session.gestures[session.thirdGesture].success}/10`,
    candidate("lift"),
    candidate("spotlight"),
    metric(session.trackingHz, "Hz"),
    metric(session.frameAgeP95Ms, "ms"),
    percent(session.twoHandCoverage),
    session.dataComplete ? "整合" : "要確認",
  ];
  for (const value of values) {
    const cell = document.createElement("td");
    cell.textContent = value;
    row.append(cell);
  }
  row.title = [
    session.fileName,
    session.protocolId,
    session.viewport,
    session.requestedCamera,
    session.actualCamera,
    `${session.requestedDelegate || "—"} → ${session.actualDelegate || "—"}`,
  ].join(" · ");
  return row;
}

function renderFinding(message: string, severity: FindingSeverity): HTMLLIElement {
  const item = document.createElement("li");
  item.textContent = message;
  item.dataset.severity = severity;
  return item;
}

function gestureLabel(gesture: P1ComparisonGesture): string {
  return {
    "air-tap": "エアタップ",
    "ribbon-swipe": "リボンスワイプ",
    clap: "クラップ／ニアクラップ",
    bloom: "Bloom",
    lift: "Lift",
    spotlight: "Spotlight",
  }[gesture];
}

function finding(
  code: string,
  severity: FindingSeverity,
  message: string,
): P1ComparisonFinding {
  return { code, severity, message };
}

function sessionRecord(document: Record<string, unknown>): Record<string, unknown> {
  if (isRecord(document.session)) return document.session;
  if (isRecord(document.replay) && isRecord(document.replay.session)) return document.replay.session;
  throw new TypeError("P1 session metadataがありません。");
}

function requiredRecord(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(message);
  return value;
}

function sumGesture(
  gestures: Readonly<Record<P1ComparisonGesture, P1ComparisonGestureSummary>>,
  key: keyof P1ComparisonGestureSummary,
  sessionGestures: readonly P1ComparisonGesture[],
): number {
  return sessionGestures.reduce((sum, gesture) => sum + gestures[gesture][key], 0);
}

function parseThirdGesture(
  document: Record<string, unknown>,
  schemaVersion: P1SchemaVersion,
  findings: P1ComparisonFinding[],
): P1ThirdGesture {
  if (schemaVersion === 2 || schemaVersion === 3) return "clap";
  const vocabulary = requiredRecord(document.gestureVocabulary, `schema v${schemaVersion}のgestureVocabularyがありません。`);
  if (vocabulary.thirdGesture !== "bloom") {
    findings.push(finding("gesture-vocabulary-invalid", "error", `schema v${schemaVersion}の第三入力がBloomではありません。`));
    throw new TypeError(`schema v${schemaVersion}の第三入力が不正です。`);
  }
  return "bloom";
}

function parseCandidateGestures(
  document: Record<string, unknown>,
  schemaVersion: P1SchemaVersion,
  findings: P1ComparisonFinding[],
): readonly P1ComparisonGesture[] {
  if (schemaVersion !== 5) return [];
  const vocabulary = isRecord(document.gestureVocabulary) ? document.gestureVocabulary : {};
  const listed: readonly unknown[] = Array.isArray(vocabulary.gestures) ? vocabulary.gestures : [];
  const candidates = CANDIDATE_GESTURES.filter((gesture) => listed.includes(gesture));
  if (candidates.length !== CANDIDATE_GESTURES.length) {
    findings.push(finding(
      "gesture-vocabulary-candidates",
      "error",
      "schema v5の動作一覧にLiftとSpotlightがそろっていません。",
    ));
  }
  return candidates;
}

function parseProtocolId(
  schemaVersion: P1SchemaVersion,
  protocol: Record<string, unknown>,
  thirdGesture: P1ThirdGesture,
  findings: P1ComparisonFinding[],
): string {
  if (schemaVersion !== 5) return P1_LEGACY_PROTOCOL_IDS[thirdGesture];
  const id = stringValue(protocol.id);
  if (id.length === 0) {
    findings.push(finding("protocol-id-missing", "error", "schema v5の試験手順ID（protocol.id）がありません。"));
    return "unknown";
  }
  return id;
}

function protocolLabel(session: P1ComparisonSession): string {
  return `${session.protocolId}（v${session.schemaVersion}・${session.total}試行）`;
}

function preferredSession(existing: P1ComparisonSession, incoming: P1ComparisonSession): P1ComparisonSession {
  if (existing.completed !== incoming.completed) return incoming.completed > existing.completed ? incoming : existing;
  return incoming.createdAtIso >= existing.createdAtIso ? incoming : existing;
}

/** Schema v5 records the procedure itself; a record that does not match the five-gesture procedure is flagged. */
function validateFiveGestureRecords(
  protocol: Record<string, unknown>,
  protocolId: string,
  findings: P1ComparisonFinding[],
): void {
  if (protocolId !== P1_FIVE_GESTURE_PROTOCOL_ID && protocolId !== "unknown") {
    findings.push(finding(
      "protocol-id-unknown",
      "warning",
      `schema v5の試験手順ID（${protocolId}）が5動作・50試行（${P1_FIVE_GESTURE_PROTOCOL_ID}）ではありません。合否候補にしません。`,
    ));
  }
  const trialsPerGesture = finiteNumber(protocol.trialsPerGesture);
  if (trialsPerGesture !== TRIALS_PER_GESTURE) {
    findings.push(finding(
      "trials-per-gesture",
      "warning",
      `各動作の試行数（trialsPerGesture）が10ではありません（${trialsPerGesture ?? "記録なし"}）。`,
    ));
  }
  const blocks: readonly unknown[] = Array.isArray(protocol.blocks) ? protocol.blocks : [];
  const recordedBlocks = blocks.filter((block) => (
    isRecord(block) && finiteNumber(block.startedAtMs) !== null && finiteNumber(block.finishedAtMs) !== null
  )).length;
  if (blocks.length !== 5 || recordedBlocks !== 5) {
    findings.push(finding(
      "v5-blocks-incomplete",
      "warning",
      `5ブロックの開始と終了の記録がそろっていません（${recordedBlocks} / 5）。`,
    ));
  }
  const results: readonly unknown[] = Array.isArray(protocol.results) ? protocol.results : [];
  if (results.some((result) => !isRecord(result) || countValue(result.attempt) < 1)) {
    findings.push(finding("v5-attempt-missing", "warning", "何回目の試みか（attempt）の記録がない試行結果があります。"));
  }
  const variants = results.flatMap((result) => (
    isRecord(result) && isRecord(result.trial) && result.trial.gesture === "spotlight" ? [result.trial.spotlightVariant] : []
  ));
  const leftUp = variants.filter((variant) => variant === "left-up-right-down").length;
  const rightUp = variants.filter((variant) => variant === "right-up-left-down").length;
  if (leftUp !== 5 || rightUp !== 5) {
    findings.push(finding(
      "v5-spotlight-variants",
      "warning",
      `Spotlightの上下の割り当てが5回ずつではありません（左手上 ${leftUp}回・右手上 ${rightUp}回）。`,
    ));
  }
}

function comparisonGestures(thirdGesture: P1ThirdGesture): readonly P1ComparisonGesture[] {
  return [...BASE_GESTURES, thirdGesture];
}

function createEmptyGestureSummaries(): Record<P1ComparisonGesture, P1ComparisonGestureSummary> {
  return Object.fromEntries(ALL_GESTURES.map((gesture) => [gesture, emptyGestureSummary()])) as Record<P1ComparisonGesture, P1ComparisonGestureSummary>;
}

function emptyGestureSummary(): P1ComparisonGestureSummary {
  return {
    completed: 0,
    success: 0,
    playerMiss: 0,
    machineMiss: 0,
    trackingLoss: 0,
    unclassified: 0,
    falseTrigger: 0,
  };
}

function countValue(value: unknown): number {
  const count = finiteNumber(value);
  return count !== null && count >= 0 && Number.isInteger(count) ? count : 0;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nullableFinite(value: unknown): number | null {
  return value === null || value === undefined ? null : finiteNumber(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cameraLabel(
  width: number | null,
  height: number | null,
  minimumFps: number | null,
  idealFps: number | null,
): string {
  if (width === null || height === null) return "—";
  const fps = minimumFps === null || idealFps === null
    ? ""
    : minimumFps === idealFps
      ? ` @ ${formatNumber(idealFps)}fps`
      : ` @ ${formatNumber(minimumFps)}–${formatNumber(idealFps)}fps`;
  return `${formatNumber(width)}×${formatNumber(height)}${fps}`;
}

function distinctNonEmpty(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function metric(value: number | null, suffix: string): string {
  return value === null ? "—" : `${formatNumber(value)}${suffix}`;
}

function percent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requiredElement<T extends Element>(
  root: ParentNode,
  selector: string,
  constructor: { new (): T },
): T {
  const element = root.querySelector(selector);
  if (!(element instanceof constructor)) throw new Error(`Required element not found: ${selector}`);
  return element;
}
