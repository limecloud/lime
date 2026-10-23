import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { openIn } from "@/lib/api/openIn";
import { getDefaultProject } from "@/lib/api/project";
import type { OpenInTargets } from "@/lib/api/openInTypes";
import { setPluginEnabled } from "@/lib/api/pluginCatalog";
import type { LocalePreference } from "@/i18n/locales";
import { useGeneralSettings } from "./useGeneralSettings";
import {
  SettingsAction,
  SettingsGroup,
  SettingsPageBody,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
  SettingsLoading,
} from "../SettingsPrimitives";

export function GeneralSettings() {
  const { t } = useTranslation("settings");
  const preferences = useGeneralSettings();
  const [targets, setTargets] = useState<OpenInTargets | null>(null);
  const [operationError, setOperationError] = useState<"load" | "save" | null>(
    null,
  );
  const [pending, setPending] = useState(false);
  const [targetPath, setTargetPath] = useState<string | undefined>();
  const saving = useRef(false);
  const alive = useRef(false);
  const generation = useRef(0);

  async function loadTargets() {
    const revision = ++generation.current;
    try {
      const workspace = await getDefaultProject();
      const path = workspace?.rootPath || undefined;
      const value = await openIn.getTargets({ path, deferEnrichment: true });
      if (alive.current && revision === generation.current) {
        setTargets(value);
        setTargetPath(path);
        setOperationError(null);
      }
    } catch {
      if (alive.current && revision === generation.current)
        setOperationError("load");
    }
  }

  useEffect(() => {
    alive.current = true;
    void loadTargets();
    return () => {
      alive.current = false;
      generation.current += 1;
    };
  }, []);

  async function mutate(operation: () => Promise<unknown>) {
    if (saving.current) return;
    saving.current = true;
    setPending(true);
    setOperationError(null);
    try {
      await operation();
    } catch {
      if (alive.current) setOperationError("save");
    } finally {
      saving.current = false;
      if (alive.current) setPending(false);
    }
  }

  if (preferences.loading) return <SettingsLoading />;

  return (
    <SettingsPageBody aria-busy={pending}>
      <SettingsPageHeader title={t("settings.desktop.general")} />
      {preferences.error || operationError ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-4 text-sm text-destructive"
        >
          {preferences.error ??
            t(
              operationError === "load"
                ? "settings.desktop.loadError"
                : "settings.desktop.saveError",
            )}
          <SettingsAction
            type="button"
            disabled={pending}
            onClick={() => {
              void preferences.loadConfig();
              void loadTargets();
            }}
          >
            {t("settings.browser.retry")}
          </SettingsAction>
        </div>
      ) : null}
      <SettingsSection title={t("settings.desktop.general")}>
        <SettingsGroup>
          <SettingsRow
            label={t("settings.desktop.defaultFileTarget")}
            description={t("settings.desktop.defaultFileTargetDescription")}
            targetId="general-file-target"
          >
            <SettingsSelect
              aria-label={t("settings.desktop.defaultFileTarget")}
              value={targets?.preferredTarget ?? "systemDefault"}
              disabled={
                pending ||
                !targets ||
                !targets.targets.some((target) => target.available)
              }
              onChange={(event) => {
                const target = targets?.targets.find(
                  (item) => item.id === event.target.value && item.available,
                );
                if (!target) return;
                void mutate(async () => {
                  await openIn.setGlobalPreferredTarget({
                    target: target.target,
                    appPath: target.appPath,
                    path: targetPath,
                  });
                  await loadTargets();
                });
              }}
            >
              <option value="" disabled>
                {t(
                  targets?.discovery === "ready"
                    ? "settings.desktop.systemDefault"
                    : "settings.desktop.unavailable",
                )}
              </option>
              {targets?.targets
                .filter((target) => target.available)
                .map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.kind === "builtin" &&
                    target.target === "systemDefault"
                      ? t("settings.desktop.systemDefault")
                      : target.label}
                  </option>
                ))}
            </SettingsSelect>
          </SettingsRow>
          <SettingsRow
            label={t("settings.desktop.language")}
            description={t("settings.desktop.languageDescription")}
            targetId="general-language"
          >
            <SettingsSelect
              aria-label={t("settings.desktop.language")}
              value={preferences.language}
              disabled={pending || !preferences.config}
              onChange={(event) =>
                void mutate(() =>
                  preferences.handleLanguageChange(
                    event.target.value as LocalePreference,
                  ),
                )
              }
            >
              {preferences.languageOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </SettingsSelect>
          </SettingsRow>
          <SettingsRow
            label={t("settings.desktop.plugins")}
            description={t("settings.desktop.pluginsDescription")}
            targetId="general-plugins"
          >
            <SettingsSwitch
              aria-label={t("settings.desktop.plugins")}
              disabled={pending || !preferences.config}
              checked={
                preferences.loadedConfig?.plugins?._default?.enabled !== false
              }
              onCheckedChange={(enabled) =>
                void mutate(async () => {
                  await setPluginEnabled({ pluginId: "_default", enabled });
                  await preferences.loadConfig();
                })
              }
            />
          </SettingsRow>
        </SettingsGroup>
      </SettingsSection>
    </SettingsPageBody>
  );
}
