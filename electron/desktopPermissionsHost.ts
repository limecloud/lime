import path from "node:path";
import { access, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import {
  DESKTOP_PERMISSION_IDS,
  DESKTOP_PERMISSIONS_COMMANDS,
  parseAutomationTargets,
  type AutomationTarget,
  type DesktopPermissionId,
  type DesktopPermissionState,
  type DesktopPermissionsSnapshot,
} from "../src/lib/api/desktopPermissionsTypes";
import type { SafeStorageLike } from "./secureCredentialStore";
import { DesktopPermissionsSetupStore } from "./desktopPermissionsSetupStore";

type NativeInvoke = (
  method: string,
  params?: Record<string, unknown>,
) => Promise<unknown>;
interface Options {
  platform: string;
  appDataRoot: string;
  applicationPath: string;
  packaged: boolean;
  homeDirectory: string;
  nativeInvoke: NativeInvoke;
  safeStorage: SafeStorageLike & { getSelectedStorageBackend?(): string };
  mediaStatus(kind: "microphone" | "camera"): string;
  requestMedia(kind: "microphone" | "camera"): Promise<boolean>;
  diskAccess(): Promise<DesktopPermissionState>;
  nativePermission(
    id: "notifications" | "location",
    request?: boolean,
  ): Promise<DesktopPermissionState>;
  notificationsSupported(): boolean;
  openExternal(url: string): Promise<void>;
  revealApplication(): void;
  chooseDirectory(): Promise<string | null>;
}
const macSettings: Partial<Record<DesktopPermissionId, string>> = {
  accessibility: "Privacy_Accessibility",
  screenCapture: "Privacy_ScreenCapture",
  inputMonitoring: "Privacy_ListenEvent",
  automation: "Privacy_Automation",
  microphone: "Privacy_Microphone",
  camera: "Privacy_Camera",
  files: "Privacy_FilesAndFolders",
  fullDiskAccess: "Privacy_AllFiles",
  localNetwork: "Privacy_LocalNetwork",
  location: "Privacy_LocationServices",
};
const windowsSettings: Partial<Record<DesktopPermissionId, string>> = {
  microphone: "privacy-microphone",
  camera: "privacy-webcam",
  notifications: "notifications",
  files: "privacy-broadfilesystemaccess",
  location: "privacy-location",
  localNetwork: "network-status",
};
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function nativeState(value: unknown): DesktopPermissionState {
  const record = asRecord(value);
  if (record.requiresUserConsent === true) return "notDetermined";
  const state = record.status;
  return state === "ready"
    ? "granted"
    : state === "not_granted"
      ? "denied"
      : "unavailable";
}
function mediaState(state: string): DesktopPermissionState {
  return state === "granted"
    ? "granted"
    : state === "denied"
      ? "denied"
      : state === "restricted"
        ? "restricted"
        : state === "not-determined"
          ? "notDetermined"
          : "unknown";
}

/** Desktop OS consent only; grants no Agent application or filesystem authority. */
export class DesktopPermissionsHost {
  readonly #options: Options;
  readonly #setup: DesktopPermissionsSetupStore;
  #secureState: DesktopPermissionState = "unknown";
  #selectedDirectory: string | null = null;
  #requesting = false;
  constructor(options: Options) {
    this.#options = options;
    this.#setup = new DesktopPermissionsSetupStore(options.appDataRoot);
  }
  static supports(command: string): boolean {
    return DESKTOP_PERMISSIONS_COMMANDS.includes(
      command as (typeof DESKTOP_PERMISSIONS_COMMANDS)[number],
    );
  }
  async invoke(
    command: string,
    args?: Record<string, unknown>,
  ): Promise<unknown> {
    const allowed =
      command === "desktop_permissions_read"
        ? ["targetBundleId"]
        : command === "desktop_permissions_request"
          ? ["id", "targetBundleId"]
          : command === "desktop_permissions_open_settings"
            ? ["id"]
            : [];
    if (
      !DesktopPermissionsHost.supports(command) ||
      Object.keys(args ?? {}).some((key) => !allowed.includes(key))
    )
      throw new Error("Invalid desktop permissions command");
    const target = args?.targetBundleId;
    if (
      target !== undefined &&
      (typeof target !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9.-]{0,254}$/.test(target))
    )
      throw new Error("Invalid automation target");
    if (command === "desktop_permissions_read")
      return this.read(target as string | undefined);
    if (command === "desktop_permissions_targets") return this.targets();
    if (command === "desktop_permissions_complete") {
      await this.#setup.complete();
      return null;
    }
    const id = args?.id as DesktopPermissionId;
    if (!DESKTOP_PERMISSION_IDS.includes(id))
      throw new Error("Invalid desktop permission");
    if (command === "desktop_permissions_open_settings") {
      await this.#openSettings(id);
      return null;
    }
    if (this.#requesting)
      throw new Error("A system permission request is already pending");
    this.#requesting = true;
    try {
      await this.#request(id, target as string | undefined);
    } finally {
      this.#requesting = false;
    }
    return this.read(target as string | undefined);
  }
  async read(targetBundleId?: string): Promise<DesktopPermissionsSnapshot> {
    const o = this.#options;
    const mac = o.platform === "darwin",
      windows = o.platform === "win32";
    const states = Object.fromEntries(
      DESKTOP_PERMISSION_IDS.map((id) => [id, "unknown"]),
    ) as Record<DesktopPermissionId, DesktopPermissionState>;
    states.installation =
      o.packaged &&
      (!mac ||
        o.applicationPath.startsWith("/Applications/") ||
        o.applicationPath.startsWith(
          path.join(o.homeDirectory, "Applications") + path.sep,
        ))
        ? "granted"
        : "notDetermined";
    states.secureStorage = this.#secureState;
    let nativeApplicationId: string | null = null;
    if (mac) {
      try {
        const native = asRecord(await o.nativeInvoke("capabilities.read"));
        nativeApplicationId =
          typeof native.applicationId === "string"
            ? native.applicationId
            : null;
        for (const id of [
          "accessibility",
          "screenCapture",
          "inputMonitoring",
        ] as const)
          states[id] = nativeState(native[id]);
      } catch {
        for (const id of [
          "accessibility",
          "screenCapture",
          "inputMonitoring",
        ] as const)
          states[id] = "unavailable";
      }
      states.fullDiskAccess = await o.diskAccess();
      for (const id of ["notifications", "location"] as const) {
        try {
          states[id] = await o.nativePermission(id);
        } catch {
          states[id] = "unavailable";
        }
      }
      if (targetBundleId) {
        try {
          states.automation = nativeState(
            await o.nativeInvoke("appleEvents.read", { targetBundleId }),
          );
        } catch {
          states.automation = "unavailable";
        }
      }
    } else {
      for (const id of [
        "accessibility",
        "screenCapture",
        "inputMonitoring",
        "automation",
        "fullDiskAccess",
      ] as const)
        states[id] = "notApplicable";
    }
    for (const id of ["microphone", "camera"] as const) {
      try {
        states[id] =
          mac || windows ? mediaState(o.mediaStatus(id)) : "notApplicable";
      } catch {
        states[id] = "unknown";
      }
    }
    if (!o.notificationsSupported()) states.notifications = "unavailable";
    states.localNetwork = mac || windows ? "onDemand" : "notApplicable";
    this.#selectedDirectory ??= await this.#setup.directory();
    if (this.#selectedDirectory) {
      try {
        await access(this.#selectedDirectory, constants.R_OK);
        await readdir(this.#selectedDirectory);
        states.files = "granted";
      } catch {
        states.files = "denied";
      }
    }
    return {
      platform: mac ? "darwin" : windows ? "win32" : "other",
      setupComplete: await this.#setup.read(),
      applicationPath: o.applicationPath,
      nativeApplicationId,
      selectedDirectory: this.#selectedDirectory,
      permissions: DESKTOP_PERMISSION_IDS.map((id) => ({
        id,
        state: states[id],
        canOpenSettings:
          Boolean(this.#settingsUrl(id)) || id === "installation",
        canRequest:
          id === "secureStorage" ||
          id === "files" ||
          (mac &&
            [
              "accessibility",
              "screenCapture",
              "inputMonitoring",
              "automation",
              "microphone",
              "camera",
              "notifications",
              "location",
            ].includes(id) &&
            states[id] !== "restricted" &&
            states[id] !== "unavailable"),
      })),
    };
  }
  async targets(): Promise<AutomationTarget[]> {
    if (this.#options.platform !== "darwin") return [];
    const result = asRecord(
      await this.#options.nativeInvoke("appleEvents.targets"),
    );
    const raw = Array.isArray(result.targets) ? result.targets : [];
    return parseAutomationTargets(
      raw
        .filter(
          (entry) =>
            asRecord(entry).terminated !== true &&
            asRecord(entry).userFacing === true,
        )
        .map((entry) => ({
          bundleId: asRecord(entry).bundleId,
          name: asRecord(entry).name,
        })),
    ).filter(
      (entry, index, all) =>
        all.findIndex((other) => other.bundleId === entry.bundleId) === index,
    );
  }
  async #request(
    id: DesktopPermissionId,
    targetBundleId?: string,
  ): Promise<void> {
    const o = this.#options;
    if (id === "secureStorage") {
      try {
        if (
          !o.safeStorage.isEncryptionAvailable() ||
          o.safeStorage.getSelectedStorageBackend?.() === "basic_text"
        ) {
          this.#secureState = "unavailable";
          return;
        }
        const probe = "desktop-permissions-check";
        if (
          o.safeStorage.decryptString(o.safeStorage.encryptString(probe)) !==
          probe
        )
          throw new Error("Secure storage verification failed");
        this.#secureState = "granted";
      } catch {
        this.#secureState = "denied";
      }
      return;
    }
    if (id === "files") {
      const directory = await o.chooseDirectory();
      if (directory) {
        if (!path.isAbsolute(directory))
          throw new Error("Directory must be absolute");
        await access(directory, constants.R_OK);
        await readdir(directory);
        await this.#setup.selectDirectory(directory);
        this.#selectedDirectory = directory;
      }
      return;
    }
    if (o.platform !== "darwin") {
      await this.#openSettings(id);
      return;
    }
    if (id === "notifications" || id === "location") {
      const state = await o.nativePermission(id);
      if (state === "notDetermined") await o.nativePermission(id, true);
      else if (state !== "granted") await this.#openSettings(id);
      return;
    }
    if (id === "microphone" || id === "camera") {
      const state = o.mediaStatus(id);
      if (state === "not-determined") await o.requestMedia(id);
      else if (state !== "granted") await this.#openSettings(id);
    } else if (
      id === "accessibility" ||
      id === "screenCapture" ||
      id === "inputMonitoring"
    ) {
      const result = await o.nativeInvoke(`${id}.request`);
      if (nativeState(result) !== "granted") await this.#openSettings(id);
    } else if (id === "automation") {
      if (!targetBundleId) throw new Error("Select an automation target first");
      const targets = await this.targets();
      if (!targets.some((entry) => entry.bundleId === targetBundleId))
        throw new Error("Automation target is not running");
      const result = await o.nativeInvoke("appleEvents.request", {
        targetBundleId,
      });
      if (nativeState(result) === "denied") await this.#openSettings(id);
    } else await this.#openSettings(id);
  }
  #settingsUrl(id: DesktopPermissionId): string | null {
    if (this.#options.platform === "darwin") {
      if (id === "notifications")
        return "x-apple.systempreferences:com.apple.Notifications-Settings.extension";
      return macSettings[id]
        ? `x-apple.systempreferences:com.apple.preference.security?${macSettings[id]}`
        : null;
    }
    return this.#options.platform === "win32" && windowsSettings[id]
      ? `ms-settings:${windowsSettings[id]}`
      : null;
  }
  async #openSettings(id: DesktopPermissionId): Promise<void> {
    if (id === "installation") {
      this.#options.revealApplication();
      return;
    }
    const url = this.#settingsUrl(id);
    if (!url)
      throw new Error("No system settings are available for this permission");
    await this.#options.openExternal(url);
  }
}
