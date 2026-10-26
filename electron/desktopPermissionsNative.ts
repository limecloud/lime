import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { app } from "./electronRuntime";
import {
  desktopApplicationPath,
  resolveDesktopResourcesRoot,
} from "./desktopResources";
import {
  DESKTOP_PERMISSION_STATES,
  type DesktopPermissionState,
} from "../src/lib/api/desktopPermissionsTypes";

interface Binding {
  readNotifications(): Promise<string>;
  requestNotifications(): Promise<string>;
  readLocation(): string;
  requestLocation(): string;
}
let binding: Binding | undefined;

function load(): Binding {
  if (binding) return binding;
  const root = resolveDesktopResourcesRoot({
    isPackaged: app.isPackaged,
    defaultApp: process.defaultApp,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
  });
  if (!root) throw new Error("Desktop permissions resources unavailable");
  const manifest = JSON.parse(
    readFileSync(path.join(root, "desktop-resources.manifest.json"), "utf8"),
  );
  const entry = manifest.resources?.find(
    (item: { id: string }) => item.id === "desktop-permissions",
  );
  if (
    manifest.schemaVersion !== 1 ||
    manifest.applicationId !== "com.limecloud.lime" ||
    manifest.platform !== "darwin" ||
    manifest.arch !== process.arch ||
    entry?.path !== "native/macos/desktop-permissions.node"
  )
    throw new Error("Invalid desktop permissions resource manifest");
  const file = path.join(root, entry.path);
  if (realpathSync(file) !== path.join(realpathSync(root), entry.path))
    throw new Error("Desktop permissions resource escapes resources");
  const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
  // Forge signs nested Mach-O after the unsigned resource receipt is created.
  // A release resource is always verified by the system code-signing verifier.
  if (app.isPackaged && process.defaultApp !== true) {
    execFileSync(
      "codesign",
      [
        "--verify",
        "--deep",
        "--strict",
        desktopApplicationPath(app.getPath("exe"), "darwin"),
      ],
      { stdio: "pipe" },
    );
  } else if (digest !== entry.sha256) {
    throw new Error("Desktop permissions resource integrity mismatch");
  }
  const value = createRequire(import.meta.url)(file) as Binding;
  for (const method of [
    "readNotifications",
    "requestNotifications",
    "readLocation",
    "requestLocation",
  ] as const)
    if (typeof value[method] !== "function")
      throw new Error("Invalid desktop permissions binding");
  binding = value;
  return value;
}

export async function nativeDesktopPermission(
  id: "notifications" | "location",
  request = false,
): Promise<DesktopPermissionState> {
  if (process.platform !== "darwin") return "notApplicable";
  const native = load();
  const result =
    id === "notifications"
      ? await (request
          ? native.requestNotifications()
          : native.readNotifications())
      : request
        ? native.requestLocation()
        : native.readLocation();
  if (!DESKTOP_PERMISSION_STATES.includes(result as DesktopPermissionState))
    throw new Error("Invalid native desktop permission state");
  return result as DesktopPermissionState;
}
