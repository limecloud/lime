import type { EmbeddedBrowserDeviceState } from "@/lib/api/embeddedBrowser";
import {
  browserDeviceLimits,
  clampBrowserDeviceDimension,
} from "@/lib/browserDeviceLayout";
import {
  browserDevicePresets,
  isBrowserDevicePreset,
  type BrowserDevicePreset,
} from "@/lib/browserDevicePresets";

export function rotateBrowserDevice(
  device: EmbeddedBrowserDeviceState,
): EmbeddedBrowserDeviceState {
  const preset = browserDevicePresets.find(
    (value) => value.id === device.presetId,
  );
  const matches =
    preset &&
    ((preset.width === device.width && preset.height === device.height) ||
      (preset.width === device.height && preset.height === device.width));
  return {
    ...device,
    width: clampBrowserDeviceDimension("width", device.height),
    height: clampBrowserDeviceDimension("height", device.width),
    presetId: matches ? device.presetId : "responsive",
  };
}

export function browserDevicePreset(
  device: EmbeddedBrowserDeviceState,
): BrowserDevicePreset {
  return isBrowserDevicePreset(device.presetId)
    ? device.presetId
    : "responsive";
}

export function isValidBrowserDevice(device: EmbeddedBrowserDeviceState) {
  return (
    (device.presetId === undefined || isBrowserDevicePreset(device.presetId)) &&
    Number.isInteger(device.width) &&
    device.width >= browserDeviceLimits.width.min &&
    device.width <= browserDeviceLimits.width.max &&
    Number.isInteger(device.height) &&
    device.height >= browserDeviceLimits.height.min &&
    device.height <= browserDeviceLimits.height.max &&
    Number.isFinite(device.deviceScaleFactor) &&
    device.deviceScaleFactor >= 0 &&
    device.deviceScaleFactor <= 8 &&
    Number.isFinite(device.scale) &&
    device.scale >= 0.1 &&
    device.scale <= 3 &&
    typeof device.mobile === "boolean"
  );
}

export type BrowserDeviceEdge =
  | "left"
  | "right"
  | "bottom"
  | "bottom-left"
  | "bottom-right";

export function resizeBrowserDevice(
  device: EmbeddedBrowserDeviceState,
  edge: BrowserDeviceEdge,
  dx: number,
  dy: number,
  scale: number,
): EmbeddedBrowserDeviceState {
  return {
    ...device,
    presetId: "responsive",
    width:
      edge === "bottom"
        ? device.width
        : clampBrowserDeviceDimension(
            "width",
            device.width + (dx * (edge.includes("left") ? -2 : 2)) / scale,
          ),
    height: edge.includes("bottom")
      ? clampBrowserDeviceDimension("height", device.height + dy / scale)
      : device.height,
  };
}
