/**
 * @file useAppearanceSettings.ts
 * @description 外观模式与主题偏好
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  LIME_COLOR_SCHEME_CHANGED_EVENT,
  LIME_COLOR_SCHEMES,
  LIME_COLOR_SCHEME_STORAGE_KEY,
  applyLimeColorScheme,
  loadLimeColorSchemeId,
  persistLimeColorScheme,
  type LimeColorSchemeChangedEventDetail,
  type LimeColorSchemeId,
} from "@/lib/appearance/colorSchemes";
import {
  LIME_THEME_CHANGED_EVENT,
  LIME_THEME_MODE_OPTIONS,
  LIME_THEME_STORAGE_KEY,
  applyLimeThemeMode,
  loadLimeThemeMode,
  persistLimeThemeMode,
  type LimeThemeChangedEventDetail,
  type LimeThemeMode,
} from "@/lib/appearance/themeMode";

import { type ThemeOption } from "./AppearanceSettingsView";

const THEME_OPTION_ICONS: Record<LimeThemeMode, LucideIcon> = {
  dark: Moon,
  light: Sun,
  system: Monitor,
};

export function useAppearanceSettings() {
  const { t } = useTranslation("settings");
  const [theme, setTheme] = useState<LimeThemeMode>(() => loadLimeThemeMode());
  const [colorSchemeId, setColorSchemeId] = useState<LimeColorSchemeId>(() =>
    loadLimeColorSchemeId(),
  );

  useEffect(() => {
    const refreshAppearance = () => {
      const nextTheme = loadLimeThemeMode();
      const nextColorSchemeId = loadLimeColorSchemeId();
      setTheme(nextTheme);
      setColorSchemeId(nextColorSchemeId);
      applyLimeThemeMode(nextTheme);
      applyLimeColorScheme(nextColorSchemeId);
    };

    const handleThemeChanged = (event: Event) => {
      const detail = (event as CustomEvent<LimeThemeChangedEventDetail>).detail;
      setTheme(detail?.themeMode ?? loadLimeThemeMode());
    };

    const handleColorSchemeChanged = (event: Event) => {
      const detail = (event as CustomEvent<LimeColorSchemeChangedEventDetail>)
        .detail;
      setColorSchemeId(detail?.colorSchemeId ?? loadLimeColorSchemeId());
    };

    const handleStorageChanged = (event: StorageEvent) => {
      if (
        event.key === LIME_THEME_STORAGE_KEY ||
        event.key === LIME_COLOR_SCHEME_STORAGE_KEY
      ) {
        refreshAppearance();
      }
    };

    refreshAppearance();

    window.addEventListener(LIME_THEME_CHANGED_EVENT, handleThemeChanged);
    window.addEventListener(
      LIME_COLOR_SCHEME_CHANGED_EVENT,
      handleColorSchemeChanged,
    );
    window.addEventListener("storage", handleStorageChanged);

    return () => {
      window.removeEventListener(LIME_THEME_CHANGED_EVENT, handleThemeChanged);
      window.removeEventListener(
        LIME_COLOR_SCHEME_CHANGED_EVENT,
        handleColorSchemeChanged,
      );
      window.removeEventListener("storage", handleStorageChanged);
    };
  }, []);

  const themeOptions = useMemo<ThemeOption[]>(
    () =>
      ["system", "light", "dark"]
        .map(
          (mode) =>
            LIME_THEME_MODE_OPTIONS.find((option) => option.id === mode)!,
        )
        .map((option) => ({
          id: option.id,
          icon: THEME_OPTION_ICONS[option.id],
          label: t(
            `settings.appearance.theme.options.${option.id}.label`,
            option.label,
          ),
          description: t(
            `settings.appearance.theme.options.${option.id}.description`,
            option.description,
          ),
        })),
    [t],
  );

  const colorSchemeOptions = useMemo(
    () =>
      LIME_COLOR_SCHEMES.map((option) => ({
        ...option,
        label: t(
          `settings.appearance.colorScheme.options.${option.id}.label`,
          option.label,
        ),
        description: t(
          `settings.appearance.colorScheme.options.${option.id}.description`,
          option.description,
        ),
      })),
    [t],
  );

  const handleThemeChange = useCallback((nextTheme: LimeThemeMode) => {
    const resolvedTheme = persistLimeThemeMode(nextTheme);
    setTheme(resolvedTheme);
  }, []);

  const handleColorSchemeChange = useCallback(
    (nextColorSchemeId: LimeColorSchemeId) => {
      const resolvedId = persistLimeColorScheme(nextColorSchemeId);
      setColorSchemeId(resolvedId);
    },
    [],
  );

  const handleRandomColorScheme = useCallback(() => {
    const candidates = LIME_COLOR_SCHEMES.filter(
      (scheme) => scheme.id !== colorSchemeId,
    );
    const nextScheme =
      candidates[Math.floor(Math.random() * candidates.length)] ??
      LIME_COLOR_SCHEMES[0];
    handleColorSchemeChange(nextScheme.id);
  }, [colorSchemeId, handleColorSchemeChange]);

  return {
    theme,
    colorSchemeId,
    themeOptions,
    colorSchemeOptions,
    handleThemeChange,
    handleColorSchemeChange,
    handleRandomColorScheme,
  };
}
