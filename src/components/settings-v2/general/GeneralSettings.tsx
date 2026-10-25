import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { getDefaultProject } from "@/lib/api/project";
import {
  openInQueryClient,
  openInTargetsQueryOptions,
  setGlobalPreferredTarget,
} from "@/lib/openInTargets";
import { setPluginEnabled } from "@/lib/api/pluginCatalog";
import { useGeneralSettings } from "./useGeneralSettings";
import { LanguagePicker } from "./LanguagePicker";
import { resolveHotkeyPlatform } from "@/lib/hotkeys/platform";
import {
  SettingsAction,
  SettingsGroup,
  SettingsPageBody,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
  SettingsLoading,
  SettingsValueMenu,
} from "../SettingsPrimitives";

export function GeneralSettings() {
  const { t } = useTranslation("settings");
  const preferences = useGeneralSettings();
  const platform = resolveHotkeyPlatform(navigator);
  const modifierSymbol = platform === "mac" ? "⌘" : "Ctrl";
  const [targetContext, setTargetContext] = useState<{
    path: string | undefined;
  } | null>(null);
  const targetQuery = useQuery(
    {
      ...openInTargetsQueryOptions({ path: targetContext?.path }),
      enabled: targetContext !== null,
    },
    openInQueryClient,
  );
  const targets = targetQuery.data;
  const availableTargets =
    targets?.targets.filter((target) => target.available) ?? [];
  const preferredTarget =
    availableTargets.find((target) => target.id === targets?.preferredTarget)
      ?.id ??
    availableTargets.find((target) => target.id === "systemDefault")?.id ??
    "";
  const [operationError, setOperationError] = useState<"load" | "save" | null>(
    null,
  );
  const [pending, setPending] = useState(false);
  const saving = useRef(false);
  const alive = useRef(false);
  const generation = useRef(0);

  async function loadTargets() {
    const revision = ++generation.current;
    try {
      const workspace = await getDefaultProject();
      const path = workspace?.rootPath || undefined;
      if (alive.current && revision === generation.current) {
        setTargetContext({ path });
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
      {preferences.error || operationError || targetQuery.isError ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-4 text-sm text-destructive"
        >
          {preferences.error ??
            t(
              operationError === "load" || targetQuery.isError
                ? "settings.desktop.loadError"
                : "settings.desktop.saveError",
            )}
          <SettingsAction
            type="button"
            disabled={pending}
            onClick={() => {
              void preferences.loadConfig();
              if (targetContext) void targetQuery.refetch();
              else void loadTargets();
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
            <SettingsValueMenu
              targetId="general-file-target"
              described
              value={preferredTarget}
              placeholder={t("settings.desktop.noFileTargets")}
              disabled={pending || availableTargets.length === 0}
              options={availableTargets.map((target) => ({
                value: target.id,
                label: (
                  <span className="flex min-w-0 items-center gap-1.5">
                    {target.icon ? (
                      <img
                        src={target.icon}
                        alt=""
                        className="size-4 shrink-0 object-contain"
                      />
                    ) : null}
                    <span className="truncate">
                      {target.kind === "builtin" &&
                      target.target === "systemDefault"
                        ? t("settings.desktop.systemDefault")
                        : target.label}
                    </span>
                  </span>
                ),
              }))}
              onChange={(value) => {
                const target = availableTargets.find(
                  (item) => item.id === value,
                );
                if (!target) return;
                void mutate(() =>
                  setGlobalPreferredTarget({
                    target: target.target,
                    appPath: target.appPath,
                    path: targetContext?.path,
                  }),
                );
              }}
            />
          </SettingsRow>
          <SettingsRow
            label={t("settings.desktop.language")}
            description={t("settings.desktop.languageDescription")}
            targetId="general-language"
          >
            <LanguagePicker
              value={preferences.language}
              disabled={pending || !preferences.config}
              onChange={(language) =>
                void mutate(() => preferences.handleLanguageChange(language))
              }
            />
          </SettingsRow>
          <SettingsRow
            label={t("settings.general.confirmBeforeClose.label")}
            description={t(
              `settings.general.confirmBeforeClose.${preferences.confirmBeforeClose === "keyboardOnly" ? "shortcutDescription" : "description"}`,
            )}
            targetId="general-confirm-before-close"
          >
            <SettingsValueMenu
              targetId="general-confirm-before-close"
              described
              value={preferences.confirmBeforeClose}
              disabled={pending || !preferences.config}
              options={(["never", "keyboardOnly", "always"] as const).map(
                (value) => ({
                  value,
                  label: t(`settings.general.confirmBeforeClose.${value}`),
                }),
              )}
              onChange={(value) =>
                void mutate(() =>
                  preferences.handleConfirmBeforeCloseChange(value),
                )
              }
            />
          </SettingsRow>
          {platform === "mac" ? (
            <SettingsRow
              label={t("settings.desktop.macMenuBar")}
              description={t("settings.desktop.macMenuBarDescription")}
              targetId="general-menu-bar"
            >
              <SettingsSwitch
                aria-labelledby="general-menu-bar-label"
                aria-describedby="general-menu-bar-description"
                checked={preferences.macMenuBarEnabled}
                disabled={pending || !preferences.config}
                onCheckedChange={(enabled) =>
                  void mutate(() =>
                    preferences.handleMacMenuBarEnabledChange(enabled),
                  )
                }
              />
            </SettingsRow>
          ) : null}
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
          {platform !== "windows" ? (
            <SettingsRow
              label={t("settings.desktop.preventSleepWhileRunning")}
              description={t(
                "settings.desktop.preventSleepWhileRunningDescription",
              )}
              targetId="general-prevent-sleep"
            >
              <SettingsSwitch
                aria-labelledby="general-prevent-sleep-label"
                aria-describedby="general-prevent-sleep-description"
                checked={preferences.preventSleepWhileRunning}
                disabled={pending || !preferences.config}
                onCheckedChange={(enabled) =>
                  void mutate(() =>
                    preferences.handlePreventSleepWhileRunningChange(enabled),
                  )
                }
              />
            </SettingsRow>
          ) : null}
        </SettingsGroup>
      </SettingsSection>
      <SettingsSection title={t("settings.desktop.composer")}>
        <SettingsGroup>
          <SettingsRow
            label={t("settings.desktop.enterBehavior")}
            description={t("settings.desktop.enterBehaviorDescription")}
            targetId="general-enter-behavior"
          >
            <SettingsValueMenu
              targetId="general-enter-behavior"
              described
              value={preferences.enterBehavior}
              disabled={pending || !preferences.config}
              options={(["enter", "cmdIfMultiline", "cmdAlways"] as const).map(
                (value) => ({
                  value,
                  label: t(`settings.desktop.${value}`, { modifierSymbol }),
                }),
              )}
              onChange={(value) =>
                void mutate(() => preferences.handleEnterBehaviorChange(value))
              }
            />
          </SettingsRow>
        </SettingsGroup>
      </SettingsSection>
    </SettingsPageBody>
  );
}
