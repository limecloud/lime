import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import {
  Bot,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAgentRuntimeSession } from "@/lib/api/agentRuntime";
import type {
  AsterSubagentSkillInfo,
  AsterSubagentParentContext,
  AsterSubagentSessionInfo,
} from "@/lib/api/agentRuntime";
import { formatRelativeTime } from "@/lib/api/project";
import { cn } from "@/lib/utils";
import type { TeamRoleDefinition } from "../utils/teamDefinitions";
import {
  applyLiveRuntimeState,
  isTeamWorkspaceActiveStatus,
  type TeamWorkspaceActivityEntry,
  type TeamWorkspaceControlSummary,
  type TeamWorkspaceLiveRuntimeState,
  type TeamWorkspaceRuntimeFormationState,
  type TeamWorkspaceWaitSummary,
} from "../teamWorkspaceRuntime";
import {
  buildTeamWorkspaceCanvasAutoLayout,
  buildDefaultTeamWorkspaceCanvasItemLayout,
  clampTeamWorkspaceCanvasZoom,
  createDefaultTeamWorkspaceCanvasLayoutState,
  loadTeamWorkspaceCanvasLayout,
  persistTeamWorkspaceCanvasLayout,
  TEAM_WORKSPACE_CANVAS_MAX_ZOOM,
  TEAM_WORKSPACE_CANVAS_MIN_HEIGHT,
  TEAM_WORKSPACE_CANVAS_MIN_WIDTH,
  TEAM_WORKSPACE_CANVAS_MIN_ZOOM,
  type TeamWorkspaceCanvasItemLayout,
  type TeamWorkspaceCanvasLayoutState,
} from "../utils/teamWorkspaceCanvas";
import {
  resolveTeamWorkspaceDisplayRuntimeStatusLabel,
  TEAM_WORKSPACE_MAIN_ASSISTANT_LABEL,
} from "../utils/teamWorkspaceCopy";
import {
  buildPreviewableRailSessionsSyncKey,
  buildSelectedSessionActivityState,
  collectStaleSessionActivityTargets,
  extractSessionActivitySnapshot,
  type SessionActivityPreviewState,
} from "../team-workspace-runtime/activityPreviewSelectors";
import { buildTeamWorkspaceBoardChromeDisplayState } from "../team-workspace-runtime/boardChromeSelectors";
import {
  buildTeamWorkspaceCanvasLanes,
  type TeamWorkspaceCanvasLane,
  type TeamWorkspaceCanvasLaneKind,
} from "../team-workspace-runtime/canvasLaneSelectors";
import {
  buildRuntimeFormationDisplayState,
  buildSelectedTeamPlanDisplayState,
} from "../team-workspace-runtime/formationDisplaySelectors";
import { buildSelectedSessionDetailDisplayState } from "../team-workspace-runtime/selectedSessionDetailSelectors";
import {
  buildTeamWorkspaceSessionControlState,
  isWaitableTeamSession,
} from "../team-workspace-runtime/sessionStateSelectors";
import {
  buildVisibleTeamOperationState,
  type TeamOperationDisplayEntry,
} from "../team-workspace-runtime/teamOperationSelectors";
import { TeamWorkspaceBoardHeader } from "./team-workspace-board/TeamWorkspaceBoardHeader";
import { TeamWorkspaceEmptyShellState } from "./team-workspace-board/TeamWorkspaceEmptyShellState";
import {
  TeamWorkspaceRuntimeFormationPanel,
  TeamWorkspaceSelectedPlanPanel,
} from "./team-workspace-board/TeamWorkspaceFormationPanels";
import { TeamWorkspaceCanvasStage } from "./team-workspace-board/TeamWorkspaceCanvasStage";
import { SelectedSessionInlineDetail } from "./team-workspace-board/SelectedSessionInlineDetail";
import { TeamWorkspaceTeamOverviewChrome } from "./team-workspace-board/TeamWorkspaceTeamOverviewChrome";

type RuntimeStatus = AsterSubagentSessionInfo["runtime_status"];

interface TeamWorkspaceBoardProps {
  className?: string;
  embedded?: boolean;
  shellVisible?: boolean;
  defaultShellExpanded?: boolean;
  currentSessionId?: string | null;
  currentSessionName?: string | null;
  currentSessionRuntimeStatus?: RuntimeStatus;
  currentSessionLatestTurnStatus?: RuntimeStatus;
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

interface TeamSessionCard {
  id: string;
  name: string;
  runtimeStatus?: RuntimeStatus;
  taskSummary?: string;
  roleHint?: string;
  sessionType?: string;
  updatedAt?: number;
  providerName?: string;
  model?: string;
  originTool?: string;
  createdFromTurnId?: string;
  blueprintRoleId?: string;
  blueprintRoleLabel?: string;
  profileId?: string;
  profileName?: string;
  roleKey?: string;
  teamPresetId?: string;
  theme?: string;
  outputContract?: string;
  skillIds?: string[];
  skills?: AsterSubagentSkillInfo[];
  latestTurnStatus?: RuntimeStatus;
  queuedTurnCount?: number;
  teamPhase?: string;
  teamParallelBudget?: number;
  teamActiveCount?: number;
  teamQueuedCount?: number;
  providerConcurrencyGroup?: string;
  providerParallelBudget?: number;
  queueReason?: string;
  retryableOverload?: boolean;
  isCurrent?: boolean;
}

const ACTIVITY_PREVIEW_POLL_INTERVAL_MS = 1500;
const ACTIVITY_TIMELINE_ENTRY_LIMIT = 4;
const DEFAULT_WAIT_SELECTED_SUBAGENT_TIMEOUT_MS = 30_000;

const STATUS_META: Record<
  NonNullable<RuntimeStatus> | "idle",
  {
    label: string;
    badgeClassName: string;
    cardClassName: string;
    dotClassName: string;
  }
> = {
  idle: {
    label: resolveTeamWorkspaceDisplayRuntimeStatusLabel(undefined),
    badgeClassName: "border border-slate-200 bg-white text-slate-600",
    cardClassName: "border-slate-200 bg-white",
    dotClassName: "bg-slate-300",
  },
  queued: {
    label: resolveTeamWorkspaceDisplayRuntimeStatusLabel("queued"),
    badgeClassName: "border border-amber-200 bg-amber-50 text-amber-700",
    cardClassName: "border-amber-200 bg-white",
    dotClassName: "bg-amber-400",
  },
  running: {
    label: resolveTeamWorkspaceDisplayRuntimeStatusLabel("running"),
    badgeClassName: "border border-sky-200 bg-sky-50 text-sky-700",
    cardClassName: "border-sky-200 bg-white",
    dotClassName: "bg-sky-500",
  },
  completed: {
    label: resolveTeamWorkspaceDisplayRuntimeStatusLabel("completed"),
    badgeClassName: "border border-emerald-200 bg-emerald-50 text-emerald-700",
    cardClassName: "border-emerald-200 bg-white",
    dotClassName: "bg-emerald-500",
  },
  failed: {
    label: resolveTeamWorkspaceDisplayRuntimeStatusLabel("failed"),
    badgeClassName: "border border-rose-200 bg-rose-50 text-rose-700",
    cardClassName: "border-rose-200 bg-white",
    dotClassName: "bg-rose-500",
  },
  aborted: {
    label: resolveTeamWorkspaceDisplayRuntimeStatusLabel("aborted"),
    badgeClassName: "border border-rose-200 bg-rose-50 text-rose-700",
    cardClassName: "border-rose-200 bg-white",
    dotClassName: "bg-rose-500",
  },
  closed: {
    label: resolveTeamWorkspaceDisplayRuntimeStatusLabel("closed"),
    badgeClassName: "border border-slate-200 bg-slate-100 text-slate-600",
    cardClassName: "border-slate-200 bg-slate-50",
    dotClassName: "bg-slate-400",
  },
};

function resolveStatusMeta(status?: RuntimeStatus) {
  return STATUS_META[status ?? "idle"];
}

function formatUpdatedAt(updatedAt?: number) {
  if (!updatedAt) {
    return "刚刚";
  }
  return formatRelativeTime(updatedAt * 1000);
}

function canStartCanvasPanGesture(
  target: EventTarget | null,
  currentTarget: EventTarget | null,
  modifierActive: boolean,
): boolean {
  if (modifierActive) {
    return true;
  }

  if (!(target instanceof HTMLElement)) {
    return target === currentTarget;
  }

  if (target.closest('[data-team-workspace-canvas-pan-block="true"]')) {
    return false;
  }

  return (
    target.closest('[data-team-workspace-canvas-pan-surface="true"]') !==
      null || target === currentTarget
  );
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return (
    target.isContentEditable ||
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    Boolean(target.closest("[contenteditable='true']"))
  );
}

function buildCurrentChildSession(
  currentSessionId?: string | null,
  currentSessionName?: string | null,
  currentSessionRuntimeStatus?: RuntimeStatus,
  currentSessionLatestTurnStatus?: RuntimeStatus,
  currentSessionQueuedTurnCount?: number,
  subagentParentContext?: AsterSubagentParentContext | null,
): TeamSessionCard | null {
  if (!currentSessionId || !subagentParentContext) {
    return null;
  }

  return {
    id: currentSessionId,
    name: currentSessionName?.trim() || "当前成员",
    runtimeStatus: currentSessionRuntimeStatus,
    taskSummary: subagentParentContext.task_summary,
    roleHint: subagentParentContext.role_hint,
    sessionType: "sub_agent",
    originTool: subagentParentContext.origin_tool,
    createdFromTurnId: subagentParentContext.created_from_turn_id,
    blueprintRoleId: subagentParentContext.blueprint_role_id,
    blueprintRoleLabel: subagentParentContext.blueprint_role_label,
    profileId: subagentParentContext.profile_id,
    profileName: subagentParentContext.profile_name,
    roleKey: subagentParentContext.role_key,
    teamPresetId: subagentParentContext.team_preset_id,
    theme: subagentParentContext.theme,
    outputContract: subagentParentContext.output_contract,
    skillIds: subagentParentContext.skill_ids,
    skills: subagentParentContext.skills,
    latestTurnStatus: currentSessionLatestTurnStatus,
    queuedTurnCount: currentSessionQueuedTurnCount,
    isCurrent: true,
  };
}

function buildOrchestratorSession(
  currentSessionId?: string | null,
  currentSessionName?: string | null,
  currentSessionRuntimeStatus?: RuntimeStatus,
): TeamSessionCard | null {
  if (!currentSessionId) {
    return null;
  }

  return {
    id: currentSessionId,
    name: currentSessionName?.trim() || TEAM_WORKSPACE_MAIN_ASSISTANT_LABEL,
    runtimeStatus: currentSessionRuntimeStatus,
    taskSummary:
      "当前主助手会负责拆分需求、邀请协作成员加入，并把各部分结果汇总到同一份内容里。",
    roleHint: "orchestrator",
    sessionType: "user",
    isCurrent: true,
  };
}

function dedupeSessions(
  sessions: Array<TeamSessionCard | null | undefined>,
): TeamSessionCard[] {
  const seen = new Set<string>();
  const result: TeamSessionCard[] = [];

  sessions.forEach((session) => {
    if (!session || seen.has(session.id)) {
      return;
    }
    seen.add(session.id);
    result.push(session);
  });

  return result;
}

function normalizeComparableText(value?: string | null): string {
  return value?.trim().toLocaleLowerCase() || "";
}

function resolveSessionBlueprintRoleId(
  session: TeamSessionCard,
  runtimeRoles: Array<{
    id: string;
    label?: string | null;
    profileId?: string;
    roleKey?: string;
  }>,
  usedRoleIds: Set<string>,
): string | null {
  const explicitRoleId = session.blueprintRoleId?.trim();
  if (
    explicitRoleId &&
    !usedRoleIds.has(explicitRoleId) &&
    runtimeRoles.some((role) => role.id === explicitRoleId)
  ) {
    return explicitRoleId;
  }

  const sessionBlueprintRoleLabel = normalizeComparableText(
    session.blueprintRoleLabel,
  );
  const sessionRoleKey = normalizeComparableText(
    session.roleKey || session.roleHint,
  );
  const sessionProfileId = normalizeComparableText(session.profileId);
  const sessionName = normalizeComparableText(session.name);

  const candidates = runtimeRoles
    .filter((role) => !usedRoleIds.has(role.id))
    .map((role) => {
      let score = 0;
      if (
        sessionBlueprintRoleLabel &&
        normalizeComparableText(role.label) === sessionBlueprintRoleLabel
      ) {
        score += 8;
      }
      if (
        sessionRoleKey &&
        normalizeComparableText(role.roleKey) === sessionRoleKey
      ) {
        score += 4;
      }
      if (
        sessionProfileId &&
        normalizeComparableText(role.profileId) === sessionProfileId
      ) {
        score += 3;
      }
      if (sessionName && normalizeComparableText(role.label) === sessionName) {
        score += 2;
      }
      return {
        roleId: role.id,
        score,
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score);

  if (candidates.length === 0) {
    return null;
  }
  if (candidates.length > 1 && candidates[0]?.score === candidates[1]?.score) {
    return null;
  }

  return candidates[0]?.roleId ?? null;
}

function orderSessionsByRuntimeRoles(
  sessions: TeamSessionCard[],
  teamDispatchPreviewState?: TeamWorkspaceRuntimeFormationState | null,
): TeamSessionCard[] {
  if (sessions.length <= 1 || !teamDispatchPreviewState) {
    return sessions;
  }

  const runtimeRoles = (
    teamDispatchPreviewState.members.length > 0
      ? teamDispatchPreviewState.members
      : (teamDispatchPreviewState.blueprint?.roles ?? [])
  ).map((role) => ({
    id: role.id,
    label: role.label,
    profileId: role.profileId,
    roleKey: role.roleKey,
  }));

  if (runtimeRoles.length === 0) {
    return sessions;
  }

  const roleOrder = new Map(
    runtimeRoles.map((role, index) => [role.id, index]),
  );
  const usedRoleIds = new Set<string>();

  return [...sessions]
    .map((session, index) => {
      const matchedRoleId = resolveSessionBlueprintRoleId(
        session,
        runtimeRoles,
        usedRoleIds,
      );
      if (matchedRoleId) {
        usedRoleIds.add(matchedRoleId);
      }
      return {
        session,
        index,
        matchedRoleId,
        roleOrder:
          matchedRoleId !== null
            ? (roleOrder.get(matchedRoleId) ?? Number.MAX_SAFE_INTEGER)
            : Number.MAX_SAFE_INTEGER,
      };
    })
    .sort((left, right) => {
      if (left.roleOrder !== right.roleOrder) {
        return left.roleOrder - right.roleOrder;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.session);
}

function buildFallbackSummary(params: {
  hasRealTeamGraph: boolean;
  isChildSession: boolean;
  selectedSession?: TeamSessionCard | null;
}) {
  const { hasRealTeamGraph, isChildSession, selectedSession } = params;

  if (!hasRealTeamGraph) {
    return "还没有协作成员加入。需要时系统会自动补充分工，并在这里展示最新进展。";
  }
  if (selectedSession?.sessionType === "user") {
    return "主助手会负责整理需求、分配分工，并把各部分结果汇总到当前内容里。";
  }
  if (isChildSession) {
    return "这位协作成员正在处理主助手分配的内容，你可以在这里切换查看其他成员的进展。";
  }
  return "选中一位协作成员后，这里会展示它正在帮你做什么，以及目前进展到哪一步。";
}

interface TeamWorkspaceCanvasBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

const TEAM_WORKSPACE_CANVAS_STAGE_HEIGHT = "clamp(540px, 74vh, 920px)";
const TEAM_WORKSPACE_CANVAS_WORLD_MIN_WIDTH = 1480;
const TEAM_WORKSPACE_CANVAS_WORLD_MIN_HEIGHT = 980;
const TEAM_WORKSPACE_CANVAS_WORLD_PADDING = 180;
const TEAM_WORKSPACE_CANVAS_VIEWPORT_PADDING = 64;
const TEAM_WORKSPACE_CANVAS_KEYBOARD_PAN_STEP = 72;
const TEAM_WORKSPACE_CANVAS_KEYBOARD_FAST_PAN_STEP = 216;
const TEAM_WORKSPACE_CANVAS_AUTO_LAYOUT_GAP_X = 24;
const TEAM_WORKSPACE_CANVAS_AUTO_LAYOUT_GAP_Y = 28;

function resolveCanvasAutoLayoutColumns(
  laneCount: number,
  viewportWidth: number,
): number {
  if (laneCount <= 1) {
    return 1;
  }
  if (laneCount === 2) {
    return 2;
  }

  if (viewportWidth >= 1080) {
    return Math.min(3, laneCount);
  }

  return Math.min(2, laneCount);
}

function resolveCanvasLanePreferredSize(params: {
  laneKind: TeamWorkspaceCanvasLaneKind;
  laneCount: number;
  viewportWidth: number;
  expanded?: boolean;
}): Pick<TeamWorkspaceCanvasItemLayout, "width" | "height"> {
  const columns = resolveCanvasAutoLayoutColumns(
    params.laneCount,
    params.viewportWidth,
  );
  const gapX = TEAM_WORKSPACE_CANVAS_AUTO_LAYOUT_GAP_X;
  const safeViewportWidth = Math.max(
    params.viewportWidth,
    columns >= 3 ? 1180 : 980,
  );
  const usableWidth =
    safeViewportWidth -
    TEAM_WORKSPACE_CANVAS_VIEWPORT_PADDING * 2 -
    Math.max(0, columns - 1) * gapX;
  const rawWidth = Math.floor(usableWidth / columns);
  const width =
    params.laneKind === "session"
      ? clampCanvasNumber(
          rawWidth,
          340,
          columns === 1 ? 560 : columns === 2 ? 460 : 390,
        )
      : clampCanvasNumber(rawWidth - 20, 320, columns === 1 ? 520 : 380);
  const height =
    params.laneKind === "session"
      ? params.expanded
        ? clampCanvasNumber(Math.round(width * 1.68), 620, 880)
        : clampCanvasNumber(Math.round(width * 1.12), 380, 520)
      : clampCanvasNumber(Math.round(width * 0.78), 260, 340);

  return { width, height };
}

function buildCanvasStageHint(params: {
  hasRealTeamGraph: boolean;
  hasRuntimeFormation: boolean;
  hasSelectedTeamPlan: boolean;
  teamDispatchPreviewState?: TeamWorkspaceRuntimeFormationState | null;
}) {
  const {
    hasRealTeamGraph,
    hasRuntimeFormation,
    hasSelectedTeamPlan,
    teamDispatchPreviewState,
  } = params;

  if (hasRealTeamGraph) {
    return "拖动画布空白处可平移，滚轮配合 Ctrl/Cmd 可缩放，拖动成员卡片可调整布局。";
  }

  if (teamDispatchPreviewState?.status === "forming") {
    return "当前协作分工正在准备中，成员加入后会接手这些位置。";
  }

  if (teamDispatchPreviewState?.status === "formed") {
    return "当前协作分工已经准备好，成员加入后会自动接手这些位置。";
  }

  if (teamDispatchPreviewState?.status === "failed") {
    return (
      teamDispatchPreviewState.errorMessage?.trim() ||
      "当前协作准备失败，暂时无法生成成员画布。"
    );
  }

  if (hasRuntimeFormation || hasSelectedTeamPlan) {
    return "当前画布会先展示计划分工，成员加入后会切换为独立进展面板。";
  }

  return "协作成员加入后，这里会展开成可拖拽、可缩放的进展画布。";
}

function resolveCanvasLaneBounds(
  layouts: TeamWorkspaceCanvasItemLayout[],
): TeamWorkspaceCanvasBounds {
  if (layouts.length === 0) {
    return {
      minX: 0,
      minY: 0,
      maxX: TEAM_WORKSPACE_CANVAS_WORLD_MIN_WIDTH,
      maxY: TEAM_WORKSPACE_CANVAS_WORLD_MIN_HEIGHT,
      width: TEAM_WORKSPACE_CANVAS_WORLD_MIN_WIDTH,
      height: TEAM_WORKSPACE_CANVAS_WORLD_MIN_HEIGHT,
    };
  }

  const minX = Math.min(...layouts.map((layout) => layout.x));
  const minY = Math.min(...layouts.map((layout) => layout.y));
  const maxX = Math.max(...layouts.map((layout) => layout.x + layout.width));
  const maxY = Math.max(...layouts.map((layout) => layout.y + layout.height));

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(
      TEAM_WORKSPACE_CANVAS_WORLD_MIN_WIDTH,
      maxX - minX + TEAM_WORKSPACE_CANVAS_WORLD_PADDING * 2,
    ),
    height: Math.max(
      TEAM_WORKSPACE_CANVAS_WORLD_MIN_HEIGHT,
      maxY - minY + TEAM_WORKSPACE_CANVAS_WORLD_PADDING * 2,
    ),
  };
}

function resolveCanvasViewportMetrics(
  element: HTMLDivElement | null,
  fallbackHeight: number,
): {
  width: number;
  height: number;
} {
  const rect = element?.getBoundingClientRect();
  return {
    width: rect && rect.width > 0 ? rect.width : 960,
    height: rect && rect.height > 0 ? rect.height : fallbackHeight,
  };
}

function clampCanvasNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function TeamWorkspaceBoard({
  className,
  embedded = false,
  shellVisible = false,
  defaultShellExpanded = false,
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
  selectedTeamLabel = null,
  selectedTeamSummary = null,
  selectedTeamRoles = [],
  teamDispatchPreviewState = null,
}: TeamWorkspaceBoardProps) {
  const dispatchPreviewState = teamDispatchPreviewState;
  const isChildSession = Boolean(subagentParentContext);
  const canvasStorageScopeId =
    currentSessionId?.trim() ||
    subagentParentContext?.parent_session_id?.trim() ||
    dispatchPreviewState?.requestId?.trim() ||
    "team-workspace";
  const [shellExpanded, setShellExpanded] = useState(defaultShellExpanded);
  const detailExpanded = !embedded;
  const canvasViewportFallbackHeight = embedded && !detailExpanded ? 720 : 560;
  const [canvasLayoutState, setCanvasLayoutState] =
    useState<TeamWorkspaceCanvasLayoutState>(
      () =>
        loadTeamWorkspaceCanvasLayout(canvasStorageScopeId) ??
        createDefaultTeamWorkspaceCanvasLayoutState(),
    );
  const [pendingSessionAction, setPendingSessionAction] = useState<{
    sessionId: string;
    action: "close" | "resume" | "wait" | "send" | "interrupt_send";
  } | null>(null);
  const [pendingTeamAction, setPendingTeamAction] = useState<
    "wait_any" | "close_completed" | null
  >(null);
  const [isCanvasPanModifierActive, setIsCanvasPanModifierActive] =
    useState(false);
  const [sessionInputDraftById, setSessionInputDraftById] = useState<
    Record<string, string>
  >({});
  const [sessionActivityPreviewById, setSessionActivityPreviewById] = useState<
    Record<string, SessionActivityPreviewState>
  >({});
  const sessionActivityPreviewByIdRef = useRef<
    Record<string, SessionActivityPreviewState>
  >({});
  const pendingSessionActivityRequestsRef = useRef(new Set<string>());
  const lastAutoFocusedTeamWaitKeyRef = useRef<string | null>(null);
  const canvasViewportRef = useRef<HTMLDivElement | null>(null);
  const [canvasViewportMetrics, setCanvasViewportMetrics] = useState<{
    width: number;
    height: number;
  }>({
    width: 960,
    height: embedded ? 720 : 560,
  });
  const canvasLayoutStateRef =
    useRef<TeamWorkspaceCanvasLayoutState>(canvasLayoutState);
  const canvasLaneLayoutsRef = useRef<
    Record<string, TeamWorkspaceCanvasItemLayout>
  >({});
  const canvasInteractionCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    sessionActivityPreviewByIdRef.current = sessionActivityPreviewById;
  }, [sessionActivityPreviewById]);

  useEffect(() => {
    canvasLayoutStateRef.current = canvasLayoutState;
  }, [canvasLayoutState]);

  useEffect(() => {
    setCanvasLayoutState(
      loadTeamWorkspaceCanvasLayout(canvasStorageScopeId) ??
        createDefaultTeamWorkspaceCanvasLayoutState(),
    );
  }, [canvasStorageScopeId]);

  useEffect(() => {
    persistTeamWorkspaceCanvasLayout(canvasStorageScopeId, canvasLayoutState);
  }, [canvasLayoutState, canvasStorageScopeId]);

  useEffect(() => {
    return () => {
      canvasInteractionCleanupRef.current?.();
      canvasInteractionCleanupRef.current = null;
    };
  }, []);

  useEffect(() => {
    const syncCanvasViewportMetrics = () => {
      setCanvasViewportMetrics(
        resolveCanvasViewportMetrics(
          canvasViewportRef.current,
          canvasViewportFallbackHeight,
        ),
      );
    };

    syncCanvasViewportMetrics();
    window.addEventListener("resize", syncCanvasViewportMetrics);

    return () => {
      window.removeEventListener("resize", syncCanvasViewportMetrics);
    };
  }, [canvasViewportFallbackHeight]);

  const baseOrchestratorSession = useMemo(
    () =>
      buildOrchestratorSession(
        currentSessionId,
        currentSessionName,
        currentSessionRuntimeStatus,
      ),
    [currentSessionId, currentSessionName, currentSessionRuntimeStatus],
  );

  const baseCurrentChildSession = useMemo(
    () =>
      buildCurrentChildSession(
        currentSessionId,
        currentSessionName,
        currentSessionRuntimeStatus,
        currentSessionLatestTurnStatus,
        currentSessionQueuedTurnCount,
        subagentParentContext,
      ),
    [
      currentSessionId,
      currentSessionName,
      currentSessionRuntimeStatus,
      currentSessionLatestTurnStatus,
      currentSessionQueuedTurnCount,
      subagentParentContext,
    ],
  );

  const baseVisibleSessions = useMemo<TeamSessionCard[]>(
    () =>
      (isChildSession
        ? (subagentParentContext?.sibling_subagent_sessions ?? [])
        : childSubagentSessions
      ).map((session) => ({
        id: session.id,
        name: session.name,
        runtimeStatus: session.runtime_status,
        taskSummary: session.task_summary,
        roleHint: session.role_hint,
        sessionType: session.session_type,
        updatedAt: session.updated_at,
        providerName: session.provider_name,
        model: session.model,
        originTool: session.origin_tool,
        createdFromTurnId: session.created_from_turn_id,
        blueprintRoleId: session.blueprint_role_id,
        blueprintRoleLabel: session.blueprint_role_label,
        profileId: session.profile_id,
        profileName: session.profile_name,
        roleKey: session.role_key,
        teamPresetId: session.team_preset_id,
        theme: session.theme,
        outputContract: session.output_contract,
        skillIds: session.skill_ids,
        skills: session.skills,
        latestTurnStatus: session.latest_turn_status,
        queuedTurnCount: session.queued_turn_count,
        teamPhase: session.team_phase,
        teamParallelBudget: session.team_parallel_budget,
        teamActiveCount: session.team_active_count,
        teamQueuedCount: session.team_queued_count,
        providerConcurrencyGroup: session.provider_concurrency_group,
        providerParallelBudget: session.provider_parallel_budget,
        queueReason: session.queue_reason,
        retryableOverload: session.retryable_overload,
      })),
    [childSubagentSessions, isChildSession, subagentParentContext],
  );
  const baseHasRealTeamGraph = isChildSession || baseVisibleSessions.length > 0;
  const baseRailSessions = useMemo(
    () =>
      dedupeSessions(
        isChildSession
          ? [baseCurrentChildSession, ...baseVisibleSessions]
          : baseHasRealTeamGraph
            ? [baseOrchestratorSession, ...baseVisibleSessions]
            : [],
      ),
    [
      baseCurrentChildSession,
      baseHasRealTeamGraph,
      baseOrchestratorSession,
      baseVisibleSessions,
      isChildSession,
    ],
  );
  const orchestratorSession = useMemo(
    () =>
      applyLiveRuntimeState(
        baseOrchestratorSession,
        baseOrchestratorSession
          ? liveRuntimeBySessionId[baseOrchestratorSession.id]
          : undefined,
      ),
    [baseOrchestratorSession, liveRuntimeBySessionId],
  );
  const currentChildSession = useMemo(
    () =>
      applyLiveRuntimeState(
        baseCurrentChildSession,
        baseCurrentChildSession
          ? liveRuntimeBySessionId[baseCurrentChildSession.id]
          : undefined,
      ),
    [baseCurrentChildSession, liveRuntimeBySessionId],
  );
  const visibleSessions = useMemo(
    () =>
      baseVisibleSessions.map(
        (session) =>
          applyLiveRuntimeState(session, liveRuntimeBySessionId[session.id]) ??
          session,
      ),
    [baseVisibleSessions, liveRuntimeBySessionId],
  );

  const totalTeamSessions = isChildSession
    ? visibleSessions.length + (currentChildSession ? 1 : 0)
    : visibleSessions.length;
  const siblingCount =
    subagentParentContext?.sibling_subagent_sessions?.length ?? 0;
  const hasRealTeamGraph = isChildSession || visibleSessions.length > 0;
  const isEmptyShellState =
    !isChildSession && shellVisible && visibleSessions.length === 0;
  const normalizedSelectedTeamLabel = selectedTeamLabel?.trim() || null;
  const normalizedSelectedTeamSummary = selectedTeamSummary?.trim() || null;
  const normalizedSelectedTeamRoles = (selectedTeamRoles ?? []).filter((role) =>
    role.label.trim(),
  );
  const runtimeMembers = useMemo(
    () => dispatchPreviewState?.members ?? [],
    [dispatchPreviewState?.members],
  );
  const selectedTeamPlanDisplay = buildSelectedTeamPlanDisplayState({
    selectedTeamLabel: normalizedSelectedTeamLabel,
    selectedTeamSummary: normalizedSelectedTeamSummary,
    selectedTeamRoles: normalizedSelectedTeamRoles,
  });
  const runtimeFormationDisplay = buildRuntimeFormationDisplayState({
    teamDispatchPreviewState: dispatchPreviewState,
    fallbackLabel: normalizedSelectedTeamLabel,
    fallbackSummary: normalizedSelectedTeamSummary,
  });
  const hasRuntimeFormation = runtimeFormationDisplay.hasRuntimeFormation;
  const hasSelectedTeamPlan = selectedTeamPlanDisplay.hasSelectedTeamPlan;

  const memberCanvasSessions = useMemo(
    () =>
      orderSessionsByRuntimeRoles(
        isChildSession
          ? dedupeSessions([currentChildSession, ...visibleSessions])
          : visibleSessions,
        teamDispatchPreviewState,
      ),
    [
      currentChildSession,
      isChildSession,
      teamDispatchPreviewState,
      visibleSessions,
    ],
  );
  const railSessions = useMemo(
    () =>
      dedupeSessions(
        isChildSession
          ? [currentChildSession, ...visibleSessions]
          : hasRealTeamGraph
            ? [orchestratorSession, ...visibleSessions]
            : [],
      ),
    [
      currentChildSession,
      hasRealTeamGraph,
      isChildSession,
      orchestratorSession,
      visibleSessions,
    ],
  );

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    () => railSessions[0]?.id ?? null,
  );
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    const defaultSelectedId = isChildSession
      ? (currentSessionId ?? railSessions[0]?.id ?? null)
      : (memberCanvasSessions[0]?.id ?? railSessions[0]?.id ?? null);

    if (!selectedSessionId) {
      setSelectedSessionId(defaultSelectedId);
      return;
    }

    if (!railSessions.some((session) => session.id === selectedSessionId)) {
      setSelectedSessionId(defaultSelectedId);
      return;
    }

    if (
      !isChildSession &&
      selectedSessionId === orchestratorSession?.id &&
      memberCanvasSessions.length > 0
    ) {
      setSelectedSessionId(memberCanvasSessions[0]?.id ?? defaultSelectedId);
    }
  }, [
    currentSessionId,
    isChildSession,
    memberCanvasSessions,
    orchestratorSession?.id,
    railSessions,
    selectedSessionId,
  ]);

  useEffect(() => {
    if (!expandedSessionId) {
      return;
    }

    if (
      !memberCanvasSessions.some((session) => session.id === expandedSessionId)
    ) {
      setExpandedSessionId(null);
    }
  }, [expandedSessionId, memberCanvasSessions]);

  const selectedSession = useMemo(
    () =>
      railSessions.find((session) => session.id === selectedSessionId) ??
      railSessions[0] ??
      null,
    [railSessions, selectedSessionId],
  );
  const selectedBaseSession = useMemo(
    () =>
      baseRailSessions.find((session) => session.id === selectedSessionId) ??
      baseRailSessions[0] ??
      null,
    [baseRailSessions, selectedSessionId],
  );
  const selectedSessionActivityState = useMemo(
    () =>
      buildSelectedSessionActivityState({
        selectedSession,
        selectedBaseSession,
        liveActivityBySessionId,
        previewBySessionId: sessionActivityPreviewById,
        activityRefreshVersionBySessionId,
        activityTimelineEntryLimit: ACTIVITY_TIMELINE_ENTRY_LIMIT,
      }),
    [
      activityRefreshVersionBySessionId,
      liveActivityBySessionId,
      selectedBaseSession,
      selectedSession,
      sessionActivityPreviewById,
    ],
  );
  const selectedSessionActivityPreview = selectedSessionActivityState.previewState;
  const selectedSessionActivityEntries = selectedSessionActivityState.entries;
  const selectedSessionActivityPreviewText =
    selectedSessionActivityState.previewText;
  const selectedSessionSupportsActivityPreview =
    selectedSessionActivityState.supportsPreview;
  const selectedSessionActivityId = selectedSessionActivityState.activityId;
  const selectedSessionActivityFingerprint =
    selectedSessionActivityState.fingerprint;
  const selectedSessionActivityRefreshVersion =
    selectedSessionActivityState.refreshVersion;
  const selectedSessionActivityShouldPoll =
    selectedSessionActivityState.shouldPoll;
  const basePreviewableRailSessions = useMemo(
    () => baseRailSessions.filter((session) => session.sessionType !== "user"),
    [baseRailSessions],
  );
  const previewableRailSessionsSyncKey = useMemo(
    () =>
      buildPreviewableRailSessionsSyncKey({
        sessions: basePreviewableRailSessions,
        activityRefreshVersionBySessionId,
      }),
    [activityRefreshVersionBySessionId, basePreviewableRailSessions],
  );

  const syncSessionActivityPreview = useCallback(
    async (
      sessionId: string,
      fingerprint: string,
      refreshVersion = 0,
      options?: { force?: boolean },
    ) => {
      const current = sessionActivityPreviewByIdRef.current[sessionId];
      const shouldForceRefresh =
        options?.force || (current?.refreshVersion ?? 0) < refreshVersion;
      if (
        !shouldForceRefresh &&
        current?.status === "ready" &&
        current.fingerprint === fingerprint &&
        (current.refreshVersion ?? 0) === refreshVersion
      ) {
        return;
      }

      if (pendingSessionActivityRequestsRef.current.has(sessionId)) {
        return;
      }

      pendingSessionActivityRequestsRef.current.add(sessionId);
      setSessionActivityPreviewById((previous) => {
        const currentState = previous[sessionId];
        if (
          currentState?.status === "loading" &&
          currentState.fingerprint === fingerprint
        ) {
          return previous;
        }

        return {
          ...previous,
          [sessionId]: {
            preview: currentState?.preview ?? null,
            entries: currentState?.entries ?? [],
            status: "loading",
            errorMessage: undefined,
            fingerprint,
            refreshVersion,
            syncedAt: currentState?.syncedAt,
          },
        };
      });

      try {
        const detail = await getAgentRuntimeSession(sessionId);
        const activitySnapshot = extractSessionActivitySnapshot(
          detail,
          ACTIVITY_TIMELINE_ENTRY_LIMIT,
        );
        const syncedAt = Date.now();
        setSessionActivityPreviewById((previous) => ({
          ...previous,
          [sessionId]: {
            preview: activitySnapshot.preview,
            entries: activitySnapshot.entries,
            status: "ready",
            errorMessage: undefined,
            fingerprint,
            refreshVersion,
            syncedAt,
          },
        }));
      } catch (error) {
        setSessionActivityPreviewById((previous) => ({
          ...previous,
          [sessionId]: {
            preview: previous[sessionId]?.preview ?? null,
            entries: previous[sessionId]?.entries ?? [],
            status: "error",
            errorMessage:
              error instanceof Error ? error.message : "同步最近过程失败",
            fingerprint,
            refreshVersion,
            syncedAt: previous[sessionId]?.syncedAt,
          },
        }));
      } finally {
        pendingSessionActivityRequestsRef.current.delete(sessionId);
      }
    },
    [],
  );

  useEffect(() => {
    if (!selectedSessionActivityId || !selectedSessionActivityFingerprint) {
      return;
    }

    const sessionId = selectedSessionActivityId;
    const fingerprint = selectedSessionActivityFingerprint;
    let pollTimer: number | null = null;
    const cachedPreview = sessionActivityPreviewByIdRef.current[sessionId];

    if (
      !selectedSessionActivityShouldPoll &&
      cachedPreview?.status === "ready" &&
      cachedPreview.fingerprint === fingerprint &&
      (cachedPreview.refreshVersion ?? 0) ===
        selectedSessionActivityRefreshVersion
    ) {
      return;
    }

    const syncSessionActivity = async () => {
      const current = sessionActivityPreviewByIdRef.current[sessionId];
      await syncSessionActivityPreview(
        sessionId,
        fingerprint,
        selectedSessionActivityRefreshVersion,
        {
          force:
            (current?.refreshVersion ?? 0) <
            selectedSessionActivityRefreshVersion,
        },
      );
    };

    void syncSessionActivity();

    if (selectedSessionActivityShouldPoll) {
      pollTimer = window.setInterval(() => {
        void syncSessionActivity();
      }, ACTIVITY_PREVIEW_POLL_INTERVAL_MS);
    }

    return () => {
      if (pollTimer !== null) {
        window.clearInterval(pollTimer);
      }
    };
  }, [
    activityRefreshVersionBySessionId,
    selectedSessionActivityFingerprint,
    selectedSessionActivityId,
    selectedSessionActivityRefreshVersion,
    selectedSessionActivityShouldPoll,
    syncSessionActivityPreview,
  ]);

  useEffect(() => {
    const staleTargets = collectStaleSessionActivityTargets({
      sessions: basePreviewableRailSessions,
      previewBySessionId: sessionActivityPreviewByIdRef.current,
      activityRefreshVersionBySessionId,
    });

    if (staleTargets.length === 0) {
      return;
    }

    let cancelled = false;

    const prefetchPreviews = async () => {
      await Promise.allSettled(
        staleTargets.map((target) => {
          if (cancelled) {
            return Promise.resolve();
          }

          return syncSessionActivityPreview(
            target.sessionId,
            target.fingerprint,
            target.refreshVersion,
            {
              force: true,
            },
          );
        }),
      );
    };

    void prefetchPreviews();

    return () => {
      cancelled = true;
    };
  }, [
    activityRefreshVersionBySessionId,
    basePreviewableRailSessions,
    previewableRailSessionsSyncKey,
    syncSessionActivityPreview,
  ]);

  const canvasLanes = useMemo<TeamWorkspaceCanvasLane[]>(
    () =>
      buildTeamWorkspaceCanvasLanes({
        hasRealTeamGraph,
        sessions: memberCanvasSessions,
        runtimeMembers,
        plannedRoles: normalizedSelectedTeamRoles,
        liveActivityBySessionId,
        previewBySessionId: sessionActivityPreviewById,
        activityTimelineEntryLimit: ACTIVITY_TIMELINE_ENTRY_LIMIT,
      }),
    [
      hasRealTeamGraph,
      liveActivityBySessionId,
      memberCanvasSessions,
      normalizedSelectedTeamRoles,
      runtimeMembers,
      sessionActivityPreviewById,
    ],
  );
  const canvasAutoLayoutViewportWidth = embedded
    ? Math.max(canvasViewportMetrics.width, 1240)
    : Math.max(canvasViewportMetrics.width, 1080);

  const updateCanvasViewport = useCallback(
    (
      updater: (
        viewport: TeamWorkspaceCanvasLayoutState["viewport"],
      ) => TeamWorkspaceCanvasLayoutState["viewport"],
    ) => {
      setCanvasLayoutState((previous) => {
        const nextViewport = updater(previous.viewport);
        if (
          nextViewport.x === previous.viewport.x &&
          nextViewport.y === previous.viewport.y &&
          nextViewport.zoom === previous.viewport.zoom
        ) {
          return previous;
        }

        return {
          ...previous,
          updatedAt: Date.now(),
          viewport: {
            x: nextViewport.x,
            y: nextViewport.y,
            zoom: clampTeamWorkspaceCanvasZoom(nextViewport.zoom),
          },
        };
      });
    },
    [],
  );

  const updateCanvasLaneLayout = useCallback(
    (
      persistKey: string,
      updater: (
        current: TeamWorkspaceCanvasItemLayout,
      ) => TeamWorkspaceCanvasItemLayout,
    ) => {
      setCanvasLayoutState((previous) => {
        const current =
          previous.items[persistKey] ??
          buildDefaultTeamWorkspaceCanvasItemLayout(0);
        const next = updater(current);

        if (
          next.x === current.x &&
          next.y === current.y &&
          next.width === current.width &&
          next.height === current.height &&
          next.zIndex === current.zIndex
        ) {
          return previous;
        }

        return {
          ...previous,
          updatedAt: Date.now(),
          items: {
            ...previous.items,
            [persistKey]: {
              x: next.x,
              y: next.y,
              width: Math.max(TEAM_WORKSPACE_CANVAS_MIN_WIDTH, next.width),
              height: Math.max(TEAM_WORKSPACE_CANVAS_MIN_HEIGHT, next.height),
              zIndex: Math.max(1, next.zIndex),
            },
          },
        };
      });
    },
    [],
  );

  const bringCanvasLaneToFront = useCallback((persistKey: string) => {
    setCanvasLayoutState((previous) => {
      const target = previous.items[persistKey];
      if (!target) {
        return previous;
      }

      const maxZIndex = Math.max(
        1,
        ...Object.values(previous.items).map((item) => item.zIndex),
      );
      if (target.zIndex >= maxZIndex) {
        return previous;
      }

      return {
        ...previous,
        updatedAt: Date.now(),
        items: {
          ...previous.items,
          [persistKey]: {
            ...target,
            zIndex: maxZIndex + 1,
          },
        },
      };
    });
  }, []);

  const bindCanvasMouseInteraction = useCallback(
    (onMove: (event: MouseEvent) => void, onEnd?: () => void) => {
      canvasInteractionCleanupRef.current?.();

      const handleMouseMove = (event: MouseEvent) => {
        onMove(event);
      };
      const handleMouseUp = () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
        canvasInteractionCleanupRef.current = null;
        onEnd?.();
      };

      canvasInteractionCleanupRef.current = () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [],
  );

  useEffect(() => {
    if (canvasLanes.length === 0) {
      return;
    }

    setCanvasLayoutState((previous) => {
      let changed = false;
      const nextItems = { ...previous.items };
      const hadStoredItems = Object.keys(previous.items).length > 0;

      canvasLanes.forEach((lane, index) => {
        const directLayout = nextItems[lane.persistKey];
        if (directLayout) {
          return;
        }

        const fallbackLayout = lane.fallbackPersistKeys
          .map((key) => nextItems[key])
          .find(Boolean);

        const preferredSize = resolveCanvasLanePreferredSize({
          laneKind: lane.kind,
          laneCount: canvasLanes.length,
          viewportWidth: canvasAutoLayoutViewportWidth,
        });
        nextItems[lane.persistKey] = fallbackLayout
          ? {
              ...fallbackLayout,
              width: preferredSize.width,
              height: preferredSize.height,
            }
          : buildDefaultTeamWorkspaceCanvasItemLayout(index, {
              width: preferredSize.width,
              height: preferredSize.height,
            });
        changed = true;
      });

      if (!changed) {
        return previous;
      }

      return {
        ...previous,
        updatedAt: Date.now(),
        items: hadStoredItems
          ? nextItems
          : {
              ...nextItems,
              ...buildTeamWorkspaceCanvasAutoLayout(
                canvasLanes.map((lane, index) => ({
                  persistKey: lane.persistKey,
                  layout:
                    nextItems[lane.persistKey] ??
                    buildDefaultTeamWorkspaceCanvasItemLayout(index),
                })),
                {
                  maxRowWidth: Math.max(
                    820,
                    canvasAutoLayoutViewportWidth -
                      TEAM_WORKSPACE_CANVAS_VIEWPORT_PADDING * 2,
                  ),
                  offsetX: 64,
                  offsetY: 76,
                  gapX: TEAM_WORKSPACE_CANVAS_AUTO_LAYOUT_GAP_X,
                  gapY: TEAM_WORKSPACE_CANVAS_AUTO_LAYOUT_GAP_Y,
                  centerRows: true,
                },
              ),
            },
      };
    });
  }, [canvasAutoLayoutViewportWidth, canvasLanes]);

  const canvasLaneLayouts = useMemo(
    () =>
      Object.fromEntries(
        canvasLanes.map((lane, index) => {
          const baseLayout =
            canvasLayoutState.items[lane.persistKey] ??
            buildDefaultTeamWorkspaceCanvasItemLayout(index);
          const isInlineExpanded =
            lane.kind === "session" &&
            lane.session?.id != null &&
            lane.session.id === expandedSessionId;

          if (!isInlineExpanded) {
            return [lane.persistKey, baseLayout];
          }

          const expandedHeight = resolveCanvasLanePreferredSize({
            laneKind: lane.kind,
            laneCount: canvasLanes.length,
            viewportWidth: canvasAutoLayoutViewportWidth,
            expanded: true,
          }).height;

          return [
            lane.persistKey,
            {
              ...baseLayout,
              height: Math.max(baseLayout.height, expandedHeight),
            },
          ];
        }),
      ),
    [
      canvasAutoLayoutViewportWidth,
      canvasLanes,
      canvasLayoutState.items,
      expandedSessionId,
    ],
  );

  useEffect(() => {
    canvasLaneLayoutsRef.current = canvasLaneLayouts;
  }, [canvasLaneLayouts]);

  const canvasBounds = useMemo(
    () => resolveCanvasLaneBounds(Object.values(canvasLaneLayouts)),
    [canvasLaneLayouts],
  );

  const handleStartCanvasPan = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (
        !canStartCanvasPanGesture(
          event.target,
          event.currentTarget,
          isCanvasPanModifierActive,
        )
      ) {
        return;
      }

      event.preventDefault();
      const startX = event.clientX;
      const startY = event.clientY;
      const startViewport = canvasLayoutStateRef.current.viewport;

      bindCanvasMouseInteraction((moveEvent) => {
        updateCanvasViewport(() => ({
          x: startViewport.x + (moveEvent.clientX - startX),
          y: startViewport.y + (moveEvent.clientY - startY),
          zoom: startViewport.zoom,
        }));
      });
    },
    [
      bindCanvasMouseInteraction,
      isCanvasPanModifierActive,
      updateCanvasViewport,
    ],
  );

  const handleStartCanvasLaneDrag = useCallback(
    (persistKey: string, event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const startLayout =
        canvasLaneLayoutsRef.current[persistKey] ??
        canvasLayoutStateRef.current.items[persistKey];
      if (!startLayout) {
        return;
      }

      const zoom = canvasLayoutStateRef.current.viewport.zoom;
      const startX = event.clientX;
      const startY = event.clientY;
      bringCanvasLaneToFront(persistKey);

      bindCanvasMouseInteraction((moveEvent) => {
        const deltaX = (moveEvent.clientX - startX) / zoom;
        const deltaY = (moveEvent.clientY - startY) / zoom;
        updateCanvasLaneLayout(persistKey, (current) => ({
          ...current,
          x: startLayout.x + deltaX,
          y: startLayout.y + deltaY,
        }));
      });
    },
    [
      bindCanvasMouseInteraction,
      bringCanvasLaneToFront,
      updateCanvasLaneLayout,
    ],
  );

  const handleStartCanvasLaneResize = useCallback(
    (
      persistKey: string,
      direction: "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw",
      event: ReactMouseEvent<HTMLSpanElement>,
    ) => {
      event.preventDefault();
      event.stopPropagation();
      const startLayout =
        canvasLaneLayoutsRef.current[persistKey] ??
        canvasLayoutStateRef.current.items[persistKey];
      if (!startLayout) {
        return;
      }

      const zoom = canvasLayoutStateRef.current.viewport.zoom;
      const startX = event.clientX;
      const startY = event.clientY;
      bringCanvasLaneToFront(persistKey);

      bindCanvasMouseInteraction((moveEvent) => {
        const deltaX = (moveEvent.clientX - startX) / zoom;
        const deltaY = (moveEvent.clientY - startY) / zoom;

        updateCanvasLaneLayout(persistKey, (current) => {
          let nextX = startLayout.x;
          let nextY = startLayout.y;
          let nextWidth = startLayout.width;
          let nextHeight = startLayout.height;

          if (direction.includes("e")) {
            nextWidth = Math.max(
              TEAM_WORKSPACE_CANVAS_MIN_WIDTH,
              startLayout.width + deltaX,
            );
          }
          if (direction.includes("s")) {
            nextHeight = Math.max(
              TEAM_WORKSPACE_CANVAS_MIN_HEIGHT,
              startLayout.height + deltaY,
            );
          }
          if (direction.includes("w")) {
            nextWidth = Math.max(
              TEAM_WORKSPACE_CANVAS_MIN_WIDTH,
              startLayout.width - deltaX,
            );
            nextX = startLayout.x + (startLayout.width - nextWidth);
          }
          if (direction.includes("n")) {
            nextHeight = Math.max(
              TEAM_WORKSPACE_CANVAS_MIN_HEIGHT,
              startLayout.height - deltaY,
            );
            nextY = startLayout.y + (startLayout.height - nextHeight);
          }

          return {
            ...current,
            x: nextX,
            y: nextY,
            width: nextWidth,
            height: nextHeight,
          };
        });
      });
    },
    [
      bindCanvasMouseInteraction,
      bringCanvasLaneToFront,
      updateCanvasLaneLayout,
    ],
  );

  const handleCanvasWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }

      event.preventDefault();
      const delta = event.deltaY > 0 ? -0.08 : 0.08;
      updateCanvasViewport((viewport) => ({
        ...viewport,
        zoom: clampTeamWorkspaceCanvasZoom(viewport.zoom + delta),
      }));
    },
    [updateCanvasViewport],
  );

  const handleZoomIn = useCallback(() => {
    updateCanvasViewport((viewport) => ({
      ...viewport,
      zoom: Math.min(
        TEAM_WORKSPACE_CANVAS_MAX_ZOOM,
        clampTeamWorkspaceCanvasZoom(viewport.zoom + 0.12),
      ),
    }));
  }, [updateCanvasViewport]);

  const handleZoomOut = useCallback(() => {
    updateCanvasViewport((viewport) => ({
      ...viewport,
      zoom: Math.max(
        TEAM_WORKSPACE_CANVAS_MIN_ZOOM,
        clampTeamWorkspaceCanvasZoom(viewport.zoom - 0.12),
      ),
    }));
  }, [updateCanvasViewport]);

  const handleResetCanvasView = useCallback(() => {
    updateCanvasViewport(
      () => createDefaultTeamWorkspaceCanvasLayoutState().viewport,
    );
  }, [updateCanvasViewport]);
  const handleAutoArrangeCanvas = useCallback(() => {
    if (canvasLanes.length === 0) {
      return;
    }

    setCanvasLayoutState((previous) => {
      const maxRowWidth = Math.max(
        820,
        canvasAutoLayoutViewportWidth / Math.max(previous.viewport.zoom, 0.1) -
          TEAM_WORKSPACE_CANVAS_VIEWPORT_PADDING * 2,
      );
      const nextItems = buildTeamWorkspaceCanvasAutoLayout(
        canvasLanes.map((lane, index) => ({
          persistKey: lane.persistKey,
          layout: {
            ...(previous.items[lane.persistKey] ??
              buildDefaultTeamWorkspaceCanvasItemLayout(index)),
            ...resolveCanvasLanePreferredSize({
              laneKind: lane.kind,
              laneCount: canvasLanes.length,
              viewportWidth: canvasAutoLayoutViewportWidth,
              expanded:
                lane.kind === "session" &&
                lane.session?.id != null &&
                lane.session.id === expandedSessionId,
            }),
          },
        })),
        {
          maxRowWidth,
          offsetX: 64,
          offsetY: 76,
          gapX: TEAM_WORKSPACE_CANVAS_AUTO_LAYOUT_GAP_X,
          gapY: TEAM_WORKSPACE_CANVAS_AUTO_LAYOUT_GAP_Y,
          centerRows: true,
        },
      );

      return {
        ...previous,
        updatedAt: Date.now(),
        viewport: createDefaultTeamWorkspaceCanvasLayoutState().viewport,
        items: {
          ...previous.items,
          ...nextItems,
        },
      };
    });
  }, [canvasAutoLayoutViewportWidth, canvasLanes, expandedSessionId]);

  const handleFitCanvasView = useCallback(() => {
    const viewportRect = canvasViewportRef.current?.getBoundingClientRect();
    if (!viewportRect || canvasLanes.length === 0) {
      return;
    }

    const contentWidth = Math.max(1, canvasBounds.maxX - canvasBounds.minX);
    const contentHeight = Math.max(1, canvasBounds.maxY - canvasBounds.minY);
    const usableWidth = Math.max(
      200,
      viewportRect.width - TEAM_WORKSPACE_CANVAS_VIEWPORT_PADDING * 2,
    );
    const usableHeight = Math.max(
      200,
      viewportRect.height - TEAM_WORKSPACE_CANVAS_VIEWPORT_PADDING * 2,
    );
    const zoom = clampTeamWorkspaceCanvasZoom(
      Math.min(usableWidth / contentWidth, usableHeight / contentHeight, 1.08),
    );

    updateCanvasViewport(() => ({
      x:
        TEAM_WORKSPACE_CANVAS_VIEWPORT_PADDING +
        (viewportRect.width - contentWidth * zoom) / 2 -
        canvasBounds.minX * zoom,
      y:
        TEAM_WORKSPACE_CANVAS_VIEWPORT_PADDING +
        (viewportRect.height - contentHeight * zoom) / 2 -
        canvasBounds.minY * zoom,
      zoom,
    }));
  }, [canvasBounds, canvasLanes.length, updateCanvasViewport]);

  useEffect(() => {
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (isEditableKeyboardTarget(event.target)) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
        if (!isCanvasPanModifierActive) {
          setIsCanvasPanModifierActive(true);
        }
        return;
      }

      if (event.repeat) {
        return;
      }

      const normalizedKey = event.key.toLowerCase();
      if (normalizedKey === "a") {
        event.preventDefault();
        handleAutoArrangeCanvas();
        return;
      }
      if (normalizedKey === "f") {
        event.preventDefault();
        handleFitCanvasView();
        return;
      }
      if (event.key === "0") {
        event.preventDefault();
        handleResetCanvasView();
        return;
      }
      if (event.key === "=" || event.key === "+") {
        event.preventDefault();
        handleZoomIn();
        return;
      }
      if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        handleZoomOut();
        return;
      }

      if (canvasLanes.length === 0) {
        return;
      }

      const keyboardPanStep = event.shiftKey
        ? TEAM_WORKSPACE_CANVAS_KEYBOARD_FAST_PAN_STEP
        : TEAM_WORKSPACE_CANVAS_KEYBOARD_PAN_STEP;

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        updateCanvasViewport((viewport) => ({
          ...viewport,
          x: viewport.x + keyboardPanStep,
        }));
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        updateCanvasViewport((viewport) => ({
          ...viewport,
          x: viewport.x - keyboardPanStep,
        }));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        updateCanvasViewport((viewport) => ({
          ...viewport,
          y: viewport.y + keyboardPanStep,
        }));
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        updateCanvasViewport((viewport) => ({
          ...viewport,
          y: viewport.y - keyboardPanStep,
        }));
      }
    };

    const handleWindowKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        setIsCanvasPanModifierActive(false);
      }
    };

    const handleWindowBlur = () => {
      setIsCanvasPanModifierActive(false);
    };

    window.addEventListener("keydown", handleWindowKeyDown);
    window.addEventListener("keyup", handleWindowKeyUp);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown);
      window.removeEventListener("keyup", handleWindowKeyUp);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [
    handleAutoArrangeCanvas,
    handleFitCanvasView,
    handleResetCanvasView,
    handleZoomIn,
    handleZoomOut,
    canvasLanes.length,
    isCanvasPanModifierActive,
    updateCanvasViewport,
  ]);

  const canvasStageHint = useMemo(
    () =>
      buildCanvasStageHint({
        hasRealTeamGraph,
        hasRuntimeFormation,
        hasSelectedTeamPlan,
        teamDispatchPreviewState,
      }),
    [
      hasRealTeamGraph,
      hasRuntimeFormation,
      hasSelectedTeamPlan,
      teamDispatchPreviewState,
    ],
  );

  const sessionControlState = useMemo(
    () =>
      buildTeamWorkspaceSessionControlState({
        visibleSessions,
        railSessions,
        currentChildSession,
        isChildSession,
        currentSessionId,
      }),
    [
      currentChildSession,
      currentSessionId,
      isChildSession,
      railSessions,
      visibleSessions,
    ],
  );
  const statusSummary = sessionControlState.statusSummary;
  const waitableTeamSessionIds = sessionControlState.waitableSessionIds;
  const canWaitAnyActiveTeamSession = Boolean(
    onWaitActiveTeamSessions && waitableTeamSessionIds.length > 1,
  );
  const teamOperationState = useMemo(
    () =>
      buildVisibleTeamOperationState({
        railSessions,
        teamWaitSummary,
        teamControlSummary,
      }),
    [railSessions, teamControlSummary, teamWaitSummary],
  );
  const visibleTeamWaitSummary = teamOperationState.visibleTeamWaitSummary;
  const teamOperationEntries = teamOperationState.entries;
  const completedTeamSessionIds = sessionControlState.completedSessionIds;
  const canCloseCompletedTeamSessions = Boolean(
    onCloseCompletedTeamSessions && completedTeamSessionIds.length > 0,
  );
  const canOpenSelectedSession = Boolean(
    selectedSession &&
    onOpenSubagentSession &&
    selectedSession.id !== currentSessionId,
  );
  const canWaitSelectedSession = Boolean(
    selectedSession &&
    isWaitableTeamSession(selectedSession) &&
    onWaitSubagentSession,
  );
  const canSendSelectedSessionInput = Boolean(
    selectedSession &&
    selectedSession.sessionType !== "user" &&
    selectedSession.runtimeStatus !== "closed" &&
    onSendSubagentInput &&
    selectedSession.id !== currentSessionId,
  );
  const canStopSelectedSession = Boolean(
    selectedSession &&
    selectedSession.sessionType !== "user" &&
    isTeamWorkspaceActiveStatus(
      selectedSession.runtimeStatus ?? selectedSession.latestTurnStatus,
    ) &&
    onCloseSubagentSession,
  );
  const canResumeSelectedSession = Boolean(
    selectedSession &&
    selectedSession.sessionType !== "user" &&
    selectedSession.runtimeStatus === "closed" &&
    onResumeSubagentSession,
  );
  const selectedActionPending = Boolean(
    selectedSession && pendingSessionAction?.sessionId === selectedSession.id,
  );
  const selectedSessionInputDraft = selectedSession
    ? (sessionInputDraftById[selectedSession.id] ?? "")
    : "";
  const selectedSessionInputMessage = selectedSessionInputDraft.trim();
  const handleWaitAnyActiveTeamSessions = useCallback(async () => {
    if (!onWaitActiveTeamSessions || waitableTeamSessionIds.length <= 1) {
      return;
    }

    setPendingTeamAction("wait_any");
    try {
      await onWaitActiveTeamSessions(
        waitableTeamSessionIds,
        DEFAULT_WAIT_SELECTED_SUBAGENT_TIMEOUT_MS,
      );
    } finally {
      setPendingTeamAction(null);
    }
  }, [onWaitActiveTeamSessions, waitableTeamSessionIds]);
  const handleCloseCompletedTeamSessions = useCallback(async () => {
    if (!onCloseCompletedTeamSessions || completedTeamSessionIds.length === 0) {
      return;
    }

    setPendingTeamAction("close_completed");
    try {
      await onCloseCompletedTeamSessions(completedTeamSessionIds);
    } finally {
      setPendingTeamAction(null);
    }
  }, [completedTeamSessionIds, onCloseCompletedTeamSessions]);
  const handleSelectTeamOperationEntry = useCallback(
    (entry: TeamOperationDisplayEntry) => {
      if (!entry.targetSessionId) {
        return;
      }
      if (
        !railSessions.some((session) => session.id === entry.targetSessionId)
      ) {
        return;
      }
      setSelectedSessionId(entry.targetSessionId);
      setExpandedSessionId(entry.targetSessionId);
    },
    [railSessions],
  );

  useEffect(() => {
    if (
      !visibleTeamWaitSummary?.resolvedSessionId ||
      visibleTeamWaitSummary.timedOut
    ) {
      return;
    }

    const waitFocusKey = [
      visibleTeamWaitSummary.updatedAt,
      visibleTeamWaitSummary.resolvedSessionId,
      visibleTeamWaitSummary.resolvedStatus ?? "idle",
    ].join(":");
    if (lastAutoFocusedTeamWaitKeyRef.current === waitFocusKey) {
      return;
    }

    if (
      railSessions.some(
        (session) => session.id === visibleTeamWaitSummary.resolvedSessionId,
      )
    ) {
      lastAutoFocusedTeamWaitKeyRef.current = waitFocusKey;
      setSelectedSessionId(visibleTeamWaitSummary.resolvedSessionId);
      setExpandedSessionId(visibleTeamWaitSummary.resolvedSessionId);
    }
  }, [railSessions, visibleTeamWaitSummary]);
  const handleSelectedSessionAction = useCallback(
    async (action: "close" | "resume" | "wait") => {
      if (!selectedSession) {
        return;
      }

      setPendingSessionAction({ sessionId: selectedSession.id, action });
      try {
        if (action === "close") {
          await onCloseSubagentSession?.(selectedSession.id);
          return;
        }
        if (action === "resume") {
          await onResumeSubagentSession?.(selectedSession.id);
          return;
        }
        await onWaitSubagentSession?.(
          selectedSession.id,
          DEFAULT_WAIT_SELECTED_SUBAGENT_TIMEOUT_MS,
        );
      } finally {
        setPendingSessionAction((current) =>
          current?.sessionId === selectedSession.id ? null : current,
        );
      }
    },
    [
      onCloseSubagentSession,
      onResumeSubagentSession,
      onWaitSubagentSession,
      selectedSession,
    ],
  );
  const handleSelectedSessionInputDraftChange = useCallback(
    (value: string) => {
      if (!selectedSession) {
        return;
      }

      setSessionInputDraftById((previous) => {
        if (previous[selectedSession.id] === value) {
          return previous;
        }
        return {
          ...previous,
          [selectedSession.id]: value,
        };
      });
    },
    [selectedSession],
  );
  const handleSelectedSessionSendInput = useCallback(
    async (interrupt: boolean) => {
      if (!selectedSession || !selectedSessionInputMessage) {
        return;
      }

      const action = interrupt ? "interrupt_send" : "send";
      const sessionId = selectedSession.id;
      setPendingSessionAction({ sessionId, action });
      try {
        await onSendSubagentInput?.(sessionId, selectedSessionInputMessage, {
          interrupt,
        });
        setSessionInputDraftById((previous) => {
          if (!previous[sessionId]) {
            return previous;
          }
          return {
            ...previous,
            [sessionId]: "",
          };
        });
      } finally {
        setPendingSessionAction((current) =>
          current?.sessionId === sessionId ? null : current,
        );
      }
    },
    [onSendSubagentInput, selectedSession, selectedSessionInputMessage],
  );
  const memberCanvasTitle = "协作进展画布";
  const memberCanvasSubtitle = hasRealTeamGraph
    ? isChildSession
      ? "当前协作成员会在各自面板里持续更新进展和结果，主对话只保留必要摘要。"
      : `${visibleSessions.length} 位协作成员已加入，每位成员都会在自己的面板里持续更新进展和结果。`
    : dispatchPreviewState?.status === "forming"
      ? "正在准备当前协作分工，成员接入后会在这里独立更新进展。"
      : dispatchPreviewState?.status === "formed"
        ? "当前协作分工已经就绪，成员接入后会在各自面板里开始处理。"
        : dispatchPreviewState?.status === "failed"
          ? "这次协作准备失败，暂时无法生成成员面板。"
          : "成员加入后，这里会展开为独立的协作进展面板。";

  if (
    !subagentParentContext &&
    childSubagentSessions.length === 0 &&
    !shellVisible
  ) {
    return null;
  }

  if (isEmptyShellState && !shellExpanded) {
    return (
      <TeamWorkspaceEmptyShellState
        className={className}
        embedded={embedded}
        hasRuntimeFormation={hasRuntimeFormation}
        onExpand={() => setShellExpanded(true)}
        runtimeFormationDisplay={runtimeFormationDisplay}
        selectedTeamPlanDisplay={selectedTeamPlanDisplay}
      />
    );
  }

  const selectedStatusMeta = resolveStatusMeta(selectedSession?.runtimeStatus);
  const detailVisible =
    isEmptyShellState || !hasRealTeamGraph
      ? detailExpanded || shellExpanded
      : false;
  const detailToggleLabel = detailVisible ? "收起细节" : "查看细节";
  const boardChromeDisplay = buildTeamWorkspaceBoardChromeDisplayState({
    hasRealTeamGraph,
    hasRuntimeFormation,
    runtimeFormationTitle: hasRuntimeFormation
      ? runtimeFormationDisplay.panelHeadline
      : null,
    runtimeFormationHint: runtimeFormationDisplay.hint,
    isChildSession,
    parentSessionName: subagentParentContext?.parent_session_name,
    totalTeamSessions,
    siblingCount,
    selectedSession,
    zoom: canvasLayoutState.viewport.zoom,
    canWaitAnyActiveTeamSession,
    waitableCount: waitableTeamSessionIds.length,
    canCloseCompletedTeamSessions,
    completedCount: completedTeamSessionIds.length,
    statusSummary,
  });
  const detailSummary =
    selectedSession?.taskSummary ||
    buildFallbackSummary({
      hasRealTeamGraph,
      isChildSession,
      selectedSession,
    });
  const useCompactCanvasChrome = hasRealTeamGraph;
  const selectedSessionDetailDisplay = buildSelectedSessionDetailDisplayState({
    selectedSession,
    isChildSession,
    parentSessionName: subagentParentContext?.parent_session_name,
  });
  const boardShellClassName = cn(
    embedded
      ? "pointer-events-auto flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-none border-0 bg-transparent shadow-none"
      : "overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-[0_18px_64px_-42px_rgba(15,23,42,0.24)]",
    embedded ? "mx-0 mt-0" : "mx-3 mt-2",
    className,
  );
  const boardHeaderClassName = cn(
    "flex flex-wrap items-start justify-between gap-3",
    useCompactCanvasChrome ? "px-4 py-2.5 sm:px-4" : "px-4 py-3.5 sm:px-5",
    embedded
      ? cn(
          "sticky top-0 z-20 border-b border-slate-200",
          useCompactCanvasChrome ? "bg-white" : "bg-slate-50",
        )
      : cn(
          "border-b border-slate-200",
          useCompactCanvasChrome ? "bg-white" : "bg-slate-50",
        ),
  );
  const boardBodyClassName = embedded
    ? cn(
        "min-h-0 flex-1 overflow-y-auto overscroll-contain",
        useCompactCanvasChrome
          ? "p-3 sm:p-3.5 space-y-2.5"
          : "p-3 sm:p-4 space-y-3",
      )
    : cn(useCompactCanvasChrome ? "p-3 sm:p-3.5" : "p-3 sm:p-4");
  const canvasStageHeight =
    embedded && !detailVisible
      ? "clamp(560px, 76vh, 980px)"
      : TEAM_WORKSPACE_CANVAS_STAGE_HEIGHT;
  const railCardClassName = embedded
    ? cn(
        "pointer-events-auto",
        useCompactCanvasChrome ? "space-y-3" : "space-y-4",
      )
    : "rounded-[22px] border border-slate-200 bg-slate-50 p-3.5 shadow-sm shadow-slate-950/5";
  const detailCardClassName = cn(
    embedded
      ? "rounded-[20px] border border-slate-200 bg-white p-4"
      : "rounded-[22px] border p-4 shadow-sm shadow-slate-950/5",
    !embedded &&
      (selectedSession
        ? selectedStatusMeta.cardClassName
        : "border-slate-200 bg-white"),
  );
  const inlineDetailSectionClassName =
    "mt-3 rounded-[18px] border border-slate-200 bg-slate-50 p-3";
  const inlineTimelineFeedClassName =
    "mt-3 rounded-[16px] border border-slate-200 bg-white p-3";
  const inlineTimelineEntryClassName =
    "rounded-[14px] border border-slate-200 bg-white p-3";
  const renderCanvasSelectedInlineDetail = (lane: TeamWorkspaceCanvasLane) => {
    if (!selectedSession || lane.session?.id !== selectedSession.id) {
      return null;
    }

    return (
      <SelectedSessionInlineDetail
        canOpenSelectedSession={canOpenSelectedSession}
        canResumeSelectedSession={canResumeSelectedSession}
        canSendSelectedSessionInput={canSendSelectedSessionInput}
        canStopSelectedSession={canStopSelectedSession}
        canWaitSelectedSession={canWaitSelectedSession}
        detailSummary={detailSummary}
        detailDisplay={selectedSessionDetailDisplay}
        formatUpdatedAt={formatUpdatedAt}
        inlineDetailSectionClassName={inlineDetailSectionClassName}
        inlineTimelineEntryClassName={inlineTimelineEntryClassName}
        inlineTimelineFeedClassName={inlineTimelineFeedClassName}
        isChildSession={isChildSession}
        onOpenSelectedSession={() => void onOpenSubagentSession?.(selectedSession.id)}
        onSelectedSessionAction={handleSelectedSessionAction}
        onSelectedSessionInputDraftChange={handleSelectedSessionInputDraftChange}
        onSelectedSessionSendInput={handleSelectedSessionSendInput}
        pendingAction={
          selectedActionPending ? pendingSessionAction?.action ?? null : null
        }
        selectedActionPending={selectedActionPending}
        selectedSession={selectedSession}
        selectedSessionActivityEntries={selectedSessionActivityEntries}
        selectedSessionActivityPreview={selectedSessionActivityPreview}
        selectedSessionActivityPreviewText={selectedSessionActivityPreviewText}
        selectedSessionActivityShouldPoll={selectedSessionActivityShouldPoll}
        selectedSessionInputDraft={selectedSessionInputDraft}
        selectedSessionInputMessage={selectedSessionInputMessage}
        selectedSessionSupportsActivityPreview={
          selectedSessionSupportsActivityPreview
        }
      />
    );
  };
  return (
    <section
      className={boardShellClassName}
      data-testid={embedded ? "team-workspace-board-embedded-shell" : undefined}
      style={embedded ? { maxHeight: "inherit" } : undefined}
    >
      <TeamWorkspaceBoardHeader
        boardChromeDisplay={boardChromeDisplay}
        className={boardHeaderClassName}
        createdFromTurnId={subagentParentContext?.created_from_turn_id}
        dataTestId={embedded ? "team-workspace-board-header" : undefined}
        detailToggleLabel={detailToggleLabel}
        detailVisible={detailVisible}
        isChildSession={isChildSession}
        isEmptyShellState={isEmptyShellState}
        onReturnToParentSession={onReturnToParentSession}
        onToggleDetail={() => {
          setShellExpanded((previous) => !previous);
        }}
        resolveStatusMeta={resolveStatusMeta}
        runtimeFormationStatusLabel={runtimeFormationDisplay.panelStatusLabel}
        totalTeamSessions={totalTeamSessions}
        useCompactCanvasChrome={useCompactCanvasChrome}
      />

      <div
        className={boardBodyClassName}
        data-testid={embedded ? "team-workspace-board-body" : undefined}
      >
        <div className={railCardClassName}>
          <TeamWorkspaceTeamOverviewChrome
            boardChromeDisplay={boardChromeDisplay}
            canCloseCompletedTeamSessions={canCloseCompletedTeamSessions}
            canWaitAnyActiveTeamSession={canWaitAnyActiveTeamSession}
            completedCount={completedTeamSessionIds.length}
            embedded={embedded}
            formatUpdatedAt={formatUpdatedAt}
            memberCanvasSubtitle={memberCanvasSubtitle}
            memberCanvasTitle={memberCanvasTitle}
            onAutoArrangeCanvas={handleAutoArrangeCanvas}
            onCloseCompletedTeamSessions={handleCloseCompletedTeamSessions}
            onFitCanvasView={handleFitCanvasView}
            onSelectTeamOperationEntry={handleSelectTeamOperationEntry}
            onWaitAnyActiveTeamSessions={handleWaitAnyActiveTeamSessions}
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
            pendingTeamAction={pendingTeamAction}
            resolveStatusMeta={resolveStatusMeta}
            selectedSession={selectedSession}
            teamOperationEntries={teamOperationEntries}
            useCompactCanvasChrome={useCompactCanvasChrome}
            waitableCount={waitableTeamSessionIds.length}
          />

          <div
            className={cn(
              "mt-3",
              useCompactCanvasChrome ? "space-y-2.5" : "space-y-3",
            )}
          >
            {!useCompactCanvasChrome ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                  <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">
                    自由画布
                  </span>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">
                    缩放 {Math.round(canvasLayoutState.viewport.zoom * 100)}%
                  </span>
                  {canvasLanes.length > 0 ? (
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">
                      {canvasLanes.length} 个成员面板
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleAutoArrangeCanvas}
                    data-testid="team-workspace-auto-arrange-button"
                  >
                    整理布局
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleZoomOut}
                  >
                    缩小
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleZoomIn}
                  >
                    放大
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleResetCanvasView}
                  >
                    100%
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleFitCanvasView}
                  >
                    适应视图
                  </Button>
                </div>
              </div>
            ) : null}
            <TeamWorkspaceCanvasStage
              canvasBoundsHeight={canvasBounds.height}
              canvasBoundsWidth={canvasBounds.width}
              canvasStageHeight={canvasStageHeight}
              canvasStageHint={canvasStageHint}
              expandedSessionId={expandedSessionId}
              isCanvasPanModifierActive={isCanvasPanModifierActive}
              laneLayouts={canvasLaneLayouts}
              lanes={canvasLanes}
              onCanvasWheel={handleCanvasWheel}
              onSelectLane={(lane) => {
                bringCanvasLaneToFront(lane.persistKey);
                if (lane.session) {
                  setSelectedSessionId(lane.session.id);
                  setExpandedSessionId(lane.session.id);
                }
              }}
              onStartCanvasLaneDrag={(lane, event) =>
                handleStartCanvasLaneDrag(lane.persistKey, event)
              }
              onStartCanvasLaneResize={(lane, direction, event) =>
                handleStartCanvasLaneResize(lane.persistKey, direction, event)
              }
              onStartCanvasPan={handleStartCanvasPan}
              renderSelectedInlineDetail={renderCanvasSelectedInlineDetail}
              selectedSessionId={selectedSession?.id ?? null}
              viewport={canvasLayoutState.viewport}
              viewportRef={canvasViewportRef}
            />
          </div>

          {!hasRealTeamGraph ? (
            <>
              {hasRuntimeFormation ? (
                <TeamWorkspaceRuntimeFormationPanel
                  runtimeFormationDisplay={runtimeFormationDisplay}
                />
              ) : (
                selectedTeamPlanDisplay.hasSelectedTeamPlan ? (
                  <TeamWorkspaceSelectedPlanPanel
                    selectedTeamPlanDisplay={selectedTeamPlanDisplay}
                  />
                ) : null
              )}
              <div className="mt-4 rounded-[20px] border border-dashed border-slate-200 bg-slate-50 p-5 text-sm leading-6 text-slate-500">
                {runtimeFormationDisplay.noticeText}
              </div>
            </>
          ) : null}

          {!hasRealTeamGraph && detailVisible ? (
            <div
              className={cn("mt-3", detailCardClassName)}
              data-testid="team-workspace-detail-section"
            >
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                <Bot className="h-3.5 w-3.5" />
                <span>当前详情</span>
              </div>
              <div className="mt-2 text-base font-semibold text-slate-900">
                {runtimeFormationDisplay.panelHeadline}
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                {runtimeFormationDisplay.emptyDetail}
              </p>
              {hasRuntimeFormation ? (
                <div className="mt-4 space-y-4">
                  <TeamWorkspaceRuntimeFormationPanel
                    runtimeFormationDisplay={runtimeFormationDisplay}
                    showBlueprintRoleCards
                  />
                </div>
              ) : hasSelectedTeamPlan ? (
                <div className="mt-4">
                  <TeamWorkspaceSelectedPlanPanel
                    selectedTeamPlanDisplay={selectedTeamPlanDisplay}
                  />
                </div>
              ) : null}
              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">
                  推荐流程：邀请协作成员 → 查看结果 → 补充说明
                </span>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
