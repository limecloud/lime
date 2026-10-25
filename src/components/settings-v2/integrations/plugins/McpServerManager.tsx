import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Settings } from "lucide-react";
import type { McpServer } from "@/lib/api/mcp";
import type { Page, PageParams } from "@/types/page";
import {
  SettingsAction,
  SettingsGroup,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
} from "../../SettingsPrimitives";
import { McpServerDetail } from "./McpServerDetail";
import { mcpServerEnabled } from "./mcpServerConfig";
import type { McpSettingsController } from "./useMcpSettings";
import { matchesQuery } from "./plugins-page-selectors";

export function McpServerManager({
  controller,
  onEditingChange,
  onNavigate,
  searchQuery = "",
}: {
  controller: McpSettingsController;
  onEditingChange: (editing: boolean) => void;
  onNavigate?: (page: Page, params?: PageParams) => void;
  searchQuery?: string;
}) {
  const { t } = useTranslation("settings");
  const { servers, statuses, loading, pending, error, awaitingConfirmation } =
    controller;
  const [selected, setSelected] = useState<McpServer | "new" | null>(null);
  const source = useRef<string | null>(null);
  const actions = useRef(new Map<string, HTMLButtonElement>());
  const add = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const editing = selected !== null;
  useLayoutEffect(() => {
    onEditingChange(editing);
  }, [editing, onEditingChange]);
  useLayoutEffect(() => () => onEditingChange(false), [onEditingChange]);
  useLayoutEffect(() => {
    if (!editing && restoreFocus.current) {
      restoreFocus.current = false;
      (source.current
        ? (actions.current.get(source.current) ?? add.current)
        : add.current
      )?.focus();
    }
  }, [editing]);
  const close = () => {
    restoreFocus.current = true;
    setSelected(null);
  };
  const locked = loading || pending || awaitingConfirmation;
  const pluginServers = statuses.filter((status) => Boolean(status.pluginId));
  const visibleServers = servers.filter((server) =>
    matchesQuery(searchQuery, [server.name]),
  );
  const visiblePluginServers = pluginServers.filter((server) =>
    matchesQuery(searchQuery, [server.name, server.pluginId]),
  );
  if (selected !== null)
    return (
      <McpServerDetail
        key={selected === "new" ? "new" : selected.id}
        server={selected === "new" ? undefined : selected}
        controller={controller}
        onClose={close}
      />
    );
  return (
    <div
      id="plugins-mcps"
      data-settings-target="plugins-mcps"
      data-testid="mcp-config-page"
      className="min-w-0 space-y-6"
      aria-busy={loading || pending}
    >
      {error ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 text-[13px] text-destructive"
        >
          <span>{t(`settings.plugins.mcp.error.${error}`)}</span>
          <SettingsAction
            type="button"
            disabled={loading || pending}
            onClick={() => void controller.reload()}
          >
            {t("settings.browser.retry")}
          </SettingsAction>
        </div>
      ) : null}
      {!loading &&
      !error &&
      servers.length + pluginServers.length > 0 &&
      visibleServers.length + visiblePluginServers.length === 0 ? (
        <p role="status" className="text-[13px] text-muted-foreground">
          {t("settings.plugins.search.empty")}
        </p>
      ) : null}
      <SettingsSection
        title={t("settings.plugins.mcp.servers")}
        actions={
          <SettingsAction
            ref={add}
            type="button"
            disabled={locked}
            data-testid="mcp-config-create-server"
            onClick={() => {
              source.current = null;
              controller.clearError();
              setSelected("new");
            }}
          >
            {t("settings.plugins.mcp.addServer")}
          </SettingsAction>
        }
      >
        {loading && servers.length === 0 ? (
          <p role="status">{t("settings.plugins.loading")}</p>
        ) : servers.length === 0 ? (
          !error &&
          (!searchQuery.trim() || pluginServers.length === 0) && (
            <p className="text-[13px] text-muted-foreground">
              {t("settings.plugins.mcp.empty")}
            </p>
          )
        ) : visibleServers.length === 0 ? null : (
          <SettingsGroup>
            {visibleServers.map((server) => {
              const status = statuses.find(
                (item) => !item.pluginId && item.name === server.name,
              );
              return (
                <SettingsRow
                  key={server.id}
                  data-testid="mcp-config-server"
                  data-server-id={server.id}
                  data-mcp-auth-status={status?.authStatus}
                  label={server.name}
                >
                  {status?.authStatus === "notLoggedIn" ? (
                    <SettingsAction
                      type="button"
                      disabled={locked}
                      onClick={() => void controller.authenticate(server.name)}
                    >
                      {t("settings.plugins.mcp.authenticate")}
                    </SettingsAction>
                  ) : null}
                  <SettingsAction
                    type="button"
                    disabled={locked}
                    aria-label={t("settings.plugins.mcp.openSettings", {
                      name: server.name,
                    })}
                    data-testid="mcp-config-open-settings"
                    ref={(node) => {
                      if (node) actions.current.set(server.id, node);
                      else actions.current.delete(server.id);
                    }}
                    onClick={() => {
                      source.current = server.id;
                      controller.clearError();
                      setSelected(server);
                    }}
                  >
                    <Settings className="size-3.5" aria-hidden="true" />
                  </SettingsAction>
                  <SettingsSwitch
                    checked={mcpServerEnabled(server)}
                    disabled={locked}
                    aria-label={t("settings.plugins.enabled", {
                      name: server.name,
                    })}
                    onCheckedChange={(enabled) =>
                      void controller.mutate({
                        kind: "enabled",
                        id: server.id,
                        enabled,
                      })
                    }
                  />
                </SettingsRow>
              );
            })}
          </SettingsGroup>
        )}
      </SettingsSection>
      {visiblePluginServers.length ? (
        <SettingsSection title={t("settings.plugins.mcp.fromPlugins")}>
          <SettingsGroup>
            {visiblePluginServers.map((server) => (
              <SettingsRow
                key={server.name}
                label={server.name}
                description={server.pluginId ?? undefined}
              >
                {onNavigate && server.pluginId ? (
                  <SettingsAction
                    type="button"
                    onClick={() =>
                      onNavigate("plugins", {
                        statusFilter: "installed",
                        selectedPluginId: server.pluginId!,
                      })
                    }
                  >
                    {t("settings.plugins.mcp.settings")}
                  </SettingsAction>
                ) : null}
                <SettingsSwitch
                  checked={server.runtimeStatus !== "disabled"}
                  disabled
                  aria-label={t("settings.plugins.enabled", {
                    name: server.name,
                  })}
                />
              </SettingsRow>
            ))}
          </SettingsGroup>
        </SettingsSection>
      ) : null}
    </div>
  );
}
