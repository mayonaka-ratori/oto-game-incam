import { createHash } from "node:crypto";
import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const verifyOnly = process.argv.includes("--verify");
const packageVersion = "0.10.35";
const model = {
  url: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
  target: "public/mediapipe/models/hand_landmarker.task",
  size: 7_819_105,
  sha256: "fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1",
};
const wasmFiles = [
  ["vision_wasm_internal.js", 322_044, "e7fd9858e8e8f221d9b96eddc11f8e077f263e0b7bbd79d3cbe882b134274f8c"],
  ["vision_wasm_internal.wasm", 11_153_617, "6a5c64584c2ab61c763b6e204afbdbc7ce1caf7f5216187322bca8df94f646bc"],
  ["vision_wasm_module_internal.js", 322_082, "1f1d6215324a1fe62f6742d49a3db911170987ca18ad8c1b75f1a1c82acf2b44"],
  ["vision_wasm_module_internal.wasm", 11_153_641, "617b8e0248dbd27e9d7ece4218004eae4cefb499196d1bb4fa0e3fef21708756"],
  ["vision_wasm_nosimd_internal.js", 321_847, "438d1fe8ff7f4d946025bc211c291543c037d8a3785ed4eee60f1f521b236296"],
  ["vision_wasm_nosimd_internal.wasm", 10_481_398, "8a3092d34c79d3f57e6ba8592105e8a90f6b07c27891ffecd14cca428bfd3e31"],
];

async function digest(path) {
  const bytes = await readFile(path);
  return { bytes, size: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") };
}

async function verify(path, expectedSize, expectedHash) {
  let actual;
  try {
    actual = await digest(path);
  } catch {
    throw new Error(`Required MediaPipe asset is missing: ${path}`);
  }
  if (actual.size !== expectedSize || actual.sha256 !== expectedHash) {
    throw new Error(`MediaPipe asset hash mismatch: ${path}`);
  }
}

async function prepare() {
  const packageJson = JSON.parse(await readFile(resolve(root, "node_modules/@mediapipe/tasks-vision/package.json"), "utf8"));
  if (packageJson.version !== packageVersion) {
    throw new Error(`Expected @mediapipe/tasks-vision ${packageVersion}, found ${packageJson.version}`);
  }
  const wasmTarget = resolve(root, "public/mediapipe/wasm");
  await mkdir(wasmTarget, { recursive: true });
  for (const [name] of wasmFiles) {
    await copyFile(resolve(root, "node_modules/@mediapipe/tasks-vision/wasm", name), resolve(wasmTarget, name));
  }

  const modelTarget = resolve(root, model.target);
  await mkdir(dirname(modelTarget), { recursive: true });
  let validModel = false;
  try {
    await verify(modelTarget, model.size, model.sha256);
    validModel = true;
  } catch {
    // An explicit prepare command may fetch; build/verify never does.
  }
  if (!validModel) {
    const response = await fetch(model.url);
    if (!response.ok) throw new Error(`Model download failed: HTTP ${response.status}`);
    await writeFile(modelTarget, new Uint8Array(await response.arrayBuffer()));
  }
}

if (!verifyOnly) await prepare();
for (const [name, size, hash] of wasmFiles) {
  await verify(resolve(root, "public/mediapipe/wasm", name), size, hash);
}
await verify(resolve(root, model.target), model.size, model.sha256);
console.log(`MediaPipe assets verified (@mediapipe/tasks-vision ${packageVersion}, model ${model.sha256.slice(0, 12)}…).`);
