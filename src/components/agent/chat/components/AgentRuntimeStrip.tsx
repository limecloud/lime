import React, { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import type { AsterSubagentSessionInfo } from "@/lib/api/agentRuntime";

import type { ChatToolPreferences } from "../utils/chatToolPreferences";
import type { CompatSubagentRuntimeSnapshot } from "../utils/compatSubagentRuntime";
import type { HarnessSessionState } from "../utils/harnessState";

interface AgentRuntimeStripProps {
  activeTheme?: string;
  toolPreferences: ChatToolPreferences;
  harnessState: HarnessSessionState;
  childSubagentSessions?: AsterSubagentSessionInfo[];
  compatSubagentRuntime: Pick<
    CompatSubagentRuntimeSnapshot,
    "isRunning" | "progress"
  >;
  variant?: "standalone" | "embedded";
  isSending?: boolean;
  runtimeStatusTitle?: string | null;
  selectedTeamLabel?: string | null;
  selectedTeamSummary?: string | null;
  selectedTeamRoleCount?: number;
}

const THEME_LABELS: Record<string, string> = {
  general: "通用对话",
  knowledge: "知识探索",
  planning: "计划规划",
};

interface CapabilityItem {
  key: string;
  label: string;
  enabled: boolean;
}

interface StatusItem {
  key: string;
  label: string;
  tone?: "default" | "outline" | "secondary";
}

export const AgentRuntimeStrip: React.FC<AgentRuntimeStripProps> = ({
  activeTheme,
  toolPreferences,
  harnessState,
  compatSubagentRuntime,
  childSubagentSessions = [],
  variant = "standalone",
  isSending = false,
  runtimeStatusTitle = null,
  selectedTeamLabel = null,
  selectedTeamSummary = null,
  selectedTeamRoleCount = 0,
}) => {
  const themeLabel =
    THEME_LABELS[activeTheme?.trim().toLowerCase() || ""] || "通用对话";
  const hasSelectedTeam =
    Boolean(selectedTeamLabel?.trim()) || selectedTeamRoleCount > 0;

  const capabilities = useMemo<CapabilityItem[]>(
    () => [
      { key: "direct", label: "直接回答", enabled: true },
      { key: "thinking", label: "深度思考", enabled: toolPreferences.thinking },
      {
        key: "web_search",
        label: "联网搜索",
        enabled: toolPreferences.webSearch,
      },
      { key: "task", label: "后台任务", enabled: toolPreferences.task },
      { key: "subagent", label: "多代理", enabled: toolPreferences.subagent },
    ],
    [toolPreferences],
  );

  const statusItems = useMemo<StatusItem[]>(() => {
    const nextItems: StatusItem[] = [];
    const runningTeamSessions = childSubagentSessions.filter(
      (session) => session.runtime_status === "running",
    ).length;
    const queuedTeamSessions = childSubagentSessions.filter(
      (session) => session.runtime_status === "queued",
    ).length;
    const activeTeamSessions = runningTeamSessions + queuedTeamSessions;
    const completedTeamSessions = childSubagentSessions.filter(
      (session) =>
        session.runtime_status === "completed" ||
        session.runtime_status === "failed" ||
        session.runtime_status === "aborted",
    ).length;

    if (isSending) {
      nextItems.push({
        key: "sending",
        label: runtimeStatusTitle || "正在准备执行",
        tone: "secondary",
      });
    }

    if (harnessState.plan.phase === "planning") {
      nextItems.push({
        key: "planning",
        label: "正在整理执行计划",
        tone: "secondary",
      });
    }

    if (harnessState.plan.items.length > 0) {
      nextItems.push({
        key: "plan_items",
        label: `当前计划 ${harnessState.plan.items.length} 项`,
        tone: "outline",
      });
    }

    if (harnessState.pendingApprovals.length > 0) {
      nextItems.push({
        key: "pending",
        label: `等待确认 ${harnessState.pendingApprovals.length}`,
        tone: "secondary",
      });
    }

    if (activeTeamSessions > 0) {
      nextItems.push({
        key: "team_running",
        label:
          queuedTeamSessions > 0
            ? `Team 运行中 ${activeTeamSessions}/${childSubagentSessions.length} · 排队 ${queuedTeamSessions}`
            : `Team 运行中 ${activeTeamSessions}/${childSubagentSessions.length}`,
        tone: "secondary",
      });
    } else if (childSubagentSessions.length > 0) {
      nextItems.push({
        key: "team_sessions",
        label:
          completedTeamSessions > 0
            ? `Team 会话 ${childSubagentSessions.length} · 已收敛 ${completedTeamSessions}`
            : `Team 会话 ${childSubagentSessions.length}`,
        tone: "outline",
      });
    } else if (compatSubagentRuntime.isRunning) {
      const progressLabel =
        compatSubagentRuntime.progress &&
        typeof compatSubagentRuntime.progress.completed === "number" &&
        typeof compatSubagentRuntime.progress.total === "number"
          ? `子代理运行中 ${compatSubagentRuntime.progress.completed}/${compatSubagentRuntime.progress.total}`
          : "子代理运行中";
      nextItems.push({
        key: "subagent_running",
        label: progressLabel,
        tone: "secondary",
      });
    } else if (harnessState.delegatedTasks.length > 0) {
      nextItems.push({
        key: "delegated",
        label: `最近委派 ${harnessState.delegatedTasks.length}`,
        tone: "outline",
      });
    }

    if (harnessState.outputSignals.length > 0) {
      nextItems.push({
        key: "outputs",
        label: `最近产物 ${harnessState.outputSignals.length}`,
        tone: "outline",
      });
    }

    if (nextItems.length === 0) {
      nextItems.push({
        key: "default_mode",
        label: "当前以直接回答优先，必要时再升级工具链",
        tone: "outline",
      });
    }

    return nextItems;
  }, [
    childSubagentSessions,
    compatSubagentRuntime.isRunning,
    compatSubagentRuntime.progress,
    harnessState,
    isSending,
    runtimeStatusTitle,
  ]);

  return (
    <div
      className={
        variant === "embedded"
          ? "rounded-xl border border-border/70 bg-[linear-gradient(135deg,hsl(var(--background)),hsl(var(--muted)/0.35))] px-4 py-3"
          : "mx-3 mb-2 mt-3 rounded-2xl border border-border/70 bg-[linear-gradient(135deg,hsl(var(--background)),hsl(var(--muted)/0.35))] px-4 py-3"
      }
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="text-sm font-medium text-foreground">通用 Agent</div>
        <Badge variant="outline">{themeLabel}</Badge>
        {toolPreferences.subagent ? (
          <Badge variant={hasSelectedTeam ? "secondary" : "outline"}>
            {hasSelectedTeam
              ? `Team · ${selectedTeamLabel || `${selectedTeamRoleCount} 角色`}`
              : "Team mode"}
          </Badge>
        ) : null}
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        {capabilities.map((item) => (
          <span
            key={item.key}
            className={[
              "rounded-full border px-2.5 py-1 text-xs transition-colors",
              item.enabled
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-border/70 bg-background/80 text-muted-foreground",
            ].join(" ")}
          >
            {item.label}
          </span>
        ))}
      </div>
      {toolPreferences.subagent ? (
        <div className="mb-3 rounded-xl border border-border/70 bg-background/80 px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">当前 Team</span>
          <span>
            {" "}
            ·{" "}
            {selectedTeamSummary?.trim() ||
              (hasSelectedTeam
                ? `已配置 ${selectedTeamRoleCount} 个角色，运行时可按需委派。`
                : "已开启 Team mode，本轮可选择或自定义 Team。")}
          </span>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {statusItems.map((item) => (
          <Badge key={item.key} variant={item.tone || "outline"}>
            {item.label}
          </Badge>
        ))}
      </div>
    </div>
  );
};

export default AgentRuntimeStrip;
