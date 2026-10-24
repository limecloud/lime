import type { Input, WebContents } from "electron";
import { clipboard } from "./electronRuntime";
import type { BrowserDeviceState } from "../src/lib/browserDeviceLayout";
import { browserDeviceLimits } from "../src/lib/browserDeviceLayout";
import { isBrowserDevicePreset } from "../src/lib/browserDevicePresets";

export type EmbeddedBrowserDeviceState = BrowserDeviceState;

export type EmbeddedBrowserPageCommand =
  | "focus-address"
  | "find"
  | "new-tab"
  | "close-tab"
  | "reload"
  | "go-back"
  | "go-forward"
  | "zoom-in"
  | "zoom-out"
  | "zoom-reset"
  | "print"
  | "annotate";

/** Native pages do not bubble keyboard events to the trusted renderer. */
export function browserCommandForInput(
  input: Input,
  platform: string,
): EmbeddedBrowserPageCommand | null {
  if (input.type !== "keyDown" || input.isAutoRepeat || input.isComposing)
    return null;
  const key = input.key.toLowerCase();
  const primary = platform === "darwin" ? input.meta : input.control;
  if (primary && !input.alt) {
    if (input.shift && (key === "." || key === ">" || input.code === "Period"))
      return "annotate";
    if (key === "+" || key === "=") return "zoom-in";
    if (key === "-") return "zoom-out";
    if (!input.shift) {
      if (key === "l") return "focus-address";
      if (key === "f") return "find";
      if (key === "t") return "new-tab";
      if (key === "w") return "close-tab";
      if (key === "r") return "reload";
      if (key === "0") return "zoom-reset";
      if (key === "p") return "print";
      if (key === "[") return "go-back";
      if (key === "]") return "go-forward";
    }
  }
  if (!primary && !input.shift && input.alt) {
    if (key === "arrowleft") return "go-back";
    if (key === "arrowright") return "go-forward";
  }
  if (!primary && !input.alt && !input.shift && key === "f5") return "reload";
  return null;
}

export function readBrowserDevice(
  value: unknown,
): EmbeddedBrowserDeviceState | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Browser device must be an object or null");
  }
  const source = value as Record<string, unknown>;
  const finite = (key: string, minimum: number, maximum: number) => {
    const number = source[key];
    if (
      typeof number !== "number" ||
      !Number.isFinite(number) ||
      number < minimum ||
      number > maximum
    ) {
      throw new Error(`Browser device ${key} is outside its supported range`);
    }
    return number;
  };
  if (typeof source.mobile !== "boolean")
    throw new Error("Browser device mobile must be a boolean");
  if (source.presetId !== undefined && !isBrowserDevicePreset(source.presetId))
    throw new Error("Browser device presetId is unknown");
  return {
    presetId: source.presetId ?? "responsive",
    width: Math.round(
      finite(
        "width",
        browserDeviceLimits.width.min,
        browserDeviceLimits.width.max,
      ),
    ),
    height: Math.round(
      finite(
        "height",
        browserDeviceLimits.height.min,
        browserDeviceLimits.height.max,
      ),
    ),
    deviceScaleFactor: finite("deviceScaleFactor", 0, 8),
    scale: finite("scale", 0.1, 3),
    mobile: source.mobile,
  };
}

export function applyBrowserDevice(
  webContents: WebContents,
  device: EmbeddedBrowserDeviceState | null,
): void {
  if (!device) {
    webContents.disableDeviceEmulation();
    return;
  }
  webContents.enableDeviceEmulation({
    screenPosition: device.mobile ? "mobile" : "desktop",
    screenSize: { width: device.width, height: device.height },
    viewPosition: { x: 0, y: 0 },
    viewSize: { width: device.width, height: device.height },
    deviceScaleFactor: device.deviceScaleFactor,
    scale: device.scale,
  });
}

export function printBrowserPage(
  webContents: WebContents,
): Promise<{ printed: boolean; failureReason: string | null }> {
  return new Promise((resolve, reject) => {
    try {
      webContents.print(
        { silent: false, printBackground: true },
        (printed, failureReason) => {
          resolve({
            printed,
            failureReason: printed ? null : failureReason || "cancelled",
          });
        },
      );
    } catch (error) {
      reject(error);
    }
  });
}

export async function captureBrowserPage(
  webContents: WebContents,
  copyToClipboard: boolean,
): Promise<{
  dataUrl: string;
  width: number;
  height: number;
  copiedToClipboard: boolean;
}> {
  const image = await webContents.capturePage();
  if (image.isEmpty()) throw new Error("Browser screenshot is empty");
  if (copyToClipboard) clipboard.writeImage(image);
  const { width, height } = image.getSize();
  return {
    dataUrl: image.toDataURL(),
    width,
    height,
    copiedToClipboard: copyToClipboard,
  };
}
