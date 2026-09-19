import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BLOOM_DEFAULTS } from "../src/gestures/bloom-state-machine";
import {
  BLOOM_PREPARATION_CENTER,
  createBloomGuideGeometry,
  isBloomPreparationPose,
} from "../src/rendering/bloom-guide";

const stylesPath = fileURLToPath(new URL("../src/ui/styles.css", import.meta.url));
const styles = readFileSync(stylesPath, "utf8");

/**
 * Reads a percentage declaration out of the first block of the given selector that has it.
 * A selector can appear in a grouped rule as well, so blocks without the property are skipped.
 */
function readPercent(selector: string, property: "left" | "top"): number {
  const pattern = new RegExp(`${property}:\\s*([\\d.]+)%`);
  for (let index = styles.indexOf(selector); index >= 0; index = styles.indexOf(selector, index + 1)) {
    const block = styles.slice(index, styles.indexOf("}", index));
    const match = pattern.exec(block);
    if (match?.[1] !== undefined) return Number(match[1]) / 100;
  }
  throw new Error(`No ${property} percentage found for: ${selector}`);
}

const readLeftPercent = (selector: string): number => readPercent(selector, "left");
const readTopPercent = (selector: string): number => readPercent(selector, "top");

describe("bloom guide geometry", () => {
  it("derives the zone from the judgment constants", () => {
    const geometry = createBloomGuideGeometry();
    expect(geometry.spanRange).toEqual({
      minimum: BLOOM_DEFAULTS.minimumPreparationSpan,
      maximum: BLOOM_DEFAULTS.maximumPreparationSpan,
    });
    expect(geometry.midpointZone).toEqual({
      minX: BLOOM_PREPARATION_CENTER.x - BLOOM_DEFAULTS.preparationCenterToleranceX,
      maxX: BLOOM_PREPARATION_CENTER.x + BLOOM_DEFAULTS.preparationCenterToleranceX,
      minY: BLOOM_PREPARATION_CENTER.y - BLOOM_DEFAULTS.preparationCenterToleranceY,
      maxY: BLOOM_PREPARATION_CENTER.y + BLOOM_DEFAULTS.preparationCenterToleranceY,
    });
  });

  it("asks for a start pose the judgment accepts", () => {
    const geometry = createBloomGuideGeometry();
    expect(geometry.rightTarget.x - geometry.leftTarget.x).toBeCloseTo(geometry.targetSpan, 10);
    expect(isBloomPreparationPose(geometry.leftTarget, geometry.rightTarget)).toBe(true);
  });

  it("rejects a pair that is too close together or off center", () => {
    expect(isBloomPreparationPose({ x: 0.46, y: 0.5 }, { x: 0.54, y: 0.5 })).toBe(false);
    expect(isBloomPreparationPose({ x: 0.0, y: 0.5 }, { x: 0.2, y: 0.5 })).toBe(false);
  });
});

describe("bloom motion sample in styles.css", () => {
  const leftSelector = '.p1-motion-sample[data-gesture="bloom"] .p1-motion-hand--left {';
  const rightSelector = '.p1-motion-sample[data-gesture="bloom"] .p1-motion-hand--right {';

  it("starts the two hands inside the accepted preparation pose", () => {
    const left = readLeftPercent(leftSelector);
    const right = readLeftPercent(rightSelector);
    const top = readTopPercent('.p1-motion-sample[data-gesture="bloom"] .p1-motion-hand--left,');
    expect(isBloomPreparationPose({ x: left, y: top }, { x: right, y: top })).toBe(true);
  });

  it("keeps the animation start at the same distance as the resting position", () => {
    expect(readLeftPercent("@keyframes p1-bloom-left-sample {")).toBeCloseTo(readLeftPercent(leftSelector), 10);
    expect(readLeftPercent("@keyframes p1-bloom-right-sample {")).toBeCloseTo(readLeftPercent(rightSelector), 10);
  });
});
