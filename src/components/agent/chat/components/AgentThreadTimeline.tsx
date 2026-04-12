import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  ChevronDown,
  Clock3,
  ListChecks,
  Loader2,
  ShieldAlert,
  Sparkles,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
} from "../utils/agentThreadGrouping";
import type { AgentRuntimeThreadReadModel } from "@/lib/api/agentRuntime";
import { isActionRequestA2UICompatible } from "../utils/actionRequestA2UI";
import { resolveInternalImageTaskDisplayName } from "../utils/internalImagePlaceholder";
import { isHiddenConversationArtifactPath } from "../utils/internalArtifactVisibility";
import { parseAIResponse } from "@/lib/workspace/a2ui";
import type { A2UIResponse } from "@/lib/workspace/a2ui";
import { TIMELINE_A2UI_TASK_CARD_PRESET } from "@/lib/workspace/a2ui";
import { cn } from "@/lib/utils";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { ActionRequestA2UIPreviewCard } from "./ActionRequestA2UIPreviewCard";
import { A2UITaskCard, A2UITaskLoadingCard } from "./A2UITaskCard";
import { ToolCallItem } from "./ToolCallDisplay";
import { DecisionPanel } from "./DecisionPanel";
import { AgentThreadTimelineArtifactCard } from "./AgentThreadTimelineArtifactCard";
import type { ArtifactTimelineOpenTarget } from "../utils/artifactTimelineNavigation";
import {
  isInternalRoutingTurnSummaryText,
  normalizeTurnSummaryDisplayText,
} from "../utils/turnSummaryPresentation";

interface AgentThreadTimelineProps {
  turn: AgentThreadTurn;
  items: AgentThreadItem[];
  threadRead?: AgentRuntimeThreadReadModel | null;
  actionRequests?: ActionRequired[];
  isCurrentTurn?: boolean;
  placement?: "leading" | "trailing" | "default";
  onFileClick?: (fileName: string, content: string) => void;
  onOpenArtifactFromTimeline?: (target: ArtifactTimelineOpenTarget) => void;
  onOpenSavedSiteContent?: (target: SiteSavedContentTarget) => void;
  onOpenSubagentSession?: (sessionId: string) => void;
  onPermissionResponse?: (response: ConfirmResponse) => void;
  focusedItemId?: string | null;
  focusRequestKey?: number;
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

function normalizeComparableThinkingText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function resolveReasoningDisplayText(
  item: Extract<AgentThreadItem, { type: "reasoning" }>,
): {
  summaryText: string;
  bodyText: string;
  combinedText: string;
} {
  const summaryText = (item.summary || [])
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n\n");
  const bodyText = item.text.trim();

  if (!summaryText) {
    return {
      summaryText: "",
      bodyText,
      combinedText: bodyText,
    };
  }

  if (!bodyText) {
    return {
      summaryText,
      bodyText: "",
      combinedText: summaryText,
    };
  }

  if (
    normalizeComparableThinkingText(summaryText) ===
    normalizeComparableThinkingText(bodyText)
  ) {
    return {
      summaryText,
      bodyText: "",
      combinedText: summaryText,
    };
  }

  return {
    summaryText,
    bodyText,
    combinedText: `${summaryText}\n\n${bodyText}`,
  };
}

function resolveThinkingDisplayText(
  item: Extract<AgentThreadItem, { type: "reasoning" }>,
): string {
  return resolveReasoningDisplayText(item).combinedText;
}

function resolveTurnSummaryDisplayText(
  item: Extract<AgentThreadItem, { type: "turn_summary" }>,
): string {
  return normalizeTurnSummaryDisplayText(item.text);
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
                success:
                  item.status === "completed" && item.error === undefined,
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
    <div className="py-1.5">
      <div className="flex items-start gap-2.5">
        <div className="flex h-5 w-5 shrink-0 items-center justify-center text-slate-400">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm leading-6 text-slate-900">{title}</div>
            {badge ? <div>{badge}</div> : null}
            {timestamp ? (
              <div className="text-xs text-slate-400">{timestamp}</div>
            ) : null}
          </div>
          <div className="ml-0 mt-1.5">{children}</div>
        </div>
      </div>
    </div>
  );
}

function ThinkingItemCard({
  item,
}: {
  item: Extract<AgentThreadItem, { type: "reasoning" | "turn_summary" }>;
}) {
  const displayText = useMemo(
    () =>
      item.type === "reasoning"
        ? resolveThinkingDisplayText(item)
        : resolveTurnSummaryDisplayText(item),
    [item],
  );
  const parsedContent = useMemo(
    () => parseAIResponse(displayText, false),
    [displayText],
  );
  const hasStructuredPreview =
    parsedContent.hasA2UI || parsedContent.hasPending;
  const shouldHideTurnSummaryContent =
    item.type === "turn_summary" &&
    !hasStructuredPreview &&
    isInternalRoutingTurnSummaryText(displayText);

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
              subtitle="这一步还在整理，稍等一下。"
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
  ) : shouldHideTurnSummaryContent ? null : (
    <MarkdownRenderer content={displayText} />
  );
  const statusLabel =
    item.type === "turn_summary"
      ? item.status === "in_progress"
        ? "处理中"
        : "当前进展"
      : item.status === "in_progress"
        ? "思考中"
        : null;
  const ToneIcon =
    item.type === "turn_summary"
      ? item.status === "in_progress"
        ? Loader2
        : Clock3
      : item.status === "in_progress"
        ? Loader2
        : Sparkles;

  return (
    <div className="py-1.5">
      <div className="flex items-start gap-2.5">
        <div className="flex h-5 w-5 shrink-0 items-center justify-center text-slate-400">
          <ToneIcon
            className={cn(
              "h-4 w-4",
              item.status === "in_progress" && "animate-spin text-sky-600",
            )}
          />
        </div>
        <div className="min-w-0 flex-1">
          {statusLabel ? (
            <div className="mb-1 text-xs text-slate-500">{statusLabel}</div>
          ) : null}
          {content ? (
            <div className="text-sm leading-7 text-slate-800">{content}</div>
          ) : null}
        </div>
      </div>
    </div>
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
      ? "压了上下文"
      : "正在压上下文";
  const detail =
    item.detail?.trim() ||
    (item.stage === "completed" || item.status === "completed"
      ? "把前面的对话压成摘要了，后面接着做。"
      : "在把前面的对话压成摘要，马上继续。");

  return (
    <SurfaceCard
      icon={Sparkles}
      title={title}
      badge={<Badge variant="outline">{triggerLabel}</Badge>}
    >
      <div className="text-sm text-slate-500">{detail}</div>
      {item.status === "in_progress" ? (
        <div className="mt-1 inline-flex items-center gap-1 text-xs text-slate-500">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>压缩中</span>
        </div>
      ) : null}
    </SurfaceCard>
  );
}

function InlinePlanBlock({
  content,
  isComplete,
}: {
  content: string;
  isComplete: boolean;
}) {
  if (!content.trim()) {
    return null;
  }

  return (
    <div className="py-1.5">
      <div className="flex items-start gap-2.5">
        <div className="flex h-5 w-5 shrink-0 items-center justify-center text-slate-400">
          {isComplete ? (
            <ListChecks className="h-4 w-4" />
          ) : (
            <Loader2 className="h-4 w-4 animate-spin text-sky-600" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 text-xs text-slate-500">
            {isComplete ? "定了这些步骤" : "还在排步骤"}
          </div>
          <div className="text-sm leading-7 text-slate-800">
            <MarkdownRenderer content={content} />
          </div>
        </div>
      </div>
    </div>
  );
}

function renderThinkingItemDetails(item: AgentThreadItem) {
  if (item.type === "plan") {
    return (
      <InlinePlanBlock
        content={item.text}
        isComplete={item.status !== "in_progress"}
      />
    );
  }

  if (item.type === "reasoning" || item.type === "turn_summary") {
    return <ThinkingItemCard item={item} />;
  }

  if (item.type === "context_compaction") {
    return <ContextCompactionCard item={item} />;
  }

  return null;
}

function isThinkingTimelineItem(
  item: AgentThreadItem,
): item is Extract<
  AgentThreadItem,
  { type: "plan" | "reasoning" | "turn_summary" | "context_compaction" }
> {
  return (
    item.type === "plan" ||
    item.type === "reasoning" ||
    item.type === "turn_summary" ||
    item.type === "context_compaction"
  );
}

function isToolExecutionTimelineItem(item: AgentThreadItem): boolean {
  return (
    item.type === "tool_call" ||
    item.type === "command_execution" ||
    item.type === "web_search"
  );
}

function extractCompactThinkingParts(
  item: Extract<
    AgentThreadItem,
    { type: "plan" | "reasoning" | "turn_summary" | "context_compaction" }
  >,
) {
  if (item.type === "context_compaction") {
    const title =
      item.stage === "completed" || item.status === "completed"
        ? "压了上下文"
        : "正在压上下文";
    const detail =
      item.detail?.trim() ||
      (item.stage === "completed" || item.status === "completed"
        ? "把前面的对话压成摘要了，后面接着做。"
        : "在把前面的对话压成摘要，马上继续。");
    return { title, detail };
  }

  if (item.type === "plan") {
    return {
      title: item.status === "in_progress" ? "还在排步骤" : "定了这些步骤",
      detail: item.text.trim(),
    };
  }

  if (item.type === "reasoning") {
    const { summaryText, bodyText, combinedText } =
      resolveReasoningDisplayText(item);
    const previewSource = summaryText || combinedText;
    const lines = previewSource
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const [
      title = item.status === "in_progress" ? "思考中" : "已完成思考",
      ...rest
    ] = lines;
    const detail = [rest.join("\n").trim(), bodyText]
      .filter(Boolean)
      .join("\n\n");

    const parsed = parseAIResponse(combinedText, false);
    if (parsed.hasA2UI || parsed.hasPending) {
      return null;
    }

    return {
      title,
      detail,
    };
  }

  if (item.type === "turn_summary") {
    const displayText = resolveTurnSummaryDisplayText(item);
    const parsed = parseAIResponse(displayText, false);
    if (parsed.hasA2UI || parsed.hasPending) {
      return null;
    }

    return {
      title: item.status === "in_progress" ? "处理中" : "当前进展",
      detail: isInternalRoutingTurnSummaryText(displayText) ? "" : displayText,
    };
  }

  return null;
}

function GroupedThinkingRow({
  item,
  groupMarker = "·",
}: {
  item: Extract<
    AgentThreadItem,
    { type: "plan" | "reasoning" | "turn_summary" | "context_compaction" }
  >;
  groupMarker?: string;
}) {
  const compact = extractCompactThinkingParts(item);

  if (!compact) {
    return renderThinkingItemDetails(item);
  }

  const ToneIcon =
    item.type === "plan"
      ? item.status === "in_progress"
        ? Loader2
        : ListChecks
      : item.type === "turn_summary"
        ? item.status === "in_progress"
          ? Loader2
          : Clock3
        : item.status === "in_progress"
          ? Loader2
          : Sparkles;

  return (
    <div className="flex items-start gap-2 py-1.5">
      <span className="pt-0.5 font-mono text-xs text-slate-400">
        {groupMarker}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <ToneIcon
            className={cn(
              "mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400",
              item.status === "in_progress" && "animate-spin text-sky-600",
            )}
          />
          <div className="min-w-0 flex-1">
            <div className="text-sm leading-6 text-slate-700">
              {compact.title}
            </div>
            {compact.detail ? (
              <div className="mt-0.5 text-sm leading-6 text-slate-500">
                <MarkdownRenderer content={compact.detail} />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function renderGroupItemDetails(
  item: AgentThreadItem,
  onFileClick?: (fileName: string, content: string) => void,
  onOpenArtifactFromTimeline?: (target: ArtifactTimelineOpenTarget) => void,
  onOpenSavedSiteContent?: (target: SiteSavedContentTarget) => void,
  onOpenSubagentSession?: (sessionId: string) => void,
  onPermissionResponse?: (response: ConfirmResponse) => void,
  options?: {
    groupedToolCall?: boolean;
    groupMarker?: string;
  },
) {
  const toolCall = toToolCallState(item);
  const actionRequest = toActionRequired(item);
  const timestamp = formatTimestamp(item.completed_at || item.updated_at);
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
      <ToolCallItem
        toolCall={toolCall}
        defaultExpanded={item.status !== "completed"}
        onFileClick={onFileClick}
        onOpenSavedSiteContent={onOpenSavedSiteContent}
        grouped={options?.groupedToolCall}
        groupMarker={options?.groupMarker}
      />
    );
  }

  if (item.type === "file_artifact") {
    if (isHiddenConversationArtifactPath(item.path)) {
      return null;
    }

    return (
      <AgentThreadTimelineArtifactCard
        item={item}
        timestamp={timestamp}
        onFileClick={onFileClick}
        onOpenArtifactFromTimeline={onOpenArtifactFromTimeline}
      />
    );
  }

  if (item.type === "subagent_activity") {
    const subagentSessionId = item.session_id?.trim();
    const displayTitle = resolveInternalImageTaskDisplayName(item.title) || "子任务";

    return (
      <SurfaceCard
        icon={Bot}
        title={`子任务：${displayTitle}`}
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
              查看子任务详情
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
        title={item.type === "warning" ? "收到提醒" : "碰到错误"}
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
    <div className="py-1.5">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">{item.type}</span>
        <Badge
          variant={resolveStatusBadgeVariant(item.status)}
          className="ml-auto"
        >
          {resolveItemStatusLabel(item.status)}
        </Badge>
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs text-muted-foreground">
        {stringifyItemForDebug(item)}
      </pre>
    </div>
  );
}

function renderTimelineItemDetails(
  item: AgentThreadItem,
  onFileClick?: (fileName: string, content: string) => void,
  onOpenArtifactFromTimeline?: (target: ArtifactTimelineOpenTarget) => void,
  onOpenSavedSiteContent?: (target: SiteSavedContentTarget) => void,
  onOpenSubagentSession?: (sessionId: string) => void,
  onPermissionResponse?: (response: ConfirmResponse) => void,
  options?: {
    groupedToolCall?: boolean;
    groupMarker?: string;
  },
) {
  if (isThinkingTimelineItem(item)) {
    if (options?.groupedToolCall) {
      return (
        <GroupedThinkingRow item={item} groupMarker={options.groupMarker} />
      );
    }
    return renderThinkingItemDetails(item);
  }

  return renderGroupItemDetails(
    item,
    onFileClick,
    onOpenArtifactFromTimeline,
    onOpenSavedSiteContent,
    onOpenSubagentSession,
    onPermissionResponse,
    options,
  );
}

function resolveCompactTechnicalSummary(
  block: AgentThreadOrderedBlock,
): string {
  return `处理了 ${block.items.length} 个步骤`;
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
    const completedThinkingBlock =
      Boolean(focusBlock) &&
      focusBlock.status === "completed" &&
      focusBlock.items.every((item) => isThinkingTimelineItem(item));
    const shouldExpandFocus =
      focusBlock?.status !== "completed" ||
      (!completedThinkingBlock && turn.status === "running") ||
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

function hasAnyPrefix(value: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => value.startsWith(prefix));
}

function normalizeBlockPreviewLine(
  kind: AgentThreadOrderedBlock["kind"],
  line: string,
): string {
  const trimmed = line.trim();
  if (!trimmed) {
    return line;
  }

  if (
    kind === "artifact" &&
    !hasAnyPrefix(trimmed, [
      "看了 ",
      "读了 ",
      "写了 ",
      "改了 ",
      "动了 ",
      "产出了 ",
    ])
  ) {
    return `产出了 ${trimmed}`;
  }

  if (
    kind === "approval" &&
    !hasAnyPrefix(trimmed, [
      "等你补充：",
      "等你确认：",
      "等你补充信息",
      "等你确认这一步",
    ])
  ) {
    return `等你确认：${trimmed}`;
  }

  if (
    kind === "alert" &&
    !hasAnyPrefix(trimmed, ["收到提醒：", "碰到错误："])
  ) {
    return `收到提醒：${trimmed}`;
  }

  if (
    kind === "subagent" &&
    !hasAnyPrefix(trimmed, ["分给子任务", "子任务", "分给协作成员", "协作成员"])
  ) {
    return `分给子任务处理 ${trimmed}`;
  }

  return trimmed;
}

function resolveBlockSummaryLines(block: AgentThreadOrderedBlock): string[] {
  const isTurnSummaryOnlyBlock =
    block.items.length > 0 &&
    block.items.every((item) => item.type === "turn_summary");
  const isThinkingOnlyBlock = block.items.every((item) =>
    isThinkingTimelineItem(item),
  );
  const normalizedPreviewLines = block.previewLines
    .map((line) => normalizeBlockPreviewLine(block.kind, line))
    .filter((line) => line.trim().length > 0)
    .map((line) => shortenInlineText(line, 92) || line);

  if (isTurnSummaryOnlyBlock) {
    const headline = block.status === "in_progress" ? "处理中" : "当前进展";
    if (normalizedPreviewLines.length > 0) {
      return [
        headline,
        ...normalizedPreviewLines.filter((line) => line !== headline),
      ];
    }

    return [headline];
  }

  if (isThinkingOnlyBlock) {
    const headline = block.status === "in_progress" ? "思考中" : "已完成思考";
    if (normalizedPreviewLines.length > 0) {
      return [
        headline,
        ...normalizedPreviewLines.filter((line) => line !== headline),
      ];
    }

    return [headline];
  }

  if (block.kind === "process" && block.items.length > 1) {
    return [block.title, ...normalizedPreviewLines];
  }

  if (normalizedPreviewLines.length > 0) {
    return normalizedPreviewLines;
  }

  if (block.kind === "approval") {
    return [block.status === "completed" ? "这一步已经确认" : "等你确认这一步"];
  }

  if (block.kind === "alert") {
    return [block.status === "failed" ? "碰到错误" : "收到提醒"];
  }

  if (block.kind === "subagent") {
    return [block.status === "completed" ? "子任务已完成" : "子任务处理中"];
  }

  if (block.kind === "other") {
    return [resolveCompactTechnicalSummary(block)];
  }

  return [block.title];
}

function resolveProcessMixLabel(block: AgentThreadOrderedBlock): string | null {
  if (block.kind !== "process" || block.items.length <= 1) {
    return null;
  }

  const toolCount = block.items.filter((item) =>
    isToolExecutionTimelineItem(item),
  ).length;
  const thinkingCount = block.items.filter((item) =>
    isThinkingTimelineItem(item),
  ).length;

  const parts: string[] = [];
  if (toolCount > 0) {
    parts.push(`${toolCount} 个工具步骤`);
  }
  if (thinkingCount > 0) {
    parts.push(`${thinkingCount} 条思路`);
  }

  return parts.length > 0 ? parts.join("，") : null;
}

function resolveThreadInlineStatusHint(params: {
  turn: AgentThreadTurn;
  actionRequests?: ActionRequired[];
}) {
  const pendingAction = findLatestPendingAction(params.actionRequests);

  if (pendingAction) {
    return {
      tone: "warning" as const,
      label: "待处理",
      detail:
        pendingAction.prompt?.trim() ||
        "当前阶段在等待你确认，完成后会继续后续处理。",
    };
  }

  if (params.turn.status === "aborted") {
    return {
      tone: "neutral" as const,
      label: "已暂停",
      detail:
        params.turn.error_message?.trim() ||
        "当前阶段已暂停，你可以处理后继续下一步。",
    };
  }

  if (params.turn.status === "failed" && params.turn.error_message?.trim()) {
    return {
      tone: "error" as const,
      label: "失败",
      detail: params.turn.error_message.trim(),
    };
  }

  return null;
}

function ThreadInlineStatusHint({
  hint,
}: {
  hint: NonNullable<ReturnType<typeof resolveThreadInlineStatusHint>>;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 py-1 text-sm",
        hint.tone === "warning" && "text-amber-900",
        hint.tone === "error" && "text-rose-900",
        hint.tone === "neutral" && "text-slate-700",
      )}
      data-testid="agent-thread-inline-status"
    >
      <div
        className={cn(
          "mt-2 h-1.5 w-1.5 shrink-0 rounded-full",
          hint.tone === "warning" && "bg-amber-500",
          hint.tone === "error" && "bg-rose-500",
          hint.tone === "neutral" && "bg-slate-400",
        )}
      />
      <div className="min-w-0 flex-1 leading-6">
        <span className="mr-2 text-xs font-medium">{hint.label}</span>
        <span>{hint.detail}</span>
      </div>
    </div>
  );
}

function TimelineBlockStatusIndicator({
  block,
}: {
  block: AgentThreadOrderedBlock;
}) {
  if (block.kind === "approval" && block.status !== "completed") {
    return (
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-100 text-amber-700">
        <Clock3 className="h-2.5 w-2.5" />
      </span>
    );
  }

  if (block.status === "in_progress") {
    return (
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-sky-100 text-sky-600">
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
      </span>
    );
  }

  if (block.status === "failed" || block.kind === "alert") {
    return (
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-rose-100 text-rose-700">
        <AlertTriangle className="h-2.5 w-2.5" />
      </span>
    );
  }

  return <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />;
}

function TimelineBlockCard({
  block,
  index,
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
  const dataTestId = `agent-thread-block:${index + 1}:${block.kind}`;
  const isThinkingOnlyBlock = block.items.every((item) =>
    isThinkingTimelineItem(item),
  );
  const summaryLines = resolveBlockSummaryLines(block);
  const headline = summaryLines[0] || block.title;
  const supportingLines = summaryLines.slice(1, 3);
  const focusedEntryRef = useRef<HTMLDivElement | null>(null);
  const hasFocusedItem = Boolean(
    focusedItemId && block.items.some((item) => item.id === focusedItemId),
  );
  const shouldRenderGroupedToolRows =
    block.kind === "process" && block.items.length > 1;
  const detailEntries = block.items.flatMap((item) => {
    const content = renderTimelineItemDetails(
      item,
      onFileClick,
      onOpenArtifactFromTimeline,
      onOpenSavedSiteContent,
      onOpenSubagentSession,
      onPermissionResponse,
      {
        groupedToolCall: shouldRenderGroupedToolRows,
        groupMarker: block.items[0]?.id === item.id ? "└" : "·",
      },
    );

    return content ? [{ id: item.id, content }] : [];
  });
  const hasDetailEntries = detailEntries.length > 0;
  const [open, setOpen] = useState(isExpanded || hasFocusedItem);

  useEffect(() => {
    setOpen(isExpanded || hasFocusedItem);
  }, [block.id, hasFocusedItem, isExpanded]);

  useEffect(() => {
    if (!hasFocusedItem || !focusRequestKey) {
      return;
    }

    setOpen(true);
    focusedEntryRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [focusRequestKey, hasFocusedItem]);

  const shouldRenderArtifactCardsInline =
    block.kind === "artifact" &&
    hasDetailEntries &&
    block.items.every((item) => item.type === "file_artifact");

  if (shouldRenderArtifactCardsInline) {
    return (
      <div
        className="space-y-2 py-0.5"
        data-testid={dataTestId}
        data-emphasis={emphasis}
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
    );
  }

  const singleItemContent =
    block.items.length === 1 &&
    !(isThinkingOnlyBlock && block.status === "completed")
      ? renderTimelineItemDetails(
          block.items[0]!,
          onFileClick,
          onOpenArtifactFromTimeline,
          onOpenSavedSiteContent,
          onOpenSubagentSession,
          onPermissionResponse,
        )
      : null;

  if (singleItemContent) {
    return (
      <div
        className={cn(
          "py-0.5",
          emphasis === "active" &&
            !isThinkingOnlyBlock &&
            "rounded-xl bg-sky-50/45 px-2",
          emphasis === "quiet" && "opacity-80",
        )}
        data-testid={dataTestId}
        data-emphasis={emphasis}
      >
        <div
          data-thread-item-id={block.items[0]?.id}
          ref={block.items[0]?.id === focusedItemId ? focusedEntryRef : null}
          className={cn(
            block.items[0]?.id === focusedItemId &&
              "rounded-xl ring-2 ring-sky-200 ring-offset-2 ring-offset-white",
          )}
        >
          {singleItemContent}
        </div>
      </div>
    );
  }

  const visibleHeadline = headline;
  const visibleSupportingLines =
    isThinkingOnlyBlock && open ? [] : supportingLines;
  const summaryCountLabel = block.items.length > 1 ? block.countLabel : null;
  const processMixLabel = resolveProcessMixLabel(block);
  const summaryDetailHint =
    hasDetailEntries && block.items.length > 1 && !open
      ? processMixLabel || block.rawDetailLabel
      : null;
  const summaryToneClassName = cn(
    "text-slate-900",
    block.status === "in_progress" && "text-sky-700",
    block.kind === "approval" &&
      block.status !== "completed" &&
      "text-amber-800",
    (block.status === "failed" || block.kind === "alert") && "text-rose-700",
  );

  return (
    <div
      className="py-0.5"
      data-testid={`${dataTestId}:shell`}
      data-emphasis={emphasis}
    >
      <details
        data-testid={dataTestId}
        data-emphasis={emphasis}
        open={hasDetailEntries ? open : true}
      >
        <summary
          className={cn(
            "list-none rounded-md px-2 py-1.5",
            hasDetailEntries ? "cursor-pointer" : "cursor-default",
            emphasis === "active" && !isThinkingOnlyBlock && "bg-sky-50/45",
          )}
          onClick={(event) => {
            if (!hasDetailEntries) {
              event.preventDefault();
              return;
            }

            event.preventDefault();
            setOpen((current) => !current);
          }}
        >
          <div className="flex items-start gap-2.5">
            <div className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center">
              <TimelineBlockStatusIndicator block={block} />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span
                  className={cn(
                    "min-w-0 flex-1 text-sm leading-6",
                    summaryToneClassName,
                  )}
                >
                  {visibleHeadline}
                </span>
                {summaryCountLabel ? (
                  <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] leading-none text-slate-500">
                    {summaryCountLabel}
                  </span>
                ) : null}
                {summaryDetailHint ? (
                  <span className="text-xs leading-5 text-slate-400">
                    {summaryDetailHint}
                  </span>
                ) : null}
              </div>

              {visibleSupportingLines.length > 0 ? (
                <div className="mt-0.5 space-y-1">
                  {visibleSupportingLines.map((line) => (
                    <div
                      key={line}
                      className="text-sm leading-6 text-slate-500"
                    >
                      {line}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            {hasDetailEntries ? (
              <ChevronDown
                className={cn(
                  "mt-1 h-4 w-4 shrink-0 text-slate-400 transition-transform",
                  open && "rotate-180",
                )}
              />
            ) : null}
          </div>
        </summary>

        {hasDetailEntries && open ? (
          <div
            className="ml-6 space-y-2 pb-1 pl-3"
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
        ) : null}
      </details>
    </div>
  );
}

export const AgentThreadTimeline: React.FC<AgentThreadTimelineProps> = ({
  turn,
  items,
  threadRead: _threadRead,
  actionRequests = [],
  isCurrentTurn = false,
  placement = "default",
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
        (item) =>
          item.type !== "user_message" &&
          item.type !== "agent_message" &&
          !(
            item.type === "file_artifact" &&
            isHiddenConversationArtifactPath(item.path)
          ),
      ),
    [items],
  );

  const displayModel = useMemo(
    () => buildAgentThreadDisplayModel(visibleItems),
    [visibleItems],
  );
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
  const inlineStatusHint = resolveThreadInlineStatusHint({
    turn,
    actionRequests,
  });

  if (visibleItems.length === 0) {
    return null;
  }

  return (
    <div
      className="mt-3 space-y-2"
      data-testid="agent-thread-flow"
      data-placement={placement}
    >
      {inlineStatusHint ? (
        <ThreadInlineStatusHint hint={inlineStatusHint} />
      ) : null}
      {displayModel.orderedBlocks.map((block, index) => {
        const blockHasFocusedItem = Boolean(
          focusedItemId &&
          block.items.some((item) => item.id === focusedItemId),
        );

        return (
          <TimelineBlockCard
            key={block.id}
            block={block}
            index={index}
            emphasis={
              blockHasFocusedItem || activeBlockIndex === index
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
        );
      })}
    </div>
  );
};

export default AgentThreadTimeline;
