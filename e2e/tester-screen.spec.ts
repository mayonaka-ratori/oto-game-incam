import { expect, test, type Download, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { collectDownloads, disableAudio, tapStage } from "./helpers";

/** Everything is inside the screen and the page itself never scrolls. */
async function fitsOnScreen(page: Page, selectors: string[]): Promise<void> {
  for (const selector of selectors) {
    await expect(page.locator(selector)).toBeInViewport({ ratio: 1 });
  }
  expect(await page.evaluate(() => ({
    page: document.documentElement.scrollHeight <= window.innerHeight,
    width: document.documentElement.scrollWidth <= window.innerWidth,
  }))).toEqual({ page: true, width: true });
}

/** The button is on screen and nothing covers its middle. */
async function clickable(page: Page, selectors: string[]): Promise<void> {
  await fitsOnScreen(page, selectors);
  for (const selector of selectors) {
    const clear = await page.locator(selector).evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return hit !== null && (hit === element || element.contains(hit));
    });
    expect(clear, `${selector} is covered`).toBe(true);
  }
}

async function beginTest(page: Page, query = "?tracking=mock&trackingScenario=none"): Promise<void> {
  await page.goto(`/${query}`);
  await page.getByRole("button", { name: "はじめる" }).click();
  await expect(page.locator("#tracking-init")).toHaveText("準備完了");
}

/**
 * `fullRun` walks all 30 trials, so the later instructions and the finished screen are checked too.
 * The progression does not depend on the size, so only the tightest sizes do it: the narrowest
 * portrait, the narrowest landscape and the lowest landscape. The others stop after the pause.
 */
const viewports = [
  { width: 1023, height: 403, fullRun: false },
  { width: 920, height: 362, fullRun: true },
  { width: 844, height: 390, fullRun: false },
  { width: 667, height: 375, fullRun: true },
  { width: 390, height: 844, fullRun: false },
  { width: 360, height: 640, fullRun: true },
];

for (const viewport of viewports) {
  test(`the camera, the guide and the controls fit ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await disableAudio(page);
    await beginTest(page);
    await expect(page.locator("#orientation-notice")).toBeHidden();

    // Before the first movement: the camera image, the guide on it, and the prompt to start.
    await fitsOnScreen(page, ["#preview-shell", "#stage-instruction", "#stage-tap"]);
    await expect(page.locator("#stage-instruction")).toHaveText("片手で 帯を左から右へ");
    await page.screenshot({ path: testInfo.outputPath("before-start.png") });

    await tapStage(page);
    await expect(page.locator("#p1-trial-number")).toHaveText("1 / 30");
    await expect(page.locator("#stage-tap")).toBeHidden();
    // During a trial nothing but the camera image and three small buttons is on screen.
    await fitsOnScreen(page, ["#preview-shell", "#stage-instruction"]);
    await clickable(page, ["#p1-pause", "#p1-skip", "#p1-false-trigger"]);
    // The frame follows the 4:3 camera image, so the guide drawn on it is not stretched.
    const preview = await page.locator("#preview-shell").boundingBox();
    expect(preview!.width / preview!.height).toBeCloseTo(4 / 3, 1);
    await expect(page.locator(".p1-instruction")).toBeHidden();
    await expect(page.locator("#p1-motion-sample")).toBeHidden();
    await expect(page.locator("#state-card")).toBeHidden();
    await expect(page.getByRole("button", { name: "プレビューを隠す" })).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath("trial.png") });

    await page.getByRole("button", { name: "中断", exact: true }).click();
    await expect(page.locator("#p1-block")).toHaveAttribute("data-state", "paused");
    await clickable(page, ["#p1-resume", "#p1-export", "#p1-start-session", "#stop-camera"]);
    await page.screenshot({ path: testInfo.outputPath("paused.png") });
    if (!viewport.fullRun) return;
    await page.waitForTimeout(450);
    await page.getByRole("button", { name: "再開", exact: true }).click();

    // Run the whole 30-trial protocol: ten ribbon-swipe, a tap, ten Lift, a tap, ten ななめリフト.
    const nextInstruction = new Map<number, string>([
      [10, "丸印から輪まで 両手を上げる"],
      [20, "丸印から輪まで 両手を右上へ"],
    ]);
    for (let ordinal = 1; ordinal <= 30; ordinal += 1) {
      await expect(page.locator("#p1-trial-number")).toHaveText(`${ordinal} / 30`);
      const shown = nextInstruction.get(ordinal - 1);
      if (shown !== undefined) await expect(page.locator("#stage-instruction")).toHaveText(shown);
      await page.locator("#p1-skip").click();
      await expect(page.locator("#p1-progress")).toHaveText(`${ordinal} / 30`);
      const upcoming = nextInstruction.get(ordinal);
      if (upcoming !== undefined) {
        await expect(page.locator("#stage-instruction")).toHaveText(upcoming);
        await clickable(page, ["#p1-pause"]);
        await tapStage(page);
      }
    }

    await expect(page.locator("#p1-block-title")).toHaveText("30回すべて記録しました");
    await clickable(page, ["#p1-export", "#p1-start-session"]);
    await expect(page.locator("#p1-skip")).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath("complete.png") });
  });
}

test("one press of 結果を保存 writes both files and names them", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 844, height: 390 });
  await disableAudio(page);
  await beginTest(page);
  await tapStage(page);
  await expect(page.locator("#p1-trial-number")).toHaveText("1 / 30");
  await page.getByRole("button", { name: "中断", exact: true }).click();
  await expect(page.locator("#p1-block")).toHaveAttribute("data-state", "paused");

  const downloads = collectDownloads(page);
  await page.getByRole("button", { name: "結果を保存" }).click();
  await expect.poll(() => downloads.length).toBe(2);
  const [result, replay] = downloads as [Download, Download];
  expect(result.suggestedFilename()).toMatch(/^p1-\d+\.json$/);
  expect(replay.suggestedFilename()).toBe(result.suggestedFilename().replace(".json", "-diagnostic-replay.json"));
  const report = JSON.parse(await readFile((await result.path())!, "utf8")) as {
    protocol: { id: string; total: number };
  };
  expect(report.protocol).toMatchObject({ id: "p1-portrait-three-30", total: 30 });
  // The second file is the diagnostic replay: landmark frames grouped into trial windows.
  const diagnostic = JSON.parse(await readFile((await replay.path())!, "utf8")) as Record<string, unknown>;
  expect(diagnostic).toHaveProperty("frames");
  expect(diagnostic).toHaveProperty("trialWindows");

  await expect(page.locator("#p1-export-status")).toHaveText("保存した2つのファイルを送ってください。");
  await expect(page.locator("#p1-replay-export-status")).toContainText(result.suggestedFilename());
  await expect(page.locator("#p1-replay-export-status")).toContainText(replay.suggestedFilename());
  await expect(page.getByRole("button", { name: "診断データだけをもう一度保存" })).toBeVisible();
});

test("the start screen offers the tests and keeps the rest of the query", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?tracking=mock");
  await expect(page.locator('[data-test-mode="portrait-three"]')).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("button", { name: "はじめる" })).toBeInViewport({ ratio: 1 });

  await page.locator('[data-test-mode="speed-check"]').click();
  await expect(page).toHaveURL(/tracking=mock&mode=speedcheck/);
  await expect(page.locator("#speed-start")).toBeVisible();

  await page.locator('[data-test-mode="regression"]').click();
  await expect(page).toHaveURL(/tracking=mock&protocol=regression/);
  await expect(page.locator('[data-test-mode="regression"]')).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("button", { name: "はじめる" })).toBeVisible();

  // A hand-typed value in another case still marks the test the app runs.
  await page.goto("/?tracking=mock&protocol=Five");
  await expect(page.locator('[data-test-mode="five"]')).toHaveAttribute("aria-current", "true");
  await expect(page.locator('[data-test-mode="portrait-three"]')).not.toHaveAttribute("aria-current", "true");
});
