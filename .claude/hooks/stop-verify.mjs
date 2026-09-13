// Stop: src/tests/e2e/build に未コミット変更があるときだけ typecheck と単体テストを走らせる。
// 失敗したら exit 2 で応答を終わらせず、Claude に結果を返す。
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const input = JSON.parse(await readStdin());
if (input?.stop_hook_active) process.exit(0); // 自分のブロックで再入したときは止めない

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const watched = ["src", "tests", "e2e", "build", "scripts", "*.ts", "*.js", "package.json"];
const status = spawnSync("git", ["status", "--porcelain", "--", ...watched], { cwd: root, encoding: "utf8" });
if (status.status !== 0 || status.stdout.trim() === "") process.exit(0);

const tsc = resolve(root, "node_modules/typescript/bin/tsc");
const vitest = resolve(root, "node_modules/vitest/vitest.mjs");
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
