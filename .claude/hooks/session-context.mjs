// SessionStart: docs/README.md 冒頭の「現在地」箇条書きを文脈として渡す。
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
const block = [];
for (let i = start; i < lines.length && lines[i].startsWith("- "); i++) block.push(lines[i]);
process.stdout.write(`docs/README.md の現在地（セッション開始時点）:\n${block.join("\n")}\n`);
