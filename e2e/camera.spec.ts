import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("starts, measures, hides, and releases the camera", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Tracking, Timing & Gesture Lab" })).toBeVisible();
  await expect(page.getByText("映像・音声は保存しません")).toBeVisible();

  const startButton = page.getByRole("button", { name: "カメラを開始" });
  await expect(startButton).toBeEnabled();
  await startButton.click();

  await expect(page.getByText("カメラ計測中")).toBeVisible();
  const video = page.locator("#camera-preview");
  await expect(video).toBeVisible();
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState))
    .toBeGreaterThanOrEqual(2);
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.srcObject !== null))
    .toBe(true);
  await expect
    .poll(() => page.locator("#metric-camera-fps").textContent(), { timeout: 10_000 })
    .not.toBe("—");

  const previewButton = page.getByRole("button", { name: "プレビューを隠す" });
  await previewButton.click();
  await expect(video).toBeVisible();
  await expect(video).not.toHaveAttribute("hidden");
  await expect(page.getByText("プレビューは非表示です。計測は継続しています。")).toBeVisible();

  await page.getByRole("button", { name: "カメラを停止" }).click();
  await expect(page.getByText("カメラを停止しました")).toBeVisible();
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.srcObject === null))
    .toBe(true);
});

test("fits the camera controls in a phone landscape viewport", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/");

  await expect(page.getByRole("button", { name: "カメラを開始" })).toBeInViewport();
  await expect(page.getByRole("heading", { name: "Live diagnostics" })).toBeVisible();
  await expect(page.locator("#orientation-notice")).toBeHidden();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#orientation-notice")).toBeVisible();
  await expect(page.getByRole("heading", { name: "単体ジェスチャー制御試験" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("renders two mock hands and exposes tracking queue diagnostics", async ({ page }) => {
  await page.goto("/?tracking=mock");
  await page.getByRole("button", { name: "カメラを開始" }).click();

  await expect(page.getByText("TRACKING · 両手を検出")).toBeVisible();
  await expect(page.locator("#tracking-hands")).toHaveText("2");
  await expect(page.locator("#tracking-inflight")).toHaveText(/[01]/);
  await expect(page.locator("#tracking-pending")).toHaveText(/[01]/);
  await expect.poll(() => page.locator("#metric-tracking-hz").textContent()).not.toBe("—");
  await expect.poll(() => page.locator("#tracking-overlay").evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext("2d");
    if (context === null || canvas.width === 0 || canvas.height === 0) return false;
    return context.getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 === 3 && value > 0);
  })).toBe(true);

  for (const name of ["21 points", "connections", "cursor", "L / R labels"]) {
    await page.getByRole("checkbox", { name }).uncheck();
  }
  await expect.poll(() => page.locator("#tracking-overlay").evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext("2d");
    if (context === null) return false;
    return context.getImageData(0, 0, canvas.width, canvas.height).data.every((value, index) => index % 4 !== 3 || value === 0);
  })).toBe(true);
});

for (const scenario of [
  { query: "one-left", state: "TRACKING LOSS · 片手のみ検出（MISSではありません）", hands: "1" },
  { query: "none", state: "TRACKING LOSS · 両手を検出できません（MISSではありません）", hands: "0" },
] as const) {
  test(`renders the ${scenario.query} tracking state`, async ({ page }) => {
    await page.goto(`/?tracking=mock&trackingScenario=${scenario.query}`);
    await page.getByRole("button", { name: "カメラを開始" }).click();
    await expect(page.getByText(scenario.state)).toBeVisible();
    await expect(page.locator("#tracking-hands")).toHaveText(scenario.hands);
  });
}

test("recovers from synthetic per-frame inference errors without growing the queue", async ({ page }) => {
  await page.goto("/?tracking=mock&trackingScenario=frame-error");
  await page.getByRole("button", { name: "カメラを開始" }).click();
  await expect.poll(async () => Number(await page.locator("#tracking-inflight").textContent())).toBeLessThanOrEqual(1);
  await expect.poll(async () => Number(await page.locator("#tracking-pending").textContent())).toBeLessThanOrEqual(1);
  await expect.poll(async () => Number(await page.locator("#tracking-errored").textContent())).toBeGreaterThan(0);
  await expect(page.locator("#tracking-init")).toHaveText("ready");
});

test("initializes MediaPipe in the Worker and processes a camera frame", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "カメラを開始" }).click();

  await expect.poll(async () => {
    const status = await page.locator("#tracking-init").textContent();
    return status === "error" ? await page.locator("#tracking-error").textContent() : status;
  }, { timeout: 30_000 }).toBe("ready");
  await expect(page.locator("#tracking-delegate")).toHaveText(/GPU|CPU/);
  await expect.poll(async () => {
    const value = await page.locator("#tracking-counts").textContent();
    return Number(value?.split("/")[2]?.trim() ?? 0);
  }, { timeout: 30_000 }).toBeGreaterThan(0);
  for (const selector of ["#tracking-callback-worker", "#tracking-frame-age-p50"]) {
    await expect.poll(async () => Number.parseFloat(await page.locator(selector).textContent() ?? "NaN"))
      .toBeGreaterThanOrEqual(0);
  }
  expect(pageErrors).toEqual([]);
});

test("continues rVFC tracking while the raw preview is hidden", async ({ page }) => {
  await page.addInitScript(() => {
    Reflect.deleteProperty(globalThis, "MediaStreamTrackProcessor");
  });
  await page.goto("/?tracking=mock");
  await page.getByRole("button", { name: "カメラを開始" }).click();

  await expect(page.locator("#tracking-source")).toHaveText("requestVideoFrameCallback");
  const completedCount = async (): Promise<number> => {
    const value = await page.locator("#tracking-counts").textContent();
    return Number(value?.split("/")[2]?.trim() ?? 0);
  };
  await expect.poll(completedCount).toBeGreaterThan(0);
  const beforeHide = await completedCount();

  await page.getByRole("button", { name: "プレビューを隠す" }).click();
  await expect(page.getByText("プレビューは非表示です。計測は継続しています。")).toBeVisible();
  await expect.poll(completedCount).toBeGreaterThan(beforeHide);
});

test("downloads a non-engineer device checklist as JSON", async ({ page }) => {
  await page.goto("/?tracking=mock");
  await page.getByLabel("確認した人（ニックネームで可）").fill("tester-a");
  await page.getByLabel("使った端末").selectOption("iPhone 15");
  await page.getByLabel("OS・ブラウザのバージョン").fill("iOS / Safari");
  await page.getByLabel("端末を横向きでスタンドに置いた").check();
  await page.getByLabel("両手に点とカーソルが表示された").check();
  await expect(page.locator("#device-check-progress")).toHaveText("2 / 11 完了");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "確認結果をJSONで保存" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^oto-motion-device-check-.+\.json$/);
  const path = await download.path();
  expect(path).not.toBeNull();
  const report = JSON.parse(await readFile(path!, "utf8")) as {
    progress: { completed: number; total: number };
    privacy: { includesCameraFrames: boolean };
    session: { testerId: string; device: string };
  };
  expect(report.progress).toEqual({ completed: 2, total: 11 });
  expect(report.session).toMatchObject({ testerId: "tester-a", device: "iPhone 15" });
  expect(report.privacy.includesCameraFrames).toBe(false);
  await expect(page.locator("#device-check-export-status")).toContainText("JSONを保存しました");
});

test("runs and exports a P1 controlled trial without raw media", async ({ page }) => {
  await page.goto("/?tracking=mock");
  await page.getByRole("button", { name: "カメラを開始" }).click();
  await expect(page.locator("#tracking-init")).toHaveText("ready");
  await page.getByRole("button", { name: "音を有効にする" }).click();
  await expect(page.locator("#p1-audio-state")).toHaveText(/running|suspended/);
  await page.getByRole("button", { name: "新しいP1セッション" }).click();
  await expect(page.locator("#p1-progress")).toHaveText("0 / 30");
  await page.getByRole("button", { name: "次の試行を開始" }).click();
  await expect(page.locator("#p1-trial-number")).toHaveText("1 / 30");
  await page.getByRole("button", { name: "tracking loss" }).click();
  await expect(page.locator("#p1-progress")).toHaveText("1 / 30");
  await page.getByRole("button", { name: "false triggerを記録" }).click();
  await expect(page.locator("#p1-false-trigger-count")).toHaveText("1");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "P1セッションJSONを保存" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  const report = JSON.parse(await readFile(path!, "utf8")) as {
    schema: string;
    privacy: { includesCameraFrames: boolean; includesAudio: boolean };
    protocol: { completed: number; falseTriggers: unknown[] };
    replay: { frames: unknown[] };
  };
  expect(report.schema).toBe("oto-motion-p1-controlled");
  expect(report.privacy).toEqual(expect.objectContaining({ includesCameraFrames: false, includesAudio: false }));
  expect(report.protocol.completed).toBe(1);
  expect(report.protocol.falseTriggers).toHaveLength(1);
  expect(report.replay.frames.length).toBeGreaterThan(0);
});
