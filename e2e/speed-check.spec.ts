import { expect, test, type Download, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

/** Short enough that the whole seven-step run fits in one browser test. */
const MEASURE_MS = 1_500;
const SPEED_CHECK_URL = `/?mode=speedcheck&tracking=mock&speedcheckMs=${MEASURE_MS}`;

interface SpeedCheckStepResult {
  readonly ordinal: number;
  readonly id: string;
  readonly requested: {
    readonly delegate: string;
    readonly cameraWidth: number;
    readonly frameSourceOverride: string;
    readonly pendingPolicy: string;
    readonly measureMs: number;
  };
  readonly actual: { readonly frameSource: string | null };
  readonly trackingHz: number | null;
  readonly inferenceP50Ms: number | null;
  readonly trackingResultCount: number;
  readonly twoHandCoverage: number | null;
  readonly handsVisibleEnough: boolean;
  readonly scheduler: { readonly captured: number; readonly completed: number } | null;
  readonly error: string | null;
}

interface SpeedCheckReport {
  readonly schema: string;
  readonly schemaVersion: number;
  readonly runId: string;
  readonly appBuildId: string;
  readonly measureMsOverride: number | null;
  readonly completion: {
    readonly status: string;
    readonly plannedStepCount: number;
    readonly measuredStepCount: number;
  };
  readonly viewport: { readonly width: number | null };
  readonly steps: readonly SpeedCheckStepResult[];
  readonly fastestStep: { readonly ordinal: number; readonly trackingHz: number } | null;
}

function collectDownloads(page: Page): Download[] {
  const downloads: Download[] = [];
  page.on("download", (download) => downloads.push(download));
  return downloads;
}

async function runWholeCheck(page: Page): Promise<void> {
  await page.goto(SPEED_CHECK_URL);
  await expect(page.getByRole("heading", { name: "端末の速さを自動で測ります" })).toBeVisible();
  await page.getByRole("button", { name: "はじめる" }).click();
  await expect(page.locator("#speed-progress")).toHaveText("1 / 7 を計測中");
  // Every step runs, in order, without another tap.
  for (let ordinal = 2; ordinal <= 7; ordinal += 1) {
    await expect(page.locator("#speed-progress")).toHaveText(`${ordinal} / 7 を計測中`, { timeout: 60_000 });
  }
  await expect(page.getByRole("heading", { name: "計測が終わりました" })).toBeVisible({ timeout: 60_000 });
}

test("one tap measures every setting and saves one result file", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const downloads = collectDownloads(page);
  await runWholeCheck(page);

  await expect(page.locator("#speed-fastest")).toContainText("いちばん速かった設定:");
  await page.getByRole("button", { name: "結果を保存" }).click();
  await expect.poll(() => downloads.length).toBe(1);
  const file = downloads[0]!;
  expect(file.suggestedFilename()).toMatch(/^speedcheck-\d{17}\.json$/);

  const report = JSON.parse(await readFile((await file.path())!, "utf8")) as SpeedCheckReport;
  expect(report.schema).toBe("oto-motion-speed-check");
  expect(report.schemaVersion).toBe(1);
  expect(report.measureMsOverride).toBe(MEASURE_MS);
  expect(report.completion).toMatchObject({
    status: "completed",
    plannedStepCount: 7,
    measuredStepCount: 7,
  });
  expect(report.steps).toHaveLength(7);
  expect(report.viewport.width).toBe(390);
  expect(report.appBuildId.length).toBeGreaterThan(0);

  expect(report.steps.map((step) => [step.ordinal, step.id])).toEqual([
    [1, "gpu-640-auto-hold"],
    [2, "gpu-640-auto-drop"],
    [3, "gpu-640-rvfc-hold"],
    [4, "cpu-640-auto-hold"],
    [5, "cpu-640-rvfc-hold"],
    [6, "gpu-320-auto-hold"],
    [7, "gpu-640-auto-hold-repeat"],
  ]);

  for (const step of report.steps) {
    expect(step.error, `step ${step.ordinal} failed`).toBeNull();
    expect(step.requested.measureMs).toBe(MEASURE_MS);
    expect(step.trackingResultCount).toBeGreaterThan(0);
    expect(step.trackingHz).toBeGreaterThan(0);
    expect(step.inferenceP50Ms).not.toBeNull();
    expect(step.twoHandCoverage).toBe(1);
    expect(step.handsVisibleEnough).toBe(true);
    expect(step.scheduler!.captured).toBeGreaterThan(0);
    expect(step.scheduler!.completed).toBeGreaterThan(0);
  }

  // The forced capture paths really took effect, and the repeat used the default one again.
  expect(report.steps[0]!.actual.frameSource).toBe("MediaStreamTrackProcessor");
  expect(report.steps[2]!.actual.frameSource).toBe("requestVideoFrameCallback");
  expect(report.steps[4]!.actual.frameSource).toBe("requestVideoFrameCallback");
  expect(report.steps[6]!.actual.frameSource).toBe("MediaStreamTrackProcessor");
  expect(report.steps[1]!.requested.pendingPolicy).toBe("drop");
  expect(report.steps[5]!.requested.cameraWidth).toBe(320);

  expect(report.fastestStep).not.toBeNull();
  await expect(page.locator("#speed-save-status")).toContainText(file.suggestedFilename());
  await expect(page.locator("#speed-save-status")).toContainText("このファイルを送ってください");
});

test("やめる stops the run and still saves what was measured", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const downloads = collectDownloads(page);
  await page.goto(SPEED_CHECK_URL);
  await page.getByRole("button", { name: "はじめる" }).click();
  await expect(page.locator("#speed-progress")).toHaveText("2 / 7 を計測中", { timeout: 60_000 });
  await page.getByRole("button", { name: "やめる" }).click();

  await expect(page.getByRole("heading", { name: "計測を途中でやめました" })).toBeVisible();
  await expect(page.locator("#speed-abort-reason")).toContainText("やめる");
  await page.getByRole("button", { name: "結果を保存" }).click();
  await expect.poll(() => downloads.length).toBe(1);
  const report = JSON.parse(
    await readFile((await downloads[0]!.path())!, "utf8"),
  ) as SpeedCheckReport;
  expect(report.completion.status).toBe("aborted");
  expect(report.completion.plannedStepCount).toBe(7);
  expect(report.steps.length).toBeGreaterThanOrEqual(1);
  expect(report.steps.length).toBeLessThan(7);
});

test("the lab screen is unchanged without ?mode=speedcheck", async ({ page }) => {
  await page.goto("/?tracking=mock&trackingScenario=none");
  await expect(page.locator("#speed-check, #speed-start")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "はじめる" })).toBeVisible();
  await expect(page.locator("#preview-shell")).toBeVisible();
});
