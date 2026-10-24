import type {
  BrowserUseOriginPolicy,
  BrowserUseRequirements,
  ConfigRequirements,
} from "@limecloud/app-server-client";
import {
  BROWSER_POLICY_FIELDS,
  browserSiteMatches,
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
  ) throw invalid();
  const browser = requirements.browserUse;
  if (!present(browser)) return;
  if (!object(browser)) throw invalid();
  for (const field of ["allowWebmcp", "allowHistoryAccess", "disableAutoReview", "allowGlobalPersistentApproval"])
    if (present(browser[field]) && typeof browser[field] !== "boolean") throw invalid();
  const policy = (value: unknown) => {
    if (!object(value)) throw invalid();
    for (const field of ["access", "downloads", "uploads", "fullCdpAccess", "autoReview"])
      if (present(value[field]) && value[field] !== "allow" && value[field] !== "deny") throw invalid();
    if (present(value.persistentApproval) && typeof value.persistentApproval !== "boolean") throw invalid();
    if (present(value.accessApprovalLifetime) && !["turn", "thread"].includes(value.accessApprovalLifetime as string)) throw invalid();
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
    if (present(headers) && (!Array.isArray(headers) || headers.some(header =>
      !object(header) || typeof header.name !== "string" || typeof header.value !== "string"
    ))) throw invalid();
  }
}

/** Reuse the canonical origin evaluator; managed allow never replaces a user choice. */
export function browserRequirementsAdmission(requirements?: ConfigRequirements | null): BrowserUse | null {
  const browser = requirements?.browserUse;
  if (!browser) return null;
  const origin = (policy: BrowserUseOriginPolicy) => Object.fromEntries(
    BROWSER_POLICY_FIELDS.map(field => [field, policy[field === "full_cdp_access" ? "fullCdpAccess" : field]]),
  );
  return {
    default_origin_policy: browser.defaultOriginPolicy ? origin(browser.defaultOriginPolicy) : null,
    origins: browser.origins ? Object.fromEntries(Object.entries(browser.origins).map(([pattern, value]) => [pattern, origin(value)])) : null,
  };
}

export function managedBrowserDecision(requirements: ConfigRequirements | null | undefined, field: BrowserPolicyField, target: URL) {
  if (requirements?.allowBrowserAndComputerUse === false) return "deny";
  return browserUseDecision(browserRequirementsAdmission(requirements), field, target);
}

/** Existing receipts are turn-scoped. A lifetime limit also excludes saved cross-turn grants. */
export function managedBrowserRequiresApproval(requirements: ConfigRequirements | null | undefined, target: URL): boolean {
  const browser = requirements?.browserUse;
  if (!browser) return false;
  const matches = Object.entries(browser.origins ?? {}).filter(([pattern]) => browserSiteMatches(pattern, target)).map(([, policy]) => policy);
  const limited = (policy: BrowserUseOriginPolicy | null | undefined) =>
    policy?.persistentApproval === false || policy?.accessApprovalLifetime != null;
  return browser.allowGlobalPersistentApproval === false || matches.some(limited) ||
    (limited(browser.defaultOriginPolicy) && !matches.some(policy => policy.persistentApproval === true));
}

export type { BrowserUseRequirements };
