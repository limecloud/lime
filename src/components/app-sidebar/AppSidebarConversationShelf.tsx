import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
} from "react";
import { useTranslation } from "react-i18next";
import {
  Archive,
  Check,
  CheckCheck,
  FolderPlus,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type {
  AgentSessionInfo,
  AgentSessionSection,
} from "@/lib/api/agentRuntime/sessionTypes";
import type { AgentBackgroundSessionRuntimeSnapshot } from "@/components/agent/chat";
import {
  resolveUnfinishedSessionProjection,
  type AgentUnfinishedSessionStatus,
} from "@/components/agent/chat/projection/unfinishedSessionProjection";
import {
  formatSidebarSessionMeta,
  resolveSidebarSessionTitle,
} from "@/components/app-sidebar/sidebarSessionFormatting";
import { AppSidebarConversationRow } from "@/components/app-sidebar/AppSidebarConversationRow";
import { AppSidebarConversationEmptyState } from "@/components/app-sidebar/AppSidebarConversationEmptyState";
import { AppSidebarLoadMore } from "./AppSidebarLoadMore";
import { AppSidebarProjectConversationGroups } from "@/components/app-sidebar/AppSidebarProjectConversationGroups";
import {
  AppSidebarConversationMenus,
  CONVERSATION_MENU_APPROX_HEIGHT,
  CONVERSATION_MENU_VIEWPORT_MARGIN,
  CONVERSATION_MENU_WIDTH,
  type ConversationMenuState,
  type ProjectMenuState,
} from "@/components/app-sidebar/AppSidebarConversationMenus";
import {
  buildSidebarConversationGroups,
  type SidebarOpenedProjectSummary,
} from "@/components/app-sidebar/sidebarConversationGroups";
import { resolveSidebarFloatingMenuPosition } from "@/components/app-sidebar/sidebarFloatingMenuPosition";
import { PINNED_THREAD_SECTION } from "@/lib/api/threadSections";
import { subscribeSessionPinToggle } from "@/lib/sessionPinEvents";
import { markSessionRead } from "@/lib/sessionUnreadState";
import { selectPrioritySessions } from "./sidebarPrioritySessions";
import { ArchivedSessionsDialog } from "./ArchivedSessionsDialog";
import { useAppSidebarThreadSections } from "@/components/app-sidebar/useAppSidebarThreadSections";
import { AppSidebarSection } from "./AppSidebarSection";
import { useSidebarSections } from "./useSidebarSections";
import { buildVisibleSidebarSessions } from "./sidebarSessions";
import { SIDEBAR_RECENT_SESSION_PAGE_SIZE } from "./AppSidebar.constants";
import {
  ConversationActionButton,
  ConversationList,
  ConversationSectionActions,
  ConversationShelf,
} from "@/components/app-sidebar/AppSidebarConversationShelf.styles";

interface AppSidebarConversationShelfProps {
  openedProjects?: SidebarOpenedProjectSummary[];
  recentSessions: AgentSessionInfo[];
  showPriorityThreads?: boolean;
  currentSessionId?: string | null;
  activeAgentStreaming?: boolean;
  backgroundAgentSessionRuntime?: AgentBackgroundSessionRuntimeSnapshot | null;
  recentLoading: boolean;
  hasMoreRecent: boolean;
  actionSessionId: string | null;
  onCreateConversation: (project?: SidebarOpenedProjectSummary) => void;
  onNavigateToConversation: (session: AgentSessionInfo) => void;
  onRenameConversation?: (session: AgentSessionInfo) => void;
  onDeleteConversation?: (session: AgentSessionInfo) => void;
  onToggleArchive: (session: AgentSessionInfo, archived: boolean) => void;
  onTogglePinned: (session: AgentSessionInfo) => void;
  onMoveToSection: (
    session: AgentSessionInfo,
    section: AgentSessionSection | null,
  ) => void;
  onToggleProjectPin?: (project: SidebarOpenedProjectSummary) => void;
  onRevealProject?: (project: SidebarOpenedProjectSummary) => void;
  onCreateProjectWorktree?: (project: SidebarOpenedProjectSummary) => void;
  onRenameProject?: (project: SidebarOpenedProjectSummary) => void;
  onRemoveProject?: (project: SidebarOpenedProjectSummary) => void;
  onRefreshConversations?: () => Promise<void>;
  onShowMoreRecent: () => void;
}

const TERMINAL_SIDEBAR_SESSION_STATUSES = new Set([
  "completed",
  "failed",
  "canceled",
  "aborted",
]);

function normalizeSidebarRuntimeStatus(value?: string | null): string | null {
  const normalized = value
    ?.trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (!normalized) {
    return null;
  }
  return normalized === "cancelled" ? "canceled" : normalized;
}

function hasTerminalSidebarRuntimeStatus(session: AgentSessionInfo): boolean {
  const threadStatus = normalizeSidebarRuntimeStatus(session.thread_status);
  const latestTurnStatus = normalizeSidebarRuntimeStatus(
    session.latest_turn_status,
  );
  return Boolean(
    (threadStatus && TERMINAL_SIDEBAR_SESSION_STATUSES.has(threadStatus)) ||
    (latestTurnStatus &&
      TERMINAL_SIDEBAR_SESSION_STATUSES.has(latestTurnStatus)),
  );
}

function resolveBackgroundSidebarRuntimeStatus(
  session: AgentSessionInfo,
  backgroundAgentSessionRuntime?: AgentBackgroundSessionRuntimeSnapshot | null,
): AgentUnfinishedSessionStatus | null {
  const backgroundSessionId = backgroundAgentSessionRuntime?.sessionId.trim();
  if (
    !backgroundAgentSessionRuntime ||
    !backgroundSessionId ||
    backgroundSessionId !== session.id ||
    hasTerminalSidebarRuntimeStatus(session)
  ) {
    return null;
  }

  switch (backgroundAgentSessionRuntime.status) {
    case "waiting":
      return "waitingAction";
    case "queued":
      return "queued";
    case "running":
      return "running";
  }
}

export function AppSidebarConversationShelf({
  openedProjects = [],
  recentSessions,
  showPriorityThreads = false,
  currentSessionId,
  activeAgentStreaming = false,
  backgroundAgentSessionRuntime = null,
  recentLoading,
  hasMoreRecent,
  actionSessionId,
  onCreateConversation,
  onNavigateToConversation,
  onRenameConversation,
  onDeleteConversation,
  onToggleArchive,
  onTogglePinned,
  onMoveToSection,
  onToggleProjectPin,
  onRevealProject,
  onCreateProjectWorktree,
  onRenameProject,
  onRemoveProject,
  onRefreshConversations,
  onShowMoreRecent,
}: AppSidebarConversationShelfProps) {
  const { t, i18n } = useTranslation("navigation");
  const {
    createSection,
    pendingSectionId,
    removeSection,
    renameSection,
    sections: threadSectionCatalog,
  } = useAppSidebarThreadSections({
    onSectionsChanged: onRefreshConversations,
  });
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
  const [sessionSortMode, setSessionSortMode] = useState<
    "updated" | "created" | "manual"
  >(() => {
    if (typeof window === "undefined") return "updated";
    const stored = window.localStorage.getItem("lime.sidebar.sessionSort");
    return stored === "created" || stored === "manual" ? stored : "updated";
  });
  useEffect(() => {
    window.localStorage.setItem("lime.sidebar.sessionSort", sessionSortMode);
  }, [sessionSortMode]);
  const sortedRecentSessions = useMemo(() => {
    if (sessionSortMode === "manual") return recentSessions;
    const sorted = [...recentSessions];
    sorted.sort((a, b) =>
      sessionSortMode === "created"
        ? b.created_at - a.created_at
        : b.updated_at - a.updated_at,
    );
    return sorted;
  }, [recentSessions, sessionSortMode]);
  const activeConversationGroups = useMemo(
    () =>
      buildSidebarConversationGroups({
        sessions: sortedRecentSessions,
        openedProjects,
        threadSections: threadSectionCatalog,
      }),
    [openedProjects, sortedRecentSessions, threadSectionCatalog],
  );
  const displayedThreadSections =
    activeConversationGroups.threadSections.filter(
      ({ section, sessions }) =>
        section.id !== PINNED_THREAD_SECTION.id || sessions.length > 0,
    );
  const sectionKeyFor = (section: AgentSessionSection) =>
    section.id === PINNED_THREAD_SECTION.id ? "pinned" : `custom:${section.id}`;
  const [priorityVersion, setPriorityVersion] = useState(0);
  const prioritySessions = useMemo(
    () => selectPrioritySessions(sortedRecentSessions),
    // priorityVersion / showPriorityThreads force recompute after read-state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sortedRecentSessions, priorityVersion, showPriorityThreads],
  );
  const sections = useSidebarSections([
    "priority",
    "threads",
    ...displayedThreadSections.map(({ section }) => sectionKeyFor(section)),
    "chats",
  ]);
  const sectionProps = (sectionKey: string) => ({
    sectionKey,
    collapsed: sections.isCollapsed(sectionKey),
    onToggleCollapsed: () => sections.toggleCollapsed(sectionKey),
    onReorder: sections.reorder,
    onMove: (direction: -1 | 1) => sections.move(sectionKey, direction),
  });
  const [recentVisibleCount, setRecentVisibleCount] = useState(
    SIDEBAR_RECENT_SESSION_PAGE_SIZE,
  );
  const visibleStandaloneSessions = buildVisibleSidebarSessions({
    sessions: activeConversationGroups.standaloneSessions,
    currentSessionId,
    limit: recentVisibleCount,
    hasMore: hasMoreRecent,
  });
  const showMoreRecent = useCallback(() => {
    setRecentVisibleCount((count) => count + SIDEBAR_RECENT_SESSION_PAGE_SIZE);
    onShowMoreRecent();
  }, [onShowMoreRecent]);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [menuState, setMenuState] = useState<ConversationMenuState>(null);
  const [projectMenuState, setProjectMenuState] =
    useState<ProjectMenuState>(null);
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<Set<string>>(
    () => new Set(),
  );
  const activeProjectIdKey = useMemo(
    () =>
      activeConversationGroups.projectSections
        .map((section) => section.project.id)
        .join("\u0000"),
    [activeConversationGroups.projectSections],
  );

  useEffect(() => {
    const activeProjectIds = new Set(
      activeProjectIdKey ? activeProjectIdKey.split("\u0000") : [],
    );

    setCollapsedProjectIds((current) => {
      const next = new Set(
        [...current].filter((projectId) => activeProjectIds.has(projectId)),
      );
      return next.size === current.size ? current : next;
    });
  }, [activeProjectIdKey]);

  useEffect(() => {
    if (!menuState && !projectMenuState) {
      return;
    }

    const closeMenu = () => {
      setMenuState(null);
      setProjectMenuState(null);
    };
    window.addEventListener("click", closeMenu);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);

    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [menuState, projectMenuState]);

  const openConversationMenu = useCallback(
    (event: MouseEvent<HTMLButtonElement>, session: AgentSessionInfo) => {
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      setMenuState({
        session,
        ...resolveSidebarFloatingMenuPosition(rect, window, {
          menuWidth: CONVERSATION_MENU_WIDTH,
          menuApproxHeight: CONVERSATION_MENU_APPROX_HEIGHT,
          viewportMargin: CONVERSATION_MENU_VIEWPORT_MARGIN,
        }),
      });
    },
    [],
  );

  const openProjectMenu = useCallback(
    (
      event: MouseEvent<HTMLButtonElement>,
      project: SidebarOpenedProjectSummary,
    ) => {
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      setProjectMenuState({
        project,
        ...resolveSidebarFloatingMenuPosition(rect, window, {
          menuWidth: CONVERSATION_MENU_WIDTH,
          menuApproxHeight: CONVERSATION_MENU_APPROX_HEIGHT,
          viewportMargin: CONVERSATION_MENU_VIEWPORT_MARGIN,
        }),
      });
    },
    [],
  );

  const toggleProjectCollapsed = useCallback((projectId: string) => {
    setCollapsedProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  }, []);

  const closeMenus = useCallback(() => {
    setMenuState(null);
    setProjectMenuState(null);
  }, []);

  const projectsTitleLabel = t(
    "navigation.sidebar.conversations.projectsTitle",
    "项目",
  );
  const standaloneTitleLabel = t(
    "navigation.sidebar.search.section.recent",
    "最近",
  );
  const priorityTitleLabel = t(
    "navigation.sidebar.conversations.priorityTitle",
    { defaultValue: "优先事项" },
  );
  const pinnedTitleLabel = t(
    "navigation.sidebar.conversations.pinnedTitle",
    "置顶",
  );
  const newConversationLabel = t(
    "navigation.sidebar.conversations.newConversation",
    "新建对话",
  );
  const newProjectConversationLabel = t(
    "navigation.sidebar.conversations.newProjectConversation",
    "在此项目新建对话",
  );
  const loadingRecentLabel = t(
    "navigation.sidebar.conversations.loadingRecent",
    "正在加载对话",
  );
  const emptyStandaloneLabel = t(
    "navigation.sidebar.conversations.emptyStandalone",
    "暂无聊天",
  );
  const moreRecentLabel = t(
    "navigation.sidebar.conversations.moreRecent",
    "查看更多对话",
  );
  const renameActionLabel = t(
    "navigation.sidebar.conversations.menu.rename",
    "重命名",
  );
  const pinActionLabel = t("navigation.sidebar.conversations.menu.pin", "置顶");
  const unpinActionLabel = t(
    "navigation.sidebar.conversations.menu.unpin",
    "取消置顶",
  );
  const archiveActionLabel = t(
    "navigation.sidebar.conversations.menu.archive",
    "归档",
  );
  const moveToSectionActionLabel = t(
    "navigation.sidebar.conversations.menu.moveToSection",
    "移动到分组",
  );
  const moveToSectionBackLabel = t(
    "navigation.sidebar.conversations.menu.moveToSectionBack",
    "选择分组",
  );
  const unsectionedLabel = t(
    "navigation.sidebar.conversations.menu.unsectioned",
    "不分组",
  );
  const createSectionLabel = t(
    "navigation.sidebar.conversations.section.create.action",
    "新建分组",
  );
  const deleteActionLabel = t(
    "navigation.sidebar.conversations.menu.delete",
    "删除",
  );
  const projectPinActionLabel = t(
    "navigation.sidebar.conversations.projectMenu.pin",
    "置顶项目",
  );
  const projectUnpinActionLabel = t(
    "navigation.sidebar.conversations.projectMenu.unpin",
    "取消置顶",
  );
  const projectRevealActionLabel = t(
    "navigation.sidebar.conversations.projectMenu.reveal",
    "显示位置",
  );
  const projectWorktreeActionLabel = t(
    "navigation.sidebar.conversations.projectMenu.createWorktree",
    "创建永久工作树",
  );
  const projectRenameActionLabel = t(
    "navigation.sidebar.conversations.projectMenu.rename",
    "重命名项目",
  );
  const projectArchiveThreadsLabel = t(
    "navigation.sidebar.conversations.projectMenu.archiveThreads",
    "归档聊天",
  );
  const projectRemoveActionLabel = t(
    "navigation.sidebar.conversations.projectMenu.remove",
    "移除",
  );
  const projectMoreActionsLabel = t(
    "navigation.sidebar.conversations.projectMenu.moreActions",
    "项目操作",
  );
  const runtimeStatusLabels: Record<AgentUnfinishedSessionStatus, string> = {
    running: t("navigation.sidebar.conversations.status.running", "正在输出"),
    queued: t("navigation.sidebar.conversations.status.queued", "排队中"),
    waitingAction: t(
      "navigation.sidebar.conversations.status.waitingAction",
      "等待确认",
    ),
  };

  useEffect(
    () =>
      subscribeSessionPinToggle((sessionId) => {
        const session = [
          ...sortedRecentSessions,
          ...activeConversationGroups.standaloneSessions,
          ...activeConversationGroups.projectSections.flatMap(
            (section) => section.sessions,
          ),
        ].find((candidate) => candidate.id === sessionId);
        if (session) {
          onTogglePinned(session);
        }
      }),
    [activeConversationGroups, onTogglePinned, sortedRecentSessions],
  );

  const renderConversationRow = (session: AgentSessionInfo) => {
    const active = currentSessionId === session.id;
    const title = resolveLocalizedSessionTitle(session);
    const runtimeProjection = resolveUnfinishedSessionProjection(session);
    const terminalRuntimeStatus = hasTerminalSidebarRuntimeStatus(session);
    const backgroundRuntimeStatus = resolveBackgroundSidebarRuntimeStatus(
      session,
      backgroundAgentSessionRuntime,
    );
    const activeRuntimeStatus: AgentUnfinishedSessionStatus | null =
      active && activeAgentStreaming && !terminalRuntimeStatus
        ? "running"
        : null;
    const runtimeStatus: AgentUnfinishedSessionStatus | null =
      runtimeProjection?.status ??
      backgroundRuntimeStatus ??
      activeRuntimeStatus;
    return (
      <AppSidebarConversationRow
        key={session.id}
        session={session}
        title={title}
        meta={formatLocalizedSessionMeta(session)}
        active={active}
        runtimeStatus={runtimeStatus}
        runtimeStatusLabel={
          runtimeStatus ? runtimeStatusLabels[runtimeStatus] : null
        }
        actionDisabled={actionSessionId === session.id}
        pinned={session.section?.id === PINNED_THREAD_SECTION.id}
        pinLabel={t("navigation.sidebar.conversations.menu.pinThread")}
        unpinLabel={t("navigation.sidebar.conversations.menu.unpinThread")}
        archiveLabel={t("navigation.sidebar.conversations.menu.archiveThread")}
        unreadLabel={t("navigation.sidebar.conversations.unread")}
        onTogglePinned={() => onTogglePinned(session)}
        onArchive={() => {
          if (
            (runtimeStatus === "running" || runtimeStatus === "queued") &&
            !window.confirm(
              String(
                t(
                  "navigation.sidebar.conversations.archiveRunningConfirm",
                ),
              ),
            )
          ) {
            return;
          }
          onToggleArchive(session, true);
        }}
        onNavigate={onNavigateToConversation}
        onOpenMenu={openConversationMenu}
      />
    );
  };

  const threadSections = displayedThreadSections.map(
    ({ section, sessions }) => (
      <AppSidebarSection
        key={sectionKeyFor(section)}
        {...sectionProps(sectionKeyFor(section))}
        threadSectionId={section.id}
        title={
          section.id === PINNED_THREAD_SECTION.id
            ? pinnedTitleLabel
            : section.name
        }
        actions={
          section.id !== PINNED_THREAD_SECTION.id ? (
            <ConversationSectionActions>
              <ConversationActionButton
                type="button"
                disabled={pendingSectionId !== null}
                onClick={() => void renameSection(section)}
                aria-label={t(
                  "navigation.sidebar.conversations.section.rename.action",
                  {
                    name: section.name,
                    defaultValue: "重命名分组 {{name}}",
                  },
                )}
                title={t(
                  "navigation.sidebar.conversations.section.rename.action",
                  {
                    name: section.name,
                    defaultValue: "重命名分组 {{name}}",
                  },
                )}
                data-testid="app-sidebar-thread-section-rename"
              >
                <Pencil />
              </ConversationActionButton>
              <ConversationActionButton
                type="button"
                disabled={pendingSectionId !== null}
                onClick={() => void removeSection(section)}
                aria-label={t(
                  "navigation.sidebar.conversations.section.delete.action",
                  {
                    name: section.name,
                    defaultValue: "删除分组 {{name}}",
                  },
                )}
                title={t(
                  "navigation.sidebar.conversations.section.delete.action",
                  {
                    name: section.name,
                    defaultValue: "删除分组 {{name}}",
                  },
                )}
                data-testid="app-sidebar-thread-section-delete"
              >
                <Trash2 />
              </ConversationActionButton>
            </ConversationSectionActions>
          ) : null
        }
      >
        <ConversationList>
          {sessions.map((session) => renderConversationRow(session))}
        </ConversationList>
      </AppSidebarSection>
    ),
  );

  const projectsSection = (
    <AppSidebarSection {...sectionProps("threads")} title={projectsTitleLabel}>
      <ConversationList data-testid="app-sidebar-project-conversations">
        {recentLoading ? (
          <AppSidebarConversationEmptyState text={loadingRecentLabel} />
        ) : (
          <AppSidebarProjectConversationGroups
            projectSections={activeConversationGroups.projectSections}
            collapsedProjectIds={collapsedProjectIds}
            newProjectConversationLabel={newProjectConversationLabel}
            projectMoreActionsLabel={projectMoreActionsLabel}
            currentSessionId={currentSessionId}
            showMoreLabel={t(
              "navigation.sidebar.conversations.project.showMore",
              "展开显示",
            )}
            showLessLabel={t(
              "navigation.sidebar.conversations.project.showLess",
              "收起显示",
            )}
            formatNewProjectConversationForLabel={(projectName) =>
              t("navigation.sidebar.conversations.newProjectConversationFor", {
                title: projectName,
                defaultValue: "在 {{title}} 新建对话",
              })
            }
            formatOpenProjectMenuLabel={(projectName) =>
              t("navigation.sidebar.conversations.projectMenu.open", {
                title: projectName,
                defaultValue: "打开 {{title}} 项目菜单",
              })
            }
            renderConversationRow={renderConversationRow}
            onCreateConversation={onCreateConversation}
            onToggleProjectCollapsed={toggleProjectCollapsed}
            onOpenProjectMenu={openProjectMenu}
          />
        )}
      </ConversationList>
    </AppSidebarSection>
  );

  const prioritySection = showPriorityThreads ? (
      <AppSidebarSection
        {...sectionProps("priority")}
        title={priorityTitleLabel}
        actions={
          prioritySessions.length > 0 ? (
          <ConversationSectionActions>
            <ConversationActionButton
              type="button"
              aria-label={t(
                "navigation.sidebar.conversations.priority.markAllRead",
              )}
              title={t(
                "navigation.sidebar.conversations.priority.markAllRead",
              )}
              data-testid="app-sidebar-priority-mark-all-read"
              onClick={() => {
                for (const session of prioritySessions) {
                  markSessionRead(session.id);
                }
                setPriorityVersion((version) => version + 1);
              }}
            >
              <CheckCheck />
            </ConversationActionButton>
          </ConversationSectionActions>
          ) : null
        }
      >
        <ConversationList>
          {prioritySessions.length > 0 ? (
            prioritySessions.map(renderConversationRow)
          ) : (
            <p
              className="px-2 py-2 text-xs text-[color:var(--lime-text-muted)]"
              data-testid="app-sidebar-priority-empty"
            >
              {String(
                t("navigation.sidebar.conversations.priority.empty"),
              )}
            </p>
          )}
        </ConversationList>
      </AppSidebarSection>
    ) : null;

  const conversationsSection = (
    <AppSidebarSection
      {...sectionProps("chats")}
      title={standaloneTitleLabel}
      actions={
        <ConversationSectionActions>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <ConversationActionButton
                type="button"
                aria-label={t(
                  "navigation.sidebar.conversations.sidebarOptions",
                )}
                title={t("navigation.sidebar.conversations.sidebarOptions")}
                data-testid="app-sidebar-section-options"
              >
                <MoreHorizontal />
              </ConversationActionButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44 p-1">
              {(
                [
                  ["updated", "updated"],
                  ["created", "created"],
                  ["manual", "manual"],
                ] as const
              ).map(([value, key]) => (
                <DropdownMenuItem
                  key={value}
                  className="whitespace-nowrap"
                  onClick={() => setSessionSortMode(value)}
                  data-testid={`app-sidebar-session-sort-${value}`}
                >
                  {String(
                    t(`navigation.sidebar.conversations.sortMenu.${key}`),
                  )}
                  {sessionSortMode === value ? (
                    <Check className="ml-auto h-3.5 w-3.5" />
                  ) : null}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="whitespace-nowrap"
                onClick={() => {
                  if (pendingSectionId === null) {
                    void createSection();
                  }
                }}
                data-testid="app-sidebar-new-thread-section-button"
              >
                <FolderPlus className="h-3.5 w-3.5" />
                {createSectionLabel}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="whitespace-nowrap"
                onClick={() => setArchivedOpen(true)}
                data-testid="app-sidebar-open-archive"
              >
                <Archive className="h-3.5 w-3.5" />
                {String(
                  t("navigation.sidebar.conversations.archive.openArchive"),
                )}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <ConversationActionButton
            type="button"
            onClick={() => onCreateConversation()}
            aria-label={newConversationLabel}
            title={newConversationLabel}
            data-testid="app-sidebar-new-conversation-button"
          >
            <MessageSquarePlus />
          </ConversationActionButton>
        </ConversationSectionActions>
      }
    >
      <ConversationList data-testid="app-sidebar-recent-conversations">
        {recentLoading ? (
          <AppSidebarConversationEmptyState text={loadingRecentLabel} />
        ) : visibleStandaloneSessions.length > 0 ? (
          visibleStandaloneSessions.map((session) =>
            renderConversationRow(session),
          )
        ) : (
          <AppSidebarConversationEmptyState text={emptyStandaloneLabel} />
        )}
        {hasMoreRecent ||
        activeConversationGroups.standaloneSessions.length >
          recentVisibleCount ? (
          <AppSidebarLoadMore
            mode={
              sections.orderedKeys.at(-1) === "chats"
                ? "infiniteScroll"
                : "button"
            }
            itemCount={visibleStandaloneSessions.length}
            label={moreRecentLabel}
            onLoadMore={showMoreRecent}
          />
        ) : null}
      </ConversationList>
    </AppSidebarSection>
  );

  return (
    <ConversationShelf data-testid="app-sidebar-conversation-shelf">
      {sections.orderedKeys.map((key) => (
        <div className="contents" key={key}>
          {key === "priority"
            ? prioritySection
            : key === "threads"
              ? projectsSection
              : key === "chats"
                ? conversationsSection
                : threadSections.find((section) => section.key === key)}
        </div>
      ))}

      <ArchivedSessionsDialog
        open={archivedOpen}
        onOpenChange={setArchivedOpen}
        onRestore={(session) => onToggleArchive(session, false)}
        onOpenSession={(session) => {
          setArchivedOpen(false);
          onNavigateToConversation(session);
        }}
      />
      <AppSidebarConversationMenus
        conversationMenuState={menuState}
        projectMenuState={projectMenuState}
        resolveSessionTitle={resolveLocalizedSessionTitle}
        onCloseMenus={closeMenus}
        onTogglePinned={onTogglePinned}
        onMoveToSection={onMoveToSection}
        onRenameConversation={onRenameConversation}
        onDeleteConversation={onDeleteConversation}
        onToggleArchive={onToggleArchive}
        onToggleProjectPin={onToggleProjectPin}
        onRevealProject={onRevealProject}
        onCreateProjectWorktree={onCreateProjectWorktree}
        onRenameProject={onRenameProject}
        onRemoveProject={onRemoveProject}
        onArchiveProjectThreads={(project) => {
          const section = activeConversationGroups.projectSections.find(
            (candidate) => candidate.project.id === project.id,
          );
          const sessions = section?.sessions ?? [];
          if (sessions.length === 0) return;
          if (
            !window.confirm(
              String(
                t(
                  "navigation.sidebar.conversations.projectMenu.archiveThreadsConfirm",
                  {
                    name: project.name,
                    count: sessions.length,
                  },
                ),
              ),
            )
          ) {
            return;
          }
          for (const session of sessions) {
            onToggleArchive(session, true);
          }
        }}
        threadSections={activeConversationGroups.threadSections.map(
          ({ section }) => section,
        )}
        conversationLabels={{
          ariaLabel: (title) =>
            t("navigation.sidebar.conversations.menu.ariaLabel", {
              title,
              defaultValue: "{{title}} 操作菜单",
            }),
          rename: renameActionLabel,
          pin: pinActionLabel,
          unpin: unpinActionLabel,
          archive: archiveActionLabel,
          moveToSection: moveToSectionActionLabel,
          moveToSectionBack: moveToSectionBackLabel,
          unsectioned: unsectionedLabel,
          delete: deleteActionLabel,
        }}
        projectLabels={{
          ariaLabel: (title) =>
            t("navigation.sidebar.conversations.projectMenu.ariaLabel", {
              title,
              defaultValue: "{{title}} 项目菜单",
            }),
          pin: projectPinActionLabel,
          unpin: projectUnpinActionLabel,
          reveal: projectRevealActionLabel,
          createWorktree: projectWorktreeActionLabel,
          rename: projectRenameActionLabel,
          remove: projectRemoveActionLabel,
          archiveThreads: projectArchiveThreadsLabel,
        }}
      />
    </ConversationShelf>
  );
}
