import type {
  BrowserUseConfig,
  BrowserUseOriginPolicyConfig,
} from "@limecloud/app-server-client";

export type BrowserUse = Partial<BrowserUseConfig>;
export type BrowserOriginPolicy = Partial<BrowserUseOriginPolicyConfig>;
export type BrowserPolicyField =
  | "access"
  | "downloads"
  | "uploads"
  | "full_cdp_access";
export const BROWSER_POLICY_FIELDS: readonly BrowserPolicyField[] = [
  "access",
  "downloads",
  "uploads",
  "full_cdp_access",
];

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

export function browserSiteMatches(pattern: string, target: URL): boolean {
  const normalized = normalizeBrowserSitePattern(pattern);
  if (!normalized) return false;
  const hasScheme = normalized.includes("://");
  const wildcard = normalized.includes("*.");
  const rule = new URL(
    hasScheme
      ? normalized.replace("*.", "wildcard.")
      : `https://${normalized.replace("*.", "wildcard.")}`,
  );
  const host = wildcard
    ? rule.hostname.replace(/^wildcard\./u, "")
    : rule.hostname;
  const port = hasScheme
    ? rule.port || (rule.protocol === "https:" ? "443" : "80")
    : normalized.match(/:(\d+)$/u)?.[1];
  return (
    (!hasScheme || rule.protocol === target.protocol) &&
    (!port ||
      port ===
        (target.port || (target.protocol === "https:" ? "443" : "80"))) &&
    (wildcard ? target.hostname.endsWith(`.${host}`) : target.hostname === host)
  );
}

function sitePatternParts(pattern: string) {
  const normalized = normalizeBrowserSitePattern(pattern);
  if (!normalized) throw new Error("Invalid browser site pattern");
  const scheme = normalized.match(/^(https?):\/\//u)?.[1] ?? null;
  const authority = normalized.replace(/^https?:\/\//u, "");
  const port =
    authority.match(/:(\d+)$/u)?.[1] ??
    (scheme === "https" ? "443" : scheme === "http" ? "80" : null);
  const host = authority.replace(/:\d+$/u, "");
  return {
    scheme,
    port,
    host: host.replace(/^\*\./u, ""),
    wildcard: host.startsWith("*."),
  };
}

/** Compare the complete origin sets; never probe a wildcard with an invented URL. */
export function browserSitePatternCovers(
  container: string,
  subject: string,
): boolean {
  const outer = sitePatternParts(container);
  const inner = sitePatternParts(subject);
  return (
    (outer.scheme === null || outer.scheme === inner.scheme) &&
    (outer.port === null || outer.port === inner.port) &&
    (outer.wildcard
      ? (inner.wildcard && outer.host === inner.host) ||
        inner.host.endsWith(`.${outer.host}`)
      : !inner.wildcard && outer.host === inner.host)
  );
}

export function browserSitePatternsOverlap(
  first: string,
  second: string,
): boolean {
  const a = sitePatternParts(first);
  const b = sitePatternParts(second);
  return (
    (a.scheme === null || b.scheme === null || a.scheme === b.scheme) &&
    (a.port === null || b.port === null || a.port === b.port) &&
    (a.host === b.host
      ? a.wildcard === b.wildcard
      : (a.wildcard && b.host.endsWith(`.${a.host}`)) ||
        (b.wildcard && a.host.endsWith(`.${b.host}`)))
  );
}

function table(
  value: unknown,
  keys?: readonly string[],
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (keys && Object.keys(value).some((key) => !keys.includes(key)))
  )
    throw new Error("Invalid browser_use policy");
}
export function validateBrowserUse(value: unknown): BrowserUse | null {
  if (value === undefined || value === null) return null;
  table(value, ["allow_history_access", "default_origin_policy", "origins"]);
  if (
    value.allow_history_access != null &&
    typeof value.allow_history_access !== "boolean"
  )
    throw new Error("Invalid browser_use history policy");
  const policy = (input: unknown): BrowserOriginPolicy => {
    table(input, BROWSER_POLICY_FIELDS);
    if (
      Object.values(input).some(
        (v) => v !== null && v !== "allow" && v !== "deny",
      )
    )
      throw new Error("Invalid browser_use origin policy");
    return { ...input };
  };
  const result: BrowserUse = {};
  if (value.allow_history_access != null)
    result.allow_history_access = value.allow_history_access as boolean;
  if (value.default_origin_policy != null)
    result.default_origin_policy = policy(
      value.default_origin_policy,
    ) as BrowserUseOriginPolicyConfig;
  if (value.origins != null) {
    table(value.origins);
    result.origins = {};
    for (const [pattern, rule] of Object.entries(value.origins)) {
      if (!normalizeBrowserSitePattern(pattern))
        throw new Error("Invalid browser_use origin");
      result.origins[pattern] = policy(rule) as BrowserUseOriginPolicyConfig;
    }
  }
  return result;
}

/** Matching denials win; duplicate canonical aliases never supply a permissive value. */
export function browserUseDecision(
  policy: BrowserUse | null,
  field: BrowserPolicyField,
  target: URL,
): "allow" | "deny" {
  const rules = Object.entries(policy?.origins ?? {});
  const counts = new Map<string, number>();
  for (const [pattern] of rules) {
    const key = normalizeBrowserSitePattern(pattern)!;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const resolve = (key: BrowserPolicyField) => {
    let allowed = false;
    for (const [pattern, rule] of rules) {
      if (!browserSiteMatches(pattern, target)) continue;
      if (rule[key] === "deny") return "deny";
      if (
        rule[key] === "allow" &&
        counts.get(normalizeBrowserSitePattern(pattern)!) === 1
      )
        allowed = true;
    }
    return allowed
      ? "allow"
      : (policy?.default_origin_policy?.[key] ?? "allow");
  };
  return resolve("access") === "deny" ? "deny" : resolve(field);
}
