import { expect, test } from "@playwright/test";

test("starts, measures, hides, and releases the camera", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Camera Diagnostics" })).toBeVisible();
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
