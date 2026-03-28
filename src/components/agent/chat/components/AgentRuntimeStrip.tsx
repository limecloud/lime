import React, { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import type {
  AsterSessionExecutionRuntime,
  AsterSubagentSessionInfo,
} from "@/lib/api/agentRuntime";

import type { ChatToolPreferences } from "../utils/chatToolPreferences";
import type { CompatSubagentRuntimeStatus } from "../utils/compatSubagentRuntime";
import type { HarnessSessionState } from "../utils/harnessState";
import {
  getExecutionRuntimeDisplayLabel,
  getOutputSchemaRuntimeLabel,
} from "../utils/sessionExecutionRuntime";

interface AgentRuntimeStripProps {
  activeTheme?: string;
  toolPreferences: ChatToolPreferences;
  harnessState: HarnessSessionState;
  childSubagentSessions?: AsterSubagentSessionInfo[];
  compatSubagentRuntime: CompatSubagentRuntimeStatus;
  variant?: "standalone" | "embedded";
  isSending?: boolean;
  executionRuntime?: AsterSessionExecutionRuntime | null;
  isExecutionRuntimeActive?: boolean;
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
  executionRuntime = null,
  isExecutionRuntimeActive = false,
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
    const executionRuntimeLabel = getExecutionRuntimeDisplayLabel(
      executionRuntime,
      { active: isExecutionRuntimeActive },
    );
    const outputSchemaLabel = getOutputSchemaRuntimeLabel(
      executionRuntime?.output_schema_runtime,
    );
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
        label: runtimeStatusTitle || "正在准备处理",
        tone: "secondary",
      });
    }

    if (executionRuntimeLabel) {
      nextItems.push({
        key: "execution_runtime",
        label: executionRuntimeLabel,
        tone: isExecutionRuntimeActive ? "secondary" : "outline",
      });
    }

    if (outputSchemaLabel) {
      nextItems.push({
        key: "output_schema_runtime",
        label: `结构化输出 ${outputSchemaLabel}`,
        tone: "outline",
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
            ? `协作处理中 ${activeTeamSessions}/${childSubagentSessions.length} · 稍后开始 ${queuedTeamSessions}`
            : `协作处理中 ${activeTeamSessions}/${childSubagentSessions.length}`,
        tone: "secondary",
      });
    } else if (childSubagentSessions.length > 0) {
      nextItems.push({
        key: "team_sessions",
        label:
          completedTeamSessions > 0
            ? `协作会话 ${childSubagentSessions.length} · 已完成 ${completedTeamSessions}`
            : `协作会话 ${childSubagentSessions.length}`,
        tone: "outline",
      });
    } else if (compatSubagentRuntime.isRunning) {
      const progressLabel =
        compatSubagentRuntime.progress &&
        typeof compatSubagentRuntime.progress.completed === "number" &&
        typeof compatSubagentRuntime.progress.total === "number"
          ? `协作成员处理中 ${compatSubagentRuntime.progress.completed}/${compatSubagentRuntime.progress.total}`
          : "协作成员处理中";
      nextItems.push({
        key: "subagent_running",
        label: progressLabel,
        tone: "secondary",
      });
    } else if (harnessState.delegatedTasks.length > 0) {
      nextItems.push({
        key: "delegated",
        label: `最近协作 ${harnessState.delegatedTasks.length}`,
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
        label: "当前会先直接回答，必要时再调用更多能力",
        tone: "outline",
      });
    }

    return nextItems;
  }, [
    childSubagentSessions,
    compatSubagentRuntime.isRunning,
    compatSubagentRuntime.progress,
    executionRuntime,
    harnessState,
    isExecutionRuntimeActive,
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
        <div className="text-sm font-medium text-foreground">通用助手</div>
        <Badge variant="outline">{themeLabel}</Badge>
        {toolPreferences.subagent ? (
          <Badge variant={hasSelectedTeam ? "secondary" : "outline"}>
            {hasSelectedTeam
              ? `协作 · ${selectedTeamLabel || `${selectedTeamRoleCount} 角色`}`
              : "协作模式"}
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
          <span className="font-medium text-foreground">当前协作设置</span>
          <span>
            {" "}
            ·{" "}
            {selectedTeamSummary?.trim() ||
              (hasSelectedTeam
                ? `已配置 ${selectedTeamRoleCount} 个角色，系统会按需邀请协作成员。`
                : "已开启协作模式，本次可选择或自定义协作方案。")}
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
