/* global process */
import { contextBridge, ipcRenderer } from "electron";
import { BROWSER_OVERLAY_ACTION_CHANNEL, BROWSER_OVERLAY_UPDATE_CHANNEL, type BrowserMenuItem } from "./browserOverlayModel";

const token = process.argv.find(argument => argument.startsWith("--browser-overlay-token="))?.slice("--browser-overlay-token=".length);

contextBridge.exposeInMainWorld("browserMenu", Object.freeze({
  onUpdate(callback: (update: { menuId: string; items: BrowserMenuItem[] }) => void) {
    if (typeof callback !== "function") return;
    ipcRenderer.on(BROWSER_OVERLAY_UPDATE_CHANNEL, (_event, update) => {
      if (update?.token === token && typeof update.menuId === "string" && Array.isArray(update.items)) callback({ menuId: update.menuId, items: update.items });
    });
  },
  select(menuId: string, itemId: string) {
    ipcRenderer.send(BROWSER_OVERLAY_ACTION_CHANNEL, { token, menuId, itemId });
  },
  dismiss(menuId: string, reason: "escape" | "outside") {
    if (reason !== "escape" && reason !== "outside") return;
    ipcRenderer.send(BROWSER_OVERLAY_ACTION_CHANNEL, { token, menuId, reason });
  },
}));
