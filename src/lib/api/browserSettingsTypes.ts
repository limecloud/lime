export type BrowserPermission = "ask" | "allow" | "deny";
export type BrowserPermissionAction =
  | "browse"
  | "download"
  | "upload"
  | "debug"
  | "site_tools";
export type BrowserPermissions = Record<
  BrowserPermissionAction,
  BrowserPermission
>;
export interface BrowserSitePermissions {
  pattern: string;
  permissions: BrowserPermissions;
}
export interface BrowserSettings {
  enabled: boolean;
  show_full_url: boolean;
  annotation_screenshot: "always" | "necessary";
  download_directory: string | null;
  ask_download_location: boolean;
  history_access: "alwaysAsk" | "neverAsk" | "disabled";
  site_tools_enabled: boolean;
  full_cdp_access: boolean;
  agent_permissions: {
    default: BrowserPermissions;
    sites: readonly BrowserSitePermissions[];
  };
}

export const BROWSER_PERMISSION_ACTIONS = [
  "browse",
  "download",
  "upload",
  "debug",
  "site_tools",
] as const satisfies readonly BrowserPermissionAction[];
const DEFAULT_PERMISSIONS: BrowserPermissions = Object.freeze({
  browse: "ask",
  download: "ask",
  upload: "ask",
  debug: "ask",
  site_tools: "ask",
});

/** Site rules accept an exact origin, a hostname, or a leading subdomain wildcard. */
export function normalizeBrowserSitePattern(input: string): string | null {
  const value = input.trim().toLowerCase();
  if (!value || /[\s?#@]/u.test(value)) return null;
  const hasScheme = /^https?:\/\//u.test(value);
  const wildcard = (
    hasScheme ? value.replace(/^https?:\/\//u, "") : value
  ).startsWith("*.");
  const probe = wildcard ? value.replace("*.", "wildcard.") : value;
  try {
    const url = new URL(hasScheme ? probe : `https://${probe}`);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      (url.pathname !== "/" && url.pathname !== "/*") ||
      !url.hostname ||
      (!url.hostname.includes(".") &&
        !url.hostname.includes(":") &&
        url.hostname !== "localhost") ||
      url.hostname.includes("*") ||
      (wildcard && url.hostname === "wildcard.localhost")
    )
      return null;
    const hostname = wildcard
      ? url.hostname.replace(/^wildcard\./u, "*.")
      : url.hostname;
    // Hostname-only rules can explicitly name 443 without becoming an all-port rule.
    const explicitPort = value
      .replace(/\/(?:\*)?$/u, "")
      .match(/:(\d+)$/u)?.[1];
    const port = hasScheme
      ? url.port
      : explicitPort
        ? String(Number(explicitPort))
        : "";
    const authority = `${hostname}${port ? `:${port}` : ""}`;
    return hasScheme ? `${url.protocol}//${authority}` : authority;
  } catch {
    return null;
  }
}

export function browserPermissionForUrl(
  settings: BrowserSettings,
  action: BrowserPermissionAction,
  url: string,
): BrowserPermission {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return "deny";
  }
  if (!["https:", "http:"].includes(target.protocol)) return "deny";
  let permission = settings.agent_permissions.default[action];
  let specificity = -1;
  for (const site of settings.agent_permissions.sites) {
    const pattern = normalizeBrowserSitePattern(site.pattern);
    if (!pattern) continue;
    const hasScheme = pattern.includes("://");
    const wildcard = pattern.includes("*.");
    const rule = new URL(
      hasScheme
        ? pattern.replace("*.", "wildcard.")
        : `https://${pattern.replace("*.", "wildcard.")}`,
    );
    const host = wildcard
      ? rule.hostname.replace(/^wildcard\./u, "")
      : rule.hostname;
    if (hasScheme && rule.protocol !== target.protocol) continue;
    const rulePort = hasScheme
      ? rule.port || (rule.protocol === "https:" ? "443" : "80")
      : pattern.match(/:(\d+)$/u)?.[1];
    const targetPort =
      target.port || (target.protocol === "https:" ? "443" : "80");
    if (rulePort && rulePort !== targetPort) continue;
    if (
      wildcard
        ? !target.hostname.endsWith(`.${host}`)
        : target.hostname !== host
    )
      continue;
    const score =
      host.length * 1000 +
      (wildcard ? 0 : 100) +
      (hasScheme ? 10 : 0) +
      (rulePort ? 1 : 0);
    if (score > specificity) {
      permission = site.permissions[action];
      specificity = score;
    }
  }
  return permission;
}
export const DEFAULT_BROWSER_SETTINGS: Readonly<BrowserSettings> =
  Object.freeze({
    enabled: true,
    show_full_url: false,
    annotation_screenshot: "always",
    download_directory: null,
    ask_download_location: false,
    history_access: "alwaysAsk",
    site_tools_enabled: true,
    full_cdp_access: false,
    agent_permissions: Object.freeze({
      default: DEFAULT_PERMISSIONS,
      sites: Object.freeze([]),
    }),
  });

/** Reject malformed policy values rather than turning a corrupt setting into a grant. */
export function effectiveBrowserSettings(
  value?: Partial<BrowserSettings>,
): BrowserSettings {
  if (
    value !== undefined &&
    (!value || typeof value !== "object" || Array.isArray(value))
  ) {
    throw new Error("Invalid browser preferences");
  }
  if (
    value &&
    Object.keys(value).some(
      (key) => !Object.hasOwn(DEFAULT_BROWSER_SETTINGS, key),
    )
  ) {
    throw new Error("Unknown browser preference");
  }
  const next = { ...DEFAULT_BROWSER_SETTINGS, ...value };
  for (const key of [
    "enabled",
    "show_full_url",
    "ask_download_location",
    "site_tools_enabled",
    "full_cdp_access",
  ] as const) {
    if (typeof next[key] !== "boolean")
      throw new Error(`Invalid browser preference: ${key}`);
  }
  if (
    !["always", "necessary"].includes(next.annotation_screenshot) ||
    !["alwaysAsk", "neverAsk", "disabled"].includes(next.history_access) ||
    (next.download_directory !== null &&
      typeof next.download_directory !== "string")
  ) {
    throw new Error("Invalid browser preferences");
  }
  const policy = next.agent_permissions;
  if (
    !policy ||
    !Array.isArray(policy.sites) ||
    Object.keys(policy).some((key) => key !== "default" && key !== "sites")
  )
    throw new Error("Invalid browser permissions");
  const permissions = (source: BrowserPermissions) => {
    if (
      !source ||
      typeof source !== "object" ||
      Array.isArray(source) ||
      Object.keys(source).some(
        (key) =>
          !BROWSER_PERMISSION_ACTIONS.includes(key as BrowserPermissionAction),
      )
    ) {
      throw new Error("Invalid browser permissions");
    }
    const result = { ...DEFAULT_PERMISSIONS, ...source };
    for (const action of BROWSER_PERMISSION_ACTIONS) {
      if (!["ask", "allow", "deny"].includes(result[action])) {
        throw new Error(`Invalid browser permission: ${action}`);
      }
    }
    return result;
  };
  const patterns = new Set<string>();
  return {
    ...next,
    agent_permissions: {
      default: permissions(policy.default),
      sites: policy.sites.map((site) => {
        if (
          !site ||
          typeof site.pattern !== "string" ||
          !normalizeBrowserSitePattern(site.pattern)
        ) {
          throw new Error("Invalid browser site pattern");
        }
        const pattern = normalizeBrowserSitePattern(site.pattern)!;
        if (patterns.has(pattern))
          throw new Error("Duplicate browser site pattern");
        patterns.add(pattern);
        return { pattern, permissions: permissions(site.permissions) };
      }),
    },
  };
}
