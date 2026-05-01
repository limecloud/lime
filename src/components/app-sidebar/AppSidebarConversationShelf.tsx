import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import styled from "styled-components";
import {
  Archive,
  Check,
  ChevronDown,
  Clock3,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  Pin,
  Trash2,
  Undo2,
} from "lucide-react";
import type { AsterSessionInfo } from "@/lib/api/agentRuntime";
import { recordAgentUiPerformanceMetric } from "@/lib/agentUiPerformanceMetrics";
import {
  formatSidebarSessionMeta,
  resolveSidebarSessionTitle,
} from "@/components/app-sidebar/sidebarSessionFormatting";

interface AppSidebarConversationShelfProps {
  recentSessions: AsterSessionInfo[];
  archivedSessions: AsterSessionInfo[];
  currentSessionId?: string | null;
  recentLoading: boolean;
  archivedLoading: boolean;
  archivedCollapsed: boolean;
  hasMoreRecent: boolean;
  hasMoreArchived: boolean;
  actionSessionId: string | null;
  onCreateConversation: () => void;
  onNavigateToConversation: (session: AsterSessionInfo) => void;
  onPrefetchConversation?: (session: AsterSessionInfo) => void;
  onRenameConversation?: (session: AsterSessionInfo) => void;
  onDeleteConversation?: (session: AsterSessionInfo) => void;
  onToggleArchive: (session: AsterSessionInfo, archived: boolean) => void;
  onShowMoreRecent: () => void;
  onShowMoreArchived: () => void;
  onToggleArchivedCollapsed: () => void;
}

const CONVERSATION_HOVER_PREFETCH_DELAY_MS = 900;
const FAVORITE_SESSION_IDS_STORAGE_KEY =
  "lime.app-sidebar.favorite-session-ids";
const CONVERSATION_MENU_WIDTH = 188;
const CONVERSATION_MENU_APPROX_HEIGHT = 252;
const CONVERSATION_MENU_VIEWPORT_MARGIN = 12;

type ConversationMenuState = {
  session: AsterSessionInfo;
  archived: boolean;
  top: number;
  left: number;
} | null;

function loadFavoriteSessionIds(): string[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(FAVORITE_SESSION_IDS_STORAGE_KEY) ?? "[]",
    );
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

function persistFavoriteSessionIds(sessionIds: string[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    FAVORITE_SESSION_IDS_STORAGE_KEY,
    JSON.stringify(sessionIds),
  );
}

const ConversationShelf = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 2px 0 12px;
`;

const ConversationMultiSelectToolbar = styled.div`
  min-height: 38px;
  border-radius: 16px;
  border: 1px solid var(--sidebar-card-border, var(--sidebar-border));
  background: var(--lime-surface, #ffffff);
  color: var(--lime-text, #1a3b2b);
  box-shadow: var(--sidebar-card-shadow);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 0 8px 0 12px;
  font-size: 12px;
  font-weight: 750;
`;

const ConversationMultiSelectDoneButton = styled.button`
  min-height: 28px;
  border: 1px solid var(--lime-card-subtle-border, #d9eadf);
  border-radius: 11px;
  background: var(--lime-surface-soft, #f8fcf9);
  color: var(--lime-brand-strong, #166534);
  cursor: pointer;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 800;
  transition:
    background-color 0.16s ease,
    border-color 0.16s ease;

  &:hover {
    border-color: var(--lime-brand-soft-border, #bbf7d0);
    background: var(--lime-brand-soft, #ecfdf5);
  }
`;

const ConversationSection = styled.div<{ $compact?: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: ${({ $compact }) => ($compact ? "auto" : "140px")};
  max-height: ${({ $compact }) => ($compact ? "none" : "208px")};
  padding: 10px;
  border-radius: 20px;
  border: 1px solid var(--sidebar-card-border, var(--sidebar-border));
  background: var(--sidebar-card-surface), var(--sidebar-search-bg);
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

const ConversationSectionTitle = styled.h2`
  display: inline-flex;
  align-items: center;
  padding: 0;
  margin: 0;
  color: inherit;
  font-size: 13px;
  font-weight: 600;
`;

const ConversationSectionTitleButton = styled.button<{ $open?: boolean }>`
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
    transform: rotate(${({ $open }) => ($open ? "0deg" : "-90deg")});
    transition: transform 0.16s ease;
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

const ConversationListMoreButton = styled.button`
  width: 100%;
  min-height: 34px;
  border: 1px solid var(--sidebar-card-border, var(--sidebar-border));
  border-radius: 12px;
  background: var(--sidebar-search-bg);
  color: var(--sidebar-muted);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition:
    background-color 0.18s ease,
    border-color 0.18s ease,
    color 0.18s ease;

  &:hover {
    background: var(--sidebar-hover);
    border-color: var(--sidebar-search-border-hover);
    color: var(--sidebar-foreground);
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
    $active ? "var(--lime-sidebar-active, #e6f8ea)" : "transparent"};
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

const ConversationSelectionMark = styled.span<{ $selected?: boolean }>`
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  border-radius: 6px;
  border: 1px solid
    ${({ $selected }) =>
      $selected ? "var(--sidebar-active-foreground)" : "var(--sidebar-border)"};
  background: ${({ $selected }) =>
    $selected ? "var(--sidebar-active-foreground)" : "transparent"};
  color: var(--sidebar-active);
  display: inline-flex;
  align-items: center;
  justify-content: center;

  svg {
    width: 11px;
    height: 11px;
  }
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

const ConversationFavoriteBadge = styled.span`
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--sidebar-muted);

  svg {
    width: 13px;
    height: 13px;
  }
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

const ConversationMenuSurface = styled.div`
  position: fixed;
  z-index: 110;
  width: ${CONVERSATION_MENU_WIDTH}px;
  padding: 14px 10px;
  border-radius: 24px;
  border: 1px solid var(--lime-card-subtle-border, rgba(226, 240, 226, 0.9));
  background: var(--lime-surface, #ffffff);
  color: var(--lime-text-strong, #0f172a);
  box-shadow:
    0 22px 64px rgba(15, 23, 42, 0.18),
    0 1px 0 rgba(255, 255, 255, 0.76) inset;
`;

const ConversationMenuItem = styled.button<{ $danger?: boolean }>`
  width: 100%;
  min-height: 42px;
  border: none;
  border-radius: 14px;
  background: transparent;
  color: ${({ $danger }) =>
    $danger
      ? "var(--lime-danger, #b91c1c)"
      : "var(--lime-text-strong, #0f172a)"};
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 16px;
  cursor: pointer;
  text-align: left;
  font-size: 16px;
  font-weight: 680;
  transition:
    background-color 0.16s ease,
    color 0.16s ease;

  &:hover {
    background: ${({ $danger }) =>
      $danger
        ? "var(--lime-danger-soft, #fff1f2)"
        : "var(--lime-surface-hover, #f4fdf4)"};
  }

  svg {
    width: 19px;
    height: 19px;
    flex-shrink: 0;
    color: ${({ $danger }) =>
      $danger ? "var(--lime-danger, #b91c1c)" : "var(--sidebar-muted)"};
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
  background: color-mix(
    in srgb,
    var(--sidebar-search-bg, #ffffff) 78%,
    transparent
  );
  text-align: center;
`;

function renderEmptyState(text: string) {
  return (
    <ConversationEmptyState>
      <Clock3 size={14} />
      {text}
    </ConversationEmptyState>
  );
}

export function AppSidebarConversationShelf({
  recentSessions,
  archivedSessions,
  currentSessionId,
  recentLoading,
  archivedLoading,
  archivedCollapsed,
  hasMoreRecent,
  hasMoreArchived,
  actionSessionId,
  onCreateConversation,
  onNavigateToConversation,
  onPrefetchConversation,
  onRenameConversation,
  onDeleteConversation,
  onToggleArchive,
  onShowMoreRecent,
  onShowMoreArchived,
  onToggleArchivedCollapsed,
}: AppSidebarConversationShelfProps) {
  const [menuState, setMenuState] = useState<ConversationMenuState>(null);
  const [favoriteSessionIds, setFavoriteSessionIds] = useState<string[]>(
    loadFavoriteSessionIds,
  );
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const hoverPrefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const hoverPrefetchSessionRef = useRef<AsterSessionInfo | null>(null);
  const clearHoverPrefetch = useCallback(() => {
    if (hoverPrefetchTimerRef.current !== null) {
      const session = hoverPrefetchSessionRef.current;
      clearTimeout(hoverPrefetchTimerRef.current);
      hoverPrefetchTimerRef.current = null;
      hoverPrefetchSessionRef.current = null;
      if (session) {
        recordAgentUiPerformanceMetric(
          "sidebar.conversation.prefetchCancelled",
          {
            sessionId: session.id,
            source: "conversation_shelf",
            workspaceId: session.workspace_id ?? null,
          },
        );
      }
    }
  }, []);
  const scheduleHoverPrefetch = useCallback(
    (session: AsterSessionInfo) => {
      if (
        hoverPrefetchTimerRef.current !== null &&
        hoverPrefetchSessionRef.current?.id === session.id
      ) {
        return;
      }

      clearHoverPrefetch();
      recordAgentUiPerformanceMetric("sidebar.conversation.prefetchScheduled", {
        sessionId: session.id,
        source: "conversation_shelf",
        workspaceId: session.workspace_id ?? null,
      });
      hoverPrefetchSessionRef.current = session;
      hoverPrefetchTimerRef.current = setTimeout(() => {
        hoverPrefetchTimerRef.current = null;
        hoverPrefetchSessionRef.current = null;
        recordAgentUiPerformanceMetric("sidebar.conversation.prefetchFired", {
          sessionId: session.id,
          source: "conversation_shelf",
          workspaceId: session.workspace_id ?? null,
        });
        onPrefetchConversation?.(session);
      }, CONVERSATION_HOVER_PREFETCH_DELAY_MS);
    },
    [clearHoverPrefetch, onPrefetchConversation],
  );

  useEffect(() => clearHoverPrefetch, [clearHoverPrefetch]);

  useEffect(() => {
    if (!menuState) {
      return;
    }

    const closeMenu = () => setMenuState(null);
    window.addEventListener("click", closeMenu);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);

    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [menuState]);

  const openConversationMenu = useCallback(
    (
      event: MouseEvent<HTMLButtonElement>,
      session: AsterSessionInfo,
      archived: boolean,
    ) => {
      event.stopPropagation();
      clearHoverPrefetch();
      const rect = event.currentTarget.getBoundingClientRect();
      setMenuState({
        session,
        archived,
        top: Math.max(
          CONVERSATION_MENU_VIEWPORT_MARGIN,
          Math.min(
            rect.bottom + 8,
            window.innerHeight -
              CONVERSATION_MENU_APPROX_HEIGHT -
              CONVERSATION_MENU_VIEWPORT_MARGIN,
          ),
        ),
        left: Math.max(
          CONVERSATION_MENU_VIEWPORT_MARGIN,
          Math.min(
            rect.right - CONVERSATION_MENU_WIDTH,
            window.innerWidth -
              CONVERSATION_MENU_WIDTH -
              CONVERSATION_MENU_VIEWPORT_MARGIN,
          ),
        ),
      });
    },
    [clearHoverPrefetch],
  );

  const toggleFavoriteSession = useCallback((session: AsterSessionInfo) => {
    setFavoriteSessionIds((current) => {
      const exists = current.includes(session.id);
      const next = exists
        ? current.filter((sessionId) => sessionId !== session.id)
        : [session.id, ...current];
      persistFavoriteSessionIds(next);
      return next;
    });
  }, []);

  const enterMultiSelectMode = useCallback((session: AsterSessionInfo) => {
    setMultiSelectMode(true);
    setSelectedSessionIds(new Set([session.id]));
  }, []);

  const exitMultiSelectMode = useCallback(() => {
    setMultiSelectMode(false);
    setSelectedSessionIds(new Set());
  }, []);

  const toggleSelectedSession = useCallback((session: AsterSessionInfo) => {
    setSelectedSessionIds((current) => {
      const next = new Set(current);
      if (next.has(session.id)) {
        next.delete(session.id);
      } else {
        next.add(session.id);
      }
      return next;
    });
  }, []);

  const runMenuAction = useCallback((action: () => void) => {
    setMenuState(null);
    action();
  }, []);

  useEffect(() => {
    if (!multiSelectMode || typeof window === "undefined") {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        exitMultiSelectMode();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [exitMultiSelectMode, multiSelectMode]);

  const renderConversationMenu = () => {
    if (!menuState || typeof document === "undefined") {
      return null;
    }

    const { session, archived, top, left } = menuState;
    const title = resolveSidebarSessionTitle(session);
    const favorite = favoriteSessionIds.includes(session.id);
    const archiveLabel = archived ? "恢复" : "归档";
    const ArchiveIcon = archived ? Undo2 : Archive;

    return createPortal(
      <ConversationMenuSurface
        role="menu"
        aria-label={`${title} 操作菜单`}
        style={{ top, left }}
        data-testid="app-sidebar-conversation-menu"
        onClick={(event) => event.stopPropagation()}
      >
        {onRenameConversation ? (
          <ConversationMenuItem
            type="button"
            role="menuitem"
            data-testid="app-sidebar-conversation-menu-rename"
            onClick={() => runMenuAction(() => onRenameConversation(session))}
          >
            <Pencil />
            重命名
          </ConversationMenuItem>
        ) : null}
        <ConversationMenuItem
          type="button"
          role="menuitem"
          aria-pressed={favorite}
          data-testid="app-sidebar-conversation-menu-favorite"
          onClick={() => runMenuAction(() => toggleFavoriteSession(session))}
        >
          <Pin />
          {favorite ? "取消收藏" : "收藏"}
        </ConversationMenuItem>
        <ConversationMenuItem
          type="button"
          role="menuitem"
          data-testid="app-sidebar-conversation-menu-archive"
          onClick={() =>
            runMenuAction(() => onToggleArchive(session, !archived))
          }
        >
          <ArchiveIcon />
          {archiveLabel}
        </ConversationMenuItem>
        <ConversationMenuItem
          type="button"
          role="menuitem"
          data-testid="app-sidebar-conversation-menu-multiselect"
          onClick={() => runMenuAction(() => enterMultiSelectMode(session))}
        >
          <Check />
          多选
        </ConversationMenuItem>
        {onDeleteConversation ? (
          <ConversationMenuItem
            type="button"
            role="menuitem"
            $danger
            data-testid="app-sidebar-conversation-menu-delete"
            onClick={() => runMenuAction(() => onDeleteConversation(session))}
          >
            <Trash2 />
            删除
          </ConversationMenuItem>
        ) : null}
      </ConversationMenuSurface>,
      document.body,
    );
  };

  return (
    <ConversationShelf data-testid="app-sidebar-conversation-shelf">
      {multiSelectMode ? (
        <ConversationMultiSelectToolbar data-testid="app-sidebar-conversation-multiselect-toolbar">
          已选择 {selectedSessionIds.size} 个对话
          <ConversationMultiSelectDoneButton
            type="button"
            onClick={exitMultiSelectMode}
          >
            完成
          </ConversationMultiSelectDoneButton>
        </ConversationMultiSelectToolbar>
      ) : null}
      <ConversationSection>
        <ConversationSectionHeader>
          <ConversationSectionTitle>最近对话</ConversationSectionTitle>
          <ConversationActionButton
            type="button"
            onClick={onCreateConversation}
            aria-label="新建对话"
            title="新建对话"
          >
            <MessageSquarePlus />
          </ConversationActionButton>
        </ConversationSectionHeader>
        <ConversationList data-testid="app-sidebar-recent-conversations">
          {recentLoading
            ? renderEmptyState("正在加载对话")
            : recentSessions.length > 0
              ? recentSessions.map((session) => {
                  const isCurrentConversation = currentSessionId === session.id;
                  const title = resolveSidebarSessionTitle(session);
                  const favorite = favoriteSessionIds.includes(session.id);
                  const selected = selectedSessionIds.has(session.id);
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
                        onClick={() => {
                          clearHoverPrefetch();
                          recordAgentUiPerformanceMetric(
                            "sidebar.conversation.click",
                            {
                              sessionId: session.id,
                              source: "conversation_shelf",
                              workspaceId: session.workspace_id ?? null,
                            },
                          );
                          if (multiSelectMode) {
                            toggleSelectedSession(session);
                            return;
                          }
                          onNavigateToConversation(session);
                        }}
                        onBlur={clearHoverPrefetch}
                        onFocus={() => scheduleHoverPrefetch(session)}
                        onPointerEnter={() => scheduleHoverPrefetch(session)}
                        onPointerLeave={clearHoverPrefetch}
                        title={title}
                      >
                        {multiSelectMode ? (
                          <ConversationSelectionMark $selected={selected}>
                            {selected ? <Check /> : null}
                          </ConversationSelectionMark>
                        ) : (
                          <ConversationItemDot
                            $active={isCurrentConversation}
                          />
                        )}
                        <ConversationItemLabel>{title}</ConversationItemLabel>
                        {favorite ? (
                          <ConversationFavoriteBadge
                            title="已收藏"
                            data-testid="app-sidebar-conversation-favorite-badge"
                          >
                            <Pin />
                          </ConversationFavoriteBadge>
                        ) : null}
                        <ConversationItemMeta>
                          {formatSidebarSessionMeta(session)}
                        </ConversationItemMeta>
                      </ConversationItemButton>
                      <ConversationItemActionButton
                        type="button"
                        aria-label={`打开 ${title} 操作菜单`}
                        title="更多操作"
                        disabled={actionSessionId === session.id}
                        onClick={(event) =>
                          openConversationMenu(event, session, false)
                        }
                      >
                        <MoreHorizontal />
                      </ConversationItemActionButton>
                    </ConversationItemRow>
                  );
                })
              : renderEmptyState("还没有开始对话")}
          {hasMoreRecent ? (
            <ConversationListMoreButton
              type="button"
              onClick={onShowMoreRecent}
            >
              查看更多对话
            </ConversationListMoreButton>
          ) : null}
        </ConversationList>
      </ConversationSection>

      <ConversationSection $compact={archivedCollapsed}>
        <ConversationSectionHeader>
          <ConversationSectionTitleButton
            type="button"
            aria-expanded={!archivedCollapsed}
            $open={!archivedCollapsed}
            onClick={onToggleArchivedCollapsed}
          >
            <ChevronDown />
            归档
          </ConversationSectionTitleButton>
        </ConversationSectionHeader>
        {!archivedCollapsed ? (
          <ConversationList data-testid="app-sidebar-archived-conversations">
            {archivedLoading
              ? renderEmptyState("正在加载归档")
              : archivedSessions.length > 0
                ? archivedSessions.map((session) => {
                    const isCurrentConversation =
                      currentSessionId === session.id;
                    const title = resolveSidebarSessionTitle(session);
                    const favorite = favoriteSessionIds.includes(session.id);
                    const selected = selectedSessionIds.has(session.id);
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
                          onClick={() => {
                            clearHoverPrefetch();
                            recordAgentUiPerformanceMetric(
                              "sidebar.conversation.click",
                              {
                                sessionId: session.id,
                                source: "conversation_shelf",
                                workspaceId: session.workspace_id ?? null,
                              },
                            );
                            if (multiSelectMode) {
                              toggleSelectedSession(session);
                              return;
                            }
                            onNavigateToConversation(session);
                          }}
                          onBlur={clearHoverPrefetch}
                          onFocus={() => scheduleHoverPrefetch(session)}
                          onPointerEnter={() => scheduleHoverPrefetch(session)}
                          onPointerLeave={clearHoverPrefetch}
                          title={title}
                        >
                          {multiSelectMode ? (
                            <ConversationSelectionMark $selected={selected}>
                              {selected ? <Check /> : null}
                            </ConversationSelectionMark>
                          ) : (
                            <ConversationItemDot
                              $active={isCurrentConversation}
                            />
                          )}
                          <ConversationItemLabel>{title}</ConversationItemLabel>
                          {favorite ? (
                            <ConversationFavoriteBadge
                              title="已收藏"
                              data-testid="app-sidebar-conversation-favorite-badge"
                            >
                              <Pin />
                            </ConversationFavoriteBadge>
                          ) : null}
                          <ConversationItemMeta>
                            {formatSidebarSessionMeta(session)}
                          </ConversationItemMeta>
                        </ConversationItemButton>
                        <ConversationItemActionButton
                          type="button"
                          aria-label={`打开 ${title} 操作菜单`}
                          title="更多操作"
                          disabled={actionSessionId === session.id}
                          onClick={(event) =>
                            openConversationMenu(event, session, true)
                          }
                        >
                          <MoreHorizontal />
                        </ConversationItemActionButton>
                      </ConversationItemRow>
                    );
                  })
                : renderEmptyState("暂无归档内容")}
            {hasMoreArchived ? (
              <ConversationListMoreButton
                type="button"
                onClick={onShowMoreArchived}
              >
                查看更多归档
              </ConversationListMoreButton>
            ) : null}
          </ConversationList>
        ) : null}
      </ConversationSection>
      {renderConversationMenu()}
    </ConversationShelf>
  );
}
