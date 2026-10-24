import type { BrowserPreferences } from "./browserPreferences";
import type { ConfigRequirements } from "@limecloud/app-server-client";
import {
  managedBrowserDecision,
  managedBrowserRequiresApproval,
} from "./browserUseRequirements";
import {
  browserSiteMatches,
  browserUseDecision,
  normalizeBrowserSitePattern,
  type BrowserUse,
  type BrowserOriginPolicy,
  type BrowserPolicyField,
} from "./browserUseConfig";

export type BrowserPermission = "ask" | "allow" | "deny";
export type BrowserSitePermission = BrowserPermission | "default";
export const BROWSER_PERMISSION_ACTIONS = [
  "browse",
  "download",
  "upload",
  "debug",
  "site_tools",
] as const;
export type BrowserPermissionAction =
  (typeof BROWSER_PERMISSION_ACTIONS)[number];
export type BrowserPermissions = Record<
  BrowserPermissionAction,
  BrowserPermission
>;
export interface BrowserSitePermissions {
  pattern: string;
  permissions: Record<BrowserPermissionAction, BrowserSitePermission>;
}
export const DEFAULT_BROWSER_SITE_PERMISSIONS: BrowserSitePermissions["permissions"] =
  Object.freeze({
    browse: "default",
    download: "default",
    upload: "default",
    debug: "default",
    site_tools: "default",
  });
export interface BrowserAgentPermissions {
  default: BrowserPermissions;
  sites: readonly BrowserSitePermissions[];
}

export const ORIGIN_STATE_KEYS = {
  browse: ["allowedOrigins", "deniedOrigins"],
  download: ["allowedDownloadOrigins", "deniedDownloadOrigins"],
  upload: ["allowedUploadOrigins", "deniedUploadOrigins"],
  debug: ["allowedFullCdpOrigins", "deniedFullCdpOrigins"],
  site_tools: ["allowedWebMcpOrigins", "deniedWebMcpOrigins"],
} as const;
export const ORIGIN_POLICY_KEYS: Record<
  BrowserPermissionAction,
  BrowserPolicyField
> = {
  browse: "access",
  download: "downloads",
  upload: "uploads",
  debug: "full_cdp_access",
  site_tools: "access",
};
export const ORIGIN_APPROVAL_KEYS = {
  browse: "approvalMode",
  download: "downloadApprovalMode",
  upload: "uploadApprovalMode",
} as const;

export function browserPermissionForUrl(
  settings: BrowserPreferences & {
    browser_use: BrowserUse | null;
    requirements?: ConfigRequirements | null;
  },
  action: BrowserPermissionAction,
  url: string,
): BrowserPermission {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return "deny";
  }
  if (!settings.enabled || !["https:", "http:"].includes(target.protocol))
    return "deny";
  if (
    managedBrowserDecision(
      settings.requirements,
      ORIGIN_POLICY_KEYS[action],
      target,
    ) === "deny"
  )
    return "deny";
  if (
    action === "site_tools" &&
    settings.requirements?.browserUse?.allowWebmcp === false
  )
    return "deny";
  if (action === "debug" && !settings.fullCdpAccessEnabled) return "deny";
  if (action === "site_tools" && !settings.webMcpEnabled) return "deny";
  if (
    browserUseDecision(
      settings.browser_use,
      ORIGIN_POLICY_KEYS[action],
      target,
    ) === "deny"
  )
    return "deny";
  const [allowed, denied] = ORIGIN_STATE_KEYS[action];
  if (settings[denied].some((pattern) => browserSiteMatches(pattern, target)))
    return "deny";
  if (
    action in ORIGIN_APPROVAL_KEYS &&
    managedBrowserRequiresApproval(settings.requirements, target)
  )
    return "ask";
  if (settings[allowed].some((pattern) => browserSiteMatches(pattern, target)))
    return "allow";
  if (action === "debug")
    return settings.fullCdpAccessEnabled ? "allow" : "deny";
  if (action === "site_tools") return settings.webMcpEnabled ? "allow" : "deny";
  if (
    settings.requirements?.browserUse?.allowGlobalPersistentApproval === false
  )
    return "ask";
  return settings[ORIGIN_APPROVAL_KEYS[action]] === "neverAsk"
    ? "allow"
    : "ask";
}

/** The matrix is a view of config + native preferences, never another persisted policy. */
export function browserAgentPermissions(
  settings: BrowserPreferences,
  policy: BrowserUse | null,
): BrowserAgentPermissions {
  const permissions = (
    pattern: string,
  ): BrowserSitePermissions["permissions"] => {
    const rules = Object.entries(policy?.origins ?? {})
      .filter(([key]) => normalizeBrowserSitePattern(key) === pattern)
      .map(([, rule]) => rule);
    return Object.fromEntries(
      BROWSER_PERMISSION_ACTIONS.map((action) => {
        const [allowed, denied] = ORIGIN_STATE_KEYS[action];
        const field = ORIGIN_POLICY_KEYS[action];
        const values =
          action === "site_tools" ? [] : rules.map((rule) => rule[field]);
        let value: BrowserSitePermission = "default";
        if (settings[denied].includes(pattern) || values.includes("deny"))
          value = "deny";
        else if (settings[allowed].includes(pattern)) value = "allow";
        else if (
          rules.length === 1 &&
          values.includes("allow") &&
          action !== "debug" &&
          action !== "site_tools"
        )
          value = "ask";
        return [action, value];
      }),
    ) as BrowserSitePermissions["permissions"];
  };
  const patterns = new Set(
    Object.keys(policy?.origins ?? {}).map(
      (pattern) => normalizeBrowserSitePattern(pattern)!,
    ),
  );
  for (const [allowed, denied] of Object.values(ORIGIN_STATE_KEYS))
    for (const pattern of [...settings[allowed], ...settings[denied]])
      patterns.add(pattern);
  const defaults: BrowserPermissions = {
    browse: settings.approvalMode === "neverAsk" ? "allow" : "ask",
    download: settings.downloadApprovalMode === "neverAsk" ? "allow" : "ask",
    upload: settings.uploadApprovalMode === "neverAsk" ? "allow" : "ask",
    debug: settings.fullCdpAccessEnabled ? "allow" : "deny",
    site_tools: settings.webMcpEnabled ? "allow" : "deny",
  };
  for (const action of BROWSER_PERMISSION_ACTIONS) {
    if (
      action !== "site_tools" &&
      policy?.default_origin_policy?.[ORIGIN_POLICY_KEYS[action]] === "deny"
    )
      defaults[action] = "deny";
  }
  return {
    default: defaults,
    sites: [...patterns]
      .sort()
      .map((pattern) => ({ pattern, permissions: permissions(pattern) })),
  };
}

export function normalizeBrowserAgentPermissions(
  value: BrowserAgentPermissions,
): BrowserAgentPermissions {
  if (
    !value ||
    !Array.isArray(value.sites) ||
    Object.keys(value).some((key) => !["default", "sites"].includes(key))
  )
    throw new Error("Invalid browser permissions");
  const permissions = (
    input: BrowserSitePermissions["permissions"],
    site = false,
  ) => {
    if (
      !input ||
      Object.keys(input).some(
        (key) =>
          !BROWSER_PERMISSION_ACTIONS.includes(key as BrowserPermissionAction),
      ) ||
      BROWSER_PERMISSION_ACTIONS.some(
        (key) =>
          !(
            site
              ? ["default", "ask", "allow", "deny"]
              : ["ask", "allow", "deny"]
          ).includes(input[key]),
      )
    )
      throw new Error("Invalid browser permissions");
    return { ...input };
  };
  const patterns = new Set<string>();
  return {
    default: permissions(value.default) as BrowserPermissions,
    sites: value.sites.map((site) => {
      const pattern =
        typeof site.pattern === "string" &&
        normalizeBrowserSitePattern(site.pattern);
      if (!pattern || patterns.has(pattern))
        throw new Error("Invalid or duplicate browser site pattern");
      patterns.add(pattern);
      return { pattern, permissions: permissions(site.permissions, true) };
    }),
  };
}

export function applyBrowserAgentPermissions(
  prefs: BrowserPreferences,
  policy: BrowserUse | null,
  previous: BrowserAgentPermissions,
  input: BrowserAgentPermissions,
): { browser: BrowserPreferences; browser_use: BrowserUse } {
  const next = normalizeBrowserAgentPermissions(input);
  const browser = structuredClone(prefs);
  const browser_use: BrowserUse = structuredClone(policy ?? {});
  const origins: Record<string, BrowserOriginPolicy> = {
    ...browser_use.origins,
  };
  const remove = (pattern: string) => {
    for (const key of Object.keys(origins))
      if (normalizeBrowserSitePattern(key) === pattern) delete origins[key];
    for (const [allowed, denied] of Object.values(ORIGIN_STATE_KEYS)) {
      browser[allowed] = browser[allowed].filter((key) => key !== pattern);
      browser[denied] = browser[denied].filter((key) => key !== pattern);
    }
  };
  for (const site of previous.sites)
    if (!next.sites.some((entry) => entry.pattern === site.pattern))
      remove(site.pattern);
  const set = (
    action: BrowserPermissionAction,
    permission: BrowserSitePermission,
    pattern?: string,
  ) => {
    if ((action === "debug" || action === "site_tools") && permission === "ask")
      throw new Error("This capability only supports allow or deny");
    const field = ORIGIN_POLICY_KEYS[action];
    if (pattern) {
      const [allowed, denied] = ORIGIN_STATE_KEYS[action];
      if (
        permission === "ask" &&
        action in ORIGIN_APPROVAL_KEYS &&
        browser[
          ORIGIN_APPROVAL_KEYS[action as keyof typeof ORIGIN_APPROVAL_KEYS]
        ] === "neverAsk"
      )
        throw new Error(
          "Change the default from Always allow before requiring approval for individual sites",
        );
      // Replace all canonical aliases for this field, preserving unrelated sparse policy fields.
      if (action !== "site_tools") {
        for (const key of Object.keys(origins))
          if (normalizeBrowserSitePattern(key) === pattern)
            origins[key] = { ...origins[key], [field]: null };
        origins[pattern] = {
          ...origins[pattern],
          [field]:
            permission === "default"
              ? null
              : permission === "deny"
                ? "deny"
                : "allow",
        };
      }
      browser[allowed] = browser[allowed].filter((key) => key !== pattern);
      browser[denied] = browser[denied].filter((key) => key !== pattern);
      if (permission === "allow") browser[allowed].push(pattern);
      if (permission === "deny") browser[denied].push(pattern);
    } else {
      if (permission === "default")
        throw new Error("Default is only valid for site overrides");
      if (action !== "site_tools")
        browser_use.default_origin_policy = {
          access: null,
          downloads: null,
          uploads: null,
          full_cdp_access: null,
          ...browser_use.default_origin_policy,
          [field]: permission === "deny" ? "deny" : "allow",
        };
      if (action === "debug")
        browser.fullCdpAccessEnabled = permission === "allow";
      else if (action === "site_tools")
        browser.webMcpEnabled = permission === "allow";
      else
        browser[ORIGIN_APPROVAL_KEYS[action]] =
          permission === "allow" ? "neverAsk" : "alwaysAsk";
    }
  };
  for (const action of BROWSER_PERMISSION_ACTIONS)
    if (next.default[action] !== previous.default[action])
      set(action, next.default[action]);
  for (const site of next.sites) {
    const old = previous.sites.find((entry) => entry.pattern === site.pattern);
    if (!old) origins[site.pattern] ??= {};
    for (const action of BROWSER_PERMISSION_ACTIONS)
      if (site.permissions[action] !== (old?.permissions[action] ?? "default"))
        set(action, site.permissions[action], site.pattern);
  }
  browser_use.origins = origins as NonNullable<BrowserUse["origins"]>;
  return { browser, browser_use };
}
