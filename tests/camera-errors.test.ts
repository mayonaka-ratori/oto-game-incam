import { describe, expect, it } from "vitest";
import { classifyCameraError } from "../src/camera/camera-errors";

describe("classifyCameraError", () => {
  it.each([
    ["NotAllowedError", "permission-denied"],
    ["SecurityError", "permission-denied"],
    ["NotFoundError", "no-device"],
    ["NotReadableError", "device-busy"],
    ["OverconstrainedError", "constraints"],
    ["AbortError", "aborted"],
  ] as const)("maps %s to %s", (name, code) => {
    expect(classifyCameraError({ name }).code).toBe(code);
  });

  it("keeps an unknown technical name for diagnostics", () => {
    const result = classifyCameraError({ name: "FutureBrowserError" });
    expect(result.code).toBe("unknown");
    expect(result.technicalName).toBe("FutureBrowserError");
  });

  it("does not expose an arbitrary thrown value as a message", () => {
    const result = classifyCameraError("secret value");
    expect(result.technicalName).toBe("UnknownError");
    expect(result.guidance).not.toContain("secret value");
  });
});

