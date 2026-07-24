export type LandscapeModeResult =
  | "already-landscape"
  | "locked"
  | "manual-required";

export interface LandscapeModeEnvironment {
  readonly isPortrait: () => boolean;
  readonly isFullscreen: () => boolean;
  readonly requestFullscreen: () => Promise<void> | null;
  readonly exitFullscreen: () => Promise<void> | null;
  readonly lockLandscape: () => Promise<void> | null;
}

export async function requestLandscapeMode(
  environment: LandscapeModeEnvironment = browserLandscapeEnvironment(),
): Promise<LandscapeModeResult> {
  if (!environment.isPortrait()) return "already-landscape";

  let enteredFullscreen = false;
  if (!environment.isFullscreen()) {
    try {
      const request = environment.requestFullscreen();
      if (request !== null) {
        await request;
        enteredFullscreen = true;
      }
    } catch {
      // Some browsers can lock an installed app without entering fullscreen.
    }
  }

  try {
    const lock = environment.lockLandscape();
    if (lock === null) {
      await leaveFullscreenIfEntered(environment, enteredFullscreen);
      return "manual-required";
    }
    await lock;
    return "locked";
  } catch {
    await leaveFullscreenIfEntered(environment, enteredFullscreen);
    return "manual-required";
  }
}

function browserLandscapeEnvironment(): LandscapeModeEnvironment {
  return {
    isPortrait: () => window.innerHeight > window.innerWidth,
    isFullscreen: () => document.fullscreenElement !== null,
    requestFullscreen: () => {
      const request = document.documentElement.requestFullscreen;
      return typeof request === "function"
        ? request.call(document.documentElement, { navigationUI: "hide" })
        : null;
    },
    exitFullscreen: () => {
      const exit = document.exitFullscreen;
      return typeof exit === "function" ? exit.call(document) : null;
    },
    lockLandscape: () => {
      const orientation = window.screen.orientation as ScreenOrientation & {
        lock?: (orientation: "landscape") => Promise<void>;
      };
      return typeof orientation?.lock === "function"
        ? orientation.lock("landscape")
        : null;
    },
  };
}

async function leaveFullscreenIfEntered(
  environment: LandscapeModeEnvironment,
  enteredFullscreen: boolean,
): Promise<void> {
  if (!enteredFullscreen || !environment.isFullscreen()) return;
  try {
    await environment.exitFullscreen();
  } catch {
    // The fallback guidance remains usable even if fullscreen cannot be exited.
  }
}
