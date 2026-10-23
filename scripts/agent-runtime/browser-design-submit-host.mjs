import { app } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.env.LIME_BROWSER_DESIGN_ROOT;
if (!root || !path.isAbsolute(root))
  throw new Error("Design fixture requires an absolute application root");
app.setAppPath(root);
const evidence = {
  visibilityOnly: true,
  suppressedShowCalls: 0,
  unexpectedShowEvents: 0,
  preloadErrors: [],
};
globalThis.__browserDesignHostEvidence = evidence;
app.on("browser-window-created", (_event, window) => {
  // Suppress presentation only; production IPC, browser and quit remain unchanged.
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
