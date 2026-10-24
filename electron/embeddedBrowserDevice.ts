import {
  layoutBrowserDevice,
  type BrowserDeviceBounds,
} from "../src/lib/browserDeviceLayout";
import type { EmbeddedBrowserEntry } from "./embeddedBrowserHost";
import {
  applyBrowserDevice,
  type EmbeddedBrowserDeviceState,
} from "./embeddedBrowserPageActions";
import { applyBounds } from "./embeddedBrowserState";

export function layoutEmbeddedBrowser(
  entry: EmbeddedBrowserEntry,
  bounds: BrowserDeviceBounds = entry.containerBounds,
  visible = entry.visible,
): void {
  entry.containerBounds = { ...bounds };
  entry.visible = visible;
  entry.deviceViewport = entry.device
    ? layoutBrowserDevice(bounds, entry.device)
    : null;
  const viewport = entry.deviceViewport;
  applyBounds(entry.view, viewport?.bounds ?? bounds, visible);
  if (entry.device && viewport && viewport.scale > 0) {
    applyBrowserDevice(entry.view.webContents, {
      ...entry.device,
      scale: viewport.scale,
    });
  }
}

export function setEmbeddedBrowserDevice(
  entry: EmbeddedBrowserEntry,
  device: EmbeddedBrowserDeviceState | null,
): void {
  if (!device) applyBrowserDevice(entry.view.webContents, null);
  entry.device = device;
  layoutEmbeddedBrowser(entry);
}
