import process from "node:process";
import { statSync } from "node:fs";
import path from "node:path";
import { app } from "./electronRuntime";

/** External Node consumers cannot import JavaScript from inside app.asar. */
export function browserNativePipeClientPath(): string {
  const root = app.isPackaged
    ? process.resourcesPath
    : path.join(app.getAppPath(), "dist-electron");
  const modulePath = path.join(root, "browser-client", "client.mjs");
  if (!statSync(modulePath).isFile())
    throw new Error("Browser native pipe client resource is unavailable");
  return modulePath;
}
