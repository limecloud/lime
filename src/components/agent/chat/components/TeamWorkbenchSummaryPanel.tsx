import { Activity, Bot, Clock3, Sparkles, Workflow } from "lucide-react";
import type {
  AsterSubagentParentContext,
  AsterSubagentSessionInfo,
} from "@/lib/api/agentRuntime";
import type { TeamMemorySnapshot } from "@/lib/teamMemorySync";
import { cn } from "@/lib/utils";
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
import type { TeamRoleDefinition } from "../utils/teamDefinitions";
import { normalizeTeamWorkspaceDisplayValue } from "../utils/teamWorkspaceDisplay";
import { TeamMemoryShadowCard } from "./TeamMemoryShadowCard";

interface TeamWorkbenchSummaryPanelProps {
  currentSessionId?: string | null;
  currentSessionRuntimeStatus?: AsterSubagentSessionInfo["runtime_status"];
  currentSessionLatestTurnStatus?: AsterSubagentSessionInfo["runtime_status"];
  currentSessionQueuedTurnCount?: number;
  childSubagentSessions?: AsterSubagentSessionInfo[];
  subagentParentContext?: AsterSubagentParentContext | null;
  liveRuntimeBySessionId?: Record<string, TeamWorkspaceLiveRuntimeState>;
  liveActivityBySessionId?: Record<string, TeamWorkspaceActivityEntry[]>;
  teamWaitSummary?: TeamWorkspaceWaitSummary | null;
  teamControlSummary?: TeamWorkspaceControlSummary | null;
  selectedTeamLabel?: string | null;
  selectedTeamSummary?: string | null;
  selectedTeamRoles?: TeamRoleDefinition[] | null;
  teamDispatchPreviewState?: TeamWorkspaceRuntimeFormationState | null;
  teamMemorySnapshot?: TeamMemorySnapshot | null;
}

function buildOperationSummary(params: {
  teamWaitSummary?: TeamWorkspaceWaitSummary | null;
  teamControlSummary?: TeamWorkspaceControlSummary | null;
}) {
  if (params.teamControlSummary) {
    const affectedCount = params.teamControlSummary.affectedSessionIds.length;
    switch (params.teamControlSummary.action) {
      case "resume":
        return `最近一次继续操作影响 ${affectedCount} 项任务。`;
      case "close_completed":
        return `最近一次收尾操作收起了 ${affectedCount} 项已完成任务。`;
      case "close":
      default:
        return `最近一次暂停操作影响 ${affectedCount} 项任务。`;
    }
  }

  if (params.teamWaitSummary) {
    return params.teamWaitSummary.timedOut
      ? `最近一次等待超时，仍有 ${params.teamWaitSummary.awaitedSessionIds.length} 项任务在推进。`
      : "最近一次等待已收到任务结果。";
  }

  return null;
}

export function TeamWorkbenchSummaryPanel({
  currentSessionId,
  currentSessionRuntimeStatus,
  currentSessionLatestTurnStatus,
  currentSessionQueuedTurnCount = 0,
  childSubagentSessions = [],
  subagentParentContext = null,
  liveRuntimeBySessionId = {},
  liveActivityBySessionId = {},
  teamWaitSummary = null,
  teamControlSummary = null,
  selectedTeamLabel,
  selectedTeamSummary,
  selectedTeamRoles = [],
  teamDispatchPreviewState = null,
  teamMemorySnapshot = null,
}: TeamWorkbenchSummaryPanelProps) {
  const dispatchPreviewState = teamDispatchPreviewState;
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
  const runtimeFormationDisplay = buildRuntimeFormationDisplayState({
    teamDispatchPreviewState: dispatchPreviewState,
    fallbackLabel: selectedTeamLabel,
    fallbackSummary: selectedTeamSummary,
  });
  const runtimeTeamLabel = runtimeFormationDisplay.panelLabel;
  const operationSummary = buildOperationSummary({
    teamWaitSummary,
    teamControlSummary,
  });
  const latestActivity = Object.values(liveActivityBySessionId)
    .flat()
    .slice(0, 4);
  const selectedRoleCount = (selectedTeamRoles ?? []).filter((role) =>
    role.label.trim(),
  ).length;
  const displayRoleCount = hasRuntimeSessions
    ? executionSummary.totalSessionCount
    : (dispatchPreviewState?.members.length ?? selectedRoleCount);
  const roleCards = dispatchPreviewState?.members.length
    ? dispatchPreviewState.members.map((member) => ({
        id: member.id,
        label: normalizeTeamWorkspaceDisplayValue(member.label) || member.label,
        roleKey: member.roleKey,
        profileId: member.profileId,
        summary:
          normalizeTeamWorkspaceDisplayValue(member.summary) || member.summary,
        skillIds: member.skillIds,
        statusMeta: resolveRuntimeMemberStatusMeta(member.status),
      }))
    : (selectedTeamRoles ?? []).map((role) => ({
        id: role.id,
        label: normalizeTeamWorkspaceDisplayValue(role.label) || role.label,
        roleKey: role.roleKey,
        profileId: role.profileId,
        summary:
          normalizeTeamWorkspaceDisplayValue(role.summary) || role.summary,
        skillIds: role.skillIds ?? [],
        statusMeta: null,
      }));
  const summaryCards = [
    {
      label: "活跃任务",
      value: String(executionSummary.activeSessionCount),
      hint: executionSummary.hasActiveRuntime ? "任务进行中" : "尚未运行",
    },
    {
      label: "处理中",
      value: String(executionSummary.runningSessionCount),
      hint: executionSummary.runningSessionCount > 0 ? "正在推进" : "暂无",
    },
    {
      label: "稍后开始",
      value: String(executionSummary.queuedSessionCount),
      hint: executionSummary.queuedSessionCount > 0 ? "按顺序继续" : "暂无",
    },
    {
      label: hasRuntimeSessions
        ? "总会话"
        : dispatchPreviewState
          ? "当前任务"
          : selectedRoleCount > 0
            ? "计划分工"
            : "总会话",
      value: String(
        hasRuntimeSessions
          ? executionSummary.totalSessionCount
          : displayRoleCount,
      ),
      hint: hasRuntimeSessions
        ? "已进入任务轨道"
        : dispatchPreviewState
          ? "当前分工"
          : selectedRoleCount > 0
            ? "已选方案"
            : "等待创建",
    },
  ];

  return (
    <div className="space-y-4">
      <section className="rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-950/5">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
          <Workflow className="h-3.5 w-3.5" />
          <span>生成</span>
          {runtimeTeamLabel ? (
            <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-medium tracking-normal text-sky-700 normal-case">
              {runtimeTeamLabel}
            </span>
          ) : null}
          {runtimeFormationDisplay.panelStatusLabel ? (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-medium tracking-normal normal-case",
                runtimeFormationDisplay.panelStatusBadgeClassName,
              )}
            >
              {runtimeFormationDisplay.panelStatusLabel}
            </span>
          ) : null}
        </div>
        <div className="mt-2 text-sm font-semibold text-slate-900">
          {executionSummary.statusTitle ||
            runtimeFormationDisplay.panelHeadline ||
            "生成已就绪，等待主线程开始编排"}
        </div>
        <p className="mt-2 text-xs leading-5 text-slate-500">
          {runtimeFormationDisplay.panelDescription}
        </p>
        {!hasRuntimeSessions && dispatchPreviewState ? (
          <div
            className={cn(
              "mt-3 rounded-2xl border px-3 py-2 text-xs leading-5",
              runtimeFormationDisplay.panelStatusBadgeClassName ||
                "border border-slate-200 bg-slate-50 text-slate-700",
            )}
          >
            {runtimeFormationDisplay.noticeText}
          </div>
        ) : null}
        {!hasRuntimeSessions && !dispatchPreviewState ? (
          <div className="mt-3 rounded-2xl border border-sky-100 bg-sky-50 px-3 py-2 text-xs leading-5 text-sky-700">
            尚未接入任务。发送后这里会先展示分工，再过渡到当前进展。
          </div>
        ) : null}
      </section>

      {teamMemorySnapshot ? (
        <TeamMemoryShadowCard snapshot={teamMemorySnapshot} />
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2">
        {summaryCards.map((card) => (
          <div
            key={card.label}
            className="rounded-[20px] border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-950/5"
          >
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
              {card.label}
            </div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">
              {card.value}
            </div>
            <div className="mt-1 text-xs text-slate-500">{card.hint}</div>
          </div>
        ))}
      </section>

      {roleCards.length > 0 ? (
        <section className="rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-950/5">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            <Bot className="h-3.5 w-3.5" />
            <span>{dispatchPreviewState ? "当前任务分工" : "角色分工"}</span>
          </div>
          <div className="mt-3 space-y-2">
            {roleCards.map((role) => (
              <div
                key={`team-workbench-role-${role.id}`}
                className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900">
                    {role.label}
                  </span>
                  {role.statusMeta ? (
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-medium",
                        role.statusMeta.badgeClassName,
                      )}
                    >
                      {role.statusMeta.label}
                    </span>
                  ) : null}
                  {role.roleKey ? (
                    <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-500">
                      {role.roleKey}
                    </span>
                  ) : null}
                  {role.profileId ? (
                    <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-500">
                      {role.profileId}
                    </span>
                  ) : null}
                </div>
                <div className="mt-1.5 text-xs leading-5 text-slate-600">
                  {role.summary}
                </div>
                {role.skillIds.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {role.skillIds.map((skillId) => (
                      <span
                        key={`${role.id}-${skillId}`}
                        className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-500"
                      >
                        {skillId}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          {runtimeFormationDisplay.referenceLabel ? (
            <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">
              参考方案：{runtimeFormationDisplay.referenceLabel}
            </div>
          ) : null}
        </section>
      ) : null}

      {(operationSummary || latestActivity.length > 0) && (
        <section className="rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-950/5">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            <Activity className="h-3.5 w-3.5" />
            <span>最近动态</span>
          </div>
          {operationSummary ? (
            <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-700">
              {operationSummary}
            </div>
          ) : null}
          {latestActivity.length > 0 ? (
            <div className="mt-3 space-y-2">
              {latestActivity.map((entry) => (
                <div
                  key={`team-workbench-activity-${entry.id}`}
                  className="rounded-2xl border border-slate-200 bg-white px-3 py-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">
                      {entry.title}
                    </span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-medium",
                        entry.badgeClassName,
                      )}
                    >
                      {entry.statusLabel}
                    </span>
                  </div>
                  <div className="mt-1.5 text-xs leading-5 text-slate-600">
                    {entry.detail}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      )}

      <div className="rounded-[24px] border border-slate-200/80 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
        <div className="flex items-center gap-2 font-semibold uppercase tracking-[0.12em] text-slate-500">
          <Clock3 className="h-3.5 w-3.5" />
          <span>交互说明</span>
        </div>
        <div className="mt-2">
          左侧主画布负责展示任务轨道、实时过程与细节；右侧用于总览、任务结构与快速理解当前进展状态。
        </div>
        <div className="mt-2 flex items-center gap-2 text-sky-700">
          <Sparkles className="h-3.5 w-3.5" />
          <span>这套布局会复用到图片、多文件和其他专用画布。</span>
        </div>
      </div>
    </div>
  );
}

export default TeamWorkbenchSummaryPanel;
