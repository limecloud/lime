import { app, session, shell } from "electron";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { observeBrowserDownloadShell } from "./browser-download-file-actions.mjs";

const root = process.env.LIME_BROWSER_RESTART_ROOT;
if (!root || !path.isAbsolute(root))
  throw new Error("Restart fixture requires an absolute application root");
app.setAppPath(root);
const evidence = {
  visibilityOnly: true,
  suppressedShowCalls: 0,
  unexpectedShowEvents: 0,
  preloadErrors: [],
  downloads: [],
};
if (process.env.LIME_BROWSER_RESTART_SYSTEM_ACTIONS === "1") {
  evidence.visibilityOnly = false;
  evidence.systemActions = observeBrowserDownloadShell(shell).actions;
  evidence.instrumentation = ["window-visibility", "delegating-shell-observer"];
}
globalThis.__browserRestartEvidence = evidence;
// Observe lifecycle events without wrapping app.quit or cancelling them.
for (const event of ["before-quit", "window-all-closed", "will-quit", "quit"])
  app.on(event, () => {
    process.stderr.write(
      `[browser-restart-quit]${JSON.stringify({ event, pid: process.pid, at: new Date().toISOString() })}\n`,
    );
  });
process.once("exit", (exitCode) => {
  process.stderr.write(
    `[browser-restart-quit]${JSON.stringify({ event: "process-exit", pid: process.pid, exitCode, at: new Date().toISOString() })}\n`,
  );
});
app.on("browser-window-created", (_event, window) => {
  // Suppress presentation only. The production main, IPC and download lifecycle still run.
  window.show = window.showInactive = () => {
    ++evidence.suppressedShowCalls;
  };
  window.on("show", () => ++evidence.unexpectedShowEvents);
});
app.on("web-contents-created", (_event, contents) => {
  contents.on("preload-error", (_event, _file, error) => {
    evidence.preloadErrors.push(String(error));
  });
});
void app
  .whenReady()
  .then(() => {
    if (process.platform === "darwin") app.setActivationPolicy("prohibited");
    session
      .fromPartition("persist:embedded-browser")
      .on("will-download", (_event, item, contents) => {
        const record = {
          webContentsId: contents?.id ?? null,
          filename: item.getFilename(),
          offset: item.getReceivedBytes(),
          totalBytes: item.getTotalBytes(),
          states: [],
        };
        evidence.downloads.push(record);
        item.on("updated", (_event, state) => record.states.push(state));
        item.once("done", (_event, state) => {
          record.done = state;
          record.receivedBytes = item.getReceivedBytes();
        });
      });
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
// Production scheme registration must run before ready; only native session observation waits.
await import(pathToFileURL(path.join(root, "dist-electron/main/main.js")).href);
