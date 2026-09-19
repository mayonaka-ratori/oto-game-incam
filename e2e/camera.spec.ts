import { expect, test, type Download, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("starts, measures, hides, and releases the camera", async ({ page }) => {
  await page.goto("/?view=analysis");

  await expect(page.getByRole("heading", { name: "手の追跡・時刻・ジェスチャー検証" })).toBeVisible();
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

test("offers one button and the camera image in a phone landscape viewport", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/?tracking=mock");

  const start = page.getByRole("button", { name: "はじめる" });
  await expect(start).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("button", { name: "テストを開始" })).toBeHidden();
  await expect(page.getByRole("button", { name: "音を有効にする" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "リアルタイム計測値" })).toBeHidden();
  await expect(page.locator("details.diagnostics-panel")).not.toHaveAttribute("open", "");
  await expect(page.locator("#orientation-notice")).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await start.click();
  await expect(page.locator("#stage-tap")).toBeVisible({ timeout: 20_000 });
  const previewBox = await page.locator("#preview-shell").boundingBox();
  expect(previewBox).not.toBeNull();
  expect(previewBox!.width / previewBox!.height).toBeCloseTo(4 / 3, 1);
  expect(previewBox!.y + previewBox!.height).toBeLessThanOrEqual(390);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#orientation-notice")).toBeHidden();
  await expect(page.locator("#stage-instruction")).toBeInViewport({ ratio: 1 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("renders two mock hands and exposes tracking queue diagnostics", async ({ page }) => {
  await page.goto("/?tracking=mock&view=analysis");
  await page.getByRole("button", { name: "カメラを開始" }).click();

  await expect(page.getByText("両手を追跡しています")).toBeVisible();
  await expect(page.locator("#tracking-hands")).toHaveText("2");
  await expect(page.locator("#tracking-inflight")).toHaveText(/[01]/);
  await expect(page.locator("#tracking-pending")).toHaveText(/[01]/);
  await expect.poll(() => page.locator("#metric-tracking-hz").textContent()).not.toBe("—");
  await expect.poll(() => page.locator("#tracking-overlay").evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext("2d");
    if (context === null || canvas.width === 0 || canvas.height === 0) return false;
    return context.getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 === 3 && value > 0);
  })).toBe(true);

  for (const name of ["手の21点", "点を結ぶ線", "手のカーソル", "左手／右手ラベル"]) {
    await page.getByRole("checkbox", { name }).uncheck();
  }
  await expect.poll(() => page.locator("#tracking-overlay").evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext("2d");
    if (context === null) return false;
    return context.getImageData(0, 0, canvas.width, canvas.height).data.every((value, index) => index % 4 !== 3 || value === 0);
  })).toBe(true);
});

test("locks the selected experiment profile while the camera is active", async ({ page }) => {
  await page.goto("/?tracking=mock&view=analysis&protocol=five");
  await page.locator("details.diagnostics-panel > summary").click();
  const profile = page.getByLabel("実験プロファイル");
  await expect(profile).toHaveValue("gpu-640x480-30");
  await expect(page.locator("#requested-profile")).toHaveText("gpu-640x480-30");
  await expect(page.locator("#requested-fps")).toHaveText("30–30 fps");

  await page.getByRole("button", { name: "カメラを開始" }).click();
  await expect(profile).toBeDisabled();
  await page.getByRole("button", { name: "テストを開始" }).click();
  await expect(page.locator("#p1-trial-number")).toHaveText("1 / 50");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "P1結果JSONを保存" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  const result = JSON.parse(await readFile(path!, "utf8")) as {
    session: { appVersion: string };
    technicalSnapshot: {
      appBuildId: string;
      experimentProfileId: string;
      requestedCameraWidth: number;
      requestedFrameRateIdeal: number;
      requestedDelegate: string;
      requestedModelId: string;
      actualCameraWidth: number | null;
      actualCameraFrameRate: number | null;
    };
  };
  expect(result.session.appVersion.length).toBeGreaterThan(0);
  expect(result.technicalSnapshot).toMatchObject({
    experimentProfileId: "gpu-640x480-30",
    requestedCameraWidth: 640,
    requestedFrameRateIdeal: 30,
    requestedDelegate: "GPU",
  });
  expect(result.technicalSnapshot.appBuildId).toBe(result.session.appVersion);
  expect(result.technicalSnapshot.requestedModelId.length).toBeGreaterThan(0);
  expect(result.technicalSnapshot.actualCameraWidth).toBeGreaterThan(0);
  expect(result.technicalSnapshot.actualCameraFrameRate).toBeGreaterThan(0);

  await page.getByRole("button", { name: "カメラを停止" }).click();
  await expect(profile).toBeEnabled();
  await profile.selectOption("baseline-gpu-640x480-60");
  await expect(page.getByRole("button", { name: "P1結果JSONを保存" })).toBeDisabled();
  await expect(page.locator("#p1-export-status")).toContainText("テストを最初から");
  await page.getByRole("button", { name: "カメラを開始" }).click();
  await page.getByRole("button", { name: "テストを最初からやり直す" }).click();
  await expect(page.getByRole("button", { name: "P1結果JSONを保存" })).toBeEnabled();
});

for (const scenario of [
  { query: "one-left", state: "片手だけを検出しています（プレイヤーの失敗ではありません）", hands: "1" },
  { query: "none", state: "両手を検出できません（プレイヤーの失敗ではありません）", hands: "0" },
] as const) {
  test(`renders the ${scenario.query} tracking state`, async ({ page }) => {
    await page.goto(`/?tracking=mock&trackingScenario=${scenario.query}`);
    await page.getByRole("button", { name: "はじめる" }).click();
    await expect(page.getByText(scenario.state)).toBeVisible();
    await expect(page.locator("#tracking-hands")).toHaveText(scenario.hands);
  });
}

test("recovers from synthetic per-frame inference errors without growing the queue", async ({ page }) => {
  await page.goto("/?tracking=mock&trackingScenario=frame-error");
  await page.getByRole("button", { name: "はじめる" }).click();
  await expect.poll(async () => Number(await page.locator("#tracking-inflight").textContent())).toBeLessThanOrEqual(1);
  await expect.poll(async () => Number(await page.locator("#tracking-pending").textContent())).toBeLessThanOrEqual(1);
  await expect.poll(async () => Number(await page.locator("#tracking-errored").textContent())).toBeGreaterThan(0);
  await expect(page.locator("#tracking-init")).toHaveText("準備完了");
});

test("initializes MediaPipe in the Worker and processes a camera frame", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "はじめる" }).click();

  await expect.poll(async () => {
    const status = await page.locator("#tracking-init").textContent();
    return status === "error" ? await page.locator("#tracking-error").textContent() : status;
  }, { timeout: 30_000 }).toBe("準備完了");
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
  await page.goto("/?tracking=mock&view=analysis");
  await page.getByRole("button", { name: "カメラを開始" }).click();

  await expect(page.locator("#tracking-source")).toHaveText("映像フレーム通知");
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

test("shows only the tester workflow on the standard URL", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("#preview-shell")).toBeVisible();
  await expect(page.getByRole("button", { name: "はじめる" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "リアルタイム計測値" })).toBeHidden();
  await expect(page.getByText("検証用の重ね表示")).toBeHidden();
  await expect(page.getByRole("button", { name: "結果を保存" })).toBeHidden();
  await expect(page.getByRole("button", { name: "診断データだけをもう一度保存" })).toBeHidden();
  await expect(page.getByRole("button", { name: "カメラを停止" })).toBeHidden();
  await expect(page.getByRole("button", { name: "テストを開始" })).toBeHidden();
  // The default procedure is the upright-phone one: ribbon-swipe, Lift and ななめリフト, ten trials each.
  await expect(page.locator("#p1-block-label")).toHaveText("ブロック 1 / 3");
  await expect(page.locator("#p1-progress")).toHaveText("0 / 30");
  await expect(page.getByRole("button", { name: "この動きを開始" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "実機確認レポート" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "P1セッション比較" })).toHaveCount(0);
});

test("manages, exports, and resumes the device check as JSON", async ({ page }) => {
  await page.goto("/?tracking=mock&view=analysis");
  await page.getByLabel("確認した人（匿名ID）").fill("tester-a");
  await page.locator('[name="device"]').selectOption("iPhone 15");
  await page.getByLabel("OS名").fill("iOS");
  await page.getByLabel("OS完全バージョン").fill("20.0");
  await page.getByLabel("ブラウザ名").fill("Safari");
  await page.getByLabel("ブラウザ完全バージョン").fill("20.0");
  await page.getByLabel("端末を横向きでスタンドに置いたの結果").selectOption("pass");
  await page.getByLabel("両手に21点とカーソルが表示されたの結果").selectOption("issue");
  await expect(page.locator("#device-check-progress")).toHaveText("2 / 25確認 · 問題 1");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "実機確認JSONを保存" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^oto-motion-device-check-.+\.json$/);
  const path = await download.path();
  expect(path).not.toBeNull();
  const reportText = await readFile(path!, "utf8");
  expect(Buffer.byteLength(reportText)).toBeLessThan(300_000);
  const report = JSON.parse(reportText) as {
    schemaVersion: string;
    progress: { completed: number; total: number; issue: number };
    privacy: { includesCameraFrames: boolean };
    session: { testerId: string; device: string };
  };
  expect(report.schemaVersion).toBe("2.4");
  expect(report.progress).toMatchObject({ completed: 2, total: 25, issue: 1 });
  expect(report.session).toMatchObject({ testerId: "tester-a", device: "iPhone 15" });
  expect(report.privacy.includesCameraFrames).toBe(false);
  await expect(page.locator("#device-check-export-status")).toContainText("JSONを保存しました");

  await page.getByLabel("確認した人（匿名ID）").fill("changed");
  await page.locator("#device-check-import").setInputFiles(path!);
  await expect(page.getByLabel("確認した人（匿名ID）")).toHaveValue("tester-a");
  await expect(page.getByLabel("両手に21点とカーソルが表示されたの結果")).toHaveValue("issue");
  await expect(page.locator("#device-check-export-status")).toContainText("再開できます");
});

test("runs and exports a P1 controlled trial without raw media", async ({ page }) => {
  // Three downloads, two imports, and many form steps: a busy machine needs more than 30 seconds.
  test.setTimeout(60_000);
  await page.goto("/?tracking=mock&view=analysis&protocol=five");
  await page.getByRole("button", { name: "カメラを開始" }).click();
  await expect(page.locator("#tracking-init")).toHaveText("準備完了");
  await page.getByRole("button", { name: "テストを開始" }).click();
  await expect(page.locator("#p1-audio-state")).toHaveText(/動作中|一時停止中/);
  await expect(page.locator("#p1-progress")).toHaveText("0 / 50");
  await expect(page.locator("#p1-trial-number")).toHaveText("1 / 50");
  await expect(page.locator("#p1-remaining")).toHaveText(/\d+秒/);
  // Click and read in one task: on a busy machine a separate check can come after the
  // 1-second result hold and see the next trial instead.
  await expect(page.getByRole("button", { name: "未成立として次へ" })).toBeEnabled();
  const afterSkip = await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>("#p1-skip")?.click();
    return {
      state: document.querySelector("#p1-state")?.textContent ?? null,
      rejection: document.querySelector("#p1-latest-rejection")?.textContent ?? null,
    };
  });
  expect(afterSkip).toEqual({ state: "次の動きまで 1秒", rejection: "未成立として次へ進みました" });
  await expect(page.locator("#p1-progress")).toHaveText("1 / 50");
  await page.getByRole("button", { name: "誤検出を記録" }).click();
  await expect(page.locator("#p1-false-trigger-count")).toHaveText("1");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "P1結果JSONを保存" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  const report = JSON.parse(await readFile(path!, "utf8")) as {
    schema: string;
    schemaVersion: number;
    gestureVocabulary: { thirdGesture: string };
    privacy: { includesCameraFrames: boolean; includesAudio: boolean; includesReplayFrames: boolean };
    protocol: { completed: number; falseTriggers: unknown[]; results: Array<{ resolution: string }> };
    replay: { available: boolean; schemaVersion: number; frameCount: number };
    technicalSnapshot: { pageUrl: string; userAgent: string; viewport: string };
    measurementNotes: Record<string, unknown>;
    environment: { screenWakeLock: string; audio: Record<string, unknown> } | null;
    performance: { session: { trackingResultCount: number } } | null;
    trialEnvironments: Array<{ viewportWidth: number; orientation: string }>;
  };
  expect(report.schema).toBe("oto-motion-p1-controlled");
  expect(report.schemaVersion).toBe(8);
  expect(report.measurementNotes).toEqual({
    technicalSummaryScope: "recent-window",
    technicalSummaryWindowSamples: 180,
    performanceScope: "session-and-blocks",
    histogramBucketMs: 1,
  });
  expect(report.performance?.session.trackingResultCount).toBeGreaterThan(0);
  expect(typeof report.environment?.screenWakeLock).toBe("string");
  expect(report.trialEnvironments.length).toBeGreaterThan(0);
  expect(report.trialEnvironments[0]?.viewportWidth).toBeGreaterThan(0);
  expect(report.gestureVocabulary).toEqual({
    thirdGesture: "bloom",
    gestures: ["air-tap", "ribbon-swipe", "bloom", "lift", "spotlight"],
    candidateGestures: ["lift", "spotlight"],
  });
  expect(report.privacy).toEqual(expect.objectContaining({ includesCameraFrames: false, includesAudio: false }));
  expect(report.privacy.includesReplayFrames).toBe(false);
  expect(report.protocol.completed).toBe(1);
  expect(report.protocol.results[0]?.resolution).toBe("manual-skip");
  expect(report.protocol.falseTriggers).toHaveLength(1);
  expect(report.replay).not.toHaveProperty("frames");
  expect(report.replay.schemaVersion).toBe(3);
  expect(report.technicalSnapshot.userAgent.length).toBeGreaterThan(0);

  const replayDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "診断リプレイを保存" }).click();
  const replayDownload = await replayDownloadPromise;
  const replayPath = await replayDownload.path();
  expect(replayPath).not.toBeNull();
  const replay = JSON.parse(await readFile(replayPath!, "utf8")) as {
    schemaVersion: number;
    frames: Array<{ hands: Array<Record<string, unknown>> }>;
    trialWindows: unknown[];
  };
  expect(replay.schemaVersion).toBe(3);
  expect(replay.frames.length).toBeGreaterThan(0);
  expect(replay.trialWindows.length).toBeGreaterThan(0);
  expect(replay.frames[0]?.hands[0]).not.toHaveProperty("landmarksWorld");

  report.technicalSnapshot.pageUrl = "https://smartphone.example.test/";
  report.technicalSnapshot.userAgent = "smartphone-test-agent";
  report.technicalSnapshot.viewport = "844 × 390";
  await page.locator("#device-check-p1-import").setInputFiles({
    name: "smartphone-p1.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(report)),
  });
  await expect(page.locator('[name="airTapUnclassified"]')).toHaveValue("1");
  await expect(page.locator("#device-check-export-status")).toContainText("スマホの自動計測値");
  await expect(page.locator("#device-check-technical-source")).toContainText("P1セッション由来");
  await expect(page.locator("#device-check-technical-source")).toContainText("844 × 390");
  await expect(page.locator("#device-check-technical-source")).toContainText("p1-five-gesture-50");
  await expect(page.locator("#device-check-export-status")).toContainText("Lift／Spotlight");

  await page.getByLabel("確認した人（匿名ID）").fill("tester-a");
  await page.locator('[name="device"]').selectOption("iPhone 15");
  await page.getByLabel("OS名").fill("iOS");
  await page.getByLabel("OS完全バージョン").fill("20.0");
  await page.getByLabel("ブラウザ名").fill("Safari");
  await page.getByLabel("ブラウザ完全バージョン").fill("20.0");
  const finalDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "実機確認JSONを保存" }).click();
  const finalDownload = await finalDownloadPromise;
  const finalPath = await finalDownload.path();
  expect(finalPath).not.toBeNull();
  const finalReport = JSON.parse(await readFile(finalPath!, "utf8")) as {
    technical: { pageUrl: string; userAgent: string; viewport: string };
    technicalSource: { mode: string };
  };
  expect(finalReport.technical).toMatchObject({
    pageUrl: "https://smartphone.example.test/",
    userAgent: "smartphone-test-agent",
    viewport: "844 × 390",
  });
  expect(finalReport.technicalSource.mode).toBe("p1-import");
  expect(finalReport.technicalSource).toMatchObject({ p1SchemaVersion: 8, p1ProtocolId: "p1-five-gesture-50" });

  // A legacy clap session never leaves the earlier Bloom value in place.
  await expect(page.locator('[name="bloomSuccess"]')).toHaveValue("0");
  await page.locator("#device-check-p1-import").setInputFiles(jsonFile(
    "legacy-clap.json",
    comparisonDocument("legacy-clap", "legacy-agent"),
  ));
  await expect(page.locator("#device-check-export-status")).toContainText("Bloom行を空に");
  await expect(page.locator('[name="bloomSuccess"]')).toHaveValue("");
});

test("times out and advances all 50 trials in five blocks without double-finishing", async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    Object.defineProperty(window, "AudioContext", { value: undefined });
  });
  await page.goto("/?tracking=mock&trackingScenario=none&view=analysis&protocol=five");
  await page.getByRole("button", { name: "カメラを開始" }).click();
  await expect(page.locator("#tracking-init")).toHaveText("準備完了");
  await page.clock.install();
  await page.getByRole("button", { name: "テストを開始" }).click();
  const motionSample = page.locator("#p1-motion-sample");
  await expect(motionSample).toHaveAttribute("data-gesture", "air-tap");
  await expect(motionSample).toHaveAttribute("data-variant", "left");
  await expect(page.locator("#p1-motion-caption")).toContainText("リングの外から中へ");
  await expect.poll(() => page.locator(".p1-motion-hand--single").evaluate(
    (element) => getComputedStyle(element).animationName,
  )).toBe("p1-air-tap-sample");
  await expect(page.locator("#p1-block-label")).toHaveText("ブロック 1 / 5");

  const nextBlocks = new Map<number, { gesture: string; variant: string; hand: string; animation: string }>([
    [10, { gesture: "ribbon-swipe", variant: "left-to-right", hand: ".p1-motion-hand--single", animation: "p1-swipe-sample" }],
    [20, { gesture: "bloom", variant: "open-up", hand: ".p1-motion-hand--left", animation: "p1-bloom-left-sample" }],
    [30, { gesture: "lift", variant: "raise", hand: ".p1-motion-hand--left", animation: "p1-lift-sample" }],
    [40, { gesture: "spotlight", variant: "left-up-right-down", hand: ".p1-motion-hand--left", animation: "p1-spotlight-left-sample" }],
  ]);
  for (let ordinal = 1; ordinal <= 50; ordinal += 1) {
    // The deadline timer waits 200ms for frames captured before the deadline.
    await page.clock.fastForward(10_201);
    await expect(page.locator("#p1-progress")).toHaveText(`${ordinal} / 50`);
    if (ordinal === 50) break;
    const nextBlock = nextBlocks.get(ordinal);
    if (nextBlock === undefined) {
      await page.clock.fastForward(1_001);
    } else {
      // A new movement waits for a tap on the camera image instead of advancing by itself.
      await expect(page.locator("#p1-state")).toHaveText("画面をタップして開始");
      await expect(page.locator("#stage-tap")).toBeVisible();
      await page.clock.fastForward(450);
      await page.locator("#preview-shell").click({ force: true, position: { x: 12, y: 12 } });
      await expect(motionSample).toHaveAttribute("data-gesture", nextBlock.gesture);
      await expect(motionSample).toHaveAttribute("data-variant", nextBlock.variant);
      await expect.poll(() => page.locator(nextBlock.hand).evaluate(
        (element) => getComputedStyle(element).animationName,
      )).toBe(nextBlock.animation);
    }
    await expect(page.locator("#p1-trial-number")).toHaveText(`${ordinal + 1} / 50`);
  }

  await expect(page.locator("#p1-state")).toHaveText("完了");
  await expect(page.locator("#p1-block")).toHaveAttribute("data-state", "complete");
  await expect(page.locator("#p1-latest-rejection")).toHaveText("10秒で未成立として記録しました");
  await expect(page.locator("#p1-skip")).toBeDisabled();
  await expect(page.locator("#p1-next-trial")).toBeDisabled();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "P1結果JSONを保存" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  const report = JSON.parse(await readFile(path!, "utf8")) as {
    schemaVersion: number;
    protocol: {
      id: string;
      total: number;
      results: Array<{ outcome: string; resolution: string; timing: unknown }>;
      blocks: Array<{ startedAtMs: number | null; finishedAtMs: number | null; restBeforeMs: number | null }>;
    };
    summary: { byGesture: Record<string, { readinessTimeout: number; recognitionTimeout: number }> };
    performance: { blocks: Array<{ blockIndex: number; gesture: string; open: boolean }> } | null;
  };
  expect(report.schemaVersion).toBe(8);
  expect(report.protocol).toMatchObject({ id: "p1-five-gesture-50", total: 50 });
  expect(report.protocol.results).toHaveLength(50);
  expect(report.protocol.results.every(({ outcome, resolution }) => (
    outcome === "unclassified" && resolution === "trial-timeout"
  ))).toBe(true);
  expect(report.summary.byGesture["air-tap"]).toMatchObject({ readinessTimeout: 0, recognitionTimeout: 10 });
  expect(report.summary.byGesture.bloom).toMatchObject({ readinessTimeout: 10, recognitionTimeout: 0 });
  expect(report.summary.byGesture.lift).toMatchObject({ readinessTimeout: 10, recognitionTimeout: 0 });
  expect(report.protocol.results.slice(20, 40).every(({ timing }) => timing === null)).toBe(true);
  expect(report.protocol.blocks).toHaveLength(5);
  expect(report.protocol.blocks.every(({ startedAtMs, finishedAtMs }) => (
    startedAtMs !== null && finishedAtMs !== null
  ))).toBe(true);
  expect(report.protocol.blocks.slice(1).every(({ restBeforeMs }) => restBeforeMs !== null)).toBe(true);
  // Every block is measured on its own, and every finished block is closed.
  expect(report.performance?.blocks.map(({ gesture }) => gesture)).toEqual([
    "air-tap",
    "ribbon-swipe",
    "bloom",
    "lift",
    "spotlight",
  ]);
  expect(report.performance?.blocks.every(({ open }) => !open)).toBe(true);
});

test("pauses inside a block and repeats the abandoned attempt after resume", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "AudioContext", { value: undefined });
  });
  await openAndStartTest(page);

  await page.getByRole("button", { name: "中断", exact: true }).click();
  await expect(page.locator("#p1-state")).toHaveText("中断中");
  await expect(page.locator("#p1-block")).toHaveAttribute("data-state", "paused");
  await expect(page.locator("#p1-progress")).toHaveText("0 / 30");
  await expect(page.locator("#p1-remaining")).toHaveText("—");
  await page.getByRole("button", { name: "再開", exact: true }).click();
  await expect(page.locator("#p1-trial-number")).toHaveText("1 / 30");
  await page.getByRole("button", { name: "反応しなかったので次へ" }).click();
  await expect(page.locator("#p1-progress")).toHaveText("1 / 30");

  await page.getByRole("button", { name: "中断", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "結果を保存" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  const report = JSON.parse(await readFile(path!, "utf8")) as {
    protocol: {
      results: Array<{ attempt: number; resolution: string }>;
      blocks: Array<{ pauses: Array<{ reason: string; abandonedTrialId: string | null; resumedAtMs: number | null }> }>;
    };
  };
  expect(report.protocol.results).toEqual([expect.objectContaining({ attempt: 2, resolution: "manual-skip" })]);
  expect(report.protocol.blocks[0]?.pauses).toEqual([expect.objectContaining({
    reason: "manual",
    abandonedTrialId: "ribbon-swipe-1",
    resumedAtMs: expect.any(Number),
  }), expect.objectContaining({ reason: "manual", resumedAtMs: null })]);
});

test("waits for two-hand readiness before the Bloom count-in", async ({ page }) => {
  test.setTimeout(120_000);
  // Real time keeps camera frames and readiness timing consistent. Without Web Audio, GO equals the ready time.
  await page.addInitScript(() => {
    Object.defineProperty(window, "AudioContext", { value: undefined });
  });
  // Bloom is no longer in the default procedure, so this check asks for the 20-trial one.
  await openAndStartTest(page, "?tracking=mock&protocol=remaining-two", 20);
  for (let ordinal = 1; ordinal <= 10; ordinal += 1) {
    await expect(page.locator("#p1-trial-number")).toHaveText(`${ordinal} / 20`);
    await page.getByRole("button", { name: "反応しなかったので次へ" }).click();
    await expect(page.locator("#p1-progress")).toHaveText(`${ordinal} / 20`);
  }
  await tapStage(page);

  await expect(page.locator("#p1-gesture")).toHaveText("Bloom");
  await expect(page.locator("#stage-instruction")).toHaveText("丸印から輪まで 両手を開く");
  await expect(page.locator("#p1-state")).toHaveText(/準備OK|カウント|^[12]$|GO|判定中/, { timeout: 15_000 });
  await page.getByRole("button", { name: "反応しなかったので次へ" }).click();
  await expect(page.locator("#p1-progress")).toHaveText("11 / 20");

  await page.getByRole("button", { name: "中断", exact: true }).click();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "結果を保存" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  const report = JSON.parse(await readFile(path!, "utf8")) as {
    protocol: {
      results: Array<{
        resolution: string;
        readiness: { readyAtMs: number | null; requiredStableMs: number } | null;
        timing: { readyAtMs: number | null } | null;
      }>;
    };
  };
  expect(report.protocol.results[10]).toMatchObject({
    resolution: "manual-skip",
    readiness: { requiredStableMs: 200, readyAtMs: expect.any(Number) },
    timing: { readyAtMs: expect.any(Number) },
  });
});

test("compares multiple complete P1 sessions without declaring an automatic pass", async ({ page }) => {
  await page.goto("/?view=analysis");
  await page.locator("#p1-comparison-import").setInputFiles([
    {
      name: "android.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(comparisonDocument("android", "android-agent"))),
    },
    {
      name: "iphone.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(comparisonDocument("iphone", "iphone-agent"))),
    },
  ]);

  await expect(page.locator("#p1-comparison-status")).toHaveText("2セッション · 完全 2 · 8/10候補 2");
  await expect(page.locator("#p1-comparison-body tr")).toHaveCount(2);
  await expect(page.locator("#p1-comparison-findings")).toContainText("最終判定");
  await expect(page.locator("#p1-comparison-findings")).toContainText("合格／要改善／方針転換");
  await expect(page.locator("#p1-comparison-findings")).not.toContainText("自動Pass");

  await page.getByRole("button", { name: "比較をクリア" }).click();
  await expect(page.locator("#p1-comparison-status")).toHaveText("0セッション");
  await expect(page.locator("#p1-comparison-body tr")).toHaveCount(0);
});

test("waits for a tap at a movement change and asks before a restart", async ({ page }) => {
  test.setTimeout(120_000);
  await disableAudio(page);
  await page.setViewportSize({ width: 844, height: 390 });
  await openAndStartTest(page);
  for (let ordinal = 1; ordinal <= 9; ordinal += 1) {
    await expect(page.locator("#p1-trial-number")).toHaveText(`${ordinal} / 30`);
    await page.locator("#p1-skip").dispatchEvent("click");
    await expect(page.locator("#p1-progress")).toHaveText(`${ordinal} / 30`);
  }
  await expect(page.locator("#p1-trial-number")).toHaveText("10 / 30");
  await page.locator("#p1-skip").dispatchEvent("click");
  // The next movement is shown and waits: nothing advances on its own here.
  await expect(page.locator("#stage-tap")).toBeVisible();
  await expect(page.locator("#p1-state")).toHaveText("画面をタップして開始");
  await page.waitForTimeout(3_000);
  await expect(page.locator("#p1-trial-number")).toHaveText("—");
  await expectTopmost(page, "#p1-pause");

  // A reaction noticed while the next movement is shown belongs to the block that just ended.
  await page.locator("#p1-false-trigger").dispatchEvent("click");
  const report = await downloadJson(page, () => page.locator("#p1-export").dispatchEvent("click")) as {
    protocol: { falseTriggers: Array<{ gestureType: string }> };
  };
  expect(report.protocol.falseTriggers.map(({ gestureType }) => gestureType)).toEqual(["ribbon-swipe"]);

  // Pausing works while the prompt waits.
  await page.getByRole("button", { name: "中断", exact: true }).click();
  await expect(page.locator("#p1-state")).toHaveText("中断中");
  await expect(page.locator("#stage-tap")).toBeHidden();

  // Restarting discards the recorded trials, so it asks first.
  page.once("dialog", (dialog) => void dialog.dismiss());
  await page.getByRole("button", { name: "テストを最初からやり直す" }).click();
  await expect(page.locator("#p1-progress")).toHaveText("10 / 30");
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "テストを最初からやり直す" }).click();
  await expect(page.locator("#p1-progress")).toHaveText("0 / 30");
});

test("pauses when the page is hidden, also between trials", async ({ page }) => {
  await disableAudio(page);
  await openAndStartTest(page);

  await setVisibility(page, "hidden");
  await expect(page.locator("#p1-block")).toHaveAttribute("data-state", "paused");
  await setVisibility(page, "visible");
  await page.getByRole("button", { name: "再開", exact: true }).click();
  await expect(page.locator("#p1-trial-number")).toHaveText("1 / 30");
  // Hidden while the result is shown between trials: the next trial must not start on return.
  // Skipping and hiding run in one task, so on a busy machine the 1-second result hold cannot
  // run out in between and start the next trial first.
  await expect(page.getByRole("button", { name: "反応しなかったので次へ" })).toBeEnabled();
  const stateWhenHidden = await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>("#p1-skip")?.click();
    const state = document.querySelector("#p1-state")?.textContent ?? null;
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
    return state;
  });
  expect(stateWhenHidden).toContain("次の動きまで");
  await expect(page.locator("#p1-block")).toHaveAttribute("data-state", "paused");
  await setVisibility(page, "visible");
  await expect(page.locator("#p1-state")).toHaveText("中断中");
  await expect(page.locator("#p1-trial-number")).toHaveText("—");
  await page.getByRole("button", { name: "再開", exact: true }).click();
  await expect(page.locator("#p1-trial-number")).toHaveText("2 / 30");

  await page.getByRole("button", { name: "中断", exact: true }).click();
  const report = await downloadJson(page, () => page.getByRole("button", { name: "結果を保存" }).click()) as {
    protocol: { blocks: Array<{ pauses: Array<{ reason: string; abandonedTrialId: string | null }> }> };
  };
  expect(report.protocol.blocks[0]?.pauses).toEqual([
    expect.objectContaining({ reason: "page-hidden", abandonedTrialId: "ribbon-swipe-1" }),
    expect.objectContaining({ reason: "page-hidden", abandonedTrialId: null }),
    expect.objectContaining({ reason: "manual", abandonedTrialId: "ribbon-swipe-2" }),
  ]);
});

test("pauses when the camera stops and resumes only after the camera starts again", async ({ page }) => {
  await disableAudio(page);
  await page.goto("/?tracking=mock&trackingScenario=none&view=analysis&protocol=five");
  await page.getByRole("button", { name: "カメラを開始" }).click();
  await expect(page.locator("#tracking-init")).toHaveText("準備完了");
  await page.getByRole("button", { name: "テストを開始" }).click();
  await expect(page.locator("#p1-trial-number")).toHaveText("1 / 50");

  await page.getByRole("button", { name: "カメラを停止" }).click();
  await expect(page.locator("#p1-block")).toHaveAttribute("data-state", "paused");
  await expect(page.locator("#p1-block-message")).toContainText("カメラが止まっています");
  await expect(page.getByRole("button", { name: "再開", exact: true })).toBeDisabled();
  await expect(page.locator("#p1-remaining")).toHaveText("—");
  await page.getByRole("button", { name: "カメラを開始" }).click();
  await expect(page.locator("#tracking-init")).toHaveText("準備完了");
  await page.getByRole("button", { name: "再開", exact: true }).click();
  await expect(page.locator("#p1-trial-number")).toHaveText("1 / 50");

  await page.getByRole("button", { name: "中断", exact: true }).click();
  const report = await downloadJson(page, () => page.getByRole("button", { name: "P1結果JSONを保存" }).click()) as {
    protocol: { blocks: Array<{ pauses: Array<{ reason: string; abandonedTrialId: string | null }> }> };
  };
  expect(report.protocol.blocks[0]?.pauses).toEqual([
    expect.objectContaining({ reason: "camera-stopped", abandonedTrialId: "air-tap-1" }),
    expect.objectContaining({ reason: "manual", abandonedTrialId: "air-tap-1" }),
  ]);
});

test("runs a trial without a count-in while the audio clock is suspended and brings it back on resume", async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    const Original = window.AudioContext;
    const store = window as unknown as { __audioContexts: AudioContext[] };
    store.__audioContexts = [];
    window.AudioContext = class extends Original {
      constructor(options?: AudioContextOptions) {
        super(options);
        store.__audioContexts.push(this);
      }
    };
  });
  const audioState = () => page.evaluate(() => (
    (window as unknown as { __audioContexts: AudioContext[] }).__audioContexts[0]?.state ?? null
  ));
  await openAndStartTest(page);
  await expect.poll(audioState).toBe("running");
  await page.evaluate(() => (window as unknown as { __audioContexts: AudioContext[] }).__audioContexts[0]!.suspend());
  await expect.poll(audioState).toBe("suspended");
  // A suspended audio clock stands still; a GO computed from it after a while would lie in the past.
  await page.waitForTimeout(2_000);
  await page.getByRole("button", { name: "反応しなかったので次へ" }).click();
  await expect(page.locator("#p1-trial-number")).toHaveText("2 / 30");
  await expect(page.locator("#p1-remaining")).toHaveText(/^(10|9)秒$/);
  await expect(page.locator("#p1-block-message")).toContainText("カウント音なし");

  // "中断" and "再開" resume the audio inside the button press.
  await page.getByRole("button", { name: "中断", exact: true }).click();
  await page.getByRole("button", { name: "再開", exact: true }).click();
  await expect.poll(audioState).toBe("running");
  // Record every state from the skip on: on a busy machine the 1-second count-in can pass
  // between two separate checks.
  await expect(page.getByRole("button", { name: "反応しなかったので次へ" })).toBeEnabled();
  await page.evaluate(() => {
    const states: string[] = [];
    (window as unknown as { __p1States: string[] }).__p1States = states;
    const label = document.querySelector("#p1-state")!;
    new MutationObserver(() => states.push(label.textContent ?? ""))
      .observe(label, { childList: true, characterData: true, subtree: true });
    document.querySelector<HTMLButtonElement>("#p1-skip")?.click();
  });
  await expect(page.locator("#p1-trial-number")).toHaveText("3 / 30");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __p1States: string[] }).__p1States))
    .toContain("2");
  await expect(page.locator("#p1-block-message")).not.toContainText("カウント音なし");
});

test("schedules the Bloom count-in only after the start position settles", async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    const store = window as unknown as { __clickTimes: number[] };
    store.__clickTimes = [];
    const originalStart = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function start(this: OscillatorNode, when?: number) {
      store.__clickTimes.push(performance.now());
      return originalStart.call(this, when);
    };
  });
  // Bloom is no longer in the default procedure, so this check asks for the 20-trial one.
  await openAndStartTest(page, "?tracking=mock&protocol=remaining-two", 20);
  for (let ordinal = 1; ordinal <= 10; ordinal += 1) {
    await expect(page.locator("#p1-trial-number")).toHaveText(`${ordinal} / 20`);
    await page.getByRole("button", { name: "反応しなかったので次へ" }).click();
    await expect(page.locator("#p1-progress")).toHaveText(`${ordinal} / 20`);
  }
  await tapStage(page);
  const blockStartedAt = await page.evaluate(() => {
    (window as unknown as { __clickTimes: number[] }).__clickTimes.length = 0;
    return performance.now();
  });
  await expect(page.locator("#p1-state")).toHaveText(/準備OK|カウント|^[12]$|GO|判定中/, { timeout: 15_000 });
  const clickTimes = await page.evaluate(() => (window as unknown as { __clickTimes: number[] }).__clickTimes);

  expect(clickTimes).toHaveLength(3);
  // Readiness needs about 200ms of settled hands, so nothing can be scheduled when the trial appears.
  expect(Math.min(...clickTimes) - blockStartedAt).toBeGreaterThanOrEqual(200);
});

test("keeps the buttons on screen in landscape when the performance warning appears", async ({ page }) => {
  await disableAudio(page);
  await page.setViewportSize({ width: 844, height: 390 });
  await openAndStartTest(page);
  for (const viewport of [{ width: 844, height: 390 }, { width: 740, height: 360 }, { width: 667, height: 375 }]) {
    await page.setViewportSize(viewport);
    // The warning sits small on the camera image and must not push a button off screen.
    const placement = await page.evaluate(() => {
      const warning = document.getElementById("p1-performance-warning");
      const skip = document.getElementById("p1-skip");
      const preview = document.getElementById("preview-shell");
      if (warning === null || skip === null || preview === null) throw new Error("P1 controls are missing.");
      warning.hidden = false;
      warning.textContent = "手の認識が遅れています";
      const rect = skip.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      const warningRect = warning.getBoundingClientRect();
      const previewRect = preview.getBoundingClientRect();
      if (warningRect.bottom > previewRect.bottom + 1) throw new Error("The warning left the camera image.");
      return { topmost: hit !== null && (hit === skip || skip.contains(hit)), bottom: rect.bottom, height: window.innerHeight };
    });

    expect(placement.topmost, `${viewport.width}×${viewport.height}`).toBe(true);
    expect(placement.bottom, `${viewport.width}×${viewport.height}`).toBeLessThanOrEqual(placement.height);
  }
});

test("does not undo a pause with the second click of a double click", async ({ page }) => {
  await disableAudio(page);
  await openAndStartTest(page);
  const pause = page.getByRole("button", { name: "中断", exact: true });
  await expect(pause).toBeEnabled();
  await pause.dblclick();
  await expect(page.locator("#p1-block")).toHaveAttribute("data-state", "paused");
  await expect(page.getByRole("button", { name: "再開", exact: true })).toBeEnabled();
  await expect(page.locator("#p1-block")).toHaveAttribute("data-state", "paused");

  const report = await downloadJson(page, () => page.getByRole("button", { name: "結果を保存" }).click()) as {
    protocol: { blocks: Array<{ pauses: Array<{ resumedAtMs: number | null }> }> };
  };
  expect(report.protocol.blocks[0]?.pauses).toEqual([expect.objectContaining({ resumedAtMs: null })]);
});

test("compares five-gesture sessions and counts a session saved twice once", async ({ page }) => {
  await page.goto("/?view=analysis");
  await page.locator("#p1-comparison-import").setInputFiles([
    jsonFile("android.json", fiveGestureComparisonDocument("android", "android-agent")),
    jsonFile("iphone.json", fiveGestureComparisonDocument("iphone", "iphone-agent")),
    jsonFile("android (1).json", fiveGestureComparisonDocument("android", "android-agent", "2026-09-14T02:00:00.000Z")),
  ]);

  await expect(page.locator("#p1-comparison-status")).toHaveText("2セッション · 完全 2 · 8/10候補 2");
  const rows = page.locator("#p1-comparison-body tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.first().locator("td").nth(3)).toHaveText("50/50");
  await expect(rows.first().locator("td").nth(7)).toHaveText("8/10");
  await expect(rows.first().locator("td").nth(8)).toHaveText("8/10");
  await expect(page.locator("#p1-comparison-findings")).toContainText("読込済み");
  await expect(page.locator("#p1-comparison-findings")).toContainText("Lift／Spotlight／ななめリフトは候補動作");
});

async function disableAudio(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, "AudioContext", { value: undefined });
  });
}

/**
 * The tester screen starts with one press and then waits for a tap on the camera image.
 * The prompt ignores presses for 400ms, so the tap comes after that.
 */
async function tapStage(page: Page): Promise<void> {
  await expect(page.locator("#stage-tap")).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(450);
  await page.locator("#preview-shell").click({ force: true, position: { x: 12, y: 12 } });
}

/** `total` follows the procedure the query asks for: 30 by default, 20 with ?protocol=remaining-two. */
async function openAndStartTest(
  page: Page,
  query = "?tracking=mock&trackingScenario=none",
  total = 30,
): Promise<void> {
  await page.goto(`/${query}`);
  await page.getByRole("button", { name: "はじめる" }).click();
  await expect(page.locator("#tracking-init")).toHaveText("準備完了");
  await tapStage(page);
  await expect(page.locator("#p1-trial-number")).toHaveText(`1 / ${total}`);
}

async function setVisibility(page: Page, state: "hidden" | "visible"): Promise<void> {
  await page.evaluate((value) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => value });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => value === "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
}

/** The element is on screen and nothing (such as the sticky heading) covers its center. */
async function expectTopmost(page: Page, selector: string): Promise<void> {
  await expect.poll(() => page.evaluate((target) => {
    const element = document.querySelector(target);
    if (!(element instanceof HTMLElement) || element.hidden) return "missing";
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    if (hit !== null && (hit === element || element.contains(hit))) return "topmost";
    return hit === null ? "off-screen" : `${hit.tagName}#${hit.id}.${hit.className}`;
  }, selector)).toBe("topmost");
}

async function downloadJson(page: Page, trigger: () => Promise<unknown>): Promise<unknown> {
  const downloadPromise = page.waitForEvent("download");
  await trigger();
  const download: Download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  return JSON.parse(await readFile(path!, "utf8"));
}

function jsonFile(name: string, document: unknown): { name: string; mimeType: string; buffer: Buffer } {
  return { name, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(document)) };
}

function fiveGestureComparisonDocument(
  sessionId: string,
  userAgent: string,
  createdAtIso = "2026-09-14T00:00:00.000Z",
): unknown {
  const gestures = ["air-tap", "ribbon-swipe", "bloom", "lift", "spotlight"];
  const summary = {
    completed: 10,
    success: 8,
    playerMiss: 0,
    machineMiss: 0,
    falseTrigger: 0,
    trackingLoss: 1,
    unclassified: 1,
  };
  const results = gestures.flatMap((gesture, block) => Array.from({ length: 10 }, (_, position) => ({
    trial: {
      id: `${gesture}-${position + 1}`,
      ordinal: block * 10 + position + 1,
      gesture,
      ...(gesture === "spotlight"
        ? { spotlightVariant: position % 2 === 0 ? "left-up-right-down" : "right-up-left-down" }
        : {}),
    },
    attempt: 1,
    outcome: position < 8 ? "success" : position === 8 ? "tracking-loss" : "unclassified",
  })));
  return {
    schema: "oto-motion-p1-controlled",
    schemaVersion: 5,
    createdAtIso,
    gestureVocabulary: { thirdGesture: "bloom", gestures, candidateGestures: ["lift", "spotlight"] },
    session: { sessionId, createdAtIso, appVersion: "e2e-build", provider: null, notes: "" },
    privacy: {
      includesCameraFrames: false,
      includesAudio: false,
      derivedLandmarksOnly: true,
      includesReplayFrames: false,
    },
    protocol: {
      id: "p1-five-gesture-50",
      trialsPerGesture: 10,
      gestures,
      state: "complete",
      completed: 50,
      total: 50,
      results,
      falseTriggers: [],
      blocks: gestures.map((gesture, index) => ({
        index: index + 1,
        gesture,
        startedAtMs: index * 1_000,
        finishedAtMs: index * 1_000 + 900,
      })),
    },
    summary: {
      byGesture: Object.fromEntries(gestures.map((gesture) => [gesture, { ...summary }])),
      falseTriggers: 0,
    },
    technicalSnapshot: {
      appBuildId: "e2e-build",
      experimentProfileId: "gpu-640x480-30",
      requestedCameraWidth: 640,
      requestedCameraHeight: 480,
      requestedFrameRateMin: 30,
      requestedFrameRateIdeal: 30,
      actualCameraWidth: 640,
      actualCameraHeight: 480,
      actualCameraFrameRate: 30,
      requestedDelegate: "GPU",
      delegate: "GPU",
      requestedModelId: "model",
      modelId: "model",
      userAgent,
      viewport: "844 × 390",
      trackingHz: 25,
      inferenceP95Ms: 40,
      frameAgeP95Ms: 100,
      twoHandCoverage: 0.95,
      inFlightFrames: 0,
      pendingFrames: 0,
    },
  };
}

function comparisonDocument(sessionId: string, userAgent: string): unknown {
  const gesture = {
    completed: 10,
    success: 8,
    playerMiss: 0,
    machineMiss: 0,
    falseTrigger: 0,
    trackingLoss: 1,
    unclassified: 1,
  };
  return {
    schema: "oto-motion-p1-controlled",
    schemaVersion: 3,
    createdAtIso: "2026-07-24T00:00:00.000Z",
    session: {
      sessionId,
      createdAtIso: "2026-07-24T00:00:00.000Z",
      appVersion: "e2e-build",
      provider: null,
      notes: "",
    },
    privacy: {
      includesCameraFrames: false,
      includesAudio: false,
      derivedLandmarksOnly: true,
      includesReplayFrames: false,
    },
    protocol: {
      state: "complete",
      completed: 30,
      total: 30,
      results: Array.from({ length: 30 }, (_, index) => {
        const position = index % 10;
        return {
          trial: {
            ordinal: index + 1,
            gesture: index < 10
              ? "air-tap"
              : index < 20
                ? "ribbon-swipe"
                : "clap",
          },
          outcome: position < 8
            ? "success"
            : position === 8
              ? "tracking-loss"
              : "unclassified",
        };
      }),
      falseTriggers: [],
    },
    summary: {
      byGesture: {
        "air-tap": gesture,
        "ribbon-swipe": gesture,
        clap: gesture,
      },
    },
    technicalSnapshot: {
      appBuildId: "e2e-build",
      experimentProfileId: "baseline-gpu-640x480-60",
      requestedCameraWidth: 640,
      requestedCameraHeight: 480,
      requestedFrameRateMin: 30,
      requestedFrameRateIdeal: 60,
      actualCameraWidth: 640,
      actualCameraHeight: 480,
      actualCameraFrameRate: 30,
      requestedDelegate: "GPU",
      delegate: "GPU",
      requestedModelId: "model",
      modelId: "model",
      userAgent,
      viewport: "844 × 390",
      trackingHz: 25,
      inferenceP95Ms: 40,
      frameAgeP95Ms: 100,
      twoHandCoverage: 0.95,
      inFlightFrames: 0,
      pendingFrames: 0,
    },
  };
}
