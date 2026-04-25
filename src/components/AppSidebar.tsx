/**
 * 全局应用侧边栏
 *
 * 当前导航收口为一级主入口 + 底部系统入口。
 * 默认只暴露主线入口；底部固定保留设置、持续流程、消息渠道，
 * 可选项只剩插件中心、OpenClaw、桌宠。
 */

import {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
  type ReactElement,
} from "react";
import styled from "styled-components";
import {
  ChevronDown,
  Clock3,
  MessageSquarePlus,
  Archive,
  Moon,
  Sun,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
  Undo2,
  Activity,
  LucideIcon,
} from "lucide-react";
import * as LucideIcons from "lucide-react";
import { getPluginsForSurface, PluginUIInfo } from "@/lib/api/pluginUI";
import { AgentPageParams, Page, PageParams } from "@/types/page";
import { getConfig, subscribeAppConfigChanged } from "@/lib/api/appConfig";
import {
  buildClawAgentParams,
  buildHomeAgentParams,
} from "@/lib/workspace/navigation";
import {
  listAgentRuntimeSessions,
  updateAgentRuntimeSession,
  type AsterSessionInfo,
} from "@/lib/api/agentRuntime";
import {
  DEFAULT_ENABLED_SIDEBAR_NAV_ITEM_IDS,
  FOOTER_SIDEBAR_NAV_ITEMS,
  MAIN_SIDEBAR_NAV_ITEMS,
  resolveEnabledSidebarNavItems,
  type SidebarNavItemDefinition,
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
  --sidebar-card-surface: ${({ $themeMode }) =>
    $themeMode === "dark"
      ? "linear-gradient(180deg, rgba(24, 34, 44, 0.96) 0%, rgba(19, 29, 38, 0.98) 100%)"
      : "linear-gradient(180deg, rgba(255, 255, 255, 0.76) 0%, rgba(249, 252, 246, 0.94) 100%)"};
  --sidebar-card-shadow: ${({ $themeMode }) =>
    $themeMode === "dark"
      ? "0 18px 34px -28px rgba(2, 8, 23, 0.7)"
      : "0 16px 30px -28px rgba(15, 23, 42, 0.4)"};
  --sidebar-card-highlight: ${({ $themeMode }) =>
    $themeMode === "dark"
      ? "rgba(255, 255, 255, 0.08)"
      : "rgba(255, 255, 255, 0.72)"};
  display: flex;
  flex-direction: column;
  width: ${({ $collapsed }) => ($collapsed ? "72px" : "272px")};
  min-width: ${({ $collapsed }) => ($collapsed ? "72px" : "272px")};
  height: 100vh;
  padding: ${({ $collapsed }) => ($collapsed ? "12px 6px" : "14px 14px 12px")};
  position: relative;
  isolation: isolate;
  background: linear-gradient(
    180deg,
    var(--sidebar-surface-top) 0%,
    var(--sidebar-surface-middle) 38%,
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
        rgba(132, 204, 22, 0.14) 0%,
        rgba(132, 204, 22, 0) 46%
      ),
      radial-gradient(
        circle at 18% 18%,
        rgba(16, 185, 129, 0.12) 0%,
        rgba(16, 185, 129, 0) 30%
      ),
      radial-gradient(
        circle at bottom left,
        rgba(186, 230, 253, 0.12) 0%,
        rgba(186, 230, 253, 0) 34%
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
  gap: ${({ $collapsed }) => ($collapsed ? "8px" : "14px")};
  margin-bottom: 16px;
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
  border-radius: 14px;
  padding: ${({ $collapsed }) => ($collapsed ? "8px" : "10px 12px")};
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
  font-size: 15px;
  font-weight: 700;
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
  height: 44px;
  border-radius: 16px;
  border: 1px solid var(--sidebar-border);
  background: var(--sidebar-search-bg);
  color: var(--sidebar-muted);
  padding: ${({ $collapsed }) => ($collapsed ? "0" : "0 14px")};
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
    font-size: 14px;
    font-weight: 600;
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

const MainNavList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
`;

const Section = styled.div<{ $collapsed?: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
`;

const SectionTitle = styled.div<{ $collapsed?: boolean }>`
  padding: 0 10px;
  font-size: 13px;
  font-weight: 600;
  color: var(--sidebar-muted);
  opacity: 0.9;
  display: ${({ $collapsed }) => ($collapsed ? "none" : "block")};
`;

const NavButton = styled.button<{ $active?: boolean; $collapsed?: boolean }>`
  display: flex;
  align-items: center;
  gap: ${({ $collapsed }) => ($collapsed ? "0" : "10px")};
  width: 100%;
  height: ${({ $collapsed }) => ($collapsed ? "40px" : "46px")};
  border: none;
  border-radius: 14px;
  padding: ${({ $collapsed }) => ($collapsed ? "0" : "0 12px")};
  background: ${({ $active }) =>
    $active
      ? "linear-gradient(180deg, rgba(230, 248, 234, 0.98), rgba(221, 247, 230, 0.92))"
      : "transparent"};
  color: ${({ $active }) =>
    $active ? "var(--sidebar-active-foreground)" : "var(--sidebar-muted)"};
  cursor: pointer;
  transition:
    background-color 0.18s ease,
    color 0.18s ease,
    transform 0.18s ease,
    box-shadow 0.18s ease;
  justify-content: ${({ $collapsed }) =>
    $collapsed ? "center" : "flex-start"};
  box-shadow: ${({ $active }) =>
    $active ? "0 12px 24px -22px rgba(22, 101, 52, 0.34)" : "none"};

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

const ConversationShelf = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 2px 0 12px;
`;

const ConversationSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 140px;
  max-height: 208px;
  padding: 10px;
  border-radius: 24px;
  border: 1px solid var(--sidebar-border);
  background:
    var(--sidebar-card-surface),
    var(--sidebar-search-bg);
  box-shadow:
    inset 0 1px 0 var(--sidebar-card-highlight),
    var(--sidebar-card-shadow);
  overflow: hidden;
`;

const ConversationSectionHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 4px;
  color: var(--sidebar-muted);
`;

const ConversationSectionTitle = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  margin: 0;
  border: none;
  background: transparent;
  color: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;

  svg {
    width: 14px;
    height: 14px;
  }
`;

const ConversationActionButton = styled.button`
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 9px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--sidebar-muted);
  cursor: pointer;
  transition:
    background-color 0.18s ease,
    color 0.18s ease;

  &:hover {
    background: var(--sidebar-hover);
    color: var(--sidebar-foreground);
  }

  svg {
    width: 16px;
    height: 16px;
  }
`;

const ConversationList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-height: 0;
  max-height: 132px;
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

const ConversationItemRow = styled.div<{
  $active?: boolean;
}>`
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  border-radius: 12px;
  background: ${({ $active }) =>
    $active
      ? "linear-gradient(180deg, rgba(230, 248, 234, 0.98), rgba(221, 247, 230, 0.92))"
      : "transparent"};
  transition:
    background-color 0.18s ease,
    color 0.18s ease;

  &:hover {
    background: ${({ $active }) =>
      $active ? "var(--sidebar-active)" : "var(--sidebar-hover)"};
  }
`;

const ConversationItemButton = styled.button<{
  $active?: boolean;
}>`
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
  min-height: 38px;
  border: none;
  border-radius: 12px;
  padding: 0 10px;
  background: transparent;
  color: ${({ $active }) =>
    $active ? "var(--sidebar-active-foreground)" : "var(--sidebar-foreground)"};
  cursor: pointer;
  transition: color 0.18s ease;
`;

const ConversationItemDot = styled.span<{ $active?: boolean }>`
  width: 8px;
  height: 8px;
  flex-shrink: 0;
  border-radius: 999px;
  background: ${({ $active }) =>
    $active ? "var(--sidebar-active-foreground)" : "rgba(148, 163, 184, 0.72)"};
`;

const ConversationItemLabel = styled.span`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 500;
`;

const ConversationItemMeta = styled.span`
  flex-shrink: 0;
  font-size: 11px;
  color: var(--sidebar-muted);
`;

const ConversationItemActionButton = styled.button`
  width: 30px;
  min-width: 30px;
  height: 38px;
  border: none;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--sidebar-muted);
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transition:
    opacity 0.18s ease,
    background-color 0.18s ease,
    color 0.18s ease;

  &:hover {
    background: var(--sidebar-hover);
    color: var(--sidebar-foreground);
  }

  &:disabled {
    cursor: wait;
    opacity: 0.6;
  }

  ${ConversationItemRow}:hover &,
  ${ConversationItemRow}[data-active="true"] & {
    opacity: 1;
    pointer-events: auto;
  }

  svg {
    width: 15px;
    height: 15px;
  }
`;

const ConversationEmptyState = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex: 1;
  min-height: 0;
  border-radius: 16px;
  padding: 12px;
  color: var(--sidebar-muted);
  font-size: 13px;
  background: rgba(255, 255, 255, 0.28);
  text-align: center;
`;

const FooterArea = styled.div<{ $collapsed?: boolean }>`
  padding-top: 10px;
  padding-bottom: 16px;
  border-top: 1px solid var(--sidebar-divider);
  display: flex;
  flex-direction: column;
  gap: 6px;
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

function sortSidebarSessions(sessions: AsterSessionInfo[]): AsterSessionInfo[] {
  return [...sessions].sort((left, right) => {
    if (left.updated_at !== right.updated_at) {
      return right.updated_at - left.updated_at;
    }

    if (left.created_at !== right.created_at) {
      return right.created_at - left.created_at;
    }

    return left.id.localeCompare(right.id);
  });
}

function formatSidebarSessionTime(updatedAt: number): string {
  const diffMs = Date.now() - updatedAt * 1000;
  const diffMinutes = Math.max(1, Math.floor(diffMs / (1000 * 60)));

  if (diffMinutes < 60) {
    return `${diffMinutes}分`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}时`;
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) {
    return `${diffDays}天`;
  }

  return new Date(updatedAt * 1000).toLocaleDateString("zh-CN", {
    month: "numeric",
    day: "numeric",
  });
}

function formatSidebarSessionMeta(session: AsterSessionInfo): string {
  if (typeof session.archived_at === "number" && session.archived_at > 0) {
    return `归档 ${formatSidebarSessionTime(session.archived_at)}`;
  }

  return formatSidebarSessionTime(session.updated_at);
}

function resolveSidebarSessionTitle(session: AsterSessionInfo): string {
  return session.name?.trim() || "未命名对话";
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
  const activeAgentPageParams = activePageParams as AgentPageParams | undefined;
  const isClawTaskCenter = activePage === "agent" && agentEntry === "claw";
  const isNewTaskHome = activePage === "agent" && agentEntry === "new-task";
  const currentProjectId = activeAgentPageParams?.projectId?.trim() || null;
  const currentSessionId = activeAgentPageParams?.initialSessionId?.trim() || null;
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
  const sidebarSessionsRef = useRef<AsterSessionInfo[]>([]);
  const [sidebarSessions, setSidebarSessions] = useState<AsterSessionInfo[]>([]);
  const [sidebarSessionsLoading, setSidebarSessionsLoading] = useState(false);
  const [sidebarSessionActionId, setSidebarSessionActionId] = useState<string | null>(
    null,
  );
  const [recentSessionsCollapsed, setRecentSessionsCollapsed] = useState(false);
  const [archivedSessionsCollapsed, setArchivedSessionsCollapsed] =
    useState(false);

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

  const filteredMainNavItems = useMemo<SidebarNavItem[]>(() => {
    return MAIN_SIDEBAR_NAV_ITEMS.filter(
      (item) => item.configurable === false || enabledNavItems.includes(item.id),
    );
  }, [enabledNavItems]);

  const filteredFooterNavItems = useMemo<SidebarNavItem[]>(() => {
    return FOOTER_SIDEBAR_NAV_ITEMS.filter(
      (item) => item.configurable === false || enabledNavItems.includes(item.id),
    );
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

    setCollapsed(false);
  }, [isClawTaskCenter, isNewTaskHome]);

  const shouldShowConversationList =
    !collapsed &&
    !(activePage === "agent" && activeAgentPageParams?.immersiveHome);
  const shouldShowSessionLoadingState =
    sidebarSessionsLoading && sidebarSessions.length === 0;

  useEffect(() => {
    sidebarSessionsRef.current = sidebarSessions;
  }, [sidebarSessions]);

  const refreshSidebarSessions = useCallback(async () => {
    if (!shouldShowConversationList) {
      return;
    }

    setSidebarSessionsLoading(
      (current) => current || sidebarSessionsRef.current.length === 0,
    );
    try {
      const sessions = await listAgentRuntimeSessions({
        includeArchived: true,
      });
      setSidebarSessions(sortSidebarSessions(sessions));
    } catch (error) {
      console.error("加载导航任务列表失败:", error);
      setSidebarSessions([]);
    } finally {
      setSidebarSessionsLoading(false);
    }
  }, [shouldShowConversationList]);

  useEffect(() => {
    if (!shouldShowConversationList) {
      return;
    }

    let cancelled = false;

    const loadSessions = async () => {
      try {
        const sessions = await listAgentRuntimeSessions({
          includeArchived: true,
        });
        if (!cancelled) {
          setSidebarSessions(sortSidebarSessions(sessions));
        }
      } catch (error) {
        if (!cancelled) {
          console.error("加载导航任务列表失败:", error);
          setSidebarSessions([]);
        }
      } finally {
        if (!cancelled) {
          setSidebarSessionsLoading(false);
        }
      }
    };

    setSidebarSessionsLoading(sidebarSessionsRef.current.length === 0);
    void loadSessions();

    const handleFocus = () => {
      void refreshSidebarSessions();
    };

    window.addEventListener("focus", handleFocus);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", handleFocus);
    };
  }, [refreshSidebarSessions, shouldShowConversationList]);

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
  const filteredSidebarSessions = useMemo(() => {
    if (!currentProjectId) {
      return sidebarSessions;
    }

    return sidebarSessions.filter(
      (session) => !session.workspace_id || session.workspace_id === currentProjectId,
    );
  }, [currentProjectId, sidebarSessions]);
  const recentSidebarSessions = useMemo(
    () => filteredSidebarSessions.filter((session) => !session.archived_at),
    [filteredSidebarSessions],
  );
  const archivedSidebarSessions = useMemo(
    () => filteredSidebarSessions.filter((session) => Boolean(session.archived_at)),
    [filteredSidebarSessions],
  );

  const isActive = (item: SidebarNavItem): boolean => {
    if (!item.page) {
      return false;
    }

    if (item.isActive) {
      return item.isActive(activePage, activePageParams);
    }

    return activePage === item.page;
  };

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

  const renderNavItem = (item: SidebarNavItem) => {
    const active = isActive(item);
    const button = (
      <NavButton
        key={item.id}
        $active={active}
        $collapsed={collapsed}
        onClick={() => handleNavigate(item)}
        title={item.label}
        aria-label={item.label}
        aria-current={active ? "page" : undefined}
      >
        <item.icon />
        <NavLabel $collapsed={collapsed}>{item.label}</NavLabel>
      </NavButton>
    );

    return maybeWrapWithTooltip(button, item.label);
  };

  const handleNavigateToConversation = (session: AsterSessionInfo) => {
    const targetParams = buildClawAgentParams({
      projectId: session.workspace_id ?? currentProjectId ?? undefined,
      initialSessionId: session.id,
    });
    const target = {
      page: "agent" as Page,
      rawParams: targetParams,
      paramsKey: serializeNavigationParams(targetParams),
    } satisfies SidebarNavigationTarget;

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

  const handleNavigateToNewTask = () => {
    const targetParams = buildHomeAgentParams({
      projectId: currentProjectId ?? undefined,
    });
    const target = {
      page: "agent" as Page,
      rawParams: targetParams,
      paramsKey: serializeNavigationParams(targetParams),
    } satisfies SidebarNavigationTarget;

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

  const handleToggleSessionArchive = useCallback(
    async (session: AsterSessionInfo, archived: boolean) => {
      const nextUpdatedAt = Math.floor(Date.now() / 1000);
      setSidebarSessionActionId(session.id);
      setSidebarSessions((current) =>
        sortSidebarSessions(
          current.map((item) =>
            item.id === session.id
              ? {
                  ...item,
                  updated_at: nextUpdatedAt,
                  archived_at: archived ? nextUpdatedAt : null,
                }
              : item,
          ),
        ),
      );

      try {
        await updateAgentRuntimeSession({
          session_id: session.id,
          archived,
        });
        await refreshSidebarSessions();
      } catch (error) {
        console.error(archived ? "归档会话失败:" : "恢复会话失败:", error);
        await refreshSidebarSessions();
      } finally {
        setSidebarSessionActionId((current) =>
          current === session.id ? null : current,
        );
      }
    },
    [refreshSidebarSessions],
  );

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
          <MainNavList data-testid="app-sidebar-main-nav">
            {filteredMainNavItems.map((item) => renderNavItem(item))}
          </MainNavList>

          {shouldShowConversationList ? (
            <ConversationShelf data-testid="app-sidebar-conversation-shelf">
              <ConversationSection>
                <ConversationSectionHeader>
                  <ConversationSectionTitle
                    type="button"
                    onClick={() => setRecentSessionsCollapsed((value) => !value)}
                    aria-expanded={!recentSessionsCollapsed}
                  >
                    <ChevronDown
                      className={recentSessionsCollapsed ? "-rotate-90" : ""}
                    />
                    最近对话
                  </ConversationSectionTitle>
                  <ConversationActionButton
                    type="button"
                    onClick={handleNavigateToNewTask}
                    aria-label="新建对话"
                    title="新建对话"
                  >
                    <MessageSquarePlus />
                  </ConversationActionButton>
                </ConversationSectionHeader>
                {!recentSessionsCollapsed ? (
                  <ConversationList data-testid="app-sidebar-recent-conversations">
                    {shouldShowSessionLoadingState ? (
                      <ConversationEmptyState>
                        <Clock3 size={14} />
                        正在加载对话
                      </ConversationEmptyState>
                    ) : recentSidebarSessions.length > 0 ? (
                      recentSidebarSessions.map((session) => {
                        const isCurrentConversation = currentSessionId === session.id;
                        return (
                          <ConversationItemRow
                            key={session.id}
                            $active={isCurrentConversation}
                            data-active={isCurrentConversation ? "true" : "false"}
                          >
                            <ConversationItemButton
                              type="button"
                              $active={isCurrentConversation}
                              aria-current={
                                isCurrentConversation ? "page" : undefined
                              }
                              onClick={() =>
                                handleNavigateToConversation(session)
                              }
                              title={resolveSidebarSessionTitle(session)}
                            >
                              <ConversationItemDot $active={isCurrentConversation} />
                              <ConversationItemLabel>
                                {resolveSidebarSessionTitle(session)}
                              </ConversationItemLabel>
                              <ConversationItemMeta>
                                {formatSidebarSessionMeta(session)}
                              </ConversationItemMeta>
                            </ConversationItemButton>
                            <ConversationItemActionButton
                              type="button"
                              aria-label={`归档 ${resolveSidebarSessionTitle(session)}`}
                              title="归档对话"
                              disabled={sidebarSessionActionId === session.id}
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleToggleSessionArchive(session, true);
                              }}
                            >
                              <Archive />
                            </ConversationItemActionButton>
                          </ConversationItemRow>
                        );
                      })
                    ) : (
                      <ConversationEmptyState>
                        <Clock3 size={14} />
                        还没有开始对话
                      </ConversationEmptyState>
                    )}
                  </ConversationList>
                ) : null}
              </ConversationSection>

              <ConversationSection>
                <ConversationSectionHeader>
                  <ConversationSectionTitle
                    type="button"
                    onClick={() => setArchivedSessionsCollapsed((value) => !value)}
                    aria-expanded={!archivedSessionsCollapsed}
                  >
                    <ChevronDown
                      className={archivedSessionsCollapsed ? "-rotate-90" : ""}
                    />
                    归档
                  </ConversationSectionTitle>
                </ConversationSectionHeader>
                {!archivedSessionsCollapsed ? (
                  <ConversationList data-testid="app-sidebar-archived-conversations">
                    {shouldShowSessionLoadingState ? null : archivedSidebarSessions.length >
                      0 ? (
                      archivedSidebarSessions.map((session) => (
                        <ConversationItemRow
                          key={session.id}
                          $active={currentSessionId === session.id}
                          data-active={
                            currentSessionId === session.id ? "true" : "false"
                          }
                        >
                          <ConversationItemButton
                            type="button"
                            $active={currentSessionId === session.id}
                            aria-current={
                              currentSessionId === session.id ? "page" : undefined
                            }
                            onClick={() => handleNavigateToConversation(session)}
                            title={resolveSidebarSessionTitle(session)}
                          >
                            <ConversationItemDot
                              $active={currentSessionId === session.id}
                            />
                            <ConversationItemLabel>
                              {resolveSidebarSessionTitle(session)}
                            </ConversationItemLabel>
                            <ConversationItemMeta>
                              {formatSidebarSessionMeta(session)}
                            </ConversationItemMeta>
                          </ConversationItemButton>
                          <ConversationItemActionButton
                            type="button"
                            aria-label={`恢复 ${resolveSidebarSessionTitle(session)}`}
                            title="恢复对话"
                            disabled={sidebarSessionActionId === session.id}
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleToggleSessionArchive(session, false);
                            }}
                          >
                            <Undo2 />
                          </ConversationItemActionButton>
                        </ConversationItemRow>
                      ))
                    ) : (
                      <ConversationEmptyState>
                        <Clock3 size={14} />
                        暂无归档内容
                      </ConversationEmptyState>
                    )}
                  </ConversationList>
                ) : null}
              </ConversationSection>
            </ConversationShelf>
          ) : null}

          {shouldShowPluginExtensionsSection && (
            <Section $collapsed={collapsed}>
              <SectionTitle $collapsed={collapsed}>插件扩展</SectionTitle>
              {assistantItems.map((item) => renderNavItem(item))}
            </Section>
          )}

          <FooterArea
            $collapsed={collapsed}
            data-testid="app-sidebar-footer-area"
          >
            <Section $collapsed={collapsed} data-testid="app-sidebar-footer-nav">
              {filteredFooterNavItems.map((item) => renderNavItem(item))}
            </Section>

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
        </MenuScroll>
      </Container>
    </TooltipProvider>
  );
}
