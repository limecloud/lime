export const BROWSER_SITE_PERMISSIONS = [
  "camera",
  "microphone",
  "geolocation",
  "notifications",
  "clipboard",
  "sound",
  "protectedContent",
  "automaticDownloads",
  "images",
] as const;
export type BrowserSitePermission = (typeof BROWSER_SITE_PERMISSIONS)[number];

export function browserSitePermissionAvailable(
  permission: BrowserSitePermission,
): boolean {
  // The shipped engine has no protected-content identity service.
  return permission !== "protectedContent";
}

export const BROWSER_SITE_PERMISSION_SETTINGS = [
  "ask",
  "allow",
  "block",
] as const;
export type BrowserSitePermissionSetting =
  (typeof BROWSER_SITE_PERMISSION_SETTINGS)[number];
export function browserSitePermissionSettings(
  permission: BrowserSitePermission,
): readonly BrowserSitePermissionSetting[] {
  return permission === "sound" || permission === "images"
    ? ["allow", "block"]
    : BROWSER_SITE_PERMISSION_SETTINGS;
}
export const BROWSER_SITE_SETTINGS_COMMANDS = [
  "browser_site_settings_list",
  "browser_site_settings_update",
  "browser_site_settings_remove",
] as const;
export type BrowserSiteSettingsCommand =
  (typeof BROWSER_SITE_SETTINGS_COMMANDS)[number];

export type BrowserSiteSettingsEntry = { origin: string } & Record<
  BrowserSitePermission,
  BrowserSitePermissionSetting | null
>;

export interface BrowserSiteSettingsSnapshot {
  revision: number;
  defaults: Record<BrowserSitePermission, BrowserSitePermissionSetting>;
  sites: BrowserSiteSettingsEntry[];
}

export type BrowserSiteSettingsUpdate = {
  permission: BrowserSitePermission;
} & (
  | { origin: null; setting: BrowserSitePermissionSetting }
  | { origin: string; setting: BrowserSitePermissionSetting | null }
);

export const DEFAULT_BROWSER_SITE_SETTINGS: BrowserSiteSettingsSnapshot["defaults"] =
  {
    camera: "ask",
    microphone: "ask",
    geolocation: "ask",
    notifications: "ask",
    clipboard: "ask",
    sound: "allow",
    protectedContent: "block",
    automaticDownloads: "ask",
    images: "allow",
  };

export function parseBrowserSiteOrigin(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    value !== value.trim()
  )
    throw new Error("Invalid browser site origin");
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.origin !== value ||
      url.username ||
      url.password
    )
      throw new Error("Invalid browser site origin");
    return url.origin;
  } catch {
    throw new Error("Invalid browser site origin");
  }
}

export function parseBrowserSitePermission(
  value: unknown,
): BrowserSitePermission {
  if (!BROWSER_SITE_PERMISSIONS.includes(value as BrowserSitePermission))
    throw new Error("Invalid browser site permission");
  return value as BrowserSitePermission;
}

export function parseBrowserSitePermissionSetting(
  value: unknown,
  permission?: BrowserSitePermission,
): BrowserSitePermissionSetting {
  if (
    !(
      permission
        ? browserSitePermissionSettings(permission)
        : BROWSER_SITE_PERMISSION_SETTINGS
    ).includes(value as BrowserSitePermissionSetting)
  )
    throw new Error("Invalid browser site permission setting");
  return value as BrowserSitePermissionSetting;
}

export function parseBrowserSiteSettingsUpdate(
  value: unknown,
): BrowserSiteSettingsUpdate {
  const record = exactRecord(value, ["origin", "permission", "setting"]);
  const permission = parseBrowserSitePermission(record.permission);
  if (record.origin === null)
    return {
      origin: null,
      permission,
      setting: parseBrowserSitePermissionSetting(record.setting, permission),
    };
  return {
    origin: parseBrowserSiteOrigin(record.origin),
    permission,
    setting:
      record.setting === null
        ? null
        : parseBrowserSitePermissionSetting(record.setting, permission),
  };
}

export function assertBrowserSiteSettingsSnapshot(
  value: unknown,
): asserts value is BrowserSiteSettingsSnapshot {
  const record = exactRecord(value, ["revision", "defaults", "sites"]);
  if (
    typeof record.revision !== "number" ||
    !Number.isSafeInteger(record.revision) ||
    record.revision < 0 ||
    !Array.isArray(record.sites) ||
    record.sites.length > 1000
  )
    throw new Error("Invalid browser site settings snapshot");
  const defaults = exactRecord(record.defaults, BROWSER_SITE_PERMISSIONS);
  for (const permission of BROWSER_SITE_PERMISSIONS)
    parseBrowserSitePermissionSetting(defaults[permission], permission);
  const origins = new Set<string>();
  for (const item of record.sites) {
    const site = exactRecord(item, ["origin", ...BROWSER_SITE_PERMISSIONS]);
    const origin = parseBrowserSiteOrigin(site.origin);
    if (origins.has(origin)) throw new Error("Duplicate browser site origin");
    origins.add(origin);
    for (const permission of BROWSER_SITE_PERMISSIONS) {
      const setting = site[permission];
      if (setting !== null)
        parseBrowserSitePermissionSetting(setting, permission);
    }
  }
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key)) ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    throw new Error("Invalid browser site settings value");
  return value as Record<string, unknown>;
}
