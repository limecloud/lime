import { useEffect, useRef, useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Page, PageParams } from "@/types/page";
import {
  SettingsAction,
  SettingsPageBody,
  SettingsPageHeader,
} from "../../SettingsPrimitives";
import { InstalledPluginsSettings } from "./InstalledPluginsSettings";
import { McpServerManager } from "./McpServerManager";
import { usePluginsSettings } from "./usePluginsSettings";
import { useMcpSettings } from "./useMcpSettings";
import { useSkillsSettings } from "./useSkillsSettings";
import { InstalledSkillsSettings } from "./InstalledSkillsSettings";
import { MarketplaceSettings } from "./MarketplaceSettings";
import { useMarketplaceSettings } from "./useMarketplaceSettings";
import { PluginsSettingsSearch } from "./PluginsSettingsSearch";

// 安装包公开导出 PluginsSettings；管理分组复用同一 catalog/config owner。
export function PluginsSettings({
  onNavigate,
  initialManageTab = "plugins",
}: {
  onNavigate?: (page: Page, params?: PageParams) => void;
  initialManageTab?: "plugins" | "mcps" | "skills" | "marketplace";
}) {
  const { t } = useTranslation("settings");
  const plugins = usePluginsSettings();
  const mcps = useMcpSettings();
  const skills = useSkillsSettings();
  const marketplace = useMarketplaceSettings();
  const [tab, setTab] = useState(initialManageTab);
  const [searchQuery, setSearchQuery] = useState("");
  const [editing, setEditing] = useState(false);
  const refreshButton = useRef<HTMLButtonElement>(null);
  const showPlugins =
    plugins.plugins.length > 0 || plugins.loading || Boolean(plugins.error);
  const showSkills =
    skills.skills.length > 0 || skills.loading || Boolean(skills.error);
  const showMarketplace =
    marketplace.marketplaces.length > 0 ||
    marketplace.loading ||
    Boolean(marketplace.error) ||
    Boolean(marketplace.removal);
  const active =
    (tab === "plugins" && !showPlugins) ||
    (tab === "skills" && !showSkills) ||
    (tab === "marketplace" && !showMarketplace)
      ? "mcps"
      : tab;
  useEffect(() => {
    if (
      (!showPlugins && tab === "plugins") ||
      (!showSkills && tab === "skills") ||
      (!showMarketplace && tab === "marketplace")
    )
      setTab("mcps");
  }, [showPlugins, showSkills, showMarketplace, tab]);
  useEffect(() => {
    setTab(initialManageTab);
  }, [initialManageTab]);
  const controller =
    active === "plugins"
      ? plugins
      : active === "skills"
        ? skills
        : active === "marketplace"
          ? marketplace
          : mcps;
  const changingMarketplace =
    marketplace.pending || Boolean(marketplace.removal);
  const { loading, pending } = controller;
  return (
    <SettingsPageBody
      data-testid="settings-plugins-page"
      aria-busy={loading || pending}
    >
      {!editing ? (
        <>
          <SettingsPageHeader
            title={t("settings.desktop.plugins")}
            actions={
              <div className="flex flex-wrap justify-end gap-2">
                {onNavigate ? (
                  <SettingsAction
                    type="button"
                    onClick={() =>
                      active === "skills"
                        ? onNavigate("skills", { initialView: "discover" })
                        : onNavigate("plugins")
                    }
                  >
                    {t("settings.plugins.browseDirectory")}
                  </SettingsAction>
                ) : null}
                <SettingsAction
                  ref={refreshButton}
                  type="button"
                  disabled={loading || pending || changingMarketplace}
                  aria-label={t("settings.plugins.refresh")}
                  onClick={() => void controller.reload()}
                >
                  <RefreshCw className="size-3.5" aria-hidden="true" />
                </SettingsAction>
              </div>
            }
          />
          <p className="-mt-6 text-[13px] text-muted-foreground">
            {t("settings.plugins.subtitle")}
          </p>
        </>
      ) : null}
      <Tabs.Root
        value={active}
        onValueChange={(value) => {
          if (
            !pending &&
            !changingMarketplace &&
            (value === "plugins" ||
              value === "mcps" ||
              value === "skills" ||
              value === "marketplace")
          )
            setTab(value);
        }}
        className="min-w-0 space-y-6"
        activationMode="automatic"
      >
        {!editing ? (
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
            <Tabs.List
              aria-label={t("settings.plugins.manageTabs")}
              className="flex min-w-0 flex-wrap gap-1 text-[13px]"
            >
              {showPlugins ? (
                <Tabs.Trigger
                  value="plugins"
                  data-testid="plugins-settings-tab-plugins"
                  className="rounded-lg px-3 py-1.5 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:bg-muted data-[state=active]:font-medium"
                >
                  {t("settings.desktop.plugins")}{" "}
                  <span className="text-muted-foreground">
                    {plugins.plugins.length}
                  </span>
                </Tabs.Trigger>
              ) : null}
              <Tabs.Trigger
                value="mcps"
                data-testid="plugins-settings-tab-mcps"
                className="rounded-lg px-3 py-1.5 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:bg-muted data-[state=active]:font-medium"
              >
                {t("settings.plugins.mcpsTitle")}{" "}
                <span className="text-muted-foreground">
                  {mcps.servers.length +
                    mcps.statuses.filter((server) => Boolean(server.pluginId))
                      .length}
                </span>
              </Tabs.Trigger>
              {showSkills ? (
                <Tabs.Trigger
                  value="skills"
                  data-testid="plugins-settings-tab-skills"
                  className="rounded-lg px-3 py-1.5 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:bg-muted data-[state=active]:font-medium"
                >
                  {t("settings.plugins.skills.title")}{" "}
                  <span className="text-muted-foreground">
                    {skills.skills.length}
                  </span>
                </Tabs.Trigger>
              ) : null}
              {showMarketplace ? (
                <Tabs.Trigger
                  value="marketplace"
                  data-testid="plugins-settings-tab-marketplace"
                  className="rounded-lg px-3 py-1.5 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:bg-muted data-[state=active]:font-medium"
                >
                  {t("settings.plugins.marketplace.title")}{" "}
                  <span className="text-muted-foreground">
                    {marketplace.marketplaces.length}
                  </span>
                </Tabs.Trigger>
              ) : null}
            </Tabs.List>
            <PluginsSettingsSearch
              tab={active}
              query={searchQuery}
              onQueryChange={setSearchQuery}
            />
          </div>
        ) : null}
        <Tabs.Content value="plugins" className="min-w-0 outline-none">
          <InstalledPluginsSettings
            onNavigate={onNavigate}
            controller={plugins}
            refreshButton={refreshButton}
            searchQuery={searchQuery}
          />
        </Tabs.Content>
        <Tabs.Content value="mcps" className="min-w-0 outline-none">
          <McpServerManager
            controller={mcps}
            onEditingChange={setEditing}
            searchQuery={searchQuery}
            onNavigate={onNavigate}
          />
        </Tabs.Content>
        <Tabs.Content value="skills" className="min-w-0 outline-none">
          <InstalledSkillsSettings
            controller={skills}
            searchQuery={searchQuery}
            onNavigate={onNavigate}
          />
        </Tabs.Content>
        <Tabs.Content value="marketplace" className="min-w-0 outline-none">
          <MarketplaceSettings
            controller={marketplace}
            searchQuery={searchQuery}
            refreshButton={refreshButton}
          />
        </Tabs.Content>
      </Tabs.Root>
    </SettingsPageBody>
  );
}
