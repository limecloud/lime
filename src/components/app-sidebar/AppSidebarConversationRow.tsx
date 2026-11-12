import { useEffect, type MouseEvent } from "react";
import styled from "styled-components";
import {
  Archive,
  CircleAlert,
  Clock3,
  LoaderCircle,
  Pin,
  PinOff,
} from "lucide-react";
import type { AgentSessionInfo } from "@/lib/api/agentRuntime/sessionTypes";
import { recordAgentUiPerformanceMetric } from "@/lib/agentUiPerformanceMetrics";
import {
  isSessionUnread,
  markSessionRead,
} from "@/lib/sessionUnreadState";

type ConversationRuntimeStatus = "running" | "queued" | "waitingAction";

interface AppSidebarConversationRowProps {
  session: AgentSessionInfo;
  title: string;
  meta: string;
  active: boolean;
  runtimeStatus?: ConversationRuntimeStatus | null;
  runtimeStatusLabel?: string | null;
  actionDisabled: boolean;
  pinned?: boolean;
  pinLabel: string;
  unpinLabel: string;
  archiveLabel: string;
  unreadLabel?: string;
  onTogglePinned?: () => void;
  onArchive?: () => void;
  onNavigate: (session: AgentSessionInfo) => void;
  onOpenMenu: (
    event: MouseEvent<HTMLButtonElement>,
    session: AgentSessionInfo,
  ) => void;
}

const ConversationItemRow = styled.div<{
  $active?: boolean;
}>`
  position: relative;
  display: flex;
  align-items: center;
  gap: 0;
  width: 100%;
  border-radius: 10px;
  background: ${({ $active }) =>
    $active ? "var(--sidebar-active, #e8e8e6)" : "transparent"};
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
  gap: 8px;
  flex: 1;
  min-width: 0;
  min-height: 30px;
  border: none;
  border-radius: 10px;
  padding: 0 8px;
  background: transparent;
  color: ${({ $active }) =>
    $active ? "var(--sidebar-active-foreground)" : "var(--sidebar-foreground)"};
  cursor: pointer;
  text-align: left;
  transition: color 0.18s ease;

  ${ConversationItemRow}:hover &,
  ${ConversationItemRow}:focus-within & {
    padding-right: 58px;
  }
`;

const ConversationRuntimeStatusIcon = styled.span<{
  $status: ConversationRuntimeStatus;
}>`
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: ${({ $status }) => {
    switch ($status) {
      case "waitingAction":
        return "#b45309";
      case "queued":
        return "#0284c7";
      case "running":
        return "#059669";
    }
  }};

  &[data-status="running"] svg {
    animation: sidebar-conversation-status-spin 1s linear infinite;
  }

  svg {
    width: 14px;
    height: 14px;
  }

  @keyframes sidebar-conversation-status-spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
`;

const ConversationItemLabel = styled.span`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 500;
`;

const ConversationItemActions = styled.div`
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: 2px;
  padding-right: 2px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.18s ease;

  ${ConversationItemRow}:hover &,
  ${ConversationItemRow}:focus-within & {
    opacity: 1;
    pointer-events: auto;
  }
`;

const ConversationItemActionButton = styled.button`
  width: 26px;
  min-width: 26px;
  height: 26px;
  border: none;
  border-radius: 7px;
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

  &:disabled {
    cursor: default;
    opacity: 0.6;
  }

  svg {
    width: 15px;
    height: 15px;
  }
`;

export function AppSidebarConversationRow({
  session,
  title,
  meta,
  active,
  runtimeStatus,
  runtimeStatusLabel,
  actionDisabled,
  pinned = false,
  pinLabel,
  unpinLabel,
  archiveLabel,
  unreadLabel,
  onTogglePinned,
  onArchive,
  onNavigate,
  onOpenMenu,
}: AppSidebarConversationRowProps) {
  useEffect(() => {
    if (active) {
      markSessionRead(session.id);
    }
  }, [active, session.id]);
  const unread = !active && isSessionUnread(session);
  return (
    <ConversationItemRow
      $active={active}
      onContextMenu={(event) => {
        event.preventDefault();
        onOpenMenu(
          event as unknown as MouseEvent<HTMLButtonElement>,
          session,
        );
      }}
      data-active={active ? "true" : "false"}
    >
      <ConversationItemButton
        type="button"
        $active={active}
        data-testid="app-sidebar-conversation-open"
        data-session-id={session.id}
        aria-current={active ? "page" : undefined}
        onClick={() => {
          recordAgentUiPerformanceMetric("sidebar.conversation.click", {
            sessionId: session.id,
            source: "conversation_shelf",
            cwd: session.working_dir ?? null,
          });
          markSessionRead(session.id);
          onNavigate(session);
        }}
        title={title}
        aria-description={meta}
      >
        {runtimeStatus ? (
          <ConversationRuntimeStatusIcon
            $status={runtimeStatus}
            data-status={runtimeStatus}
            data-testid="app-sidebar-conversation-runtime-status"
            aria-label={runtimeStatusLabel ?? undefined}
            title={runtimeStatusLabel ?? undefined}
          >
            {runtimeStatus === "waitingAction" ? (
              <CircleAlert />
            ) : runtimeStatus === "queued" ? (
              <Clock3 />
            ) : (
              <LoaderCircle />
            )}
          </ConversationRuntimeStatusIcon>
        ) : null}
        <ConversationItemLabel>{title}</ConversationItemLabel>
        {unread ? (
          <span
            className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500"
            data-testid="app-sidebar-conversation-unread"
            aria-label={unreadLabel}
          />
        ) : null}
      </ConversationItemButton>
      <ConversationItemActions>
      {onTogglePinned ? (
        <ConversationItemActionButton
          type="button"
          aria-label={pinned ? unpinLabel : pinLabel}
          title={pinned ? unpinLabel : pinLabel}
          disabled={actionDisabled}
          data-testid="app-sidebar-conversation-pin"
          data-pinned={pinned ? "true" : "false"}
          onClick={onTogglePinned}
        >
          {pinned ? <PinOff /> : <Pin />}
        </ConversationItemActionButton>
      ) : null}
      {onArchive ? (
        <ConversationItemActionButton
          type="button"
          aria-label={archiveLabel}
          title={archiveLabel}
          disabled={actionDisabled}
          data-testid="app-sidebar-conversation-archive"
          onClick={onArchive}
        >
          <Archive />
        </ConversationItemActionButton>
      ) : null}
      </ConversationItemActions>
    </ConversationItemRow>
  );
}
