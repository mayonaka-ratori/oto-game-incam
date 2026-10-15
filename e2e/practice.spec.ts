import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test.use({ permissions: [], viewport: { width: 390, height: 844 } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // Any attempt to start a camera or microphone must fail this camera-free experience.
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: () => { throw new Error("Camera and microphone must not be requested in practice."); },
    });
  });
});

test("plays a real 30-second song, follows the guide, saves feedback and restarts without tracking", async ({ page }, testInfo) => {
  test.setTimeout(65_000);
  const errors: string[] = [];
  const trackingRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (/mediapipe|\.wasm|\.task|tracking-worker/.test(request.url())) trackingRequests.push(request.url());
  });
  await page.goto("/?mode=practice");
  const state = page.locator("[data-practice-state]");
  await expect(page.getByRole("heading", { name: "両手を 楽な高さに" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.locator("#practice-start")).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("ready.png"), fullPage: true });
  const startAt = Date.now();
  await page.getByRole("button", { name: "音を出して はじめる" }).click();
  await expect(state).toHaveAttribute("data-practice-state", "countdown");
  await expect(page.locator("#practice-countdown")).toBeVisible();
  await expect(state).toHaveAttribute("data-practice-state", "playing", { timeout: 6000 });
  await expect(page.getByRole("heading", { name: "両手を 右上へ" })).toBeVisible();
  await expect(page.locator("#practice-next")).toHaveText("両手を 戻す");
  const wrist = page.locator("#practice-hand-left");
  const firstPosition = await wrist.getAttribute("transform");
  await expect.poll(() => wrist.getAttribute("transform")).not.toBe(firstPosition);
  await page.screenshot({ path: testInfo.outputPath("playing.png"), fullPage: true });
  await expect(page.getByRole("heading", { name: "腕を下ろして ひと休み" })).toBeVisible({ timeout: 13_000 });
  await page.screenshot({ path: testInfo.outputPath("rest.png"), fullPage: true });
  await expect(page.getByRole("heading", { name: "両手を 上へ" })).toBeVisible({ timeout: 5000 });
  await expect(state).toHaveAttribute("data-practice-state", "finished", { timeout: 23_000 });
  expect(Date.now() - startAt).toBeGreaterThanOrEqual(32_000);
  expect(Date.now() - startAt).toBeLessThan(40_000);
  await expect(page.getByRole("heading", { name: "30秒 おつかれさま" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("finished.png"), fullPage: true });
  await page.getByLabel("動きやすかった", { exact: true }).check();
  await page.getByLabel("少し疲れた", { exact: true }).check();
  await page.getByLabel("やりたい", { exact: true }).check();
  await page.getByLabel("気になったところ（任意）").fill("右上への動きが分かりやすかった");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "感想をファイルに保存" }).click();
  const download = await downloadPromise;
  const feedback = JSON.parse(await readFile((await download.path())!, "utf8")) as Record<string, unknown>;
  expect(feedback).toMatchObject({ durationSec: 30, cameraUsed: false, ease: "動きやすかった", fatigue: "少し疲れた", replay: "やりたい" });
  await page.getByRole("button", { name: "もう一度 動いてみる" }).click();
  await expect(state).toHaveAttribute("data-practice-state", "countdown");
  await expect(page.locator("#practice-remaining")).toHaveText("30");
  await page.getByRole("button", { name: "やめる", exact: true }).click();
  await expect(state).toHaveAttribute("data-practice-state", "interrupted");
  expect(trackingRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test("stops on hiding the page and does not resume on its own", async ({ page }) => {
  await page.goto("/?mode=practice");
  await page.getByRole("button", { name: "音を出して はじめる" }).click();
  await expect(page.locator("[data-practice-state]")).toHaveAttribute("data-practice-state", "countdown");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator("#practice-status")).toContainText("画面を離れたため止めました");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator("[data-practice-state]")).toHaveAttribute("data-practice-state", "interrupted");
  await expect(page.getByRole("button", { name: "音を出して はじめる" })).toBeVisible();
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  });
  await page.getByRole("button", { name: "音を出して はじめる" }).click();
  await expect(page.locator("[data-practice-state]")).toHaveAttribute("data-practice-state", "countdown");
  await page.getByRole("button", { name: "やめる", exact: true }).click();
});

test("explains an unavailable audio engine without starting a silent exercise", async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, "AudioContext", { value: undefined }); });
  await page.goto("/?mode=practice");
  await page.getByRole("button", { name: "音を出して はじめる" }).click();
  await expect(page.locator("#practice-status")).toContainText("音を開始できませんでした");
  await expect(page.locator("[data-practice-state]")).toHaveAttribute("data-practice-state", "interrupted");
});
