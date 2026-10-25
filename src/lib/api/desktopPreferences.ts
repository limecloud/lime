import { getConfig, updateConfig } from "./appConfig";
import type { DesktopConfig } from "./appConfigTypes";

export const DEFAULT_DESKTOP_PREFERENCES = {
  composerEnterBehavior: "enter",
  "open-link-in-target-preference": "external-browser",
  "open-local-url-in-target-preference": "in-app-browser",
  "external-browser-link-shortcut": "primary",
} as const satisfies Required<
  Pick<
    DesktopConfig,
    | "composerEnterBehavior"
    | "open-link-in-target-preference"
    | "open-local-url-in-target-preference"
    | "external-browser-link-shortcut"
  >
>;

export function effectiveDesktopPreferences(config?: DesktopConfig) {
  return {
    composerEnterBehavior:
      config?.composerEnterBehavior ??
      DEFAULT_DESKTOP_PREFERENCES.composerEnterBehavior,
    "open-link-in-target-preference":
      config?.["open-link-in-target-preference"] ??
      DEFAULT_DESKTOP_PREFERENCES["open-link-in-target-preference"],
    "open-local-url-in-target-preference":
      config?.["open-local-url-in-target-preference"] ??
      DEFAULT_DESKTOP_PREFERENCES["open-local-url-in-target-preference"],
    "external-browser-link-shortcut":
      config?.["external-browser-link-shortcut"] ??
      DEFAULT_DESKTOP_PREFERENCES["external-browser-link-shortcut"],
  };
}

export async function getDesktopPreferences(options?: {
  forceRefresh?: boolean;
}): Promise<DesktopConfig> {
  return (await getConfig(options)).desktop ?? {};
}

export async function updateDesktopPreference<K extends keyof DesktopConfig>(
  key: K,
  value: NonNullable<DesktopConfig[K]>,
): Promise<DesktopConfig> {
  const config = await updateConfig((current) => ({
    ...current,
    desktop: { ...current.desktop, [key]: value },
  }));
  return config.desktop ?? {};
}
