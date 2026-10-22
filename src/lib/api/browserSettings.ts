import { getConfig, updateConfig } from "./appConfig";
import {
  effectiveBrowserSettings,
  type BrowserSettings,
} from "./browserSettingsTypes";
export * from "./browserSettingsTypes";

export async function getBrowserSettings(options?: {
  forceRefresh?: boolean;
}): Promise<BrowserSettings> {
  return effectiveBrowserSettings((await getConfig(options)).browser);
}

export async function updateBrowserSetting<K extends keyof BrowserSettings>(
  key: K,
  value: BrowserSettings[K],
): Promise<BrowserSettings> {
  const config = await updateConfig((current) => ({
    ...current,
    browser: effectiveBrowserSettings({ ...current.browser, [key]: value }),
  }));
  return effectiveBrowserSettings(config.browser);
}
