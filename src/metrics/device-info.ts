/**
 * What the browser will tell us about the device, collected once at start-up so a result JSON says
 * which phone produced it without the tester typing anything.
 *
 * Rules this file keeps:
 * - Everything is best effort. A value that cannot be read is null, and nothing here ever throws.
 * - Nothing is guessed. Where the browser hides the model name (Safari), model stays null instead
 *   of being reconstructed from the user agent string.
 * - Nothing identifying is collected: no location, no device id, no font or plugin enumeration.
 * - Nothing is sent anywhere. The values only reach the JSON file the tester saves.
 */

export interface DeviceBatteryInfo {
  readonly charging: boolean | null;
  /** 0–1. A hint for throttling and heat, not a measurement of either. */
  readonly level: number | null;
}

export interface DeviceBrandVersion {
  readonly brand: string;
  readonly version: string;
}

export interface DeviceScreenInfo {
  readonly width: number | null;
  readonly height: number | null;
  readonly availWidth: number | null;
  readonly availHeight: number | null;
  readonly devicePixelRatio: number | null;
  /** width × devicePixelRatio, rounded. An estimate of the panel's pixels, not a reported value. */
  readonly physicalWidth: number | null;
  readonly physicalHeight: number | null;
}

export interface DeviceInfo {
  /**
   * "userAgentData" when the model and platform came from the Client Hints API (Chromium),
   * "userAgent" when only the user agent string was available (Safari and older browsers).
   */
  readonly source: "userAgentData" | "userAgent";
  readonly mobile: boolean | null;
  /** The marketing-independent model string, for example "Pixel 7". Null on Safari. */
  readonly model: string | null;
  readonly platform: string | null;
  readonly platformVersion: string | null;
  readonly architecture: string | null;
  readonly bitness: string | null;
  readonly formFactors: readonly string[] | null;
  readonly browserName: string | null;
  readonly browserVersion: string | null;
  readonly fullVersionList: readonly DeviceBrandVersion[] | null;
  readonly hardwareConcurrency: number | null;
  /** navigator.deviceMemory, in GiB and deliberately coarse. Chromium only. */
  readonly deviceMemoryGb: number | null;
  readonly maxTouchPoints: number | null;
  readonly language: string | null;
  readonly screen: DeviceScreenInfo;
  /** WEBGL_debug_renderer_info. Some browsers mask it, and then both values are null. */
  readonly gpuRenderer: string | null;
  readonly gpuVendor: string | null;
  /** Read once before the camera starts. */
  readonly batteryAtStart: DeviceBatteryInfo | null;
  /** Read again when the result is saved, so a session can be read against a draining battery. */
  readonly batteryAtExport: DeviceBatteryInfo | null;
}

interface BatteryManagerLike {
  readonly charging: unknown;
  readonly level: unknown;
}

interface UserAgentDataLike {
  readonly mobile?: unknown;
  readonly platform?: unknown;
  readonly brands?: unknown;
  getHighEntropyValues?: (hints: readonly string[]) => Promise<unknown>;
}

const HIGH_ENTROPY_HINTS = [
  "model",
  "platform",
  "platformVersion",
  "architecture",
  "bitness",
  "fullVersionList",
  "formFactors",
] as const;

/** Brands the Client Hints API adds as deliberate noise; they are never the browser's name. */
function isGreaseBrand(brand: string): boolean {
  return brand.includes("Not") && brand.includes("Brand");
}

/**
 * Collects everything in one pass. The WebGL probe and the battery read happen here, so call it
 * once at start-up and reuse the result.
 */
export async function collectDeviceInfo(): Promise<DeviceInfo> {
  return (await collectWithBattery()).info;
}

/**
 * Holds the collected values for the life of the page. The battery is re-read on every snapshot,
 * because it is the one value that is expected to move during a session.
 */
export class DeviceInfoCollector {
  #info: DeviceInfo | null = null;
  #battery: BatteryManagerLike | null = null;
  #started = false;

  /** Starts the asynchronous collection. Safe to call more than once; only the first run counts. */
  start(): void {
    if (this.#started) return;
    this.#started = true;
    void this.#collect();
  }

  /** Null until the collection finishes. Never throws. */
  snapshot(): DeviceInfo | null {
    const info = this.#info;
    if (info === null) return null;
    return { ...info, batteryAtExport: readBattery(this.#battery) };
  }

  async #collect(): Promise<void> {
    try {
      const { info, battery } = await collectWithBattery();
      this.#info = info;
      this.#battery = battery;
    } catch {
      this.#info = null;
    }
  }
}

async function collectWithBattery(): Promise<{
  readonly info: DeviceInfo;
  readonly battery: BatteryManagerLike | null;
}> {
  const battery = await readBatteryManager();
  const reading = readBattery(battery);
  const agentData = userAgentData();
  const highEntropy = agentData === null ? null : await readHighEntropyValues(agentData);
  const gpu = readGpu();
  const base = {
    hardwareConcurrency: finite(navigatorValue("hardwareConcurrency")),
    deviceMemoryGb: finite(navigatorValue("deviceMemory")),
    maxTouchPoints: finite(navigatorValue("maxTouchPoints")),
    language: nonEmptyString(navigatorValue("language")),
    screen: readScreen(),
    gpuRenderer: gpu.renderer,
    gpuVendor: gpu.vendor,
    batteryAtStart: reading,
    batteryAtExport: reading,
  };
  if (agentData === null || highEntropy === null) {
    const fallback = readUserAgentString();
    return {
      battery,
      info: {
        source: "userAgent",
        mobile: null,
        // Safari does not expose the model, and a guess from the user agent string would be wrong
        // as often as right, so nothing is invented here.
        model: null,
        platform: fallback.platform,
        platformVersion: fallback.platformVersion,
        architecture: null,
        bitness: null,
        formFactors: null,
        browserName: null,
        browserVersion: null,
        fullVersionList: null,
        ...base,
      },
    };
  }
  const versions = brandVersions(highEntropy.fullVersionList) ?? brandVersions(agentData.brands);
  const browser = pickBrowser(versions);
  return {
    battery,
    info: {
      source: "userAgentData",
      mobile: typeof agentData.mobile === "boolean" ? agentData.mobile : null,
      model: nonEmptyString(highEntropy.model),
      platform: nonEmptyString(highEntropy.platform) ?? nonEmptyString(agentData.platform),
      platformVersion: nonEmptyString(highEntropy.platformVersion),
      architecture: nonEmptyString(highEntropy.architecture),
      bitness: nonEmptyString(highEntropy.bitness),
      formFactors: stringList(highEntropy.formFactors),
      browserName: browser?.brand ?? null,
      browserVersion: browser?.version ?? null,
      fullVersionList: versions,
      ...base,
    },
  };
}

function userAgentData(): UserAgentDataLike | null {
  try {
    const value: unknown = (globalThis.navigator as Navigator & { userAgentData?: unknown } | undefined)?.userAgentData;
    return typeof value === "object" && value !== null ? value as UserAgentDataLike : null;
  } catch {
    return null;
  }
}

async function readHighEntropyValues(
  agentData: UserAgentDataLike,
): Promise<Record<string, unknown> | null> {
  if (typeof agentData.getHighEntropyValues !== "function") return null;
  try {
    const values: unknown = await agentData.getHighEntropyValues([...HIGH_ENTROPY_HINTS]);
    return typeof values === "object" && values !== null ? values as Record<string, unknown> : null;
  } catch {
    // A browser may refuse the hints entirely. That is a null model, not an error for the tester.
    return null;
  }
}

/** Only what the user agent string states outright. The model is never derived from it. */
function readUserAgentString(): { readonly platform: string | null; readonly platformVersion: string | null } {
  const agent = nonEmptyString(navigatorValue("userAgent"));
  if (agent === null) return { platform: null, platformVersion: null };
  const android = /Android (\d+(?:\.\d+)*)/.exec(agent);
  if (android?.[1] !== undefined) return { platform: "Android", platformVersion: android[1] };
  const ios = /(?:iPhone|CPU) OS (\d+(?:_\d+)*)/.exec(agent);
  if (ios?.[1] !== undefined) return { platform: "iOS", platformVersion: ios[1].replaceAll("_", ".") };
  if (agent.includes("iPhone") || agent.includes("iPad") || agent.includes("iPod")) {
    return { platform: "iOS", platformVersion: null };
  }
  const windows = /Windows NT (\d+(?:\.\d+)*)/.exec(agent);
  if (windows?.[1] !== undefined) return { platform: "Windows", platformVersion: windows[1] };
  const mac = /Mac OS X (\d+(?:[._]\d+)*)/.exec(agent);
  if (mac?.[1] !== undefined) return { platform: "macOS", platformVersion: mac[1].replaceAll("_", ".") };
  if (agent.includes("Linux")) return { platform: "Linux", platformVersion: null };
  return { platform: null, platformVersion: null };
}

function brandVersions(value: unknown): readonly DeviceBrandVersion[] | null {
  if (!Array.isArray(value)) return null;
  const list = value.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const brand = nonEmptyString((item as { brand?: unknown }).brand);
    const version = nonEmptyString((item as { version?: unknown }).version);
    return brand === null ? [] : [{ brand, version: version ?? "" }];
  });
  return list.length === 0 ? null : list;
}

/** Prefers the specific browser over Chromium, and never reports one of the grease brands. */
function pickBrowser(versions: readonly DeviceBrandVersion[] | null): DeviceBrandVersion | null {
  if (versions === null) return null;
  const real = versions.filter(({ brand }) => !isGreaseBrand(brand));
  return real.find(({ brand }) => brand !== "Chromium") ?? real[0] ?? null;
}

function readScreen(): DeviceScreenInfo {
  const empty: DeviceScreenInfo = {
    width: null,
    height: null,
    availWidth: null,
    availHeight: null,
    devicePixelRatio: null,
    physicalWidth: null,
    physicalHeight: null,
  };
  try {
    const view = globalThis as { screen?: unknown; devicePixelRatio?: unknown };
    const screen = typeof view.screen === "object" && view.screen !== null
      ? view.screen as Record<string, unknown>
      : null;
    const ratio = finite(view.devicePixelRatio);
    const width = screen === null ? null : finite(screen.width);
    const height = screen === null ? null : finite(screen.height);
    return {
      width,
      height,
      availWidth: screen === null ? null : finite(screen.availWidth),
      availHeight: screen === null ? null : finite(screen.availHeight),
      devicePixelRatio: ratio,
      physicalWidth: width === null || ratio === null ? null : Math.round(width * ratio),
      physicalHeight: height === null || ratio === null ? null : Math.round(height * ratio),
    };
  } catch {
    return empty;
  }
}

/**
 * Asks WebGL for the unmasked renderer and vendor, then throws the context away. The probe runs
 * once, before the camera starts, so it never competes with the tracking Worker for the GPU.
 */
function readGpu(): { readonly renderer: string | null; readonly vendor: string | null } {
  const empty = { renderer: null, vendor: null };
  try {
    const create = (globalThis as { document?: { createElement?: unknown } }).document?.createElement;
    if (typeof create !== "function") return empty;
    const canvas: unknown = (globalThis as unknown as { document: Document }).document.createElement("canvas");
    if (!(canvas instanceof Object) || typeof (canvas as HTMLCanvasElement).getContext !== "function") return empty;
    const element = canvas as HTMLCanvasElement;
    const context = element.getContext("webgl2") ?? element.getContext("webgl");
    if (context === null) return empty;
    const gl = context as WebGLRenderingContext;
    const debug = gl.getExtension("WEBGL_debug_renderer_info") as {
      UNMASKED_RENDERER_WEBGL?: number;
      UNMASKED_VENDOR_WEBGL?: number;
    } | null;
    const renderer = debug?.UNMASKED_RENDERER_WEBGL === undefined
      ? null
      : nonEmptyString(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL));
    const vendor = debug?.UNMASKED_VENDOR_WEBGL === undefined
      ? null
      : nonEmptyString(gl.getParameter(debug.UNMASKED_VENDOR_WEBGL));
    // Release the context immediately: a leaked one costs GPU memory for the whole session.
    const lose = gl.getExtension("WEBGL_lose_context") as { loseContext?: () => void } | null;
    lose?.loseContext?.();
    element.width = 0;
    element.height = 0;
    return { renderer, vendor };
  } catch {
    return empty;
  }
}

async function readBatteryManager(): Promise<BatteryManagerLike | null> {
  try {
    const getBattery = (globalThis.navigator as Navigator & { getBattery?: unknown } | undefined)?.getBattery;
    if (typeof getBattery !== "function") return null;
    const manager: unknown = await (getBattery as () => Promise<unknown>).call(globalThis.navigator);
    return typeof manager === "object" && manager !== null ? manager as BatteryManagerLike : null;
  } catch {
    return null;
  }
}

function readBattery(manager: BatteryManagerLike | null): DeviceBatteryInfo | null {
  if (manager === null) return null;
  try {
    return {
      charging: typeof manager.charging === "boolean" ? manager.charging : null,
      level: finite(manager.level),
    };
  } catch {
    return null;
  }
}

function navigatorValue(key: string): unknown {
  try {
    const navigator = globalThis.navigator as unknown as Record<string, unknown> | undefined;
    return navigator?.[key];
  } catch {
    return undefined;
  }
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function stringList(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  const list = value.flatMap((item) => {
    const text = nonEmptyString(item);
    return text === null ? [] : [text];
  });
  return list.length === 0 ? null : list;
}
