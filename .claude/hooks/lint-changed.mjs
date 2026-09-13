// PostToolUse (Edit|Write): 編集したTS/JSファイルにESLintを掛け、違反があればexit 2でClaudeへ差し戻す。
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, relative, sep } from "node:path";

const input = JSON.parse(await readStdin());
const filePath = input?.tool_input?.file_path;
if (typeof filePath !== "string") process.exit(0);

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const rel = relative(root, resolve(root, filePath)).split(sep).join("/");
const lintable = /\.(ts|mts|cts|js|mjs|cjs)$/.test(rel);
const excluded = /^(node_modules|dist|public|coverage|test-results|playwright-report|\.claude)\//.test(rel) || rel.startsWith("..");
if (!lintable || excluded || !existsSync(resolve(root, rel))) process.exit(0);

const eslint = resolve(root, "node_modules/eslint/bin/eslint.js");
if (!existsSync(eslint)) process.exit(0);
const result = spawnSync(process.execPath, [eslint, rel], { cwd: root, encoding: "utf8" });
if (result.status !== 0) {
  process.stderr.write(`ESLint failed for ${rel}:\n${result.stdout}${result.stderr}`);
  process.exit(2);
}

function readStdin() {
  return new Promise((done) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => done(data || "{}"));
  });
}
