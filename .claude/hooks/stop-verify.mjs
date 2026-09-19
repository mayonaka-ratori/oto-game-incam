// Stop: src/tests/e2e/build に未コミット変更があるときだけ typecheck と単体テストを走らせる。
// 失敗したら exit 2 で応答を終わらせず、Claude に結果を返す。
// 前回通ったときから対象ファイルが変わっていなければ、走らせずに抜ける（commitしない運用では毎回の応答終了で走ってしまうため）。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const input = JSON.parse(await readStdin());
if (input?.stop_hook_active) process.exit(0); // 自分のブロックで再入したときは止めない

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const watched = ["src", "tests", "e2e", "build", "scripts", "*.ts", "*.js", "package.json"];
const status = spawnSync("git", ["status", "--porcelain", "-z", "--untracked-files=all", "--", ...watched], { cwd: root, encoding: "utf8" });
if (status.status !== 0 || status.stdout === "") process.exit(0);

const tsc = resolve(root, "node_modules/typescript/bin/tsc");
const vitest = resolve(root, "node_modules/vitest/vitest.mjs");
if (!existsSync(tsc) || !existsSync(vitest)) process.exit(0); // npm ci 前

const cacheFile = resolve(root, "node_modules/.cache/claude-stop-verify.json");
const current = fingerprint(status.stdout);
if (readCache() === current) process.exit(0);

const steps = [
  ["typecheck", [tsc, "--noEmit"]],
  ["test", [vitest, "run", "--reporter=dot"]],
];
const failures = [];
for (const [name, args] of steps) {
  const r = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8" });
  if (r.status !== 0) failures.push(`[${name}] exit ${r.status}\n${tail(r.stdout + r.stderr)}`);
}
if (failures.length > 0) {
  process.stderr.write(`Stop hook: 未コミット変更に対する検証が失敗しました。修正してから終えてください。\n${failures.join("\n")}`);
  process.exit(2);
}
writeCache(current);

// 変更ファイルの一覧と、それぞれの更新時刻・サイズから作る指紋。どれかを編集すれば変わる。
function fingerprint(porcelain) {
  const hash = createHash("sha256").update(porcelain);
  const entries = porcelain.split("\0").filter((e) => e !== "");
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (/^[RC]/.test(entry)) i++; // rename/copy は次の要素が元のパス
    try {
      const s = statSync(resolve(root, entry.slice(3)));
      hash.update(`${s.mtimeMs}:${s.size};`);
    } catch {
      hash.update("missing;");
    }
  }
  return hash.digest("hex");
}
function readCache() {
  try {
    return JSON.parse(readFileSync(cacheFile, "utf8")).passed;
  } catch {
    return undefined;
  }
}
function writeCache(passed) {
  try {
    mkdirSync(dirname(cacheFile), { recursive: true });
    writeFileSync(cacheFile, JSON.stringify({ passed }));
  } catch {
    // 書けなくても検証結果には影響しない。次回もう一度走るだけ。
  }
}
function tail(text, lines = 40) {
  return text.trim().split(/\r?\n/).slice(-lines).join("\n");
}
function readStdin() {
  return new Promise((done) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => done(data || "{}"));
  });
}
