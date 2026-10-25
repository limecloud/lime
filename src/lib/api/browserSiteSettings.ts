import { safeInvoke } from "@/lib/dev-bridge";
import {
  assertBrowserSiteSettingsSnapshot,
  parseBrowserSiteOrigin,
  parseBrowserSiteSettingsUpdate,
  type BrowserSiteSettingsSnapshot,
  type BrowserSiteSettingsUpdate,
} from "./browserSiteSettingsTypes";

async function readSnapshot(
  command: string,
  input: Record<string, unknown>,
): Promise<BrowserSiteSettingsSnapshot> {
  const result = await safeInvoke<unknown>(command, input);
  assertBrowserSiteSettingsSnapshot(result);
  return result;
}

export function getBrowserSiteSettings(): Promise<BrowserSiteSettingsSnapshot> {
  return readSnapshot("browser_site_settings_list", {});
}

export function updateBrowserSiteSetting(
  value: BrowserSiteSettingsUpdate,
): Promise<BrowserSiteSettingsSnapshot> {
  const update = parseBrowserSiteSettingsUpdate(value);
  return readSnapshot("browser_site_settings_update", { ...update });
}

export function removeBrowserSiteSettings(origin: string) {
  return readSnapshot("browser_site_settings_remove", {
    origin: parseBrowserSiteOrigin(origin),
  });
}
