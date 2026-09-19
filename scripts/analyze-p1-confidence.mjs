// Offline calibration helper for docs/15 (A1: confidence-tiered feedback).
// Reads saved P1 session JSON files and reports, per gesture:
//   - how the current `confidence` values are distributed,
//   - how the recorded `quality` factors are distributed against today's thresholds,
//   - which feedback tier the proposed margin-based confidence would give,
//   - how rejections would split into "soft" and "silent" feedback.
// It never changes a session file and is not part of the app build (the build ID hashes src/ only).
//
// Usage: node scripts/analyze-p1-confidence.mjs <p1-session.json> [more.json ...]

import { readFileSync } from "node:fs";
import { basename } from "node:path";

/** Tier boundary proposed in docs/15 section 4.3. */
const FULL_TIER_MINIMUM = 0.6;
/** Rejection records of one reason closer together than this are one continuous burst. */
const BURST_GAP_MS = 150;
/** "comfortable" is placed at these quantiles of the observed successes (lenient, middle, strict). */
const STRICTNESS = [0.25, 0.5, 0.75];

// Thresholds copied from the DEFAULTS of src/gestures/*-state-machine.ts on 2026-09-19.
// `bound: "min"` means the value must reach the threshold; "max" means it must stay below it.
const FACTORS = {
  "ribbon-swipe": [
    { key: "pathDistance", bound: "min", threshold: 0.28 },
    { key: "perpendicularError", bound: "max", threshold: 0.18 },
  ],
  bloom: [
    { key: "outwardDistance", bound: "min", threshold: 0.16 },
    { key: "upwardDistance", bound: "min", threshold: 0.08 },
    { key: "syncSpreadMs", bound: "max", threshold: 420 },
  ],
  lift: [
    { key: "upwardDistance", bound: "min", threshold: 0.18 },
    { key: "syncSpreadMs", bound: "max", threshold: 420 },
  ],
  spotlight: [{ key: "holdDurationMs", bound: "min", threshold: 300 }],
  "air-tap": [],
};

// docs/15 section 4.4. Every other reason code is "silent"; tracking-lost is handled outside the tiers.
const SOFT_REASONS = new Set([
  "off-axis",
  "bloom-outward-distance-insufficient",
  "bloom-upward-distance-insufficient",
  "bloom-sync-expired",
  "lift-distance-insufficient",
  "lift-sync-expired",
  "spotlight-pose-not-held",
]);

const clamp01 = (value) => Math.min(1, Math.max(0, value));

function quantile(values, q) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function format(value, digits = 3) {
  return value === null || value === undefined ? "—" : Number(value).toFixed(digits);
}

function summary(values, digits = 3) {
  if (values.length === 0) return "記録なし";
  return [0, 0.25, 0.5, 0.75, 1].map((q) => format(quantile(values, q), digits)).join(" / ");
}

/** Goodness grows as the factor gets safer, for both kinds of bound. */
function goodness(factor, value) {
  return factor.bound === "min" ? value - factor.threshold : factor.threshold - value;
}

function margin(factor, value, comfortableGoodness) {
  const good = goodness(factor, value);
  if (comfortableGoodness <= 0) return good >= 0 ? 1 : 0;
  return clamp01(good / comfortableGoodness);
}

function gestureOfTrialId(trialId) {
  return Object.keys(FACTORS).find((gesture) => trialId.startsWith(`${gesture}-`)) ?? "unknown";
}

function collectRejections(document) {
  if (Array.isArray(document.trialDiagnostics)) {
    return document.trialDiagnostics
      .filter((record) => record.kind === "rejection")
      // schema v6 folds consecutive identical records into one with `count`; unfold it so counts match v5.
      .flatMap((record) => Array.from({ length: Math.max(1, record.count ?? 1) }, () => ({
        gesture: gestureOfTrialId(record.trialId),
        trialId: record.trialId,
        timeMs: record.timeMs,
        reasons: record.reasonCodes,
      })));
  }
  // schema v2 kept rejections at the top level without a trial id.
  return (document.rejections ?? []).map((record) => ({
    gesture: record.gestureType,
    trialId: null,
    timeMs: record.timeMs,
    reasons: record.reasonCodes,
  }));
}

function countBursts(records) {
  const lastSeen = new Map();
  let bursts = 0;
  for (const record of [...records].sort((a, b) => a.timeMs - b.timeMs)) {
    for (const reason of record.reasons) {
      const key = `${record.trialId ?? ""}|${reason}`;
      const previous = lastSeen.get(key);
      if (previous === undefined || record.timeMs - previous > BURST_GAP_MS) bursts += 1;
      lastSeen.set(key, record.timeMs);
    }
  }
  return bursts;
}

function analyzeEvents(gesture, events, lines) {
  lines.push(`### ${gesture}（成功イベント ${events.length}件）`, "");
  if (events.length === 0) {
    lines.push("成功イベントがありません。", "");
    return;
  }
  const current = events.map((event) => event.confidence);
  const saturated = current.filter((value) => value >= 0.999).length;
  lines.push(
    `- 現在の \`confidence\`（最小 / p25 / p50 / p75 / 最大）: ${summary(current)}。1.0 に張り付いた件数: ${saturated}/${events.length}`,
  );

  const factors = FACTORS[gesture] ?? [];
  const usable = factors.filter((factor) => events.every((event) => typeof event.quality?.[factor.key] === "number"));
  if (usable.length === 0) {
    lines.push("- A1 の要素になる値が `quality` に記録されていないため、このファイルからは較正できません。", "");
    return;
  }
  lines.push("", "| 要素 | 条件 | 最小 / p25 / p50 / p75 / 最大 | 閾値ぎりぎり（余裕10%未満）の件数 |", "|---|---|---|---:|");
  for (const factor of usable) {
    const values = events.map((event) => event.quality[factor.key]);
    const digits = factor.key.endsWith("Ms") ? 0 : 3;
    const tight = values.filter((value) => goodness(factor, value) < Math.abs(factor.threshold) * 0.1).length;
    lines.push(
      `| \`${factor.key}\` | ${factor.bound === "min" ? "≥" : "≤"} ${factor.threshold} | ${summary(values, digits)} | ${tight} |`,
    );
  }

  lines.push("", "| comfortable の置き方 | 新しい confidence（最小 / p25 / p50 / p75 / 最大） | 全開 | 控えめ |", "|---|---|---:|---:|");
  for (const strictness of STRICTNESS) {
    const comfortable = usable.map((factor) => (
      quantile(events.map((event) => goodness(factor, event.quality[factor.key])), strictness)
    ));
    const confidences = events.map((event) => {
      const margins = usable.map((factor, index) => margin(factor, event.quality[factor.key], comfortable[index]));
      const mean = margins.reduce((total, value) => total + value, 0) / margins.length;
      return 0.6 * Math.min(...margins) + 0.4 * mean;
    });
    const full = confidences.filter((value) => value >= FULL_TIER_MINIMUM).length;
    const label = strictness === 0.5 ? "成功の中央値（計画の初期案）" : strictness < 0.5 ? "成功の下位25%点（ゆるい）" : "成功の上位25%点（きびしい）";
    lines.push(`| ${label} | ${summary(confidences)} | ${full} | ${events.length - full} |`);
  }
  lines.push("");
}

function analyzeRejections(document, lines) {
  const rejections = collectRejections(document);
  lines.push("### 拒否の振り分け", "");
  if (rejections.length === 0) {
    lines.push("拒否の記録がありません。", "");
    return;
  }
  lines.push("| 動作 | 理由 | 段階 | 記録件数 | 連続をまとめた回数 |", "|---|---|---|---:|---:|");
  const groups = new Map();
  for (const record of rejections) {
    for (const reason of record.reasons) {
      const key = `${record.gesture}|${reason}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ ...record, reasons: [reason] });
    }
  }
  for (const [key, records] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const [gesture, reason] = key.split("|");
    const tier = reason === "tracking-lost" ? "追跡切れ（段階外）" : SOFT_REASONS.has(reason) ? "控えめ" : "無音";
    lines.push(`| ${gesture} | \`${reason}\` | ${tier} | ${records.length} | ${countBursts(records)} |`);
  }
  lines.push("");

  const results = document.protocol?.results ?? [];
  const failed = results.filter((result) => result.outcome !== "success");
  if (failed.length === 0 || rejections.every((record) => record.trialId === null)) return;
  lines.push("成功しなかった試行に、控えめ段階の対象になる拒否があったか:", "");
  lines.push("| 試行 | 結果 | 控えめ対象の理由 | それ以外の理由 |", "|---|---|---|---|");
  for (const result of failed) {
    const reasons = new Set(rejections.filter((record) => record.trialId === result.trial.id).flatMap((record) => record.reasons));
    const soft = [...reasons].filter((reason) => SOFT_REASONS.has(reason));
    const other = [...reasons].filter((reason) => !SOFT_REASONS.has(reason));
    lines.push(`| ${result.trial.id} | ${result.outcome}（${(result.reasonCodes ?? []).join(", ")}） | ${soft.join(", ") || "なし"} | ${other.join(", ") || "なし"} |`);
  }
  lines.push("");
}

function analyze(path) {
  const document = JSON.parse(readFileSync(path, "utf8"));
  if (document.schema !== "oto-motion-p1-controlled") throw new TypeError(`${path}: P1セッションJSONではありません。`);
  const lines = [
    `## ${basename(path)}`,
    "",
    `- schema v${document.schemaVersion}、build \`${document.session?.appBuildId ?? "記録なし"}\`、試行 ${document.protocol?.results?.length ?? 0}件、成功イベント ${document.gestureEvents?.length ?? 0}件`,
    "",
  ];
  const successIds = new Set((document.protocol?.results ?? []).flatMap((result) => (result.event?.id ? [result.event.id] : [])));
  const events = (document.gestureEvents ?? []).filter((event) => successIds.size === 0 || successIds.has(event.id));
  for (const gesture of Object.keys(FACTORS)) {
    analyzeEvents(gesture, events.filter((event) => event.gestureType === gesture), lines);
  }
  analyzeRejections(document, lines);
  return lines.join("\n");
}

const paths = process.argv.slice(2);
if (paths.length === 0) {
  console.error("使い方: node scripts/analyze-p1-confidence.mjs <p1-session.json> [more.json ...]");
  process.exit(1);
}
console.log(paths.map(analyze).join("\n"));
