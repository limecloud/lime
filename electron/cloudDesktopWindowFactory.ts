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
  validateCloudDesktopViewEndpoint,
} from "../src/lib/desktop-host/cloudDesktopConnection";

const viewerNavigation = new WeakMap<object, { origin?: string }>();

/** Main registers only the validated desktop listener for this exact webContents. */
export function allowCloudDesktopView(
  contents: object,
  endpoint: string,
): void {
  const state = viewerNavigation.get(contents);
  if (state)
    state.origin = new URL(validateCloudDesktopViewEndpoint(endpoint)).origin;
}

export function isCloudFrameNavigationAllowed(
  target: string,
  isMainFrame: boolean,
  rendererUrl: string,
  viewerOrigin?: string,
): boolean {
  try {
    const next = new URL(target);
    const renderer = new URL(rendererUrl);
    if (isMainFrame)
      return (
        next.origin === renderer.origin && next.pathname === renderer.pathname
      );
    return (
      next.protocol === "http:" &&
      next.origin === viewerOrigin &&
      next.origin !== renderer.origin
    );
  } catch {
    return false;
  }
}

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
  const navigation = { origin: undefined as string | undefined };
  viewerNavigation.set(window.webContents, navigation);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, target) => {
    if (!isCloudFrameNavigationAllowed(target, true, rendererUrl))
      event.preventDefault();
  });
  window.webContents.on("will-frame-navigate", (event) => {
    if (
      !isCloudFrameNavigationAllowed(
        event.url,
        event.isMainFrame,
        rendererUrl,
        navigation.origin,
      )
    )
      event.preventDefault();
  });
  window.webContents.on(
    "will-redirect",
    (event, target, _inPlace, isMainFrame) => {
      if (
        !isCloudFrameNavigationAllowed(
          target,
          isMainFrame,
          rendererUrl,
          navigation.origin,
        )
      )
        event.preventDefault();
    },
  );
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
