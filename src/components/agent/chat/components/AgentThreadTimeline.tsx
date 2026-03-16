import React, { useMemo } from "react";
import {
  AlertTriangle,
  Bot,
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
import type { ToolCallState } from "@/lib/api/agentStream";
import type {
  ActionRequired,
  AgentThreadItem,
  AgentThreadTurn,
  ConfirmResponse,
} from "../types";
import {
  buildAgentThreadDisplayModel,
  type AgentThreadOrderedBlock,
  type AgentThreadSummaryChip,
} from "../utils/agentThreadGrouping";
import { isActionRequestA2UICompatible } from "../utils/actionRequestA2UI";
import { parseAIResponse } from "@/components/content-creator/a2ui/parser";
import type { A2UIResponse } from "@/components/content-creator/a2ui/types";
import { TIMELINE_A2UI_TASK_CARD_PRESET } from "@/components/content-creator/a2ui/taskCardPresets";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { ActionRequestA2UIPreviewCard } from "./ActionRequestA2UIPreviewCard";
import { A2UITaskCard, A2UITaskLoadingCard } from "./A2UITaskCard";
import { ToolCallItem } from "./ToolCallDisplay";
import { DecisionPanel } from "./DecisionPanel";
import { AgentPlanBlock } from "./AgentPlanBlock";

interface AgentThreadTimelineProps {
  turn: AgentThreadTurn;
  items: AgentThreadItem[];
  actionRequests?: ActionRequired[];
  isCurrentTurn?: boolean;
  onFileClick?: (fileName: string, content: string) => void;
  onPermissionResponse?: (response: ConfirmResponse) => void;
}

interface TurnStatusMeta {
  label: string;
  badgeVariant: "secondary" | "outline" | "destructive";
  badgeClassName?: string;
  overviewText: string;
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

  return "当前回合暂停在待确认步骤，处理后会继续后续流程。";
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
      ? "正在处理你的请求，执行轨迹会持续更新。"
      : "正在准备执行上下文。";
  }

  if (turn.status === "failed") {
    return turn.error_message || "本回合执行失败，请查看下方异常分组。";
  }

  return actionableCount > 0
    ? "已整理本回合的关键执行过程。"
    : "本回合没有记录额外的执行轨迹。";
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
          "正在建立浏览器会话，连接成功后会继续当前回合。",
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
        "当前回合暂停在待确认步骤，处理后会继续后续流程。",
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
          turn.error_message || "本回合执行失败，请查看下方异常分组。",
      };
    case "aborted":
      return {
        label: "已暂停",
        badgeVariant: "outline",
        overviewText:
          turn.error_message || "本回合已暂停，你可以继续处理或发起下一轮。",
      };
    case "completed":
    default:
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

function renderThinkingItemDetails(item: AgentThreadItem) {
  if (item.type === "plan") {
    return (
      <AgentPlanBlock
        content={item.text}
        isComplete={item.status !== "in_progress"}
      />
    );
  }

  if (item.type === "reasoning" || item.type === "turn_summary") {
    return <ThinkingItemCard item={item} />;
  }

  return null;
}

function renderGroupItemDetails(
  item: AgentThreadItem,
  onFileClick?: (fileName: string, content: string) => void,
  onPermissionResponse?: (response: ConfirmResponse) => void,
) {
  const toolCall = toToolCallState(item);
  const actionRequest = toActionRequired(item);
  const timestamp = formatTimestamp(item.completed_at || item.updated_at);

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
        />
      </div>
    );
  }

  if (item.type === "file_artifact") {
    return (
      <button
        type="button"
        className="w-full rounded-xl border border-border/70 bg-background/80 px-3 py-3 text-left transition-colors hover:bg-muted/40"
        onClick={() => onFileClick?.(item.path, item.content || "")}
      >
        <div className="flex items-center gap-2">
          <div className="text-sm font-medium text-foreground">{item.path}</div>
          <Badge variant={resolveStatusBadgeVariant(item.status)} className="ml-auto">
            {item.source}
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
    );
  }

  if (item.type === "subagent_activity") {
    return (
      <SurfaceCard
        icon={Bot}
        title={item.title || "子代理协作"}
        badge={
          <Badge variant={resolveStatusBadgeVariant(item.status)}>
            {item.status_label}
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
    return `已收纳 ${block.items.length} 项低优先级技术细节，最近一项：${firstPreview}`;
  }
  return `已收纳 ${block.items.length} 项低优先级技术细节。`;
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

function TimelineBlockCard({
  block,
  index,
  isLast,
  emphasis,
  isExpanded,
  onFileClick,
  onPermissionResponse,
}: {
  block: AgentThreadOrderedBlock;
  index: number;
  isLast: boolean;
  emphasis: "active" | "default" | "quiet";
  isExpanded: boolean;
  onFileClick?: (fileName: string, content: string) => void;
  onPermissionResponse?: (response: ConfirmResponse) => void;
}) {
  const Icon = resolveGroupIcon(block.kind);
  const timestamp = formatTimestamp(block.startedAt);
  const dataTestId = `agent-thread-block:${index + 1}:${block.kind}`;
  const isCompact = isCompactTechnicalBlock(block);
  const isActive = emphasis === "active";
  const isQuiet = emphasis === "quiet";
  const stageLabel = `阶段 ${String(index + 1).padStart(2, "0")}`;

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
      <details
        className={
          isActive
            ? "overflow-hidden rounded-2xl border border-primary/25 bg-primary/[0.045] shadow-md shadow-primary/10"
            : isCompact
              ? "overflow-hidden rounded-2xl border border-border/45 bg-background/60"
              : isQuiet
                ? "overflow-hidden rounded-2xl border border-border/45 bg-background/60"
                : "overflow-hidden rounded-2xl border border-border/60 bg-background/75"
        }
        data-testid={dataTestId}
        data-emphasis={emphasis}
        open={isExpanded}
      >
        <summary
          className={
            isCompact
              ? "flex cursor-pointer items-start gap-3 px-4 py-2.5"
              : "flex cursor-pointer items-start gap-3 px-4 py-3"
          }
        >
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
                已归档该分组的执行细节。
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
          {block.items.map((item) => (
            <div key={item.id}>
              {block.kind === "thinking"
                ? renderThinkingItemDetails(item)
                : renderGroupItemDetails(item, onFileClick, onPermissionResponse)}
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

export const AgentThreadTimeline: React.FC<AgentThreadTimelineProps> = ({
  turn,
  items,
  actionRequests = [],
  isCurrentTurn = false,
  onFileClick,
  onPermissionResponse,
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
      ? `阶段 ${String(focusBlockIndex + 1).padStart(2, "0")}`
      : null;
  const promptPreview = shortenInlineText(turn.prompt_text, 78);
  const turnStatusMeta = resolveTurnStatusMeta({
    turn,
    items: visibleItems,
    actionRequests,
    summaryText: displayModel.summaryText,
    actionableCount,
  });

  if (visibleItems.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 space-y-3 rounded-2xl border border-border/60 bg-muted/20 p-3">
      <div className="relative pl-14" data-testid="agent-thread-summary-shell">
        <div className="absolute left-0 top-2.5 flex h-8 w-8 items-center justify-center rounded-full border border-primary/15 bg-primary/10 text-primary shadow-sm shadow-primary/10">
          <Sparkles className="h-4 w-4" />
        </div>
        <div
          className="rounded-xl border border-border/50 bg-background/70 px-4 py-2.5"
          data-testid="agent-thread-summary"
        >
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-xs font-medium tracking-wide text-muted-foreground">
              本回合摘要
            </div>
            <Badge variant="outline">{flowBlockCount} 段流程</Badge>
            {isCurrentTurn ? <Badge variant="secondary">当前回合</Badge> : null}
            <Badge
              variant={turnStatusMeta.badgeVariant}
              className={turnStatusMeta.badgeClassName}
            >
              {turnStatusMeta.label}
            </Badge>
            <div className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
              <Clock3 className="h-3.5 w-3.5" />
              <span>{formatTimestamp(turn.started_at) || "刚刚"}</span>
            </div>
          </div>

          <div className="mt-1.5 text-sm leading-6 text-foreground">
            {turnStatusMeta.overviewText}
          </div>

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
                  {focusBlock.previewLines[0] ? (
                    <div className="mt-1 text-sm text-muted-foreground">
                      {focusBlock.previewLines[0]}
                    </div>
                  ) : null}
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
        {displayModel.orderedBlocks.map((block, index) => (
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
            onPermissionResponse={onPermissionResponse}
          />
        ))}
      </div>
    </div>
  );
};

export default AgentThreadTimeline;
