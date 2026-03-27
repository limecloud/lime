import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  Clock3,
  FileText,
  Globe,
  Loader2,
  Search,
  ShieldAlert,
  Sparkles,
  TerminalSquare,
  Wrench,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { AgentToolCallState as ToolCallState } from "@/lib/api/agentProtocol";
import type {
  ActionRequired,
  AgentThreadItem,
  AgentThreadTurn,
  ConfirmResponse,
  SiteSavedContentTarget,
} from "../types";
import {
  buildAgentThreadDisplayModel,
  type AgentThreadOrderedBlock,
  type AgentThreadSummaryChip,
} from "../utils/agentThreadGrouping";
import type { AgentRuntimeThreadReadModel } from "@/lib/api/agentRuntime";
import { isActionRequestA2UICompatible } from "../utils/actionRequestA2UI";
import { resolveInternalImageTaskDisplayName } from "../utils/internalImagePlaceholder";
import { parseAIResponse } from "@/components/content-creator/a2ui/parser";
import type { A2UIResponse } from "@/components/content-creator/a2ui/types";
import { TIMELINE_A2UI_TASK_CARD_PRESET } from "@/components/content-creator/a2ui/taskCardPresets";
import { cn } from "@/lib/utils";
import {
  resolveIncidentToneFromSeverity,
  resolveOutcomeLabel,
  resolveOutcomeTone,
  type ThreadReliabilityTone,
} from "../utils/threadReliabilityView";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { ActionRequestA2UIPreviewCard } from "./ActionRequestA2UIPreviewCard";
import { A2UITaskCard, A2UITaskLoadingCard } from "./A2UITaskCard";
import { ToolCallItem } from "./ToolCallDisplay";
import { DecisionPanel } from "./DecisionPanel";
import { AgentPlanBlock } from "./AgentPlanBlock";
import {
  resolveTimelineArtifactNavigation,
  type ArtifactTimelineOpenTarget,
} from "../utils/artifactTimelineNavigation";
import { TimelineInlineItem } from "./TimelineInlineItem";

interface AgentThreadTimelineProps {
  turn: AgentThreadTurn;
  items: AgentThreadItem[];
  threadRead?: AgentRuntimeThreadReadModel | null;
  actionRequests?: ActionRequired[];
  isCurrentTurn?: boolean;
  onFileClick?: (fileName: string, content: string) => void;
  onOpenArtifactFromTimeline?: (target: ArtifactTimelineOpenTarget) => void;
  onOpenSavedSiteContent?: (target: SiteSavedContentTarget) => void;
  onOpenSubagentSession?: (sessionId: string) => void;
  onPermissionResponse?: (response: ConfirmResponse) => void;
  focusedItemId?: string | null;
  focusRequestKey?: number;
}

interface TurnStatusMeta {
  label: string;
  badgeVariant: "secondary" | "outline" | "destructive";
  badgeClassName?: string;
  overviewText: string;
}

type TimelineCompactTone =
  | "running"
  | "waiting"
  | "failed"
  | "paused"
  | "done";

interface TimelineCompactReliabilityBadge {
  key: string;
  label: string;
  tone: ThreadReliabilityTone;
}

function shortenInlineText(
  value: string | undefined | null,
  maxLength = 72,
): string | null {
  const normalized = (value || "").trim().replace(/\s+/g, " ");
  if (!normalized) {
    return null;
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function formatTimestamp(value?: string): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function resolveReliabilityBadgeClassName(
  tone: ThreadReliabilityTone,
): string {
  if (tone === "completed") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (tone === "failed") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  if (tone === "waiting") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  if (tone === "running") {
    return "border-sky-200 bg-sky-50 text-sky-700";
  }
  if (tone === "paused") {
    return "border-slate-200 bg-slate-50 text-slate-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function buildCompactReliabilityBadges(
  turn: AgentThreadTurn,
  threadRead?: AgentRuntimeThreadReadModel | null,
): TimelineCompactReliabilityBadge[] {
  if (!threadRead) {
    return [];
  }

  const badges: TimelineCompactReliabilityBadge[] = [];

  if (threadRead.last_outcome?.turn_id === turn.id) {
    badges.push({
      key: "outcome",
      label: resolveOutcomeLabel(threadRead.last_outcome.outcome_type),
      tone: resolveOutcomeTone(threadRead.last_outcome.outcome_type),
    });
  }

  const activeIncidents = (threadRead.incidents ?? []).filter((incident) => {
    const normalizedStatus = (incident.status || "").toLowerCase();
    return (
      incident.turn_id === turn.id &&
      !incident.cleared_at &&
      !normalizedStatus.includes("clear")
    );
  });

  if (activeIncidents.length > 0) {
    const incidentTone = activeIncidents.reduce<ThreadReliabilityTone>(
      (currentTone, incident) => {
        const nextTone = resolveIncidentToneFromSeverity(incident.severity);
        if (currentTone === "failed" || nextTone === currentTone) {
          return currentTone;
        }
        if (nextTone === "failed") {
          return nextTone;
        }
        if (nextTone === "waiting") {
          return nextTone;
        }
        return currentTone;
      },
      "neutral",
    );

    badges.push({
      key: "incident",
      label: `${activeIncidents.length} 个 incident`,
      tone: incidentTone,
    });
  }

  return badges;
}

function toQuestionOptions(
  options: Array<{ label: string; description?: string }> | undefined,
) {
  return options?.map((option) => ({
    label: option.label,
    description: option.description,
  }));
}

function stringifyResponse(value: unknown): string | undefined {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized || undefined;
  }

  if (value === null || value === undefined) {
    return undefined;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function toActionRequired(item: AgentThreadItem): ActionRequired | null {
  if (item.type === "approval_request") {
    return {
      requestId: item.request_id,
      actionType: "tool_confirmation",
      toolName: item.tool_name,
      arguments:
        item.arguments && typeof item.arguments === "object"
          ? (item.arguments as Record<string, unknown>)
          : undefined,
      prompt: item.prompt,
      status: item.status === "completed" ? "submitted" : "pending",
      submittedResponse: stringifyResponse(item.response),
      submittedUserData: item.response,
    };
  }

  if (item.type === "request_user_input") {
    return {
      requestId: item.request_id,
      actionType:
        item.action_type === "elicitation" ? "elicitation" : "ask_user",
      prompt: item.prompt,
      questions: item.questions?.map((question) => ({
        question: question.question,
        header: question.header,
        options: toQuestionOptions(question.options),
        multiSelect: question.multi_select,
      })),
      status: item.status === "completed" ? "submitted" : "pending",
      submittedResponse: stringifyResponse(item.response),
      submittedUserData: item.response,
    };
  }

  return null;
}

function mapItemStatus(
  status: AgentThreadItem["status"],
): ToolCallState["status"] {
  if (status === "failed") {
    return "failed";
  }
  return status === "completed" ? "completed" : "running";
}

function toToolCallState(item: AgentThreadItem): ToolCallState | null {
  switch (item.type) {
    case "tool_call":
      return {
        id: item.id,
        name: item.tool_name,
        arguments:
          item.arguments === undefined
            ? undefined
            : JSON.stringify(item.arguments, null, 2),
        status: mapItemStatus(item.status),
        result:
          item.output !== undefined ||
          item.error !== undefined ||
          item.metadata !== undefined
            ? {
                success:
                  item.success ??
                  (item.status === "completed" && item.error === undefined),
                output: item.output || "",
                error: item.error,
                metadata:
                  item.metadata && typeof item.metadata === "object"
                    ? (item.metadata as Record<string, unknown>)
                    : undefined,
              }
            : undefined,
        startTime: new Date(item.started_at),
        endTime: item.completed_at ? new Date(item.completed_at) : undefined,
      };
    case "command_execution":
      return {
        id: item.id,
        name: "exec_command",
        arguments: JSON.stringify(
          { command: item.command, cwd: item.cwd },
          null,
          2,
        ),
        status: mapItemStatus(item.status),
        result:
          item.aggregated_output !== undefined ||
          item.error !== undefined ||
          item.exit_code !== undefined
            ? {
                success: item.status === "completed" && item.error === undefined,
                output: item.aggregated_output || "",
                error: item.error,
                metadata:
                  item.exit_code !== undefined
                    ? { exit_code: item.exit_code, cwd: item.cwd }
                    : { cwd: item.cwd },
              }
            : undefined,
        startTime: new Date(item.started_at),
        endTime: item.completed_at ? new Date(item.completed_at) : undefined,
      };
    case "web_search":
      return {
        id: item.id,
        name: item.action || "web_search",
        arguments:
          item.query !== undefined
            ? JSON.stringify({ query: item.query }, null, 2)
            : undefined,
        status: mapItemStatus(item.status),
        result:
          item.output !== undefined
            ? {
                success: item.status !== "failed",
                output: item.output,
              }
            : undefined,
        startTime: new Date(item.started_at),
        endTime: item.completed_at ? new Date(item.completed_at) : undefined,
      };
    default:
      return null;
  }
}

function resolveStatusBadgeVariant(
  status: AgentThreadItem["status"],
): "secondary" | "outline" | "destructive" {
  if (status === "failed") {
    return "destructive";
  }
  return status === "completed" ? "outline" : "secondary";
}

function findLatestPendingAction(
  actionRequests: ActionRequired[] | undefined,
): ActionRequired | null {
  if (!actionRequests?.length) {
    return null;
  }

  for (let index = actionRequests.length - 1; index >= 0; index -= 1) {
    const actionRequest = actionRequests[index];
    if (actionRequest.status !== "submitted") {
      return actionRequest;
    }
  }

  return null;
}

function findLatestPendingItemAction(items: AgentThreadItem[]) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (
      (item.type === "approval_request" || item.type === "request_user_input") &&
      item.status !== "completed"
    ) {
      return item;
    }
  }

  return null;
}

function resolvePendingItemOverview(item: AgentThreadItem): string {
  if (
    (item.type === "approval_request" || item.type === "request_user_input") &&
    item.prompt?.trim()
  ) {
    return item.prompt.trim();
  }

  if (item.type === "request_user_input") {
    const firstQuestion = item.questions?.find((question) => question.question?.trim());
    if (firstQuestion?.question) {
      return firstQuestion.question.trim();
    }
  }

  return "当前阶段在等待你确认，完成后会继续后续处理。";
}

function resolveItemStatusLabel(status: AgentThreadItem["status"]): string {
  switch (status) {
    case "in_progress":
      return "执行中";
    case "failed":
      return "失败";
    case "completed":
    default:
      return "已完成";
  }
}

function resolveGroupIcon(
  kind: AgentThreadOrderedBlock["kind"],
): React.ComponentType<{ className?: string }> {
  switch (kind) {
    case "thinking":
      return Sparkles;
    case "approval":
      return ShieldAlert;
    case "alert":
      return AlertTriangle;
    case "browser":
      return Globe;
    case "search":
      return Search;
    case "file":
      return FileText;
    case "command":
      return TerminalSquare;
    case "subagent":
      return Bot;
    case "other":
    default:
      return Wrench;
  }
}

function resolveOverviewText(
  turn: AgentThreadTurn,
  summaryText: string | null,
  actionableCount: number,
): string {
  if (summaryText) {
    return summaryText;
  }

  if (turn.status === "running") {
    return actionableCount > 0
      ? "正在处理你的请求，最新进展会持续更新。"
      : "正在准备处理内容。";
  }

  if (turn.status === "failed") {
    return turn.error_message || "当前阶段处理失败，请查看下方异常记录。";
  }

  return actionableCount > 0
    ? "已整理当前阶段的关键进展。"
    : "当前阶段没有额外记录。";
}

function resolveTurnStatusMeta(params: {
  turn: AgentThreadTurn;
  items: AgentThreadItem[];
  actionRequests?: ActionRequired[];
  summaryText: string | null;
  actionableCount: number;
}): TurnStatusMeta {
  const {
    turn,
    items,
    actionRequests,
    summaryText,
    actionableCount,
  } = params;
  const pendingAction = findLatestPendingAction(actionRequests);
  const hasInProgressItem = items.some((item) => item.status === "in_progress");

  if (pendingAction?.uiKind === "browser_preflight") {
    const phase = pendingAction.browserPrepState || "idle";

    if (phase === "launching") {
      return {
        label: "连接浏览器",
        badgeVariant: "secondary",
        badgeClassName:
          "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200",
        overviewText:
          pendingAction.detail?.trim() ||
          "正在建立浏览器会话，连接成功后会继续当前阶段。",
      };
    }

    if (phase === "awaiting_user" || phase === "ready_to_resume") {
      return {
        label: "待继续",
        badgeVariant: "secondary",
        badgeClassName:
          "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200",
        overviewText:
          pendingAction.detail?.trim() ||
          pendingAction.prompt?.trim() ||
          "浏览器已经打开，等待你完成登录、授权或验证后继续。",
      };
    }

    return {
      label: "浏览器未就绪",
      badgeVariant: "secondary",
      badgeClassName:
        "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200",
      overviewText:
        pendingAction.detail?.trim() ||
        pendingAction.prompt?.trim() ||
        "浏览器/CDP 还未连接，请重试启动后继续。",
    };
  }

  if (pendingAction) {
    return {
      label: "待处理",
      badgeVariant: "secondary",
      badgeClassName:
        "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200",
      overviewText:
        pendingAction.prompt?.trim() ||
        "当前阶段在等待你确认，完成后会继续后续处理。",
    };
  }

  const pendingItemAction = findLatestPendingItemAction(items);
  if (pendingItemAction) {
    return {
      label: "待处理",
      badgeVariant: "secondary",
      badgeClassName:
        "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200",
      overviewText: resolvePendingItemOverview(pendingItemAction),
    };
  }

  switch (turn.status) {
    case "running":
      return {
        label: "执行中",
        badgeVariant: "secondary",
        overviewText: resolveOverviewText(turn, summaryText, actionableCount),
      };
    case "failed":
      return {
        label: "失败",
        badgeVariant: "destructive",
        overviewText:
          turn.error_message || "当前阶段处理失败，请查看下方异常记录。",
      };
    case "aborted":
      return {
        label: "已暂停",
        badgeVariant: "outline",
        overviewText:
          turn.error_message || "当前阶段已暂停，你可以继续处理或开始下一步。",
      };
    case "completed":
    default:
      if (hasInProgressItem) {
        return {
          label: "执行中",
          badgeVariant: "secondary",
          overviewText: resolveOverviewText(turn, summaryText, actionableCount),
        };
      }

      return {
        label: "已完成",
        badgeVariant: "outline",
        overviewText: resolveOverviewText(turn, summaryText, actionableCount),
      };
  }
}

function stringifyItemForDebug(item: AgentThreadItem): string {
  try {
    return JSON.stringify(item, null, 2);
  } catch {
    return String(item);
  }
}

function SurfaceCard({
  icon: Icon,
  title,
  badge,
  timestamp,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  badge?: React.ReactNode;
  timestamp?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <div className="text-sm font-medium text-foreground">{title}</div>
        {badge ? <div className="ml-auto">{badge}</div> : null}
        {timestamp ? (
          <div className="text-xs text-muted-foreground">{timestamp}</div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function SummaryChip({
  chip,
}: {
  chip: AgentThreadSummaryChip;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/60 px-2 py-0.5 text-[11px] text-muted-foreground">
      <span className="text-foreground">{chip.label}</span>
      <span>{chip.count}</span>
    </div>
  );
}

function ThinkingItemCard({
  item,
}: {
  item: Extract<AgentThreadItem, { type: "reasoning" | "turn_summary" }>;
}) {
  const parsedContent = useMemo(() => parseAIResponse(item.text, false), [item.text]);
  const title =
    item.type === "reasoning"
      ? "思考摘要"
      : item.status === "in_progress"
        ? "执行准备"
        : "阶段总结";
  const hasStructuredPreview = parsedContent.hasA2UI || parsedContent.hasPending;

  const content = hasStructuredPreview ? (
    <div className="space-y-3">
      {parsedContent.parts.map((part, index) => {
        if (part.type === "a2ui" && typeof part.content !== "string") {
          const readonlyResponse: A2UIResponse = {
            ...part.content,
            submitAction: undefined,
          };

          return (
            <A2UITaskCard
              key={`timeline-a2ui-${index}`}
              response={readonlyResponse}
              compact={true}
              preview={true}
              preset={TIMELINE_A2UI_TASK_CARD_PRESET}
            />
          );
        }

        if (part.type === "pending_a2ui") {
          return (
            <A2UITaskLoadingCard
              key={`timeline-pending-a2ui-${index}`}
              compact={true}
              preset={TIMELINE_A2UI_TASK_CARD_PRESET}
              subtitle="结构化问答正在整理，请稍等。"
            />
          );
        }

        const textContent =
          typeof part.content === "string" ? part.content.trim() : "";
        if (!textContent) {
          return null;
        }

        return (
          <MarkdownRenderer
            key={`timeline-text-${index}`}
            content={textContent}
          />
        );
      })}
    </div>
  ) : (
    <MarkdownRenderer content={item.text} />
  );

  return (
    <SurfaceCard
      icon={Sparkles}
      title={title}
      badge={
        <Badge variant={resolveStatusBadgeVariant(item.status)}>
          {item.status === "in_progress" ? (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              整理中
            </span>
          ) : (
            resolveItemStatusLabel(item.status)
          )}
        </Badge>
      }
      timestamp={formatTimestamp(item.completed_at || item.updated_at)}
    >
      {content}
    </SurfaceCard>
  );
}

function ContextCompactionCard({
  item,
}: {
  item: Extract<AgentThreadItem, { type: "context_compaction" }>;
}) {
  const triggerLabel =
    item.trigger === "manual"
      ? "手动压缩"
      : item.trigger === "overflow"
        ? "超限恢复"
        : item.trigger === "auto"
          ? "自动压缩"
          : "上下文压缩";
  const title =
    item.stage === "completed" || item.status === "completed"
      ? "上下文已压缩"
      : "正在压缩上下文";
  const detail =
    item.detail?.trim() ||
    (item.stage === "completed" || item.status === "completed"
      ? "较早消息已替换为摘要，后续回复会基于压缩后的上下文继续。"
      : "系统正在将较早消息整理为摘要，以释放上下文窗口。");

  return (
    <SurfaceCard
      icon={Sparkles}
      title={title}
      badge={
        <Badge variant={resolveStatusBadgeVariant(item.status)}>
          {item.status === "in_progress" ? (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              压缩中
            </span>
          ) : (
            resolveItemStatusLabel(item.status)
          )}
        </Badge>
      }
      timestamp={formatTimestamp(item.completed_at || item.updated_at)}
    >
      <div className="space-y-3">
        <div className="text-sm text-muted-foreground">{detail}</div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{triggerLabel}</Badge>
        </div>
      </div>
    </SurfaceCard>
  );
}

function renderThinkingItemDetails(item: AgentThreadItem) {
  if (item.type === "plan") {
    return (
      <AgentPlanBlock
        content={item.text}
        isComplete={item.status !== "in_progress"}
      />
    );
  }

  if (item.type === "reasoning") {
    return null;
  }

  if (item.type === "turn_summary") {
    return <ThinkingItemCard item={item} />;
  }

  if (item.type === "context_compaction") {
    return <ContextCompactionCard item={item} />;
  }

  return null;
}

function renderGroupItemDetails(
  item: AgentThreadItem,
  onFileClick?: (fileName: string, content: string) => void,
  onOpenArtifactFromTimeline?: (target: ArtifactTimelineOpenTarget) => void,
  onOpenSavedSiteContent?: (target: SiteSavedContentTarget) => void,
  onOpenSubagentSession?: (sessionId: string) => void,
  onPermissionResponse?: (response: ConfirmResponse) => void,
) {
  const toolCall = toToolCallState(item);
  const actionRequest = toActionRequired(item);
  const timestamp = formatTimestamp(item.completed_at || item.updated_at);
  const resolveArtifactSourceLabel = (source: string): string => {
    switch (source) {
      case "tool_result":
        return "处理结果";
      case "tool_start":
        return "开始处理";
      case "message_content":
        return "消息内容";
      case "artifact_snapshot":
        return "快照同步";
      default:
        return source;
    }
  };
  const resolveSubagentStatusLabel = (
    statusLabel: string | undefined,
    status: AgentThreadItem["status"],
  ): string => {
    const normalized = statusLabel?.trim().toLowerCase();
    switch (normalized) {
      case "queued":
        return "稍后开始";
      case "running":
        return "处理中";
      case "completed":
        return "已完成";
      case "failed":
        return "失败";
      case "aborted":
        return "已暂停";
      default:
        return statusLabel || resolveItemStatusLabel(status);
    }
  };

  if (actionRequest) {
    if (isActionRequestA2UICompatible(actionRequest)) {
      return (
        <ActionRequestA2UIPreviewCard
          request={actionRequest}
          compact={true}
          context="timeline"
        />
      );
    }

    return (
      <DecisionPanel
        request={actionRequest}
        onSubmit={(response) => onPermissionResponse?.(response)}
      />
    );
  }

  if (toolCall) {
    return (
      <div className="rounded-xl border border-border/70 bg-background/80">
        <ToolCallItem
          toolCall={toolCall}
          defaultExpanded={item.status !== "completed"}
          onFileClick={onFileClick}
          onOpenSavedSiteContent={onOpenSavedSiteContent}
        />
      </div>
    );
  }

  if (item.type === "file_artifact") {
    const navigation = resolveTimelineArtifactNavigation(item);
    const blockTargets = navigation?.blockTargets || [];
    const shouldOpenFocusedBlock =
      Boolean(onOpenArtifactFromTimeline) && blockTargets.length === 1;

    return (
      <div className="rounded-xl border border-border/70 bg-background/80 px-3 py-3">
        <button
          type="button"
          className="w-full text-left transition-colors hover:bg-muted/40"
          onClick={() => {
            if (onOpenArtifactFromTimeline && navigation) {
              onOpenArtifactFromTimeline(
                shouldOpenFocusedBlock ? blockTargets[0] : navigation.rootTarget,
              );
              return;
            }

            onFileClick?.(item.path, item.content || "");
          }}
        >
          <div className="flex items-center gap-2">
            <div className="text-sm font-medium text-foreground">{item.path}</div>
            <Badge variant={resolveStatusBadgeVariant(item.status)} className="ml-auto">
              {resolveArtifactSourceLabel(item.source)}
            </Badge>
            {timestamp ? (
              <span className="text-xs text-muted-foreground">{timestamp}</span>
            ) : null}
          </div>
          {item.content?.trim() ? (
            <div className="mt-2 line-clamp-4 whitespace-pre-wrap text-xs text-muted-foreground">
              {item.content}
            </div>
          ) : (
            <div className="mt-2 text-xs text-muted-foreground">
              点击在画布中打开文件
            </div>
          )}
        </button>

        {onOpenArtifactFromTimeline && blockTargets.length > 1 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {blockTargets.slice(0, 4).map((target) => (
              <button
                key={`${item.id}:${target.blockId}`}
                type="button"
                className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700"
                onClick={() => onOpenArtifactFromTimeline(target)}
              >
                跳到 block {target.blockId}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  if (item.type === "subagent_activity") {
    const subagentSessionId = item.session_id?.trim();
    const displayTitle =
      resolveInternalImageTaskDisplayName(item.title) || "协作成员处理";

    return (
      <SurfaceCard
        icon={Bot}
        title={displayTitle}
        badge={
          <Badge variant={resolveStatusBadgeVariant(item.status)}>
            {resolveSubagentStatusLabel(item.status_label, item.status)}
          </Badge>
        }
        timestamp={timestamp}
      >
        {item.summary ? (
          <div className="text-sm text-muted-foreground">{item.summary}</div>
        ) : null}
        {item.role || item.model ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {item.role ? <Badge variant="outline">{item.role}</Badge> : null}
            {item.model ? <Badge variant="outline">{item.model}</Badge> : null}
          </div>
        ) : null}
        {subagentSessionId && onOpenSubagentSession ? (
          <div className="mt-3">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onOpenSubagentSession(subagentSessionId)}
            >
              查看协作详情
            </Button>
          </div>
        ) : null}
      </SurfaceCard>
    );
  }

  if (item.type === "warning" || item.type === "error") {
    return (
      <SurfaceCard
        icon={item.type === "warning" ? AlertTriangle : ShieldAlert}
        title={item.type === "warning" ? "运行提醒" : "执行错误"}
        badge={
          <Badge variant={resolveStatusBadgeVariant(item.status)}>
            {item.type === "warning" ? item.code || "warning" : "失败"}
          </Badge>
        }
        timestamp={timestamp}
      >
        <div
          className={
            item.type === "error"
              ? "text-sm text-destructive"
              : "text-sm text-muted-foreground"
          }
        >
          {item.message}
        </div>
      </SurfaceCard>
    );
  }

  return (
    <div className="rounded-xl border border-dashed border-border/70 bg-background/70 px-3 py-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">{item.type}</span>
        <Badge variant={resolveStatusBadgeVariant(item.status)} className="ml-auto">
          {resolveItemStatusLabel(item.status)}
        </Badge>
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs text-muted-foreground">
        {stringifyItemForDebug(item)}
      </pre>
    </div>
  );
}

function isCompactTechnicalBlock(block: AgentThreadOrderedBlock): boolean {
  return block.kind === "other" && block.status === "completed";
}

function resolveCompactTechnicalSummary(block: AgentThreadOrderedBlock): string {
  const firstPreview = block.previewLines[0];
  if (firstPreview) {
    return `已收起 ${block.items.length} 条次要执行记录，最近一条：${firstPreview}`;
  }
  return `已收起 ${block.items.length} 条次要执行记录。`;
}

function resolveActiveBlockIndex(blocks: AgentThreadOrderedBlock[]): number {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    if (blocks[index]?.status === "in_progress") {
      return index;
    }
  }

  return -1;
}

function findLastBlockIndex(
  blocks: AgentThreadOrderedBlock[],
  predicate: (block: AgentThreadOrderedBlock) => boolean,
): number {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    if (predicate(blocks[index])) {
      return index;
    }
  }

  return -1;
}

function resolveFocusBlockIndex(params: {
  blocks: AgentThreadOrderedBlock[];
  turn: AgentThreadTurn;
  actionRequests?: ActionRequired[];
  activeBlockIndex: number;
}): number {
  const { blocks, turn, actionRequests, activeBlockIndex } = params;

  if (blocks.length === 0) {
    return -1;
  }

  if (activeBlockIndex >= 0) {
    return activeBlockIndex;
  }

  const pendingAction = findLatestPendingAction(actionRequests);

  if (pendingAction?.uiKind === "browser_preflight") {
    const browserIndex = findLastBlockIndex(
      blocks,
      (block) => block.kind === "browser",
    );
    if (browserIndex >= 0) {
      return browserIndex;
    }
  }

  if (pendingAction) {
    const pendingIndex = findLastBlockIndex(
      blocks,
      (block) => block.kind === "approval" || block.kind === "alert",
    );
    if (pendingIndex >= 0) {
      return pendingIndex;
    }
  }

  if (turn.status === "failed" || turn.status === "aborted") {
    const failedIndex = findLastBlockIndex(
      blocks,
      (block) => block.status === "failed" || block.kind === "alert",
    );
    if (failedIndex >= 0) {
      return failedIndex;
    }
  }

  const lastMeaningfulIndex = findLastBlockIndex(
    blocks,
    (block) => block.kind !== "other",
  );
  if (lastMeaningfulIndex >= 0) {
    return lastMeaningfulIndex;
  }

  return blocks.length - 1;
}

function resolveExpandedBlockIndexes(params: {
  blocks: AgentThreadOrderedBlock[];
  isCurrentTurn: boolean;
  focusBlockIndex: number;
  turn: AgentThreadTurn;
}): Set<number> {
  const { blocks, isCurrentTurn, focusBlockIndex, turn } = params;
  const expanded = new Set<number>();

  blocks.forEach((block, index) => {
    if (block.defaultExpanded) {
      expanded.add(index);
    }
  });

  if (focusBlockIndex >= 0) {
    const focusBlock = blocks[focusBlockIndex];
    const shouldExpandFocus =
      focusBlock?.status !== "completed" ||
      turn.status === "running" ||
      turn.status === "failed" ||
      turn.status === "aborted";

    if (shouldExpandFocus) {
      expanded.add(focusBlockIndex);
    }

    if (shouldExpandFocus && isCurrentTurn && focusBlockIndex > 0) {
      const previousBlock = blocks[focusBlockIndex - 1];
      if (previousBlock?.kind !== "other") {
        expanded.add(focusBlockIndex - 1);
      }
    }
  }

  return expanded;
}

function resolveTimelineDetailsDefaultExpanded(params: {
  turn: AgentThreadTurn;
  items: AgentThreadItem[];
  actionRequests?: ActionRequired[];
  isCurrentTurn: boolean;
}): boolean {
  void params;
  return false;
}

function resolveCompactTone(params: {
  turn: AgentThreadTurn;
  turnStatusMeta: TurnStatusMeta;
}): TimelineCompactTone {
  const { turn, turnStatusMeta } = params;

  if (turn.status === "failed") {
    return "failed";
  }

  if (turn.status === "running" || turnStatusMeta.label === "执行中") {
    return "running";
  }

  if (
    turnStatusMeta.label === "待处理" ||
    turnStatusMeta.label === "待继续" ||
    turnStatusMeta.label === "连接浏览器" ||
    turnStatusMeta.label === "浏览器未就绪"
  ) {
    return "waiting";
  }

  if (turn.status === "aborted") {
    return "paused";
  }

  return "done";
}

function resolveFocusInlineText(
  block: AgentThreadOrderedBlock | null,
): string | null {
  if (!block) {
    return null;
  }

  if (isCompactTechnicalBlock(block)) {
    return resolveCompactTechnicalSummary(block);
  }

  const preview = block.previewLines.find((line) => line.trim().length > 0);
  if (preview) {
    return preview;
  }

  return block.title.trim() || null;
}

function resolveLatestThinkingPreview(
  blocks: AgentThreadOrderedBlock[],
): {
  text: string | null;
  stageLabel: string | null;
} {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block?.kind !== "thinking") {
      continue;
    }

    const latestPreview = [...block.previewLines]
      .reverse()
      .find((line) => line.trim().length > 0);

    return {
      text: latestPreview || resolveFocusInlineText(block),
      stageLabel: `步骤 ${String(index + 1).padStart(2, "0")}`,
    };
  }

  return {
    text: null,
    stageLabel: null,
  };
}

function resolveCollapsedProcessSnapshot(params: {
  compactTone: TimelineCompactTone;
  displayModelSummaryText: string | null;
  flowBlockCount: number;
  focusBlock: AgentThreadOrderedBlock | null;
  focusBlockStageLabel: string | null;
  orderedBlocks: AgentThreadOrderedBlock[];
  promptPreview: string | null;
  turnStatusMeta: TurnStatusMeta;
}): {
  statusLabel: string;
  stageLabel: string | null;
  detailText: string;
  combinedText: string;
} {
  const {
    compactTone,
    displayModelSummaryText,
    flowBlockCount,
    focusBlock,
    focusBlockStageLabel,
    orderedBlocks,
    promptPreview,
    turnStatusMeta,
  } = params;
  const focusInlineText = resolveFocusInlineText(focusBlock);
  const latestThinkingPreview = resolveLatestThinkingPreview(orderedBlocks);
  const normalizedOverview = turnStatusMeta.overviewText.trim();

  const detail =
    compactTone === "running"
      ? focusInlineText ||
        displayModelSummaryText ||
        promptPreview ||
        focusBlock?.title ||
        null
      : compactTone === "waiting" ||
          compactTone === "failed" ||
          compactTone === "paused"
        ? focusInlineText ||
          displayModelSummaryText ||
          promptPreview ||
          focusBlock?.title ||
          null
        : latestThinkingPreview.text ||
          focusInlineText ||
          displayModelSummaryText ||
          promptPreview ||
          null;

  const fallbackDetail =
    compactTone === "done" && latestThinkingPreview.stageLabel
      ? "思考与计划"
      : focusBlock?.title || (flowBlockCount > 0 ? `${flowBlockCount} 段流程` : null);
  const distinctDetail =
    detail?.trim() && detail.trim() !== normalizedOverview
      ? detail.trim()
      : fallbackDetail;

  const stageLabel =
    compactTone === "running"
      ? flowBlockCount > 1
        ? focusBlockStageLabel
        : null
      : compactTone === "done" && latestThinkingPreview.text && flowBlockCount > 1
        ? latestThinkingPreview.stageLabel
        : null;

  const detailText =
    shortenInlineText(
      distinctDetail || "执行过程已收起，点击查看完整过程。",
      compactTone === "running" ? 88 : 78,
    ) || "执行过程已收起，点击查看完整过程。";
  const segments = [turnStatusMeta.label];
  if (stageLabel) {
    segments.push(stageLabel);
  }
  if (detailText && detailText !== turnStatusMeta.label) {
    segments.push(detailText);
  }

  return {
    statusLabel: turnStatusMeta.label,
    stageLabel,
    detailText,
    combinedText: segments.join(" · "),
  };
}

function TimelineCompactStatusIcon({
  tone,
}: {
  tone: TimelineCompactTone;
}) {
  if (tone === "running") {
    return (
      <span
        className="relative flex h-5 w-5 shrink-0 items-center justify-center"
        data-state={tone}
        data-testid="agent-thread-details-inline-icon"
      >
        <span
          className="absolute inset-0 rounded-full bg-[conic-gradient(from_180deg_at_50%_50%,#38bdf8_0deg,#22c55e_140deg,#fbbf24_260deg,#38bdf8_360deg)] opacity-95 animate-spin"
          style={{ animationDuration: "2.8s" }}
        />
        <span className="absolute inset-[1.5px] rounded-full bg-background/90" />
        <span className="absolute inset-[3px] rounded-full bg-[linear-gradient(135deg,rgba(56,189,248,0.22),rgba(34,197,94,0.18),rgba(251,191,36,0.22))] shadow-[0_0_14px_rgba(56,189,248,0.28)]" />
        <Loader2
          className="relative h-2.5 w-2.5 animate-spin text-sky-600"
          style={{ animationDuration: "1.15s" }}
        />
      </span>
    );
  }

  if (tone === "waiting") {
    return (
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-amber-200/80 bg-amber-100 text-amber-700 shadow-sm shadow-amber-950/5"
        data-state={tone}
        data-testid="agent-thread-details-inline-icon"
      >
        <Clock3 className="h-3 w-3" />
      </span>
    );
  }

  if (tone === "failed") {
    return (
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-rose-200/80 bg-rose-100 text-rose-700 shadow-sm shadow-rose-950/5"
        data-state={tone}
        data-testid="agent-thread-details-inline-icon"
      >
        <AlertTriangle className="h-3 w-3" />
      </span>
    );
  }

  if (tone === "paused") {
    return (
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-slate-200/80 bg-slate-100 text-slate-600 shadow-sm shadow-slate-950/5"
        data-state={tone}
        data-testid="agent-thread-details-inline-icon"
      >
        <Clock3 className="h-3 w-3" />
      </span>
    );
  }

  return (
    <span
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-emerald-200/80 bg-emerald-100 text-emerald-700 shadow-sm shadow-emerald-950/5"
      data-state={tone}
      data-testid="agent-thread-details-inline-icon"
    >
      <CheckCircle2 className="h-3 w-3" />
    </span>
  );
}

function TimelineBlockCard({
  block,
  index,
  isLast,
  emphasis,
  isExpanded,
  onFileClick,
  onOpenArtifactFromTimeline,
  onOpenSavedSiteContent,
  onOpenSubagentSession,
  onPermissionResponse,
  focusedItemId,
  focusRequestKey,
}: {
  block: AgentThreadOrderedBlock;
  index: number;
  isLast: boolean;
  emphasis: "active" | "default" | "quiet";
  isExpanded: boolean;
  onFileClick?: (fileName: string, content: string) => void;
  onOpenArtifactFromTimeline?: (target: ArtifactTimelineOpenTarget) => void;
  onOpenSavedSiteContent?: (target: SiteSavedContentTarget) => void;
  onOpenSubagentSession?: (sessionId: string) => void;
  onPermissionResponse?: (response: ConfirmResponse) => void;
  focusedItemId?: string | null;
  focusRequestKey?: number;
}) {
  const Icon = resolveGroupIcon(block.kind);
  const timestamp = formatTimestamp(block.startedAt);
  const dataTestId = `agent-thread-block:${index + 1}:${block.kind}`;
  const isCompact = isCompactTechnicalBlock(block);
  const isActive = emphasis === "active";
  const isQuiet = emphasis === "quiet";
  const stageLabel = `步骤 ${String(index + 1).padStart(2, "0")}`;
  const focusedEntryRef = useRef<HTMLDivElement | null>(null);
  const hasFocusedItem = Boolean(
    focusedItemId && block.items.some((item) => item.id === focusedItemId),
  );
  const detailEntries = block.items.flatMap((item) => {
    const content =
      block.kind === "thinking"
        ? renderThinkingItemDetails(item)
        : renderGroupItemDetails(
            item,
            onFileClick,
            onOpenArtifactFromTimeline,
            onOpenSavedSiteContent,
            onOpenSubagentSession,
            onPermissionResponse,
          );

    return content ? [{ id: item.id, content }] : [];
  });
  const hasDetailEntries = detailEntries.length > 0;
  const detailsExpanded = isExpanded || hasFocusedItem;
  const cardClassName = isActive
    ? "overflow-hidden rounded-2xl border border-primary/25 bg-primary/[0.045] shadow-md shadow-primary/10"
    : isCompact
      ? "overflow-hidden rounded-2xl border border-border/45 bg-background/60"
      : isQuiet
        ? "overflow-hidden rounded-2xl border border-border/45 bg-background/60"
        : "overflow-hidden rounded-2xl border border-border/60 bg-background/75";
  const summaryClassName = isCompact
    ? "flex items-start gap-3 px-4 py-2.5"
    : "flex items-start gap-3 px-4 py-3";
  const interactiveSummaryClassName = cn(
    summaryClassName,
    hasDetailEntries ? "cursor-pointer" : "cursor-default",
  );

  useEffect(() => {
    if (!hasFocusedItem || !focusRequestKey) {
      return;
    }

    focusedEntryRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [focusRequestKey, hasFocusedItem]);

  return (
    <div
      className="relative pl-14"
      data-testid={`${dataTestId}:shell`}
      data-emphasis={emphasis}
    >
      {!isLast ? (
        <div
          className={
            isActive
              ? "absolute left-4 top-11 bottom-0 w-px rounded-full bg-gradient-to-b from-primary/50 to-border/30"
              : "absolute left-4 top-11 bottom-0 w-px rounded-full bg-gradient-to-b from-border/80 to-border/30"
          }
          data-testid={`${dataTestId}:rail`}
        />
      ) : null}
      <div className="absolute left-0 top-3 flex flex-col items-center gap-2">
        <div
          className={
            isActive
              ? "flex h-8 w-8 items-center justify-center rounded-full border border-primary/25 bg-primary/15 text-sm font-semibold text-primary shadow-md shadow-primary/20"
              : isQuiet
                ? "flex h-8 w-8 items-center justify-center rounded-full border border-border/60 bg-background text-sm font-semibold text-muted-foreground"
                : "flex h-8 w-8 items-center justify-center rounded-full border border-primary/15 bg-primary/10 text-sm font-semibold text-primary shadow-sm shadow-primary/10"
          }
        >
          {index + 1}
        </div>
        <div
          className={
            isActive
              ? "flex h-8 w-8 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-primary shadow-sm shadow-primary/15"
              : isQuiet
                ? "flex h-8 w-8 items-center justify-center rounded-full border border-border/60 bg-background text-muted-foreground"
                : "flex h-8 w-8 items-center justify-center rounded-full border border-border/70 bg-background text-primary"
          }
        >
          <Icon className="h-4 w-4" />
        </div>
      </div>
      {hasDetailEntries ? (
        <details
          className={cardClassName}
          data-testid={dataTestId}
          data-emphasis={emphasis}
          open={detailsExpanded}
        >
          <summary className={interactiveSummaryClassName}>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-medium tracking-wide text-muted-foreground">
                  {stageLabel}
                </span>
                <span className="text-sm font-medium text-foreground">
                  {block.title}
                </span>
                <Badge variant="outline">{block.countLabel}</Badge>
                <Badge variant={resolveStatusBadgeVariant(block.status)}>
                  {block.status === "in_progress" ? (
                    <span className="inline-flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {resolveItemStatusLabel(block.status)}
                    </span>
                  ) : (
                    resolveItemStatusLabel(block.status)
                  )}
                </Badge>
                {timestamp ? (
                  <span className="ml-auto text-xs text-muted-foreground">
                    {timestamp}
                  </span>
                ) : null}
              </div>
              {isCompact ? (
                <div className="mt-1.5 text-sm text-muted-foreground">
                  {resolveCompactTechnicalSummary(block)}
                </div>
              ) : block.previewLines.length > 0 ? (
                <div className="mt-2 space-y-1">
                  {block.previewLines.map((line) => (
                    <div key={line} className="text-sm text-muted-foreground">
                      {line}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-2 text-sm text-muted-foreground">
                  该分组记录已收起，可按需展开查看。
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {isCompact ? "展开查看" : block.rawDetailLabel}
              </span>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </div>
          </summary>
          <div
            className="space-y-3 border-t border-border/60 px-4 py-3"
            data-testid={`${dataTestId}:details`}
          >
            {detailEntries.map((entry) => (
              <div
                key={entry.id}
                data-thread-item-id={entry.id}
                ref={entry.id === focusedItemId ? focusedEntryRef : null}
                className={cn(
                  entry.id === focusedItemId &&
                    "rounded-2xl ring-2 ring-sky-200 ring-offset-2 ring-offset-white",
                )}
              >
                {entry.content}
              </div>
            ))}
          </div>
        </details>
      ) : (
        <div
          className={cardClassName}
          data-testid={dataTestId}
          data-emphasis={emphasis}
        >
          <div className={interactiveSummaryClassName}>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-medium tracking-wide text-muted-foreground">
                  {stageLabel}
                </span>
                <span className="text-sm font-medium text-foreground">
                  {block.title}
                </span>
                <Badge variant="outline">{block.countLabel}</Badge>
                <Badge variant={resolveStatusBadgeVariant(block.status)}>
                  {block.status === "in_progress" ? (
                    <span className="inline-flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {resolveItemStatusLabel(block.status)}
                    </span>
                  ) : (
                    resolveItemStatusLabel(block.status)
                  )}
                </Badge>
                {timestamp ? (
                  <span className="ml-auto text-xs text-muted-foreground">
                    {timestamp}
                  </span>
                ) : null}
              </div>
              {isCompact ? (
                <div className="mt-1.5 text-sm text-muted-foreground">
                  {resolveCompactTechnicalSummary(block)}
                </div>
              ) : block.previewLines.length > 0 ? (
                <div className="mt-2 space-y-1">
                  {block.previewLines.map((line) => (
                    <div key={line} className="text-sm text-muted-foreground">
                      {line}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-2 text-sm text-muted-foreground">
                  该分组记录已收起，可按需展开查看。
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">已展示完整内容</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export const AgentThreadTimeline: React.FC<AgentThreadTimelineProps> = ({
  turn,
  items,
  threadRead,
  actionRequests = [],
  isCurrentTurn = false,
  onFileClick,
  onOpenArtifactFromTimeline,
  onOpenSavedSiteContent,
  onOpenSubagentSession,
  onPermissionResponse,
  focusedItemId = null,
  focusRequestKey = 0,
}) => {
  const visibleItems = useMemo(
    () =>
      items.filter(
        (item) => item.type !== "user_message" && item.type !== "agent_message",
      ),
    [items],
  );

  const displayModel = useMemo(
    () => buildAgentThreadDisplayModel(visibleItems),
    [visibleItems],
  );
  const actionableCount = displayModel.groups.reduce(
    (count, group) => count + group.items.length,
    0,
  );
  const flowBlockCount = displayModel.orderedBlocks.length;
  const activeBlockIndex = resolveActiveBlockIndex(displayModel.orderedBlocks);
  const focusBlockIndex = resolveFocusBlockIndex({
    blocks: displayModel.orderedBlocks,
    turn,
    actionRequests,
    activeBlockIndex,
  });
  const expandedBlockIndexes = resolveExpandedBlockIndexes({
    blocks: displayModel.orderedBlocks,
    isCurrentTurn,
    focusBlockIndex,
    turn,
  });
  const focusBlock =
    focusBlockIndex >= 0 ? displayModel.orderedBlocks[focusBlockIndex] : null;
  const focusBlockStageLabel =
    focusBlockIndex >= 0
      ? `步骤 ${String(focusBlockIndex + 1).padStart(2, "0")}`
      : null;
  const promptPreview = shortenInlineText(turn.prompt_text, 78);
  const turnStatusMeta = resolveTurnStatusMeta({
    turn,
    items: visibleItems,
    actionRequests,
    summaryText: displayModel.summaryText,
    actionableCount,
  });
  const defaultDetailsExpanded = true; // 强制始终展开，显示时间线
  const [detailsExpanded, setDetailsExpanded] = useState(defaultDetailsExpanded);
  const lastTurnIdRef = useRef(turn.id);

  useEffect(() => {
    if (lastTurnIdRef.current !== turn.id) {
      lastTurnIdRef.current = turn.id;
      setDetailsExpanded(defaultDetailsExpanded);
      return;
    }

    if (defaultDetailsExpanded) {
      setDetailsExpanded(true);
    }
  }, [defaultDetailsExpanded, turn.id]);

  const compactReliabilityBadges = useMemo(
    () => buildCompactReliabilityBadges(turn, threadRead),
    [threadRead, turn],
  );
  const hasFocusedItem = useMemo(
    () =>
      Boolean(
        focusedItemId &&
          displayModel.orderedBlocks.some((block) =>
            block.items.some((item) => item.id === focusedItemId),
          ),
      ),
    [displayModel.orderedBlocks, focusedItemId],
  );

  useEffect(() => {
    if (!hasFocusedItem || focusRequestKey <= 0) {
      return;
    }

    setDetailsExpanded(true);
  }, [focusRequestKey, hasFocusedItem]);

  if (visibleItems.length === 0) {
    return null;
  }

  const toggleActionLabel = detailsExpanded
    ? "收起执行过程"
    : isCurrentTurn
      ? "查看当前进展细节"
      : "展开执行过程";
  const compactTone = resolveCompactTone({ turn, turnStatusMeta });
  const collapsedProcess = resolveCollapsedProcessSnapshot({
    compactTone,
    displayModelSummaryText: displayModel.summaryText,
    flowBlockCount,
    focusBlock,
    focusBlockStageLabel,
    orderedBlocks: displayModel.orderedBlocks,
    promptPreview,
    turnStatusMeta,
  });
  const showRunningAccent = compactTone === "running";
  const timelineOverviewText = turnStatusMeta.overviewText.trim() || null;
  const hasSummarySupportContent =
    Boolean(promptPreview) ||
    Boolean(focusBlock) ||
    displayModel.summaryChips.length > 0;
  const focusBlockPreviewText =
    focusBlock?.previewLines.find((line) => line.trim().length > 0)?.trim() || null;
  const summaryPanelTextCandidate =
    displayModel.summaryText?.trim() &&
    displayModel.summaryText.trim() !== timelineOverviewText
      ? displayModel.summaryText.trim()
      : timelineOverviewText;
  const summaryPanelText =
    summaryPanelTextCandidate &&
    (summaryPanelTextCandidate !== timelineOverviewText ||
      !hasSummarySupportContent) &&
    summaryPanelTextCandidate !== focusBlockPreviewText
      ? summaryPanelTextCandidate
      : null;
  const overviewShellClassName = cn(
    "mb-2 max-w-4xl rounded-2xl border px-3 py-2.5 shadow-sm shadow-slate-950/5",
    compactTone === "running" &&
      "border-sky-200/70 bg-sky-50/72",
    compactTone === "waiting" &&
      "border-amber-200/70 bg-amber-50/78",
    compactTone === "failed" &&
      "border-rose-200/70 bg-rose-50/78",
    compactTone === "paused" &&
      "border-slate-200/80 bg-slate-50/82",
    compactTone === "done" &&
      "border-border/55 bg-background/58",
  );
  const overviewLabelClassName = cn(
    "text-[11px] font-medium",
    compactTone === "running" && "text-sky-700",
    compactTone === "waiting" && "text-amber-700",
    compactTone === "failed" && "text-rose-700",
    compactTone === "paused" && "text-slate-600",
    compactTone === "done" && "text-muted-foreground",
  );
  const overviewTextClassName = cn(
    "mt-1.5 text-sm leading-6",
    compactTone === "running" && "text-sky-950/90",
    compactTone === "waiting" && "text-amber-950/90",
    compactTone === "failed" && "text-rose-950/90",
    compactTone === "paused" && "text-slate-700",
    compactTone === "done" && "text-foreground/90",
  );

  return (
    <div className={detailsExpanded ? "mt-3" : "mt-2"}>
      {timelineOverviewText && !detailsExpanded ? (
        <div
          className={overviewShellClassName}
          data-testid="agent-thread-overview"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className={overviewLabelClassName}>当前进展</span>
            <Badge
              variant={turnStatusMeta.badgeVariant}
              className={turnStatusMeta.badgeClassName}
            >
              {turnStatusMeta.label}
            </Badge>
            {compactReliabilityBadges.map((badge) => (
              <Badge
                key={badge.key}
                variant="outline"
                className={resolveReliabilityBadgeClassName(badge.tone)}
                data-testid={`agent-thread-compact-${badge.key}`}
              >
                {badge.label}
              </Badge>
            ))}
            <span className="text-xs text-muted-foreground">
              {isCurrentTurn ? "当前任务" : "历史记录"}
            </span>
            <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Clock3 className="h-3.5 w-3.5" />
              <span>{formatTimestamp(turn.started_at) || "刚刚"}</span>
            </span>
          </div>
          <div className={overviewTextClassName}>{timelineOverviewText}</div>
        </div>
      ) : null}

      <Collapsible open={detailsExpanded} onOpenChange={setDetailsExpanded}>
        {!detailsExpanded ? (
          <CollapsibleTrigger asChild>
            <button
              type="button"
              aria-label={toggleActionLabel}
              title={collapsedProcess.combinedText}
              className={cn(
                "group relative flex w-full max-w-4xl items-center gap-3 overflow-hidden rounded-2xl border bg-background/88 px-3.5 py-2.5 text-left shadow-sm transition-all duration-200 hover:bg-background",
                compactTone === "running" &&
                  "border-sky-200/80 shadow-[0_10px_28px_-22px_rgba(56,189,248,0.75)] hover:border-sky-300/80",
                compactTone === "waiting" &&
                  "border-amber-200/80 bg-amber-50/72 hover:border-amber-300/80",
                compactTone === "failed" &&
                  "border-rose-200/80 bg-rose-50/72 hover:border-rose-300/80",
                compactTone === "paused" &&
                  "border-slate-200/80 bg-slate-50/78 hover:border-slate-300/80",
                compactTone === "done" &&
                  "border-border/60 hover:border-emerald-200/70",
              )}
              data-testid="agent-thread-details-toggle"
            >
              {showRunningAccent ? (
                <span className="pointer-events-none absolute inset-y-3 left-0.5 w-0.5 rounded-full bg-gradient-to-b from-sky-400/30 via-sky-400 to-emerald-400/50 animate-pulse" />
              ) : null}

              <div className="flex min-w-0 flex-1 items-start gap-3">
                <TimelineCompactStatusIcon tone={compactTone} />

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className="font-medium tracking-wide text-slate-500">
                      执行过程
                    </span>
                    <span className="rounded-full border border-border/60 bg-background/70 px-2 py-0.5">
                      {flowBlockCount} 段
                    </span>
                    {collapsedProcess.stageLabel ? (
                      <span
                        className="rounded-full border border-border/60 bg-background/70 px-2 py-0.5"
                        data-testid="agent-thread-details-stage"
                      >
                        {collapsedProcess.stageLabel}
                      </span>
                    ) : null}
                    <Badge
                      variant={turnStatusMeta.badgeVariant}
                      className={turnStatusMeta.badgeClassName}
                    >
                      {collapsedProcess.statusLabel}
                    </Badge>
                    {compactReliabilityBadges.map((badge) => (
                      <Badge
                        key={badge.key}
                        variant="outline"
                        className={resolveReliabilityBadgeClassName(badge.tone)}
                        data-testid={`agent-thread-collapsed-${badge.key}`}
                      >
                        {badge.label}
                      </Badge>
                    ))}
                  </div>

                  <div
                    className="mt-1 truncate text-sm font-medium text-foreground"
                    data-testid="agent-thread-details-inline-text"
                  >
                    {collapsedProcess.detailText}
                  </div>
                </div>
              </div>

              <div className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                <span>查看细节</span>
                    <ChevronDown className="h-3.5 w-3.5 transition-transform duration-200" />
              </div>
            </button>
          </CollapsibleTrigger>
        ) : null}

        <CollapsibleContent>
          <div
            className={cn("space-y-3", detailsExpanded ? "" : "mt-3")}
            data-testid="agent-thread-details"
          >
            <div
              className="relative pl-14"
              data-testid="agent-thread-summary-shell"
            >
              <div className="absolute left-0 top-2.5 flex h-8 w-8 items-center justify-center rounded-full border border-primary/15 bg-primary/10 text-primary shadow-sm shadow-primary/10">
                <Sparkles className="h-4 w-4" />
              </div>
              <div
                className="rounded-xl border border-border/50 bg-background/70 px-4 py-2.5"
                data-testid="agent-thread-summary"
              >
                <div
                  className="flex flex-wrap items-center gap-2"
                  data-testid="agent-thread-summary-header"
                >
                  <div className="text-xs font-medium tracking-wide text-muted-foreground">
                    {isCurrentTurn ? "当前任务摘要" : "任务摘要"}
                  </div>
                  {compactReliabilityBadges.map((badge) => (
                    <Badge
                      key={badge.key}
                      variant="outline"
                      className={resolveReliabilityBadgeClassName(badge.tone)}
                      data-testid={`agent-thread-summary-${badge.key}`}
                    >
                      {badge.label}
                    </Badge>
                  ))}
                  <button
                    type="button"
                    aria-label="收起细节"
                    onClick={() => setDetailsExpanded(false)}
                    className="ml-auto inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/70 px-2.5 py-1 text-xs text-muted-foreground transition hover:border-border hover:bg-background hover:text-foreground"
                    data-testid="agent-thread-summary-collapse"
                  >
                    <span>收起细节</span>
                    <ChevronDown className="h-3.5 w-3.5 rotate-180" />
                  </button>
                  <div className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock3 className="h-3.5 w-3.5" />
                    <span>{formatTimestamp(turn.started_at) || "刚刚"}</span>
                  </div>
                </div>

                {summaryPanelText ? (
                  <div className="mt-1.5 text-sm leading-6 text-foreground">
                    {summaryPanelText}
                  </div>
                ) : null}

                {promptPreview || focusBlock ? (
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {promptPreview ? (
                      <div
                        className="rounded-xl border border-border/60 bg-background/80 px-3 py-2"
                        data-testid="agent-thread-goal"
                      >
                        <div className="text-[11px] font-medium tracking-wide text-muted-foreground">
                          用户目标
                        </div>
                        <div className="mt-1 text-sm text-foreground">
                          {promptPreview}
                        </div>
                      </div>
                    ) : null}

                    {focusBlock ? (
                      <div
                        className="rounded-xl border border-border/60 bg-background/80 px-3 py-2"
                        data-testid="agent-thread-focus"
                      >
                        <div className="text-[11px] font-medium tracking-wide text-muted-foreground">
                          当前聚焦
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          {focusBlockStageLabel ? (
                            <Badge variant="outline">{focusBlockStageLabel}</Badge>
                          ) : null}
                          <span className="text-sm font-medium text-foreground">
                            {focusBlock.title}
                          </span>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {displayModel.summaryChips.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {displayModel.summaryChips.map((chip) => (
                      <SummaryChip key={chip.kind} chip={chip} />
                    ))}
                  </div>
                ) : null}

                {turn.error_message &&
                turnStatusMeta.badgeVariant === "destructive" ? (
                  <div className="mt-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                    {turn.error_message}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="space-y-3" data-testid="agent-thread-flow">
              {/* 新的时间线设计：将工具调用内联展示 */}
              {items
                .filter(
                  (item) =>
                    item.type === "tool_call" ||
                    item.type === "command_execution" ||
                    item.type === "web_search"
                )
                .map((item, index, filteredItems) => (
                  <TimelineInlineItem
                    key={item.id}
                    item={item}
                    isLast={index === filteredItems.length - 1}
                  />
                ))}

              {/* 保留原有的步骤列表作为备用 */}
              {false && displayModel.orderedBlocks.map((block, index) => (
                <TimelineBlockCard
                  key={block.id}
                  block={block}
                  index={index}
                  isLast={index === displayModel.orderedBlocks.length - 1}
                  emphasis={
                    activeBlockIndex === index
                      ? "active"
                      : block.status === "completed"
                        ? "quiet"
                        : "default"
                  }
                  isExpanded={expandedBlockIndexes.has(index)}
                  onFileClick={onFileClick}
                  onOpenArtifactFromTimeline={onOpenArtifactFromTimeline}
                  onOpenSavedSiteContent={onOpenSavedSiteContent}
                  onOpenSubagentSession={onOpenSubagentSession}
                  onPermissionResponse={onPermissionResponse}
                  focusedItemId={focusedItemId}
                  focusRequestKey={focusRequestKey}
                />
              ))}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
};

export default AgentThreadTimeline;
