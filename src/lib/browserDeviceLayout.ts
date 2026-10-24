import type { BrowserDevicePreset } from "./browserDevicePresets";

export interface BrowserDeviceBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserDeviceState {
  presetId?: BrowserDevicePreset;
  width: number;
  height: number;
  deviceScaleFactor: number;
  scale: number;
  mobile: boolean;
}

export interface BrowserDeviceViewport {
  bounds: BrowserDeviceBounds;
  scale: number;
}

export const browserDeviceGutter = 20;

export const browserDeviceLimits = {
  width: { min: 240, max: 4096 },
  height: { min: 160, max: 4096 },
} as const;

export function clampBrowserDeviceDimension(
  key: "width" | "height",
  value: number,
): number {
  const { min, max } = browserDeviceLimits[key];
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** The requested scale is a ceiling; fitting never changes the user's device. */
export function layoutBrowserDevice(
  container: BrowserDeviceBounds,
  device: BrowserDeviceState,
): BrowserDeviceViewport {
  const width = Math.max(0, container.width - browserDeviceGutter * 2);
  const height = Math.max(0, container.height - browserDeviceGutter);
  const scale = Math.max(
    0,
    Math.min(device.scale, width / device.width, height / device.height),
  );
  const viewWidth = Math.min(width, Math.round(device.width * scale));
  const viewHeight = Math.min(height, Math.round(device.height * scale));
  return {
    bounds: {
      x: container.x + Math.round((container.width - viewWidth) / 2),
      y: container.y,
      width: viewWidth,
      height: viewHeight,
    },
    scale,
  };
}

export function isBrowserDeviceViewport(
  value: unknown,
): value is BrowserDeviceViewport {
  if (!value || typeof value !== "object") return false;
  const { bounds, scale } = value as BrowserDeviceViewport;
  return (
    typeof scale === "number" &&
    Number.isFinite(scale) &&
    scale >= 0 &&
    scale <= 3 &&
    !!bounds &&
    typeof bounds === "object" &&
    [bounds.x, bounds.y, bounds.width, bounds.height].every(
      (item) => Number.isInteger(item) && item >= 0,
    )
  );
}
