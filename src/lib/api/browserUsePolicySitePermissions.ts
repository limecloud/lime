import type { ConfigReadResponse } from "@limecloud/app-server-client";
import type { BrowserSettings } from "./browserSettingsTypes";
import {
  BROWSER_PERMISSION_ACTIONS,
  ORIGIN_STATE_KEYS,
  ORIGIN_POLICY_KEYS,
  ORIGIN_APPROVAL_KEYS,
  type BrowserAgentPermissions,
  type BrowserPermission,
  type BrowserPermissionAction,
} from "./browserOriginState";
import {
  browserSitePatternCovers,
  browserSitePatternsOverlap,
  normalizeBrowserSitePattern,
  type BrowserPolicyField,
} from "./browserUseConfig";
import { isConfigFieldManaged } from "./configLayers";

export interface BrowserPermissionContext {
  origins: ConfigReadResponse["origins"];
  userPermissions: BrowserAgentPermissions;
}

export interface BrowserPermissionCell {
  effectiveValue: BrowserPermission | "mixed";
  inherited: boolean;
  managed: boolean;
  blockingPattern?: string;
  inheritedRestriction?: "user" | "organization";
  disabledReason?: "managed" | "browserUnavailable" | "capabilityUnavailable";
}

export function browserPermissionFieldManaged(
  context: BrowserPermissionContext | null,
  field: string,
): boolean {
  return context !== null && isConfigFieldManaged(context.origins, field);
}

export function browserPermissionRowManaged(
  settings: BrowserSettings,
  context: BrowserPermissionContext | null,
  pattern: string,
): boolean {
  return BROWSER_PERMISSION_ACTIONS.some(
    (action) =>
      browserSitePermissionCell(settings, context, action, pattern).managed,
  );
}

/** Read-only projection of saved choices and origin sets, not a permission authority. */
export function browserSitePermissionCell(
  settings: BrowserSettings,
  context: BrowserPermissionContext | null,
  action: BrowserPermissionAction,
  pattern: string,
): BrowserPermissionCell {
  const field = ORIGIN_POLICY_KEYS[action];
  const [allowed, denied] = ORIGIN_STATE_KEYS[action];
  const managed = (path: string) =>
    browserPermissionFieldManaged(context, path);
  const site = settings.agent_permissions.sites.find(
    (entry) => entry.pattern === pattern,
  );
  const inherited = Boolean(pattern && site?.permissions[action] === "default");
  const policyPath = pattern
    ? `browser_use.origins.${pattern}.${field}`
    : `browser_use.default_origin_policy.${field}`;
  const managedCell =
    (action !== "site_tools" &&
      (managed(policyPath) ||
        (pattern &&
          Object.keys(settings.browser_use?.origins ?? {}).some(
            (key) =>
              normalizeBrowserSitePattern(key) === pattern &&
              managed(`browser_use.origins.${key}.${field}`),
          )))) ||
    (pattern
      ? managed(`browser.${allowed}`) || managed(`browser.${denied}`)
      : action in ORIGIN_APPROVAL_KEYS
        ? managed(
            `browser.${ORIGIN_APPROVAL_KEYS[action as keyof typeof ORIGIN_APPROVAL_KEYS]}`,
          )
        : managed(
            `browser.${action === "debug" ? "fullCdpAccessEnabled" : "webMcpEnabled"}`,
          ));
  const base: BrowserPermissionCell = {
    effectiveValue: settings.agent_permissions.default[action],
    inherited,
    managed: Boolean(managedCell),
    ...(managedCell ? { disabledReason: "managed" } : {}),
  };
  if (!settings.enabled)
    return {
      ...base,
      effectiveValue: "deny",
      disabledReason: managed("browser.enabled")
        ? "managed"
        : "browserUnavailable",
    };
  if (
    pattern &&
    ((action === "debug" && !settings.fullCdpAccessEnabled) ||
      (action === "site_tools" && !settings.webMcpEnabled))
  )
    return {
      ...base,
      effectiveValue: "deny",
      disabledReason: managed(
        `browser.${action === "debug" ? "fullCdpAccessEnabled" : "webMcpEnabled"}`,
      )
        ? "managed"
        : "capabilityUnavailable",
    };
  if (!pattern) {
    const deniedField =
      settings.browser_use?.default_origin_policy?.access === "deny"
        ? "access"
        : settings.browser_use?.default_origin_policy?.[field] === "deny"
          ? field
          : null;
    return deniedField === null
      ? base
      : {
          ...base,
          effectiveValue: "deny",
          inheritedRestriction: managed(
            `browser_use.default_origin_policy.${deniedField}`,
          )
            ? "organization"
            : "user",
        };
  }

  const rules = Object.entries(settings.browser_use?.origins ?? {});
  const counts = new Map<string, number>();
  for (const [key] of rules) {
    const canonical = normalizeBrowserSitePattern(key)!;
    counts.set(canonical, (counts.get(canonical) ?? 0) + 1);
  }
  const admission = (key: BrowserPolicyField): BrowserPermissionCell => {
    const denials = rules.filter(
      ([rule, value]) =>
        value[key] === "deny" && browserSitePatternsOverlap(rule, pattern),
    );
    const blocker = denials.find(([rule]) =>
      browserSitePatternCovers(rule, pattern),
    );
    if (blocker)
      return {
        ...base,
        effectiveValue: "deny",
        blockingPattern: blocker[0],
        inheritedRestriction: managed(
          `browser_use.origins.${blocker[0]}.${key}`,
        )
          ? "organization"
          : "user",
        ...(managed(`browser_use.origins.${blocker[0]}.${key}`)
          ? { disabledReason: "managed" }
          : {}),
      };
    const grants = rules.filter(
      ([rule, value]) =>
        value[key] === "allow" &&
        counts.get(normalizeBrowserSitePattern(rule)!) === 1 &&
        browserSitePatternsOverlap(rule, pattern),
    );
    if (
      settings.browser_use?.default_origin_policy?.[key] === "deny" &&
      !grants.some(([rule]) => browserSitePatternCovers(rule, pattern))
    )
      return {
        ...base,
        effectiveValue: grants.length ? "mixed" : "deny",
        inheritedRestriction: managed(
          `browser_use.default_origin_policy.${key}`,
        )
          ? "organization"
          : "user",
      };
    return {
      ...base,
      effectiveValue: denials.length ? "mixed" : "allow",
      blockingPattern: denials[0]?.[0],
    };
  };
  const access = admission("access");
  const resource = field === "access" ? access : admission(field);
  const nativeDenials = settings[denied].filter((rule) =>
    browserSitePatternsOverlap(rule, pattern),
  );
  const nativeBlocker = nativeDenials.find((rule) =>
    browserSitePatternCovers(rule, pattern),
  );
  if (nativeBlocker)
    return {
      ...base,
      effectiveValue: "deny",
      blockingPattern: nativeBlocker,
      inheritedRestriction: managed(`browser.${denied}`)
        ? "organization"
        : "user",
      ...(managed(`browser.${denied}`) ? { disabledReason: "managed" } : {}),
    };
  if (access.effectiveValue === "deny") return access;
  if (resource.effectiveValue === "deny") return resource;
  if (
    access.effectiveValue === "mixed" ||
    resource.effectiveValue === "mixed" ||
    nativeDenials.length
  )
    return {
      ...base,
      effectiveValue: "mixed",
      blockingPattern:
        access.blockingPattern ?? resource.blockingPattern ?? nativeDenials[0],
    };

  const fallback: BrowserPermission =
    action in ORIGIN_APPROVAL_KEYS
      ? settings[
          ORIGIN_APPROVAL_KEYS[action as keyof typeof ORIGIN_APPROVAL_KEYS]
        ] === "neverAsk"
        ? "allow"
        : "ask"
      : "allow";
  const grants = settings[allowed].filter((rule) =>
    browserSitePatternsOverlap(rule, pattern),
  );
  return {
    ...base,
    effectiveValue:
      grants.some((rule) => browserSitePatternCovers(rule, pattern)) ||
      fallback === "allow"
        ? "allow"
        : grants.length
          ? "mixed"
          : fallback,
  };
}
