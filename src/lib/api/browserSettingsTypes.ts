import {
  browserPreferences,
  effectiveBrowserPreferences,
  type BrowserPreferences,
  type BrowserHistoryAccess,
} from "./browserPreferences";
import {
  browserAgentPermissions,
  type BrowserAgentPermissions,
} from "./browserOriginState";
import { validateBrowserUse, type BrowserUse } from "./browserUseConfig";
import type { ConfigRequirements } from "@limecloud/app-server-client";
import { assertBrowserRequirements } from "./browserUseRequirements";
export * from "./browserPreferences";
export * from "./browserOriginState";
export * from "./browserUseConfig";

export interface BrowserSettings extends BrowserPreferences {
  /** Read-only administrator authority, never serialized under config.browser. */
  requirements: ConfigRequirements | null;
  browser_use: BrowserUse | null;
  /** UI-only projections; never persist these under config.browser. */
  history_access: BrowserHistoryAccess;
  agent_permissions: BrowserAgentPermissions;
}

export function effectiveBrowserSettings(
  value?: Partial<BrowserPreferences>,
  browserUse?: unknown,
  requirements: ConfigRequirements | null = null,
): BrowserSettings {
  assertBrowserRequirements(requirements);
  const prefs = effectiveBrowserPreferences(value);
  const policy = validateBrowserUse(browserUse);
  return {
    ...prefs,
    requirements,
    browser_use: policy,
    history_access:
      policy?.allow_history_access === false || requirements?.browserUse?.allowHistoryAccess === false
        ? "disabled"
        : prefs.iabHistoryApprovalMode,
    agent_permissions: browserAgentPermissions(prefs, policy),
  };
}

export function browserSettingsFromConfig(config: {
  browser?: Partial<BrowserPreferences>;
  browser_use?: unknown;
}, requirements: ConfigRequirements | null = null): BrowserSettings {
  return effectiveBrowserSettings(config.browser, config.browser_use, requirements);
}

export function validateBrowserSettings(
  settings: BrowserSettings,
): BrowserSettings {
  return effectiveBrowserSettings(
    browserPreferences(settings),
    settings.browser_use,
    settings.requirements,
  );
}
export const DEFAULT_BROWSER_SETTINGS: Readonly<BrowserSettings> =
  Object.freeze(effectiveBrowserSettings());
