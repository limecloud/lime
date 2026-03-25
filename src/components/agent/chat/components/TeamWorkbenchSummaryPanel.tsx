import { Activity, Bot, Clock3, Sparkles, Workflow } from "lucide-react";
import type {
  AsterSubagentParentContext,
  AsterSubagentSessionInfo,
} from "@/lib/api/agentRuntime";
import { cn } from "@/lib/utils";
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
  summarizeTeamWorkspaceExecution,
} from "../teamWorkspaceRuntime";
import type { TeamRoleDefinition } from "../utils/teamDefinitions";

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
}

function buildOperationSummary(params: {
  teamWaitSummary?: TeamWorkspaceWaitSummary | null;
  teamControlSummary?: TeamWorkspaceControlSummary | null;
}) {
  if (params.teamControlSummary) {
    const affectedCount = params.teamControlSummary.affectedSessionIds.length;
    switch (params.teamControlSummary.action) {
      case "resume":
        return `最近一次恢复操作影响 ${affectedCount} 个 agent。`;
      case "close_completed":
        return `最近一次收尾操作关闭了 ${affectedCount} 位已完成成员。`;
      case "close":
      default:
        return `最近一次关闭操作影响 ${affectedCount} 个 agent。`;
    }
  }

  if (params.teamWaitSummary) {
    return params.teamWaitSummary.timedOut
      ? `最近一次等待超时，仍有 ${params.teamWaitSummary.awaitedSessionIds.length} 位成员在推进。`
      : "最近一次等待已收到成员结果。";
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
  const hasRealTeamGraph =
    childSubagentSessions.length > 0 || Boolean(subagentParentContext);
  const runtimeFormationMeta = dispatchPreviewState
    ? resolveRuntimeFormationStatusMeta(dispatchPreviewState.status)
    : null;
  const runtimeTeamLabel =
    dispatchPreviewState?.label?.trim() ||
    dispatchPreviewState?.blueprint?.label?.trim() ||
    selectedTeamLabel?.trim() ||
    null;
  const runtimeSummaryText =
    dispatchPreviewState?.summary?.trim() ||
    dispatchPreviewState?.blueprint?.summary?.trim() ||
    selectedTeamSummary ||
    null;
  const operationSummary = buildOperationSummary({
    teamWaitSummary,
    teamControlSummary,
  });
  const latestActivity = Object.values(liveActivityBySessionId)
    .flat()
    .slice(0, 4);
  const displayRoleCount = hasRealTeamGraph
    ? executionSummary.totalSessionCount
    : dispatchPreviewState?.members.length ?? 0;
  const roleCards =
    dispatchPreviewState?.members.length
      ? dispatchPreviewState.members.map((member) => ({
          id: member.id,
          label: member.label,
          roleKey: member.roleKey,
          profileId: member.profileId,
          summary: member.summary,
          skillIds: member.skillIds,
          statusMeta: resolveRuntimeMemberStatusMeta(member.status),
        }))
      : (selectedTeamRoles ?? []).map((role) => ({
          id: role.id,
          label: role.label,
          roleKey: role.roleKey,
          profileId: role.profileId,
          summary: role.summary,
          skillIds: role.skillIds ?? [],
          statusMeta: null,
        }));
  const summaryCards = [
    {
      label: "活跃 Agent",
      value: String(executionSummary.activeSessionCount),
      hint: executionSummary.hasActiveRuntime ? "正在协作" : "尚未运行",
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
      label: hasRealTeamGraph
        ? "总会话"
        : dispatchPreviewState
          ? "当前成员"
          : "总会话",
      value: String(
        hasRealTeamGraph ? executionSummary.totalSessionCount : displayRoleCount,
      ),
      hint: hasRealTeamGraph
        ? "已进入团队图谱"
        : dispatchPreviewState
          ? "当前编队"
          : "等待创建",
    },
  ];

  return (
    <div className="space-y-4">
      <section className="rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-950/5">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
          <Workflow className="h-3.5 w-3.5" />
          <span>团队工作台</span>
          {runtimeTeamLabel ? (
            <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-medium tracking-normal text-sky-700 normal-case">
              {runtimeTeamLabel}
            </span>
          ) : null}
          {runtimeFormationMeta ? (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-medium tracking-normal normal-case",
                runtimeFormationMeta.badgeClassName,
              )}
            >
              {runtimeFormationMeta.label}
            </span>
          ) : null}
        </div>
        <div className="mt-2 text-sm font-semibold text-slate-900">
          {executionSummary.statusTitle ||
            runtimeFormationMeta?.title ||
            "团队已就绪，等待主代理开始编排"}
        </div>
        <p className="mt-2 text-xs leading-5 text-slate-500">
          {dispatchPreviewState?.status === "failed"
            ? dispatchPreviewState.errorMessage?.trim() ||
              "这次 Team 准备失败，可继续在当前对话中推进。"
            : runtimeSummaryText ||
            "这里展示团队总览与运行密度；主对话只保留调度记录，角色执行正文在左侧 Team 画布查看。"}
        </p>
        {!hasRealTeamGraph && dispatchPreviewState ? (
          <div
            className={cn(
              "mt-3 rounded-2xl border px-3 py-2 text-xs leading-5",
              runtimeFormationMeta?.badgeClassName ||
                "border border-slate-200 bg-slate-50 text-slate-700",
            )}
          >
            {dispatchPreviewState.status === "forming"
              ? "模型正在依据当前任务准备 Team，真实成员加入后会自动切换到实时协作轨道。"
              : dispatchPreviewState.status === "formed"
                ? `已准备 ${dispatchPreviewState.members.length} 个成员，当前等待系统分派真实成员进入协作。`
                : dispatchPreviewState.errorMessage?.trim() ||
                  "暂未成功准备这次 Team。"}
          </div>
        ) : null}
        {!hasRealTeamGraph && !dispatchPreviewState ? (
          <div className="mt-3 rounded-2xl border border-sky-100 bg-sky-50 px-3 py-2 text-xs leading-5 text-sky-700">
            尚未出现真实团队成员。开始分派成员后，左侧 Team 画布会自动切换为实时协作视图。
          </div>
        ) : null}
      </section>

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
            <span>{dispatchPreviewState ? "当前成员" : "角色分工"}</span>
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
          {dispatchPreviewState?.blueprint?.label ? (
            <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">
              参考蓝图 Team：{dispatchPreviewState.blueprint.label}
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
          左侧主画布负责展示成员轨道、实时过程与细节；右侧用于总览、角色结构与快速理解当前协作状态。
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
