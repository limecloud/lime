import type { MouseEvent } from "react";
import styled from "styled-components";
import {
  CircleAlert,
  Clock3,
  LoaderCircle,
  MoreHorizontal,
} from "lucide-react";
import type { AgentSessionInfo } from "@/lib/api/agentRuntime/sessionTypes";
import { recordAgentUiPerformanceMetric } from "@/lib/agentUiPerformanceMetrics";

type ConversationRuntimeStatus = "running" | "queued" | "waitingAction";

interface AppSidebarConversationRowProps {
  session: AgentSessionInfo;
  title: string;
  meta: string;
  active: boolean;
  runtimeStatus?: ConversationRuntimeStatus | null;
  runtimeStatusLabel?: string | null;
  actionDisabled: boolean;
  moreActionsLabel: string;
  openActionMenuLabel: string;
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
  border-radius: 7px;
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
  min-height: 26px;
  border: none;
  border-radius: 7px;
  padding: 0 7px;
  background: transparent;
  color: ${({ $active }) =>
    $active ? "var(--sidebar-active-foreground)" : "var(--sidebar-foreground)"};
  cursor: pointer;
  text-align: left;
  transition: color 0.18s ease;

  ${ConversationItemRow}:hover &,
  ${ConversationItemRow}:focus-within & {
    padding-right: 30px;
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

const ConversationItemActionButton = styled.button`
  position: absolute;
  right: 0;
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
    cursor: default;
    opacity: 0.6;
  }

  ${ConversationItemRow}:hover &,
  ${ConversationItemRow}:focus-within & {
    opacity: 1;
    pointer-events: auto;
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
  moreActionsLabel,
  openActionMenuLabel,
  onNavigate,
  onOpenMenu,
}: AppSidebarConversationRowProps) {
  return (
    <ConversationItemRow
      $active={active}
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
      </ConversationItemButton>
      <ConversationItemActionButton
        type="button"
        aria-label={openActionMenuLabel}
        title={moreActionsLabel}
        disabled={actionDisabled}
        onClick={(event) => onOpenMenu(event, session)}
      >
        <MoreHorizontal />
      </ConversationItemActionButton>
    </ConversationItemRow>
  );
}
