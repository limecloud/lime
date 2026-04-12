import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp, Workflow } from "lucide-react";
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
  resolveRuntimeFormationStatusMeta,
  resolveRuntimeMemberStatusMeta,
} from "../teamWorkspaceRuntime";
import { TeamWorkspaceBoard } from "./TeamWorkspaceBoard";
import type { TeamRoleDefinition } from "../utils/teamDefinitions";
import {
  TEAM_WORKSPACE_PLAN_LABEL,
  TEAM_WORKSPACE_REALTIME_BADGE_LABEL,
  TEAM_WORKSPACE_SURFACE_TITLE,
  TEAM_WORKSPACE_WAITING_HEADLINE,
} from "../utils/teamWorkspaceCopy";

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
  gap: 8px;
  min-height: ${({ $launcherOnly }) => ($launcherOnly ? "36px" : "42px")};
  padding: ${({ $launcherOnly }) => ($launcherOnly ? "6px 10px" : "8px 12px")};
  border-radius: 999px;
  border: 1px solid
    ${({ $active, $expanded }) =>
      $expanded
        ? "rgba(14, 116, 144, 0.28)"
        : $active
          ? "rgba(56, 189, 248, 0.32)"
          : "rgba(203, 213, 225, 0.9)"};
  background: ${({ $launcherOnly }) =>
    $launcherOnly ? "rgba(255, 255, 255, 0.98)" : "#ffffff"};
  color: #0f172a;
  box-shadow: ${({ $launcherOnly }) =>
    $launcherOnly
      ? "0 10px 24px -18px rgba(15, 23, 42, 0.18)"
      : "0 16px 40px -28px rgba(15, 23, 42, 0.28)"};
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
        : "0 18px 44px -28px rgba(15, 23, 42, 0.32)"};
  }
`;

const DockIconShell = styled.span<{
  $attention: boolean;
  $launcherOnly: boolean;
}>`
  position: relative;
  display: inline-flex;
  height: ${({ $launcherOnly }) => ($launcherOnly ? "24px" : "28px")};
  width: ${({ $launcherOnly }) => ($launcherOnly ? "24px" : "28px")};
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  border: 1px solid rgba(226, 232, 240, 0.9);
  background: #ffffff;
  color: #475569;

  ${({ $attention }) =>
    $attention
      ? css`
          color: #0369a1;
          border-color: rgba(125, 211, 252, 0.96);
        `
      : ""}
`;

const DockTextStack = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 8px;
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
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.4;
  border: 1px solid
    ${({ $tone }) =>
      $tone === "success"
        ? "rgba(167, 243, 208, 0.96)"
        : $tone === "error"
          ? "rgba(254, 205, 211, 0.96)"
          : $tone === "active"
            ? "rgba(186, 230, 253, 0.96)"
            : "rgba(226, 232, 240, 0.96)"};
  background: ${({ $tone }) =>
    $tone === "success"
      ? "#ecfdf5"
      : $tone === "error"
        ? "#fff1f2"
        : $tone === "active"
          ? "#f0f9ff"
          : "#f8fafc"};
  color: ${({ $tone }) =>
    $tone === "success"
      ? "#047857"
      : $tone === "error"
        ? "#be123c"
        : $tone === "active"
          ? "#0369a1"
          : "#64748b"};
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
  const hasRealTeamGraph =
    childSubagentSessions.length > 0 || Boolean(subagentParentContext);
  const hasRuntimeFormation = Boolean(dispatchPreviewState);
  const runtimeFormationMeta = dispatchPreviewState
    ? resolveRuntimeFormationStatusMeta(dispatchPreviewState.status)
    : null;
  const runtimeTeamLabel =
    dispatchPreviewState?.label?.trim() ||
    dispatchPreviewState?.blueprint?.label?.trim() ||
    selectedTeamLabel?.trim() ||
    null;
  const runtimeTeamSummary =
    dispatchPreviewState?.summary?.trim() ||
    dispatchPreviewState?.blueprint?.summary?.trim() ||
    selectedTeamSummary?.trim() ||
    null;
  const [expanded, setExpanded] = useState(false);
  const [userDismissedAutoExpand, setUserDismissedAutoExpand] = useState(false);
  const hasInitializedRef = useRef(false);
  const previousSessionIdRef = useRef<string | null>(currentSessionId ?? null);
  const previousHasRealGraphRef = useRef(hasRealTeamGraph);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const [inlinePanelLayout, setInlinePanelLayout] =
    useState<InlinePanelLayout | null>(null);
  const isCompact = !hasRealTeamGraph && !hasRuntimeFormation;
  const showAttentionCue =
    !expanded &&
    (hasRealTeamGraph ||
      dispatchPreviewState?.status === "forming" ||
      dispatchPreviewState?.status === "formed" ||
      dispatchPreviewState?.status === "failed");
  const dockCount = subagentParentContext
    ? (subagentParentContext.sibling_subagent_sessions?.length ?? 0) + 1
    : childSubagentSessions.length;
  const shouldPortalPanel = expanded;
  const [teamDetailExpanded, setTeamDetailExpanded] = useState(false);
  const hasSelectedTeamDetails =
    Boolean(runtimeTeamSummary) ||
    (dispatchPreviewState?.members.length ?? 0) > 0 ||
    Boolean(dispatchPreviewState?.blueprint?.summary?.trim()) ||
    (dispatchPreviewState?.blueprint?.roles.length ?? 0) > 0 ||
    Boolean(selectedTeamSummary?.trim()) ||
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
        ? `${runningRuntimeSessionCount} 位处理中`
        : null;
  const teamQueueBadgeText =
    (teamConcurrencySnapshot?.team_queued_count ?? queuedRuntimeSessionCount) >
    0
      ? `${teamConcurrencySnapshot?.team_queued_count ?? queuedRuntimeSessionCount} 位等待中`
      : null;
  const teamQueueReason = teamConcurrencySnapshot?.queue_reason?.trim() || null;
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

    if (hasRealTeamGraph) {
      if (activeRuntimeSessionCount > 0) {
        return {
          label:
            teamConcurrencyBadgeText || `${activeRuntimeSessionCount} 位处理中`,
          tone: "active",
        };
      }

      return {
        label: `${dockCount} 名成员`,
        tone: dockCount > 0 ? "success" : "idle",
      };
    }

    if (dispatchPreviewState?.status === "formed") {
      return dispatchPreviewState.members.length > 0
        ? {
            label: `${dispatchPreviewState.members.length} 名成员`,
            tone: "success",
          }
        : { label: "已就绪", tone: "success" };
    }

    if (runtimeTeamLabel) {
      return { label: "已准备", tone: "idle" };
    }

    return { label: "待开始", tone: "idle" };
  }, [
    activeRuntimeSessionCount,
    dockCount,
    hasRealTeamGraph,
    launcherOnly,
    teamConcurrencyBadgeText,
    runtimeTeamLabel,
    dispatchPreviewState,
  ]);
  const toggleLabel = useMemo(() => {
    if (expanded) {
      return "收起协作面板";
    }
    if (hasRealTeamGraph) {
      if (teamConcurrencyBadgeText || teamQueueBadgeText) {
        return ["查看任务进行时", teamConcurrencyBadgeText, teamQueueBadgeText]
          .filter(Boolean)
          .join(" · ");
      }
      return `查看任务进行时 · ${dockCount}`;
    }
    if (dispatchPreviewState?.status === "forming") {
      return "查看任务进行时 · 准备中";
    }
    if (dispatchPreviewState?.status === "formed") {
      return `查看任务进行时 · ${dispatchPreviewState.members.length}`;
    }
    if (dispatchPreviewState?.status === "failed") {
      return "查看任务进行时 · 失败";
    }
    return TEAM_WORKSPACE_SURFACE_TITLE;
  }, [
    dockCount,
    expanded,
    hasRealTeamGraph,
    dispatchPreviewState,
    teamConcurrencyBadgeText,
    teamQueueBadgeText,
  ]);
  const launcherPrimaryLabel = runtimeTeamLabel || TEAM_WORKSPACE_SURFACE_TITLE;

  useEffect(() => {
    const normalizedSessionId = currentSessionId ?? null;

    if (!hasInitializedRef.current) {
      previousSessionIdRef.current = normalizedSessionId;
      previousHasRealGraphRef.current = hasRealTeamGraph;
      hasInitializedRef.current = true;
      return;
    }

    if (previousSessionIdRef.current !== normalizedSessionId) {
      previousSessionIdRef.current = normalizedSessionId;
      previousHasRealGraphRef.current = hasRealTeamGraph;
      setUserDismissedAutoExpand(false);
      setExpanded(false);
      return;
    }

    const graphAppeared = !previousHasRealGraphRef.current && hasRealTeamGraph;
    const graphCleared = previousHasRealGraphRef.current && !hasRealTeamGraph;

    if (graphCleared) {
      setUserDismissedAutoExpand(false);
    }

    if (graphAppeared && !userDismissedAutoExpand) {
      setExpanded(true);
    }

    previousSessionIdRef.current = normalizedSessionId;
    previousHasRealGraphRef.current = hasRealTeamGraph;
  }, [currentSessionId, hasRealTeamGraph, userDismissedAutoExpand]);

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

  if (!shellVisible && !hasRealTeamGraph) {
    return null;
  }

  const panelContent = hasRealTeamGraph ? (
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
          <span className="inline-flex items-center gap-2">
            <Workflow className="h-3.5 w-3.5" />
            <span>{TEAM_WORKSPACE_SURFACE_TITLE}已启用</span>
          </span>
          <EmptyStateBadge $tone="success">
            {TEAM_WORKSPACE_REALTIME_BADGE_LABEL}
          </EmptyStateBadge>
          {runtimeFormationMeta ? (
            <EmptyStateBadge>{runtimeFormationMeta.label}</EmptyStateBadge>
          ) : null}
        </EmptyStateEyebrow>
        <EmptyStateTitle>
          {runtimeFormationMeta?.title || TEAM_WORKSPACE_WAITING_HEADLINE}
        </EmptyStateTitle>
        <EmptyStateDescription>
          {dispatchPreviewState?.status === "forming" ? (
            "系统正在按当前任务准备分工，成员接入后会自动展开完整协作面板。"
          ) : dispatchPreviewState?.status === "formed" ? (
            `已准备 ${dispatchPreviewState.members.length} 位协作成员，后续会自动接入并继续处理。`
          ) : dispatchPreviewState?.status === "failed" ? (
            dispatchPreviewState.errorMessage?.trim() ||
            "这次任务分工准备失败，你仍然可以继续在当前对话中处理。"
          ) : (
            <>需要时系统会自动安排任务分工，这里会切换成完整任务协作面板。</>
          )}
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
                    : "查看当前任务方案与分工"}
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
                        <EmptyStateRoleName>{member.label}</EmptyStateRoleName>
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
                        {member.summary}
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
                        <EmptyStateRoleName>{role.label}</EmptyStateRoleName>
                        <EmptyStateRoleSummary>
                          {role.summary}
                        </EmptyStateRoleSummary>
                      </EmptyStateRoleItem>
                    ))
                  : null}
                {dispatchPreviewState?.blueprint?.label ? (
                  <EmptyStateRoleItem>
                    <EmptyStateRoleName>
                      参考方案 · {dispatchPreviewState.blueprint.label}
                    </EmptyStateRoleName>
                    <EmptyStateRoleSummary>
                      {dispatchPreviewState.blueprint.summary ||
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
          {dispatchPreviewState?.members.length ? (
            <EmptyStateBadge>
              {dispatchPreviewState.members.length} 个成员
            </EmptyStateBadge>
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
            ? `打开${TEAM_WORKSPACE_SURFACE_TITLE}`
            : expanded
              ? `收起${TEAM_WORKSPACE_SURFACE_TITLE}`
              : `展开${TEAM_WORKSPACE_SURFACE_TITLE}`
        }
        $active={hasRealTeamGraph}
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
          <Workflow className="h-4 w-4" />
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
          <span className="min-w-0 truncate text-sm font-semibold text-slate-900">
            {toggleLabel}
          </span>
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
