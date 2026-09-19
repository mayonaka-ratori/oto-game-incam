import { describe, expect, it } from "vitest";
import { resolveP1Protocol } from "../src/poc/phase1-protocol";
import { currentTestMode, testModeOptions } from "../src/ui/test-mode-menu";

describe("test mode menu", () => {
  it("marks the usual test as chosen when the query names no test", () => {
    const options = testModeOptions("/", "");
    expect(options.filter(({ current }) => current).map(({ id }) => id)).toEqual(["portrait-three"]);
    expect(options.find(({ id }) => id === "portrait-three")?.href).toBe("/");
    expect(options.find(({ id }) => id === "speed-check")?.href).toBe("/?mode=speedcheck");
    expect(options.find(({ id }) => id === "regression")?.href).toBe("/?protocol=regression");
  });

  it("keeps unrelated query values and replaces the previous test", () => {
    const options = testModeOptions("/lab/", "?tracking=mock&protocol=five&mode=speedcheck");
    expect(options.find(({ id }) => id === "portrait-three")?.href).toBe("/lab/?tracking=mock");
    expect(options.find(({ id }) => id === "regression")?.href).toBe("/lab/?tracking=mock&protocol=regression");
    expect(options.find(({ id }) => id === "speed-check")?.href).toBe("/lab/?tracking=mock&mode=speedcheck");
  });

  it("reads the chosen test the same way the app does", () => {
    expect(currentTestMode("?mode=speedcheck&protocol=five")).toBe("speed-check");
    expect(currentTestMode("?protocol=regression")).toBe("regression");
    expect(currentTestMode("?protocol=remaining-two")).toBe("remaining-two");
    expect(currentTestMode("?protocol=five")).toBe("five");
    expect(currentTestMode("?protocol=unknown")).toBe("portrait-three");
  });

  it("opens the protocol the label promises", () => {
    const expected = {
      "portrait-three": "p1-portrait-three-30",
      regression: "p1-regression-three-9",
      "remaining-two": "p1-remaining-two-20",
      five: "p1-five-gesture-50",
    } as const;
    for (const option of testModeOptions("/", "")) {
      if (option.id === "speed-check") continue;
      const search = option.href.includes("?") ? option.href.slice(option.href.indexOf("?")) : "";
      expect(resolveP1Protocol(search).id, option.id).toBe(expected[option.id]);
    }
  });
});
