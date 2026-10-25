import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  LIME_THEME_CHANGED_EVENT,
  LIME_THEME_STORAGE_KEY,
  applyLimeThemeMode,
  loadLimeThemeMode,
  persistLimeThemeMode,
  type LimeThemeChangedEventDetail,
  type LimeThemeMode,
} from "@/lib/appearance/themeMode";

export function useAppearanceSettings() {
  const { t } = useTranslation("settings");
  const [theme, setTheme] = useState<LimeThemeMode>(() => loadLimeThemeMode());

  useEffect(() => {
    const refresh = () => {
      const mode = loadLimeThemeMode();
      applyLimeThemeMode(mode);
      setTheme(mode);
    };
    const onThemeChanged = (event: Event) => {
      const detail = (event as CustomEvent<LimeThemeChangedEventDetail>).detail;
      setTheme(detail?.themeMode ?? loadLimeThemeMode());
    };
    const onStorageChanged = (event: StorageEvent) => {
      if (event.key === null || event.key === LIME_THEME_STORAGE_KEY) refresh();
    };
    refresh();
    window.addEventListener(LIME_THEME_CHANGED_EVENT, onThemeChanged);
    window.addEventListener("storage", onStorageChanged);
    return () => {
      window.removeEventListener(LIME_THEME_CHANGED_EVENT, onThemeChanged);
      window.removeEventListener("storage", onStorageChanged);
    };
  }, []);

  const themeOptions = useMemo(
    () =>
      (["system", "light", "dark"] as const).map((id) => ({
        id,
        label: t(`settings.appearance.theme.options.${id}.label`),
      })),
    [t],
  );
  const handleThemeChange = useCallback((mode: LimeThemeMode) => {
    setTheme(persistLimeThemeMode(mode));
  }, []);

  return { theme, themeOptions, handleThemeChange };
}
