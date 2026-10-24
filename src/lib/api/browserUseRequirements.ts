import type {
  BrowserUseOriginPolicy,
  BrowserUseRequirements,
  ConfigRequirements,
} from "@limecloud/app-server-client";
import {
  BROWSER_POLICY_FIELDS,
  browserSiteMatches,
  browserSitePatternCovers,
  browserSitePatternsOverlap,
  browserUseDecision,
  normalizeBrowserSitePattern,
  type BrowserUse,
  type BrowserPolicyField,
} from "./browserUseConfig";

const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
const present = (value: unknown) => value !== undefined && value !== null;
const invalid = () => new Error("Invalid managed browser requirements");

/** Validate at both renderer and native trust boundaries; unreadable policy never means allow. */
export function assertBrowserRequirements(
  requirements: unknown,
): asserts requirements is ConfigRequirements | null {
  if (requirements === null) return;
  if (!object(requirements)) throw invalid();
  if (
    present(requirements.allowBrowserAndComputerUse) &&
    typeof requirements.allowBrowserAndComputerUse !== "boolean"
  )
    throw invalid();
  const browser = requirements.browserUse;
  if (!present(browser)) return;
  if (!object(browser)) throw invalid();
  for (const field of [
    "allowWebmcp",
    "allowHistoryAccess",
    "disableAutoReview",
    "allowGlobalPersistentApproval",
  ])
    if (present(browser[field]) && typeof browser[field] !== "boolean")
      throw invalid();
  const policy = (value: unknown) => {
    if (!object(value)) throw invalid();
    for (const field of [
      "access",
      "downloads",
      "uploads",
      "fullCdpAccess",
      "autoReview",
    ])
      if (
        present(value[field]) &&
        value[field] !== "allow" &&
        value[field] !== "deny"
      )
        throw invalid();
    if (
      present(value.persistentApproval) &&
      typeof value.persistentApproval !== "boolean"
    )
      throw invalid();
    if (
      present(value.accessApprovalLifetime) &&
      !["turn", "thread"].includes(value.accessApprovalLifetime as string)
    )
      throw invalid();
  };
  if (present(browser.defaultOriginPolicy)) policy(browser.defaultOriginPolicy);
  if (present(browser.origins)) {
    if (!object(browser.origins)) throw invalid();
    for (const [pattern, value] of Object.entries(browser.origins)) {
      if (!normalizeBrowserSitePattern(pattern)) throw invalid();
      policy(value);
    }
  }
  if (present(browser.extension)) {
    if (!object(browser.extension)) throw invalid();
    const headers = browser.extension.requestHeaders;
    if (
      present(headers) &&
      (!Array.isArray(headers) ||
        headers.some(
          (header) =>
            !object(header) ||
            typeof header.name !== "string" ||
            typeof header.value !== "string",
        ))
    )
      throw invalid();
  }
}

/** Reuse the canonical origin evaluator; managed allow never replaces a user choice. */
export function browserRequirementsAdmission(
  requirements?: ConfigRequirements | null,
): BrowserUse | null {
  const browser = requirements?.browserUse;
  if (!browser) return null;
  const origin = (policy: BrowserUseOriginPolicy) =>
    Object.fromEntries(
      BROWSER_POLICY_FIELDS.map((field) => [
        field,
        policy[field === "full_cdp_access" ? "fullCdpAccess" : field],
      ]).filter(([, value]) => value != null),
    );
  return {
    default_origin_policy: browser.defaultOriginPolicy
      ? origin(browser.defaultOriginPolicy)
      : null,
    origins: browser.origins
      ? Object.fromEntries(
          Object.entries(browser.origins).map(([pattern, value]) => [
            pattern,
            origin(value),
          ]),
        )
      : null,
  };
}

export function managedBrowserDecision(
  requirements: ConfigRequirements | null | undefined,
  field: BrowserPolicyField,
  target: URL,
) {
  if (requirements?.allowBrowserAndComputerUse === false) return "deny";
  return browserUseDecision(
    browserRequirementsAdmission(requirements),
    field,
    target,
  );
}

function managedBrowserOriginApproval(
  requirements: ConfigRequirements | null | undefined,
  target: URL,
) {
  const browser = requirements?.browserUse;
  if (!browser) return {};
  const entries = Object.entries(browser.origins ?? {});
  const counts = new Map<string, number>();
  for (const [pattern] of entries) {
    const key = normalizeBrowserSitePattern(pattern)!;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const matches = entries.filter(([pattern]) =>
    browserSiteMatches(pattern, target),
  );
  const resolve = <K extends "persistentApproval" | "accessApprovalLifetime">(
    key: K,
    restricted: BrowserUseOriginPolicy[K],
  ) => {
    if (matches.some(([, policy]) => policy[key] === restricted))
      return restricted;
    let value: BrowserUseOriginPolicy[K] | undefined;
    for (const [pattern, policy] of matches)
      if (
        counts.get(normalizeBrowserSitePattern(pattern)!) === 1 &&
        policy[key] != null
      )
        value = policy[key];
    return value ?? browser.defaultOriginPolicy?.[key];
  };
  return {
    persistentApproval: resolve("persistentApproval", false),
    accessApprovalLifetime: resolve("accessApprovalLifetime", "turn"),
  };
}

/** A saved preference has no thread identity and cannot replace a scoped receipt. */
export function managedBrowserRequiresApproval(
  requirements: ConfigRequirements | null | undefined,
  target: URL,
): boolean {
  const policy = managedBrowserOriginApproval(requirements, target);
  return (
    policy.persistentApproval === false || policy.accessApprovalLifetime != null
  );
}

export function managedBrowserAccessApprovalLifetime(
  requirements: ConfigRequirements | null | undefined,
  target: URL,
): "turn" | "thread" {
  return (
    managedBrowserOriginApproval(requirements, target).accessApprovalLifetime ??
    "thread"
  );
}

export type { BrowserUseRequirements };

export function managedBrowserApprovalForPattern(
  requirements: ConfigRequirements | null | undefined,
  pattern: string,
): "ask" | "mixed" | null {
  const browser = requirements?.browserUse;
  if (!browser) return null;
  if (!pattern)
    return browser.allowGlobalPersistentApproval === false ? "ask" : null;
  const limited = (policy: BrowserUseOriginPolicy | null | undefined) =>
    policy?.persistentApproval === false ||
    policy?.accessApprovalLifetime != null;
  const overlaps = Object.entries(browser.origins ?? {}).filter(([rule]) =>
    browserSitePatternsOverlap(rule, pattern),
  );
  if (
    overlaps.some(
      ([rule, value]) =>
        limited(value) && browserSitePatternCovers(rule, pattern),
    )
  )
    return "ask";
  if (overlaps.some(([, value]) => limited(value))) return "mixed";
  if (limited(browser.defaultOriginPolicy)) {
    if (browser.defaultOriginPolicy?.accessApprovalLifetime != null)
      return "ask";
    // A saved grant has no thread identity. A thread limit still requires a fresh receipt.
    const grants = overlaps.filter(
      ([, value]) =>
        value.persistentApproval === true &&
        value.accessApprovalLifetime == null,
    );
    return grants.some(([rule]) => browserSitePatternCovers(rule, pattern))
      ? null
      : grants.length
        ? "mixed"
        : "ask";
  }
  return null;
}

export function browserSettingManaged(
  requirements: ConfigRequirements | null | undefined,
  key: string,
): boolean {
  if (
    [
      "enabled",
      "history_access",
      "webMcpEnabled",
      "fullCdpAccessEnabled",
      "agent_permissions",
    ].includes(key) &&
    requirements?.allowBrowserAndComputerUse === false
  )
    return true;
  return (
    (key === "history_access" &&
      requirements?.browserUse?.allowHistoryAccess === false) ||
    (key === "webMcpEnabled" && requirements?.browserUse?.allowWebmcp === false)
  );
}
