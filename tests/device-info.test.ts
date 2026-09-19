import { afterEach, describe, expect, it } from "vitest";
import { DeviceInfoCollector, collectDeviceInfo } from "../src/metrics/device-info";

// Three environments: Chromium with the Client Hints API, Safari without it, and a browser where
// every call fails. None of them may throw, and none may invent a model name.

type Global = typeof globalThis & {
  navigator?: unknown;
  screen?: unknown;
  devicePixelRatio?: unknown;
  document?: unknown;
};

const view = globalThis as Global;
const original = {
  navigator: view.navigator,
  screen: view.screen,
  devicePixelRatio: view.devicePixelRatio,
  document: view.document,
};

function install(values: Partial<Record<keyof typeof original, unknown>>): void {
  for (const key of Object.keys(original) as (keyof typeof original)[]) {
    Object.defineProperty(view, key, { value: values[key], configurable: true, writable: true });
  }
}

afterEach(() => {
  for (const key of Object.keys(original) as (keyof typeof original)[]) {
    Object.defineProperty(view, key, { value: original[key], configurable: true, writable: true });
  }
});

/** A canvas whose WebGL context reports a renderer and records that it was released. */
function webglDocument(released: { count: number }): unknown {
  const context = {
    getExtension(name: string): unknown {
      if (name === "WEBGL_debug_renderer_info") {
        return { UNMASKED_RENDERER_WEBGL: 0x9246, UNMASKED_VENDOR_WEBGL: 0x9245 };
      }
      if (name === "WEBGL_lose_context") return { loseContext: (): void => { released.count += 1; } };
      return null;
    },
    getParameter(id: number): unknown {
      return id === 0x9246 ? "Adreno (TM) 730" : "Qualcomm";
    },
  };
  return {
    createElement(): unknown {
      return { width: 1, height: 1, getContext: (kind: string): unknown => (kind === "webgl2" ? context : null) };
    },
  };
}

describe("automatic device info", () => {
  it("reads the model and browser from the Client Hints API on a Chromium phone", async () => {
    const released = { count: 0 };
    install({
      document: webglDocument(released),
      screen: { width: 412, height: 915, availWidth: 412, availHeight: 915 },
      devicePixelRatio: 2.625,
      navigator: {
        userAgent: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36",
        hardwareConcurrency: 8,
        deviceMemory: 8,
        maxTouchPoints: 5,
        language: "ja-JP",
        getBattery: (): Promise<unknown> => Promise.resolve({ charging: false, level: 0.62 }),
        userAgentData: {
          mobile: true,
          platform: "Android",
          getHighEntropyValues: (): Promise<unknown> => Promise.resolve({
            model: "Pixel 7",
            platform: "Android",
            platformVersion: "14.0.0",
            architecture: "arm",
            bitness: "64",
            formFactors: ["Mobile"],
            fullVersionList: [
              { brand: "Not;A=Brand", version: "24.0.0.0" },
              { brand: "Chromium", version: "140.0.7339.80" },
              { brand: "Google Chrome", version: "140.0.7339.80" },
            ],
          }),
        },
      },
    });

    const info = await collectDeviceInfo();

    expect(info).toMatchObject({
      source: "userAgentData",
      mobile: true,
      model: "Pixel 7",
      platform: "Android",
      platformVersion: "14.0.0",
      architecture: "arm",
      bitness: "64",
      formFactors: ["Mobile"],
      browserName: "Google Chrome",
      browserVersion: "140.0.7339.80",
      hardwareConcurrency: 8,
      deviceMemoryGb: 8,
      maxTouchPoints: 5,
      language: "ja-JP",
      gpuRenderer: "Adreno (TM) 730",
      gpuVendor: "Qualcomm",
      batteryAtStart: { charging: false, level: 0.62 },
    });
    expect(info.screen).toEqual({
      width: 412,
      height: 915,
      availWidth: 412,
      availHeight: 915,
      devicePixelRatio: 2.625,
      physicalWidth: 1082,
      physicalHeight: 2402,
    });
    // The WebGL context is handed back at once instead of being held for the whole session.
    expect(released.count).toBe(1);
  });

  it("leaves the model null on Safari and reads only what the user agent states", async () => {
    install({
      document: undefined,
      screen: { width: 390, height: 844, availWidth: 390, availHeight: 844 },
      devicePixelRatio: 3,
      navigator: {
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1",
        hardwareConcurrency: 6,
        maxTouchPoints: 5,
        language: "ja-JP",
      },
    });

    const info = await collectDeviceInfo();

    expect(info).toMatchObject({
      source: "userAgent",
      model: null,
      mobile: null,
      platform: "iOS",
      platformVersion: "17.5",
      architecture: null,
      bitness: null,
      formFactors: null,
      browserName: null,
      fullVersionList: null,
      hardwareConcurrency: 6,
      deviceMemoryGb: null,
      gpuRenderer: null,
      gpuVendor: null,
      batteryAtStart: null,
      batteryAtExport: null,
    });
    expect(info.screen).toMatchObject({ physicalWidth: 1170, physicalHeight: 2532 });
  });

  it("returns nulls instead of throwing when every call fails", async () => {
    const explode = (): never => { throw new Error("blocked"); };
    install({
      document: { createElement: explode },
      screen: undefined,
      devicePixelRatio: undefined,
      navigator: {
        get userAgent(): string { return explode(); },
        get hardwareConcurrency(): number { return explode(); },
        getBattery: (): Promise<unknown> => Promise.reject(new Error("blocked")),
        userAgentData: { getHighEntropyValues: (): Promise<unknown> => Promise.reject(new Error("blocked")) },
      },
    });

    const info = await collectDeviceInfo();

    expect(info).toMatchObject({
      source: "userAgent",
      model: null,
      platform: null,
      platformVersion: null,
      hardwareConcurrency: null,
      language: null,
      gpuRenderer: null,
      batteryAtStart: null,
    });
    expect(info.screen).toEqual({
      width: null,
      height: null,
      availWidth: null,
      availHeight: null,
      devicePixelRatio: null,
      physicalWidth: null,
      physicalHeight: null,
    });
  });

  it("re-reads the battery on every snapshot and stays null before the collection finishes", async () => {
    const battery = { charging: false, level: 0.62 };
    install({
      document: undefined,
      screen: { width: 412, height: 915 },
      devicePixelRatio: 2,
      navigator: {
        userAgent: "Mozilla/5.0 (Linux; Android 14; K)",
        getBattery: (): Promise<unknown> => Promise.resolve(battery),
      },
    });
    const collector = new DeviceInfoCollector();

    expect(collector.snapshot()).toBeNull();
    collector.start();
    collector.start();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(collector.snapshot()).toMatchObject({
      platform: "Android",
      batteryAtStart: { charging: false, level: 0.62 },
      batteryAtExport: { charging: false, level: 0.62 },
    });

    battery.charging = true;
    battery.level = 0.41;

    expect(collector.snapshot()).toMatchObject({
      // The start value is the one that was read before the camera opened.
      batteryAtStart: { charging: false, level: 0.62 },
      batteryAtExport: { charging: true, level: 0.41 },
    });
  });
});
