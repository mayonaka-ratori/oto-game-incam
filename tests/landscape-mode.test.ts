import { describe, expect, it, vi } from "vitest";
import {
  requestLandscapeMode,
  type LandscapeModeEnvironment,
} from "../src/ui/landscape-mode";

function environment(
  overrides: Partial<LandscapeModeEnvironment> = {},
): LandscapeModeEnvironment {
  return {
    isPortrait: () => true,
    isFullscreen: () => false,
    requestFullscreen: () => Promise.resolve(),
    exitFullscreen: () => Promise.resolve(),
    lockLandscape: () => Promise.resolve(),
    ...overrides,
  };
}

describe("requestLandscapeMode", () => {
  it("does nothing when the viewport is already landscape", async () => {
    const requestFullscreen = vi.fn(() => Promise.resolve());
    const lockLandscape = vi.fn(() => Promise.resolve());

    await expect(requestLandscapeMode(environment({
      isPortrait: () => false,
      requestFullscreen,
      lockLandscape,
    }))).resolves.toBe("already-landscape");
    expect(requestFullscreen).not.toHaveBeenCalled();
    expect(lockLandscape).not.toHaveBeenCalled();
  });

  it("enters fullscreen before locking landscape", async () => {
    const order: string[] = [];

    await expect(requestLandscapeMode(environment({
      requestFullscreen: () => {
        order.push("fullscreen");
        return Promise.resolve();
      },
      lockLandscape: () => {
        order.push("lock");
        return Promise.resolve();
      },
    }))).resolves.toBe("locked");
    expect(order).toEqual(["fullscreen", "lock"]);
  });

  it("returns to manual guidance and exits fullscreen when locking is unavailable", async () => {
    let fullscreen = false;
    const exitFullscreen = vi.fn(() => {
      fullscreen = false;
      return Promise.resolve();
    });

    await expect(requestLandscapeMode(environment({
      isFullscreen: () => fullscreen,
      requestFullscreen: () => {
        fullscreen = true;
        return Promise.resolve();
      },
      exitFullscreen,
      lockLandscape: () => null,
    }))).resolves.toBe("manual-required");
    expect(exitFullscreen).toHaveBeenCalledOnce();
  });
});
