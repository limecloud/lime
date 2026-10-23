import { getConfig, updateConfig } from "./appConfig";
import { AppServerRpcError } from "./appServerResponse";
import {
  effectiveBrowserSettings,
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
  return effectiveBrowserSettings((await getConfig(options)).browser);
}

export async function updateBrowserSetting<K extends keyof BrowserSettings>(
  key: K,
  value: BrowserSettings[K],
  expectedValue: BrowserSettings[K],
): Promise<BrowserSettings> {
  const next = effectiveBrowserSettings({ [key]: value })[key];
  const expected = effectiveBrowserSettings({ [key]: expectedValue })[key];
  try {
    const config = await updateConfig((current) => {
      const browser = effectiveBrowserSettings(current.browser);
      // 在配置队列内部比较界面旧值，避免新版本 cache 接受过期权限矩阵。
      if (JSON.stringify(browser[key]) !== JSON.stringify(expected))
        throw new BrowserSettingsConflictError();
      return { ...current, browser: { ...browser, [key]: next } };
    });
    return effectiveBrowserSettings(config.browser);
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
