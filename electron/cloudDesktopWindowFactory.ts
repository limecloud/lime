import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow, session } from "./electronRuntime";
import {
  buildMainWindowChromeOptions,
  buildMainWindowStartupOptions,
} from "./mainWindowOptions";
import {
  CLOUD_DESKTOP_WINDOW_ARGUMENT,
  type CloudDesktopWindowContext,
} from "../src/lib/desktop-host/cloudDesktopConnection";

export function createCloudDesktopWindow(
  context: CloudDesktopWindowContext,
  partition: string,
): BrowserWindow {
  const cloudSession = session.fromPartition(partition);
  cloudSession.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  cloudSession.setPermissionCheckHandler(() => false);
  cloudSession.on("will-download", (event) => event.preventDefault());
  const rendererRoot = path.resolve(app.getAppPath(), "dist");
  cloudSession.webRequest.onBeforeRequest(
    { urls: ["file://*/*", "asset://*/*"] },
    (details, callback) => {
      callback({ cancel: !isCloudRendererAsset(details.url, rendererRoot) });
    },
  );
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 480,
    minHeight: 600,
    title: `Lime · ${context.resource.resourceId}`,
    ...buildMainWindowStartupOptions(),
    ...buildMainWindowChromeOptions(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      partition,
      preload: path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../preload/preload.cjs",
      ),
      additionalArguments: [
        CLOUD_DESKTOP_WINDOW_ARGUMENT +
          encodeURIComponent(JSON.stringify(context)),
      ],
    },
  });
  const rendererUrl =
    process.env.VITE_DEV_SERVER_URL?.trim() ||
    pathToFileURL(path.join(rendererRoot, "index.html")).toString();
  const allowed = new URL(rendererUrl);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, target) => {
    const next = new URL(target);
    if (next.origin !== allowed.origin || next.pathname !== allowed.pathname)
      event.preventDefault();
  });
  window.once("ready-to-show", () => window.show());
  // Registry installation is synchronous; no renderer can invoke IPC before it is registered.
  queueMicrotask(() => {
    if (!window.isDestroyed())
      void window.loadURL(rendererUrl).catch(() => {
        if (!window.isDestroyed()) window.close();
      });
  });
  return window;
}

export function isCloudRendererAsset(
  url: string,
  rendererRoot: string,
): boolean {
  try {
    if (new URL(url).protocol !== "file:") return false;
    const relative = path.relative(rendererRoot, fileURLToPath(url));
    return (
      relative !== "" &&
      !relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative)
    );
  } catch {
    return false;
  }
}
