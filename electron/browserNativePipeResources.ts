import process from "node:process";
import { statSync } from "node:fs";
import path from "node:path";
import { app } from "./electronRuntime";
import { resolveDesktopResourcesRoot } from "./desktopResources";

/** External Node consumers cannot import JavaScript from inside app.asar. */
export function browserNativePipeClientPath(): string {
  const root = resolveDesktopResourcesRoot({
    isPackaged: app.isPackaged,
    defaultApp: process.defaultApp,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
  });
  if (!root) throw new Error("Browser native pipe client resource is unavailable");
  const modulePath = path.join(root, "browser-client", "client.mjs");
  if (!statSync(modulePath).isFile())
    throw new Error("Browser native pipe client resource is unavailable");
  return modulePath;
}
