import { describe, expect, it } from "vitest";
import {
  createContentBuildId,
  resolveAppBuildId,
} from "../build/app-build-id";

describe("app build id", () => {
  it("prefers an explicit id and otherwise uses a CI revision", () => {
    expect(resolveAppBuildId("0.1.0", ".", {
      VITE_APP_BUILD_ID: "release-candidate-3",
      GITHUB_SHA: "abcdef1234567890",
    })).toBe("release-candidate-3");
    expect(resolveAppBuildId("0.1.0", ".", {
      GITHUB_SHA: "abcdef1234567890",
    })).toBe("0.1.0+abcdef1234567890");
  });

  it("changes the fallback id when build input content changes", () => {
    const first = createContentBuildId("0.1.0", [
      { path: "src/main.ts", content: new TextEncoder().encode("first") },
    ]);
    const second = createContentBuildId("0.1.0", [
      { path: "src/main.ts", content: new TextEncoder().encode("second") },
    ]);

    expect(first).toMatch(/^0\.1\.0\+src\.[a-f0-9]{12}$/);
    expect(second).not.toBe(first);
  });
});
