import React, { useMemo } from "react";
import { AlertCircle, Clock3, GitBranch, Loader2, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TokenUsagePromptCacheNotice } from "./TokenUsageDisplay";
import type { AgentTaskRuntimeCardModel } from "../utils/agentTaskRuntime";

interface AgentTaskRuntimeCardProps {
  task: AgentTaskRuntimeCardModel;
  promptCacheNotice?: TokenUsagePromptCacheNotice | null;
}

function formatCompact(value: number): string {
  return Math.max(0, value).toLocaleString();
}

function resolvePromptCacheSummary(
  task: AgentTaskRuntimeCardModel,
  promptCacheNotice?: TokenUsagePromptCacheNotice | null,
): string | null {
  if (!task.usage) {
    return null;
  }

  const cachedRead = Math.max(0, task.usage.cached_input_tokens ?? 0);
  const cacheWrite = Math.max(0, task.usage.cache_creation_input_tokens ?? 0);

  if (cachedRead + cacheWrite > 0) {
    return `Prompt Cache ${formatCompact(cachedRead)}/${formatCompact(cacheWrite)}`;
  }

  if (promptCacheNotice?.label) {
    return `Prompt Cache ${promptCacheNotice.label}`;
  }

  return null;
}

function resolveFrameTone(status: AgentTaskRuntimeCardModel["status"]): string {
  switch (status) {
    case "failed":
    case "aborted":
      return "border-rose-200/80 bg-rose-50/75";
    case "waiting_input":
      return "border-amber-200/80 bg-amber-50/75";
    case "queued":
      return "border-slate-200/80 bg-slate-50";
    case "completed":
      return "border-emerald-200/80 bg-emerald-50/75";
    case "running":
    default:
      return "border-sky-200/80 bg-sky-50/70";
  }
}

function resolveStatusTone(
  status: AgentTaskRuntimeCardModel["status"],
): string {
  switch (status) {
    case "failed":
    case "aborted":
      return "border-rose-200 bg-rose-100/80 text-rose-700";
    case "waiting_input":
      return "border-amber-200 bg-amber-100/80 text-amber-700";
    case "queued":
      return "border-slate-200 bg-white/80 text-slate-600";
    case "completed":
      return "border-emerald-200 bg-emerald-100/80 text-emerald-700";
    case "running":
    default:
      return "border-sky-200 bg-sky-100/80 text-sky-700";
  }
}

function resolveLeadingIcon(status: AgentTaskRuntimeCardModel["status"]) {
  if (status === "running") {
    return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
  }
  if (status === "failed" || status === "aborted") {
    return <AlertCircle className="h-3.5 w-3.5" />;
  }
  return <Wrench className="h-3.5 w-3.5" />;
}

export const AgentTaskRuntimeCard: React.FC<AgentTaskRuntimeCardProps> = ({
  task,
  promptCacheNotice = null,
}) => {
  const promptCacheSummary = useMemo(
    () => resolvePromptCacheSummary(task, promptCacheNotice),
    [promptCacheNotice, task],
  );
  const usageSummary = useMemo(() => {
    if (!task.usage) {
      return null;
    }
    return `${formatCompact(task.usage.input_tokens + task.usage.output_tokens)} tokens`;
  }, [task.usage]);
  const shouldShowAccounting =
    Boolean(task.usage) &&
    task.status !== "running" &&
    task.status !== "queued" &&
    task.status !== "waiting_input";

  return (
    <div
      data-testid="agent-task-strip"
      aria-live="polite"
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-2 rounded-full border px-2.5 py-1.5",
        resolveFrameTone(task.status),
      )}
    >
      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/70 bg-white/85 text-slate-600">
        {resolveLeadingIcon(task.status)}
      </span>
      <span
        data-testid="agent-task-summary"
        className="min-w-0 max-w-[260px] truncate text-[11px] font-medium leading-5 text-slate-800"
        title={task.title}
      >
        {task.title}
      </span>
      <span
        data-testid="agent-task-status"
        className={cn(
          "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
          resolveStatusTone(task.status),
        )}
      >
        {task.statusLabel}
      </span>
      {task.detail ? (
        <span className="hidden max-w-[220px] truncate text-[11px] leading-5 text-slate-600 xl:inline">
          {task.detail}
        </span>
      ) : null}
      {task.batchDescriptor ? (
        <span
          data-testid="agent-task-batch"
          className="inline-flex items-center rounded-full border border-slate-200/80 bg-white/75 px-2 py-0.5 text-[10px] text-slate-600"
        >
          {task.batchDescriptor.countLabel}
        </span>
      ) : null}
      {task.pendingRequestCount > 0 ? (
        <span className="inline-flex items-center rounded-full border border-slate-200/80 bg-white/75 px-2 py-0.5 text-[10px] text-slate-600">
          待补 {task.pendingRequestCount}
        </span>
      ) : null}
      {task.queuedTurnCount > 0 ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-slate-200/80 bg-white/75 px-2 py-0.5 text-[10px] text-slate-600">
          <Clock3 className="h-3 w-3" />
          {task.queuedTurnCount}
        </span>
      ) : null}
      {task.subtaskStats?.total ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-slate-200/80 bg-white/75 px-2 py-0.5 text-[10px] text-slate-600">
          <GitBranch className="h-3 w-3" />
          {task.subtaskStats.active}/{task.subtaskStats.total}
        </span>
      ) : null}
      {shouldShowAccounting && usageSummary ? (
        <span
          data-testid="agent-task-usage"
          className="inline-flex items-center rounded-full border border-slate-200/80 bg-white/75 px-2 py-0.5 text-[10px] text-slate-600"
        >
          {usageSummary}
        </span>
      ) : null}
      {shouldShowAccounting && promptCacheSummary ? (
        <span
          data-testid="agent-task-prompt-cache"
          className="inline-flex items-center rounded-full border border-slate-200/80 bg-white/75 px-2 py-0.5 text-[10px] text-slate-600"
        >
          {promptCacheSummary}
        </span>
      ) : null}
    </div>
  );
};

export default AgentTaskRuntimeCard;
