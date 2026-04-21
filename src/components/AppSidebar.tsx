/**
 * 全局应用侧边栏
 *
 * 参考 LimeNext V2 current IA：任务 / 能力 / 资料 / 系统 四段式导航，
 * 默认只暴露主线入口，历史系统面收回到显式开启的隐藏项。
 */

import { useState, useEffect, useMemo, useRef, type ReactElement } from "react";
import styled from "styled-components";
import {
  ChevronDown,
  ChevronRight,
  Moon,
  Sun,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
  Activity,
  LucideIcon,
} from "lucide-react";
import * as LucideIcons from "lucide-react";
import { getPluginsForSurface, PluginUIInfo } from "@/lib/api/pluginUI";
import { AgentPageParams, Page, PageParams } from "@/types/page";
import { getConfig, subscribeAppConfigChanged } from "@/lib/api/appConfig";
import {
  buildHomeAgentParams,
} from "@/lib/workspace/navigation";
import {
  DEFAULT_ENABLED_SIDEBAR_NAV_ITEM_IDS,
  FOOTER_SIDEBAR_NAV_SECTIONS,
  MAIN_SIDEBAR_NAV_SECTIONS,
  MAIN_SIDEBAR_NAV_ITEMS,
  resolveEnabledSidebarNavItems,
  type SidebarNavItemDefinition,
  type SidebarNavSectionDefinition,
} from "@/lib/navigation/sidebarNav";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { hasTauriInvokeCapability } from "@/lib/tauri-runtime";
import { LIME_BRAND_LOGO_SRC, LIME_BRAND_NAME } from "@/lib/branding";
import { scheduleMinimumDelayIdleTask } from "@/lib/utils/scheduleMinimumDelayIdleTask";

interface AppSidebarProps {
  currentPage: Page;
  currentPageParams?: PageParams;
  requestedPage?: Page;
  requestedPageParams?: PageParams;
  onNavigate: (page: Page, params?: PageParams) => void;
}

type SidebarNavItem = SidebarNavItemDefinition;
type SidebarNavSection = SidebarNavSectionDefinition;

const APP_SIDEBAR_COLLAPSED_STORAGE_KEY = "lime.app-sidebar.collapsed";
const SIDEBAR_PLUGIN_CENTER_NAV_ITEM_ID = "plugins";
const SIDEBAR_PLUGIN_IDLE_TIMEOUT_MS = 1200;
const SIDEBAR_PLUGIN_BROWSER_IDLE_TIMEOUT_MS = 6000;

function scheduleSidebarPluginLoad(task: () => void): () => void {
  const minimumDelayMs = hasTauriInvokeCapability()
    ? SIDEBAR_PLUGIN_IDLE_TIMEOUT_MS
    : SIDEBAR_PLUGIN_BROWSER_IDLE_TIMEOUT_MS;

  return scheduleMinimumDelayIdleTask(task, {
    minimumDelayMs,
    idleTimeoutMs: SIDEBAR_PLUGIN_IDLE_TIMEOUT_MS,
  });
}

interface SidebarNavigationTarget {
  page: Page;
  rawParams?: PageParams;
  paramsKey: string;
}

function normalizeNavigationParams(params?: PageParams): PageParams {
  return params ? { ...params } : {};
}

function serializeNavigationParams(params?: PageParams): string {
  return JSON.stringify(normalizeNavigationParams(params));
}

function resolveSidebarNavigationTarget(
  item: SidebarNavItem,
): SidebarNavigationTarget | null {
  if (!item.page) {
    return null;
  }

  const rawParams = item.resolveParams ? item.resolveParams(item.params) : item.params;

  return {
    page: item.page,
    rawParams,
    paramsKey: serializeNavigationParams(rawParams),
  };
}

function isSameSidebarNavigationTarget(
  target: SidebarNavigationTarget | null,
  page: Page,
  params?: PageParams,
): boolean {
  if (!target) {
    return false;
  }

  return (
    target.page === page && target.paramsKey === serializeNavigationParams(params)
  );
}

const Container = styled.aside<{
  $collapsed?: boolean;
  $themeMode: "light" | "dark";
}>`
  --sidebar-surface-top: ${({ $themeMode }) =>
    $themeMode === "dark" ? "#15202b" : "#f6fbf4"};
  --sidebar-surface-middle: ${({ $themeMode }) =>
    $themeMode === "dark" ? "#17232d" : "#f9fcf6"};
  --sidebar-surface-bottom: ${({ $themeMode }) =>
    $themeMode === "dark" ? "#1a2530" : "#fbfff5"};
  --sidebar-foreground: ${({ $themeMode }) =>
    $themeMode === "dark" ? "#eef4f7" : "#1a3b2b"};
  --sidebar-muted: ${({ $themeMode }) =>
    $themeMode === "dark" ? "#a1afbd" : "#6b826b"};
  --sidebar-border: ${({ $themeMode }) =>
    $themeMode === "dark" ? "#2d3a46" : "#e2f0e2"};
  --sidebar-divider: ${({ $themeMode }) =>
    $themeMode === "dark"
      ? "rgba(148, 163, 184, 0.14)"
      : "rgba(132, 204, 22, 0.15)"};
  --sidebar-hover: ${({ $themeMode }) =>
    $themeMode === "dark" ? "#22303c" : "#eef7ee"};
  --sidebar-active: ${({ $themeMode }) =>
    $themeMode === "dark" ? "#2a3e3b" : "#e6f8ea"};
  --sidebar-active-foreground: ${({ $themeMode }) =>
    $themeMode === "dark" ? "#dff4ea" : "#166534"};
  --sidebar-search-bg: ${({ $themeMode }) =>
    $themeMode === "dark" ? "#1f2b36" : "#fcfff9"};
  --sidebar-search-hover: ${({ $themeMode }) =>
    $themeMode === "dark" ? "#24313d" : "#f4fdf4"};
  --sidebar-search-border-hover: ${({ $themeMode }) =>
    $themeMode === "dark" ? "#3a4a57" : "#bbf7d0"};
  display: flex;
  flex-direction: column;
  width: ${({ $collapsed }) => ($collapsed ? "72px" : "248px")};
  min-width: ${({ $collapsed }) => ($collapsed ? "72px" : "248px")};
  height: 100vh;
  padding: ${({ $collapsed }) => ($collapsed ? "12px 6px" : "12px 10px")};
  position: relative;
  isolation: isolate;
  background: linear-gradient(
    180deg,
    var(--sidebar-surface-top) 0%,
    var(--sidebar-surface-middle) 34%,
    var(--sidebar-surface-bottom) 100%
  );
  border-right: 1px solid var(--sidebar-border);
  box-shadow: 16px 0 36px -34px rgba(15, 23, 42, 0.42);
  transition:
    width 180ms ease,
    min-width 180ms ease,
    padding 180ms ease;

  &::before {
    content: "";
    position: absolute;
    inset: 0;
    background:
      radial-gradient(
        circle at top left,
        rgba(132, 204, 22, 0.12) 0%,
        rgba(132, 204, 22, 0) 44%
      ),
      radial-gradient(
        circle at bottom left,
        rgba(16, 185, 129, 0.1) 0%,
        rgba(16, 185, 129, 0) 36%
      );
    pointer-events: none;
    z-index: 0;
  }

  > * {
    position: relative;
    z-index: 1;
  }
`;

const HeaderArea = styled.div<{ $collapsed?: boolean }>`
  display: flex;
  flex-direction: column;
  gap: ${({ $collapsed }) => ($collapsed ? "8px" : "10px")};
  margin-bottom: 12px;
`;

const HeaderTopRow = styled.div<{ $collapsed?: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  ${({ $collapsed }) =>
    $collapsed
      ? `
        flex-direction: column;
      `
      : ""}
`;

const UserButton = styled.button<{ $collapsed?: boolean }>`
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  border: none;
  background: transparent;
  border-radius: 10px;
  padding: ${({ $collapsed }) => ($collapsed ? "8px" : "8px 10px")};
  cursor: pointer;
  color: var(--sidebar-foreground);
  justify-content: ${({ $collapsed }) =>
    $collapsed ? "center" : "flex-start"};
  transition:
    background-color 0.18s ease,
    color 0.18s ease;

  &:hover {
    background: var(--sidebar-hover);
  }
`;

const Avatar = styled.div`
  width: 28px;
  height: 28px;
  border-radius: 8px;
  overflow: visible;
  flex-shrink: 0;

  img {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: contain;
  }
`;

const UserName = styled.div<{ $collapsed?: boolean }>`
  flex: 1;
  font-size: 14px;
  font-weight: 600;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: ${({ $collapsed }) => ($collapsed ? "none" : "block")};
`;

const SearchButton = styled.button<{ $collapsed?: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 34px;
  border-radius: 12px;
  border: 1px solid var(--sidebar-border);
  background: var(--sidebar-search-bg);
  color: var(--sidebar-muted);
  padding: ${({ $collapsed }) => ($collapsed ? "0" : "0 10px")};
  cursor: pointer;
  justify-content: ${({ $collapsed }) =>
    $collapsed ? "center" : "flex-start"};
  transition:
    border-color 0.18s ease,
    background-color 0.18s ease,
    color 0.18s ease,
    box-shadow 0.18s ease;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7);

  &:hover {
    border-color: var(--sidebar-search-border-hover);
    background: var(--sidebar-search-hover);
    color: var(--sidebar-foreground);
  }

  span {
    font-size: 13px;
    font-weight: 500;
    display: ${({ $collapsed }) => ($collapsed ? "none" : "inline")};
  }
`;

const MenuScroll = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 2px;

  &::-webkit-scrollbar {
    width: 4px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: var(--sidebar-border);
    border-radius: 9999px;
  }
`;

const Section = styled.div<{ $collapsed?: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 14px;
`;

const SectionTitle = styled.div<{ $collapsed?: boolean }>`
  padding: 0 10px;
  font-size: 12px;
  font-weight: 500;
  color: var(--sidebar-muted);
  opacity: 0.9;
  display: ${({ $collapsed }) => ($collapsed ? "none" : "block")};
`;

const NavButton = styled.button<{ $active?: boolean; $collapsed?: boolean }>`
  display: flex;
  align-items: center;
  gap: ${({ $collapsed }) => ($collapsed ? "0" : "10px")};
  width: 100%;
  height: 38px;
  border: none;
  border-radius: 12px;
  padding: ${({ $collapsed }) => ($collapsed ? "0" : "0 10px")};
  background: ${({ $active }) =>
    $active ? "var(--sidebar-active)" : "transparent"};
  color: ${({ $active }) =>
    $active ? "var(--sidebar-active-foreground)" : "var(--sidebar-muted)"};
  cursor: pointer;
  transition:
    background-color 0.18s ease,
    color 0.18s ease,
    transform 0.18s ease;
  justify-content: ${({ $collapsed }) =>
    $collapsed ? "center" : "flex-start"};

  &:hover {
    background: ${({ $active }) =>
      $active ? "var(--sidebar-active)" : "var(--sidebar-hover)"};
    color: ${({ $active }) =>
      $active
        ? "var(--sidebar-active-foreground)"
        : "var(--sidebar-foreground)"};
  }

  svg {
    width: 17px;
    height: 17px;
    flex-shrink: 0;
    opacity: ${({ $active }) => ($active ? 1 : 0.92)};
  }
`;

const NavLabel = styled.span<{ $collapsed?: boolean }>`
  flex: 1;
  text-align: left;
  font-size: 14px;
  line-height: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: ${({ $collapsed }) => ($collapsed ? "none" : "inline")};
`;

const NavTrailingIcon = styled.span<{
  $collapsed?: boolean;
  $active?: boolean;
}>`
  display: ${({ $collapsed }) => ($collapsed ? "none" : "inline-flex")};
  align-items: center;
  justify-content: center;
  color: ${({ $active }) =>
    $active ? "var(--sidebar-active-foreground)" : "var(--sidebar-muted)"};

  svg {
    width: 14px;
    height: 14px;
  }
`;

const NavGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const SubNavList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-left: 16px;
  padding-left: 12px;
  border-left: 1px solid var(--sidebar-divider);
`;

const SubNavButton = styled(NavButton)`
  height: 34px;
  border-radius: 10px;
  padding: 0 10px 0 12px;

  svg {
    width: 15px;
    height: 15px;
  }
`;

const SubNavLabel = styled(NavLabel)`
  font-size: 13px;
`;

const FooterArea = styled.div<{ $collapsed?: boolean }>`
  margin-top: auto;
  padding-top: 10px;
  border-top: 1px solid var(--sidebar-divider);
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const ActionRow = styled.div<{ $collapsed?: boolean }>`
  display: flex;
  align-items: center;
  justify-content: ${({ $collapsed }) =>
    $collapsed ? "center" : "space-between"};
  padding: 0 2px;
`;

const IconActionButton = styled.button<{ $active?: boolean }>`
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: ${({ $active }) =>
    $active ? "var(--sidebar-active)" : "transparent"};
  color: ${({ $active }) =>
    $active ? "var(--sidebar-active-foreground)" : "var(--sidebar-muted)"};
  cursor: pointer;
  transition:
    background-color 0.18s ease,
    color 0.18s ease;

  &:hover {
    background: ${({ $active }) =>
      $active ? "var(--sidebar-active)" : "var(--sidebar-hover)"};
    color: ${({ $active }) =>
      $active
        ? "var(--sidebar-active-foreground)"
        : "var(--sidebar-foreground)"};
  }

  svg {
    width: 16px;
    height: 16px;
  }
`;

function getIconByName(iconName: string): LucideIcon {
  const IconComponent = (
    LucideIcons as unknown as Record<string, LucideIcon | undefined>
  )[iconName];
  return IconComponent || Activity;
}

export function AppSidebar({
  currentPage,
  currentPageParams,
  requestedPage,
  requestedPageParams,
  onNavigate,
}: AppSidebarProps) {
  const activePage = requestedPage ?? currentPage;
  const activePageParams = requestedPageParams ?? currentPageParams;
  const activeNavigationTarget = {
    page: activePage,
    rawParams: activePageParams,
    paramsKey: serializeNavigationParams(activePageParams),
  } satisfies SidebarNavigationTarget;
  const requestedNavigationTargetRef = useRef<SidebarNavigationTarget>({
    ...activeNavigationTarget,
  });
  const agentEntry = (activePageParams as AgentPageParams | undefined)
    ?.agentEntry;
  const isClawTaskCenter = activePage === "agent" && agentEntry === "claw";
  const isNewTaskHome = activePage === "agent" && agentEntry === "new-task";
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return (
      window.localStorage.getItem(APP_SIDEBAR_COLLAPSED_STORAGE_KEY) === "true"
    );
  });
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window !== "undefined") {
      return document.documentElement.classList.contains("dark")
        ? "dark"
        : "light";
    }
    return "light";
  });

  const [enabledNavItems, setEnabledNavItems] = useState<string[]>(
    DEFAULT_ENABLED_SIDEBAR_NAV_ITEM_IDS,
  );
  const [sidebarPlugins, setSidebarPlugins] = useState<PluginUIInfo[]>([]);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [expandedGroupIds, setExpandedGroupIds] = useState<string[]>(() =>
    MAIN_SIDEBAR_NAV_ITEMS.filter(
      (item) =>
        item.defaultExpanded && item.children && item.children.length > 0,
    ).map((item) => item.id),
  );

  useEffect(() => {
    const loadNavConfig = async () => {
      try {
        const config = await getConfig();
        const resolvedItems = resolveEnabledSidebarNavItems(
          config.navigation?.enabled_items,
        );
        setEnabledNavItems(resolvedItems);
      } catch (error) {
        console.error("加载配置失败:", error);
      }
    };

    loadNavConfig();

    return subscribeAppConfigChanged(() => {
      void loadNavConfig();
    });
  }, []);

  const filteredMainSections = useMemo<SidebarNavSection[]>(() => {
    return MAIN_SIDEBAR_NAV_SECTIONS.map((section) => ({
      ...section,
      items: section.items.filter(
        (item) =>
          item.configurable === false || enabledNavItems.includes(item.id),
      ),
    })).filter((section) => section.items.length > 0);
  }, [enabledNavItems]);

  const filteredFooterSections = useMemo<SidebarNavSection[]>(() => {
    return FOOTER_SIDEBAR_NAV_SECTIONS.map((section) => ({
      ...section,
      items: section.items.filter(
        (item) =>
          item.configurable === false || enabledNavItems.includes(item.id),
      ),
    })).filter((section) => section.items.length > 0);
  }, [enabledNavItems]);

  useEffect(() => {
    if (!enabledNavItems.includes(SIDEBAR_PLUGIN_CENTER_NAV_ITEM_ID)) {
      setSidebarPlugins([]);
      return;
    }

    let cancelled = false;

    const loadSidebarPlugins = async (forceRefresh = false) => {
      try {
        const plugins = await getPluginsForSurface("sidebar", { forceRefresh });
        if (!cancelled) {
          setSidebarPlugins(plugins);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("加载侧边栏插件失败:", error);
        }
      }
    };

    if (refreshTrigger > 0) {
      void loadSidebarPlugins(true);
      return () => {
        cancelled = true;
      };
    }

    const cancelScheduledLoad = scheduleSidebarPluginLoad(() => {
      void loadSidebarPlugins();
    });

    return () => {
      cancelled = true;
      cancelScheduledLoad();
    };
  }, [enabledNavItems, refreshTrigger]);

  useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === "plugin-changed") {
        setRefreshTrigger((prev) => prev + 1);
      }
    };

    const handlePluginChange = () => {
      setRefreshTrigger((prev) => prev + 1);
    };

    window.addEventListener("storage", handleStorageChange);
    window.addEventListener("plugin-changed", handlePluginChange);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("plugin-changed", handlePluginChange);
    };
  }, []);

  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    requestedNavigationTargetRef.current = activeNavigationTarget;
  }, [activeNavigationTarget]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      APP_SIDEBAR_COLLAPSED_STORAGE_KEY,
      collapsed ? "true" : "false",
    );
  }, [collapsed]);

  useEffect(() => {
    if (isNewTaskHome) {
      setCollapsed(false);
      return;
    }

    if (!isClawTaskCenter) {
      return;
    }

    setCollapsed(true);
  }, [isClawTaskCenter, isNewTaskHome]);

  const assistantItems = useMemo<SidebarNavItem[]>(() => {
    return sidebarPlugins.map((plugin) => {
      const pluginPageId = `plugin:${plugin.pluginId}` as Page;
      return {
        id: plugin.pluginId,
        label: plugin.name,
        icon: getIconByName(plugin.icon),
        page: pluginPageId,
      };
    });
  }, [sidebarPlugins]);
  const shouldShowPluginExtensionsSection =
    enabledNavItems.includes(SIDEBAR_PLUGIN_CENTER_NAV_ITEM_ID) &&
    assistantItems.length > 0;

  const isActive = (item: SidebarNavItem): boolean => {
    if (item.children && item.children.length > 0) {
      return item.children.some((child) => isActive(child));
    }

    if (!item.page) {
      return false;
    }

    if (item.isActive) {
      return item.isActive(activePage, activePageParams);
    }

    return activePage === item.page;
  };

  const activeLeafNavItemId =
    [
      ...filteredMainSections.flatMap((section) => section.items),
      ...assistantItems,
      ...filteredFooterSections.flatMap((section) => section.items),
    ].find(
      (item) => (!item.children || item.children.length === 0) && isActive(item),
    )?.id ?? null;

  useEffect(() => {
    const isGroupActive = (item: SidebarNavItem): boolean => {
      if (item.children && item.children.length > 0) {
        return item.children.some((child) => isGroupActive(child));
      }

      if (!item.page) {
        return false;
      }

      if (item.isActive) {
        return item.isActive(activePage, activePageParams);
      }

      return activePage === item.page;
    };

    const activeGroupIds = MAIN_SIDEBAR_NAV_ITEMS.filter(
      (item) =>
        item.children && item.children.length > 0 && isGroupActive(item),
    ).map((item) => item.id);

    if (activeGroupIds.length === 0) {
      return;
    }

    setExpandedGroupIds((current) => {
      const next = new Set(current);
      activeGroupIds.forEach((id) => next.add(id));
      return Array.from(next);
    });
  }, [activeLeafNavItemId, activePage, activePageParams]);

  const handleNavigate = (item: SidebarNavItem) => {
    const target = resolveSidebarNavigationTarget(item);

    if (!target) {
      return;
    }

    if (
      isSameSidebarNavigationTarget(
        target,
        requestedNavigationTargetRef.current.page,
        requestedNavigationTargetRef.current.rawParams,
      )
    ) {
      return;
    }

    requestedNavigationTargetRef.current = target;
    onNavigate(target.page, target.rawParams);
  };

  const toggleGroup = (groupId: string) => {
    setExpandedGroupIds((current) =>
      current.includes(groupId)
        ? current.filter((id) => id !== groupId)
        : [...current, groupId],
    );
  };

  const maybeWrapWithTooltip = (node: ReactElement, label: string) => {
    if (!collapsed) {
      return node;
    }

    return (
      <Tooltip key={node.key ?? label}>
        <TooltipTrigger asChild>{node}</TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    );
  };

  const renderNavItem = (item: SidebarNavItem, nested: boolean = false) => {
    const active = isActive(item);

    if (item.children && item.children.length > 0) {
      const expanded = expandedGroupIds.includes(item.id);
      const groupButton = (
        <NavButton
          key={item.id}
          $active={active}
          $collapsed={collapsed}
          onClick={() => {
            if (collapsed) {
              setCollapsed(false);
              if (!expanded) {
                setExpandedGroupIds((current) =>
                  current.includes(item.id) ? current : [...current, item.id],
                );
              }
              return;
            }

            toggleGroup(item.id);
          }}
          title={item.label}
          aria-label={item.label}
          aria-current={active ? "page" : undefined}
          aria-expanded={collapsed ? undefined : expanded}
        >
          <item.icon />
          <NavLabel $collapsed={collapsed}>{item.label}</NavLabel>
          <NavTrailingIcon $collapsed={collapsed} $active={active}>
            {expanded ? <ChevronDown /> : <ChevronRight />}
          </NavTrailingIcon>
        </NavButton>
      );

      return (
        <NavGroup key={item.id}>
          {maybeWrapWithTooltip(groupButton, item.label)}
          {!collapsed && expanded ? (
            <SubNavList>
              {item.children.map((child) => renderNavItem(child, true))}
            </SubNavList>
          ) : null}
        </NavGroup>
      );
    }

    const ButtonComponent = nested ? SubNavButton : NavButton;
    const LabelComponent = nested ? SubNavLabel : NavLabel;
    const button = (
      <ButtonComponent
        key={item.id}
        $active={active}
        $collapsed={collapsed}
        onClick={() => handleNavigate(item)}
        title={item.label}
        aria-label={item.label}
        aria-current={active ? "page" : undefined}
      >
        <item.icon />
        <LabelComponent $collapsed={collapsed}>{item.label}</LabelComponent>
      </ButtonComponent>
    );

    return maybeWrapWithTooltip(button, item.label);
  };

  return (
    <TooltipProvider>
      <Container $collapsed={collapsed} $themeMode={theme}>
        <HeaderArea $collapsed={collapsed}>
          <HeaderTopRow $collapsed={collapsed}>
            {maybeWrapWithTooltip(
              <UserButton
                $collapsed={collapsed}
                onClick={() => onNavigate("agent", buildHomeAgentParams())}
                title="返回 Lime 首页"
              >
                <Avatar>
                  <img src={LIME_BRAND_LOGO_SRC} alt={LIME_BRAND_NAME} />
                </Avatar>
                <UserName $collapsed={collapsed}>{LIME_BRAND_NAME}</UserName>
              </UserButton>,
              "Lime 首页",
            )}

            {maybeWrapWithTooltip(
              <IconActionButton
                onClick={() => setCollapsed((value) => !value)}
                title={collapsed ? "展开导航栏" : "折叠导航栏"}
                aria-label={collapsed ? "展开导航栏" : "折叠导航栏"}
              >
                {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
              </IconActionButton>,
              collapsed ? "展开导航栏" : "折叠导航栏",
            )}
          </HeaderTopRow>

          {maybeWrapWithTooltip(
            <SearchButton
              $collapsed={collapsed}
              onClick={() => onNavigate("agent", buildHomeAgentParams())}
              title="搜索任务"
              aria-label="搜索任务"
            >
              <Search size={14} />
              <span>搜索任务</span>
            </SearchButton>,
            "搜索任务",
          )}
        </HeaderArea>

        <MenuScroll>
          {filteredMainSections.map((section) => (
            <Section key={section.id} $collapsed={collapsed}>
              <SectionTitle $collapsed={collapsed}>
                {section.title}
              </SectionTitle>
              {section.items.map((item) => renderNavItem(item))}
            </Section>
          ))}

          {shouldShowPluginExtensionsSection && (
            <Section $collapsed={collapsed}>
              <SectionTitle $collapsed={collapsed}>插件扩展</SectionTitle>
              {assistantItems.map((item) => renderNavItem(item))}
            </Section>
          )}
        </MenuScroll>

        <FooterArea $collapsed={collapsed}>
          {filteredFooterSections.map((section) => (
            <Section key={section.id} $collapsed={collapsed}>
              <SectionTitle $collapsed={collapsed}>
                {section.title}
              </SectionTitle>
              {section.items.map((item) => renderNavItem(item))}
            </Section>
          ))}

          <ActionRow $collapsed={collapsed}>
            {!collapsed ? <div /> : null}
            {maybeWrapWithTooltip(
              <IconActionButton
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                title={theme === "dark" ? "深色模式" : "浅色模式"}
                aria-label={
                  theme === "dark" ? "切换到浅色模式" : "切换到深色模式"
                }
              >
                {theme === "dark" ? <Moon /> : <Sun />}
              </IconActionButton>,
              theme === "dark" ? "切换到浅色模式" : "切换到深色模式",
            )}
          </ActionRow>
        </FooterArea>
      </Container>
    </TooltipProvider>
  );
}
