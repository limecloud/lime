import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  getConfig,
  subscribeAppConfigChanged,
  updateConfig,
  type Config,
} from "@/lib/api/appConfig";
import { changeLimeLocale } from "@/i18n/createI18n";
import { useI18nPatch } from "@/i18n/legacy-patch/I18nPatchProvider";
import {
  UI_LOCALE_OPTIONS,
  normalizeLocalePreference,
  toLegacyPatchLanguage,
  type LocalePreference,
} from "@/i18n/locales";

export function useGeneralSettings() {
  const { t } = useTranslation("settings");
  const { setLanguage } = useI18nPatch();
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(false);
  const revision = useRef(0);
  const saving = useRef(false);

  const loadConfig = useCallback(async () => {
    const request = ++revision.current;
    try {
      const value = await getConfig({ forceRefresh: true });
      if (alive.current && revision.current === request) {
        setConfig(value);
        setError(null);
      }
    } catch {
      if (alive.current && revision.current === request)
        setError(t("settings.desktop.loadError"));
    } finally {
      if (alive.current && revision.current === request) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    alive.current = true;
    void loadConfig();
    const unsubscribe = subscribeAppConfigChanged(() => {
      if (!saving.current) void loadConfig();
    });
    return () => {
      alive.current = false;
      revision.current += 1;
      unsubscribe();
    };
  }, [loadConfig]);

  const handleLanguageChange = async (language: LocalePreference) => {
    if (!config || saving.current) return;
    saving.current = true;
    ++revision.current;
    try {
      const saved = await updateConfig((current) => ({ ...current, language }));
      const locale = normalizeLocalePreference(saved.language);
      await changeLimeLocale(locale);
      setLanguage(toLegacyPatchLanguage(locale));
      if (alive.current) {
        setConfig(saved);
        setError(null);
      }
    } catch {
      await loadConfig();
      if (alive.current) setError(t("settings.desktop.saveError"));
    } finally {
      saving.current = false;
    }
  };

  return {
    loading,
    config: Boolean(config),
    loadedConfig: config,
    error,
    loadConfig,
    language: normalizeLocalePreference(config?.language),
    languageOptions: UI_LOCALE_OPTIONS,
    handleLanguageChange,
  };
}
