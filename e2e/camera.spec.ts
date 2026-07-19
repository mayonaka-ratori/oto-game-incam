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
  await expect(video).toBeHidden();
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
