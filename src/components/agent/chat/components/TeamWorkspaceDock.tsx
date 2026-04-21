import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp, ListTodo } from "lucide-react";
import styled, { css, keyframes } from "styled-components";
import type {
  AsterSubagentParentContext,
  AsterSubagentSessionInfo,
} from "@/lib/api/agentRuntime";
import type {
  TeamWorkspaceActivityEntry,
  TeamWorkspaceControlSummary,
  TeamWorkspaceLiveRuntimeState,
  TeamWorkspaceRuntimeFormationState,
  TeamWorkspaceWaitSummary,
} from "../teamWorkspaceRuntime";
import {
  resolveRuntimeMemberStatusMeta,
  summarizeTeamWorkspaceExecution,
} from "../teamWorkspaceRuntime";
import { buildRuntimeFormationDisplayState } from "../team-workspace-runtime/formationDisplaySelectors";
import { TeamWorkspaceBoard } from "./TeamWorkspaceBoard";
import type { TeamRoleDefinition } from "../utils/teamDefinitions";
import {
  TEAM_WORKSPACE_PLAN_LABEL,
  TEAM_WORKSPACE_SURFACE_TITLE,
  TEAM_WORKSPACE_WAITING_HEADLINE,
} from "../utils/teamWorkspaceCopy";
import { normalizeTeamWorkspaceDisplayValue } from "../utils/teamWorkspaceDisplay";

const DockContainer = styled.div<{
  $withBottomOverlay: boolean;
  $placement: "floating" | "inline";
}>`
  position: ${({ $placement }) =>
    $placement === "inline" ? "relative" : "absolute"};
  right: ${({ $placement }) => ($placement === "inline" ? "auto" : "14px")};
  bottom: ${({ $placement, $withBottomOverlay }) =>
    $placement === "inline" ? "auto" : $withBottomOverlay ? "108px" : "16px"};
  z-index: ${({ $placement }) => ($placement === "inline" ? 120 : 18)};
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  flex-shrink: 0;
  pointer-events: none;

  > * {
    pointer-events: auto;
  }
`;

const DockPanel = styled.div<{
  $compact?: boolean;
  $placement: "floating" | "inline" | "portal";
  $portalDirection?: "above" | "below";
}>`
  position: ${({ $placement }) =>
    $placement === "inline"
      ? "absolute"
      : $placement === "portal"
        ? "fixed"
        : "relative"};
  right: ${({ $placement }) =>
    $placement === "inline" ? "0" : $placement === "portal" ? "0" : "auto"};
  top: ${({ $placement }) => ($placement === "portal" ? "0" : "auto")};
  bottom: ${({ $placement }) =>
    $placement === "inline" ? "calc(100% + 8px)" : "auto"};
  width: ${({ $compact }) =>
    $compact
      ? "min(360px, calc(100vw - 72px))"
      : "min(720px, calc(100vw - 72px))"};
  max-height: ${({ $compact }) =>
    $compact
      ? "min(240px, calc(100vh - 240px))"
      : "min(620px, calc(100vh - 160px))"};
  overflow: ${({ $compact, $placement }) =>
    $compact ? "hidden" : $placement === "portal" ? "hidden" : "auto"};
  border-radius: 24px;
  display: flex;

  @media (max-width: 1280px) {
    width: ${({ $compact }) =>
      $compact
        ? "min(344px, calc(100vw - 64px))"
        : "min(640px, calc(100vw - 64px))"};
    max-height: ${({ $compact }) =>
      $compact
        ? "min(228px, calc(100vh - 220px))"
        : "min(560px, calc(100vh - 156px))"};
  }

  @media (max-width: 960px) {
    width: ${({ $compact }) =>
      $compact
        ? "min(336px, calc(100vw - 40px))"
        : "min(560px, calc(100vw - 40px))"};
    max-height: ${({ $compact }) =>
      $compact
        ? "min(220px, calc(100vh - 200px))"
        : "min(520px, calc(100vh - 148px))"};
  }

  @media (max-width: 720px) {
    width: calc(100vw - 28px);
    max-height: min(72vh, calc(100vh - 132px));
  }

  transform: ${({ $placement, $portalDirection }) =>
    $placement === "portal" && $portalDirection !== "below"
      ? "translateY(calc(-100% - 8px))"
      : "none"};
  transform-origin: ${({ $placement, $portalDirection }) =>
    $placement === "portal" && $portalDirection === "below"
      ? "top right"
      : "bottom right"};
  z-index: ${({ $placement }) =>
    $placement === "portal" ? 10010 : $placement === "inline" ? 121 : 1};
  pointer-events: none;

  > * {
    pointer-events: auto;
  }
`;

const dockAttentionPulse = keyframes`
  0%, 100% {
    box-shadow: 0 16px 40px -28px rgba(15, 23, 42, 0.28);
  }
  50% {
    box-shadow:
      0 18px 46px -28px rgba(15, 23, 42, 0.3),
      0 0 0 8px rgba(56, 189, 248, 0.08);
  }
`;

const dockSignalRipple = keyframes`
  0% {
    transform: scale(0.72);
    opacity: 0.72;
  }
  70% {
    transform: scale(1.4);
    opacity: 0;
  }
  100% {
    transform: scale(1.4);
    opacity: 0;
  }
`;

const DockToggle = styled.button<{
  $active: boolean;
  $expanded: boolean;
  $attention: boolean;
  $launcherOnly: boolean;
}>`
  display: inline-flex;
  align-items: center;
  gap: ${({ $launcherOnly }) => ($launcherOnly ? "8px" : "10px")};
  min-height: ${({ $launcherOnly }) => ($launcherOnly ? "36px" : "48px")};
  padding: ${({ $launcherOnly }) =>
    $launcherOnly ? "6px 10px" : "8px 12px 8px 10px"};
  border-radius: 999px;
  border: 1px solid
    ${({ $active, $expanded }) =>
      $expanded
        ? "rgba(14, 116, 144, 0.24)"
        : $active
          ? "rgba(186, 230, 253, 0.96)"
          : "rgba(203, 213, 225, 0.9)"};
  background: ${({ $launcherOnly, $expanded }) =>
    $launcherOnly
      ? "rgba(255, 255, 255, 0.98)"
      : $expanded
        ? "#ffffff"
        : "#f8fafc"};
  color: #0f172a;
  box-shadow: ${({ $launcherOnly }) =>
    $launcherOnly
      ? "0 10px 24px -18px rgba(15, 23, 42, 0.18)"
      : "0 12px 28px -24px rgba(15, 23, 42, 0.22)"};
  transition:
    transform 0.18s ease,
    box-shadow 0.18s ease,
    border-color 0.18s ease,
    background 0.18s ease;
  ${({ $attention }) =>
    $attention
      ? css`
          animation: ${dockAttentionPulse} 2.4s ease-in-out infinite;
        `
      : ""}
  ${({ $launcherOnly, $attention }) =>
    $launcherOnly && $attention
      ? css`
          animation: none;
        `
      : ""}

  &:hover {
    transform: translateY(-1px);
    box-shadow: ${({ $launcherOnly }) =>
      $launcherOnly
        ? "0 12px 28px -18px rgba(15, 23, 42, 0.22)"
        : "0 14px 30px -24px rgba(15, 23, 42, 0.24)"};
  }
`;

const DockIconShell = styled.span<{
  $attention: boolean;
  $launcherOnly: boolean;
}>`
  position: relative;
  display: inline-flex;
  height: ${({ $launcherOnly }) => ($launcherOnly ? "24px" : "26px")};
  width: ${({ $launcherOnly }) => ($launcherOnly ? "24px" : "26px")};
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  border: 1px solid rgba(226, 232, 240, 0.9);
  background: ${({ $launcherOnly }) =>
    $launcherOnly ? "#ffffff" : "rgba(255, 255, 255, 0.92)"};
  color: #475569;

  ${({ $attention }) =>
    $attention
      ? css`
          color: #0369a1;
          border-color: rgba(125, 211, 252, 0.72);
          background: #eff6ff;
        `
      : ""}
`;

const DockTextStack = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
`;

const DockSummaryStack = styled.span`
  display: inline-flex;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
`;

const DockSummaryEyebrow = styled.span`
  min-width: 0;
  color: #64748b;
  font-size: 10px;
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: 0.06em;
`;

const DockBadgeRow = styled.span`
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  min-width: 0;
`;

const DockPrimaryText = styled.span<{ $launcherOnly: boolean }>`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #0f172a;
  font-size: ${({ $launcherOnly }) => ($launcherOnly ? "13px" : "14px")};
  font-weight: 700;
`;

const DockStatusBadge = styled.span<{
  $tone: "idle" | "active" | "success" | "error";
}>`
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  border-radius: 999px;
  padding: 1px 7px 1px 6px;
  font-size: 10px;
  font-weight: 500;
  line-height: 1.35;
  border: 1px solid
    ${({ $tone }) =>
      $tone === "success"
        ? "rgba(167, 243, 208, 0.72)"
        : $tone === "error"
          ? "rgba(254, 205, 211, 0.72)"
          : $tone === "active"
            ? "rgba(186, 230, 253, 0.72)"
            : "rgba(226, 232, 240, 0.88)"};
  background: ${({ $tone }) =>
    $tone === "success"
      ? "rgba(236, 253, 245, 0.86)"
      : $tone === "error"
        ? "rgba(255, 241, 242, 0.86)"
        : $tone === "active"
          ? "rgba(240, 249, 255, 0.86)"
          : "rgba(248, 250, 252, 0.92)"};
  color: ${({ $tone }) =>
    $tone === "success"
      ? "#047857"
      : $tone === "error"
        ? "#be123c"
        : $tone === "active"
          ? "#0369a1"
          : "#64748b"};

  &::before {
    content: "";
    display: inline-flex;
    width: 5px;
    height: 5px;
    margin-right: 6px;
    border-radius: 999px;
    background: ${({ $tone }) =>
      $tone === "success"
        ? "#10b981"
        : $tone === "error"
          ? "#f43f5e"
          : $tone === "active"
            ? "#0ea5e9"
            : "#94a3b8"};
  }
`;

const DockSignal = styled.span`
  position: absolute;
  top: -2px;
  right: -1px;
  display: inline-flex;
  height: 10px;
  width: 10px;
  border-radius: 999px;
  background: #0ea5e9;
  box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.12);

  &::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: rgba(14, 165, 233, 0.36);
    animation: ${dockSignalRipple} 1.8s ease-out infinite;
  }
`;

const EmptyStateCard = styled.section`
  width: 100%;
  overflow: hidden;
  border: 1px solid rgba(226, 232, 240, 0.96);
  border-radius: 24px;
  background: #ffffff;
  box-shadow: 0 18px 52px -34px rgba(15, 23, 42, 0.24);
`;

const EmptyStateBody = styled.div`
  padding: 16px;
`;

const EmptyStateEyebrow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  color: #475569;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
`;

const EmptyStateBadge = styled.span<{ $tone?: "neutral" | "success" }>`
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  border: 1px solid
    ${({ $tone }) =>
      $tone === "success"
        ? "rgba(167, 243, 208, 0.96)"
        : "rgba(226, 232, 240, 0.96)"};
  background: ${({ $tone }) => ($tone === "success" ? "#ecfdf5" : "#f8fafc")};
  color: ${({ $tone }) => ($tone === "success" ? "#047857" : "#64748b")};
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.2;
`;

const EmptyStateTitle = styled.div`
  margin-top: 12px;
  color: #0f172a;
  font-size: 20px;
  font-weight: 700;
  line-height: 1.3;
`;

const EmptyStateDescription = styled.p`
  margin-top: 8px;
  color: #475569;
  font-size: 13px;
  line-height: 1.6;
`;

const EmptyStateFooter = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
`;

const EmptyStateDetailCard = styled.div`
  margin-top: 14px;
  border-radius: 18px;
  border: 1px solid rgba(226, 232, 240, 0.96);
  background: #f8fafc;
  overflow: hidden;
`;

const EmptyStateDetailToggle = styled.button`
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  background: transparent;
  color: #0f172a;
  text-align: left;
  transition: background 0.18s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.72);
  }
`;

const EmptyStateDetailTitle = styled.div`
  color: #0f172a;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.4;
`;

const EmptyStateDetailHint = styled.div`
  margin-top: 2px;
  color: #64748b;
  font-size: 12px;
  line-height: 1.5;
`;

const EmptyStateRoleList = styled.div`
  display: grid;
  gap: 10px;
  padding: 0 14px 14px;
`;

const EmptyStateRoleItem = styled.div`
  border-radius: 14px;
  border: 1px solid rgba(226, 232, 240, 0.96);
  background: #ffffff;
  padding: 10px 12px;
`;

const EmptyStateRoleName = styled.div`
  color: #0f172a;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.4;
`;

const EmptyStateRoleSummary = styled.div`
  margin-top: 4px;
  color: #475569;
  font-size: 12px;
  line-height: 1.55;
`;

interface TeamWorkspaceDockProps {
  shellVisible?: boolean;
  withBottomOverlay?: boolean;
  placement?: "floating" | "inline";
  onActivateWorkbench?: () => void;
  currentSessionId?: string | null;
  currentSessionName?: string | null;
  currentSessionRuntimeStatus?: AsterSubagentSessionInfo["runtime_status"];
  currentSessionLatestTurnStatus?: AsterSubagentSessionInfo["runtime_status"];
  currentSessionQueuedTurnCount?: number;
  childSubagentSessions?: AsterSubagentSessionInfo[];
  subagentParentContext?: AsterSubagentParentContext | null;
  liveRuntimeBySessionId?: Record<string, TeamWorkspaceLiveRuntimeState>;
  liveActivityBySessionId?: Record<string, TeamWorkspaceActivityEntry[]>;
  activityRefreshVersionBySessionId?: Record<string, number>;
  onSendSubagentInput?: (
    sessionId: string,
    message: string,
    options?: { interrupt?: boolean },
  ) => void | Promise<void>;
  onWaitSubagentSession?: (
    sessionId: string,
    timeoutMs?: number,
  ) => void | Promise<void>;
  onWaitActiveTeamSessions?: (
    sessionIds: string[],
    timeoutMs?: number,
  ) => void | Promise<void>;
  onCloseCompletedTeamSessions?: (sessionIds: string[]) => void | Promise<void>;
  onCloseSubagentSession?: (sessionId: string) => void | Promise<void>;
  onResumeSubagentSession?: (sessionId: string) => void | Promise<void>;
  onOpenSubagentSession?: (sessionId: string) => void | Promise<void>;
  onReturnToParentSession?: () => void | Promise<void>;
  teamWaitSummary?: TeamWorkspaceWaitSummary | null;
  teamControlSummary?: TeamWorkspaceControlSummary | null;
  selectedTeamLabel?: string | null;
  selectedTeamSummary?: string | null;
  selectedTeamRoles?: TeamRoleDefinition[] | null;
  teamDispatchPreviewState?: TeamWorkspaceRuntimeFormationState | null;
}

interface InlinePanelLayout {
  direction: "above" | "below";
  maxHeight: number;
  right: number;
  top: number;
}

export function TeamWorkspaceDock({
  shellVisible = false,
  withBottomOverlay = false,
  placement = "floating",
  onActivateWorkbench,
  currentSessionId,
  currentSessionName,
  currentSessionRuntimeStatus,
  currentSessionLatestTurnStatus,
  currentSessionQueuedTurnCount = 0,
  childSubagentSessions = [],
  subagentParentContext = null,
  liveRuntimeBySessionId = {},
  liveActivityBySessionId = {},
  activityRefreshVersionBySessionId = {},
  onSendSubagentInput,
  onWaitSubagentSession,
  onWaitActiveTeamSessions,
  onCloseCompletedTeamSessions,
  onCloseSubagentSession,
  onResumeSubagentSession,
  onOpenSubagentSession,
  onReturnToParentSession,
  teamWaitSummary = null,
  teamControlSummary = null,
  selectedTeamLabel,
  selectedTeamSummary,
  selectedTeamRoles = [],
  teamDispatchPreviewState = null,
}: TeamWorkspaceDockProps) {
  const dispatchPreviewState = teamDispatchPreviewState;
  const launcherOnly = typeof onActivateWorkbench === "function";
  const executionSummary = summarizeTeamWorkspaceExecution({
    currentSessionId,
    currentSessionRuntimeStatus,
    currentSessionLatestTurnStatus,
    currentSessionQueuedTurnCount,
    childSubagentSessions,
    subagentParentContext,
    liveRuntimeBySessionId,
  });
  const hasRuntimeSessions = executionSummary.totalSessionCount > 0;
  const hasRuntimeFormation = Boolean(dispatchPreviewState);
  const runtimeFormationDisplay = buildRuntimeFormationDisplayState({
    teamDispatchPreviewState: dispatchPreviewState,
    fallbackLabel: selectedTeamLabel,
    fallbackSummary: selectedTeamSummary,
  });
  const runtimeTeamLabel = runtimeFormationDisplay.panelLabel;
  const runtimeBlueprintSummary = normalizeTeamWorkspaceDisplayValue(
    dispatchPreviewState?.blueprint?.summary,
  );
  const normalizedSelectedTeamSummary = normalizeTeamWorkspaceDisplayValue(
    selectedTeamSummary,
  );
  const runtimeTeamSummary =
    normalizeTeamWorkspaceDisplayValue(dispatchPreviewState?.summary) ||
    runtimeBlueprintSummary ||
    normalizedSelectedTeamSummary ||
    null;
  const runtimeTaskCount = dispatchPreviewState?.members.length ?? 0;
  const [expanded, setExpanded] = useState(false);
  const [userDismissedAutoExpand, setUserDismissedAutoExpand] = useState(false);
  const hasInitializedRef = useRef(false);
  const previousSessionIdRef = useRef<string | null>(currentSessionId ?? null);
  const previousHasRuntimeSessionsRef = useRef(hasRuntimeSessions);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const [inlinePanelLayout, setInlinePanelLayout] =
    useState<InlinePanelLayout | null>(null);
  const isCompact = !hasRuntimeSessions && !hasRuntimeFormation;
  const showAttentionCue =
    !expanded && (hasRuntimeSessions || hasRuntimeFormation);
  const shouldPortalPanel = expanded;
  const [teamDetailExpanded, setTeamDetailExpanded] = useState(false);
  const hasSelectedTeamDetails =
    Boolean(runtimeTeamSummary) ||
    runtimeTaskCount > 0 ||
    Boolean(runtimeBlueprintSummary) ||
    (dispatchPreviewState?.blueprint?.roles.length ?? 0) > 0 ||
    Boolean(normalizedSelectedTeamSummary) ||
    (selectedTeamRoles?.length ?? 0) > 0;
  const activeRuntimeSessionCount = childSubagentSessions.filter(
    (session) =>
      session.runtime_status === "queued" ||
      session.runtime_status === "running",
  ).length;
  const runningRuntimeSessionCount = childSubagentSessions.filter(
    (session) => session.runtime_status === "running",
  ).length;
  const queuedRuntimeSessionCount = childSubagentSessions.filter(
    (session) => session.runtime_status === "queued",
  ).length;
  const teamConcurrencySnapshot = childSubagentSessions.find(
    (session) =>
      session.team_parallel_budget !== undefined ||
      session.team_active_count !== undefined ||
      session.team_queued_count !== undefined ||
      session.provider_parallel_budget !== undefined ||
      Boolean(session.queue_reason),
  );
  const teamConcurrencyBadgeText =
    teamConcurrencySnapshot?.team_parallel_budget !== undefined
      ? `${teamConcurrencySnapshot.team_active_count ?? runningRuntimeSessionCount}/${teamConcurrencySnapshot.team_parallel_budget} 处理中`
      : runningRuntimeSessionCount > 0
        ? `${runningRuntimeSessionCount} 项处理中`
        : null;
  const teamQueueBadgeText =
    (teamConcurrencySnapshot?.team_queued_count ?? queuedRuntimeSessionCount) >
    0
      ? `${teamConcurrencySnapshot?.team_queued_count ?? queuedRuntimeSessionCount} 项等待中`
      : null;
  const teamQueueReason = normalizeTeamWorkspaceDisplayValue(
    teamConcurrencySnapshot?.queue_reason,
  );
  const launcherStatusMeta = useMemo<{
    label: string;
    tone: "idle" | "active" | "success" | "error";
  } | null>(() => {
    if (!launcherOnly) {
      return null;
    }

    if (dispatchPreviewState?.status === "forming") {
      return { label: "准备中", tone: "active" };
    }

    if (dispatchPreviewState?.status === "failed") {
      return { label: "失败", tone: "error" };
    }

    if (hasRuntimeSessions) {
      if (activeRuntimeSessionCount > 0) {
        return {
          label:
            teamConcurrencyBadgeText || `${activeRuntimeSessionCount} 项处理中`,
          tone: "active",
        };
      }

      return {
        label: `${executionSummary.totalSessionCount} 项任务`,
        tone: executionSummary.totalSessionCount > 0 ? "success" : "idle",
      };
    }

    if (dispatchPreviewState?.status === "formed") {
      return runtimeTaskCount > 0
        ? {
            label: `${runtimeTaskCount} 项任务`,
            tone: "success",
          }
        : {
            label: runtimeFormationDisplay.panelStatusLabel || "已就绪",
            tone: "success",
          };
    }

    if (runtimeTeamLabel) {
      return { label: "已准备", tone: "idle" };
    }

    return { label: "待开始", tone: "idle" };
  }, [
    activeRuntimeSessionCount,
    executionSummary.totalSessionCount,
    hasRuntimeSessions,
    launcherOnly,
    teamConcurrencyBadgeText,
    runtimeFormationDisplay.panelStatusLabel,
    runtimeTaskCount,
    runtimeTeamLabel,
    dispatchPreviewState,
  ]);
  const dockStatusBadges = useMemo<
    Array<{
      label: string;
      tone: "idle" | "active" | "success" | "error";
    }>
  >(() => {
    if (hasRuntimeSessions) {
      const badges: Array<{
        label: string;
        tone: "idle" | "active" | "success" | "error";
      }> = [];

      if (teamConcurrencyBadgeText || teamQueueBadgeText) {
        if (teamConcurrencyBadgeText) {
          badges.push({ label: teamConcurrencyBadgeText, tone: "active" });
        }
        if (teamQueueBadgeText) {
          badges.push({ label: teamQueueBadgeText, tone: "idle" });
        }
        return badges;
      }

      return [
        {
          label: `${executionSummary.totalSessionCount} 项任务`,
          tone:
            executionSummary.totalSessionCount > 0 ? "success" : "idle",
        },
      ];
    }
    if (dispatchPreviewState?.status === "forming") {
      return [
        {
          label: runtimeFormationDisplay.panelStatusLabel || "准备中",
          tone: "active",
        },
      ];
    }
    if (dispatchPreviewState?.status === "formed") {
      return [
        {
          label:
            runtimeTaskCount > 0
              ? `${runtimeTaskCount} 项任务`
              : runtimeFormationDisplay.panelStatusLabel || "已就绪",
          tone: "success",
        },
      ];
    }
    if (dispatchPreviewState?.status === "failed") {
      return [
        {
          label: runtimeFormationDisplay.panelStatusLabel || "失败",
          tone: "error",
        },
      ];
    }

    return runtimeTeamLabel ? [{ label: "已准备", tone: "idle" }] : [];
  }, [
    executionSummary.totalSessionCount,
    hasRuntimeSessions,
    runtimeTaskCount,
    dispatchPreviewState,
    runtimeFormationDisplay.panelStatusLabel,
    teamConcurrencyBadgeText,
    teamQueueBadgeText,
    runtimeTeamLabel,
  ]);
  const launcherPrimaryLabel = runtimeTeamLabel || "当前进展";
  const dockPrimaryLabel = "当前进展";

  useEffect(() => {
    const normalizedSessionId = currentSessionId ?? null;

    if (!hasInitializedRef.current) {
      previousSessionIdRef.current = normalizedSessionId;
      previousHasRuntimeSessionsRef.current = hasRuntimeSessions;
      hasInitializedRef.current = true;
      return;
    }

    if (previousSessionIdRef.current !== normalizedSessionId) {
      previousSessionIdRef.current = normalizedSessionId;
      previousHasRuntimeSessionsRef.current = hasRuntimeSessions;
      setUserDismissedAutoExpand(false);
      setExpanded(false);
      return;
    }

    const runtimeSessionsAppeared =
      !previousHasRuntimeSessionsRef.current && hasRuntimeSessions;
    const runtimeSessionsCleared =
      previousHasRuntimeSessionsRef.current && !hasRuntimeSessions;

    if (runtimeSessionsCleared) {
      setUserDismissedAutoExpand(false);
    }

    if (runtimeSessionsAppeared && !userDismissedAutoExpand) {
      setExpanded(true);
    }

    previousSessionIdRef.current = normalizedSessionId;
    previousHasRuntimeSessionsRef.current = hasRuntimeSessions;
  }, [currentSessionId, hasRuntimeSessions, userDismissedAutoExpand]);

  const updateInlinePanelLayout = useCallback(() => {
    if (
      !shouldPortalPanel ||
      typeof window === "undefined" ||
      !toggleRef.current
    ) {
      return;
    }

    const rect = toggleRef.current.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const availableAbove = Math.max(0, rect.top - 20);
    const availableBelow = Math.max(0, viewportHeight - rect.bottom - 20);
    const direction =
      availableAbove >= 260 || availableAbove >= availableBelow
        ? "above"
        : "below";

    setInlinePanelLayout({
      direction,
      maxHeight:
        direction === "above"
          ? Math.min(620, Math.max(availableAbove, 120))
          : Math.min(620, Math.max(availableBelow, 120)),
      right: Math.max(14, viewportWidth - rect.right),
      top:
        direction === "above"
          ? Math.max(12, rect.top)
          : Math.min(viewportHeight - 12, rect.bottom + 8),
    });
  }, [shouldPortalPanel]);

  useEffect(() => {
    if (!shouldPortalPanel || typeof window === "undefined") {
      setInlinePanelLayout(null);
      return;
    }

    updateInlinePanelLayout();
    window.addEventListener("resize", updateInlinePanelLayout);
    window.addEventListener("scroll", updateInlinePanelLayout, true);
    return () => {
      window.removeEventListener("resize", updateInlinePanelLayout);
      window.removeEventListener("scroll", updateInlinePanelLayout, true);
    };
  }, [shouldPortalPanel, updateInlinePanelLayout]);

  if (!shellVisible && !hasRuntimeSessions) {
    return null;
  }

  const panelContent = hasRuntimeSessions ? (
    <TeamWorkspaceBoard
      embedded={true}
      shellVisible={shellVisible}
      defaultShellExpanded={true}
      currentSessionId={currentSessionId}
      currentSessionName={currentSessionName}
      currentSessionRuntimeStatus={currentSessionRuntimeStatus}
      currentSessionLatestTurnStatus={currentSessionLatestTurnStatus}
      currentSessionQueuedTurnCount={currentSessionQueuedTurnCount}
      childSubagentSessions={childSubagentSessions}
      subagentParentContext={subagentParentContext}
      liveRuntimeBySessionId={liveRuntimeBySessionId}
      liveActivityBySessionId={liveActivityBySessionId}
      activityRefreshVersionBySessionId={activityRefreshVersionBySessionId}
      onSendSubagentInput={onSendSubagentInput}
      onWaitSubagentSession={onWaitSubagentSession}
      onWaitActiveTeamSessions={onWaitActiveTeamSessions}
      onCloseCompletedTeamSessions={onCloseCompletedTeamSessions}
      onCloseSubagentSession={onCloseSubagentSession}
      onResumeSubagentSession={onResumeSubagentSession}
      onOpenSubagentSession={onOpenSubagentSession}
      onReturnToParentSession={onReturnToParentSession}
      teamWaitSummary={teamWaitSummary}
      teamControlSummary={teamControlSummary}
      selectedTeamLabel={selectedTeamLabel}
      selectedTeamSummary={selectedTeamSummary}
      selectedTeamRoles={selectedTeamRoles}
      teamDispatchPreviewState={dispatchPreviewState}
    />
  ) : (
    <EmptyStateCard data-testid="team-workspace-empty-card" role="status">
      <EmptyStateBody>
        <EmptyStateEyebrow>
          <EmptyStateBadge>{TEAM_WORKSPACE_SURFACE_TITLE}</EmptyStateBadge>
          {runtimeFormationDisplay.panelStatusLabel ? (
            <EmptyStateBadge>
              {runtimeFormationDisplay.panelStatusLabel}
            </EmptyStateBadge>
          ) : null}
        </EmptyStateEyebrow>
        <EmptyStateTitle>
          {runtimeFormationDisplay.panelHeadline ||
            TEAM_WORKSPACE_WAITING_HEADLINE}
        </EmptyStateTitle>
        <EmptyStateDescription>
          {dispatchPreviewState
            ? runtimeFormationDisplay.noticeText
            : runtimeFormationDisplay.panelDescription}
        </EmptyStateDescription>
        {teamQueueReason ? (
          <EmptyStateBadge>{teamQueueReason}</EmptyStateBadge>
        ) : null}
        {runtimeTeamLabel && hasSelectedTeamDetails ? (
          <EmptyStateDetailCard>
            <EmptyStateDetailToggle
              type="button"
              onClick={() => setTeamDetailExpanded((previous) => !previous)}
              aria-expanded={teamDetailExpanded}
              data-testid="team-workspace-selected-team-toggle"
            >
              <div>
                <EmptyStateDetailTitle>
                  {runtimeTeamLabel}
                </EmptyStateDetailTitle>
                <EmptyStateDetailHint>
                  {dispatchPreviewState
                    ? "查看当前任务分工与参考方案"
                    : "查看当前分工方案"}
                </EmptyStateDetailHint>
              </div>
              {teamDetailExpanded ? (
                <ChevronUp className="h-4 w-4 text-slate-500" />
              ) : (
                <ChevronDown className="h-4 w-4 text-slate-500" />
              )}
            </EmptyStateDetailToggle>
            {teamDetailExpanded ? (
              <EmptyStateRoleList data-testid="team-workspace-selected-team-detail">
                {runtimeTeamSummary ? (
                  <EmptyStateRoleItem>
                    <EmptyStateRoleName>
                      {dispatchPreviewState ? "当前摘要" : "方案摘要"}
                    </EmptyStateRoleName>
                    <EmptyStateRoleSummary>
                      {runtimeTeamSummary}
                    </EmptyStateRoleSummary>
                  </EmptyStateRoleItem>
                ) : null}
                {dispatchPreviewState?.members.map((member) => {
                  const memberStatusMeta = resolveRuntimeMemberStatusMeta(
                    member.status,
                  );
                  return (
                    <EmptyStateRoleItem key={`dock-runtime-role-${member.id}`}>
                      <div className="flex flex-wrap items-center gap-2">
                        <EmptyStateRoleName>
                          {normalizeTeamWorkspaceDisplayValue(member.label) ||
                            member.label}
                        </EmptyStateRoleName>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${memberStatusMeta.badgeClassName}`}
                        >
                          {memberStatusMeta.label}
                        </span>
                        {member.roleKey ? (
                          <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-500">
                            {member.roleKey}
                          </span>
                        ) : null}
                        {member.profileId ? (
                          <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-500">
                            {member.profileId}
                          </span>
                        ) : null}
                      </div>
                      <EmptyStateRoleSummary>
                        {normalizeTeamWorkspaceDisplayValue(member.summary) ||
                          member.summary}
                      </EmptyStateRoleSummary>
                      {member.skillIds.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {member.skillIds.map((skillId) => (
                            <span
                              key={`${member.id}-${skillId}`}
                              className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-500"
                            >
                              {skillId}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </EmptyStateRoleItem>
                  );
                })}
                {!dispatchPreviewState
                  ? selectedTeamRoles?.map((role) => (
                      <EmptyStateRoleItem key={`dock-role-${role.id}`}>
                        <EmptyStateRoleName>
                          {normalizeTeamWorkspaceDisplayValue(role.label) ||
                            role.label}
                        </EmptyStateRoleName>
                        <EmptyStateRoleSummary>
                          {normalizeTeamWorkspaceDisplayValue(role.summary) ||
                            role.summary}
                        </EmptyStateRoleSummary>
                      </EmptyStateRoleItem>
                    ))
                  : null}
                {runtimeFormationDisplay.referenceLabel ? (
                  <EmptyStateRoleItem>
                    <EmptyStateRoleName>
                      参考方案 · {runtimeFormationDisplay.referenceLabel}
                    </EmptyStateRoleName>
                    <EmptyStateRoleSummary>
                      {runtimeBlueprintSummary ||
                        "当前任务分工参考了当前方案里的角色偏好。"}
                    </EmptyStateRoleSummary>
                  </EmptyStateRoleItem>
                ) : null}
              </EmptyStateRoleList>
            ) : null}
          </EmptyStateDetailCard>
        ) : null}
        <EmptyStateFooter>
          {runtimeTeamLabel ? (
            <EmptyStateBadge data-testid="team-workspace-selected-team">
              当前{TEAM_WORKSPACE_PLAN_LABEL}：{runtimeTeamLabel}
            </EmptyStateBadge>
          ) : null}
          {runtimeTeamSummary ? (
            <EmptyStateBadge>{runtimeTeamSummary}</EmptyStateBadge>
          ) : null}
          {runtimeTaskCount > 0 ? (
            <EmptyStateBadge>{runtimeTaskCount} 项任务</EmptyStateBadge>
          ) : null}
          <EmptyStateBadge>不遮挡画布</EmptyStateBadge>
        </EmptyStateFooter>
      </EmptyStateBody>
    </EmptyStateCard>
  );

  const panelNode = (
    <DockPanel
      $compact={isCompact}
      $placement={shouldPortalPanel ? "portal" : placement}
      $portalDirection={inlinePanelLayout?.direction}
      data-testid="team-workspace-dock-panel"
      style={
        shouldPortalPanel && inlinePanelLayout
          ? {
              maxHeight: `${inlinePanelLayout.maxHeight}px`,
              right: `${inlinePanelLayout.right}px`,
              top: `${inlinePanelLayout.top}px`,
            }
          : undefined
      }
    >
      {panelContent}
    </DockPanel>
  );

  return (
    <DockContainer
      $placement={placement}
      $withBottomOverlay={withBottomOverlay}
      data-testid="team-workspace-dock"
    >
      {!launcherOnly && expanded && !shouldPortalPanel ? panelNode : null}
      <DockToggle
        type="button"
        data-testid="team-workspace-dock-toggle"
        ref={toggleRef}
        aria-expanded={launcherOnly ? false : expanded}
        aria-label={
          launcherOnly
            ? "打开当前进展"
            : expanded
              ? "收起当前进展"
              : "展开当前进展"
        }
        $active={hasRuntimeSessions}
        $expanded={expanded}
        $attention={showAttentionCue}
        $launcherOnly={launcherOnly}
        onClick={() => {
          if (launcherOnly) {
            onActivateWorkbench?.();
            return;
          }
          setExpanded((previous) => {
            const nextExpanded = !previous;
            if (previous && !nextExpanded) {
              setUserDismissedAutoExpand(true);
            }
            if (!previous && nextExpanded) {
              setUserDismissedAutoExpand(false);
            }
            return nextExpanded;
          });
        }}
      >
        <DockIconShell
          $attention={showAttentionCue}
          $launcherOnly={launcherOnly}
        >
          <ListTodo className="h-4 w-4" />
          {showAttentionCue ? (
            <DockSignal
              aria-hidden="true"
              data-testid="team-workspace-dock-signal"
            />
          ) : null}
        </DockIconShell>
        {launcherOnly ? (
          <DockTextStack>
            <DockPrimaryText $launcherOnly={true}>
              {launcherPrimaryLabel}
            </DockPrimaryText>
            {launcherStatusMeta ? (
              <DockStatusBadge $tone={launcherStatusMeta.tone}>
                {launcherStatusMeta.label}
              </DockStatusBadge>
            ) : null}
          </DockTextStack>
        ) : (
          <DockSummaryStack data-testid="team-workspace-dock-summary">
            <DockSummaryEyebrow>{dockPrimaryLabel}</DockSummaryEyebrow>
            <DockBadgeRow data-testid="team-workspace-dock-badges">
              {dockStatusBadges.map((badge) => (
                <DockStatusBadge key={badge.label} $tone={badge.tone}>
                  {badge.label}
                </DockStatusBadge>
              ))}
            </DockBadgeRow>
          </DockSummaryStack>
        )}
      </DockToggle>
      {!launcherOnly &&
      expanded &&
      shouldPortalPanel &&
      inlinePanelLayout &&
      typeof document !== "undefined"
        ? createPortal(panelNode, document.body)
        : null}
    </DockContainer>
  );
}
