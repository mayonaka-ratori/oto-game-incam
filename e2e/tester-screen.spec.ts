import { expect, test, type Download, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

/** The tap prompt ignores presses for a moment, so a double tap cannot skip a movement. */
const TAP_LOCK_MS = 450;

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

async function tapStage(page: Page): Promise<void> {
  await expect(page.locator("#stage-tap")).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(TAP_LOCK_MS);
  await page.locator("#preview-shell").click({ force: true, position: { x: 12, y: 12 } });
}

/** Collects every file the page downloads from now on. */
function collectDownloads(page: Page): Download[] {
  const downloads: Download[] = [];
  page.on("download", (download) => downloads.push(download));
  return downloads;
}

async function beginTest(page: Page, query = "?tracking=mock&trackingScenario=none"): Promise<void> {
  await page.goto(`/${query}`);
  await page.getByRole("button", { name: "はじめる" }).click();
  await expect(page.locator("#tracking-init")).toHaveText("準備完了");
}

const viewports = [
  { width: 1023, height: 403 },
  { width: 920, height: 362 },
  { width: 844, height: 390 },
  { width: 667, height: 375 },
  { width: 390, height: 844 },
  { width: 360, height: 640 },
];

for (const viewport of viewports) {
  test(`the camera, the guide and the controls fit ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await page.setViewportSize(viewport);
    await page.addInitScript(() => Object.defineProperty(window, "AudioContext", { value: undefined }));
    await beginTest(page);

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
    await expect(page.locator(".p1-instruction")).toBeHidden();
    await expect(page.locator("#p1-motion-sample")).toBeHidden();
    await expect(page.locator("#state-card")).toBeHidden();
    await expect(page.getByRole("button", { name: "プレビューを隠す" })).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath("trial.png") });

    await page.getByRole("button", { name: "中断", exact: true }).click();
    await expect(page.locator("#p1-block")).toHaveAttribute("data-state", "paused");
    await clickable(page, ["#p1-resume", "#p1-export", "#p1-start-session", "#stop-camera"]);
    await page.screenshot({ path: testInfo.outputPath("paused.png") });
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
  await page.addInitScript(() => Object.defineProperty(window, "AudioContext", { value: undefined }));
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
    schemaVersion: number;
    protocol: { id: string; total: number };
  };
  expect(report.schemaVersion).toBe(8);
  expect(report.protocol).toMatchObject({ id: "p1-portrait-three-30", total: 30 });
  const diagnostic = JSON.parse(await readFile((await replay.path())!, "utf8")) as { schemaVersion: number };
  expect(diagnostic.schemaVersion).toBe(3);

  await expect(page.locator("#p1-export-status")).toHaveText("保存した2つのファイルを送ってください。");
  await expect(page.locator("#p1-replay-export-status")).toContainText(result.suggestedFilename());
  await expect(page.locator("#p1-replay-export-status")).toContainText(replay.suggestedFilename());
  await expect(page.getByRole("button", { name: "診断データだけをもう一度保存" })).toBeVisible();
});

test("the five-gesture protocol still runs, one tap per movement", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.addInitScript(() => Object.defineProperty(window, "AudioContext", { value: undefined }));
  await beginTest(page, "?tracking=mock&trackingScenario=none&protocol=five");
  await tapStage(page);
  await expect(page.locator("#p1-trial-number")).toHaveText("1 / 50");

  const instructions = new Map<number, string>([
    [1, "左手の指を 丸印からリングへ"],
    [11, "片手で 帯を左から右へ"],
    [21, "丸印から輪まで 両手を開く"],
    [31, "丸印から輪まで 両手を上げる"],
    [41, "左手を上・右手を下で 止める"],
  ]);
  for (let ordinal = 1; ordinal <= 50; ordinal += 1) {
    await expect(page.locator("#p1-trial-number")).toHaveText(`${ordinal} / 50`);
    const expected = instructions.get(ordinal);
    if (expected !== undefined) await expect(page.locator("#stage-instruction")).toHaveText(expected);
    await page.locator("#p1-skip").click();
    await expect(page.locator("#p1-progress")).toHaveText(`${ordinal} / 50`);
    if (ordinal % 10 === 0 && ordinal < 50) await tapStage(page);
  }
  await expect(page.locator("#p1-block-title")).toHaveText("50回すべて記録しました");

  const downloads = collectDownloads(page);
  await page.getByRole("button", { name: "結果を保存" }).click();
  await expect.poll(() => downloads.length).toBe(2);
  const result = downloads[0]!;
  const report = JSON.parse(await readFile((await result.path())!, "utf8")) as {
    schemaVersion: number;
    protocol: { id: string; results: unknown[] };
  };
  expect(report.schemaVersion).toBe(8);
  expect(report.protocol.id).toBe("p1-five-gesture-50");
  expect(report.protocol.results).toHaveLength(50);
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
});
