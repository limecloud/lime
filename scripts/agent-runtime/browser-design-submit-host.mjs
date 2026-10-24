import { app } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.env.LIME_BROWSER_DESIGN_ROOT;
if (!root || !path.isAbsolute(root))
  throw new Error("Design fixture requires an absolute application root");
app.setAppPath(root);
const visible = process.env.LIME_BROWSER_DESIGN_VISIBLE === "1";
const evidence = {
  visibilityOnly: true,
  visible,
  showEvents: 0,
  suppressedShowCalls: 0,
  unexpectedShowEvents: 0,
  preloadErrors: [],
};
globalThis.__browserDesignHostEvidence = evidence;
app.on("browser-window-created", (_event, window) => {
  // Suppress presentation only; production IPC, browser and quit remain unchanged.
  if (!visible)
    window.show = window.showInactive = () => ++evidence.suppressedShowCalls;
  window.on("show", () => {
    evidence.showEvents += 1;
    if (!visible) evidence.unexpectedShowEvents += 1;
  });
});
app.on("web-contents-created", (_event, contents) => {
  contents.on("preload-error", (_event, _file, error) =>
    evidence.preloadErrors.push(String(error)),
  );
});
void app.whenReady().then(() => {
  if (process.platform === "darwin")
    app.setActivationPolicy(visible ? "regular" : "prohibited");
});
await import(pathToFileURL(path.join(root, "dist-electron/main/main.js")).href);
