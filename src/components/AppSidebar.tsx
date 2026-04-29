/**
 * 全局应用侧边栏
 *
 * 当前导航收口为一级主入口 + 底部用户菜单。
 * 默认只暴露主线入口；系统入口统一收进左下角用户弹窗。
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
  ChevronRight,
  Check,
  Cloud,
  Copy,
  ExternalLink,
  Gift,
  Info,
  KeyRound,
  Languages,
  LogIn,
  LogOut,
  Monitor,
  Moon,
  Palette,
  RefreshCw,
  Sun,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
  Activity,
  X,
  LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import * as LucideIcons from "lucide-react";
import { getPluginsForSurface, PluginUIInfo } from "@/lib/api/pluginUI";
import { AgentPageParams, Page, PageParams } from "@/types/page";
import { SettingsTabs } from "@/types/settings";
import {
  getConfig,
  saveConfig,
  subscribeAppConfigChanged,
} from "@/lib/api/appConfig";
import {
  buildClawAgentParams,
  buildHomeAgentParams,
} from "@/lib/workspace/navigation";
import {
  listAgentRuntimeSessions,
  updateAgentRuntimeSession,
  type AsterSessionInfo,
} from "@/lib/api/agentRuntime";
import { isAuxiliaryAgentSessionId } from "@/lib/api/agentRuntime/sessionIdentity";
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
import { Modal } from "@/components/Modal";
import { hasTauriInvokeCapability } from "@/lib/tauri-runtime";
import { LIME_BRAND_LOGO_SRC, LIME_BRAND_NAME } from "@/lib/branding";
import { scheduleMinimumDelayIdleTask } from "@/lib/utils/scheduleMinimumDelayIdleTask";
import { AppSidebarConversationShelf } from "@/components/app-sidebar/AppSidebarConversationShelf";
import { shouldReserveMacWindowControls } from "@/lib/windowControls";
import {
  clearStoredOemCloudSessionState,
  clearOemCloudBootstrapSnapshot,
  getOemCloudBootstrapSnapshot,
  getStoredOemCloudSessionState,
  subscribeOemCloudBootstrapChanged,
  subscribeOemCloudSessionChanged,
  type OemCloudStoredSessionState,
} from "@/lib/oemCloudSession";
import { clearSkillCatalogCache } from "@/lib/api/skillCatalog";
import { clearServiceSkillCatalogCache } from "@/lib/api/serviceSkills";
import {
  getClientReferralDashboard,
  logoutClient,
  type OemCloudBootstrapResponse,
  type OemCloudReferralDashboard,
} from "@/lib/api/oemCloudControlPlane";
import { clearSiteAdapterCatalogCache } from "@/lib/siteAdapterCatalogBootstrap";
import {
  createExternalBrowserOpenTarget,
  startOemCloudLogin,
} from "@/lib/oemCloudLoginLauncher";
import {
  cacheOemCloudReferralDashboard,
  readCachedOemCloudReferralState,
  type OemCloudReferralCachedState,
} from "@/lib/oemCloudReferralCache";
import {
  LAST_PROJECT_ID_KEY,
  loadPersistedProjectId,
  PERSISTED_PROJECT_ID_CHANGED_EVENT,
} from "@/components/agent/chat/hooks/agentProjectStorage";
import {
  LIME_COLOR_SCHEME_CHANGED_EVENT,
  LIME_COLOR_SCHEMES,
  LIME_COLOR_SCHEME_STORAGE_KEY,
  applyLimeColorScheme,
  getLimeColorScheme,
  loadLimeColorSchemeId,
  persistLimeColorScheme,
  type LimeColorSchemeChangedEventDetail,
  type LimeColorSchemeId,
} from "@/lib/appearance/colorSchemes";
import {
  LIME_THEME_CHANGED_EVENT,
  LIME_THEME_MODE_OPTIONS,
  LIME_THEME_STORAGE_KEY,
  applyLimeThemeMode,
  getEffectiveLimeThemeMode,
  loadLimeThemeMode,
  persistLimeThemeMode,
  type LimeEffectiveThemeMode,
  type LimeThemeChangedEventDetail,
  type LimeThemeMode,
} from "@/lib/appearance/themeMode";
import { useI18nPatch } from "@/i18n/I18nPatchProvider";
import type { Language } from "@/i18n/text-map";

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
const SIDEBAR_RECENT_SESSION_PAGE_SIZE = 10;
const SIDEBAR_RECENT_SESSION_PREFETCH_LIMIT = 37;
const SIDEBAR_ARCHIVED_SESSION_PAGE_SIZE = 8;
const SIDEBAR_SESSION_ENTRY_REFRESH_DEFER_MS = 12_000;

const APP_SIDEBAR_LANGUAGE_OPTIONS: Array<{
  id: Language;
  label: string;
  hint: string;
}> = [
  {
    id: "zh",
    label: "中文",
    hint: "中文界面",
  },
  {
    id: "en",
    label: "English",
    hint: "English UI",
  },
];

function buildSidebarSessionRequestLimit(
  visibleCount: number,
  pageSize: number,
): number {
  const normalizedVisibleCount = Math.max(visibleCount, pageSize);
  return normalizedVisibleCount + pageSize + 1;
}

function splitSidebarSessionResult(params: {
  sessions: AsterSessionInfo[];
  visibleCount: number;
  pageSize: number;
}): {
  sessions: AsterSessionInfo[];
  hasMore: boolean;
} {
  const { sessions, visibleCount, pageSize } = params;
  const targetCount = Math.max(visibleCount, pageSize) + pageSize;
  return {
    sessions: sessions.slice(0, targetCount),
    hasMore: sessions.length > targetCount,
  };
}

function scheduleSidebarPluginLoad(task: () => void): () => void {
  const minimumDelayMs = hasTauriInvokeCapability()
    ? SIDEBAR_PLUGIN_IDLE_TIMEOUT_MS
    : SIDEBAR_PLUGIN_BROWSER_IDLE_TIMEOUT_MS;

  return scheduleMinimumDelayIdleTask(task, {
    minimumDelayMs,
    idleTimeoutMs: SIDEBAR_PLUGIN_IDLE_TIMEOUT_MS,
  });
}

function hasCachedSidebarSessionEntry(
  sessions: AsterSessionInfo[],
  sessionId?: string | null,
): boolean {
  const normalizedSessionId = sessionId?.trim();
  if (!normalizedSessionId) {
    return false;
  }

  return sessions.some((session) => session.id === normalizedSessionId);
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

  const rawParams = item.resolveParams
    ? item.resolveParams(item.params)
    : item.params;

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
    target.page === page &&
    target.paramsKey === serializeNavigationParams(params)
  );
}

const Container = styled.aside<{
  $collapsed?: boolean;
  $themeMode: "light" | "dark";
  $reserveWindowControls?: boolean;
}>`
  --sidebar-window-control-safe-top: ${({ $reserveWindowControls }) =>
    $reserveWindowControls ? "34px" : "0px"};
  --sidebar-surface-top: ${({ $themeMode }) =>
    $themeMode === "dark"
      ? "#15202b"
      : "var(--lime-sidebar-surface-top, #f6fbf4)"};
  --sidebar-surface-middle: ${({ $themeMode }) =>
    $themeMode === "dark"
      ? "#17232d"
      : "var(--lime-sidebar-surface-middle, #f9fcf6)"};
  --sidebar-surface-bottom: ${({ $themeMode }) =>
    $themeMode === "dark"
      ? "#1a2530"
      : "var(--lime-sidebar-surface-bottom, #fbfff5)"};
  --sidebar-surface: ${({ $themeMode }) =>
    $themeMode === "dark"
      ? "linear-gradient(180deg, #15202b 0%, #17232d 48%, #1a2530 100%)"
      : "var(--lime-sidebar-surface, linear-gradient(180deg, var(--sidebar-surface-top) 0%, var(--sidebar-surface-middle) 46%, var(--sidebar-surface-bottom) 100%))"};
  --sidebar-foreground: ${({ $themeMode }) =>
    $themeMode === "dark" ? "#eef4f7" : "var(--lime-text, #1a3b2b)"};
  --sidebar-muted: ${({ $themeMode }) =>
    $themeMode === "dark" ? "#a1afbd" : "var(--lime-text-muted, #6b826b)"};
  --sidebar-border: ${({ $themeMode }) =>
    $themeMode === "dark" ? "#2d3a46" : "var(--lime-sidebar-border, #e2f0e2)"};
  --sidebar-card-border: ${({ $themeMode }) =>
    $themeMode === "dark"
      ? "rgba(55, 68, 81, 0.76)"
      : "var(--lime-sidebar-card-border, var(--lime-sidebar-border, #e2f0e2))"};
  --sidebar-divider: ${({ $themeMode }) =>
    $themeMode === "dark"
      ? "rgba(148, 163, 184, 0.14)"
      : "var(--lime-sidebar-divider, rgba(132, 204, 22, 0.15))"};
  --sidebar-hover: ${({ $themeMode }) =>
    $themeMode === "dark" ? "#22303c" : "var(--lime-sidebar-hover, #eef7ee)"};
  --sidebar-active: ${({ $themeMode }) =>
    $themeMode === "dark" ? "#2a3e3b" : "var(--lime-sidebar-active, #e6f8ea)"};
  --sidebar-active-foreground: ${({ $themeMode }) =>
    $themeMode === "dark"
      ? "#dff4ea"
      : "var(--lime-sidebar-active-text, #166534)"};
  --sidebar-search-bg: ${({ $themeMode }) =>
    $themeMode === "dark"
      ? "#1f2b36"
      : "var(--lime-sidebar-search-bg, #fcfff9)"};
  --sidebar-search-hover: ${({ $themeMode }) =>
    $themeMode === "dark"
      ? "#24313d"
      : "var(--lime-sidebar-search-hover, #f4fdf4)"};
  --sidebar-search-border-hover: ${({ $themeMode }) =>
    $themeMode === "dark"
      ? "#3a4a57"
      : "var(--lime-sidebar-search-border-hover, #bbf7d0)"};
  --sidebar-card-surface: ${({ $themeMode }) =>
    $themeMode === "dark"
      ? "linear-gradient(180deg, rgba(24, 34, 44, 0.96) 0%, rgba(19, 29, 38, 0.98) 100%)"
      : "var(--lime-sidebar-card-surface, linear-gradient(180deg, rgba(255, 255, 255, 0.76) 0%, rgba(249, 252, 246, 0.94) 100%))"};
  --sidebar-card-shadow: ${({ $themeMode }) =>
    $themeMode === "dark"
      ? "0 18px 34px -28px rgba(2, 8, 23, 0.7)"
      : "var(--lime-sidebar-card-shadow, 0 14px 28px -26px rgba(15, 23, 42, 0.32))"};
  --sidebar-card-highlight: ${({ $themeMode }) =>
    $themeMode === "dark"
      ? "rgba(255, 255, 255, 0.08)"
      : "var(--lime-sidebar-card-highlight, rgba(255, 255, 255, 0.72))"};
  display: flex;
  flex-direction: column;
  width: ${({ $collapsed }) => ($collapsed ? "72px" : "272px")};
  min-width: ${({ $collapsed }) => ($collapsed ? "72px" : "272px")};
  height: 100vh;
  padding: ${({ $collapsed }) =>
    $collapsed
      ? "calc(12px + var(--sidebar-window-control-safe-top)) 6px 12px"
      : "calc(14px + var(--sidebar-window-control-safe-top)) 14px 12px"};
  position: relative;
  isolation: isolate;
  z-index: 30;
  background: var(--sidebar-surface);
  border-right: 1px solid var(--sidebar-border);
  box-shadow: 10px 0 26px -28px rgba(15, 23, 42, 0.38);
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
        var(--lime-sidebar-glow-primary, rgba(132, 204, 22, 0.14)) 0%,
        transparent 54%
      ),
      radial-gradient(
        circle at 18% 18%,
        var(--lime-sidebar-glow-secondary, rgba(16, 185, 129, 0.12)) 0%,
        transparent 42%
      ),
      radial-gradient(
        circle at bottom left,
        var(--lime-sidebar-glow-tertiary, rgba(186, 230, 253, 0.12)) 0%,
        transparent 46%
      );
    opacity: 0.82;
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
  width: ${({ $collapsed }) => ($collapsed ? "38px" : "100%")};
  min-width: 0;
  flex: ${({ $collapsed }) => ($collapsed ? "0 0 auto" : "1 1 auto")};
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
  border: 1px solid var(--sidebar-card-border);
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
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.56);

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
  position: relative;
  background: ${({ $active }) =>
    $active ? "var(--sidebar-active)" : "transparent"};
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
    $active ? "inset 0 1px 0 rgba(255, 255, 255, 0.48)" : "none"};

  &::before {
    content: "";
    position: absolute;
    left: ${({ $collapsed }) => ($collapsed ? "8px" : "7px")};
    top: 50%;
    width: 3px;
    height: ${({ $active }) => ($active ? "18px" : "0")};
    border-radius: 999px;
    background: var(--sidebar-active-foreground);
    opacity: ${({ $active }) => ($active ? 0.72 : 0)};
    transform: translateY(-50%);
    transition:
      height 0.18s ease,
      opacity 0.18s ease;
  }

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

const AppearanceActionSlot = styled.div<{ $collapsed?: boolean }>`
  position: relative;
  display: inline-flex;
  justify-content: ${({ $collapsed }) => ($collapsed ? "center" : "flex-end")};
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

const HeaderInviteButton = styled.button<{
  $collapsed?: boolean;
  $active?: boolean;
}>`
  height: 30px;
  min-width: ${({ $collapsed }) => ($collapsed ? "30px" : "88px")};
  border: none;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: ${({ $collapsed }) => ($collapsed ? "0" : "6px")};
  padding: ${({ $collapsed }) => ($collapsed ? "0" : "0 9px")};
  background: ${({ $active }) =>
    $active ? "var(--sidebar-hover)" : "transparent"};
  color: ${({ $active }) =>
    $active ? "var(--sidebar-foreground)" : "var(--sidebar-muted)"};
  opacity: ${({ $active }) => ($active ? 0.86 : 0.68)};
  cursor: pointer;
  flex: 0 0 auto;
  transition:
    background-color 0.18s ease,
    color 0.18s ease,
    opacity 0.18s ease;

  &:hover {
    background: var(--sidebar-hover);
    color: var(--sidebar-foreground);
    opacity: 0.86;
  }

  svg {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
  }

  span {
    display: ${({ $collapsed }) => ($collapsed ? "none" : "inline")};
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
  }
`;

const InviteDialogSurface = styled.div`
  --invite-surface: var(--lime-surface, #ffffff);
  --invite-surface-soft: var(--lime-surface-soft, #f8fcf9);
  --invite-surface-muted: var(--lime-surface-muted, #f2f7f3);
  --invite-surface-hover: var(--lime-surface-hover, #f4fdf4);
  --invite-border: var(--lime-surface-border, #e2f0e2);
  --invite-border-strong: var(--lime-surface-border-strong, #c7e7d1);
  --invite-text: var(--lime-text, #1a3b2b);
  --invite-text-strong: var(--lime-text-strong, #0f172a);
  --invite-text-muted: var(--lime-text-muted, #6b826b);
  --invite-brand: var(--lime-brand, #10b981);
  --invite-brand-strong: var(--lime-brand-strong, #166534);
  --invite-brand-soft: var(--lime-brand-soft, #ecfdf5);
  position: relative;
  background: var(--invite-surface);
  color: var(--invite-text);
`;

const InviteDialogCloseButton = styled.button`
  position: absolute;
  top: 14px;
  right: 14px;
  z-index: 2;
  width: 30px;
  height: 30px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: color-mix(in srgb, var(--invite-surface) 84%, transparent);
  color: var(--invite-text-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition:
    background-color 0.18s ease,
    border-color 0.18s ease,
    color 0.18s ease;

  &:hover {
    border-color: var(--invite-border);
    background: var(--invite-surface-hover);
    color: var(--invite-text-strong);
  }

  svg {
    width: 15px;
    height: 15px;
  }
`;

const InviteDialogHeader = styled.div`
  display: grid;
  gap: 8px;
  padding: 24px 24px 18px;
  border-bottom: 1px solid var(--invite-border);
  background:
    radial-gradient(
      circle at 18% 0%,
      color-mix(in srgb, var(--invite-brand) 12%, transparent),
      transparent 34%
    ),
    linear-gradient(
      135deg,
      var(--invite-surface-soft) 0%,
      var(--invite-surface) 58%,
      var(--invite-surface-muted) 100%
    );
`;

const InviteDialogEyebrow = styled.span`
  width: fit-content;
  border-radius: 999px;
  border: 1px solid var(--invite-border-strong);
  background: var(--invite-brand-soft);
  color: var(--invite-brand-strong);
  padding: 4px 9px;
  font-size: 12px;
  font-weight: 700;
`;

const InviteDialogTitle = styled.h2`
  margin: 0;
  color: var(--invite-text-strong);
  font-size: 22px;
  line-height: 1.25;
  font-weight: 800;
`;

const InviteDialogDescription = styled.p`
  margin: 0;
  color: var(--invite-text-muted);
  font-size: 13px;
  line-height: 1.7;
`;

const InviteDialogBody = styled.div`
  display: grid;
  gap: 14px;
  padding: 18px 24px 22px;
`;

const InviteStatusCard = styled.div<{ $tone?: "error" | "muted" }>`
  border-radius: 16px;
  border: 1px solid
    ${({ $tone }) =>
      $tone === "error"
        ? "var(--lime-danger-border, #fecdd3)"
        : "var(--invite-border)"};
  background: ${({ $tone }) =>
    $tone === "error"
      ? "var(--lime-danger-soft, #fff1f2)"
      : "var(--invite-surface-soft)"};
  color: ${({ $tone }) =>
    $tone === "error" ? "var(--lime-danger, #be123c)" : "var(--invite-text)"};
  padding: 14px 15px;
  font-size: 13px;
  line-height: 1.6;
`;

const InviteShareCard = styled.div`
  display: grid;
  gap: 14px;
  border-radius: 18px;
  border: 1px solid var(--lime-card-subtle-border, var(--invite-border));
  background: var(--invite-surface);
  padding: 16px;
  box-shadow: var(
    --lime-sidebar-card-shadow,
    0 18px 36px -32px rgba(15, 23, 42, 0.32)
  );
`;

const InviteCodeBlock = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-radius: 16px;
  border: 1px dashed
    color-mix(in srgb, var(--invite-brand) 42%, var(--invite-border));
  background: color-mix(
    in srgb,
    var(--invite-brand-soft) 64%,
    var(--invite-surface) 36%
  );
  padding: 14px;
`;

const InviteCodeMeta = styled.span`
  display: grid;
  gap: 4px;
  min-width: 0;
`;

const InviteCodeLabel = styled.span`
  color: var(--invite-text-muted);
  font-size: 12px;
  font-weight: 700;
`;

const InviteCodeValue = styled.strong`
  color: var(--invite-text-strong);
  font-size: 24px;
  letter-spacing: 0.02em;
  line-height: 1.1;
  word-break: break-all;
`;

const InviteMetaGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;

  @media (max-width: 560px) {
    grid-template-columns: 1fr;
  }
`;

const InviteMetaItem = styled.div`
  display: grid;
  gap: 5px;
  border-radius: 14px;
  background: var(--invite-surface-soft);
  padding: 12px;
  min-width: 0;

  span {
    color: var(--invite-text-muted);
    font-size: 12px;
    font-weight: 700;
  }

  strong {
    color: var(--invite-text-strong);
    font-size: 14px;
    font-weight: 800;
    word-break: break-word;
  }
`;

const InviteActionBar = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
`;

const InviteDialogActionButton = styled.button<{ $primary?: boolean }>`
  min-height: 38px;
  border-radius: 12px;
  border: 1px solid
    ${({ $primary }) =>
      $primary ? "var(--invite-brand-strong)" : "var(--invite-border-strong)"};
  background: ${({ $primary }) =>
    $primary ? "var(--invite-brand-strong)" : "var(--invite-surface)"};
  color: ${({ $primary }) =>
    $primary ? "var(--lime-surface, #ffffff)" : "var(--invite-text)"};
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 0 13px;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  transition:
    background-color 0.18s ease,
    border-color 0.18s ease,
    color 0.18s ease,
    transform 0.18s ease;

  &:hover {
    transform: translateY(-1px);
    background: ${({ $primary }) =>
      $primary
        ? "var(--invite-brand)"
        : "var(--invite-surface-hover, var(--lime-surface-hover, #f4fdf4))"};
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.58;
    transform: none;
  }

  svg {
    width: 15px;
    height: 15px;
  }
`;

const AppearancePopover = styled.div`
  position: absolute;
  left: calc(100% + 12px);
  bottom: -2px;
  z-index: 70;
  width: 228px;
  max-width: min(228px, calc(100vw - 24px));
  border-radius: 18px;
  border: 1px solid var(--lime-card-subtle-border, rgba(226, 240, 226, 0.92));
  background: var(--lime-card-subtle, var(--lime-surface, #ffffff));
  box-shadow:
    0 20px 40px -32px rgba(15, 23, 42, 0.32),
    inset 0 1px 0 rgba(255, 255, 255, 0.72);
  color: var(--lime-text, #1a3b2b);
  padding: 9px;
  transform-origin: left bottom;
  animation: appearancePopoverIn 150ms ease-out both;

  &::after {
    content: "";
    position: absolute;
    left: -5px;
    bottom: 15px;
    border-left: 1px solid var(--lime-surface-border, rgba(226, 240, 226, 0.92));
    border-bottom: 1px solid
      var(--lime-surface-border, rgba(226, 240, 226, 0.92));
    width: 10px;
    height: 10px;
    transform: rotate(45deg);
    background: var(--lime-card-subtle, var(--lime-surface, #ffffff));
  }

  @keyframes appearancePopoverIn {
    from {
      opacity: 0;
      transform: translateY(6px) scale(0.98);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @media (max-width: 760px) {
    left: auto;
    right: 0;
    bottom: calc(100% + 10px);
    transform-origin: right bottom;

    &::after {
      left: auto;
      right: 13px;
      bottom: -5px;
      border-left: none;
      border-right: 1px solid
        var(--lime-surface-border, rgba(226, 240, 226, 0.92));
    }
  }
`;

const AppearancePopoverHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 2px 2px 8px;
`;

const AppearancePopoverTitle = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 700;
  color: var(--lime-text-strong, #0f172a);

  svg {
    width: 15px;
    height: 15px;
    color: var(--lime-brand-strong, #166534);
  }
`;

const AppearancePopoverSummary = styled.div`
  max-width: 132px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 600;
  color: var(--lime-text-muted, #6b826b);
`;

const AppearanceGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 7px 0;
  border-top: 1px solid var(--lime-divider-subtle, rgba(226, 240, 226, 0.82));
`;

const AppearanceGroupLabel = styled.div`
  padding: 0 2px;
  font-size: 11px;
  font-weight: 700;
  color: var(--lime-text-muted, #6b826b);
`;

const ThemeModeGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
`;

const ThemeModeButton = styled.button<{ $active?: boolean }>`
  min-width: 0;
  border-radius: 13px;
  border: 1px solid
    ${({ $active }) =>
      $active
        ? "var(--lime-card-subtle-border, #bbf7d0)"
        : "var(--lime-card-subtle-border, rgba(226, 240, 226, 0.82))"};
  background: ${({ $active }) =>
    $active
      ? "var(--lime-chrome-tab-active-surface, var(--lime-surface, #ffffff))"
      : "var(--lime-surface, #ffffff)"};
  color: ${({ $active }) =>
    $active
      ? "var(--lime-text-strong, #0f172a)"
      : "var(--lime-text-muted, #6b826b)"};
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 7px 6px;
  font-size: 11px;
  font-weight: 700;
  box-shadow: ${({ $active }) =>
    $active ? "0 10px 22px -20px var(--lime-shadow-color)" : "none"};
  transition:
    border-color 0.16s ease,
    background 0.16s ease,
    color 0.16s ease,
    transform 0.16s ease;

  &:hover {
    border-color: var(--lime-card-subtle-border, #bbf7d0);
    background: var(
      --lime-chrome-tab-hover,
      var(--lime-surface-hover, #f4fdf4)
    );
    color: var(--lime-text-strong, #0f172a);
  }

  svg {
    width: 13px;
    height: 13px;
    flex-shrink: 0;
  }
`;

const ColorSchemeList = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
`;

const ColorSchemeButton = styled.button<{ $active?: boolean }>`
  display: flex;
  position: relative;
  min-height: 58px;
  flex-direction: column;
  align-items: flex-start;
  justify-content: space-between;
  gap: 5px;
  width: 100%;
  min-width: 0;
  border-radius: 13px;
  border: 1px solid
    ${({ $active }) =>
      $active
        ? "var(--lime-card-subtle-border, #bbf7d0)"
        : "var(--lime-card-subtle-border, rgba(226, 240, 226, 0.82))"};
  background: ${({ $active }) =>
    $active
      ? "var(--lime-chrome-tab-active-surface, var(--lime-surface, #ffffff))"
      : "var(--lime-surface, #ffffff)"};
  color: var(--lime-text, #1a3b2b);
  cursor: pointer;
  padding: 7px;
  text-align: left;
  transition:
    border-color 0.16s ease,
    background 0.16s ease,
    color 0.16s ease,
    transform 0.16s ease;

  &:hover {
    border-color: var(--lime-card-subtle-border, #bbf7d0);
    background: var(
      --lime-chrome-tab-hover,
      var(--lime-surface-hover, #f4fdf4)
    );
  }
`;

const ColorSchemeSwatches = styled.span`
  display: inline-flex;
  flex-shrink: 0;
  overflow: hidden;
  width: 42px;
  height: 14px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.72);
  box-shadow: 0 0 0 1px var(--lime-surface-border, rgba(226, 240, 226, 0.82));

  span {
    flex: 1;
  }
`;

const ColorSchemeText = styled.span`
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
`;

const ColorSchemeLabel = styled.span`
  min-width: 0;
  max-width: calc(100% - 22px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 700;
  color: var(--lime-text-strong, #0f172a);
`;

const ColorSchemeCheck = styled.span<{ $active?: boolean }>`
  display: inline-flex;
  position: absolute;
  right: 7px;
  bottom: 7px;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  color: var(--lime-brand-strong, #166534);
  opacity: ${({ $active }) => ($active ? 1 : 0)};

  svg {
    width: 13px;
    height: 13px;
  }
`;

const AccountActionSlot = styled.div<{ $collapsed?: boolean }>`
  position: relative;
  margin-top: 4px;
  display: flex;
  justify-content: ${({ $collapsed }) => ($collapsed ? "center" : "stretch")};
`;

const AccountButton = styled.button<{
  $collapsed?: boolean;
  $active?: boolean;
}>`
  width: 100%;
  min-height: ${({ $collapsed }) => ($collapsed ? "38px" : "42px")};
  border: none;
  border-radius: 15px;
  background: ${({ $active }) =>
    $active ? "var(--sidebar-active)" : "transparent"};
  color: var(--sidebar-foreground);
  display: flex;
  align-items: center;
  justify-content: ${({ $collapsed }) =>
    $collapsed ? "center" : "space-between"};
  gap: 8px;
  padding: ${({ $collapsed }) => ($collapsed ? "0" : "5px 8px")};
  cursor: pointer;
  transition:
    background-color 0.18s ease,
    color 0.18s ease;

  &:hover {
    background: var(--sidebar-hover);
  }
`;

const AccountIdentity = styled.span<{ $collapsed?: boolean }>`
  min-width: 0;
  display: ${({ $collapsed }) => ($collapsed ? "none" : "inline-flex")};
  align-items: center;
  gap: 9px;
`;

const AccountAvatar = styled.span`
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--lime-brand, #10b981);
  color: white;
  font-size: 13px;
  font-weight: 800;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.24);
  overflow: hidden;

  img {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: cover;
  }
`;

const AccountName = styled.span`
  min-width: 0;
  max-width: 116px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 700;
  text-align: left;
`;

const AccountTrailing = styled.span<{ $collapsed?: boolean }>`
  display: ${({ $collapsed }) => ($collapsed ? "none" : "inline-flex")};
  align-items: center;
  gap: 7px;
  color: var(--sidebar-muted);

  svg {
    width: 15px;
    height: 15px;
  }
`;

const AccountStateBadge = styled.span<{ $connected?: boolean }>`
  border-radius: 999px;
  padding: 4px 9px;
  border: 1px solid
    ${({ $connected }) =>
      $connected
        ? "var(--lime-brand-soft-border, #bbf7d0)"
        : "var(--lime-card-subtle-border, #d9eadf)"};
  background: ${({ $connected }) =>
    $connected
      ? "var(--lime-brand-soft, #ecfdf5)"
      : "var(--lime-surface-soft, #f8fcf9)"};
  color: ${({ $connected }) =>
    $connected
      ? "var(--lime-brand-strong, #166534)"
      : "var(--lime-text-muted, #6b826b)"};
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
`;

const AccountMenuPopover = styled.div<{ $collapsed?: boolean }>`
  position: absolute;
  left: ${({ $collapsed }) => ($collapsed ? "calc(100% + 12px)" : "0")};
  bottom: ${({ $collapsed }) => ($collapsed ? "0" : "calc(100% + 12px)")};
  z-index: 80;
  width: ${({ $collapsed }) => ($collapsed ? "284px" : "304px")};
  max-width: min(304px, calc(100vw - 24px));
  border-radius: 18px;
  border: 1px solid var(--lime-card-subtle-border, rgba(226, 240, 226, 0.92));
  background: var(--lime-card-subtle, var(--lime-surface, #ffffff));
  box-shadow:
    0 24px 52px -32px rgba(15, 23, 42, 0.36),
    inset 0 1px 0 rgba(255, 255, 255, 0.72);
  color: var(--lime-text, #1a3b2b);
  padding: 10px;
  transform-origin: ${({ $collapsed }) =>
    $collapsed ? "left bottom" : "left bottom"};
  animation: accountMenuPopoverIn 150ms ease-out both;

  @keyframes accountMenuPopoverIn {
    from {
      opacity: 0;
      transform: translateY(6px) scale(0.98);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }
`;

const AccountPlanCard = styled.div`
  width: 100%;
  border: 1px solid var(--lime-card-subtle-border, rgba(226, 240, 226, 0.92));
  border-radius: 14px;
  background: var(--lime-surface, #ffffff);
  color: var(--lime-text, #1a3b2b);
  padding: 10px 11px;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const AccountPlanButton = styled.button`
  width: 100%;
  border: 1px solid var(--lime-card-subtle-border, rgba(226, 240, 226, 0.92));
  border-radius: 14px;
  background: var(--lime-surface, #ffffff);
  color: var(--lime-text, #1a3b2b);
  padding: 10px 11px;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 8px;
  cursor: pointer;
  transition:
    border-color 0.16s ease,
    background-color 0.16s ease,
    transform 0.16s ease;

  &:hover {
    border-color: var(--lime-brand-soft-border, #bbf7d0);
    background: var(--lime-surface-soft, #f8fcf9);
    transform: translateY(-1px);
  }
`;

const AccountPlanActions = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  gap: 8px;
`;

const AccountPlanActionButton = styled.button<{ $primary?: boolean }>`
  min-height: 36px;
  border-radius: 12px;
  border: 1px solid
    ${({ $primary }) =>
      $primary
        ? "var(--lime-brand-strong, #166534)"
        : "var(--lime-card-subtle-border, #d9eadf)"};
  background: ${({ $primary }) =>
    $primary ? "var(--lime-brand-strong, #166534)" : "var(--lime-surface)"};
  color: ${({ $primary }) =>
    $primary ? "#ffffff" : "var(--lime-text, #1a3b2b)"};
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 800;
  transition:
    background-color 0.16s ease,
    border-color 0.16s ease,
    transform 0.16s ease;

  &:hover {
    transform: translateY(-1px);
    background: ${({ $primary }) =>
      $primary
        ? "var(--lime-brand, #10b981)"
        : "var(--lime-surface-hover, #f4fdf4)"};
  }

  &:disabled {
    cursor: progress;
    opacity: 0.66;
    transform: none;
  }

  svg {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
  }
`;

const AccountMenuNotice = styled.div<{ $tone?: "error" | "info" }>`
  border-radius: 12px;
  border: 1px solid
    ${({ $tone }) =>
      $tone === "error"
        ? "var(--lime-danger-border, #fecdd3)"
        : "var(--lime-card-subtle-border, #d9eadf)"};
  background: ${({ $tone }) =>
    $tone === "error" ? "var(--lime-danger-soft, #fff1f2)" : "#f8fcf9"};
  color: ${({ $tone }) =>
    $tone === "error" ? "var(--lime-danger, #be123c)" : "#526455"};
  padding: 8px 10px;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.45;
`;

const AccountPlanHeader = styled.span`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 14px;
  font-weight: 800;
  color: var(--lime-text-strong, #0f172a);
`;

const AccountPlanTitle = styled.span`
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const AccountPlanDetailsPill = styled.span`
  flex-shrink: 0;
  border-radius: 999px;
  background: var(--lime-surface-soft, #f8fcf9);
  color: var(--lime-text-muted, #6b826b);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 7px;
  font-size: 10px;
  font-weight: 800;

  svg {
    width: 11px;
    height: 11px;
  }
`;

const AccountInfoIconButton = styled.button`
  width: 24px;
  height: 24px;
  border-radius: 999px;
  border: 1px solid var(--lime-card-subtle-border, #d9eadf);
  background: var(--lime-surface, #ffffff);
  color: var(--lime-text-muted, #6b826b);
  cursor: help;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition:
    background-color 0.16s ease,
    border-color 0.16s ease,
    color 0.16s ease;

  &:hover {
    border-color: var(--lime-brand-soft-border, #bbf7d0);
    background: var(--lime-brand-soft, #ecfdf5);
    color: var(--lime-brand-strong, #166534);
  }

  svg {
    width: 13px;
    height: 13px;
  }
`;

const AccountPlanBadge = styled.span<{ $connected?: boolean }>`
  flex-shrink: 0;
  border-radius: 999px;
  border: 1px solid
    ${({ $connected }) =>
      $connected
        ? "var(--lime-brand-soft-border, #bbf7d0)"
        : "var(--lime-card-subtle-border, #d9eadf)"};
  background: ${({ $connected }) =>
    $connected ? "var(--lime-brand-soft, #ecfdf5)" : "var(--lime-surface)"};
  color: ${({ $connected }) =>
    $connected
      ? "var(--lime-brand-strong, #166534)"
      : "var(--lime-text-muted, #6b826b)"};
  padding: 4px 8px;
  font-size: 11px;
  font-weight: 800;
`;

const AccountPlanUsage = styled.span`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 750;
  color: var(--lime-text-muted, #6b826b);
`;

const AccountPlanProgressTrack = styled.span`
  display: block;
  width: 100%;
  height: 3px;
  border-radius: 999px;
  background: var(--lime-card-subtle-border, #e5e7eb);
  overflow: hidden;
`;

const AccountPlanProgressFill = styled.span<{ $percent: number | null }>`
  display: block;
  width: ${({ $percent }) => ($percent === null ? "0%" : `${$percent}%`)};
  height: 100%;
  border-radius: inherit;
  background: var(--lime-brand-strong, #166534);
`;

const AccountPlanMeta = styled.span`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 650;
  color: var(--lime-text-muted, #6b826b);
`;

const AccountPlanDetail = styled.span`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
  font-weight: 700;
  color: var(--lime-text-muted, #6b826b);
`;

const AccountMenuList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: 9px;
`;

const AccountMenuItemGroup = styled.div`
  position: relative;
`;

const AccountMenuItem = styled.button<{ $danger?: boolean; $active?: boolean }>`
  width: 100%;
  min-height: 40px;
  border: none;
  border-radius: 13px;
  background: ${({ $active }) =>
    $active ? "var(--sidebar-active)" : "transparent"};
  color: ${({ $danger }) =>
    $danger ? "var(--lime-danger, #ef4444)" : "var(--lime-text, #1a3b2b)"};
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 0 10px;
  font-size: 14px;
  font-weight: 700;
  text-align: left;
  transition:
    background-color 0.16s ease,
    color 0.16s ease;

  &:hover {
    background: ${({ $danger }) =>
      $danger
        ? "var(--lime-danger-soft, #fff1f2)"
        : "var(--lime-surface-hover, #f4fdf4)"};
  }

  &:disabled {
    cursor: progress;
    opacity: 0.62;
  }

  svg {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }
`;

const AccountMenuItemLeading = styled.span`
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 10px;
`;

const AccountMenuItemTrailing = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--lime-text-muted, #6b826b);
  font-size: 12px;
  font-weight: 700;
`;

const AccountSubmenuPopover = styled.div`
  position: absolute;
  left: calc(100% + 8px);
  top: 0;
  z-index: 90;
  width: 188px;
  border-radius: 16px;
  border: 1px solid var(--lime-card-subtle-border, rgba(226, 240, 226, 0.92));
  background: var(--lime-card-subtle, var(--lime-surface, #ffffff));
  box-shadow:
    0 20px 44px -30px rgba(15, 23, 42, 0.34),
    inset 0 1px 0 rgba(255, 255, 255, 0.72);
  color: var(--lime-text, #1a3b2b);
  padding: 7px;
  animation: accountSubmenuPopoverIn 140ms ease-out both;

  @keyframes accountSubmenuPopoverIn {
    from {
      opacity: 0;
      transform: translateX(-4px) scale(0.98);
    }
    to {
      opacity: 1;
      transform: translateX(0) scale(1);
    }
  }

  @media (max-width: 760px) {
    left: 0;
    top: calc(100% + 6px);
  }
`;

const AccountSubmenuTitle = styled.div`
  padding: 5px 8px 7px;
  font-size: 11px;
  font-weight: 800;
  color: var(--lime-text-muted, #6b826b);
`;

const AccountSubmenuItem = styled.button<{ $active?: boolean }>`
  width: 100%;
  min-height: 38px;
  border: none;
  border-radius: 12px;
  background: ${({ $active }) =>
    $active ? "var(--sidebar-active)" : "transparent"};
  color: ${({ $active }) =>
    $active ? "var(--sidebar-active-foreground)" : "var(--lime-text, #1a3b2b)"};
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 9px;
  font-size: 13px;
  font-weight: 750;
  text-align: left;
  transition:
    background-color 0.16s ease,
    color 0.16s ease;

  &:hover {
    background: var(--lime-surface-hover, #f4fdf4);
    color: var(--lime-text-strong, #0f172a);
  }

  svg {
    width: 15px;
    height: 15px;
    flex-shrink: 0;
  }
`;

const AccountSubmenuItemText = styled.span`
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 1px;
`;

const AccountSubmenuItemLabel = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const AccountSubmenuItemHint = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 650;
  color: var(--lime-text-muted, #6b826b);
`;

const AccountMenuDivider = styled.div`
  height: 1px;
  margin: 5px 0;
  background: var(--lime-divider-subtle, rgba(226, 240, 226, 0.82));
`;

function getIconByName(iconName: string): LucideIcon {
  const IconComponent = (
    LucideIcons as unknown as Record<string, LucideIcon | undefined>
  )[iconName];
  return IconComponent || Activity;
}

function sortSidebarSessions(sessions: AsterSessionInfo[]): AsterSessionInfo[] {
  return sessions
    .filter((session) => !isAuxiliaryAgentSessionId(session.id))
    .sort((left, right) => {
      if (left.updated_at !== right.updated_at) {
        return right.updated_at - left.updated_at;
      }

      if (left.created_at !== right.created_at) {
        return right.created_at - left.created_at;
      }

      return left.id.localeCompare(right.id);
    });
}

function buildVisibleSidebarSessions(params: {
  sessions: AsterSessionInfo[];
  currentSessionId?: string | null;
  limit: number;
}): AsterSessionInfo[] {
  const { sessions, currentSessionId, limit } = params;
  if (limit <= 0) {
    return [];
  }

  if (sessions.length <= limit) {
    return sessions;
  }

  const visibleSessions = sessions.slice(0, limit);
  const normalizedCurrentSessionId = currentSessionId?.trim();
  if (
    !normalizedCurrentSessionId ||
    visibleSessions.some((session) => session.id === normalizedCurrentSessionId)
  ) {
    return visibleSessions;
  }

  const currentSession = sessions.find(
    (session) => session.id === normalizedCurrentSessionId,
  );
  if (!currentSession) {
    return visibleSessions;
  }

  return [...visibleSessions.slice(0, Math.max(limit - 1, 0)), currentSession];
}

function resolveAccountDisplayName(
  sessionState: OemCloudStoredSessionState | null,
): string {
  const user = sessionState?.session.user;
  const fallbackEmailName = user?.email?.split("@")[0]?.trim();
  return (
    user?.displayName?.trim() ||
    user?.username?.trim() ||
    fallbackEmailName ||
    "开源使用"
  );
}

function resolveAccountEmail(
  sessionState: OemCloudStoredSessionState | null,
): string | null {
  return sessionState?.session.user.email?.trim() || null;
}

function resolveAccountTenantLabel(
  sessionState: OemCloudStoredSessionState | null,
): string | null {
  const tenant = sessionState?.session.tenant;
  return (
    tenant?.name?.trim() || tenant?.slug?.trim() || tenant?.id?.trim() || null
  );
}

function parseAccountUsagePercent(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const percentMatch = value.match(/(?:已用\s*)?(\d+(?:\.\d+)?)\s*%/);
  if (percentMatch) {
    return Math.min(100, Math.max(0, Number(percentMatch[1])));
  }

  const ratioMatch = value.match(
    /([\d,]+(?:\.\d+)?)\s*\/\s*([\d,]+(?:\.\d+)?)/,
  );
  if (!ratioMatch) {
    return null;
  }

  const used = Number(ratioMatch[1].replace(/,/g, ""));
  const total = Number(ratioMatch[2].replace(/,/g, ""));
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) {
    return null;
  }

  return Math.min(100, Math.max(0, (used / total) * 100));
}

function resolveAccountPlanSummary(
  bootstrap: OemCloudBootstrapResponse | null,
): {
  planLabel: string;
  usageLabel: string | null;
  usagePercent: number | null;
} {
  const preference = bootstrap?.providerPreference;
  if (!preference) {
    return {
      planLabel: "免费版",
      usageLabel: null,
      usagePercent: null,
    };
  }

  const providerOffers = Array.isArray(bootstrap.providerOffersSummary)
    ? bootstrap.providerOffersSummary
    : [];
  const matchedOffer = providerOffers.find(
    (offer) => offer.providerKey === preference.providerKey,
  );
  const usageLabel = matchedOffer?.creditsSummary?.trim() || null;

  return {
    planLabel: matchedOffer?.currentPlan?.trim() || "免费版",
    usageLabel,
    usagePercent: parseAccountUsagePercent(usageLabel ?? undefined),
  };
}

function resolveAccountInitial(name: string): string {
  const normalized = name.trim();
  if (!normalized) {
    return "L";
  }

  return normalized.slice(0, 1).toUpperCase();
}

function resolveCloudBrandLabel(
  bootstrap: OemCloudBootstrapResponse | null,
): string {
  const appName = bootstrap?.app?.name?.trim();
  if (!appName) {
    return "Lime 云端";
  }

  return /云|Cloud|Hub/i.test(appName) ? appName : `${appName} 云端`;
}

function formatReferralCredits(value: number | undefined): string {
  if (typeof value !== "number" || value <= 0) {
    return "按当前策略发放";
  }

  return `${value.toLocaleString("zh-CN")} 积分`;
}

function normalizeSidebarLanguage(language?: string): Language {
  return language === "en" ? "en" : "zh";
}

function resolveSidebarLanguageLabel(language: Language): string {
  return (
    APP_SIDEBAR_LANGUAGE_OPTIONS.find((option) => option.id === language)
      ?.label ?? "中文"
  );
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
  const [rememberedProjectId, setRememberedProjectId] = useState<string | null>(
    () =>
      typeof window === "undefined"
        ? null
        : loadPersistedProjectId(LAST_PROJECT_ID_KEY),
  );
  const currentProjectId =
    activeAgentPageParams?.projectId?.trim() || rememberedProjectId;
  const currentSessionId =
    activeAgentPageParams?.initialSessionId?.trim() || null;
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return (
      window.localStorage.getItem(APP_SIDEBAR_COLLAPSED_STORAGE_KEY) === "true"
    );
  });
  const [themeState, setThemeState] = useState<{
    themeMode: LimeThemeMode;
    effectiveThemeMode: LimeEffectiveThemeMode;
  }>(() => {
    const themeMode =
      typeof window === "undefined" ? "system" : loadLimeThemeMode();
    return {
      themeMode,
      effectiveThemeMode: getEffectiveLimeThemeMode(themeMode),
    };
  });
  const [colorSchemeId, setColorSchemeId] = useState<LimeColorSchemeId>(() =>
    typeof window === "undefined" ? "lime-classic" : loadLimeColorSchemeId(),
  );
  const [appearancePopoverOpen, setAppearancePopoverOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const [language, setLanguageState] = useState<Language>("zh");
  const [cloudSessionState, setCloudSessionState] =
    useState<OemCloudStoredSessionState | null>(() =>
      typeof window === "undefined" ? null : getStoredOemCloudSessionState(),
    );
  const [cloudBootstrapState, setCloudBootstrapState] =
    useState<OemCloudBootstrapResponse | null>(() =>
      typeof window === "undefined"
        ? null
        : getOemCloudBootstrapSnapshot<OemCloudBootstrapResponse>(),
    );
  const [cachedReferralState, setCachedReferralState] =
    useState<OemCloudReferralCachedState | null>(() =>
      typeof window === "undefined" ? null : readCachedOemCloudReferralState(),
    );
  const [accountLogoutPending, setAccountLogoutPending] = useState(false);
  const [accountLoginPending, setAccountLoginPending] = useState(false);
  const [accountLoginError, setAccountLoginError] = useState<string | null>(
    null,
  );
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteDashboard, setInviteDashboard] =
    useState<OemCloudReferralDashboard | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteReloadKey, setInviteReloadKey] = useState(0);
  const { setLanguage: setI18nLanguage } = useI18nPatch();

  const [enabledNavItems, setEnabledNavItems] = useState<string[]>(
    DEFAULT_ENABLED_SIDEBAR_NAV_ITEM_IDS,
  );
  const [sidebarPlugins, setSidebarPlugins] = useState<PluginUIInfo[]>([]);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const sidebarSessionsRef = useRef<AsterSessionInfo[]>([]);
  const archivedSidebarSessionsRef = useRef<AsterSessionInfo[]>([]);
  const [sidebarSessions, setSidebarSessions] = useState<AsterSessionInfo[]>(
    [],
  );
  const [sidebarSessionsHasMore, setSidebarSessionsHasMore] = useState(false);
  const [sidebarSessionsLoading, setSidebarSessionsLoading] = useState(false);
  const [archivedSessionEntries, setArchivedSessionEntries] = useState<
    AsterSessionInfo[]
  >([]);
  const [archivedSessionEntriesHasMore, setArchivedSessionEntriesHasMore] =
    useState(false);
  const [archivedSidebarSessionsLoading, setArchivedSidebarSessionsLoading] =
    useState(false);
  const [sidebarSessionActionId, setSidebarSessionActionId] = useState<
    string | null
  >(null);
  const [recentSessionsVisibleCount, setRecentSessionsVisibleCount] = useState(
    SIDEBAR_RECENT_SESSION_PAGE_SIZE,
  );
  const [archivedSessionsVisibleCount, setArchivedSessionsVisibleCount] =
    useState(SIDEBAR_ARCHIVED_SESSION_PAGE_SIZE);
  const [archivedSessionsCollapsed, setArchivedSessionsCollapsed] =
    useState(true);
  const appearanceControlRef = useRef<HTMLDivElement | null>(null);
  const accountControlRef = useRef<HTMLDivElement | null>(null);
  const reserveWindowControls = shouldReserveMacWindowControls();
  const hasCachedCurrentSessionSidebarEntry =
    hasCachedSidebarSessionEntry(
      sidebarSessionsRef.current,
      currentSessionId,
    ) ||
    hasCachedSidebarSessionEntry(
      archivedSidebarSessionsRef.current,
      currentSessionId,
    );

  useEffect(() => {
    const loadNavConfig = async () => {
      try {
        const config = await getConfig();
        const resolvedItems = resolveEnabledSidebarNavItems(
          config.navigation?.enabled_items,
        );
        setEnabledNavItems(resolvedItems);
        setLanguageState(normalizeSidebarLanguage(config.language));
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
      (item) =>
        item.configurable === false || enabledNavItems.includes(item.id),
    );
  }, [enabledNavItems]);

  const filteredFooterNavItems = useMemo<SidebarNavItem[]>(() => {
    return FOOTER_SIDEBAR_NAV_ITEMS.filter(
      (item) =>
        item.configurable === false || enabledNavItems.includes(item.id),
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
    if (typeof window === "undefined") {
      return;
    }

    const currentSession = getStoredOemCloudSessionState();
    setCloudSessionState(currentSession);
    setCachedReferralState(
      readCachedOemCloudReferralState(currentSession?.session.tenant.id),
    );
    return subscribeOemCloudSessionChanged((state) => {
      setCloudSessionState(state);
      setCachedReferralState(
        readCachedOemCloudReferralState(state?.session.tenant.id),
      );
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const currentBootstrap =
      getOemCloudBootstrapSnapshot<OemCloudBootstrapResponse>();
    setCloudBootstrapState(currentBootstrap);
    setCachedReferralState(
      readCachedOemCloudReferralState(currentBootstrap?.session?.tenant.id),
    );
    return subscribeOemCloudBootstrapChanged((payload) => {
      const nextBootstrap = (payload as OemCloudBootstrapResponse) ?? null;
      setCloudBootstrapState(nextBootstrap);
      setCachedReferralState(
        readCachedOemCloudReferralState(nextBootstrap?.session?.tenant.id),
      );
    });
  }, []);

  const inviteTenantId = cloudSessionState?.session.tenant.id;
  const cachedInviteDashboard =
    cloudBootstrapState?.referral ?? cachedReferralState?.dashboard ?? null;
  const inviteFeatureEnabled =
    cloudBootstrapState?.features?.referralEnabled ??
    cachedReferralState?.referralEnabled ??
    true;
  const canLoadReferralDashboard =
    Boolean(cloudSessionState) && inviteFeatureEnabled;

  useEffect(() => {
    if (!inviteDialogOpen || !inviteTenantId || !canLoadReferralDashboard) {
      return;
    }

    if (cachedInviteDashboard) {
      setInviteDashboard(cachedInviteDashboard);
      setInviteError(null);
      setInviteLoading(false);
      return;
    }

    let cancelled = false;
    setInviteLoading(true);
    setInviteError(null);

    getClientReferralDashboard(inviteTenantId)
      .then((dashboard) => {
        if (!cancelled) {
          setCachedReferralState(
            cacheOemCloudReferralDashboard(inviteTenantId, dashboard),
          );
          setInviteDashboard(dashboard);
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        const message =
          error instanceof Error && error.message.trim()
            ? error.message.trim()
            : "加载邀请信息失败";
        setInviteError(message);
      })
      .finally(() => {
        if (!cancelled) {
          setInviteLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    inviteDialogOpen,
    inviteReloadKey,
    inviteTenantId,
    canLoadReferralDashboard,
    cachedInviteDashboard,
  ]);

  useEffect(() => {
    if (inviteFeatureEnabled === false && inviteDialogOpen) {
      setInviteDialogOpen(false);
    }
  }, [inviteFeatureEnabled, inviteDialogOpen]);

  useEffect(() => {
    if (!accountMenuOpen || typeof window === "undefined") {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        accountControlRef.current?.contains(target)
      ) {
        return;
      }

      setAccountMenuOpen(false);
      setLanguageMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAccountMenuOpen(false);
        setLanguageMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [accountMenuOpen]);

  useEffect(() => {
    if (!accountMenuOpen) {
      setLanguageMenuOpen(false);
    }
  }, [accountMenuOpen]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const syncThemeFromStorage = () => {
      const themeMode = loadLimeThemeMode();
      const effectiveThemeMode = applyLimeThemeMode(themeMode);
      setThemeState({ themeMode, effectiveThemeMode });
    };

    const syncColorSchemeFromStorage = () => {
      const nextColorSchemeId = loadLimeColorSchemeId();
      applyLimeColorScheme(nextColorSchemeId);
      setColorSchemeId(nextColorSchemeId);
    };

    const handleThemeChanged = (event: Event) => {
      const detail = (event as CustomEvent<LimeThemeChangedEventDetail>).detail;
      const themeMode = detail?.themeMode ?? loadLimeThemeMode();
      const effectiveThemeMode =
        detail?.effectiveThemeMode ?? getEffectiveLimeThemeMode(themeMode);
      setThemeState({ themeMode, effectiveThemeMode });
    };

    const handleColorSchemeChanged = (event: Event) => {
      const detail = (event as CustomEvent<LimeColorSchemeChangedEventDetail>)
        .detail;
      setColorSchemeId(detail?.colorSchemeId ?? loadLimeColorSchemeId());
    };

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === null || event.key === LIME_THEME_STORAGE_KEY) {
        syncThemeFromStorage();
      }
      if (event.key === null || event.key === LIME_COLOR_SCHEME_STORAGE_KEY) {
        syncColorSchemeFromStorage();
      }
    };

    const systemThemeQuery = window.matchMedia?.(
      "(prefers-color-scheme: dark)",
    );
    const handleSystemThemeChange = () => {
      setThemeState((current) => {
        if (current.themeMode !== "system") {
          return current;
        }

        const effectiveThemeMode = applyLimeThemeMode("system");
        return {
          themeMode: "system",
          effectiveThemeMode,
        };
      });
    };

    syncThemeFromStorage();
    syncColorSchemeFromStorage();

    window.addEventListener(LIME_THEME_CHANGED_EVENT, handleThemeChanged);
    window.addEventListener(
      LIME_COLOR_SCHEME_CHANGED_EVENT,
      handleColorSchemeChanged,
    );
    window.addEventListener("storage", handleStorageChange);
    systemThemeQuery?.addEventListener("change", handleSystemThemeChange);

    return () => {
      window.removeEventListener(LIME_THEME_CHANGED_EVENT, handleThemeChanged);
      window.removeEventListener(
        LIME_COLOR_SCHEME_CHANGED_EVENT,
        handleColorSchemeChanged,
      );
      window.removeEventListener("storage", handleStorageChange);
      systemThemeQuery?.removeEventListener("change", handleSystemThemeChange);
    };
  }, []);

  useEffect(() => {
    if (!appearancePopoverOpen || typeof window === "undefined") {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        appearanceControlRef.current?.contains(target)
      ) {
        return;
      }

      setAppearancePopoverOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAppearancePopoverOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [appearancePopoverOpen]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const refreshRememberedProjectId = () => {
      setRememberedProjectId(loadPersistedProjectId(LAST_PROJECT_ID_KEY));
    };

    const handlePersistedProjectChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string }>).detail;
      if (detail?.key && detail.key !== LAST_PROJECT_ID_KEY) {
        return;
      }
      refreshRememberedProjectId();
    };

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key !== LAST_PROJECT_ID_KEY) {
        return;
      }
      refreshRememberedProjectId();
    };

    window.addEventListener(
      PERSISTED_PROJECT_ID_CHANGED_EVENT,
      handlePersistedProjectChanged,
    );
    window.addEventListener("storage", handleStorageChange);

    return () => {
      window.removeEventListener(
        PERSISTED_PROJECT_ID_CHANGED_EVENT,
        handlePersistedProjectChanged,
      );
      window.removeEventListener("storage", handleStorageChange);
    };
  }, []);

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
  const shouldLoadWorkspaceScopedConversations =
    shouldShowConversationList && Boolean(currentProjectId);
  const shouldShowSessionLoadingState =
    sidebarSessionsLoading && sidebarSessions.length === 0;
  const shouldShowArchivedSessionLoadingState =
    archivedSidebarSessionsLoading && archivedSessionEntries.length === 0;

  useEffect(() => {
    sidebarSessionsRef.current = sidebarSessions;
  }, [sidebarSessions]);
  useEffect(() => {
    archivedSidebarSessionsRef.current = archivedSessionEntries;
  }, [archivedSessionEntries]);

  useEffect(() => {
    setRecentSessionsVisibleCount(SIDEBAR_RECENT_SESSION_PAGE_SIZE);
  }, [currentProjectId]);

  useEffect(() => {
    setArchivedSessionsVisibleCount(SIDEBAR_ARCHIVED_SESSION_PAGE_SIZE);
    setArchivedSessionsCollapsed(true);
  }, [currentProjectId]);

  const recentSessionRequestLimit = useMemo(() => {
    const requestLimit = buildSidebarSessionRequestLimit(
      recentSessionsVisibleCount,
      SIDEBAR_RECENT_SESSION_PAGE_SIZE,
    );

    return Math.max(requestLimit, SIDEBAR_RECENT_SESSION_PREFETCH_LIMIT);
  }, [recentSessionsVisibleCount]);
  const archivedSessionRequestLimit = useMemo(
    () =>
      buildSidebarSessionRequestLimit(
        archivedSessionsVisibleCount,
        SIDEBAR_ARCHIVED_SESSION_PAGE_SIZE,
      ),
    [archivedSessionsVisibleCount],
  );

  const loadRecentSidebarSessions = useCallback(async () => {
    if (!shouldLoadWorkspaceScopedConversations) {
      setSidebarSessions([]);
      setSidebarSessionsHasMore(false);
      setSidebarSessionsLoading(false);
      return;
    }

    setSidebarSessionsLoading(
      (current) => current || sidebarSessionsRef.current.length === 0,
    );
    try {
      const sessions = await listAgentRuntimeSessions({
        limit: recentSessionRequestLimit,
        workspaceId: currentProjectId ?? "",
      });
      const sortedSessions = sortSidebarSessions(sessions);
      const { hasMore } = splitSidebarSessionResult({
        sessions: sortedSessions,
        visibleCount: recentSessionsVisibleCount,
        pageSize: SIDEBAR_RECENT_SESSION_PAGE_SIZE,
      });
      setSidebarSessions(sortedSessions);
      setSidebarSessionsHasMore(hasMore);
    } catch (error) {
      console.error("加载导航任务列表失败:", error);
      setSidebarSessions([]);
      setSidebarSessionsHasMore(false);
    } finally {
      setSidebarSessionsLoading(false);
    }
  }, [
    currentProjectId,
    recentSessionRequestLimit,
    recentSessionsVisibleCount,
    shouldLoadWorkspaceScopedConversations,
  ]);
  const loadRecentSidebarSessionsRef = useRef(loadRecentSidebarSessions);
  useEffect(() => {
    loadRecentSidebarSessionsRef.current = loadRecentSidebarSessions;
  }, [loadRecentSidebarSessions]);

  const loadArchivedSidebarSessions = useCallback(async () => {
    if (!shouldLoadWorkspaceScopedConversations || archivedSessionsCollapsed) {
      setArchivedSessionEntries([]);
      setArchivedSessionEntriesHasMore(false);
      setArchivedSidebarSessionsLoading(false);
      return;
    }

    setArchivedSidebarSessionsLoading(
      (current) => current || archivedSidebarSessionsRef.current.length === 0,
    );
    try {
      const sessions = await listAgentRuntimeSessions({
        archivedOnly: true,
        limit: archivedSessionRequestLimit,
        workspaceId: currentProjectId ?? "",
      });
      const sortedSessions = sortSidebarSessions(
        sessions.filter((session) => Boolean(session.archived_at)),
      );
      const { hasMore } = splitSidebarSessionResult({
        sessions: sortedSessions,
        visibleCount: archivedSessionsVisibleCount,
        pageSize: SIDEBAR_ARCHIVED_SESSION_PAGE_SIZE,
      });
      setArchivedSessionEntries(sortedSessions);
      setArchivedSessionEntriesHasMore(hasMore);
    } catch (error) {
      console.error("加载归档任务列表失败:", error);
      setArchivedSessionEntries([]);
      setArchivedSessionEntriesHasMore(false);
    } finally {
      setArchivedSidebarSessionsLoading(false);
    }
  }, [
    archivedSessionRequestLimit,
    archivedSessionsCollapsed,
    archivedSessionsVisibleCount,
    currentProjectId,
    shouldLoadWorkspaceScopedConversations,
  ]);
  const loadArchivedSidebarSessionsRef = useRef(loadArchivedSidebarSessions);
  useEffect(() => {
    loadArchivedSidebarSessionsRef.current = loadArchivedSidebarSessions;
  }, [loadArchivedSidebarSessions]);

  const refreshSidebarSessions = useCallback(async () => {
    await loadRecentSidebarSessions();
    if (!archivedSessionsCollapsed) {
      await loadArchivedSidebarSessions();
    }
  }, [
    archivedSessionsCollapsed,
    loadArchivedSidebarSessions,
    loadRecentSidebarSessions,
  ]);
  const sidebarFocusRefreshCancelRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!shouldLoadWorkspaceScopedConversations) {
      return;
    }

    if (isClawTaskCenter && hasCachedCurrentSessionSidebarEntry) {
      return scheduleMinimumDelayIdleTask(
        () => {
          void loadRecentSidebarSessionsRef.current();
        },
        {
          minimumDelayMs: SIDEBAR_SESSION_ENTRY_REFRESH_DEFER_MS,
          idleTimeoutMs: SIDEBAR_SESSION_ENTRY_REFRESH_DEFER_MS,
        },
      );
    }

    void loadRecentSidebarSessionsRef.current();
  }, [
    currentProjectId,
    hasCachedCurrentSessionSidebarEntry,
    isClawTaskCenter,
    shouldLoadWorkspaceScopedConversations,
  ]);

  useEffect(() => {
    if (!shouldLoadWorkspaceScopedConversations) {
      return;
    }

    const handleFocus = () => {
      sidebarFocusRefreshCancelRef.current?.();
      sidebarFocusRefreshCancelRef.current = scheduleMinimumDelayIdleTask(
        () => {
          sidebarFocusRefreshCancelRef.current = null;
          void refreshSidebarSessions();
        },
        {
          minimumDelayMs: SIDEBAR_SESSION_ENTRY_REFRESH_DEFER_MS,
          idleTimeoutMs: SIDEBAR_SESSION_ENTRY_REFRESH_DEFER_MS,
        },
      );
    };

    window.addEventListener("focus", handleFocus);

    return () => {
      sidebarFocusRefreshCancelRef.current?.();
      sidebarFocusRefreshCancelRef.current = null;
      window.removeEventListener("focus", handleFocus);
    };
  }, [refreshSidebarSessions, shouldLoadWorkspaceScopedConversations]);

  useEffect(() => {
    if (!shouldLoadWorkspaceScopedConversations || archivedSessionsCollapsed) {
      return;
    }

    void loadArchivedSidebarSessionsRef.current();
  }, [
    archivedSessionsCollapsed,
    currentProjectId,
    shouldLoadWorkspaceScopedConversations,
  ]);

  useEffect(() => {
    if (!shouldLoadWorkspaceScopedConversations || !sidebarSessionsHasMore) {
      return;
    }

    if (recentSessionsVisibleCount < sidebarSessions.length) {
      return;
    }

    void loadRecentSidebarSessions();
  }, [
    loadRecentSidebarSessions,
    recentSessionsVisibleCount,
    shouldLoadWorkspaceScopedConversations,
    sidebarSessions.length,
    sidebarSessionsHasMore,
  ]);

  useEffect(() => {
    if (
      !shouldLoadWorkspaceScopedConversations ||
      archivedSessionsCollapsed ||
      !archivedSessionEntriesHasMore
    ) {
      return;
    }

    if (archivedSessionsVisibleCount < archivedSessionEntries.length) {
      return;
    }

    void loadArchivedSidebarSessions();
  }, [
    archivedSessionEntries.length,
    archivedSessionEntriesHasMore,
    archivedSessionsCollapsed,
    archivedSessionsVisibleCount,
    loadArchivedSidebarSessions,
    shouldLoadWorkspaceScopedConversations,
  ]);

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
  const recentSidebarSessions = useMemo(() => {
    if (!currentProjectId) {
      return [];
    }

    const filteredSessions = currentProjectId
      ? sidebarSessions.filter(
          (session) =>
            !session.workspace_id || session.workspace_id === currentProjectId,
        )
      : [];

    return filteredSessions.filter((session) => !session.archived_at);
  }, [currentProjectId, sidebarSessions]);
  const archivedSidebarSessions = useMemo(() => {
    if (!currentProjectId) {
      return [];
    }

    const filteredSessions = currentProjectId
      ? archivedSessionEntries.filter(
          (session) =>
            !session.workspace_id || session.workspace_id === currentProjectId,
        )
      : [];

    return filteredSessions.filter((session) => Boolean(session.archived_at));
  }, [archivedSessionEntries, currentProjectId]);
  const visibleRecentSidebarSessions = useMemo(
    () =>
      buildVisibleSidebarSessions({
        sessions: recentSidebarSessions,
        currentSessionId,
        limit: recentSessionsVisibleCount,
      }),
    [currentSessionId, recentSessionsVisibleCount, recentSidebarSessions],
  );
  const visibleArchivedSidebarSessions = useMemo(
    () =>
      buildVisibleSidebarSessions({
        sessions: archivedSidebarSessions,
        currentSessionId,
        limit: archivedSessionsVisibleCount,
      }),
    [archivedSessionsVisibleCount, archivedSidebarSessions, currentSessionId],
  );
  const hasMoreRecentSidebarSessions =
    sidebarSessionsHasMore ||
    recentSessionsVisibleCount < recentSidebarSessions.length;
  const hasMoreArchivedSidebarSessions =
    archivedSessionEntriesHasMore ||
    archivedSessionsVisibleCount < archivedSidebarSessions.length;

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
    if (item.id === "home-general") {
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
      return;
    }

    if (item.id === "workbench") {
      const fallbackSessionId =
        currentSessionId ??
        recentSidebarSessions[0]?.id ??
        sidebarSessions[0]?.id ??
        undefined;
      const targetParams = buildClawAgentParams({
        projectId: currentProjectId ?? undefined,
        initialSessionId: fallbackSessionId,
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
      return;
    }

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
      const nextSession = {
        ...session,
        updated_at: nextUpdatedAt,
        archived_at: archived ? nextUpdatedAt : null,
      } satisfies AsterSessionInfo;
      setSidebarSessionActionId(session.id);
      setSidebarSessions((current) =>
        sortSidebarSessions(
          current
            .map((item) => (item.id === session.id ? nextSession : item))
            .filter((item) => !item.archived_at),
        ),
      );
      setArchivedSessionEntries((current) =>
        sortSidebarSessions(
          archived
            ? [nextSession, ...current.filter((item) => item.id !== session.id)]
            : current
                .map((item) => (item.id === session.id ? nextSession : item))
                .filter((item) => Boolean(item.archived_at)),
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

  const currentColorScheme = getLimeColorScheme(colorSchemeId);
  const currentThemeLabel =
    LIME_THEME_MODE_OPTIONS.find((option) => option.id === themeState.themeMode)
      ?.label ?? "跟随系统";
  const currentLanguageLabel = resolveSidebarLanguageLabel(language);
  const accountDisplayName = resolveAccountDisplayName(cloudSessionState);
  const accountEmail = resolveAccountEmail(cloudSessionState);
  const accountTenantLabel = resolveAccountTenantLabel(cloudSessionState);
  const accountPlanSummary = resolveAccountPlanSummary(cloudBootstrapState);
  const cloudBrandLabel = resolveCloudBrandLabel(cloudBootstrapState);
  const connectCloudLabel = `连接 ${cloudBrandLabel}`;
  const accountAvatarUrl = cloudSessionState?.session.user.avatarUrl?.trim();
  const accountInitial = resolveAccountInitial(accountDisplayName);
  const hasCloudAccount = Boolean(cloudSessionState);
  const accountMetaLine =
    [accountEmail, accountTenantLabel].filter(Boolean).join(" · ") ||
    accountDisplayName;
  const inviteEntryVisible = inviteFeatureEnabled;
  const accountButtonTooltip = hasCloudAccount
    ? `${accountDisplayName}${accountEmail ? ` · ${accountEmail}` : ""}`
    : "开源使用 · 本地可用";
  const inviteShare = inviteDashboard?.share;
  const invitePolicy = inviteDashboard?.policy;
  const inviteHeadline = inviteShare?.headline?.trim() || "邀请好友加入内测";
  const inviteRules =
    inviteShare?.rules?.trim() ||
    "通过云端邀请策略自动发放奖励，具体到账以当前品牌云端配置为准。";

  const handleThemeModeChange = useCallback((nextThemeMode: LimeThemeMode) => {
    const themeMode = persistLimeThemeMode(nextThemeMode);
    setThemeState({
      themeMode,
      effectiveThemeMode: getEffectiveLimeThemeMode(themeMode),
    });
  }, []);

  const handleColorSchemeChange = useCallback(
    (nextColorSchemeId: LimeColorSchemeId) => {
      const resolvedColorSchemeId = persistLimeColorScheme(nextColorSchemeId);
      setColorSchemeId(resolvedColorSchemeId);
    },
    [],
  );

  const handleAccountMenuNavigate = useCallback(
    (params: PageParams) => {
      setAccountMenuOpen(false);
      setLanguageMenuOpen(false);
      onNavigate("settings", params);
    },
    [onNavigate],
  );

  const handleAccountLogin = useCallback(async () => {
    setAccountLoginPending(true);
    setAccountLoginError(null);
    const browserTarget = createExternalBrowserOpenTarget();
    try {
      const result = await startOemCloudLogin(undefined, { browserTarget });
      toast.success(
        result.mode === "desktop_auth"
          ? `${cloudBrandLabel} 登录已同步`
          : `已打开 ${cloudBrandLabel} 登录页，请在浏览器完成授权`,
      );
      setAccountMenuOpen(false);
      setLanguageMenuOpen(false);
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim()
          ? error.message.trim()
          : `打开 ${cloudBrandLabel} 登录页失败`;
      setAccountLoginError(message);
      toast.error(message);
    } finally {
      setAccountLoginPending(false);
    }
  }, [cloudBrandLabel]);

  const handleAccountLogout = useCallback(async () => {
    const tenantId = cloudSessionState?.session.tenant.id;
    setAccountLogoutPending(true);
    try {
      if (tenantId) {
        await logoutClient(tenantId);
      }
    } catch (error) {
      console.error("云端退出登录失败，已清理本地会话:", error);
    } finally {
      clearStoredOemCloudSessionState();
      clearOemCloudBootstrapSnapshot();
      clearSkillCatalogCache();
      clearServiceSkillCatalogCache();
      void clearSiteAdapterCatalogCache();
      setAccountMenuOpen(false);
      setLanguageMenuOpen(false);
      setAccountLogoutPending(false);
    }
  }, [cloudSessionState?.session.tenant.id]);

  const handleCopyInviteText = useCallback(
    async (value: string | undefined, successMessage: string) => {
      const text = value?.trim();
      if (!text) {
        toast.info("暂无可复制内容");
        return;
      }

      try {
        if (!navigator.clipboard?.writeText) {
          throw new Error("clipboard unavailable");
        }
        await navigator.clipboard.writeText(text);
        toast.success(successMessage);
      } catch {
        toast.error("复制失败，请检查剪贴板权限");
      }
    },
    [],
  );

  const handleLanguageChange = useCallback(
    async (nextLanguage: Language) => {
      const previousLanguage = language;
      if (nextLanguage === previousLanguage) {
        setLanguageMenuOpen(false);
        return;
      }

      setLanguageState(nextLanguage);
      setI18nLanguage(nextLanguage);
      setLanguageMenuOpen(false);

      try {
        const config = await getConfig();
        await saveConfig({
          ...config,
          language: nextLanguage,
        });
      } catch (error) {
        console.error("保存语言设置失败:", error);
        setLanguageState(previousLanguage);
        setI18nLanguage(previousLanguage);
      }
    },
    [language, setI18nLanguage],
  );

  const renderThemeModeIcon = (themeMode: LimeThemeMode) => {
    if (themeMode === "dark") {
      return <Moon />;
    }

    if (themeMode === "system") {
      return <Monitor />;
    }

    return <Sun />;
  };

  return (
    <TooltipProvider>
      <Container
        $collapsed={collapsed}
        $themeMode={themeState.effectiveThemeMode}
        $reserveWindowControls={reserveWindowControls}
        data-testid="app-sidebar"
        data-window-controls-reserved={String(reserveWindowControls)}
      >
        <HeaderArea $collapsed={collapsed} data-testid="app-sidebar-header">
          <HeaderTopRow $collapsed={collapsed}>
            {maybeWrapWithTooltip(
              <UserButton
                $collapsed={collapsed}
                onClick={() =>
                  onNavigate(
                    "agent",
                    buildHomeAgentParams({
                      projectId: currentProjectId ?? undefined,
                    }),
                  )
                }
                aria-label="返回 Lime 首页"
                title="返回 Lime 首页"
              >
                <Avatar>
                  <img src={LIME_BRAND_LOGO_SRC} alt={LIME_BRAND_NAME} />
                </Avatar>
                <UserName $collapsed={collapsed}>{LIME_BRAND_NAME}</UserName>
              </UserButton>,
              "Lime 首页",
            )}

            {inviteEntryVisible
              ? maybeWrapWithTooltip(
                  <HeaderInviteButton
                    $collapsed={collapsed}
                    $active={inviteDialogOpen}
                    onClick={() => {
                      setInviteDashboard(cachedInviteDashboard);
                      setInviteDialogOpen(true);
                    }}
                    title="邀请好友"
                    aria-label="邀请好友"
                    data-testid="app-sidebar-invite-button"
                  >
                    <Gift />
                    <span>邀请好友</span>
                  </HeaderInviteButton>,
                  "邀请好友",
                )
              : null}

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
              onClick={() =>
                onNavigate(
                  "agent",
                  buildHomeAgentParams({
                    projectId: currentProjectId ?? undefined,
                  }),
                )
              }
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
            <AppSidebarConversationShelf
              recentSessions={visibleRecentSidebarSessions}
              archivedSessions={visibleArchivedSidebarSessions}
              currentSessionId={currentSessionId}
              recentLoading={shouldShowSessionLoadingState}
              archivedLoading={shouldShowArchivedSessionLoadingState}
              archivedCollapsed={archivedSessionsCollapsed}
              hasMoreRecent={hasMoreRecentSidebarSessions}
              hasMoreArchived={hasMoreArchivedSidebarSessions}
              actionSessionId={sidebarSessionActionId}
              onCreateConversation={handleNavigateToNewTask}
              onNavigateToConversation={handleNavigateToConversation}
              onToggleArchive={(session, archived) => {
                void handleToggleSessionArchive(session, archived);
              }}
              onShowMoreRecent={() =>
                setRecentSessionsVisibleCount(
                  (current) => current + SIDEBAR_RECENT_SESSION_PAGE_SIZE,
                )
              }
              onShowMoreArchived={() =>
                setArchivedSessionsVisibleCount(
                  (current) => current + SIDEBAR_ARCHIVED_SESSION_PAGE_SIZE,
                )
              }
              onToggleArchivedCollapsed={() =>
                setArchivedSessionsCollapsed((current) => !current)
              }
            />
          ) : null}

          {shouldShowPluginExtensionsSection && (
            <Section $collapsed={collapsed}>
              <SectionTitle $collapsed={collapsed}>插件扩展</SectionTitle>
              {assistantItems.map((item) => renderNavItem(item))}
            </Section>
          )}
        </MenuScroll>

        <FooterArea
          $collapsed={collapsed}
          data-testid="app-sidebar-footer-area"
        >
          <ActionRow $collapsed={collapsed}>
            {!collapsed ? <div /> : null}
            <AppearanceActionSlot
              $collapsed={collapsed}
              ref={appearanceControlRef}
            >
              {collapsed ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <IconActionButton
                      $active={appearancePopoverOpen}
                      onClick={() => {
                        setAccountMenuOpen(false);
                        setLanguageMenuOpen(false);
                        setAppearancePopoverOpen((current) => !current);
                      }}
                      title="快速切换外观"
                      aria-label="快速切换外观"
                      aria-expanded={appearancePopoverOpen}
                      aria-haspopup="dialog"
                    >
                      {themeState.effectiveThemeMode === "dark" ? (
                        <Moon />
                      ) : (
                        <Sun />
                      )}
                    </IconActionButton>
                  </TooltipTrigger>
                  <TooltipContent side="right">快速切换外观</TooltipContent>
                </Tooltip>
              ) : (
                <IconActionButton
                  $active={appearancePopoverOpen}
                  onClick={() => {
                    setAccountMenuOpen(false);
                    setLanguageMenuOpen(false);
                    setAppearancePopoverOpen((current) => !current);
                  }}
                  title="快速切换外观"
                  aria-label="快速切换外观"
                  aria-expanded={appearancePopoverOpen}
                  aria-haspopup="dialog"
                >
                  {themeState.effectiveThemeMode === "dark" ? (
                    <Moon />
                  ) : (
                    <Sun />
                  )}
                </IconActionButton>
              )}

              {appearancePopoverOpen ? (
                <AppearancePopover
                  data-testid="app-sidebar-appearance-popover"
                  role="dialog"
                  aria-label="快速切换外观"
                >
                  <AppearancePopoverHeader>
                    <AppearancePopoverTitle>
                      <Palette />
                      外观
                    </AppearancePopoverTitle>
                    <AppearancePopoverSummary>
                      {currentThemeLabel} · {currentColorScheme.label}
                    </AppearancePopoverSummary>
                  </AppearancePopoverHeader>

                  <AppearanceGroup>
                    <AppearanceGroupLabel>主题</AppearanceGroupLabel>
                    <ThemeModeGrid>
                      {LIME_THEME_MODE_OPTIONS.map((option) => {
                        const active = option.id === themeState.themeMode;
                        return (
                          <ThemeModeButton
                            key={option.id}
                            $active={active}
                            type="button"
                            aria-pressed={active}
                            aria-label={`切换主题为${option.label}`}
                            title={option.description}
                            onClick={() => handleThemeModeChange(option.id)}
                          >
                            {renderThemeModeIcon(option.id)}
                            <span>{option.label}</span>
                          </ThemeModeButton>
                        );
                      })}
                    </ThemeModeGrid>
                  </AppearanceGroup>

                  <AppearanceGroup>
                    <AppearanceGroupLabel>配色</AppearanceGroupLabel>
                    <ColorSchemeList>
                      {LIME_COLOR_SCHEMES.map((scheme) => {
                        const active = scheme.id === colorSchemeId;
                        return (
                          <ColorSchemeButton
                            key={scheme.id}
                            $active={active}
                            type="button"
                            aria-pressed={active}
                            aria-label={`切换配色为${scheme.label}`}
                            title={scheme.description}
                            onClick={() => handleColorSchemeChange(scheme.id)}
                          >
                            <ColorSchemeSwatches aria-hidden="true">
                              {scheme.swatches.map((swatch) => (
                                <span
                                  key={swatch}
                                  style={{ backgroundColor: swatch }}
                                />
                              ))}
                            </ColorSchemeSwatches>
                            <ColorSchemeText>
                              <ColorSchemeLabel>
                                {scheme.label}
                              </ColorSchemeLabel>
                            </ColorSchemeText>
                            <ColorSchemeCheck $active={active}>
                              <Check />
                            </ColorSchemeCheck>
                          </ColorSchemeButton>
                        );
                      })}
                    </ColorSchemeList>
                  </AppearanceGroup>
                </AppearancePopover>
              ) : null}
            </AppearanceActionSlot>
          </ActionRow>

          <AccountActionSlot
            $collapsed={collapsed}
            ref={accountControlRef}
            data-testid="app-sidebar-account-slot"
          >
            {maybeWrapWithTooltip(
              <AccountButton
                type="button"
                $collapsed={collapsed}
                $active={accountMenuOpen}
                onClick={() => {
                  setAppearancePopoverOpen(false);
                  setLanguageMenuOpen(false);
                  setAccountMenuOpen((current) => !current);
                }}
                aria-label="打开用户菜单"
                aria-expanded={accountMenuOpen}
                aria-haspopup="dialog"
                data-testid="app-sidebar-account-button"
              >
                <AccountIdentity $collapsed={collapsed}>
                  <AccountAvatar>
                    {accountAvatarUrl ? (
                      <img src={accountAvatarUrl} alt={accountDisplayName} />
                    ) : (
                      accountInitial
                    )}
                  </AccountAvatar>
                  <AccountName>{accountDisplayName}</AccountName>
                </AccountIdentity>
                {collapsed ? (
                  <AccountAvatar>
                    {accountAvatarUrl ? (
                      <img src={accountAvatarUrl} alt={accountDisplayName} />
                    ) : (
                      accountInitial
                    )}
                  </AccountAvatar>
                ) : null}
                <AccountTrailing $collapsed={collapsed}>
                  <AccountStateBadge $connected={hasCloudAccount}>
                    {hasCloudAccount ? "云端" : "本地可用"}
                  </AccountStateBadge>
                  <ChevronDown />
                </AccountTrailing>
              </AccountButton>,
              accountButtonTooltip,
            )}

            {accountMenuOpen ? (
              <AccountMenuPopover
                $collapsed={collapsed}
                role="dialog"
                aria-label="用户菜单"
                data-testid="app-sidebar-account-menu"
              >
                {hasCloudAccount ? (
                  <AccountPlanButton
                    type="button"
                    aria-label="查看套餐详情"
                    data-testid="app-sidebar-cloud-account-card"
                    onClick={() =>
                      handleAccountMenuNavigate({
                        tab: SettingsTabs.Providers,
                        providerView: "cloud",
                      })
                    }
                  >
                    <AccountPlanHeader>
                      <AccountPlanTitle>
                        {accountPlanSummary.planLabel}
                      </AccountPlanTitle>
                      <AccountPlanDetailsPill>
                        查看详情
                        <ChevronRight />
                      </AccountPlanDetailsPill>
                    </AccountPlanHeader>
                    {accountPlanSummary.usageLabel ? (
                      <>
                        <AccountPlanUsage>
                          {accountPlanSummary.usageLabel}
                        </AccountPlanUsage>
                        <AccountPlanProgressTrack aria-hidden="true">
                          <AccountPlanProgressFill
                            $percent={accountPlanSummary.usagePercent}
                          />
                        </AccountPlanProgressTrack>
                      </>
                    ) : null}
                    <AccountPlanMeta>{accountMetaLine}</AccountPlanMeta>
                  </AccountPlanButton>
                ) : (
                  <AccountPlanCard data-testid="app-sidebar-open-source-card">
                    <AccountPlanHeader>
                      <AccountPlanTitle>
                        <span>开源使用</span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <AccountInfoIconButton
                              type="button"
                              aria-label="开源使用说明"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <Info />
                            </AccountInfoIconButton>
                          </TooltipTrigger>
                          <TooltipContent side="right">
                            {`本地开源功能可直接使用；你可以先进入模型设置配置本地渠道，也可以按需连接 ${cloudBrandLabel} 同步账号、积分、套餐和商业化能力。`}
                          </TooltipContent>
                        </Tooltip>
                      </AccountPlanTitle>
                      <AccountPlanBadge>免费版</AccountPlanBadge>
                    </AccountPlanHeader>
                    <AccountPlanDetail>
                      <span>不登录也可用</span>
                      <span>本地模型可配置</span>
                    </AccountPlanDetail>
                    <AccountPlanActions>
                      <AccountPlanActionButton
                        type="button"
                        $primary
                        disabled={accountLoginPending}
                        aria-label={connectCloudLabel}
                        onClick={() => void handleAccountLogin()}
                      >
                        <LogIn />
                        {accountLoginPending
                          ? "正在打开..."
                          : connectCloudLabel}
                      </AccountPlanActionButton>
                      <AccountPlanActionButton
                        type="button"
                        aria-label="模型设置"
                        onClick={() =>
                          handleAccountMenuNavigate({
                            tab: SettingsTabs.Providers,
                            providerView: "settings",
                          })
                        }
                      >
                        <KeyRound />
                        模型设置
                      </AccountPlanActionButton>
                    </AccountPlanActions>
                    {accountLoginError ? (
                      <AccountMenuNotice $tone="error">
                        {accountLoginError}
                      </AccountMenuNotice>
                    ) : null}
                  </AccountPlanCard>
                )}

                <AccountMenuList>
                  {filteredFooterNavItems.map((item) => {
                    const AccountNavIcon = item.icon;
                    const active = isActive(item);

                    return (
                      <AccountMenuItem
                        key={item.id}
                        type="button"
                        $active={active}
                        aria-label={item.label}
                        aria-current={active ? "page" : undefined}
                        onClick={() => {
                          setAccountMenuOpen(false);
                          handleNavigate(item);
                        }}
                      >
                        <AccountMenuItemLeading>
                          <AccountNavIcon />
                          {item.label}
                        </AccountMenuItemLeading>
                        <ChevronRight />
                      </AccountMenuItem>
                    );
                  })}
                  <AccountMenuItemGroup>
                    <AccountMenuItem
                      type="button"
                      $active={languageMenuOpen}
                      aria-label="语言"
                      aria-expanded={languageMenuOpen}
                      aria-haspopup="menu"
                      onClick={() => setLanguageMenuOpen((current) => !current)}
                    >
                      <AccountMenuItemLeading>
                        <Languages />
                        语言
                      </AccountMenuItemLeading>
                      <AccountMenuItemTrailing>
                        {currentLanguageLabel}
                        <ChevronRight />
                      </AccountMenuItemTrailing>
                    </AccountMenuItem>
                    {languageMenuOpen ? (
                      <AccountSubmenuPopover
                        role="menu"
                        aria-label="选择语言"
                        data-testid="app-sidebar-language-menu"
                      >
                        <AccountSubmenuTitle>界面语言</AccountSubmenuTitle>
                        {APP_SIDEBAR_LANGUAGE_OPTIONS.map((option) => {
                          const active = option.id === language;

                          return (
                            <AccountSubmenuItem
                              key={option.id}
                              type="button"
                              $active={active}
                              role="menuitemradio"
                              aria-checked={active}
                              aria-label={`切换语言为${option.label}`}
                              onClick={() =>
                                void handleLanguageChange(option.id)
                              }
                            >
                              <AccountSubmenuItemText>
                                <AccountSubmenuItemLabel>
                                  {option.label}
                                </AccountSubmenuItemLabel>
                                <AccountSubmenuItemHint>
                                  {option.hint}
                                </AccountSubmenuItemHint>
                              </AccountSubmenuItemText>
                              {active ? <Check /> : null}
                            </AccountSubmenuItem>
                          );
                        })}
                      </AccountSubmenuPopover>
                    ) : null}
                  </AccountMenuItemGroup>
                  {hasCloudAccount ? (
                    <AccountMenuItem
                      type="button"
                      aria-label="用户中心"
                      onClick={() =>
                        handleAccountMenuNavigate({
                          tab: SettingsTabs.Profile,
                        })
                      }
                    >
                      <AccountMenuItemLeading>
                        <ExternalLink />
                        用户中心
                      </AccountMenuItemLeading>
                      <ChevronRight />
                    </AccountMenuItem>
                  ) : null}
                  <AccountMenuItem
                    type="button"
                    aria-label="模型设置"
                    onClick={() =>
                      handleAccountMenuNavigate({
                        tab: SettingsTabs.Providers,
                        providerView: "settings",
                      })
                    }
                  >
                    <AccountMenuItemLeading>
                      <KeyRound />
                      模型设置
                    </AccountMenuItemLeading>
                    <ChevronRight />
                  </AccountMenuItem>
                  {hasCloudAccount ? (
                    <AccountMenuItem
                      type="button"
                      aria-label={cloudBrandLabel}
                      onClick={() =>
                        handleAccountMenuNavigate({
                          tab: SettingsTabs.Providers,
                          providerView: "cloud",
                        })
                      }
                    >
                      <AccountMenuItemLeading>
                        <Cloud />
                        {cloudBrandLabel}
                      </AccountMenuItemLeading>
                      <ChevronRight />
                    </AccountMenuItem>
                  ) : null}
                  <AccountMenuItem
                    type="button"
                    aria-label="关于"
                    onClick={() =>
                      handleAccountMenuNavigate({ tab: SettingsTabs.About })
                    }
                  >
                    <AccountMenuItemLeading>
                      <Info />
                      关于
                    </AccountMenuItemLeading>
                    <ChevronRight />
                  </AccountMenuItem>
                  {hasCloudAccount ? (
                    <>
                      <AccountMenuDivider />
                      <AccountMenuItem
                        type="button"
                        $danger
                        disabled={accountLogoutPending}
                        aria-label="退出登录"
                        onClick={() => void handleAccountLogout()}
                      >
                        <AccountMenuItemLeading>
                          <LogOut />
                          {accountLogoutPending ? "退出中..." : "退出登录"}
                        </AccountMenuItemLeading>
                      </AccountMenuItem>
                    </>
                  ) : null}
                </AccountMenuList>
              </AccountMenuPopover>
            ) : null}
          </AccountActionSlot>
        </FooterArea>
      </Container>
      <Modal
        isOpen={inviteDialogOpen}
        onClose={() => setInviteDialogOpen(false)}
        className="p-0"
        maxWidth="max-w-xl"
        showCloseButton={false}
      >
        <InviteDialogSurface data-testid="app-sidebar-invite-dialog">
          <InviteDialogCloseButton
            type="button"
            aria-label="关闭邀请弹窗"
            onClick={() => setInviteDialogOpen(false)}
          >
            <X />
          </InviteDialogCloseButton>
          <InviteDialogHeader>
            <InviteDialogEyebrow>
              {inviteShare?.brandName ?? accountTenantLabel ?? "Lime"} 邀请
            </InviteDialogEyebrow>
            <InviteDialogTitle>邀请好友</InviteDialogTitle>
            <InviteDialogDescription>
              {inviteHeadline}
              {!inviteLoading && !inviteError ? `。${inviteRules}` : ""}
            </InviteDialogDescription>
          </InviteDialogHeader>

          <InviteDialogBody>
            {!hasCloudAccount ? (
              <InviteStatusCard>
                {`连接 ${cloudBrandLabel} 后会生成专属邀请码，并自动读取当前品牌云端的域名和奖励策略。`}
                <InviteActionBar style={{ marginTop: 10 }}>
                  <InviteDialogActionButton
                    type="button"
                    $primary
                    onClick={() => {
                      setInviteDialogOpen(false);
                      void handleAccountLogin();
                    }}
                  >
                    <Cloud />
                    连接云端账号
                  </InviteDialogActionButton>
                </InviteActionBar>
              </InviteStatusCard>
            ) : null}

            {hasCloudAccount && inviteLoading ? (
              <InviteStatusCard>正在从云端同步邀请信息...</InviteStatusCard>
            ) : null}

            {hasCloudAccount && inviteError ? (
              <InviteStatusCard $tone="error">
                {inviteError}
                <InviteActionBar style={{ marginTop: 10 }}>
                  <InviteDialogActionButton
                    type="button"
                    onClick={() => setInviteReloadKey((value) => value + 1)}
                  >
                    <RefreshCw />
                    重试
                  </InviteDialogActionButton>
                </InviteActionBar>
              </InviteStatusCard>
            ) : null}

            {hasCloudAccount &&
            !inviteLoading &&
            !inviteError &&
            inviteDashboard ? (
              <InviteShareCard>
                <InviteCodeBlock>
                  <InviteCodeMeta>
                    <InviteCodeLabel>邀请码</InviteCodeLabel>
                    <InviteCodeValue>{inviteShare?.code}</InviteCodeValue>
                  </InviteCodeMeta>
                  <InviteDialogActionButton
                    type="button"
                    onClick={() =>
                      void handleCopyInviteText(
                        inviteShare?.code,
                        "已复制邀请码",
                      )
                    }
                  >
                    <Copy />
                    复制
                  </InviteDialogActionButton>
                </InviteCodeBlock>

                <InviteMetaGrid>
                  <InviteMetaItem>
                    <span>下载地址</span>
                    <strong>{inviteShare?.downloadUrl}</strong>
                  </InviteMetaItem>
                  <InviteMetaItem>
                    <span>邀请链接</span>
                    <strong>{inviteShare?.landingUrl}</strong>
                  </InviteMetaItem>
                  <InviteMetaItem>
                    <span>邀请人奖励</span>
                    <strong>
                      {formatReferralCredits(
                        invitePolicy?.referrerRewardCredits,
                      )}
                    </strong>
                  </InviteMetaItem>
                  <InviteMetaItem>
                    <span>被邀请人奖励</span>
                    <strong>
                      {formatReferralCredits(
                        invitePolicy?.inviteeRewardCredits,
                      )}
                    </strong>
                  </InviteMetaItem>
                </InviteMetaGrid>

                <InviteActionBar>
                  <InviteDialogActionButton
                    type="button"
                    $primary
                    onClick={() =>
                      void handleCopyInviteText(
                        inviteShare?.shareText,
                        "已复制邀请文案",
                      )
                    }
                  >
                    <Copy />
                    复制邀请文案
                  </InviteDialogActionButton>
                  <InviteDialogActionButton
                    type="button"
                    onClick={() =>
                      void handleCopyInviteText(
                        inviteShare?.landingUrl,
                        "已复制邀请链接",
                      )
                    }
                  >
                    <ExternalLink />
                    复制邀请链接
                  </InviteDialogActionButton>
                </InviteActionBar>
              </InviteShareCard>
            ) : null}
          </InviteDialogBody>
        </InviteDialogSurface>
      </Modal>
    </TooltipProvider>
  );
}
