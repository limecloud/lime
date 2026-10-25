import { useEffect, useRef, useState, type RefObject } from "react";
import * as AlertDialog from "@radix-ui/react-dialog";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AppServerPluginSummary } from "@/lib/api/appServerTypes";
import type { Page, PageParams } from "@/types/page";
import {
  pluginDescription,
  pluginDisplayName,
} from "@/features/plugin/ui/PluginCatalogPageViewModel";
import {
  SettingsAction,
  SettingsGroup,
  SettingsRow,
  SettingsSwitch,
} from "../../SettingsPrimitives";
import { usePluginsSettings } from "./usePluginsSettings";
import { matchesQuery } from "./plugins-page-selectors";

export function InstalledPluginsSettings({
  onNavigate,
  controller,
  refreshButton,
  searchQuery = "",
}: {
  onNavigate?: (page: Page, params?: PageParams) => void;
  controller: ReturnType<typeof usePluginsSettings>;
  refreshButton: RefObject<HTMLButtonElement>;
  searchQuery?: string;
}) {
  const { t } = useTranslation("settings");
  const { t: agent } = useTranslation("agent");
  const {
    accountVersion,
    plugins,
    loading,
    pending,
    awaitingConfirmation,
    error,
    clearError,
    reload,
    mutate,
  } = controller;
  const visiblePlugins = plugins.filter((plugin) =>
    matchesQuery(searchQuery, [
      plugin.name,
      pluginDisplayName(plugin),
      pluginDescription(plugin),
    ]),
  );
  const [uninstallTarget, setUninstallTarget] =
    useState<AppServerPluginSummary | null>(null);
  const source = useRef<HTMLButtonElement | null>(null);
  const actions = useRef(new Map<string, HTMLButtonElement>());
  const confirmationTarget = useRef<AppServerPluginSummary | null>(null);
  useEffect(() => {
    confirmationTarget.current = null;
    setUninstallTarget(null);
  }, [accountVersion]);
  return (
    <>
      {error && !uninstallTarget ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 text-[13px] text-destructive"
        >
          <span>{t(`settings.plugins.error.${error}`)}</span>
          <SettingsAction
            type="button"
            disabled={loading || pending}
            onClick={() => void reload()}
          >
            {t("settings.browser.retry")}
          </SettingsAction>
        </div>
      ) : null}
      <div id="plugins-installed" data-settings-target="plugins-installed">
        {loading && plugins.length === 0 ? (
          <p role="status">{t("settings.plugins.loading")}</p>
        ) : plugins.length === 0 ? (
          error ? null : (
            <p className="text-[13px] text-muted-foreground">
              {t("settings.plugins.empty")}
            </p>
          )
        ) : visiblePlugins.length === 0 ? (
          <p role="status" className="text-[13px] text-muted-foreground">
            {t("settings.plugins.search.empty")}
          </p>
        ) : (
          <SettingsGroup>
            {visiblePlugins.map((plugin) => {
              const name = pluginDisplayName(plugin);
              const managed =
                plugin.availability === "DISABLED_BY_ADMIN" ||
                plugin.disabledReason === "disabled_by_admin";
              return (
                <SettingsRow
                  key={plugin.id}
                  data-plugin-id={plugin.id}
                  label={
                    onNavigate ? (
                      <button
                        type="button"
                        className="max-w-full text-left [overflow-wrap:anywhere] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                        onClick={() =>
                          onNavigate("plugins", {
                            statusFilter: "installed",
                            selectedPluginId: plugin.id,
                          })
                        }
                      >
                        {name}
                      </button>
                    ) : (
                      name
                    )
                  }
                  description={pluginDescription(plugin) || undefined}
                >
                  {managed ? (
                    <span className="text-[12px] text-muted-foreground">
                      {t("settings.plugins.managed")}
                    </span>
                  ) : null}
                  <SettingsSwitch
                    checked={plugin.enabled}
                    disabled={
                      loading || pending || awaitingConfirmation || managed
                    }
                    aria-label={t("settings.plugins.enabled", { name })}
                    onCheckedChange={(enabled) => void mutate(plugin, enabled)}
                  />
                  <Menu.Root>
                    <Menu.Trigger asChild>
                      <SettingsAction
                        type="button"
                        ref={(node) => {
                          if (node) actions.current.set(plugin.id, node);
                          else actions.current.delete(plugin.id);
                        }}
                        disabled={
                          loading || pending || awaitingConfirmation || managed
                        }
                        aria-label={t("settings.plugins.actions", { name })}
                      >
                        <MoreHorizontal
                          className="size-3.5"
                          aria-hidden="true"
                        />
                      </SettingsAction>
                    </Menu.Trigger>
                    <Menu.Portal>
                      <Menu.Content
                        onCloseAutoFocus={(event) => {
                          const target = confirmationTarget.current;
                          if (target) {
                            event.preventDefault();
                            confirmationTarget.current = null;
                            clearError();
                            setUninstallTarget(target);
                          }
                        }}
                        align="end"
                        sideOffset={4}
                        className="z-50 min-w-36 rounded-xl border border-border bg-background p-1 text-[13px] text-foreground shadow-lg"
                      >
                        <Menu.Item
                          className="cursor-pointer rounded-lg px-3 py-1.5 text-destructive outline-none focus:bg-muted"
                          onSelect={() => {
                            source.current =
                              actions.current.get(plugin.id) ?? null;
                            confirmationTarget.current = plugin;
                          }}
                        >
                          {agent("plugin.catalog.v2.uninstall")}
                        </Menu.Item>
                      </Menu.Content>
                    </Menu.Portal>
                  </Menu.Root>
                </SettingsRow>
              );
            })}
          </SettingsGroup>
        )}
      </div>
      <AlertDialog.Root
        open={uninstallTarget !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setUninstallTarget(null);
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
          <AlertDialog.Content
            role="alertdialog"
            className="fixed left-1/2 top-1/2 z-50 w-[420px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-background p-5 text-foreground shadow-xl"
            onEscapeKeyDown={(event) => {
              if (pending) event.preventDefault();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              (source.current?.isConnected
                ? source.current
                : refreshButton.current
              )?.focus();
            }}
          >
            <AlertDialog.Title className="text-[16px] font-medium">
              {agent("plugin.catalog.v2.uninstallTitle", {
                name: uninstallTarget ? pluginDisplayName(uninstallTarget) : "",
              })}
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-[13px] text-muted-foreground">
              {agent("plugin.catalog.v2.uninstallDescription")}
            </AlertDialog.Description>
            {error ? (
              <p role="alert" className="mt-3 text-[13px] text-destructive">
                {t(`settings.plugins.error.${error}`)}
              </p>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <AlertDialog.Close asChild>
                <SettingsAction type="button" disabled={pending}>
                  {agent("plugin.catalog.v2.cancel")}
                </SettingsAction>
              </AlertDialog.Close>
              {error === "refresh" || error === "load" ? (
                <SettingsAction
                  type="button"
                  disabled={loading || pending}
                  onClick={async () => {
                    const latest = await reload();
                    if (
                      latest &&
                      uninstallTarget &&
                      !latest.some((plugin) => plugin.id === uninstallTarget.id)
                    )
                      setUninstallTarget(null);
                  }}
                >
                  {t("settings.browser.retry")}
                </SettingsAction>
              ) : null}
              <SettingsAction
                type="button"
                disabled={
                  loading || pending || error === "refresh" || error === "load"
                }
                onClick={async () => {
                  if (uninstallTarget && (await mutate(uninstallTarget)))
                    setUninstallTarget(null);
                }}
              >
                {agent("plugin.catalog.v2.uninstall")}
              </SettingsAction>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}
