import { useEffect, useRef, useState } from "react";
import {
  Boxes,
  PackageCheck,
  Search,
  Sparkles,
  Users,
} from "lucide-react";
import styled from "styled-components";
import { useTranslation } from "react-i18next";
import type {
  Page,
  PageParams,
  PluginsPageParams,
  SkillsPageParams,
  ExpertsPageParams,
} from "@/types/page";
import type { AppServerPluginCatalogSummary } from "@/lib/api/appServerTypes";
import {
  listInstalledPluginCatalog,
  PLUGIN_CATALOG_CHANGED_EVENT,
} from "@/lib/api/pluginCatalog";
import {
  HeaderArea,
  HeaderTopRow,
  MenuScroll,
  NavButton,
  NavLabel,
  SearchButton,
} from "./AppSidebar.styles";

const Title = styled.h2`
  flex: 1;
  min-width: 0;
  padding: 5px 7px;
  font-size: 14px;
  font-weight: 650;
  color: var(--sidebar-foreground);
`;

const Section = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: 14px;
`;

const SectionLabel = styled.div`
  padding: 8px 9px;
  font-size: 12px;
  color: var(--sidebar-muted);
`;

const SearchInput = styled.input`
  width: 100%;
  margin: 4px 0 8px;
  border: 1px solid var(--sidebar-border);
  border-radius: 7px;
  padding: 7px 9px;
  background: var(--sidebar-surface);
  color: var(--sidebar-foreground);
  font-size: 13px;
`;

interface AppSidebarCustomizationProps {
  currentPage: Page;
  pageParams?: PageParams;
  projectId?: string | null;
  onNavigate: (page: Page, params?: PageParams) => void;
}

export function AppSidebarCustomization({
  currentPage,
  pageParams,
  projectId,
  onNavigate,
}: AppSidebarCustomizationProps) {
  const { t } = useTranslation("navigation");
  const [plugins, setPlugins] = useState<AppServerPluginCatalogSummary[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const pluginParams =
    currentPage === "plugins" ? (pageParams as PluginsPageParams) : undefined;
  const scopedProjectId =
    (currentPage === "skills"
      ? (pageParams as SkillsPageParams | undefined)?.creationProjectId
      : currentPage === "experts"
        ? (pageParams as ExpertsPageParams | undefined)?.currentProjectId
        : pluginParams?.currentProjectId) ??
    projectId ??
    undefined;

  useEffect(() => {
    let disposed = false;
    let sequence = 0;
    const load = async () => {
      const request = ++sequence;
      try {
        const result = await listInstalledPluginCatalog();
        if (!disposed && request === sequence) {
          setPlugins(result.plugins.filter((plugin) => plugin.installed));
          setStatus("ready");
        }
      } catch {
        if (!disposed && request === sequence) setStatus("error");
      }
    };
    void load();
    window.addEventListener(PLUGIN_CATALOG_CHANGED_EVENT, load);
    return () => {
      disposed = true;
      window.removeEventListener(PLUGIN_CATALOG_CHANGED_EVENT, load);
    };
  }, []);

  useEffect(() => {
    if (searchOpen) inputRef.current?.focus();
  }, [searchOpen]);

  const navigatePlugins = (params?: PluginsPageParams) =>
    onNavigate("plugins", {
      ...params,
      ...(scopedProjectId ? { currentProjectId: scopedProjectId } : {}),
    });
  const searchLabel = t("navigation.sidebar.customization.search");
  const entries = [
    {
      id: "plugins",
      label: t("navigation.pluginWorkspace.tabs.plugins"),
      icon: Boxes,
      active:
        currentPage === "plugins" && pluginParams?.statusFilter !== "installed",
      onClick: () => navigatePlugins(),
    },
    {
      id: "skills",
      label: t("navigation.sidebar.customization.skills"),
      icon: Sparkles,
      active: currentPage === "skills",
      onClick: () =>
        onNavigate(
          "skills",
          scopedProjectId ? { creationProjectId: scopedProjectId } : undefined,
        ),
    },
    {
      id: "experts",
      label: t("navigation.pluginWorkspace.tabs.experts"),
      icon: Users,
      active: currentPage === "experts",
      onClick: () =>
        onNavigate(
          "experts",
          scopedProjectId
            ? { currentProjectId: scopedProjectId, projectId: scopedProjectId }
            : undefined,
        ),
    },
    {
      id: "installed",
      label: t("navigation.sidebar.customization.installed"),
      icon: PackageCheck,
      active:
        currentPage === "plugins" &&
        pluginParams?.statusFilter === "installed" &&
        !pluginParams.selectedPluginId,
      onClick: () => navigatePlugins({ statusFilter: "installed" }),
    },
  ];

  return (
    <>
      <HeaderArea data-testid="app-sidebar-customization-header">
        <HeaderTopRow>
          <Title>{t("navigation.sidebar.customization.title")}</Title>
          <SearchButton
            type="button"
            $inline
            aria-label={searchLabel}
            title={searchLabel}
            aria-expanded={searchOpen}
            onClick={() => setSearchOpen((value) => !value)}
          >
            <Search size={14} />
          </SearchButton>
        </HeaderTopRow>
        {searchOpen ? (
          <SearchInput
            ref={inputRef}
            value={query}
            aria-label={searchLabel}
            placeholder={searchLabel}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setSearchOpen(false);
                setQuery("");
              }
              if (event.key === "Enter") navigatePlugins({ query });
            }}
          />
        ) : null}
      </HeaderArea>
      <MenuScroll data-testid="app-sidebar-customization">
        {entries.map((entry) => (
          <NavButton
            key={entry.id}
            type="button"
            $active={entry.active}
            aria-current={entry.active ? "page" : undefined}
            onClick={entry.onClick}
            data-testid={`app-sidebar-customization-${entry.id}`}
          >
            <entry.icon />
            <NavLabel>{entry.label}</NavLabel>
          </NavButton>
        ))}
        <Section>
          <SectionLabel>
            {t("navigation.sidebar.customization.installed")}
          </SectionLabel>
          {plugins
            .filter((plugin) =>
              plugin.name
                .toLocaleLowerCase()
                .includes(query.toLocaleLowerCase()),
            )
            .map((plugin) => (
              <NavButton
                key={plugin.id}
                type="button"
                $active={
                  currentPage === "plugins" &&
                  pluginParams?.selectedPluginId === plugin.id
                }
                aria-current={
                  currentPage === "plugins" &&
                  pluginParams?.selectedPluginId === plugin.id
                    ? "page"
                    : undefined
                }
                onClick={() =>
                  navigatePlugins({
                    statusFilter: "installed",
                    selectedPluginId: plugin.id,
                  })
                }
                data-testid="app-sidebar-installed-plugin"
              >
                <Boxes />
                <NavLabel>{plugin.name}</NavLabel>
              </NavButton>
            ))}
          {status !== "ready" || plugins.length === 0 ? (
            <SectionLabel role="status">
              {t(
                `navigation.sidebar.customization.${status === "ready" ? "empty" : status}`,
              )}
            </SectionLabel>
          ) : null}
        </Section>
      </MenuScroll>
    </>
  );
}
