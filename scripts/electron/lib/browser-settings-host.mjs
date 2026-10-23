import { app } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.env.LIME_BROWSER_SETTINGS_ROOT;
if (!root || !path.isAbsolute(root))
  throw new Error("Settings fixture requires an absolute application root");
app.setAppPath(root);
const evidence = {
  suppressedShowCalls: 0,
  unexpectedShowEvents: 0,
  preloadErrors: [],
};
globalThis.__browserSettingsHostEvidence = evidence;
app.on("browser-window-created", (_event, window) => {
  // 只抑制显示；保留生产 Main、preload、IPC 与 App Server。
  window.show = window.showInactive = () => ++evidence.suppressedShowCalls;
  window.on("show", () => ++evidence.unexpectedShowEvents);
});
app.on("web-contents-created", (_event, contents) => {
  contents.on("preload-error", (_event, _file, error) =>
    evidence.preloadErrors.push(String(error)),
  );
});
void app.whenReady().then(() => {
  if (process.platform === "darwin") app.setActivationPolicy("prohibited");
});
await import(pathToFileURL(path.join(root, "dist-electron/main/main.js")).href);
