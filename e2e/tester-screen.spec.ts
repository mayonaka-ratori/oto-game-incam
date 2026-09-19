import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function fullyVisible(page: Page, selectors: string[]): Promise<void> {
  for (const selector of selectors) {
    await expect(page.locator(selector)).toBeInViewport({ ratio: 1 });
    const clear = await page.locator(selector).evaluate((element) => {
      const r = element.getBoundingClientRect();
      return [[.1, .1], [.5, .5], [.9, .9]].every(([x, y]) => {
        const hit = document.elementFromPoint(r.left + r.width * x!, r.top + r.height * y!);
        return hit !== null && (hit === element || element.contains(hit));
      });
    });
    expect(clear, `${selector} is not covered`).toBe(true);
  }
  expect(await page.evaluate(() => ({
    page: document.documentElement.scrollHeight <= window.innerHeight,
    width: document.documentElement.scrollWidth <= window.innerWidth,
    panel: (() => { const p = document.querySelector(".p1-panel")!; return p.scrollHeight <= p.clientHeight + 1; })(),
  }))).toEqual({ page: true, width: true, panel: true });
}

for (const viewport of [{ width: 920, height: 362 }, { width: 844, height: 390 },
  { width: 667, height: 375 }, { width: 390, height: 844 }, { width: 360, height: 640 }]) {
  test(`all gestures and both exports fit ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    await page.addInitScript(() => Object.defineProperty(window, "AudioContext", { value: undefined }));
    await page.goto("/?tracking=mock&trackingScenario=none");
    await page.getByRole("button", { name: "カメラを開始" }).click();
    await expect(page.locator("#tracking-init")).toHaveText("準備完了");
    await page.clock.install();
    await page.getByRole("button", { name: "テストを開始", exact: true }).click();
    await page.clock.fastForward(450);
    await page.getByRole("button", { name: "中断", exact: true }).click();
    await fullyVisible(page, ["#p1-state", "#p1-instruction", "#p1-resume", "#p1-start-session", "#p1-export", "#p1-export-replay"]);
    await page.screenshot({ path: testInfo.outputPath("paused.png") });
    await page.clock.fastForward(450);
    await page.getByRole("button", { name: "再開", exact: true }).click();
    for (let ordinal = 1; ordinal <= 50; ordinal++) {
      await expect(page.locator("#p1-trial-number")).toHaveText(`${ordinal} / 50`);
      if (ordinal % 10 === 1) {
        await fullyVisible(page, ["#preview-shell", "#p1-instruction", "#p1-motion-sample", "#p1-state",
          "#p1-gesture", "#p1-remaining", "#p1-progress", "#p1-skip", "#p1-pause", "#p1-false-trigger"]);
        await page.screenshot({ path: testInfo.outputPath(`trial-${ordinal}.png`) });
      }
      await page.locator("#p1-skip").click();
      await page.clock.fastForward(ordinal % 10 === 0 ? 2_501 : 1_001);
    }
    await expect(page.locator("#p1-block-title")).toHaveText("50回すべて記録しました");
    await fullyVisible(page, ["#p1-block-title", "#p1-export", "#p1-export-replay", "#p1-start-session"]);
    await expect(page.locator("#p1-motion-sample")).toBeHidden();
    await expect(page.locator("#p1-skip")).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath("complete.png") });
    // Let actual mock frames finish the diagnostic post-roll before downloading.
    await page.clock.resume();
    for (const id of ["#p1-export", "#p1-export-replay"]) {
      const download = page.waitForEvent("download");
      await page.locator(id).click();
      const file = await download;
      const data = JSON.parse(await readFile((await file.path())!, "utf8"));
      if (id === "#p1-export") expect(data.protocol.results).toHaveLength(50);
      else {
        expect(data.schemaVersion).toBe(3);
        expect(data.frames.length).toBeGreaterThan(0);
        expect(data.trialWindows).toHaveLength(51);
      }
    }
    await fullyVisible(page, ["#p1-export", "#p1-export-replay", "#p1-export-status", "#p1-replay-export-status"]);
  });
}
