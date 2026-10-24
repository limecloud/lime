import { getConfig, getConfigSnapshot, updateConfig } from "./appConfig";
import type { BrowserPermissionContext } from "./browserUsePolicySitePermissions";
import { AppServerRpcError } from "./appServerResponse";
import { getConfigRequirements } from "./configRequirements";
import {
  browserSettingsFromConfig,
  browserPreferences,
  effectiveBrowserSettings,
  normalizeBrowserAgentPermissions,
  applyBrowserAgentPermissions,
  type BrowserSettings,
} from "./browserSettingsTypes";
export * from "./browserSettingsTypes";

export class BrowserSettingsConflictError extends Error {
  constructor() {
    super("Browser settings changed since they were displayed");
    this.name = "BrowserSettingsConflictError";
  }
}

export async function getBrowserSettings(options?: {
  forceRefresh?: boolean;
}): Promise<BrowserSettings> {
  const [config, requirements] = await Promise.all([
    getConfig(options),
    getConfigRequirements(),
  ]);
  return browserSettingsFromConfig(config, requirements);
}

export async function getBrowserSettingsSnapshot(): Promise<{
  settings: BrowserSettings;
  permissionContext: BrowserPermissionContext;
}> {
  const [snapshot, requirements] = await Promise.all([
    getConfigSnapshot(),
    getConfigRequirements(),
  ]);
  const userConfig = snapshot.layer.config;
  if (
    !userConfig ||
    typeof userConfig !== "object" ||
    Array.isArray(userConfig)
  )
    throw new Error("config/read returned an invalid browser user layer");
  return {
    settings: browserSettingsFromConfig(snapshot.config, requirements),
    permissionContext: {
      origins: snapshot.origins,
      userPermissions: browserSettingsFromConfig(userConfig).agent_permissions,
    },
  };
}

export async function updateBrowserSetting<K extends keyof BrowserSettings>(
  key: K,
  value: BrowserSettings[K],
  expectedValue: BrowserSettings[K],
): Promise<BrowserSettings> {
  const normalize = (input: BrowserSettings[K]): BrowserSettings[K] => {
    if (key === "agent_permissions")
      return normalizeBrowserAgentPermissions(
        input as BrowserSettings["agent_permissions"],
      ) as BrowserSettings[K];
    if (key === "history_access") {
      if (!["alwaysAsk", "neverAsk", "disabled"].includes(input as string))
        throw new Error("Invalid history approval mode");
      return input;
    }
    if (key === "requirements")
      throw new Error("Browser requirements are read-only");
    if (key === "browser_use")
      throw new Error(
        "Edit browser_use through the browser permission settings",
      );
    return effectiveBrowserSettings({ [key]: input })[key];
  };
  const next = normalize(value);
  const expected = normalize(expectedValue);
  try {
    const config = await updateConfig((current) => {
      const browser = browserSettingsFromConfig(current);
      // 在配置队列内部比较界面旧值，避免新版本 cache 接受过期权限矩阵。
      if (JSON.stringify(browser[key]) !== JSON.stringify(expected))
        throw new BrowserSettingsConflictError();
      const prefs = browserPreferences(browser);
      if (key === "agent_permissions") {
        return {
          ...current,
          ...applyBrowserAgentPermissions(
            prefs,
            browser.browser_use,
            browser.agent_permissions,
            next as BrowserSettings["agent_permissions"],
          ),
        };
      }
      if (key === "history_access") {
        const mode = next as BrowserSettings["history_access"];
        return {
          ...current,
          browser: {
            ...prefs,
            ...(mode === "disabled" ? {} : { iabHistoryApprovalMode: mode }),
          },
          browser_use: {
            ...browser.browser_use,
            allow_history_access: mode !== "disabled",
          },
        };
      }
      return { ...current, browser: { ...prefs, [key]: next } };
    });
    return browserSettingsFromConfig(config);
  } catch (error) {
    if (
      error instanceof AppServerRpcError &&
      error.data &&
      typeof error.data === "object" &&
      "config_write_error_code" in error.data &&
      error.data.config_write_error_code === "configVersionConflict"
    )
      throw new BrowserSettingsConflictError();
    throw error;
  }
}
