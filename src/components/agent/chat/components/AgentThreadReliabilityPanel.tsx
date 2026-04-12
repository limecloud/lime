import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Clock3,
  Copy,
  ListTodo,
  Loader2,
  PauseCircle,
  PlayCircle,
  Waves,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  prefetchContextMemoryForTurn,
  type TurnMemoryPrefetchResult,
} from "@/lib/api/memoryRuntime";
import {
  buildTeamMemoryShadowRequestMetadata,
  type TeamMemorySnapshot,
} from "@/lib/teamMemorySync";
import {
  assessRuntimeMemoryPrefetchHistoryDiff,
  compareRuntimeMemoryPrefetchHistoryEntries,
  describeRuntimeMemoryPrefetchHistoryDiffAssessment,
  formatRuntimeMemoryPrefetchHistoryDiffStatusLabel,
  recordRuntimeMemoryPrefetchHistory,
  type RuntimeMemoryPrefetchHistoryDiff,
  type RuntimeMemoryPrefetchHistoryDiffAssessment,
  type RuntimeMemoryPrefetchHistoryEntry,
} from "@/lib/runtimeMemoryPrefetchHistory";
import { cn } from "@/lib/utils";
import type {
  AgentRuntimeThreadReadModel,
  QueuedTurnSnapshot,
} from "@/lib/api/agentRuntime";
import type {
  ActionRequired,
  AgentThreadItem,
  AgentThreadTurn,
  Message,
} from "../types";
import type { HarnessSessionState } from "../utils/harnessState";
import {
  buildThreadReliabilityView,
  type ThreadReliabilityTone,
} from "../utils/threadReliabilityView";
import { AgentIncidentPanel } from "./AgentIncidentPanel";
import { AgentThreadMemoryPrefetchPreview } from "./AgentThreadMemoryPrefetchPreview";
import { AgentThreadOutcomeSummary } from "./AgentThreadOutcomeSummary";

interface AgentThreadReliabilityDiagnosticContext {
  sessionId?: string | null;
  workspaceId?: string | null;
  workingDir?: string | null;
  providerType?: string | null;
  model?: string | null;
  executionStrategy?: string | null;
  activeTheme?: string | null;
  selectedTeamLabel?: string | null;
}

interface AgentThreadReliabilityPanelProps {
  threadRead?: AgentRuntimeThreadReadModel | null;
  turns?: AgentThreadTurn[];
  threadItems?: AgentThreadItem[];
  currentTurnId?: string | null;
  pendingActions?: ActionRequired[];
  submittedActionsInFlight?: ActionRequired[];
  queuedTurns?: QueuedTurnSnapshot[];
  canInterrupt?: boolean;
  onInterruptCurrentTurn?: () => void | Promise<void>;
  onResumeThread?: () => boolean | Promise<boolean>;
  onReplayPendingRequest?: (requestId: string) => boolean | Promise<boolean>;
  onLocatePendingRequest?: (requestId: string) => void;
  onPromoteQueuedTurn?: (queuedTurnId: string) => boolean | Promise<boolean>;
  onOpenMemoryWorkbench?: () => void;
  className?: string;
  harnessState?: HarnessSessionState | null;
  messages?: Message[];
  teamMemorySnapshot?: TeamMemorySnapshot | null;
  diagnosticRuntimeContext?: AgentThreadReliabilityDiagnosticContext | null;
}

interface RuntimeMemoryPrefetchState {
  status: "idle" | "loading" | "ready" | "error";
  result: TurnMemoryPrefetchResult | null;
  error: string | null;
}

interface RuntimeMemoryPrefetchComparisonState {
  baselineEntry: RuntimeMemoryPrefetchHistoryEntry | null;
  diff: RuntimeMemoryPrefetchHistoryDiff | null;
  assessment: RuntimeMemoryPrefetchHistoryDiffAssessment | null;
}

function serializeClipboardPayload(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, item) => (item instanceof Date ? item.toISOString() : item),
    2,
  );
}

function normalizeDiagnosticText(value?: string | null): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function truncateDiagnosticText(
  value?: string | null,
  maxLength = 240,
): string {
  const normalized = normalizeDiagnosticText(value);
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function parseDiagnosticDate(value?: string | number | null): Date | null {
  if (typeof value === "number") {
    const normalizedValue = value > 10_000_000_000 ? value : value * 1000;
    const date = new Date(normalizedValue);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

function formatDiagnosticDateTime(value?: string | number | null): string | null {
  const date = parseDiagnosticDate(value);
  if (!date) {
    return null;
  }

  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function summarizeThreadItemSignals(threadItems: AgentThreadItem[]) {
  const warningItems = threadItems.filter((item) => item.type === "warning");
  const contextCompactionItems = threadItems.filter(
    (item) => item.type === "context_compaction",
  );
  const failedToolCalls = threadItems.filter(
    (item): item is Extract<AgentThreadItem, { type: "tool_call" }> =>
      item.type === "tool_call" &&
      (item.status === "failed" || item.success === false),
  );

  return {
    warningCount: warningItems.length,
    contextCompactionCount: contextCompactionItems.length,
    failedToolCallCount: failedToolCalls.length,
    latestWarnings: warningItems.slice(-3).map((item) => ({
      id: item.id,
      code: item.code || null,
      message: truncateDiagnosticText(item.message, 180),
      status: item.status,
      updated_at: item.updated_at,
    })),
    latestCompactions: contextCompactionItems.slice(-3).map((item) => ({
      id: item.id,
      stage: item.stage,
      trigger: item.trigger || null,
      detail: truncateDiagnosticText(item.detail, 180),
      status: item.status,
      updated_at: item.updated_at,
    })),
    latestFailedTools: failedToolCalls.slice(-3).map((item) => ({
      id: item.id,
      tool_name: item.tool_name,
      error: truncateDiagnosticText(item.error, 180),
      updated_at: item.updated_at,
    })),
  };
}

function summarizeRecentMessages(messages: Message[]) {
  return messages.slice(-6).map((message) => ({
    id: message.id,
    role: message.role,
    timestamp:
      message.timestamp instanceof Date
        ? message.timestamp.toISOString()
        : String(message.timestamp),
    content_preview: truncateDiagnosticText(message.content, 320),
    runtime_status: message.runtimeStatus
      ? {
          phase: message.runtimeStatus.phase,
          title: message.runtimeStatus.title,
          detail: truncateDiagnosticText(message.runtimeStatus.detail, 180),
          checkpoints: message.runtimeStatus.checkpoints?.slice(0, 4) || [],
        }
      : null,
    action_request_count: message.actionRequests?.length || 0,
    action_request_titles:
      message.actionRequests
        ?.slice(0, 3)
        .map((request) =>
          truncateDiagnosticText(
            request.prompt || request.toolName || request.requestId,
            120,
          ),
        ) || [],
    tool_calls:
      message.toolCalls?.slice(0, 4).map((toolCall) => ({
        id: toolCall.id,
        name: toolCall.name,
        status: toolCall.status,
        error: truncateDiagnosticText(toolCall.result?.error, 120),
      })) || [],
    context_trace:
      message.contextTrace?.slice(-3).map((step) => ({
        stage: step.stage,
        detail: truncateDiagnosticText(step.detail, 120),
      })) || [],
    artifact_titles:
      message.artifacts?.slice(0, 4).map((artifact) => artifact.title) || [],
  }));
}

function summarizeHarnessState(harnessState?: HarnessSessionState | null) {
  if (!harnessState) {
    return null;
  }

  return {
    runtime_status: harnessState.runtimeStatus
      ? {
          phase: harnessState.runtimeStatus.phase,
          title: harnessState.runtimeStatus.title,
          detail: truncateDiagnosticText(
            harnessState.runtimeStatus.detail,
            220,
          ),
          checkpoints:
            harnessState.runtimeStatus.checkpoints?.slice(0, 6) || [],
          metadata: harnessState.runtimeStatus.metadata || null,
        }
      : null,
    plan: {
      phase: harnessState.plan.phase,
      summary_text: truncateDiagnosticText(harnessState.plan.summaryText, 220),
      items: harnessState.plan.items.slice(0, 6),
    },
    activity: harnessState.activity,
    pending_approvals_count: harnessState.pendingApprovals.length,
    latest_context_trace:
      harnessState.latestContextTrace.slice(-5).map((step) => ({
        stage: step.stage,
        detail: truncateDiagnosticText(step.detail, 160),
      })) || [],
    delegated_tasks: harnessState.delegatedTasks.slice(0, 6).map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      task_type: task.taskType || null,
      role: task.role || null,
      model: task.model || null,
      summary: truncateDiagnosticText(task.summary, 160),
    })),
    output_signals: harnessState.outputSignals.slice(0, 8).map((signal) => ({
      id: signal.id,
      tool_name: signal.toolName,
      title: signal.title,
      summary: truncateDiagnosticText(signal.summary, 180),
      preview: truncateDiagnosticText(signal.preview, 180),
      output_file: signal.outputFile || null,
      offload_file: signal.offloadFile || null,
      artifact_path: signal.artifactPath || null,
      exit_code: signal.exitCode,
      truncated: signal.truncated || false,
      offloaded: signal.offloaded || false,
    })),
    active_file_writes: harnessState.activeFileWrites
      .slice(0, 6)
      .map((write) => ({
        id: write.id,
        path: write.path,
        display_name: write.displayName,
        phase: write.phase,
        status: write.status,
        preview: truncateDiagnosticText(
          write.preview || write.latestChunk,
          160,
        ),
      })),
    recent_file_events: harnessState.recentFileEvents
      .slice(0, 8)
      .map((event) => ({
        id: event.id,
        path: event.path,
        display_name: event.displayName,
        kind: event.kind,
        action: event.action,
        source_tool_name: event.sourceToolName,
        preview: truncateDiagnosticText(event.preview, 140),
      })),
  };
}

function resolveToneClassName(tone: ThreadReliabilityTone) {
  switch (tone) {
    case "running":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "waiting":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "completed":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "failed":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "paused":
      return "border-slate-200 bg-slate-50 text-slate-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
}

function resolveStatShellClassName(tone: ThreadReliabilityTone) {
  switch (tone) {
    case "running":
      return "border-sky-200/80 bg-sky-50";
    case "waiting":
      return "border-amber-200/80 bg-amber-50";
    case "completed":
      return "border-emerald-200/80 bg-emerald-50";
    case "failed":
      return "border-rose-200/80 bg-rose-50";
    case "paused":
      return "border-slate-200/80 bg-slate-50";
    default:
      return "border-slate-200/80 bg-slate-50";
  }
}

function buildMemoryPrefetchDiagnosticLines(
  memoryPrefetchState?: RuntimeMemoryPrefetchState,
): string[] {
  if (memoryPrefetchState?.result) {
    const prefetch = memoryPrefetchState.result;
    const sections = [
      `- 规则层：${prefetch.rules_source_paths.length} 个来源`,
      `- 工作层：${prefetch.working_memory_excerpt ? "已命中" : "未命中"}`,
      `- 持久层：${prefetch.durable_memories.length} 条`,
      `- 任务影子层：${prefetch.team_memory_entries.length} 条`,
      `- 压缩层：${prefetch.latest_compaction ? "已命中" : "未命中"}`,
    ];

    if (prefetch.rules_source_paths.length > 0) {
      sections.push(
        `- 规则来源：${prefetch.rules_source_paths
          .slice(0, 3)
          .map((path) => truncateDiagnosticText(path, 120))
          .join("｜")}`,
      );
    }
    if (prefetch.working_memory_excerpt) {
      sections.push(
        `- 工作记忆摘录：${truncateDiagnosticText(prefetch.working_memory_excerpt, 220)}`,
      );
    }
    if (prefetch.durable_memories.length > 0) {
      sections.push(
        `- 持久记忆命中：${prefetch.durable_memories
          .slice(0, 3)
          .map((entry) => entry.title)
          .join("｜")}`,
      );
      sections.push(
        `- 持久记忆详情：${prefetch.durable_memories
          .slice(0, 3)
          .map(
            (entry) =>
              `${truncateDiagnosticText(entry.title, 80)}｜${truncateDiagnosticText(entry.summary, 120)}`,
          )
          .join(" || ")}`,
      );
    }
    if (prefetch.team_memory_entries.length > 0) {
      sections.push(
        `- 任务影子键：${prefetch.team_memory_entries
          .slice(0, 3)
          .map((entry) => entry.key)
          .join("｜")}`,
      );
      sections.push(
        `- 任务影子详情：${prefetch.team_memory_entries
          .slice(0, 3)
          .map(
            (entry) =>
              `${truncateDiagnosticText(entry.key, 80)}｜${truncateDiagnosticText(entry.content, 120)}`,
          )
          .join(" || ")}`,
      );
    }
    if (prefetch.latest_compaction) {
      sections.push(
        `- 压缩命中摘要：${truncateDiagnosticText(prefetch.latest_compaction.summary_preview, 180)}`,
      );
      sections.push(
        `- 压缩命中元数据：触发=${prefetch.latest_compaction.trigger || "未知"}｜覆盖回合=${prefetch.latest_compaction.turn_count ?? "未知"}`,
      );
    }
    if (prefetch.prompt) {
      sections.push(
        `- 运行时记忆片段：${truncateDiagnosticText(prefetch.prompt, 220)}`,
      );
    }

    return sections;
  }

  if (memoryPrefetchState?.status === "loading") {
    return ["- 正在按当前回合最新 prompt 预演五层记忆命中"];
  }

  if (memoryPrefetchState?.error) {
    return [`- 失败：${memoryPrefetchState.error}`];
  }

  return ["- 无"];
}

function resolveMemoryPrefetchHistorySourceLabel(
  source: RuntimeMemoryPrefetchHistoryEntry["source"],
): string {
  return source === "thread_reliability" ? "线程面板" : "记忆工作台";
}

function resolveMemoryPrefetchPreviewChangeLabel(
  change: RuntimeMemoryPrefetchHistoryDiff["previewChanges"][number],
): string {
  switch (change.key) {
    case "rule":
      return `规则来源 ${change.previous || "无"} -> ${change.current || "无"}`;
    case "working":
      return `工作摘录 ${change.previous || "无"} -> ${change.current || "无"}`;
    case "durable":
      return `长期记忆 ${change.previous || "无"} -> ${change.current || "无"}`;
    case "team":
      return `任务影子 ${change.previous || "无"} -> ${change.current || "无"}`;
    case "compaction":
      return `压缩摘要 ${change.previous || "无"} -> ${change.current || "无"}`;
    case "user_message":
      return `输入 ${change.previous || "无"} -> ${change.current || "无"}`;
    default:
      return `${change.previous || "无"} -> ${change.current || "无"}`;
  }
}

function resolveMemoryPrefetchAssessmentBadgeClassName(
  assessment: RuntimeMemoryPrefetchHistoryDiffAssessment,
): string {
  switch (assessment.status) {
    case "stronger":
      return "border-emerald-200 bg-white text-emerald-700";
    case "weaker":
      return "border-amber-200 bg-white text-amber-700";
    case "mixed":
      return "border-sky-200 bg-white text-sky-700";
    case "same":
    default:
      return "border-slate-200 bg-white text-slate-700";
  }
}

function resolveMemoryPrefetchComparison(
  entries: RuntimeMemoryPrefetchHistoryEntry[],
  currentWorkingDir: string,
): RuntimeMemoryPrefetchComparisonState {
  const currentEntry = entries[0];
  if (!currentEntry) {
    return {
      baselineEntry: null,
      diff: null,
      assessment: null,
    };
  }

  const normalizedCurrentWorkingDir =
    currentWorkingDir.trim().replace(/\\/g, "/").replace(/\/+$/u, "");
  const candidates = entries.slice(1);
  const baselineEntry =
    candidates.find((entry) => entry.sessionId === currentEntry.sessionId) ||
    candidates.find(
      (entry) =>
        entry.workingDir.replace(/\\/g, "/").replace(/\/+$/u, "") ===
        normalizedCurrentWorkingDir,
    ) ||
    candidates[0] ||
    null;
  const diff = baselineEntry
    ? compareRuntimeMemoryPrefetchHistoryEntries(currentEntry, baselineEntry)
    : null;

  return {
    baselineEntry,
    diff,
    assessment: diff ? assessRuntimeMemoryPrefetchHistoryDiff(diff) : null,
  };
}

function buildReliabilityDiagnosticText(params: {
  threadRead?: AgentRuntimeThreadReadModel | null;
  statusLabel: string;
  summary: string;
  view: ReturnType<typeof buildThreadReliabilityView>;
  threadItems: AgentThreadItem[];
  messages: Message[];
  harnessState?: HarnessSessionState | null;
  memoryPrefetchState?: RuntimeMemoryPrefetchState;
  memoryPrefetchComparison?: RuntimeMemoryPrefetchComparisonState;
  diagnosticRuntimeContext?: AgentThreadReliabilityDiagnosticContext | null;
}): string {
  const {
    threadRead,
    statusLabel,
    summary,
    view,
    threadItems,
    messages,
    harnessState,
    memoryPrefetchState,
    memoryPrefetchComparison,
    diagnosticRuntimeContext,
  } = params;
  const threadItemSignals = summarizeThreadItemSignals(threadItems);
  const recentMessages = summarizeRecentMessages(messages);
  const sections: string[] = [
    "# Lime 线程可靠性诊断任务",
    "",
    "你现在是一名 AI 任务可靠性分析助手。请基于下面的线程可靠性数据，判断这次任务执行得好不好；如果执行不好，请找出根因，并给出可落地的修复建议。",
    "",
    "如果“后端诊断聚合”与前端界面信号存在冲突，请优先以后端诊断聚合作为高可信事实源，再结合其他上下文判断。",
    "",
    "请重点回答以下问题：",
    "1. 这次任务整体表现属于：好 / 一般 / 差？请先给结论。",
    "2. 直接导致中断、失败、等待或漂移的主要原因是什么？",
    "3. 这是模型能力问题、Prompt/规划问题、工具问题、上下文问题、人工阻塞问题，还是产品交互问题？可多选，但要说明主次。",
    "4. 哪些问题是一次性偶发，哪些问题是系统性缺陷？",
    "5. 如果要优先修复，只做 1~3 件事，应该做什么？请按优先级排序。",
    "6. 如果当前信息还不足，请明确指出还缺哪些日志、埋点或上下文。",
    "",
    "请按以下结构输出：",
    "## 结论",
    "## 根因分析",
    "## 问题归类",
    "## 修复建议",
    "## 还缺少的信息",
    "",
    "---",
    "",
    "## 诊断数据",
    "",
    "### 运行环境",
    `- 会话 ID：${diagnosticRuntimeContext?.sessionId || "未知"}`,
    `- 工作区 ID：${diagnosticRuntimeContext?.workspaceId || "未知"}`,
    `- Provider：${diagnosticRuntimeContext?.providerType || "未知"}`,
    `- 模型：${diagnosticRuntimeContext?.model || "未知"}`,
    `- 执行策略：${diagnosticRuntimeContext?.executionStrategy || "未知"}`,
    `- 主题：${diagnosticRuntimeContext?.activeTheme || "未知"}`,
    `- 任务方案：${diagnosticRuntimeContext?.selectedTeamLabel || "未设置"}`,
    `- 工作区根目录：${diagnosticRuntimeContext?.workingDir || "未知"}`,
    "",
    "### 当前状态",
    `- 状态：${statusLabel}`,
    `- 当前回合：${view.activeTurnLabel || "未知"}`,
    `- 摘要：${summary}`,
    `- 最近刷新：${view.updatedAtLabel || "未知"}`,
    `- 中断状态：${view.interruptStateLabel || "无"}`,
    "",
    "### 核心指标",
    `- 待处理请求：${view.pendingRequestCount}`,
    `- 活跃 Incident：${view.activeIncidentCount}`,
    `- 排队回合：${view.queuedTurnCount}`,
    "",
    "### 线程项信号",
    `- warning 数量：${threadItemSignals.warningCount}`,
    `- context compaction 数量：${threadItemSignals.contextCompactionCount}`,
    `- 失败工具调用数量：${threadItemSignals.failedToolCallCount}`,
    "",
    "### Harness 过程信号",
    `- runtimeStatus：${harnessState?.runtimeStatus?.title || "无"}`,
    `- plan phase：${harnessState?.plan.phase || "无"}`,
    `- plan items：${harnessState?.plan.items.length || 0}`,
    `- output signals：${harnessState?.outputSignals.length || 0}`,
    `- active file writes：${harnessState?.activeFileWrites.length || 0}`,
    `- recent file events：${harnessState?.recentFileEvents.length || 0}`,
    `- delegated tasks：${harnessState?.delegatedTasks.length || 0}`,
    `- context trace steps：${harnessState?.latestContextTrace.length || 0}`,
    "",
    "### 待处理请求",
  ];

  if (view.pendingRequests.length > 0) {
    for (const request of view.pendingRequests) {
      sections.push(
        `- ${request.title}｜${request.typeLabel}｜${request.statusLabel}${request.waitingLabel ? `｜${request.waitingLabel}` : ""}`,
      );
    }
  } else {
    sections.push("- 无");
  }

  sections.push("", "### 已提交待继续的请求");
  if (view.submittedRequests.length > 0) {
    for (const request of view.submittedRequests) {
      sections.push(
        `- ${request.title}｜${request.typeLabel}｜${request.statusLabel}`,
      );
    }
  } else {
    sections.push("- 无");
  }

  sections.push("", "### Incident");
  if (view.incidents.length > 0) {
    for (const incident of view.incidents) {
      sections.push(
        `- ${incident.title}｜${incident.incidentType}｜${incident.severityLabel}｜${incident.statusLabel}${incident.detail ? `｜${incident.detail}` : ""}`,
      );
    }
  } else {
    sections.push("- 无");
  }

  sections.push("", "### 最近结果");
  if (view.outcome) {
    sections.push(`- 标签：${view.outcome.label}`);
    sections.push(`- 摘要：${view.outcome.summary}`);
    sections.push(`- 主因：${view.outcome.primaryCause || "未知"}`);
    sections.push(`- 可重试：${view.outcome.retryable ? "是" : "否"}`);
    sections.push(`- 结束时间：${view.outcome.endedAtLabel || "未知"}`);
  } else {
    sections.push("- 无稳定 outcome");
  }

  sections.push("", "### 下一条排队回合");
  if (view.nextQueuedTurn) {
    sections.push(
      `- ${view.nextQueuedTurn.title}${view.nextQueuedTurn.positionLabel ? `｜${view.nextQueuedTurn.positionLabel}` : ""}`,
    );
  } else {
    sections.push("- 无");
  }

  sections.push("", "### 当前建议");
  if (view.recommendations.length > 0) {
    for (const recommendation of view.recommendations) {
      sections.push(`- ${recommendation}`);
    }
  } else {
    sections.push("- 暂无额外建议");
  }

  sections.push("", "### 最近 warning");
  if (threadItemSignals.latestWarnings.length > 0) {
    for (const warning of threadItemSignals.latestWarnings) {
      sections.push(
        `- ${warning.code || "warning"}｜${warning.message || "无消息"}｜${warning.status}`,
      );
    }
  } else {
    sections.push("- 无");
  }

  sections.push("", "### 最近 context compaction");
  if (threadItemSignals.latestCompactions.length > 0) {
    for (const compaction of threadItemSignals.latestCompactions) {
      sections.push(
        `- ${compaction.stage}｜${compaction.trigger || "未知触发"}｜${compaction.detail || "无详情"}`,
      );
    }
  } else {
    sections.push("- 无");
  }

  sections.push("", "### 最近压缩边界");
  if (threadRead?.latest_compaction_boundary) {
    const boundary = threadRead.latest_compaction_boundary;
    sections.push(`- 生成时间：${boundary.created_at || "未知"}`);
    sections.push(`- 覆盖回合数：${boundary.turn_count ?? "未知"}`);
    sections.push(`- 触发原因：${boundary.trigger || "未知"}`);
    sections.push(
      `- 边界摘要：${boundary.summary_preview || "无摘要预览"}`,
    );
    sections.push(`- 压缩备注：${boundary.detail || "无"}`);
  } else {
    sections.push("- 无");
  }

  sections.push("", "### 当前回合记忆预取");
  sections.push(...buildMemoryPrefetchDiagnosticLines(memoryPrefetchState));

  sections.push("", "### 相对最近基线的记忆变化");
  if (memoryPrefetchComparison?.baselineEntry && memoryPrefetchComparison.diff) {
    sections.push(
      `- 基线来源：${resolveMemoryPrefetchHistorySourceLabel(memoryPrefetchComparison.baselineEntry.source)}`,
    );
    sections.push(
      `- 基线输入：${memoryPrefetchComparison.baselineEntry.userMessage || "无"}`,
    );
    sections.push(
      `- 基线摘要：${truncateDiagnosticText(
        memoryPrefetchComparison.baselineEntry.preview.durableTitle ||
          memoryPrefetchComparison.baselineEntry.preview.workingExcerpt ||
          memoryPrefetchComparison.baselineEntry.preview.compactionSummary ||
          memoryPrefetchComparison.baselineEntry.preview.firstRuleSourcePath ||
          memoryPrefetchComparison.baselineEntry.preview.teamKey,
        180,
      ) || "无"}`,
    );
    if (memoryPrefetchComparison.assessment) {
      sections.push(
        `- 对照判断：${formatRuntimeMemoryPrefetchHistoryDiffStatusLabel(memoryPrefetchComparison.assessment.status)}`,
      );
      sections.push(
        `- 对照结论：${describeRuntimeMemoryPrefetchHistoryDiffAssessment(memoryPrefetchComparison.assessment)}`,
      );
    }
    if (memoryPrefetchComparison.diff.changed) {
      sections.push(
        `- 层变化：规则 ${memoryPrefetchComparison.diff.layerChanges.rulesDelta >= 0 ? "+" : ""}${memoryPrefetchComparison.diff.layerChanges.rulesDelta}｜工作 ${memoryPrefetchComparison.diff.layerChanges.workingChanged}｜持久 ${memoryPrefetchComparison.diff.layerChanges.durableDelta >= 0 ? "+" : ""}${memoryPrefetchComparison.diff.layerChanges.durableDelta}｜任务影子 ${memoryPrefetchComparison.diff.layerChanges.teamDelta >= 0 ? "+" : ""}${memoryPrefetchComparison.diff.layerChanges.teamDelta}｜压缩 ${memoryPrefetchComparison.diff.layerChanges.compactionChanged}`,
      );
      if (memoryPrefetchComparison.diff.previewChanges.length > 0) {
        sections.push(
          `- 摘要变化：${memoryPrefetchComparison.diff.previewChanges
            .slice(0, 4)
            .map((change) => resolveMemoryPrefetchPreviewChangeLabel(change))
            .join(" || ")}`,
        );
      }
    } else {
      sections.push("- 与最近基线相比没有明显变化");
    }
  } else {
    sections.push("- 暂无可对照的历史基线");
  }

  sections.push("", "### 后端诊断聚合");
  if (threadRead?.diagnostics) {
    const diagnostics = threadRead.diagnostics;
    sections.push(
      `- 最新回合状态：${diagnostics.latest_turn_status || "未知"}`,
    );
    sections.push(
      `- 最新回合开始时间：${diagnostics.latest_turn_started_at || "未知"}`,
    );
    sections.push(
      `- 最新回合结束时间：${diagnostics.latest_turn_completed_at || "未知"}`,
    );
    sections.push(
      `- 最新回合更新时间：${diagnostics.latest_turn_updated_at || "未知"}`,
    );
    sections.push(
      `- 最新回合累计耗时（秒）：${diagnostics.latest_turn_elapsed_seconds ?? "未知"}`,
    );
    sections.push(
      `- 最新回合停滞时长（秒）：${diagnostics.latest_turn_stalled_seconds ?? "无"}`,
    );
    sections.push(
      `- 最新回合错误：${diagnostics.latest_turn_error_message || "无"}`,
    );
    sections.push(`- 中断原因：${diagnostics.interrupt_reason || "未知"}`);
    sections.push(
      `- 中断来源：${diagnostics.runtime_interrupt_source || "未知"}`,
    );
    sections.push(
      `- 中断请求时间：${diagnostics.runtime_interrupt_requested_at || "未知"}`,
    );
    sections.push(
      `- 中断请求后等待时长（秒）：${diagnostics.runtime_interrupt_wait_seconds ?? "无"}`,
    );
    sections.push(`- 后端 warning 数量：${diagnostics.warning_count}`);
    sections.push(
      `- 后端 context compaction 数量：${diagnostics.context_compaction_count}`,
    );
    sections.push(
      `- 后端失败工具调用数量：${diagnostics.failed_tool_call_count}`,
    );
    sections.push(`- 后端失败命令数量：${diagnostics.failed_command_count}`);
    sections.push(`- 后端待处理请求数量：${diagnostics.pending_request_count}`);
    sections.push(
      `- 最老待处理请求等待时长（秒）：${diagnostics.oldest_pending_request_wait_seconds ?? "无"}`,
    );
    sections.push(
      `- 主阻塞类型：${diagnostics.primary_blocking_kind || "未知"}`,
    );
    sections.push(
      `- 主阻塞摘要：${diagnostics.primary_blocking_summary || "未知"}`,
    );
    sections.push(
      `- 最近 warning：${
        diagnostics.latest_warning
          ? `${diagnostics.latest_warning.code || "warning"}｜${diagnostics.latest_warning.message}`
          : "无"
      }`,
    );
    sections.push(
      `- 最近 context compaction：${
        diagnostics.latest_context_compaction
          ? `${diagnostics.latest_context_compaction.stage}｜${diagnostics.latest_context_compaction.trigger || "未知触发"}｜${diagnostics.latest_context_compaction.detail || "无详情"}`
          : "无"
      }`,
    );
    sections.push(
      `- 最近失败工具：${
        diagnostics.latest_failed_tool
          ? `${diagnostics.latest_failed_tool.tool_name}｜${diagnostics.latest_failed_tool.error || "无错误详情"}`
          : "无"
      }`,
    );
    sections.push(
      `- 最近失败命令：${
        diagnostics.latest_failed_command
          ? `${diagnostics.latest_failed_command.command}｜exit=${diagnostics.latest_failed_command.exit_code ?? "未知"}｜${diagnostics.latest_failed_command.error || "无错误详情"}`
          : "无"
      }`,
    );
    sections.push(
      `- 最近待处理请求：${
        diagnostics.latest_pending_request
          ? `${diagnostics.latest_pending_request.request_type}｜${diagnostics.latest_pending_request.title || diagnostics.latest_pending_request.request_id}｜等待 ${diagnostics.latest_pending_request.waited_seconds ?? "未知"} 秒`
          : "无"
      }`,
    );
  } else {
    sections.push("- 无");
  }

  sections.push("", "### 最近消息片段");
  if (recentMessages.length > 0) {
    for (const message of recentMessages) {
      sections.push(
        `- ${message.role}｜${message.timestamp}｜${message.content_preview || "<空>"}`,
      );
    }
  } else {
    sections.push("- 无");
  }

  return sections.join("\n");
}

function buildReliabilityRawPayload(params: {
  threadRead?: AgentRuntimeThreadReadModel | null;
  turns: AgentThreadTurn[];
  threadItems: AgentThreadItem[];
  currentTurnId?: string | null;
  pendingActions: ActionRequired[];
  submittedActionsInFlight: ActionRequired[];
  queuedTurns: QueuedTurnSnapshot[];
  view: ReturnType<typeof buildThreadReliabilityView>;
  harnessState?: HarnessSessionState | null;
  messages: Message[];
  memoryPrefetchState?: RuntimeMemoryPrefetchState;
  memoryPrefetchComparison?: RuntimeMemoryPrefetchComparisonState;
  diagnosticRuntimeContext?: AgentThreadReliabilityDiagnosticContext | null;
}): Record<string, unknown> {
  return {
    exported_at: new Date().toISOString(),
    runtime_context: params.diagnosticRuntimeContext || null,
    backend_diagnostics: params.threadRead?.diagnostics || null,
    latest_compaction_boundary:
      params.threadRead?.latest_compaction_boundary || null,
    memory_prefetch_preview: params.memoryPrefetchState?.result || null,
    memory_prefetch_error: params.memoryPrefetchState?.error || null,
    memory_prefetch_comparison: params.memoryPrefetchComparison
      ? {
          baseline_entry: params.memoryPrefetchComparison.baselineEntry,
          diff: params.memoryPrefetchComparison.diff,
          assessment: params.memoryPrefetchComparison.assessment,
        }
      : null,
    current_turn_id: params.currentTurnId || null,
    thread_read: params.threadRead || null,
    turns: params.turns,
    thread_items: params.threadItems,
    pending_actions: params.pendingActions,
    submitted_actions_in_flight: params.submittedActionsInFlight,
    queued_turns: params.queuedTurns,
    harness_state: summarizeHarnessState(params.harnessState),
    recent_messages: summarizeRecentMessages(params.messages),
    thread_item_signals: summarizeThreadItemSignals(params.threadItems),
    reliability_view: params.view,
  };
}

export const AgentThreadReliabilityPanel: React.FC<
  AgentThreadReliabilityPanelProps
> = ({
  threadRead,
  turns = [],
  threadItems = [],
  currentTurnId = null,
  pendingActions = [],
  submittedActionsInFlight = [],
  queuedTurns = [],
  canInterrupt = false,
  onInterruptCurrentTurn,
  onResumeThread,
  onReplayPendingRequest,
  onLocatePendingRequest,
  onPromoteQueuedTurn,
  onOpenMemoryWorkbench,
  className,
  harnessState = null,
  messages = [],
  teamMemorySnapshot = null,
  diagnosticRuntimeContext = null,
}) => {
  const [isInterrupting, setIsInterrupting] = useState(false);
  const [isResumingThread, setIsResumingThread] = useState(false);
  const [isReplayingRequest, setIsReplayingRequest] = useState(false);
  const [isPromotingQueuedTurn, setIsPromotingQueuedTurn] = useState(false);
  const [memoryPrefetchState, setMemoryPrefetchState] =
    useState<RuntimeMemoryPrefetchState>({
      status: "idle",
      result: null,
      error: null,
    });
  const [memoryPrefetchComparison, setMemoryPrefetchComparison] =
    useState<RuntimeMemoryPrefetchComparisonState>({
      baselineEntry: null,
      diff: null,
      assessment: null,
    });
  const view = useMemo(
    () =>
      buildThreadReliabilityView({
        threadRead,
        turns,
        threadItems,
        currentTurnId,
        pendingActions,
        submittedActionsInFlight,
        queuedTurns,
      }),
    [
      currentTurnId,
      pendingActions,
      queuedTurns,
      submittedActionsInFlight,
      threadItems,
      threadRead,
      turns,
    ],
  );
  const statusLabel = isInterrupting ? "中断中" : view.statusLabel;
  const statusTone = isInterrupting ? "paused" : view.statusTone;
  const summary = isInterrupting
    ? "正在请求停止当前执行，等待运行时确认最新线程状态。"
    : view.summary;
  const latestCompactionBoundary = threadRead?.latest_compaction_boundary || null;
  const latestCompactionCreatedLabel = formatDiagnosticDateTime(
    latestCompactionBoundary?.created_at,
  );
  const latestCompactionDetail = truncateDiagnosticText(
    latestCompactionBoundary?.detail,
    160,
  );
  const latestCompactionSummary =
    latestCompactionBoundary?.summary_preview || "已生成压缩摘要预览";
  const latestTurnPrompt = useMemo(() => {
    const activeTurn =
      turns.find((turn) => turn.id === currentTurnId) || turns[turns.length - 1];
    return activeTurn?.prompt_text?.trim() || "";
  }, [currentTurnId, turns]);
  const teamMemoryShadowMetadata = useMemo(
    () => buildTeamMemoryShadowRequestMetadata(teamMemorySnapshot),
    [teamMemorySnapshot],
  );
  const teamMemoryShadowKey = useMemo(() => {
    if (!teamMemoryShadowMetadata) {
      return "";
    }
    return [
      teamMemoryShadowMetadata.repo_scope,
      ...teamMemoryShadowMetadata.entries.map(
        (entry) => `${entry.key}:${entry.updated_at}`,
      ),
    ].join("|");
  }, [teamMemoryShadowMetadata]);
  const diagnosticSessionId = diagnosticRuntimeContext?.sessionId?.trim() || "";
  const diagnosticWorkingDir = diagnosticRuntimeContext?.workingDir?.trim() || "";

  useEffect(() => {
    if (!diagnosticSessionId) {
      setMemoryPrefetchState({ status: "idle", result: null, error: null });
      setMemoryPrefetchComparison({
        baselineEntry: null,
        diff: null,
        assessment: null,
      });
      return;
    }
    if (!diagnosticWorkingDir) {
      setMemoryPrefetchState({
        status: "error",
        result: null,
        error:
          "当前未绑定工作区，暂时无法预演 rules / working / durable / compaction 记忆命中。",
      });
      setMemoryPrefetchComparison({
        baselineEntry: null,
        diff: null,
        assessment: null,
      });
      return;
    }

    let cancelled = false;
    setMemoryPrefetchState({
      status: "loading",
      result: null,
      error: null,
    });

    void prefetchContextMemoryForTurn({
      session_id: diagnosticSessionId,
      working_dir: diagnosticWorkingDir,
      user_message: latestTurnPrompt,
      request_metadata: teamMemoryShadowMetadata
        ? {
            team_memory_shadow: teamMemoryShadowMetadata,
          }
        : undefined,
    })
      .then((result) => {
        if (cancelled) {
          return;
        }
        const historyEntries = recordRuntimeMemoryPrefetchHistory({
          sessionId: diagnosticSessionId,
          workingDir: diagnosticWorkingDir,
          userMessage: latestTurnPrompt || null,
          source: "thread_reliability",
          result,
        });
        setMemoryPrefetchComparison(
          resolveMemoryPrefetchComparison(historyEntries, diagnosticWorkingDir),
        );
        setMemoryPrefetchState({
          status: "ready",
          result,
          error: null,
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setMemoryPrefetchState({
          status: "error",
          result: null,
          error:
            error instanceof Error
              ? error.message
              : "记忆预取失败，请稍后重试",
        });
        setMemoryPrefetchComparison({
          baselineEntry: null,
          diff: null,
          assessment: null,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [
    diagnosticSessionId,
    diagnosticWorkingDir,
    latestTurnPrompt,
    teamMemoryShadowKey,
    teamMemoryShadowMetadata,
  ]);

  if (!view.shouldRender) {
    return null;
  }

  const handleInterrupt = async () => {
    if (!onInterruptCurrentTurn || isInterrupting) {
      return;
    }

    setIsInterrupting(true);
    try {
      await onInterruptCurrentTurn();
    } finally {
      setIsInterrupting(false);
    }
  };

  const handleLocatePendingRequest = () => {
    const requestId = view.pendingRequests[0]?.id;
    if (!requestId || !onLocatePendingRequest) {
      return;
    }
    onLocatePendingRequest(requestId);
  };

  const handlePromoteQueuedTurn = async () => {
    const queuedTurnId = view.nextQueuedTurn?.id;
    if (!queuedTurnId || !onPromoteQueuedTurn || isPromotingQueuedTurn) {
      return;
    }

    setIsPromotingQueuedTurn(true);
    try {
      await onPromoteQueuedTurn(queuedTurnId);
    } finally {
      setIsPromotingQueuedTurn(false);
    }
  };

  const handleReplayPendingRequest = async () => {
    const requestId = view.pendingRequests[0]?.id;
    if (!requestId || !onReplayPendingRequest || isReplayingRequest) {
      return;
    }

    setIsReplayingRequest(true);
    try {
      await onReplayPendingRequest(requestId);
    } finally {
      setIsReplayingRequest(false);
    }
  };

  const handleResumeThread = async () => {
    if (!onResumeThread || isResumingThread) {
      return;
    }

    setIsResumingThread(true);
    try {
      await onResumeThread();
    } finally {
      setIsResumingThread(false);
    }
  };

  const handleCopyDiagnostic = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      toast.error("当前环境不支持剪贴板复制");
      return;
    }

    try {
      await navigator.clipboard.writeText(
        buildReliabilityDiagnosticText({
          threadRead,
          statusLabel,
          summary,
          view,
          threadItems,
          messages,
          harnessState,
          memoryPrefetchState,
          memoryPrefetchComparison,
          diagnosticRuntimeContext,
        }),
      );
      toast.success("AI 诊断内容已复制");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "复制 AI 诊断内容失败",
      );
    }
  };

  const handleCopyRawJson = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      toast.error("当前环境不支持剪贴板复制");
      return;
    }

    try {
      await navigator.clipboard.writeText(
        serializeClipboardPayload(
          buildReliabilityRawPayload({
            threadRead,
            turns,
            threadItems,
            currentTurnId,
            pendingActions,
            submittedActionsInFlight,
            queuedTurns,
            view,
            harnessState,
            messages,
            memoryPrefetchState,
            memoryPrefetchComparison,
            diagnosticRuntimeContext,
          }),
        ),
      );
      toast.success("原始 JSON 已复制");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "复制原始 JSON 失败",
      );
    }
  };

  return (
    <section
      className={cn(
        "mb-3 rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm shadow-slate-950/5",
        className,
      )}
      data-testid="agent-thread-reliability-panel"
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium tracking-wide text-muted-foreground">
            线程可靠性
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className="border-amber-200 bg-amber-50 text-amber-700"
            >
              线程级快速诊断
            </Badge>
            <Badge
              variant="outline"
              className={resolveToneClassName(statusTone)}
            >
              {statusLabel}
            </Badge>
            {view.activeTurnLabel ? (
              <span className="text-sm font-medium text-foreground">
                {view.activeTurnLabel}
              </span>
            ) : null}
          </div>
          <div className="mt-2 text-sm leading-6 text-muted-foreground">
            {summary}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-muted-foreground">
          {view.updatedAtLabel ? (
            <span>最近刷新 {view.updatedAtLabel}</span>
          ) : null}
          {view.interruptStateLabel ? (
            <Badge
              variant="outline"
              className="border-slate-200 bg-slate-50 text-slate-700"
            >
              {view.interruptStateLabel}
            </Badge>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleCopyDiagnostic()}
            className="h-8 rounded-full"
            data-testid="agent-thread-reliability-copy"
          >
            <Copy className="mr-2 h-3.5 w-3.5" />
            快速复制给 AI
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleCopyRawJson()}
            className="h-8 rounded-full"
            data-testid="agent-thread-reliability-copy-json"
          >
            <Copy className="mr-2 h-3.5 w-3.5" />
            复制原始 JSON（debug）
          </Button>
        </div>
      </div>
      <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-[11px] leading-5 text-amber-900">
        当前入口只覆盖当前 thread 的运行信号。正式交给外部模型分析时，
        请优先使用工作台“交接制品 → 外部分析交接”的
        `analysis-brief.md / analysis-context.json` 主链；这里的“快速复制给
        AI”只适合临时排障，“复制原始 JSON（debug）”适合程序化分析、
        存档或二次处理。
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-3">
        <div
          className={cn(
            "rounded-2xl border px-3 py-3",
            resolveStatShellClassName(
              view.pendingRequestCount > 0 ? "waiting" : "neutral",
            ),
          )}
        >
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <ListTodo className="h-4 w-4" />
            <span>待处理请求</span>
          </div>
          <div className="mt-2 text-2xl font-semibold text-foreground">
            {view.pendingRequestCount}
          </div>
        </div>

        <div
          className={cn(
            "rounded-2xl border px-3 py-3",
            resolveStatShellClassName(
              view.activeIncidentCount > 0 ? "failed" : "neutral",
            ),
          )}
        >
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <AlertTriangle className="h-4 w-4" />
            <span>活跃 Incident</span>
          </div>
          <div className="mt-2 text-2xl font-semibold text-foreground">
            {view.activeIncidentCount}
          </div>
        </div>

        <div
          className={cn(
            "rounded-2xl border px-3 py-3",
            resolveStatShellClassName(
              view.queuedTurnCount > 0 ? "waiting" : "neutral",
            ),
          )}
        >
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Waves className="h-4 w-4" />
            <span>排队回合</span>
          </div>
          <div className="mt-2 text-2xl font-semibold text-foreground">
            {view.queuedTurnCount}
          </div>
        </div>
      </div>

      {(canInterrupt && onInterruptCurrentTurn) ||
      (view.pendingRequests.length > 0 && onReplayPendingRequest) ||
      (view.nextQueuedTurn && onResumeThread) ||
      (view.pendingRequests.length > 0 && onLocatePendingRequest) ||
      (view.nextQueuedTurn && onPromoteQueuedTurn) ||
      view.recommendations.length > 0 ? (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="text-sm font-medium text-foreground">当前操作</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {canInterrupt && onInterruptCurrentTurn ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleInterrupt()}
                disabled={
                  isInterrupting ||
                  isResumingThread ||
                  isReplayingRequest ||
                  isPromotingQueuedTurn
                }
                className="border-slate-300 bg-white"
              >
                {isInterrupting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <PauseCircle className="mr-2 h-4 w-4" />
                )}
                {isInterrupting ? "正在停止" : "停止当前执行"}
              </Button>
            ) : null}

            {view.pendingRequests.length > 0 && onReplayPendingRequest ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleReplayPendingRequest()}
                disabled={
                  isInterrupting ||
                  isResumingThread ||
                  isReplayingRequest ||
                  isPromotingQueuedTurn
                }
                className="border-sky-300 bg-white text-sky-700 hover:bg-sky-50"
              >
                {isReplayingRequest ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <PlayCircle className="mr-2 h-4 w-4" />
                )}
                {isReplayingRequest ? "拉起中" : "重新拉起请求"}
              </Button>
            ) : null}

            {view.pendingRequests.length > 0 && onLocatePendingRequest ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleLocatePendingRequest}
                disabled={
                  isInterrupting ||
                  isResumingThread ||
                  isReplayingRequest ||
                  isPromotingQueuedTurn
                }
                className="border-amber-300 bg-white text-amber-700 hover:bg-amber-50"
              >
                <Clock3 className="mr-2 h-4 w-4" />
                前往待处理请求
              </Button>
            ) : null}

            {view.nextQueuedTurn && onResumeThread ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleResumeThread()}
                disabled={
                  isInterrupting ||
                  isResumingThread ||
                  isReplayingRequest ||
                  isPromotingQueuedTurn
                }
                className="border-sky-300 bg-white text-sky-700 hover:bg-sky-50"
              >
                {isResumingThread ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <PlayCircle className="mr-2 h-4 w-4" />
                )}
                {isResumingThread ? "恢复中" : "恢复执行"}
              </Button>
            ) : null}

            {view.nextQueuedTurn && onPromoteQueuedTurn ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handlePromoteQueuedTurn()}
                disabled={
                  isInterrupting ||
                  isResumingThread ||
                  isReplayingRequest ||
                  isPromotingQueuedTurn
                }
                className="border-sky-300 bg-white text-sky-700 hover:bg-sky-50"
              >
                {isPromotingQueuedTurn ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <PlayCircle className="mr-2 h-4 w-4" />
                )}
                {isPromotingQueuedTurn
                  ? "恢复中"
                  : view.nextQueuedTurn.positionLabel
                    ? `优先执行 ${view.nextQueuedTurn.positionLabel}`
                    : "优先执行排队回合"}
              </Button>
            ) : null}
          </div>

          {view.recommendations.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {view.recommendations.map((recommendation) => (
                <Badge
                  key={recommendation}
                  variant="outline"
                  className="border-slate-200 bg-white text-slate-700"
                >
                  {recommendation}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {view.pendingRequests.length > 0 ? (
        <div
          className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3"
          data-testid="agent-thread-reliability-requests"
        >
          <div className="flex items-center gap-2 text-sm font-medium text-amber-800">
            <Clock3 className="h-4 w-4" />
            <span>当前最需要处理的请求</span>
          </div>
          <div className="mt-3 space-y-2">
            {view.pendingRequests.map((request) => (
              <div
                key={request.id}
                className="rounded-xl border border-amber-200/80 bg-white px-3 py-2.5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-sm font-medium text-foreground">
                    {request.title}
                  </div>
                  <Badge
                    variant="outline"
                    className={resolveToneClassName(request.statusTone)}
                  >
                    {request.typeLabel}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {request.statusLabel}
                  </span>
                </div>
                {request.waitingLabel || request.createdAtLabel ? (
                  <div className="mt-1.5 text-xs text-muted-foreground">
                    {[request.waitingLabel, request.createdAtLabel]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {view.submittedRequests.length > 0 ? (
        <div
          className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3"
          data-testid="agent-thread-reliability-submitted"
        >
          <div className="flex items-center gap-2 text-sm font-medium text-sky-800">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>已提交响应，等待线程继续执行</span>
          </div>
          <div className="mt-3 space-y-2">
            {view.submittedRequests.map((request) => (
              <div
                key={request.id}
                className="rounded-xl border border-sky-200/80 bg-white px-3 py-2.5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-sm font-medium text-foreground">
                    {request.title}
                  </div>
                  <Badge
                    variant="outline"
                    className={resolveToneClassName(request.statusTone)}
                  >
                    {request.typeLabel}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {request.statusLabel}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {diagnosticSessionId ? (
        <AgentThreadMemoryPrefetchPreview
          status={memoryPrefetchState.status}
          result={memoryPrefetchState.result}
          error={memoryPrefetchState.error}
          actions={
            onOpenMemoryWorkbench ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onOpenMemoryWorkbench}
                className="h-8 rounded-full border-sky-300 bg-white text-sky-700 hover:bg-sky-50"
              >
                在记忆工作台查看
              </Button>
            ) : undefined
          }
        />
      ) : null}

      {memoryPrefetchState.status === "ready" &&
      memoryPrefetchComparison.baselineEntry &&
      memoryPrefetchComparison.diff ? (
        <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-medium text-sky-900">
              相对最近基线
            </div>
            <Badge
              variant="outline"
              className="border-sky-200 bg-white text-sky-700"
            >
              {resolveMemoryPrefetchHistorySourceLabel(
                memoryPrefetchComparison.baselineEntry.source,
              )}
            </Badge>
            <span className="text-xs text-sky-800">
              {formatDiagnosticDateTime(
                memoryPrefetchComparison.baselineEntry.capturedAt,
              ) || "未知时间"}
            </span>
          </div>
          {memoryPrefetchComparison.baselineEntry.userMessage ? (
            <div className="mt-2 text-sm leading-6 text-sky-950">
              基线输入：{memoryPrefetchComparison.baselineEntry.userMessage}
            </div>
          ) : null}
          {memoryPrefetchComparison.assessment ? (
            <div className="mt-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className={resolveMemoryPrefetchAssessmentBadgeClassName(
                    memoryPrefetchComparison.assessment,
                  )}
                >
                  {formatRuntimeMemoryPrefetchHistoryDiffStatusLabel(
                    memoryPrefetchComparison.assessment.status,
                  )}
                </Badge>
                <span className="text-sm leading-6 text-sky-950">
                  {describeRuntimeMemoryPrefetchHistoryDiffAssessment(
                    memoryPrefetchComparison.assessment,
                  )}
                </span>
              </div>
            </div>
          ) : null}
          {memoryPrefetchComparison.diff.changed ? (
            <>
              <div className="mt-3 text-xs font-medium text-sky-700">
                具体变化
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {memoryPrefetchComparison.diff.layerChanges.rulesDelta !== 0 ? (
                  <Badge
                    variant="outline"
                    className="border-sky-200 bg-white text-sky-700"
                  >
                    规则{" "}
                    {memoryPrefetchComparison.diff.layerChanges.rulesDelta > 0 ? "+" : ""}
                    {memoryPrefetchComparison.diff.layerChanges.rulesDelta}
                  </Badge>
                ) : null}
                {memoryPrefetchComparison.diff.layerChanges.workingChanged !== "same" ? (
                  <Badge
                    variant="outline"
                    className="border-sky-200 bg-white text-sky-700"
                  >
                    工作
                    {memoryPrefetchComparison.diff.layerChanges.workingChanged === "added"
                      ? " 新命中"
                      : " 取消命中"}
                  </Badge>
                ) : null}
                {memoryPrefetchComparison.diff.layerChanges.durableDelta !== 0 ? (
                  <Badge
                    variant="outline"
                    className="border-sky-200 bg-white text-sky-700"
                  >
                    持久{" "}
                    {memoryPrefetchComparison.diff.layerChanges.durableDelta > 0 ? "+" : ""}
                    {memoryPrefetchComparison.diff.layerChanges.durableDelta}
                  </Badge>
                ) : null}
                {memoryPrefetchComparison.diff.layerChanges.teamDelta !== 0 ? (
                  <Badge
                    variant="outline"
                    className="border-sky-200 bg-white text-sky-700"
                  >
                    任务影子{" "}
                    {memoryPrefetchComparison.diff.layerChanges.teamDelta > 0 ? "+" : ""}
                    {memoryPrefetchComparison.diff.layerChanges.teamDelta}
                  </Badge>
                ) : null}
                {memoryPrefetchComparison.diff.layerChanges.compactionChanged !== "same" ? (
                  <Badge
                    variant="outline"
                    className="border-sky-200 bg-white text-sky-700"
                  >
                    压缩
                    {memoryPrefetchComparison.diff.layerChanges.compactionChanged === "added"
                      ? " 新命中"
                      : " 取消命中"}
                  </Badge>
                ) : null}
              </div>
              {memoryPrefetchComparison.diff.previewChanges.length > 0 ? (
                <div className="mt-3 space-y-1.5 text-sm leading-6 text-sky-950">
                  {memoryPrefetchComparison.diff.previewChanges
                    .slice(0, 3)
                    .map((change, index) => (
                      <p key={`${change.key}:${index}`}>
                        {resolveMemoryPrefetchPreviewChangeLabel(change)}
                      </p>
                    ))}
                </div>
              ) : null}
            </>
          ) : (
            <div className="mt-2 text-sm leading-6 text-sky-950">
              当前回合与最近基线相比没有明显变化。
            </div>
          )}
        </div>
      ) : null}

      {latestCompactionBoundary ? (
        <div
          className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3"
          data-testid="agent-thread-reliability-compaction-boundary"
        >
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-medium text-emerald-900">
              最近压缩边界
            </div>
            {latestCompactionBoundary.trigger ? (
              <Badge
                variant="outline"
                className="border-emerald-300 bg-white text-emerald-700"
              >
                {latestCompactionBoundary.trigger}
              </Badge>
            ) : null}
            {typeof latestCompactionBoundary.turn_count === "number" ? (
              <Badge
                variant="outline"
                className="border-emerald-300 bg-white text-emerald-700"
              >
                覆盖 {latestCompactionBoundary.turn_count} 回合
              </Badge>
            ) : null}
          </div>
          <div className="mt-2 text-sm leading-6 text-emerald-950">
            {latestCompactionSummary}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-emerald-800">
            <span title={String(latestCompactionBoundary.created_at)}>
              生成时间 {latestCompactionCreatedLabel || "未知"}
            </span>
            {latestCompactionDetail ? (
              <span>压缩备注 {latestCompactionDetail}</span>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {view.outcome ? (
          <AgentThreadOutcomeSummary outcome={view.outcome} />
        ) : (
          <div
            className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
            data-testid="agent-thread-outcome-empty"
          >
            <div className="text-sm font-medium text-slate-700">最近结果</div>
            <div className="mt-2 text-sm leading-6 text-muted-foreground">
              当前尚未沉淀出稳定 outcome，继续以下方时间线为准。
            </div>
          </div>
        )}

        <AgentIncidentPanel incidents={view.incidents} />
      </div>
    </section>
  );
};
