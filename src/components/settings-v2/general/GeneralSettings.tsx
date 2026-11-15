import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { getDefaultProject } from "@/lib/api/project";
import {
  getConfigSnapshot,
  writeReasoningEffortPreferences,
} from "@/lib/api/appConfig";
import { isConfigFieldManaged } from "@/lib/api/configLayers";
import {
  openInQueryClient,
  openInTargetsQueryOptions,
  setGlobalPreferredTarget,
} from "@/lib/openInTargets";
import { setPluginEnabled } from "@/lib/api/pluginCatalog";
import { useGeneralSettings } from "./useGeneralSettings";
import {
  getComposerPermissionVisibility,
  setComposerPermissionVisibility,
} from "@/lib/composerPermissionVisibility";
import {
  setAutoArchivePreference,
  useAutoArchivePreference,
} from "@/lib/autoArchivePreference";
import {
  setComposerEditorPreferences,
  useComposerEditorPreferences,
} from "@/lib/composerEditorPreferences";
import { pickFilesFromDialog } from "@/lib/api/filePicker";
import {
  setProjectlessWorkspaceRoot,
  useProjectlessWorkspaceRoot,
} from "@/lib/projectlessWorkspacePreference";
import {
  setTerminalPanelPreferences,
  useTerminalPanelPreferences,
} from "@/lib/terminalPanelPreferences";
import { SourceLicensesDialog } from "./SourceLicensesDialog";
import { ReasoningEffortsRow } from "./ReasoningEffortsRow";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LanguagePicker } from "./LanguagePicker";
import { resolveHotkeyPlatform } from "@/lib/hotkeys/platform";
import {
  isWorkspaceFullViewDefaultEnabled,
  setWorkspaceFullViewDefaultEnabled,
} from "@/lib/workspaceFullView";
import { Button } from "@/components/ui/button";
import {
  SettingsAction,
  SettingsGroup,
  SettingsPageBody,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
  SettingsSegmentedControl,
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
  const [defaultFullView, setDefaultFullView] = useState(
    isWorkspaceFullViewDefaultEnabled,
  );
  const [projectlessFolder, setProjectlessFolder] = useState<string | null>(
    null,
  );
  const [permissionVisibility, setPermissionVisibility] = useState(
    getComposerPermissionVisibility,
  );
  const [confirmFullAccess, setConfirmFullAccess] = useState(false);
  const [licensesOpen, setLicensesOpen] = useState(false);
  const [reasoningLock, setReasoningLock] = useState<string | null>(null);
  const preferredProjectlessRoot = useProjectlessWorkspaceRoot();
  const terminalPreferences = useTerminalPanelPreferences();
  const [choosingFolder, setChoosingFolder] = useState(false);
  const autoArchive = useAutoArchivePreference();
  const editorPreferences = useComposerEditorPreferences();
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
    let active = true;
    void getConfigSnapshot()
      .then((snapshot) => {
        if (!active) return;
        const file = snapshot?.layer?.name?.file;
        if (file) {
          const normalized = file.replaceAll("\\", "/");
          const folder = normalized.slice(0, normalized.lastIndexOf("/"));
          if (folder) setProjectlessFolder(folder);
        }
        if (
          isConfigFieldManaged(
            snapshot?.origins ?? {},
            "desktop.enabled-reasoning-efforts",
          )
        ) {
          setReasoningLock(t("settings.configuration.managedByAdmin"));
        } else if (snapshot?.layer?.disabledReason) {
          setReasoningLock(t("settings.configuration.readonly"));
        } else {
          setReasoningLock(null);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [t]);

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
      <SettingsSection title={t("settings.permissions.title")}>
        <SettingsGroup>
          <SettingsRow
            label={t("settings.desktop.defaultPermission")}
            description={t("settings.desktop.defaultPermissionDescription")}
            targetId="general-default-permission"
          >
            <SettingsSwitch
              aria-labelledby="general-default-permission-label"
              aria-describedby="general-default-permission-description"
              checked={permissionVisibility.defaultPermission}
              onCheckedChange={(enabled) => {
                setComposerPermissionVisibility({
                  defaultPermission: enabled,
                });
                setPermissionVisibility(getComposerPermissionVisibility());
              }}
            />
          </SettingsRow>
          <SettingsRow
            label={t("settings.desktop.fullAccessPermission")}
            description={t("settings.desktop.fullAccessPermissionDescription")}
            targetId="general-full-access-permission"
          >
            <SettingsSwitch
              aria-labelledby="general-full-access-permission-label"
              aria-describedby="general-full-access-permission-description"
              checked={permissionVisibility.fullAccess}
              onCheckedChange={(enabled) => {
                if (enabled) {
                  setConfirmFullAccess(true);
                  return;
                }
                setComposerPermissionVisibility({ fullAccess: false });
                setPermissionVisibility(getComposerPermissionVisibility());
              }}
            />
          </SettingsRow>
        </SettingsGroup>
      </SettingsSection>
      <SettingsSection title={t("settings.desktop.general")}>
        <SettingsGroup>
          <SettingsRow
            label={t("settings.desktop.projectlessFolder")}
            description={t("settings.desktop.projectlessFolderDescription")}
            targetId="general-projectless-folder"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="max-w-[260px] truncate text-[12px] text-muted-foreground"
                data-testid="general-projectless-folder-value"
                title={
                  preferredProjectlessRoot ?? projectlessFolder ?? undefined
                }
              >
                {preferredProjectlessRoot ?? projectlessFolder ?? "—"}
              </span>
              <SettingsAction
                type="button"
                disabled={choosingFolder}
                onClick={async () => {
                  setChoosingFolder(true);
                  try {
                    const [selected] = await pickFilesFromDialog({
                      kind: "directory",
                      allowMultiple: false,
                      title: t("settings.desktop.changeFolder"),
                    });
                    if (selected) {
                      setProjectlessWorkspaceRoot(selected.fsPath);
                      setProjectlessFolder(selected.fsPath);
                    }
                  } finally {
                    setChoosingFolder(false);
                  }
                }}
              >
                {t("settings.desktop.changeFolder")}
              </SettingsAction>
            </div>
          </SettingsRow>
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
          <SettingsRow
            label={t("settings.desktop.defaultFullView")}
            description={t("settings.desktop.defaultFullViewDescription")}
            targetId="general-default-full-view"
          >
            <SettingsSwitch
              aria-labelledby="general-default-full-view-label"
              aria-describedby="general-default-full-view-description"
              checked={defaultFullView}
              onCheckedChange={(enabled) => {
                setDefaultFullView(enabled);
                setWorkspaceFullViewDefaultEnabled(enabled);
              }}
            />
          </SettingsRow>
          <SettingsRow
            label={t("settings.desktop.bottomPanelControl")}
            description={t("settings.desktop.bottomPanelControlDescription")}
            targetId="general-bottom-panel-control"
          >
            <SettingsSwitch
              aria-labelledby="general-bottom-panel-control-label"
              aria-describedby="general-bottom-panel-control-description"
              checked={terminalPreferences.showControl}
              onCheckedChange={(showControl) =>
                setTerminalPanelPreferences({ showControl })
              }
            />
          </SettingsRow>
          <SettingsRow
            label={t("settings.desktop.terminalLocation")}
            description={t("settings.desktop.terminalLocationDescription")}
            targetId="general-terminal-location"
          >
            <SettingsSegmentedControl
              targetId="general-terminal-location"
              described
              value={terminalPreferences.location}
              disabled={false}
              options={[
                {
                  value: "bottom",
                  label: t("settings.desktop.terminalBottom"),
                },
                { value: "right", label: t("settings.desktop.terminalRight") },
              ]}
              onChange={(location) => setTerminalPanelPreferences({ location })}
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
          <SettingsRow
            label={t("settings.desktop.autoArchive")}
            description={t("settings.desktop.autoArchiveDescription")}
            targetId="general-auto-archive"
          >
            <SettingsValueMenu
              targetId="general-auto-archive"
              described
              value={String(autoArchive.days)}
              disabled={false}
              options={[
                { value: "0", label: t("settings.desktop.autoArchiveNever") },
                {
                  value: "7",
                  label: t("settings.desktop.autoArchiveDays", { count: 7 }),
                },
                {
                  value: "30",
                  label: t("settings.desktop.autoArchiveDays", { count: 30 }),
                },
                {
                  value: "90",
                  label: t("settings.desktop.autoArchiveDays", { count: 90 }),
                },
              ]}
              onChange={(value) =>
                setAutoArchivePreference({
                  days: Number(value) as 0 | 7 | 30 | 90,
                  lastRunAt: null,
                })
              }
            />
          </SettingsRow>
          <SettingsRow
            label={t("settings.desktop.compressHistory")}
            description={t("settings.desktop.compressHistoryDescription")}
            targetId="general-compress-history"
          >
            <SettingsSwitch
              aria-labelledby="general-compress-history-label"
              aria-describedby="general-compress-history-description"
              checked={preferences.localThreadStoreCompression}
              disabled={pending || !preferences.config}
              onCheckedChange={(enabled) =>
                void mutate(() =>
                  preferences.handleLocalThreadStoreCompressionChange(enabled),
                )
              }
            />
          </SettingsRow>
          <ReasoningEffortsRow
            value={
              preferences.loadedConfig?.desktop?.["enabled-reasoning-efforts"]
            }
            disabled={pending || !preferences.config || Boolean(reasoningLock)}
            readOnlyReason={reasoningLock}
            error={null}
            onChange={(next) =>
              void mutate(async () => {
                await writeReasoningEffortPreferences(next);
                await preferences.loadConfig();
              })
            }
          />
          <SettingsRow
            label={t("settings.desktop.sourceLicenses")}
            description={t("settings.desktop.sourceLicensesDescription")}
            targetId="general-source-licenses"
          >
            <SettingsAction type="button" onClick={() => setLicensesOpen(true)}>
              {t("settings.desktop.viewSourceLicenses")}
            </SettingsAction>
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
      <SettingsSection title={t("settings.desktop.composer")}>
        <SettingsGroup>
          <SettingsRow
            label={t("settings.desktop.plainTextEditor")}
            description={t("settings.desktop.plainTextEditorDescription")}
            targetId="general-plain-text-editor"
          >
            <SettingsSwitch
              aria-labelledby="general-plain-text-editor-label"
              aria-describedby="general-plain-text-editor-description"
              checked={editorPreferences.plainTextEditor}
              onCheckedChange={(plainTextEditor) =>
                setComposerEditorPreferences({ plainTextEditor })
              }
            />
          </SettingsRow>
          <SettingsRow
            label={t("settings.desktop.showContextWindowUsage")}
            targetId="general-show-context-usage"
          >
            <SettingsSwitch
              aria-labelledby="general-show-context-usage-label"
              aria-describedby="general-show-context-usage-description"
              checked={editorPreferences.showContextWindowUsage}
              onCheckedChange={(showContextWindowUsage) =>
                setComposerEditorPreferences({ showContextWindowUsage })
              }
            />
          </SettingsRow>
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
          <SettingsRow
            label={t("settings.desktop.followUpBehavior")}
            description={t("settings.desktop.followUpBehaviorDescription")}
            targetId="general-follow-up-behavior"
          >
            <SettingsSegmentedControl
              targetId="general-follow-up-behavior"
              described
              value={editorPreferences.followUpMode}
              disabled={false}
              options={[
                {
                  value: "queue",
                  label: t("settings.desktop.followUpQueue"),
                },
                {
                  value: "steer",
                  label: t("settings.desktop.followUpSteer"),
                },
              ]}
              onChange={(followUpMode) =>
                setComposerEditorPreferences({ followUpMode })
              }
            />
          </SettingsRow>
          <SettingsRow
            label={t("settings.desktop.defaultStandaloneChat")}
            description={t("settings.desktop.defaultStandaloneChatDescription")}
            targetId="general-default-standalone-chat"
          >
            <SettingsSwitch
              aria-labelledby="general-default-standalone-chat-label"
              aria-describedby="general-default-standalone-chat-description"
              checked={editorPreferences.defaultStandaloneChat}
              onCheckedChange={(defaultStandaloneChat) =>
                setComposerEditorPreferences({ defaultStandaloneChat })
              }
            />
          </SettingsRow>
        </SettingsGroup>
      </SettingsSection>
      <SourceLicensesDialog
        open={licensesOpen}
        onOpenChange={setLicensesOpen}
        title={t("settings.desktop.sourceLicenses")}
        description={t("settings.desktop.sourceLicensesDescription")}
        closeLabel={t("settings.desktop.close")}
      />
      <Dialog open={confirmFullAccess} onOpenChange={setConfirmFullAccess}>
        <DialogContent className="max-w-[440px]">
          <DialogHeader>
            <DialogTitle>
              {t("settings.desktop.fullAccessConfirmTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("settings.desktop.fullAccessConfirmBody")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmFullAccess(false)}
            >
              {t("settings.desktop.fullAccessConfirmCancel")}
            </Button>
            <Button
              type="button"
              onClick={() => {
                setComposerPermissionVisibility({ fullAccess: true });
                setPermissionVisibility(getComposerPermissionVisibility());
                setConfirmFullAccess(false);
              }}
            >
              {t("settings.desktop.fullAccessConfirmConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsPageBody>
  );
}
