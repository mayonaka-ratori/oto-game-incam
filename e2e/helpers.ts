import { expect, type Download, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

/** The tap prompt ignores presses for 400ms, so a double tap cannot skip a movement. */
const TAP_LOCK_MS = 450;

/** The tester screen starts with one press and then waits for a tap on the camera image. */
export async function tapStage(page: Page): Promise<void> {
  await expect(page.locator("#stage-tap")).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(TAP_LOCK_MS);
  await page.locator("#preview-shell").click({ force: true, position: { x: 12, y: 12 } });
}

/** Collects every file the page downloads from now on. */
export function collectDownloads(page: Page): Download[] {
  const downloads: Download[] = [];
  page.on("download", (download) => downloads.push(download));
  return downloads;
}

/** Runs the trigger and parses the first file it downloads. */
export async function downloadJson(page: Page, trigger: () => Promise<unknown>): Promise<unknown> {
  const downloadPromise = page.waitForEvent("download");
  await trigger();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  return JSON.parse(await readFile(path, "utf8"));
}

export async function disableAudio(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, "AudioContext", { value: undefined });
  });
}
