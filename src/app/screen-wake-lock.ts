/**
 * Keeps the screen awake during a P1 session. A trial lasts up to 10 seconds without a touch, so
 * a phone can dim or lock in the middle of one. Every failure is ignored on purpose: an old
 * browser, a refused request in low power mode, or a lock the system takes back must never
 * interrupt a trial.
 */
export type ScreenWakeLockStatus = "not-requested" | "unsupported" | "acquired" | "denied";

export interface ScreenWakeLockSentinelLike {
  release(): Promise<void>;
  addEventListener(type: "release", listener: () => void): void;
  removeEventListener(type: "release", listener: () => void): void;
}

export interface ScreenWakeLockApi {
  request(type: "screen"): Promise<ScreenWakeLockSentinelLike>;
}

export interface ScreenWakeLockHost {
  readonly wakeLock?: ScreenWakeLockApi | undefined;
}

export interface ScreenWakeLockDocument {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

export interface ScreenWakeLockOptions {
  readonly host?: ScreenWakeLockHost | null;
  readonly document?: ScreenWakeLockDocument | null;
}

export class ScreenWakeLock {
  readonly #host: ScreenWakeLockHost | null;
  readonly #document: ScreenWakeLockDocument | null;
  #sentinel: ScreenWakeLockSentinelLike | null = null;
  #wanted = false;
  #requesting = false;
  #listening = false;
  #status: ScreenWakeLockStatus = "not-requested";

  constructor(options: ScreenWakeLockOptions = {}) {
    this.#host = options.host === undefined ? defaultHost() : options.host;
    this.#document = options.document === undefined ? defaultDocument() : options.document;
  }

  /** The best outcome of the session: "acquired" once it ever succeeded, otherwise why it did not. */
  get status(): ScreenWakeLockStatus {
    return this.#status;
  }

  get held(): boolean {
    return this.#sentinel !== null;
  }

  async acquire(): Promise<ScreenWakeLockStatus> {
    this.#wanted = true;
    const api = this.#host?.wakeLock;
    if (api === undefined || api === null || typeof api.request !== "function") {
      if (this.#status === "not-requested") this.#status = "unsupported";
      return this.#status;
    }
    this.#listen();
    if (this.#sentinel !== null || this.#requesting) return this.#status;
    if (this.#document !== null && this.#document.visibilityState !== "visible") return this.#status;
    this.#requesting = true;
    try {
      const sentinel = await api.request("screen");
      if (!this.#wanted) {
        void sentinel.release().catch(() => undefined);
        return this.#status;
      }
      this.#sentinel = sentinel;
      sentinel.addEventListener("release", this.#handleRelease);
      this.#status = "acquired";
    } catch {
      // Refused (low power mode, no user gesture, hidden page). The trial continues either way.
      if (this.#status !== "acquired") this.#status = "denied";
    } finally {
      this.#requesting = false;
    }
    return this.#status;
  }

  async release(): Promise<void> {
    this.#wanted = false;
    this.#unlisten();
    const sentinel = this.#sentinel;
    this.#sentinel = null;
    if (sentinel === null) return;
    sentinel.removeEventListener("release", this.#handleRelease);
    try {
      await sentinel.release();
    } catch {
      // A lock the system already took back needs nothing here.
    }
  }

  dispose(): void {
    void this.release();
  }

  /** The system drops the lock whenever the page is hidden, so it is taken again on return. */
  readonly #handleVisibilityChange = (): void => {
    if (!this.#wanted) return;
    if (this.#document !== null && this.#document.visibilityState !== "visible") return;
    void this.acquire();
  };

  readonly #handleRelease = (): void => {
    this.#sentinel = null;
  };

  #listen(): void {
    if (this.#listening || this.#document === null) return;
    this.#document.addEventListener("visibilitychange", this.#handleVisibilityChange);
    this.#listening = true;
  }

  #unlisten(): void {
    if (!this.#listening || this.#document === null) return;
    this.#document.removeEventListener("visibilitychange", this.#handleVisibilityChange);
    this.#listening = false;
  }
}

function defaultHost(): ScreenWakeLockHost | null {
  if (typeof navigator === "undefined") return null;
  return navigator as unknown as ScreenWakeLockHost;
}

function defaultDocument(): ScreenWakeLockDocument | null {
  if (typeof document === "undefined") return null;
  return document as unknown as ScreenWakeLockDocument;
}
