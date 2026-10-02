/**
 * 全局应用侧边栏
 *
 * 当前导航收口为一级主入口 + 独立图标 rail。
 * 业务主线入口直接显示在侧栏，设置与主题入口固定在 rail 底部。
 */

import {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
  type ReactElement,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  Bell,
  Palette,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  AgentPageParams,
  Page,
  PageParams,
  PluginsPageParams,
  ScheduledTasksPageParams,
} from "@/types/page";
import {
  getConfig,
  subscribeAppConfigChanged,
} from "@/lib/api/appConfig";
import { buildHomeAgentParams } from "@/lib/workspace/navigation";
import type { AgentSessionInfo } from "@/lib/api/agentRuntime/sessionTypes";
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
import { LIME_BRAND_LOGO_SRC, LIME_BRAND_NAME } from "@/lib/branding";
import { AppSidebarRail } from "@/components/app-sidebar/AppSidebarRail";
import { AppSidebarCustomization } from "@/components/app-sidebar/AppSidebarCustomization";
import { AppSidebarAppearancePopover } from "@/components/app-sidebar/AppSidebarAppearancePopover";
import { AppSidebarConversationShelf } from "@/components/app-sidebar/AppSidebarConversationShelf";
import { AppSidebarConversationImportDialog } from "@/components/app-sidebar/AppSidebarConversationImportDialog";
import { AppSidebarInviteDialog } from "@/components/app-sidebar/AppSidebarInviteDialog";
import { AppSidebarSearchDialog } from "@/components/app-sidebar/AppSidebarSearchDialog";
import type { AgentBackgroundSessionRuntimeSnapshot } from "@/components/agent/chat";
import { useOpenedProjectSummaries } from "@/components/agent/chat/hooks/useOpenedProjectSummaries";
import { useAppSidebarAppearance } from "@/components/app-sidebar/useAppSidebarAppearance";
import { useAppSidebarConversationActions } from "@/components/app-sidebar/useAppSidebarConversationActions";
import { useAppSidebarConversationImport } from "@/components/app-sidebar/useAppSidebarConversationImport";
import { useAppSidebarProjectActions } from "@/components/app-sidebar/useAppSidebarProjectActions";
import { useAppSidebarSessions } from "@/components/app-sidebar/useAppSidebarSessions";
import type { SidebarOpenedProjectSummary } from "@/components/app-sidebar/sidebarConversationGroups";
import {
  APP_SIDEBAR_COLLAPSED_STORAGE_KEY,
  APP_SIDEBAR_COLLAPSE_EVENT,
  SIDEBAR_NAV_LABEL_KEYS,
} from "@/components/app-sidebar/AppSidebar.constants";
import {
  Container,
  SidebarSurface,
  HeaderArea,
  HeaderTopRow,
  UserButton,
  Avatar,
  UserName,
  SearchButton,
  MenuScroll,
  MainNavList,
  NavButton,
  NavLabel,
  FooterAppearanceActionSlot,
  IconActionButton,
  HeaderInviteButton,
} from "@/components/app-sidebar/AppSidebar.styles";
import {
  formatSidebarSessionMeta,
  resolveSidebarSessionTitle,
} from "@/components/app-sidebar/sidebarSessionFormatting";
import {
  isSameSidebarNavigationTarget,
  resolveSidebarNavigationTarget,
  serializeNavigationParams,
  type SidebarNavigationTarget,
} from "@/components/app-sidebar/sidebarNavigationTarget";
import {
  resolveAccountTenantLabel,
  resolveCloudBrandLabel,
} from "@/components/app-sidebar/sidebarAccount";
import { shouldReserveMacWindowControls } from "@/lib/windowControls";
import {
  getOemCloudBootstrapSnapshot,
  getStoredOemCloudSessionState,
  subscribeOemCloudBootstrapChanged,
  subscribeOemCloudSessionChanged,
  type OemCloudStoredSessionState,
} from "@/lib/oemCloudSession";
import {
  getClientReferralDashboard,
  type OemCloudBootstrapResponse,
  type OemCloudReferralDashboard,
} from "@/lib/api/oemCloudControlPlane";
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

interface AppSidebarProps {
  currentPage: Page;
  currentPageParams?: PageParams;
  activeAgentSessionId?: string | null;
  activeAgentStreaming?: boolean;
  backgroundAgentSessionRuntime?: AgentBackgroundSessionRuntimeSnapshot | null;
  requestedPage?: Page;
  requestedPageParams?: PageParams;
  onNavigate: (page: Page, params?: PageParams) => void;
  onStartWindowDrag?: (event: ReactMouseEvent<HTMLElement>) => void;
}

type SidebarNavItem = SidebarNavItemDefinition;

export function AppSidebar({
  currentPage,
  currentPageParams,
  activeAgentSessionId,
  activeAgentStreaming = false,
  backgroundAgentSessionRuntime = null,
  requestedPage,
  requestedPageParams,
  onNavigate,
  onStartWindowDrag,
}: AppSidebarProps) {
  const { t, i18n } = useTranslation("navigation");
  const conversationUntitledLabel = t(
    "navigation.sidebar.conversations.untitled",
    "未命名对话",
  );
  const resolveLocalizedSessionTitle = useCallback(
    (session: AgentSessionInfo) =>
      resolveSidebarSessionTitle(session, conversationUntitledLabel),
    [conversationUntitledLabel],
  );
  const formatLocalizedSessionMeta = useCallback(
    (session: AgentSessionInfo) =>
      formatSidebarSessionMeta(session, {
        locale: i18n.language,
      }),
    [i18n.language],
  );
  const renameConversationPromptLabel = t(
    "navigation.sidebar.conversations.rename.prompt",
    "重命名对话",
  );
  const renameConversationSuccessLabel = t(
    "navigation.sidebar.conversations.rename.success",
    "已重命名对话",
  );
  const renameConversationErrorLabel = t(
    "navigation.sidebar.conversations.rename.error",
    "重命名失败，请稍后重试",
  );
  const formatDeleteConversationConfirm = useCallback(
    (title: string) =>
      t("navigation.sidebar.conversations.delete.confirm", {
        title,
        defaultValue: "确定要删除“{{title}}”吗？删除后无法恢复。",
      }),
    [t],
  );
  const deleteConversationSuccessLabel = t(
    "navigation.sidebar.conversations.delete.success",
    "已删除对话",
  );
  const deleteConversationErrorLabel = t(
    "navigation.sidebar.conversations.delete.error",
    "删除失败，请稍后重试",
  );
  const accountDefaultCloudBrandLabel = t(
    "navigation.sidebar.account.defaultCloudBrand",
    "Lime 云端",
  );
  const accountCloudSuffixLabel = t(
    "navigation.sidebar.account.cloudSuffix",
    "云端",
  );
  const inviteLoadErrorLabel = t(
    "navigation.sidebar.invite.feedback.loadFailed",
    "加载邀请信息失败",
  );
  const activePage = requestedPage ?? currentPage;
  const activePageParams = requestedPageParams ?? currentPageParams;
  const isContextlessPage =
    activePage === "scheduled-tasks" || activePage === "resources";
  const isCustomizationPage = ["plugins", "skills", "experts"].includes(
    activePage,
  );
  const activeNavigationTarget = {
    page: activePage,
    rawParams: activePageParams,
    paramsKey: serializeNavigationParams(activePageParams),
  } satisfies SidebarNavigationTarget;
  const requestedNavigationPending =
    requestedPage !== undefined &&
    (requestedPage !== currentPage ||
      serializeNavigationParams(requestedPageParams) !==
        serializeNavigationParams(currentPageParams));
  const requestedNavigationTargetRef = useRef<SidebarNavigationTarget>({
    ...activeNavigationTarget,
  });
  const agentEntry = (activePageParams as AgentPageParams | undefined)
    ?.agentEntry;
  const activeAgentPageParams = activePageParams as AgentPageParams | undefined;
  const isAgentWorkspace = activePage === "agent";
  const isClawTaskCenter = isAgentWorkspace && agentEntry === "claw";
  const isNewTaskHome = activePage === "agent" && agentEntry === "new-task";
  const [rememberedProjectId, setRememberedProjectId] = useState<string | null>(
    () =>
      typeof window === "undefined"
        ? null
        : loadPersistedProjectId(LAST_PROJECT_ID_KEY),
  );
  const activeAgentProjectId = isAgentWorkspace
    ? activeAgentPageParams?.projectId?.trim() || null
    : null;
  const conversationScopeProjectId =
    activeAgentProjectId || (isAgentWorkspace ? rememberedProjectId : null);
  const currentProjectId = activeAgentProjectId;
  const projectScopedNavigationProjectId =
    activeAgentProjectId || rememberedProjectId;
  const openedProjects = useOpenedProjectSummaries(
    conversationScopeProjectId
      ? {
          id: conversationScopeProjectId,
          name: "",
        }
      : null,
  );
  const conversationScopeProjects = useMemo(() => {
    if (!conversationScopeProjectId) {
      return openedProjects;
    }
    const scopedProjects = openedProjects.filter(
      (project) => project.id === conversationScopeProjectId,
    );
    if (scopedProjects.length > 0) {
      return scopedProjects;
    }
    return [
      {
        id: conversationScopeProjectId,
        name: conversationScopeProjectId,
        rootPath: null,
        isFavorite: false,
      },
    ];
  }, [conversationScopeProjectId, openedProjects]);
  const conversationDisplayProjects = useMemo(() => {
    if (!conversationScopeProjectId) {
      return openedProjects;
    }
    const hasActiveProject = openedProjects.some(
      (project) => project.id === conversationScopeProjectId,
    );
    return hasActiveProject
      ? openedProjects
      : [...openedProjects, conversationScopeProjects[0]].filter(
          (project): project is SidebarOpenedProjectSummary => Boolean(project),
        );
  }, [conversationScopeProjectId, conversationScopeProjects, openedProjects]);
  const conversationProjectCwds = useMemo(
    () =>
      conversationScopeProjects
        .map((project) => project.rootPath?.trim())
        .filter((rootPath): rootPath is string => Boolean(rootPath)),
    [conversationScopeProjects],
  );
  const requireConversationProjectCwd =
    Boolean(activeAgentProjectId) && conversationProjectCwds.length > 0;
  const requestedAgentSessionId =
    requestedNavigationPending && requestedPage === "agent"
      ? ((
          requestedPageParams as AgentPageParams | undefined
        )?.initialSessionId?.trim() ?? null)
      : null;
  const liveAgentSessionId = isAgentWorkspace
    ? activeAgentSessionId?.trim() || null
    : null;
  const routeAgentSessionId =
    activeAgentPageParams?.initialSessionId?.trim() || null;
  const currentSessionId =
    requestedAgentSessionId || liveAgentSessionId || routeAgentSessionId;
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return (
      window.localStorage.getItem(APP_SIDEBAR_COLLAPSED_STORAGE_KEY) === "true"
    );
  });
  const collapsedRef = useRef(collapsed);
  const collapseRestoreBySourceRef = useRef<Record<string, boolean>>({});
  const routeCollapseRestoreRef = useRef<boolean | null>(null);
  useEffect(() => {
    collapsedRef.current = collapsed;
  }, [collapsed]);
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleCollapseRequest = (event: Event) => {
      const detail = (
        event as CustomEvent<{ collapsed?: boolean; source?: string }>
      ).detail;
      const source = detail?.source?.trim();
      if (source) {
        if (detail?.collapsed === false) {
          const previous = collapseRestoreBySourceRef.current[source];
          delete collapseRestoreBySourceRef.current[source];
          if (typeof previous === "boolean") {
            setCollapsed(previous);
          }
          return;
        }

        if (!(source in collapseRestoreBySourceRef.current)) {
          collapseRestoreBySourceRef.current[source] = collapsedRef.current;
        }
        setCollapsed(true);
        return;
      }

      setCollapsed(detail?.collapsed ?? true);
    };

    window.addEventListener(APP_SIDEBAR_COLLAPSE_EVENT, handleCollapseRequest);
    return () => {
      window.removeEventListener(
        APP_SIDEBAR_COLLAPSE_EVENT,
        handleCollapseRequest,
      );
    };
  }, []);
  const {
    appearanceColorSchemes,
    appearanceControlRef,
    appearancePopoverOpen,
    appearanceThemeOptions,
    colorSchemeId,
    copy: appearanceCopy,
    handleColorSchemeChange,
    handleRandomColorScheme,
    handleThemeModeChange,
    setAppearancePopoverOpen,
    themeState,
  } = useAppSidebarAppearance();
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
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteDashboard, setInviteDashboard] =
    useState<OemCloudReferralDashboard | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteReloadKey, setInviteReloadKey] = useState(0);
  const [sidebarSearchOpen, setSidebarSearchOpen] = useState(false);
  const [sidebarSearchQuery, setSidebarSearchQuery] = useState("");

  const [enabledNavItems, setEnabledNavItems] = useState<string[]>(
    DEFAULT_ENABLED_SIDEBAR_NAV_ITEM_IDS,
  );
  const sidebarSearchInputRef = useRef<HTMLInputElement | null>(null);
  const reserveWindowControls = shouldReserveMacWindowControls();

  const openSidebarSearchDialog = useCallback(() => {
    setSidebarSearchOpen(true);
  }, []);

  const closeSidebarSearchDialog = useCallback(() => {
    setSidebarSearchOpen(false);
    setSidebarSearchQuery("");
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleSearchShortcut = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== "k" ||
        (!event.metaKey && !event.ctrlKey)
      ) {
        return;
      }

      event.preventDefault();
      openSidebarSearchDialog();
    };

    window.addEventListener("keydown", handleSearchShortcut);
    return () => {
      window.removeEventListener("keydown", handleSearchShortcut);
    };
  }, [openSidebarSearchDialog]);

  useEffect(() => {
    if (!sidebarSearchOpen || typeof window === "undefined") {
      return;
    }

    const focusTimer = window.setTimeout(() => {
      sidebarSearchInputRef.current?.focus();
      sidebarSearchInputRef.current?.select();
    }, 0);

    return () => {
      window.clearTimeout(focusTimer);
    };
  }, [sidebarSearchOpen]);

  useEffect(() => {
    const loadNavConfig = async () => {
      try {
        const config = await getConfig();
        const resolvedItems = resolveEnabledSidebarNavItems(
          config.navigation?.enabled_items,
          config.navigation?.schema_version,
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

  const localizeSidebarNavItem = useCallback(
    (item: SidebarNavItem): SidebarNavItem => {
      const key = SIDEBAR_NAV_LABEL_KEYS[item.id];
      if (!key) {
        return item;
      }

      return {
        ...item,
        label: t(key, item.label),
      };
    },
    [t],
  );

  const filteredMainNavItems = useMemo<SidebarNavItem[]>(() => {
    return MAIN_SIDEBAR_NAV_ITEMS.filter(
      (item) =>
        item.configurable === false || enabledNavItems.includes(item.id),
    ).map(localizeSidebarNavItem);
  }, [enabledNavItems, localizeSidebarNavItem]);

  const settingsFooterNavItem = useMemo<SidebarNavItem | null>(() => {
    return (
      FOOTER_SIDEBAR_NAV_ITEMS.find((item) => item.id === "settings") ?? null
    );
  }, []);
  const localizedSettingsFooterNavItem = useMemo<SidebarNavItem | null>(() => {
    return settingsFooterNavItem
      ? localizeSidebarNavItem(settingsFooterNavItem)
      : null;
  }, [localizeSidebarNavItem, settingsFooterNavItem]);
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
            : inviteLoadErrorLabel;
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
    inviteLoadErrorLabel,
  ]);

  useEffect(() => {
    if (inviteFeatureEnabled === false && inviteDialogOpen) {
      setInviteDialogOpen(false);
    }
  }, [inviteFeatureEnabled, inviteDialogOpen]);

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
    if (Object.keys(collapseRestoreBySourceRef.current).length > 0) {
      return;
    }

    window.localStorage.setItem(
      APP_SIDEBAR_COLLAPSED_STORAGE_KEY,
      collapsed ? "true" : "false",
    );
  }, [collapsed]);

  useEffect(() => {
    if (isContextlessPage) {
      if (routeCollapseRestoreRef.current === null) {
        routeCollapseRestoreRef.current = collapsed;
      }
      setCollapsed(true);
      return;
    }

    if (routeCollapseRestoreRef.current !== null) {
      const previous = routeCollapseRestoreRef.current;
      routeCollapseRestoreRef.current = null;
      setCollapsed(previous);
    }
  }, [collapsed, isContextlessPage]);

  useEffect(() => {
    if (isNewTaskHome || isCustomizationPage) {
      setCollapsed(false);
      return;
    }

    if (!isClawTaskCenter) {
      return;
    }

    setCollapsed(false);
  }, [isClawTaskCenter, isNewTaskHome, isCustomizationPage]);

  const toggleSidebarCollapsed = useCallback(() => {
    setCollapsed((value) => !value);
  }, []);

  const shouldShowConversationList =
    !collapsed &&
    !isCustomizationPage &&
    !(activePage === "agent" && activeAgentPageParams?.immersiveHome);
  const {
    addImportedSidebarSessionOptimistically,
    beginSidebarSessionAction,
    clearSidebarSessionAction,
    deferConversationNavigation,
    fallbackSessionId,
    hasMoreRecentSidebarSessions,
    moveSidebarSessionArchiveStateOptimistically,
    moveSidebarSessionSectionOptimistically,
    recentSessionsLoading,
    refreshSidebarSessions,
    removeSidebarSessionOptimistically,
    renameSidebarSessionOptimistically,
    shouldShowSessionLoadingState,
    showMoreRecentSessions,
    sidebarSearchHasMoreResults,
    sidebarSearchHasQuery,
    sidebarSearchResultSessions,
    sidebarSessionActionId,
    visibleRecentSidebarSessions,
  } = useAppSidebarSessions({
    currentSessionId,
    activeProjectIds: conversationScopeProjects.map((project) => project.id),
    openedProjectCwds: conversationProjectCwds,
    requireOpenedProjectCwd: requireConversationProjectCwd,
    shouldShowConversationList,
    sidebarSearchOpen,
    sidebarSearchQuery,
    isNewTaskHome,
    isClawTaskCenter,
    activeAgentStreaming,
    conversationUntitledLabel,
  });

  const isActive = (item: SidebarNavItem): boolean => {
    if (!item.page) {
      return false;
    }

    if (item.isActive) {
      return item.isActive(activePage, activePageParams);
    }

    return activePage === item.page;
  };

  const conversationActions = useAppSidebarConversationActions({
    currentProjectId,
    currentSessionId,
    conversationDisplayProjects,
    isAgentWorkspace,
    projectScopedNavigationProjectId,
    requestedNavigationTargetRef,
    onNavigate,
    closeSidebarSearchDialog,
    deferConversationNavigation,
    beginSidebarSessionAction,
    clearSidebarSessionAction,
    refreshSidebarSessions,
    renameSidebarSessionOptimistically,
    moveSidebarSessionArchiveStateOptimistically,
    moveSidebarSessionSectionOptimistically,
    removeSidebarSessionOptimistically,
    resolveLocalizedSessionTitle,
    renameConversationPromptLabel,
    renameConversationSuccessLabel,
    renameConversationErrorLabel,
    formatDeleteConversationConfirm,
    deleteConversationSuccessLabel,
    deleteConversationErrorLabel,
  });

  const handleNavigate = (item: SidebarNavItem) => {
    if (item.id === "home-general") {
      conversationActions.navigateToHome();
      return;
    }

    if (item.id === "workbench") {
      conversationActions.navigateToWorkbench(fallbackSessionId);
      return;
    }

    const target = resolveSidebarNavigationTarget(item);

    if (!target) {
      return;
    }

    const scopedTarget =
      item.id === "scheduled-tasks" && projectScopedNavigationProjectId
        ? (() => {
            const rawParams = {
              ...(target.rawParams as ScheduledTasksPageParams | undefined),
              projectId: projectScopedNavigationProjectId,
            } satisfies ScheduledTasksPageParams;
            return {
              ...target,
              rawParams,
              paramsKey: serializeNavigationParams(rawParams),
            } satisfies SidebarNavigationTarget;
          })()
        : item.id === "plugins" && projectScopedNavigationProjectId
          ? (() => {
              const rawParams = {
                ...(target.rawParams as PluginsPageParams | undefined),
                currentProjectId: projectScopedNavigationProjectId,
              } satisfies PluginsPageParams;
              return {
                ...target,
                rawParams,
                paramsKey: serializeNavigationParams(rawParams),
              } satisfies SidebarNavigationTarget;
            })()
          : target;

    if (
      isSameSidebarNavigationTarget(
        scopedTarget,
        requestedNavigationTargetRef.current.page,
        requestedNavigationTargetRef.current.rawParams,
      )
    ) {
      return;
    }

    requestedNavigationTargetRef.current = scopedTarget;
    onNavigate(scopedTarget.page, scopedTarget.rawParams);
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
    const displayLabel =
      item.id === "home-general"
        ? t("navigation.sidebar.items.newChat", "新聊天")
        : item.label;
    const button = (
      <NavButton
        key={item.id}
        $active={active}
        $collapsed={collapsed}
        $hiddenInExpanded={item.id !== "home-general"}
        onClick={() => handleNavigate(item)}
        title={item.label}
        aria-label={item.label}
        aria-current={active ? "page" : undefined}
        data-testid={
          isClawTaskCenter && item.id !== "home-general"
            ? undefined
            : `app-sidebar-nav-${item.id}`
        }
      >
        <item.icon />
        <NavLabel $collapsed={collapsed}>{displayLabel}</NavLabel>
        {item.id === "home-general" ? (
          <span style={{ display: "none" }}>{item.label}</span>
        ) : null}
      </NavButton>
    );

    return maybeWrapWithTooltip(button, item.label);
  };

  const conversationImport = useAppSidebarConversationImport({
    addImportedSidebarSessionOptimistically,
    refreshSidebarSessions,
    onImportedSession: (response) => {
      conversationActions.navigateToConversation({
        id: response.session.sessionId,
        name: response.thread.title ?? response.session.sessionId,
        created_at: Math.floor(Date.parse(response.session.createdAt) / 1000),
        updated_at: Math.floor(Date.parse(response.session.updatedAt) / 1000),
        archived_at: null,
        workspace_id: response.session.workspaceId ?? undefined,
        working_dir: response.thread.cwd ?? undefined,
      });
    },
  });

  const projectActions = useAppSidebarProjectActions({
    currentProjectId: projectScopedNavigationProjectId,
    onNavigate,
    refreshSidebarSessions,
  });

  const accountTenantLabel = resolveAccountTenantLabel(cloudSessionState);
  const cloudBrandLabel = resolveCloudBrandLabel(
    cloudBootstrapState,
    accountDefaultCloudBrandLabel,
    accountCloudSuffixLabel,
  );
  const hasCloudAccount = Boolean(cloudSessionState);
  const inviteEntryVisible = inviteFeatureEnabled;
  const homeLabel = t("navigation.sidebar.home.label", "Lime 首页");
  const homeAriaLabel = t(
    "navigation.sidebar.home.ariaLabel",
    "返回 Lime 首页",
  );
  const collapseNavigationLabel = t(
    "navigation.sidebar.actions.collapse",
    "折叠导航栏",
  );
  const expandNavigationLabel = t(
    "navigation.sidebar.actions.expand",
    "展开导航栏",
  );
  const navigationToggleLabel = collapsed
    ? expandNavigationLabel
    : collapseNavigationLabel;
  const searchTaskLabel = t("navigation.sidebar.search.label", "搜索任务");
  const searchConversationTitleLabel = t(
    "navigation.sidebar.search.inputLabel",
    "搜索对话标题",
  );
  const closeSearchDialogLabel = t(
    "navigation.sidebar.search.close",
    "关闭搜索弹窗",
  );
  const createConversationLabel = t(
    "navigation.sidebar.search.createConversation",
    "新建对话",
  );
  const searchMatchesLabel = t(
    "navigation.sidebar.search.section.matches",
    "匹配结果",
  );
  const searchRecentLabel = t(
    "navigation.sidebar.search.section.recent",
    "最近",
  );
  const searchLoadingLabel = t(
    "navigation.sidebar.search.loading",
    "正在加载对话",
  );
  const searchSelectProjectFirstLabel = t(
    "navigation.sidebar.search.selectProjectFirst",
    "请先选择项目工作区",
  );
  const searchEmptyMatchesLabel = t(
    "navigation.sidebar.search.emptyMatches",
    "没有匹配的对话标题",
  );
  const searchEmptyRecentLabel = t(
    "navigation.sidebar.search.emptyRecent",
    "还没有最近对话",
  );
  const searchLoadingMoreLabel = t(
    "navigation.sidebar.search.loadingMore",
    "正在加载...",
  );
  const searchMoreMatchesLabel = t(
    "navigation.sidebar.search.moreMatches",
    "查看更多匹配结果",
  );
  const searchMoreRecentLabel = t(
    "navigation.sidebar.search.moreRecent",
    "查看更多对话",
  );
  const accountLoginOpenedLabel = t("navigation.sidebar.account.login.opened", {
    brand: cloudBrandLabel,
    defaultValue: "已打开 {{brand}} 登录页，请在浏览器完成授权",
  });
  const accountLoginFailedFallbackLabel = t(
    "navigation.sidebar.account.login.failed",
    {
      brand: cloudBrandLabel,
      defaultValue: "打开 {{brand}} 登录页失败",
    },
  );
  const inviteShare = inviteDashboard?.share;
  const inviteEntryLabel = t(
    "navigation.sidebar.invite.entry.label",
    "邀请好友",
  );
  const inviteCloseDialogLabel = t(
    "navigation.sidebar.invite.dialog.close",
    "关闭邀请弹窗",
  );
  const inviteBrandName =
    inviteShare?.brandName ?? accountTenantLabel ?? "Lime";
  const inviteEyebrowLabel = t("navigation.sidebar.invite.dialog.eyebrow", {
    brand: inviteBrandName,
    defaultValue: "{{brand}} 邀请",
  });
  const inviteDialogTitleLabel = t(
    "navigation.sidebar.invite.dialog.title",
    "邀请好友",
  );
  const inviteHeadline =
    inviteShare?.headline?.trim() ||
    t("navigation.sidebar.invite.dialog.headlineFallback", "邀请好友加入内测");
  const inviteRules =
    inviteShare?.rules?.trim() ||
    t(
      "navigation.sidebar.invite.dialog.rulesFallback",
      "通过云端邀请策略自动发放奖励，具体到账以当前品牌云端配置为准。",
    );
  const inviteDescriptionLabel =
    !inviteLoading && !inviteError
      ? t("navigation.sidebar.invite.dialog.descriptionWithRules", {
          headline: inviteHeadline,
          rules: inviteRules,
          defaultValue: "{{headline}}。{{rules}}",
        })
      : inviteHeadline;
  const inviteDisconnectedLabel = t(
    "navigation.sidebar.invite.status.disconnected",
    {
      brand: cloudBrandLabel,
      defaultValue:
        "连接 {{brand}} 后会生成专属邀请码，并自动读取当前品牌云端的域名和奖励策略。",
    },
  );
  const inviteConnectAccountLabel = t(
    "navigation.sidebar.invite.actions.connectCloudAccount",
    "连接云端账号",
  );
  const inviteLoadingLabel = t(
    "navigation.sidebar.invite.status.loading",
    "正在从云端同步邀请信息...",
  );
  const inviteRetryLabel = t("navigation.sidebar.invite.actions.retry", "重试");
  const inviteCodeLabel = t("navigation.sidebar.invite.fields.code", "邀请码");
  const inviteCopyLabel = t("navigation.sidebar.invite.actions.copy", "复制");
  const inviteDownloadUrlLabel = t(
    "navigation.sidebar.invite.fields.downloadUrl",
    "下载地址",
  );
  const inviteLandingUrlLabel = t(
    "navigation.sidebar.invite.fields.landingUrl",
    "邀请链接",
  );
  const inviteReferrerRewardLabel = t(
    "navigation.sidebar.invite.fields.referrerReward",
    "邀请人奖励",
  );
  const inviteInviteeRewardLabel = t(
    "navigation.sidebar.invite.fields.inviteeReward",
    "被邀请人奖励",
  );
  const inviteCopyShareTextLabel = t(
    "navigation.sidebar.invite.actions.copyShareText",
    "复制邀请文案",
  );
  const inviteCopyLandingUrlLabel = t(
    "navigation.sidebar.invite.actions.copyLandingUrl",
    "复制邀请链接",
  );
  const inviteCopyCodeSuccessLabel = t(
    "navigation.sidebar.invite.feedback.codeCopied",
    "已复制邀请码",
  );
  const inviteCopyShareTextSuccessLabel = t(
    "navigation.sidebar.invite.feedback.shareTextCopied",
    "已复制邀请文案",
  );
  const inviteCopyLandingUrlSuccessLabel = t(
    "navigation.sidebar.invite.feedback.landingUrlCopied",
    "已复制邀请链接",
  );
  const inviteCopyEmptyLabel = t(
    "navigation.sidebar.invite.feedback.emptyCopy",
    "暂无可复制内容",
  );
  const inviteCopyFailedLabel = t(
    "navigation.sidebar.invite.feedback.copyFailed",
    "复制失败，请检查剪贴板权限",
  );
  const inviteRewardCurrentPolicyLabel = t(
    "navigation.sidebar.invite.reward.currentPolicy",
    "按当前策略发放",
  );
  const formatInviteReferralCredits = useCallback(
    (value: number | undefined): string => {
      if (typeof value !== "number" || value <= 0) {
        return inviteRewardCurrentPolicyLabel;
      }

      return t("navigation.sidebar.invite.reward.credits", {
        amount: value.toLocaleString(i18n.language),
        defaultValue: "{{amount}} 积分",
      });
    },
    [i18n.language, inviteRewardCurrentPolicyLabel, t],
  );

  const handleAccountLogin = useCallback(async () => {
    const browserTarget = createExternalBrowserOpenTarget();
    try {
      await startOemCloudLogin(undefined, {
        browserTarget,
        waitForCompletion: false,
      });
      toast.success(accountLoginOpenedLabel);
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim()
          ? error.message.trim()
          : accountLoginFailedFallbackLabel;
      toast.error(message);
    }
  }, [accountLoginFailedFallbackLabel, accountLoginOpenedLabel]);

  const handleCopyInviteText = useCallback(
    async (value: string | undefined, successMessage: string) => {
      const text = value?.trim();
      if (!text) {
        toast.info(inviteCopyEmptyLabel);
        return;
      }

      try {
        if (!navigator.clipboard?.writeText) {
          throw new Error("clipboard unavailable");
        }
        await navigator.clipboard.writeText(text);
        toast.success(successMessage);
      } catch {
        toast.error(inviteCopyFailedLabel);
      }
    },
    [inviteCopyEmptyLabel, inviteCopyFailedLabel],
  );

  return (
    <TooltipProvider>
      <Container
        $collapsed={collapsed}
        $themeMode={themeState.effectiveThemeMode}
        $reserveWindowControls={reserveWindowControls}
        data-testid="app-sidebar"
        data-collapsed={String(collapsed)}
        data-lime-window-drag-region
        data-window-controls-reserved={String(reserveWindowControls)}
        onMouseDown={onStartWindowDrag}
      >
        <AppSidebarRail
          collapsed={collapsed}
          homeLabel={homeLabel}
          expandLabel={expandNavigationLabel}
          homeActive={isNewTaskHome}
          items={filteredMainNavItems.filter(
            (item) => item.id !== "home-general",
          )}
          settingsItem={localizedSettingsFooterNavItem}
          isActive={isActive}
          onHome={() => handleNavigate(MAIN_SIDEBAR_NAV_ITEMS[0])}
          onNavigate={handleNavigate}
          onExpand={
            collapsed && !isContextlessPage
              ? toggleSidebarCollapsed
              : undefined
          }
          searchSlot={
            <Tooltip>
              <TooltipTrigger asChild>
                <IconActionButton
                  type="button"
                  title={searchTaskLabel}
                  aria-label={searchTaskLabel}
                  aria-haspopup="dialog"
                  aria-expanded={sidebarSearchOpen ? true : undefined}
                  data-testid="app-sidebar-rail-search-button"
                  onClick={openSidebarSearchDialog}
                >
                  <Search size={15} />
                </IconActionButton>
              </TooltipTrigger>
              <TooltipContent side="right">{searchTaskLabel}</TooltipContent>
            </Tooltip>
          }
          appearanceSlot={
            <FooterAppearanceActionSlot ref={appearanceControlRef}>
              <IconActionButton
                type="button"
                $active={appearancePopoverOpen}
                title={appearanceCopy.entryLabel}
                aria-label={appearanceCopy.entryLabel}
                aria-expanded={appearancePopoverOpen}
                aria-haspopup="dialog"
                data-testid="app-sidebar-rail-appearance"
                onClick={() => {
                  setAppearancePopoverOpen((current) => !current);
                }}
              >
                <Palette />
              </IconActionButton>
              {appearancePopoverOpen ? (
                <AppSidebarAppearancePopover
                  themeMode={themeState.themeMode}
                  colorSchemeId={colorSchemeId}
                  themeOptions={appearanceThemeOptions}
                  colorSchemes={appearanceColorSchemes}
                  copy={appearanceCopy}
                  onThemeModeChange={handleThemeModeChange}
                  onColorSchemeChange={handleColorSchemeChange}
                  onRandomColorScheme={handleRandomColorScheme}
                />
              ) : null}
            </FooterAppearanceActionSlot>
          }
        />
        <SidebarSurface $collapsed={collapsed}>
          {isCustomizationPage && !collapsed ? (
            <AppSidebarCustomization
              currentPage={activePage}
              pageParams={activePageParams}
              projectId={projectScopedNavigationProjectId}
              onNavigate={onNavigate}
            />
          ) : (
            <>
              <HeaderArea
                $collapsed={collapsed}
                data-testid="app-sidebar-header"
              >
                <HeaderTopRow $collapsed={collapsed}>
                  {maybeWrapWithTooltip(
                    <UserButton
                      $collapsed={collapsed}
                      onClick={() =>
                        onNavigate("agent", buildHomeAgentParams())
                      }
                      aria-label={homeAriaLabel}
                      title={homeAriaLabel}
                      data-testid="app-sidebar-home-button"
                    >
                      <Avatar>
                        <img src={LIME_BRAND_LOGO_SRC} alt={LIME_BRAND_NAME} />
                      </Avatar>
                      <UserName $collapsed={collapsed}>
                        {LIME_BRAND_NAME}
                      </UserName>
                    </UserButton>,
                    homeLabel,
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
                          title={inviteEntryLabel}
                          aria-label={inviteEntryLabel}
                          data-testid="app-sidebar-invite-button"
                        >
                          <Bell />
                          <span>{inviteEntryLabel}</span>
                        </HeaderInviteButton>,
                        inviteEntryLabel,
                      )
                    : null}

                  {maybeWrapWithTooltip(
                    <IconActionButton
                      onClick={toggleSidebarCollapsed}
                      title={navigationToggleLabel}
                      aria-label={navigationToggleLabel}
                    >
                      {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
                    </IconActionButton>,
                    navigationToggleLabel,
                  )}
                </HeaderTopRow>
                {maybeWrapWithTooltip(
                  <SearchButton
                    $collapsed={collapsed}
                    onClick={openSidebarSearchDialog}
                    title={searchTaskLabel}
                    aria-label={searchTaskLabel}
                    aria-haspopup="dialog"
                    aria-expanded={sidebarSearchOpen ? true : undefined}
                    data-testid="app-sidebar-search-button"
                  >
                    <Search size={14} />
                    <span>{searchTaskLabel}</span>
                  </SearchButton>,
                  searchTaskLabel,
                )}
              </HeaderArea>

              <MenuScroll data-testid="app-sidebar-menu-scroll">
                {!collapsed ? (
                  <MainNavList data-testid="app-sidebar-main-nav">
                    {filteredMainNavItems.map((item) => renderNavItem(item))}
                  </MainNavList>
                ) : null}

                {shouldShowConversationList ? (
                  <AppSidebarConversationShelf
                    openedProjects={conversationDisplayProjects}
                    recentSessions={visibleRecentSidebarSessions}
                    currentSessionId={currentSessionId}
                    activeAgentStreaming={activeAgentStreaming}
                    backgroundAgentSessionRuntime={
                      backgroundAgentSessionRuntime
                    }
                    recentLoading={shouldShowSessionLoadingState}
                    hasMoreRecent={hasMoreRecentSidebarSessions}
                    actionSessionId={sidebarSessionActionId}
                    onCreateConversation={(project) => {
                      if (project) {
                        conversationActions.navigateToProjectNewTask(project);
                        return;
                      }
                      conversationActions.navigateToStandaloneConversation();
                    }}
                    onImportConversation={conversationImport.open}
                    onNavigateToConversation={
                      conversationActions.navigateToConversation
                    }
                    onRenameConversation={
                      conversationActions.renameConversation
                    }
                    onDeleteConversation={
                      conversationActions.deleteConversation
                    }
                    onToggleArchive={(session, archived) => {
                      void conversationActions.toggleSessionArchive(
                        session,
                        archived,
                      );
                    }}
                    onTogglePinned={(session) => {
                      void conversationActions.toggleSessionPinned(session);
                    }}
                    onMoveToSection={(session, section) => {
                      void conversationActions.moveSessionToSection(
                        session,
                        section,
                      );
                    }}
                    onToggleProjectPin={(project) => {
                      void projectActions.handleToggleProjectPin(project);
                    }}
                    onRevealProject={(project) => {
                      void projectActions.handleRevealProject(project);
                    }}
                    onCreateProjectWorktree={(project) => {
                      void projectActions.handleCreateProjectWorktree(project);
                    }}
                    onRenameProject={(project) => {
                      void projectActions.handleRenameProject(project);
                    }}
                    onRemoveProject={(project) => {
                      void projectActions.handleRemoveProject(project);
                    }}
                    onRefreshConversations={refreshSidebarSessions}
                    onShowMoreRecent={showMoreRecentSessions}
                  />
                ) : null}
              </MenuScroll>
            </>
          )}

        </SidebarSurface>
      </Container>
      <AppSidebarSearchDialog
        isOpen={sidebarSearchOpen}
        query={sidebarSearchQuery}
        inputRef={sidebarSearchInputRef}
        copy={{
          inputLabel: searchConversationTitleLabel,
          closeLabel: closeSearchDialogLabel,
          createConversationLabel,
          matchesLabel: searchMatchesLabel,
          recentLabel: searchRecentLabel,
          loadingLabel: searchLoadingLabel,
          selectProjectFirstLabel: searchSelectProjectFirstLabel,
          emptyMatchesLabel: searchEmptyMatchesLabel,
          emptyRecentLabel: searchEmptyRecentLabel,
          loadingMoreLabel: searchLoadingMoreLabel,
          moreMatchesLabel: searchMoreMatchesLabel,
          moreRecentLabel: searchMoreRecentLabel,
        }}
        sessions={sidebarSearchResultSessions}
        currentProjectId={currentProjectId}
        currentSessionId={currentSessionId}
        hasQuery={sidebarSearchHasQuery}
        hasMoreResults={sidebarSearchHasMoreResults}
        loading={shouldShowSessionLoadingState}
        loadingMore={recentSessionsLoading}
        resolveSessionTitle={resolveLocalizedSessionTitle}
        formatSessionMeta={formatLocalizedSessionMeta}
        onClose={closeSidebarSearchDialog}
        onQueryChange={setSidebarSearchQuery}
        onCreateConversation={conversationActions.createConversationFromSearch}
        onResultClick={conversationActions.navigateToConversationFromSearch}
        onShowMore={showMoreRecentSessions}
      />
      <AppSidebarInviteDialog
        isOpen={inviteDialogOpen}
        hasCloudAccount={hasCloudAccount}
        loading={inviteLoading}
        error={inviteError}
        dashboard={inviteDashboard}
        copy={{
          closeLabel: inviteCloseDialogLabel,
          eyebrowLabel: inviteEyebrowLabel,
          titleLabel: inviteDialogTitleLabel,
          descriptionLabel: inviteDescriptionLabel,
          disconnectedLabel: inviteDisconnectedLabel,
          connectAccountLabel: inviteConnectAccountLabel,
          loadingLabel: inviteLoadingLabel,
          retryLabel: inviteRetryLabel,
          codeLabel: inviteCodeLabel,
          copyLabel: inviteCopyLabel,
          downloadUrlLabel: inviteDownloadUrlLabel,
          landingUrlLabel: inviteLandingUrlLabel,
          referrerRewardLabel: inviteReferrerRewardLabel,
          inviteeRewardLabel: inviteInviteeRewardLabel,
          copyShareTextLabel: inviteCopyShareTextLabel,
          copyLandingUrlLabel: inviteCopyLandingUrlLabel,
          copyCodeSuccessLabel: inviteCopyCodeSuccessLabel,
          copyShareTextSuccessLabel: inviteCopyShareTextSuccessLabel,
          copyLandingUrlSuccessLabel: inviteCopyLandingUrlSuccessLabel,
        }}
        formatReferralCredits={formatInviteReferralCredits}
        onClose={() => setInviteDialogOpen(false)}
        onConnectAccount={() => {
          setInviteDialogOpen(false);
          void handleAccountLogin();
        }}
        onRetry={() => setInviteReloadKey((value) => value + 1)}
        onCopyText={(value, successMessage) =>
          void handleCopyInviteText(value, successMessage)
        }
      />
      <AppSidebarConversationImportDialog {...conversationImport.dialogProps} />
    </TooltipProvider>
  );
}
