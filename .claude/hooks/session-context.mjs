// SessionStart: docs/README.md 冒頭の「現在地」箇条書きと「文書の正本」表を文脈として渡す。
// これがあるので、作業開始時に docs/README.md 全体を読み直さなくてよい。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
let text = "";
try {
  text = readFileSync(resolve(root, "docs/README.md"), "utf8");
} catch {
  process.exit(0);
}
const lines = text.split(/\r?\n/);

const start = lines.findIndex((l) => l.startsWith("- "));
if (start < 0) process.exit(0);
const bullets = takeWhile(start, (l) => l.startsWith("- "));

const heading = lines.findIndex((l) => l.startsWith("## 文書の正本"));
const tableStart = heading < 0 ? -1 : lines.findIndex((l, i) => i > heading && l.startsWith("|"));
const table = tableStart < 0 ? [] : takeWhile(tableStart, (l) => l.startsWith("|"));

let out = `docs/README.md の現在地（セッション開始時点。docs/README.md を読み直さなくてよい。[番号] の文書は docs/<番号>_*.md）:\n${bullets.join("\n")}\n`;
if (table.length > 0) out += `\n文書の正本（docs/ 配下）:\n${table.join("\n")}\n`;
process.stdout.write(stripLinkTargets(out));

// 文脈を節約するため、Markdownリンクの行き先を落として表示名だけ残す。番号だけの表示名は [18] の形にする。
function stripLinkTargets(markdown) {
  return markdown.replace(/\[([^\]]+)\]\([^)]*\)/g, (_, label) => (/^\d+$/.test(label) ? `[${label}]` : label));
}

function takeWhile(from, keep) {
  const taken = [];
  for (let i = from; i < lines.length && keep(lines[i]); i++) taken.push(lines[i]);
  return taken;
}
