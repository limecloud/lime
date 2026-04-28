import styled from "styled-components";
import {
  Archive,
  ChevronDown,
  Clock3,
  MessageSquarePlus,
  Undo2,
} from "lucide-react";
import type { AsterSessionInfo } from "@/lib/api/agentRuntime";

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
  onToggleArchive: (session: AsterSessionInfo, archived: boolean) => void;
  onShowMoreRecent: () => void;
  onShowMoreArchived: () => void;
  onToggleArchivedCollapsed: () => void;
}

const ConversationShelf = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 2px 0 12px;
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
    $active
      ? "var(--lime-sidebar-active, #e6f8ea)"
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
  background: color-mix(
    in srgb,
    var(--sidebar-search-bg, #ffffff) 78%,
    transparent
  );
  text-align: center;
`;

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
  onToggleArchive,
  onShowMoreRecent,
  onShowMoreArchived,
  onToggleArchivedCollapsed,
}: AppSidebarConversationShelfProps) {
  return (
    <ConversationShelf data-testid="app-sidebar-conversation-shelf">
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
                        onClick={() => onNavigateToConversation(session)}
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
                        disabled={actionSessionId === session.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          onToggleArchive(session, true);
                        }}
                      >
                        <Archive />
                      </ConversationItemActionButton>
                    </ConversationItemRow>
                  );
                })
              : renderEmptyState("还没有开始对话")}
          {hasMoreRecent ? (
            <ConversationListMoreButton type="button" onClick={onShowMoreRecent}>
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
                          onClick={() => onNavigateToConversation(session)}
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
                          aria-label={`恢复 ${resolveSidebarSessionTitle(session)}`}
                          title="恢复对话"
                          disabled={actionSessionId === session.id}
                          onClick={(event) => {
                            event.stopPropagation();
                            onToggleArchive(session, false);
                          }}
                        >
                          <Undo2 />
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
    </ConversationShelf>
  );
}
