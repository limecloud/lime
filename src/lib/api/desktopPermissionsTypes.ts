export const DESKTOP_PERMISSIONS_COMMANDS = [
  "desktop_permissions_read",
  "desktop_permissions_request",
  "desktop_permissions_open_settings",
  "desktop_permissions_targets",
  "desktop_permissions_complete",
] as const;

export const DESKTOP_PERMISSION_IDS = [
  "installation",
  "secureStorage",
  "accessibility",
  "screenCapture",
  "inputMonitoring",
  "automation",
  "microphone",
  "camera",
  "notifications",
  "files",
  "fullDiskAccess",
  "localNetwork",
  "location",
] as const;
export type DesktopPermissionId = (typeof DESKTOP_PERMISSION_IDS)[number];
export const DESKTOP_PERMISSION_STATES = [
  "granted",
  "denied",
  "notDetermined",
  "restricted",
  "unknown",
  "unavailable",
  "notApplicable",
  "onDemand",
] as const;
export type DesktopPermissionState = (typeof DESKTOP_PERMISSION_STATES)[number];
export interface DesktopPermission {
  id: DesktopPermissionId;
  state: DesktopPermissionState;
  canRequest: boolean;
  canOpenSettings: boolean;
}
export interface DesktopPermissionsSnapshot {
  platform: "darwin" | "win32" | "other";
  setupComplete: boolean;
  applicationPath: string;
  nativeApplicationId: string | null;
  selectedDirectory: string | null;
  permissions: DesktopPermission[];
}
export interface AutomationTarget {
  bundleId: string;
  name: string;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid desktop permissions response");
  return value as Record<string, unknown>;
}
export function parseDesktopPermissions(
  value: unknown,
): DesktopPermissionsSnapshot {
  const data = record(value);
  if (
    !["darwin", "win32", "other"].includes(String(data.platform)) ||
    typeof data.setupComplete !== "boolean" ||
    typeof data.applicationPath !== "string" ||
    !(
      data.nativeApplicationId === null ||
      typeof data.nativeApplicationId === "string"
    ) ||
    !(
      data.selectedDirectory === null ||
      typeof data.selectedDirectory === "string"
    ) ||
    !Array.isArray(data.permissions) ||
    data.permissions.length !== DESKTOP_PERMISSION_IDS.length
  )
    throw new Error("Invalid desktop permissions snapshot");
  const seen = new Set<string>();
  for (const item of data.permissions) {
    const entry = record(item);
    if (
      !DESKTOP_PERMISSION_IDS.includes(entry.id as DesktopPermissionId) ||
      !DESKTOP_PERMISSION_STATES.includes(
        entry.state as DesktopPermissionState,
      ) ||
      typeof entry.canRequest !== "boolean" ||
      typeof entry.canOpenSettings !== "boolean" ||
      seen.has(String(entry.id))
    )
      throw new Error("Invalid desktop permission entry");
    seen.add(String(entry.id));
  }
  return data as unknown as DesktopPermissionsSnapshot;
}
export function parseAutomationTargets(value: unknown): AutomationTarget[] {
  if (!Array.isArray(value) || value.length > 1024)
    throw new Error("Invalid automation targets");
  return value.map((item) => {
    const entry = record(item);
    if (
      typeof entry.bundleId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9.-]{0,254}$/.test(entry.bundleId) ||
      typeof entry.name !== "string" ||
      entry.name.length > 512
    )
      throw new Error("Invalid automation target");
    return { bundleId: entry.bundleId, name: entry.name };
  });
}
