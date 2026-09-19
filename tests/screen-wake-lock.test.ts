import { describe, expect, it } from "vitest";
import {
  ScreenWakeLock,
  type ScreenWakeLockDocument,
  type ScreenWakeLockSentinelLike,
} from "../src/app/screen-wake-lock";

class FakeSentinel implements ScreenWakeLockSentinelLike {
  released = false;
  readonly #listeners = new Set<() => void>();

  async release(): Promise<void> {
    this.released = true;
  }

  addEventListener(_type: "release", listener: () => void): void {
    this.#listeners.add(listener);
  }

  removeEventListener(_type: "release", listener: () => void): void {
    this.#listeners.delete(listener);
  }

  /** The system takes the lock back, for example when the page is hidden. */
  emitRelease(): void {
    this.released = true;
    for (const listener of this.#listeners) listener();
  }
}

function fakeDocument(): ScreenWakeLockDocument & {
  visibilityState: DocumentVisibilityState;
  emitVisibilityChange: () => void;
  listenerCount: () => number;
} {
  const listeners = new Set<() => void>();
  return {
    visibilityState: "visible" as DocumentVisibilityState,
    addEventListener(_type: "visibilitychange", listener: () => void): void {
      listeners.add(listener);
    },
    removeEventListener(_type: "visibilitychange", listener: () => void): void {
      listeners.delete(listener);
    },
    emitVisibilityChange(): void {
      for (const listener of [...listeners]) listener();
    },
    listenerCount: () => listeners.size,
  };
}

describe("ScreenWakeLock", () => {
  it("reports unsupported without throwing when the browser has no wake lock", async () => {
    const lock = new ScreenWakeLock({ host: {}, document: fakeDocument() });

    expect(await lock.acquire()).toBe("unsupported");
    expect(lock.held).toBe(false);
    await expect(lock.release()).resolves.toBeUndefined();
  });

  it("reports denied when the request is refused, for example in low power mode", async () => {
    const lock = new ScreenWakeLock({
      host: { wakeLock: { request: async () => { throw new Error("NotAllowedError"); } } },
      document: fakeDocument(),
    });

    expect(await lock.acquire()).toBe("denied");
    expect(lock.held).toBe(false);
  });

  it("holds one lock and releases it", async () => {
    const sentinels: FakeSentinel[] = [];
    const lock = new ScreenWakeLock({
      host: {
        wakeLock: {
          request: async () => {
            const sentinel = new FakeSentinel();
            sentinels.push(sentinel);
            return sentinel;
          },
        },
      },
      document: fakeDocument(),
    });

    expect(await lock.acquire()).toBe("acquired");
    expect(await lock.acquire()).toBe("acquired");
    expect(sentinels).toHaveLength(1);

    await lock.release();
    expect(sentinels[0]?.released).toBe(true);
    expect(lock.held).toBe(false);
    // The session outcome stays "acquired": it did hold the screen while the trials ran.
    expect(lock.status).toBe("acquired");
  });

  it("takes the lock again after the page comes back, and stops listening once released", async () => {
    const sentinels: FakeSentinel[] = [];
    const page = fakeDocument();
    const lock = new ScreenWakeLock({
      host: {
        wakeLock: {
          request: async () => {
            const sentinel = new FakeSentinel();
            sentinels.push(sentinel);
            return sentinel;
          },
        },
      },
      document: page,
    });
    await lock.acquire();

    // Hidden: the system drops the lock and a request would be refused.
    sentinels[0]?.emitRelease();
    page.visibilityState = "hidden";
    page.emitVisibilityChange();
    await Promise.resolve();
    expect(sentinels).toHaveLength(1);

    page.visibilityState = "visible";
    page.emitVisibilityChange();
    await Promise.resolve();
    await Promise.resolve();
    expect(sentinels).toHaveLength(2);

    await lock.release();
    expect(page.listenerCount()).toBe(0);
    page.emitVisibilityChange();
    await Promise.resolve();
    expect(sentinels).toHaveLength(2);
  });
});
