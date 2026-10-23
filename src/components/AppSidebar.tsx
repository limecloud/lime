/**
 * 全局应用侧边栏
 *
 * 图标导航栏与可伸缩上下文侧栏并列；折叠时保留图标导航。
 */

import {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  Home,
  Palette,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  AgentPageParams,
  Page,
  PageParams,
  PluginsPageParams,
  ScheduledTasksPageParams,
} from "@/types/page";
import { getConfig, subscribeAppConfigChanged } from "@/lib/api/appConfig";
import type { StartNewConversation } from "@/lib/workspace/navigation";
import type { AgentSessionInfo } from "@/lib/api/agentRuntime/sessionTypes";
import {
  DEFAULT_ENABLED_SIDEBAR_NAV_ITEM_IDS,
  FOOTER_SIDEBAR_NAV_ITEMS,
  MAIN_SIDEBAR_NAV_ITEMS,
  resolveEnabledSidebarNavItems,
  type SidebarNavItemDefinition,
} from "@/lib/navigation/sidebarNav";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LIME_BRAND_NAME } from "@/lib/branding";
import { useCommand } from "@/lib/commands/useCommand";
import { AppSidebarCustomization } from "@/components/app-sidebar/AppSidebarCustomization";
import { HeaderAction } from "@/components/app-shell/AppShell";
import {
  AppNavigationRail,
  NavigationRailButton,
  NavigationRailTooltip,
} from "@/components/app-sidebar/AppNavigationRail";
import { SidebarResizeHandle } from "@/components/app-sidebar/SidebarResizeHandle";
import { useSidebarWidth } from "@/components/app-sidebar/useSidebarWidth";
import { AppSidebarAppearancePopover } from "@/components/app-sidebar/AppSidebarAppearancePopover";
import { AppSidebarConversationShelf } from "@/components/app-sidebar/AppSidebarConversationShelf";
import { AppSidebarSearchDialog } from "@/components/app-sidebar/AppSidebarSearchDialog";
import type { AgentBackgroundSessionRuntimeSnapshot } from "@/components/agent/chat";
import { useOpenedProjectSummaries } from "@/components/agent/chat/hooks/useOpenedProjectSummaries";
import { useAppSidebarAppearance } from "@/components/app-sidebar/useAppSidebarAppearance";
import { useAppSidebarConversationActions } from "@/components/app-sidebar/useAppSidebarConversationActions";
import { useAppSidebarProjectActions } from "@/components/app-sidebar/useAppSidebarProjectActions";
import { useAppSidebarSessions } from "@/components/app-sidebar/useAppSidebarSessions";
import { useSidebarThreadSearch } from "@/components/app-sidebar/useSidebarThreadSearch";
import { mergeSidebarThreadSearchSessions } from "@/components/app-sidebar/sidebarThreadSearch";
import type { SidebarOpenedProjectSummary } from "@/components/app-sidebar/sidebarConversationGroups";
import {
  APP_SIDEBAR_MIN_WIDTH,
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
  UserName,
  SearchButton,
  MenuScroll,
  MainNavList,
  NavButton,
  NavLabel,
  FooterAppearanceActionSlot,
  IconActionButton,
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
import { SidebarProfileFooter } from "@/components/app-sidebar/SidebarProfileFooter";
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
  onStartNewConversation?: StartNewConversation;
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
  onStartNewConversation,
  onStartWindowDrag,
}: AppSidebarProps) {
  const { t, i18n } = useTranslation("navigation");
  const conversationUntitledLabel = t(
    "navigation.sidebar.conversations.untitled",
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
  );
  const renameConversationSuccessLabel = t(
    "navigation.sidebar.conversations.rename.success",
  );
  const renameConversationErrorLabel = t(
    "navigation.sidebar.conversations.rename.error",
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
  );
  const deleteConversationErrorLabel = t(
    "navigation.sidebar.conversations.delete.error",
  );
  const activePage = requestedPage ?? currentPage;
  const activePageParams = requestedPageParams ?? currentPageParams;
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
      conversationDisplayProjects
        .map((project) => project.rootPath?.trim())
        .filter((rootPath): rootPath is string => Boolean(rootPath)),
    [conversationDisplayProjects],
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
  const [preferredCollapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return (
      window.localStorage.getItem(APP_SIDEBAR_COLLAPSED_STORAGE_KEY) === "true"
    );
  });
  const collapsed = activePage === "settings" || preferredCollapsed;
  const { width: sidebarWidth, setWidth: setSidebarWidth } = useSidebarWidth(
    APP_SIDEBAR_MIN_WIDTH,
  );
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleCollapseRequest = (event: Event) => {
      const detail = (event as CustomEvent<{ collapsed?: boolean }>).detail;
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
  const [sidebarSearchOpen, setSidebarSearchOpen] = useState(false);
  const [sidebarSearchQuery, setSidebarSearchQuery] = useState("");

  const [enabledNavItems, setEnabledNavItems] = useState<string[]>(
    DEFAULT_ENABLED_SIDEBAR_NAV_ITEM_IDS,
  );
  const sidebarSearchInputRef = useRef<HTMLInputElement | null>(null);

  const openSidebarSearchDialog = useCallback(() => {
    setSidebarSearchOpen(true);
  }, []);

  const closeSidebarSearchDialog = useCallback(() => {
    setSidebarSearchOpen(false);
    setSidebarSearchQuery("");
  }, []);

  useCommand({
    id: "searchThreads",
    titleKey: "commands.searchThreads.title",
    descriptionKey: "commands.searchThreads.description",
    section: "navigation",
    bindings: ["CommandOrControl+K"],
    enabled: true,
    allowInInput: true,
    handler: openSidebarSearchDialog,
  });

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
      preferredCollapsed ? "true" : "false",
    );
  }, [preferredCollapsed]);

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
    activeProjectIds: conversationDisplayProjects.map((project) => project.id),
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
  const threadSearch = useSidebarThreadSearch(
    sidebarSearchQuery,
    sidebarSearchOpen,
  );
  const sidebarSearchSessions = useMemo(
    () =>
      sidebarSearchHasQuery
        ? mergeSidebarThreadSearchSessions({
            titleMatches: sidebarSearchResultSessions,
            protocolHits: threadSearch.hits,
          })
        : sidebarSearchResultSessions,
    [sidebarSearchHasQuery, sidebarSearchResultSessions, threadSearch.hits],
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

  const conversationActions = useAppSidebarConversationActions({
    currentProjectId,
    currentSessionId,
    conversationDisplayProjects,
    isAgentWorkspace,
    projectScopedNavigationProjectId,
    requestedNavigationTargetRef,
    onNavigate,
    onStartNewConversation,
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
    if (item.id === "new-chat") {
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

  const renderNavItem = (item: SidebarNavItem, iconOnly = false) => {
    const Button = iconOnly ? NavigationRailButton : NavButton;
    const active = isActive(item);
    const displayLabel = item.label;
    const button = (
      <Button
        key={item.id}
        $active={active}
        onClick={() => handleNavigate(item)}
        title={item.label}
        aria-label={item.label}
        aria-current={active ? "page" : undefined}
        data-testid={`app-sidebar-nav-${item.id}`}
      >
        <item.icon />
        {iconOnly ? (
          <span className="sr-only">{displayLabel}</span>
        ) : (
          <NavLabel>{displayLabel}</NavLabel>
        )}
      </Button>
    );

    return iconOnly ? (
      <NavigationRailTooltip key={item.id} label={item.label}>
        {button}
      </NavigationRailTooltip>
    ) : (
      button
    );
  };

  const projectActions = useAppSidebarProjectActions({
    currentProjectId: projectScopedNavigationProjectId,
    onNavigate,
    refreshSidebarSessions,
  });

  const homeLabel = t("navigation.sidebar.home.label");
  const homeAriaLabel = t("navigation.sidebar.home.ariaLabel");
  const collapseNavigationLabel = t("navigation.sidebar.actions.collapse");
  const expandNavigationLabel = t("navigation.sidebar.actions.expand");
  const navigationToggleLabel = collapsed
    ? expandNavigationLabel
    : collapseNavigationLabel;
  const searchTaskLabel = t("navigation.sidebar.search.label");
  const searchConversationTitleLabel = t(
    "navigation.sidebar.search.inputLabel",
  );
  const closeSearchDialogLabel = t("navigation.sidebar.search.close");
  const createConversationLabel = t(
    "navigation.sidebar.search.createConversation",
  );
  const searchMatchesLabel = t("navigation.sidebar.search.section.matches");
  const searchRecentLabel = t("navigation.sidebar.search.section.recent");
  const searchLoadingLabel = t("navigation.sidebar.search.loading");
  const searchSelectProjectFirstLabel = t(
    "navigation.sidebar.search.selectProjectFirst",
  );
  const searchEmptyMatchesLabel = t("navigation.sidebar.search.emptyMatches");
  const searchContentErrorLabel = t("navigation.sidebar.search.contentError");
  const searchEmptyRecentLabel = t("navigation.sidebar.search.emptyRecent");
  const searchLoadingMoreLabel = t("navigation.sidebar.search.loadingMore");
  const searchMoreMatchesLabel = t("navigation.sidebar.search.moreMatches");
  const searchMoreRecentLabel = t("navigation.sidebar.search.moreRecent");

  return (
    <TooltipProvider>
      {activePage !== "settings" ? (
        <HeaderAction actionId="sidebar-trigger" slotPosition="left" order={1}>
          <IconActionButton
            type="button"
            title={navigationToggleLabel}
            aria-label={navigationToggleLabel}
            data-testid={
              collapsed ? "app-sidebar-expand" : "app-sidebar-collapse"
            }
            onClick={toggleSidebarCollapsed}
          >
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </IconActionButton>
        </HeaderAction>
      ) : null}
      <Container
        $collapsed={collapsed}
        $themeMode={themeState.effectiveThemeMode}
        data-testid="app-sidebar"
        data-collapsed={String(collapsed)}
        data-lime-window-drag-region
        style={
          { "--sidebar-preferred-width": `${sidebarWidth}px` } as CSSProperties
        }
        onMouseDown={onStartWindowDrag}
      >
        <AppNavigationRail
          label={t("navigation.sidebar.landmark")}
          footer={
            <>
              <FooterAppearanceActionSlot ref={appearanceControlRef}>
                <NavigationRailButton
                  type="button"
                  $active={appearancePopoverOpen}
                  title={appearanceCopy.entryLabel}
                  aria-label={appearanceCopy.entryLabel}
                  aria-expanded={appearancePopoverOpen}
                  aria-haspopup="dialog"
                  data-testid="app-sidebar-appearance"
                  onClick={() => {
                    setAppearancePopoverOpen((current) => !current);
                  }}
                >
                  <Palette />
                </NavigationRailButton>
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
              {localizedSettingsFooterNavItem
                ? renderNavItem(localizedSettingsFooterNavItem, true)
                : null}
              <SidebarProfileFooter onNavigate={onNavigate} />
            </>
          }
        >
          <NavigationRailTooltip label={homeLabel}>
            <NavigationRailButton
              type="button"
              $active={activePage === "agent"}
              aria-label={homeLabel}
              title={homeLabel}
              aria-current={activePage === "agent" ? "page" : undefined}
              data-testid="app-sidebar-rail-home"
              onClick={() => {
                setCollapsed(false);
                onStartNewConversation?.({
                  projectId: null,
                  freshDraft: false,
                });
              }}
            >
              <Home />
            </NavigationRailButton>
          </NavigationRailTooltip>
          {filteredMainNavItems
            .filter((item) => item.id !== "new-chat")
            .map((item) => renderNavItem(item, true))}
        </AppNavigationRail>
        <SidebarSurface
          $collapsed={collapsed}
          data-testid="app-sidebar-contextual"
        >
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
                  <UserButton
                    $collapsed={collapsed}
                    onClick={() =>
                      onStartNewConversation?.({
                        projectId: null,
                        freshDraft: false,
                      })
                    }
                    aria-label={homeAriaLabel}
                    title={homeAriaLabel}
                    data-testid="app-sidebar-home-button"
                  >
                    <UserName $collapsed={collapsed}>
                      {LIME_BRAND_NAME}
                    </UserName>
                  </UserButton>

                  <SearchButton
                    $inline
                    onClick={openSidebarSearchDialog}
                    title={searchTaskLabel}
                    aria-label={searchTaskLabel}
                    aria-haspopup="dialog"
                    aria-expanded={sidebarSearchOpen ? true : undefined}
                    data-testid="app-sidebar-search-button"
                  >
                    <Search size={14} />
                  </SearchButton>
                </HeaderTopRow>
              </HeaderArea>

              <MenuScroll data-testid="app-sidebar-menu-scroll">
                {!collapsed ? (
                  <MainNavList data-testid="app-sidebar-main-nav">
                    {filteredMainNavItems
                      .filter((item) => item.id === "new-chat")
                      .map((item) => renderNavItem(item))}
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
        {!collapsed ? (
          <SidebarResizeHandle
            width={sidebarWidth}
            minimumWidth={APP_SIDEBAR_MIN_WIDTH}
            onWidthChange={setSidebarWidth}
          />
        ) : null}
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
          contentSearchErrorLabel: searchContentErrorLabel,
          loadingMoreLabel: searchLoadingMoreLabel,
          moreMatchesLabel: searchMoreMatchesLabel,
          moreRecentLabel: searchMoreRecentLabel,
        }}
        sessions={sidebarSearchSessions}
        contentSearchError={threadSearch.error}
        currentProjectId={currentProjectId}
        currentSessionId={currentSessionId}
        hasQuery={sidebarSearchHasQuery}
        hasMoreResults={
          sidebarSearchHasMoreResults ||
          (sidebarSearchHasQuery && threadSearch.hasMore)
        }
        loading={
          shouldShowSessionLoadingState ||
          (sidebarSearchHasQuery &&
            threadSearch.loading &&
            sidebarSearchSessions.length === 0)
        }
        loadingMore={
          recentSessionsLoading ||
          (sidebarSearchHasQuery &&
            threadSearch.loading &&
            threadSearch.hits.length > 0)
        }
        resolveSessionTitle={resolveLocalizedSessionTitle}
        formatSessionMeta={formatLocalizedSessionMeta}
        onClose={closeSidebarSearchDialog}
        onQueryChange={setSidebarSearchQuery}
        onCreateConversation={conversationActions.createConversationFromSearch}
        onResultClick={conversationActions.navigateToConversationFromSearch}
        onShowMore={() => {
          if (sidebarSearchHasQuery && threadSearch.hasMore) {
            threadSearch.loadMore();
            return;
          }
          showMoreRecentSessions();
        }}
      />
    </TooltipProvider>
  );
}
