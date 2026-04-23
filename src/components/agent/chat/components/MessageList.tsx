import React, {
  useCallback,
  useState,
  useRef,
  useEffect,
  useMemo,
  useLayoutEffect,
} from "react";
import {
  AlertTriangle,
  Copy,
  Quote,
  Check,
  FileText,
  Loader2,
  ExternalLink,
  Sparkles,
  BookmarkPlus,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { Artifact } from "@/lib/artifact/types";
import {
  resolveConfiguredProviderPromptCacheSupportNotice,
  useConfiguredProviders,
} from "@/hooks/useConfiguredProviders";
import { resolveArtifactProtocolFilePath } from "@/lib/artifact-protocol";
import {
  MessageListContainer,
  MessageWrapper,
  ContentColumn,
  MessageBubble,
  MessageActions,
} from "../styles";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { RuntimePeerMessageCards } from "./RuntimePeerMessageCards";
import { StreamingRenderer } from "./StreamingRenderer";
import { TokenUsageDisplay } from "./TokenUsageDisplay";
import { AgentThreadTimeline } from "./AgentThreadTimeline";
import { ImageWorkbenchMessagePreview } from "./ImageWorkbenchMessagePreview";
import { TaskMessagePreview } from "./TaskMessagePreview";
import { InputbarRuntimeStatusLine } from "./Inputbar/components/InputbarRuntimeStatusLine";
import {
  formatArtifactWritePhaseLabel,
  resolveArtifactPreviewText,
  resolveArtifactWritePhase,
} from "../utils/messageArtifacts";
import { resolveContentPostArtifactDisplayTitle } from "../utils/contentPostSkill";
import {
  sanitizeContentPartsForDisplay,
  sanitizeMessageTextForDisplay,
} from "../utils/internalImagePlaceholder";
import { isHiddenConversationArtifactPath } from "../utils/internalArtifactVisibility";
import { buildInputbarRuntimeStatusLineModel } from "../utils/inputbarRuntimeStatusLine";
import { resolvePromptCacheActivity } from "../utils/tokenUsageSummary";
import { isInternalRoutingTurnSummaryText } from "../utils/turnSummaryPresentation";
import {
  Message,
  type ActionRequired,
  type AgentRuntimeStatus,
  type AgentThreadItem,
  type AgentThreadTurn,
  type MessagePreviewTarget,
  type SiteSavedContentTarget,
  type WriteArtifactContext,
  type PendingA2UISource,
} from "../types";
import type { A2UIFormData } from "@/lib/workspace/a2ui";
import type { ConfirmResponse } from "../types";
import type {
  AsterSubagentSessionInfo,
  AgentRuntimeThreadReadModel,
  QueuedTurnSnapshot,
} from "@/lib/api/agentRuntime";
import {
  buildMessageTurnTimeline,
} from "../utils/threadTimelineView";
import { buildMessageTurnGroups } from "../utils/messageTurnGrouping";
import { resolveLatestProjectFileSavedSiteContentTargetFromMessage } from "../utils/latestSavedSiteContentTarget";
import {
  resolveSiteSavedContentTargetDisplayName,
  resolveSiteSavedContentTargetRelativePath,
} from "../utils/siteToolResultSummary";
import { type ArtifactTimelineOpenTarget } from "../utils/artifactTimelineNavigation";
import { isPureRuntimePeerMessageText } from "../utils/runtimePeerMessageDisplay";
import { LIME_BRAND_LOGO_SRC, LIME_BRAND_NAME } from "@/lib/branding";

interface MessageListProps {
  messages: Message[];
  leadingContent?: React.ReactNode;
  emptyStateVariant?: "default" | "task-center";
  turns?: AgentThreadTurn[];
  threadItems?: AgentThreadItem[];
  currentTurnId?: string | null;
  threadRead?: AgentRuntimeThreadReadModel | null;
  pendingActions?: ActionRequired[];
  submittedActionsInFlight?: ActionRequired[];
  queuedTurns?: QueuedTurnSnapshot[];
  childSubagentSessions?: AsterSubagentSessionInfo[];
  isSending?: boolean;
  assistantLabel?: string;
  onDeleteMessage?: (id: string) => void;
  onEditMessage?: (id: string, content: string) => void;
  onQuoteMessage?: (content: string, id: string) => void;
  /** A2UI 表单提交回调 */
  onA2UISubmit?: (formData: A2UIFormData, messageId: string) => void;
  /** 是否渲染消息内联 A2UI */
  renderA2UIInline?: boolean;
  /** A2UI 表单数据映射（按消息 ID 索引） */
  a2uiFormDataMap?: Record<string, { formId: string; formData: A2UIFormData }>;
  /** A2UI 表单数据变化回调（用于持久化） */
  onA2UIFormChange?: (formId: string, formData: A2UIFormData) => void;
  /** 文件写入回调 */
  onWriteFile?: (
    content: string,
    fileName: string,
    context?: WriteArtifactContext,
  ) => void;
  /** 文件点击回调 */
  onFileClick?: (fileName: string, content: string) => void;
  /** 时间线内 artifact 精确跳转 */
  onOpenArtifactFromTimeline?: (target: ArtifactTimelineOpenTarget) => void;
  /** 打开站点能力已保存内容 */
  onOpenSavedSiteContent?: (target: SiteSavedContentTarget) => void;
  /** Artifact 点击回调 */
  onArtifactClick?: (artifact: Artifact) => void;
  /** 打开消息结果预览 */
  onOpenMessagePreview?: (
    target: MessagePreviewTarget,
    message: Message,
  ) => void;
  /** 将助手结果沉淀为技能草稿 */
  onSaveMessageAsSkill?: (source: {
    messageId: string;
    content: string;
  }) => void;
  /** 将助手结果沉淀到灵感库 */
  onSaveMessageAsInspiration?: (source: {
    messageId: string;
    content: string;
  }) => void;
  /** 打开子代理会话 */
  onOpenSubagentSession?: (sessionId: string) => void;
  /** 权限确认响应回调 */
  onPermissionResponse?: (response: ConfirmResponse) => void;
  /** 是否折叠代码块（当画布打开时） */
  collapseCodeBlocks?: boolean;
  /** 按代码块决定是否折叠 */
  shouldCollapseCodeBlock?: (language: string, code: string) => boolean;
  /** 代码块点击回调（用于在画布中显示） */
  onCodeBlockClick?: (language: string, code: string) => void;
  /** 是否将待处理问答提升为输入区 A2UI 表单 */
  promoteActionRequestsToA2UI?: boolean;
  /** 会话是否仍在自动恢复 */
  isRestoringSession?: boolean;
  /** 中断当前执行 */
  onInterruptCurrentTurn?: () => void | Promise<void>;
  /** 恢复当前线程排队执行 */
  onResumeThread?: () => boolean | Promise<boolean>;
  /** 重新拉起当前最重要的待处理请求 */
  onReplayPendingRequest?: (
    requestId: string,
    assistantMessageId: string,
  ) => boolean | Promise<boolean>;
  /** 立即恢复下一条排队回合 */
  onPromoteQueuedTurn?: (queuedTurnId: string) => boolean | Promise<boolean>;
  /** 是否压缩左侧留白，适用于工作台右栏 */
  compactLeadingSpacing?: boolean;
  /** 需要高亮的 timeline item */
  focusedTimelineItemId?: string | null;
  /** 触发 timeline item 聚焦的请求序号 */
  timelineFocusRequestKey?: number;
  /** 当前由聊天区底部承载的待处理 A2UI 来源 */
  activePendingA2UISource?: PendingA2UISource | null;
  /** 当前会话的 provider 选择器 */
  providerType?: string;
}

function normalizeRuntimeStatusMetaText(value?: string | null): string {
  return (value || "").trim().replace(/\s+/g, " ");
}

const MessageRuntimeStatusPill: React.FC<{
  status: AgentRuntimeStatus;
}> = ({ status }) => {
  const failed = status.phase === "failed";
  const cancelled = status.phase === "cancelled";
  const ToneIcon = failed ? AlertTriangle : cancelled ? Square : Loader2;
  const titleText = normalizeRuntimeStatusMetaText(status.title);
  const detailText = normalizeRuntimeStatusMetaText(status.detail);
  const checkpointsText = (status.checkpoints || [])
    .map((item) => normalizeRuntimeStatusMetaText(item))
    .filter(Boolean)
    .slice(0, 2)
    .join(" · ");
  const tooltip = [titleText, detailText, checkpointsText]
    .filter((item, index, array) => Boolean(item) && array.indexOf(item) === index)
    .join("\n");

  return (
    <div
      data-testid="message-runtime-status-pill"
      className={[
        "inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] leading-none",
        failed
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : cancelled
            ? "border-slate-200 bg-slate-50 text-slate-600"
            : "border-sky-200 bg-sky-50 text-sky-700",
      ].join(" ")}
      title={tooltip || undefined}
    >
      <ToneIcon
        className={[
          "h-3.5 w-3.5 shrink-0",
          failed || cancelled ? "" : "animate-spin",
        ].join(" ")}
      />
      <span className="truncate">{titleText || "处理中"}</span>
    </div>
  );
};

function shouldRenderRuntimeStatusPill(
  status?: AgentRuntimeStatus | null,
): boolean {
  return status?.phase === "failed" || status?.phase === "cancelled";
}

function isDeferredTimelineItem(item: AgentThreadItem): boolean {
  return item.type === "file_artifact" || item.type === "turn_summary";
}

function normalizeDeferredArtifactPath(path?: string | null): string {
  return (path || "").trim().replace(/\\/g, "/").toLowerCase();
}

function scoreDeferredArtifactItem(
  item: Extract<AgentThreadItem, { type: "file_artifact" }>,
): number {
  const contentScore = (item.content || "").trim().length;
  const completedAt = Date.parse(item.completed_at || item.updated_at || "");
  const timestampScore = Number.isFinite(completedAt) ? completedAt : 0;
  return contentScore * 1_000_000_000 + timestampScore;
}

function dedupeDeferredTimelineItems(
  items: AgentThreadItem[],
): AgentThreadItem[] {
  const deduped: AgentThreadItem[] = [];
  const artifactIndexByPath = new Map<string, number>();

  for (const item of items) {
    if (item.type !== "file_artifact") {
      deduped.push(item);
      continue;
    }

    const normalizedPath = normalizeDeferredArtifactPath(item.path);
    if (!normalizedPath) {
      deduped.push(item);
      continue;
    }

    const existingIndex = artifactIndexByPath.get(normalizedPath);
    if (existingIndex === undefined) {
      artifactIndexByPath.set(normalizedPath, deduped.length);
      deduped.push(item);
      continue;
    }

    const existingItem = deduped[existingIndex];
    if (
      existingItem?.type !== "file_artifact" ||
      scoreDeferredArtifactItem(item) >= scoreDeferredArtifactItem(existingItem)
    ) {
      deduped[existingIndex] = item;
    }
  }

  return deduped;
}

function shouldRenderConversationTimelineItem(
  item: AgentThreadItem,
  timelineItems: AgentThreadItem[],
  options?: {
    hasInlineRuntimeStatus?: boolean;
  },
): boolean {
  if (item.type !== "turn_summary") {
    return true;
  }

  if (isInternalRoutingTurnSummaryText(item.text)) {
    return false;
  }

  if (item.status === "in_progress" && options?.hasInlineRuntimeStatus) {
    return false;
  }

  if (item.status !== "completed") {
    return true;
  }

  return !timelineItems.some(
    (entry) => entry.id !== item.id && entry.type !== "turn_summary",
  );
}

interface InlineProcessCoverage {
  hasInlineProcessEntries: boolean;
  thinking: boolean;
  toolNameCounts: Map<string, number>;
  actionRequestCounts: Map<string, number>;
}

function normalizeInlineCoverageKey(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}

function incrementInlineCoverageCount(
  counts: Map<string, number>,
  key: string | null,
) {
  if (!key) {
    return;
  }
  counts.set(key, (counts.get(key) || 0) + 1);
}

function consumeInlineCoverageCount(
  counts: Map<string, number>,
  key: string | null,
): boolean {
  if (!key) {
    return false;
  }
  const current = counts.get(key) || 0;
  if (current <= 0) {
    return false;
  }
  if (current === 1) {
    counts.delete(key);
  } else {
    counts.set(key, current - 1);
  }
  return true;
}

function createInlineCoverageMatcher(coverage: InlineProcessCoverage) {
  const remainingToolNameCounts = new Map(coverage.toolNameCounts);
  const remainingActionRequestCounts = new Map(coverage.actionRequestCounts);

  return (item: AgentThreadItem): boolean => {
    switch (item.type) {
      case "reasoning":
        return coverage.thinking;
      case "tool_call":
        return consumeInlineCoverageCount(
          remainingToolNameCounts,
          normalizeInlineCoverageKey(item.tool_name),
        );
      case "approval_request":
      case "request_user_input":
        return consumeInlineCoverageCount(
          remainingActionRequestCounts,
          normalizeInlineCoverageKey(item.request_id),
        );
      default:
        return false;
    }
  };
}

function resolveInlineProcessCoverage(params: {
  contentParts?: Message["contentParts"];
  thinkingContent?: string;
  toolCalls?: Message["toolCalls"];
  actionRequests?: Message["actionRequests"];
}): InlineProcessCoverage {
  const contentParts = params.contentParts || [];
  const toolNameCounts = new Map<string, number>();
  const actionRequestCounts = new Map<string, number>();
  let thinking = false;

  if (contentParts.length > 0) {
    thinking = contentParts.some(
      (part) => part.type === "thinking" && part.text.trim().length > 0,
    );
    contentParts.forEach((part) => {
      if (part.type === "tool_use") {
        incrementInlineCoverageCount(
          toolNameCounts,
          normalizeInlineCoverageKey(part.toolCall.name),
        );
        return;
      }
      if (part.type === "action_required") {
        incrementInlineCoverageCount(
          actionRequestCounts,
          normalizeInlineCoverageKey(part.actionRequired.requestId),
        );
      }
    });
  } else {
    thinking = Boolean(params.thinkingContent?.trim());
    (params.toolCalls || []).forEach((toolCall) => {
      incrementInlineCoverageCount(
        toolNameCounts,
        normalizeInlineCoverageKey(toolCall.name),
      );
    });
  }

  (params.actionRequests || []).forEach((actionRequest) => {
    const actionKey = normalizeInlineCoverageKey(actionRequest.requestId);
    if (actionKey && !actionRequestCounts.has(actionKey)) {
      incrementInlineCoverageCount(actionRequestCounts, actionKey);
    }
  });

  return {
    hasInlineProcessEntries:
      thinking || toolNameCounts.size > 0 || actionRequestCounts.size > 0,
    thinking,
    toolNameCounts,
    actionRequestCounts,
  };
}

function filterConversationDisplayContentParts(
  parts: Message["contentParts"] | undefined,
  options: {
    includeProcessFlow: boolean;
    preserveToolUseParts: boolean;
  },
): Message["contentParts"] | undefined {
  if (!parts || parts.length === 0 || options.includeProcessFlow) {
    return parts;
  }

  const filtered = parts.filter((part) => {
    if (part.type === "thinking") {
      return false;
    }

    if (part.type === "tool_use") {
      return options.preserveToolUseParts;
    }

    return true;
  });
  return filtered.length > 0 ? filtered : undefined;
}

const MessageListInner: React.FC<MessageListProps> = ({
  messages,
  leadingContent,
  emptyStateVariant = "default",
  turns = [],
  threadItems = [],
  currentTurnId = null,
  threadRead = null,
  pendingActions = [],
  queuedTurns = [],
  childSubagentSessions = [],
  isSending = false,
  assistantLabel = "Lime",
  onQuoteMessage,
  onA2UISubmit,
  renderA2UIInline = true,
  a2uiFormDataMap,
  onA2UIFormChange,
  onWriteFile,
  onFileClick,
  onOpenArtifactFromTimeline,
  onOpenSavedSiteContent,
  onArtifactClick,
  onOpenMessagePreview,
  onSaveMessageAsSkill,
  onSaveMessageAsInspiration,
  onOpenSubagentSession,
  onPermissionResponse,
  collapseCodeBlocks,
  shouldCollapseCodeBlock,
  onCodeBlockClick,
  promoteActionRequestsToA2UI = false,
  isRestoringSession = false,
  onInterruptCurrentTurn,
  compactLeadingSpacing = false,
  focusedTimelineItemId = null,
  timelineFocusRequestKey = 0,
  activePendingA2UISource = null,
  providerType,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const previousVisibleMessageCountRef = useRef<number | null>(null);
  const isTaskCenterEmptyState = emptyStateVariant === "task-center";
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);

  const shouldInspectPromptCacheNotice = useMemo(
    () =>
      Boolean(
        providerType?.trim() &&
        messages.some(
          (msg) =>
            msg.role === "assistant" &&
            !msg.isThinking &&
            msg.usage &&
            resolvePromptCacheActivity(msg.usage) <= 0,
        ),
      ),
    [messages, providerType],
  );
  const { providers } = useConfiguredProviders({
    autoLoad: shouldInspectPromptCacheNotice,
  });
  const promptCacheNotice = useMemo(
    () =>
      shouldInspectPromptCacheNotice
        ? resolveConfiguredProviderPromptCacheSupportNotice(
            providers,
            providerType,
          )
        : null,
    [providerType, providers, shouldInspectPromptCacheNotice],
  );

  const visibleMessages = useMemo(
    () =>
      messages.filter((msg) => {
        if (msg.role !== "user") return true;
        if (msg.content.trim().length > 0) return true;
        return Array.isArray(msg.images) && msg.images.length > 0;
      }),
    [messages],
  );
  const timelineByMessageId = useMemo(
    () => buildMessageTurnTimeline(visibleMessages, turns, threadItems),
    [threadItems, turns, visibleMessages],
  );
  const lastAssistantMessageId = useMemo(
    () =>
      [...visibleMessages]
        .reverse()
        .find((message) => message.role === "assistant")?.id ?? null,
    [visibleMessages],
  );
  const tailRuntimeStatusLine = useMemo(() => {
    if (!lastAssistantMessageId) {
      return null;
    }

    return buildInputbarRuntimeStatusLineModel({
      messages: visibleMessages,
      turns,
      threadItems,
      currentTurnId,
      threadRead,
      pendingActions,
      queuedTurns,
      childSubagentSessions,
      isSending,
    });
  }, [
    childSubagentSessions,
    currentTurnId,
    isSending,
    lastAssistantMessageId,
    pendingActions,
    queuedTurns,
    threadItems,
    threadRead,
    turns,
    visibleMessages,
  ]);
  const currentTurnTimeline = useMemo(() => {
    if (!currentTurnId || !lastAssistantMessageId) {
      return null;
    }

    const turn = turns.find((entry) => entry.id === currentTurnId);
    if (!turn) {
      return null;
    }

    const mappedMessageId =
      [...timelineByMessageId.values()].find(
        (entry) => entry.turn.id === turn.id,
      )?.messageId ?? null;

    return {
      messageId: mappedMessageId || lastAssistantMessageId,
      turn,
      items: threadItems.filter((item) => item.turn_id === turn.id),
    };
  }, [
    currentTurnId,
    lastAssistantMessageId,
    threadItems,
    timelineByMessageId,
    turns,
  ]);
  const messageGroups = useMemo(
    () => buildMessageTurnGroups(visibleMessages),
    [visibleMessages],
  );
  const renderGroups = useMemo(
    () =>
      messageGroups.map((group) => {
        const lastAssistantId =
          group.assistantMessages[group.assistantMessages.length - 1]?.id ?? null;
        const mappedTimeline =
          group.assistantMessages
            .map((message) => timelineByMessageId.get(message.id))
            .find(Boolean) ?? null;
        const isCurrentTurnGroup =
          Boolean(lastAssistantId) &&
          currentTurnTimeline?.messageId === lastAssistantId;
        const isActiveGroup =
          Boolean(lastAssistantId) && lastAssistantId === lastAssistantMessageId;
        const timeline = isCurrentTurnGroup ? currentTurnTimeline : mappedTimeline;

        return {
          ...group,
          lastAssistantId,
          timeline,
          isActiveGroup,
        };
      }),
    [
      currentTurnTimeline,
      lastAssistantMessageId,
      messageGroups,
      timelineByMessageId,
    ],
  );
  const shouldKeepInlineProcessForActiveAssistant = useCallback(
    (message: Message, isConversationTailAssistant: boolean): boolean => {
      if (message.role !== "assistant") {
        return false;
      }

      if (message.isThinking) {
        return true;
      }

      if (!isConversationTailAssistant) {
        return false;
      }

      const hasRunningToolCall =
        (message.toolCalls || []).some((toolCall) => toolCall.status === "running") ||
        (message.contentParts || []).some(
          (part) =>
            part.type === "tool_use" && part.toolCall.status === "running",
        );
      const hasPendingActionRequest =
        (message.actionRequests || []).some(
          (request) => request.status !== "submitted",
        ) ||
        (message.contentParts || []).some(
          (part) =>
            part.type === "action_required" &&
            part.actionRequired.status !== "submitted",
        );
      const hasActiveRuntimeStatus =
        Boolean(message.runtimeStatus) &&
        message.runtimeStatus?.phase !== "failed" &&
        message.runtimeStatus?.phase !== "cancelled";

      return (
        hasRunningToolCall || hasPendingActionRequest || hasActiveRuntimeStatus
      );
    },
    [],
  );

  // 检测用户是否在手动滚动
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let scrollTimeout: ReturnType<typeof setTimeout>;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 50; // 50px 容差

      setIsUserScrolling(true);
      setShouldAutoScroll(isAtBottom);

      // 清除之前的定时器
      clearTimeout(scrollTimeout);

      // 500ms 后认为用户停止滚动
      scrollTimeout = setTimeout(() => {
        setIsUserScrolling(false);
      }, 500);
    };

    container.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      container.removeEventListener("scroll", handleScroll);
      clearTimeout(scrollTimeout);
    };
  }, []);

  // 恢复历史会话时需要在首帧前把视口定位到底部，避免先闪顶部空白再平滑滚动。
  useLayoutEffect(() => {
    const previousVisibleMessageCount = previousVisibleMessageCountRef.current;
    previousVisibleMessageCountRef.current = visibleMessages.length;

    if (!shouldAutoScroll || isUserScrolling || !scrollRef.current) {
      return;
    }

    const shouldAnimateScroll =
      !isRestoringSession &&
      previousVisibleMessageCount !== null &&
      previousVisibleMessageCount > 0 &&
      visibleMessages.length <= previousVisibleMessageCount + 1;

    scrollRef.current.scrollIntoView({
      behavior: shouldAnimateScroll ? "smooth" : "auto",
      block: "end",
    });
  }, [visibleMessages, shouldAutoScroll, isUserScrolling, isRestoringSession]);

  const handleCopy = async (content: string, id: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(id);
      toast.success("已复制到剪贴板");
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast.error("复制失败");
    }
  };

  const renderMessageItem = (
    msg: Message,
    group: (typeof renderGroups)[number],
  ) => {
    const hasImages = Array.isArray(msg.images) && msg.images.length > 0;
    const displayContent = sanitizeMessageTextForDisplay(msg.content || "", {
      role: msg.role,
      hasImages,
    });
    const rawRuntimePeerContent = (msg.content || "").trim();
    const shouldRenderRuntimePeerCards =
      rawRuntimePeerContent.length > 0 &&
      isPureRuntimePeerMessageText(rawRuntimePeerContent);
    const displayContentParts = sanitizeContentPartsForDisplay(
      msg.contentParts,
      {
        role: msg.role,
        hasImages,
      },
    );
    const isConversationTailAssistant =
      msg.role === "assistant" && msg.id === group.lastAssistantId;
    const timeline =
      msg.role !== "assistant"
        ? null
        : isConversationTailAssistant
          ? group.timeline
          : null;
    const hasProcessTimelineItems = Boolean(
      timeline?.items.some(
        (item) =>
          item.type === "reasoning" ||
          item.type === "tool_call" ||
          item.type === "command_execution" ||
          item.type === "web_search",
      ),
    );
    const includeInlineProcessFlow =
      msg.role === "assistant" &&
      shouldKeepInlineProcessForActiveAssistant(
        msg,
        isConversationTailAssistant,
      );
    const conversationContentParts =
      msg.role === "assistant"
        ? filterConversationDisplayContentParts(displayContentParts, {
            includeProcessFlow: includeInlineProcessFlow,
            preserveToolUseParts: !hasProcessTimelineItems,
          })
        : displayContentParts;
    const conversationThinkingContent =
      msg.role === "assistant" && includeInlineProcessFlow
        ? msg.thinkingContent
        : undefined;
    const conversationToolCalls =
      msg.role === "assistant" && includeInlineProcessFlow
        ? msg.toolCalls
        : undefined;
    const inlineProcessCoverage = resolveInlineProcessCoverage({
      contentParts: conversationContentParts,
      thinkingContent: conversationThinkingContent,
      toolCalls: conversationToolCalls,
      actionRequests: msg.actionRequests,
    });
    const timelineConversationItems = timeline
      ? timeline.items.filter((item) =>
          shouldRenderConversationTimelineItem(item, timeline.items, {
            hasInlineRuntimeStatus: Boolean(msg.runtimeStatus),
          }),
        )
      : [];
    const isInlineCoveredTimelineItem = createInlineCoverageMatcher(
      inlineProcessCoverage,
    );
    const primaryTimelineItems = timeline
      ? timeline.items.filter((item) => {
          if (
            !timelineConversationItems.some(
              (timelineItem) => timelineItem.id === item.id,
            )
          ) {
            return false;
          }

          if (isDeferredTimelineItem(item)) {
            return false;
          }

          if (!inlineProcessCoverage.hasInlineProcessEntries) {
            return true;
          }

          if (isInlineCoveredTimelineItem(item)) {
            return false;
          }

          return true;
        })
      : [];
    const trailingTimelineItems = timeline
      ? dedupeDeferredTimelineItems(
          timelineConversationItems.filter((item) =>
            isDeferredTimelineItem(item),
          ),
        ).filter(
          (item) =>
            item.type !== "file_artifact" ||
            !isHiddenConversationArtifactPath(item.path),
        )
      : [];
    const primaryTimeline =
      timeline && primaryTimelineItems.length > 0
        ? { ...timeline, items: primaryTimelineItems }
        : null;
    const trailingTimeline =
      timeline && trailingTimelineItems.length > 0
        ? { ...timeline, items: trailingTimelineItems }
        : null;
    const hasTrailingArtifactTimelineItems = trailingTimelineItems.some(
      (item) => item.type === "file_artifact",
    );
    const timelineActionRequests = inlineProcessCoverage.actionRequestCounts
      .size
      ? undefined
      : msg.actionRequests;
    const primaryActionRequests =
      primaryTimelineItems.length > 0 ? timelineActionRequests : undefined;
    const trailingActionRequests =
      primaryTimelineItems.length === 0 ? timelineActionRequests : undefined;
    const shouldSuppressInlineA2UI =
      activePendingA2UISource?.kind !== "action_request" &&
      activePendingA2UISource?.messageId === msg.id;
    const suppressedActionRequestId =
      activePendingA2UISource?.kind === "action_request" &&
      (msg.actionRequests || []).some(
        (request) => request.requestId === activePendingA2UISource.requestId,
      )
        ? activePendingA2UISource.requestId
        : null;
    const actionContent = displayContent.trim();
    const hasVisibleAssistantText = Boolean(actionContent);
    const canQuoteMessage = Boolean(onQuoteMessage && actionContent);
    const canCopyMessage = Boolean(actionContent);
    const canSaveMessageAsSkill = Boolean(
      onSaveMessageAsSkill &&
      msg.role === "assistant" &&
      !msg.isThinking &&
      actionContent &&
      actionContent.length >= 24,
    );
    const canSaveMessageAsInspiration = Boolean(
      onSaveMessageAsInspiration &&
      msg.role === "assistant" &&
      !msg.isThinking &&
      actionContent &&
      actionContent.length >= 24,
    );
    const showMessageActions =
      (msg.role === "user" && (canQuoteMessage || canCopyMessage)) ||
      canSaveMessageAsSkill ||
      canSaveMessageAsInspiration;
    const messageSavedSiteContentTarget =
      msg.role === "assistant"
        ? resolveLatestProjectFileSavedSiteContentTargetFromMessage(msg)
        : null;
    const shouldRenderMessageCanvasShortcut = Boolean(
      messageSavedSiteContentTarget &&
      onOpenSavedSiteContent &&
      !hasTrailingArtifactTimelineItems,
    );
    const visibleAssistantArtifacts =
      msg.role === "assistant"
        ? (msg.artifacts || []).filter(
            (artifact) =>
              !isHiddenConversationArtifactPath(
                resolveArtifactProtocolFilePath(artifact),
              ),
          )
        : [];
    const shouldRenderTailRuntimeStatusLine =
      msg.role === "assistant" &&
      msg.id === lastAssistantMessageId &&
      isConversationTailAssistant &&
      Boolean(tailRuntimeStatusLine);
    const shouldRenderUsageFooter =
      isConversationTailAssistant &&
      !shouldRenderTailRuntimeStatusLine &&
      !msg.isThinking &&
      Boolean(msg.usage);
    const shouldRenderStatusPill =
      !shouldRenderTailRuntimeStatusLine &&
      shouldRenderRuntimeStatusPill(msg.runtimeStatus);
    const messageCanvasShortcutTitle = messageSavedSiteContentTarget
      ? resolveSiteSavedContentTargetDisplayName(
          messageSavedSiteContentTarget,
        ) || "导出稿"
      : "文件";
    const messageCanvasShortcutPath = messageSavedSiteContentTarget
      ? resolveSiteSavedContentTargetRelativePath(messageSavedSiteContentTarget)
      : null;
    const shouldCollapseAssistantShell =
      msg.role === "assistant" &&
      !hasVisibleAssistantText &&
      !(conversationContentParts?.length) &&
      !conversationThinkingContent?.trim() &&
      !(conversationToolCalls?.length) &&
      !((msg.actionRequests || []).length > 0) &&
      !primaryTimeline &&
      !trailingTimeline &&
      !((msg.images || []).length > 0) &&
      visibleAssistantArtifacts.length === 0 &&
      !shouldRenderMessageCanvasShortcut &&
      !msg.imageWorkbenchPreview &&
      !msg.taskPreview;
    const hasAssistantBodyContent =
      msg.role !== "assistant" || !shouldCollapseAssistantShell;
    const assistantMetaFooter =
      msg.role === "assistant" &&
      (shouldRenderTailRuntimeStatusLine ||
        shouldRenderStatusPill ||
        shouldRenderUsageFooter) ? (
        <div
          className={
            hasAssistantBodyContent
              ? "mt-2 flex flex-wrap items-center gap-2"
              : "flex flex-wrap items-center gap-2 px-1 py-0.5"
          }
          data-testid="assistant-message-meta-footer"
        >
          {shouldRenderTailRuntimeStatusLine ? (
            <InputbarRuntimeStatusLine
              runtime={tailRuntimeStatusLine || null}
              providerType={providerType}
              canStop={Boolean(onInterruptCurrentTurn)}
            />
          ) : null}
          {shouldRenderStatusPill && msg.runtimeStatus ? (
            <MessageRuntimeStatusPill status={msg.runtimeStatus} />
          ) : null}
          {shouldRenderUsageFooter ? (
            <TokenUsageDisplay
              usage={msg.usage!}
              inline={true}
              promptCacheNotice={
                resolvePromptCacheActivity(msg.usage!) <= 0
                  ? promptCacheNotice
                  : undefined
              }
            />
          ) : null}
        </div>
      ) : null;

    if (
      msg.role === "assistant" &&
      !hasAssistantBodyContent &&
      !assistantMetaFooter
    ) {
      return null;
    }

    return (
      <MessageWrapper
        key={msg.id}
        $isUser={msg.role === "user"}
        $compactLeadingSpacing={compactLeadingSpacing}
      >
        <ContentColumn $isUser={msg.role === "user"}>
          {hasAssistantBodyContent ? (
            <MessageBubble
              $isUser={msg.role === "user"}
              aria-label={msg.role === "assistant" ? assistantLabel : undefined}
            >
              {msg.role === "assistant" ? (
                <>
                  {primaryTimeline ? (
                    <AgentThreadTimeline
                      turn={primaryTimeline.turn}
                      items={primaryTimeline.items}
                      threadRead={threadRead}
                      actionRequests={primaryActionRequests}
                      isCurrentTurn={primaryTimeline.turn.id === currentTurnId}
                      placement="leading"
                      onFileClick={onFileClick}
                      onOpenArtifactFromTimeline={onOpenArtifactFromTimeline}
                      onOpenSavedSiteContent={onOpenSavedSiteContent}
                      onOpenSubagentSession={onOpenSubagentSession}
                      onPermissionResponse={onPermissionResponse}
                      focusedItemId={focusedTimelineItemId}
                      focusRequestKey={timelineFocusRequestKey}
                    />
                  ) : null}

                  <StreamingRenderer
                    content={displayContent}
                    rawContent={msg.content || ""}
                    isStreaming={msg.isThinking}
                    toolCalls={conversationToolCalls}
                    showCursor={msg.isThinking && !displayContent}
                    thinkingContent={conversationThinkingContent}
                    runtimeStatus={msg.runtimeStatus}
                    contentParts={conversationContentParts}
                    actionRequests={msg.actionRequests}
                    onA2UISubmit={
                      onA2UISubmit
                        ? (formData) => onA2UISubmit(formData, msg.id)
                        : undefined
                    }
                    a2uiFormId={a2uiFormDataMap?.[msg.id]?.formId}
                    a2uiInitialFormData={a2uiFormDataMap?.[msg.id]?.formData}
                    onA2UIFormChange={onA2UIFormChange}
                    renderA2UIInline={
                      renderA2UIInline && !shouldSuppressInlineA2UI
                    }
                    onWriteFile={
                      onWriteFile
                        ? (content, fileName, context) =>
                            onWriteFile(content, fileName, {
                              ...context,
                              sourceMessageId:
                                context?.sourceMessageId || msg.id,
                              source: context?.source || "message_content",
                            })
                        : undefined
                    }
                    onFileClick={onFileClick}
                    onOpenSavedSiteContent={onOpenSavedSiteContent}
                    onPermissionResponse={onPermissionResponse}
                    collapseCodeBlocks={collapseCodeBlocks}
                    shouldCollapseCodeBlock={shouldCollapseCodeBlock}
                    onCodeBlockClick={onCodeBlockClick}
                    promoteActionRequestsToA2UI={promoteActionRequestsToA2UI}
                    suppressedActionRequestId={suppressedActionRequestId}
                    showRuntimeStatusInline={true}
                    renderProposedPlanBlocks={
                      !primaryTimeline ||
                      inlineProcessCoverage.hasInlineProcessEntries
                    }
                    showContentBlockActions={Boolean(actionContent)}
                    onQuoteContent={
                      onQuoteMessage
                        ? (quotedContent) =>
                            onQuoteMessage(quotedContent, msg.id)
                        : undefined
                    }
                  />
                  {shouldRenderMessageCanvasShortcut ? (
                    <button
                      type="button"
                      className="mt-3 flex w-full items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-3 py-2.5 text-left transition-colors hover:bg-emerald-100/80"
                      data-testid="message-canvas-shortcut"
                      onClick={() => {
                        if (
                          messageSavedSiteContentTarget &&
                          onOpenSavedSiteContent
                        ) {
                          onOpenSavedSiteContent(messageSavedSiteContentTarget);
                        }
                      }}
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-200 bg-white text-emerald-700">
                        <FileText className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium leading-6 text-emerald-900">
                          在画布中打开 {messageCanvasShortcutTitle}
                        </span>
                        {messageCanvasShortcutPath ? (
                          <span className="block truncate text-xs leading-5 text-emerald-700/80">
                            {messageCanvasShortcutPath}
                          </span>
                        ) : null}
                      </span>
                      <ExternalLink className="h-4 w-4 shrink-0 text-emerald-700" />
                    </button>
                  ) : null}
                  {msg.imageWorkbenchPreview ? (
                    <ImageWorkbenchMessagePreview
                      preview={msg.imageWorkbenchPreview}
                      onOpen={
                        onOpenMessagePreview
                          ? (preview) =>
                              onOpenMessagePreview(
                                {
                                  kind: "image_workbench",
                                  preview,
                                },
                                msg,
                              )
                          : undefined
                      }
                    />
                  ) : null}
                  {msg.taskPreview ? (
                    <TaskMessagePreview
                      preview={msg.taskPreview}
                      onOpen={
                        onOpenMessagePreview
                          ? (preview) =>
                              onOpenMessagePreview(
                                {
                                  kind: "task",
                                  preview,
                                },
                                msg,
                              )
                          : undefined
                      }
                    />
                  ) : null}
                </>
              ) : displayContent ? (
                shouldRenderRuntimePeerCards ? (
                  <RuntimePeerMessageCards text={rawRuntimePeerContent} />
                ) : (
                  <MarkdownRenderer
                    content={displayContent}
                    onA2UISubmit={
                      onA2UISubmit
                        ? (formData) => onA2UISubmit(formData, msg.id)
                        : undefined
                    }
                    renderA2UIInline={renderA2UIInline}
                  />
                )
              ) : null}

              {msg.images && msg.images.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {msg.images.map((img, i) => (
                    <img
                      key={i}
                      src={`data:${img.mediaType};base64,${img.data}`}
                      className="max-w-xs rounded-lg border border-border"
                      alt="attachment"
                    />
                  ))}
                </div>
              )}

              {msg.role === "assistant" &&
                renderArtifactCards(visibleAssistantArtifacts)}

              {msg.role === "assistant" && trailingTimeline ? (
                <AgentThreadTimeline
                  turn={trailingTimeline.turn}
                  items={trailingTimeline.items}
                  threadRead={threadRead}
                  actionRequests={trailingActionRequests}
                  isCurrentTurn={trailingTimeline.turn.id === currentTurnId}
                  placement="trailing"
                  onFileClick={onFileClick}
                  onOpenArtifactFromTimeline={onOpenArtifactFromTimeline}
                  onOpenSavedSiteContent={onOpenSavedSiteContent}
                  onOpenSubagentSession={onOpenSubagentSession}
                  onPermissionResponse={onPermissionResponse}
                  focusedItemId={focusedTimelineItemId}
                  focusRequestKey={timelineFocusRequestKey}
                />
              ) : null}

              {assistantMetaFooter}

              {showMessageActions ? (
                <MessageActions className="message-actions">
                  {canQuoteMessage ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 rounded-full border border-slate-200/90 bg-white/92 text-slate-400 shadow-sm shadow-slate-950/5 hover:bg-slate-50 hover:text-slate-700"
                      onClick={() => onQuoteMessage?.(actionContent, msg.id)}
                      aria-label="引用消息"
                      title="引用消息"
                    >
                      <Quote size={12} />
                    </Button>
                  ) : null}
                  {canCopyMessage ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 rounded-full border border-slate-200/90 bg-white/92 text-slate-400 shadow-sm shadow-slate-950/5 hover:bg-slate-50 hover:text-slate-700"
                      onClick={() => handleCopy(actionContent, msg.id)}
                      aria-label="复制消息"
                      title="复制消息"
                    >
                      {copiedId === msg.id ? (
                        <Check size={12} className="text-emerald-600" />
                      ) : (
                        <Copy size={12} />
                      )}
                    </Button>
                  ) : null}
                  {canSaveMessageAsSkill ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 rounded-full border border-emerald-200/90 bg-emerald-50/92 text-emerald-600 shadow-sm shadow-emerald-950/5 hover:bg-emerald-100 hover:text-emerald-700"
                      onClick={() =>
                        onSaveMessageAsSkill?.({
                          messageId: msg.id,
                          content: actionContent,
                        })
                      }
                      aria-label="保存为技能"
                      title="保存为技能"
                    >
                      <Sparkles size={12} />
                    </Button>
                  ) : null}
                  {canSaveMessageAsInspiration ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 rounded-full border border-amber-200/90 bg-amber-50/92 text-amber-600 shadow-sm shadow-amber-950/5 hover:bg-amber-100 hover:text-amber-700"
                      onClick={() =>
                        onSaveMessageAsInspiration?.({
                          messageId: msg.id,
                          content: actionContent,
                        })
                      }
                      aria-label="保存到灵感库"
                      title="保存到灵感库"
                    >
                      <BookmarkPlus size={12} />
                    </Button>
                  ) : null}
                </MessageActions>
              ) : null}
            </MessageBubble>
          ) : null}
          {!hasAssistantBodyContent ? assistantMetaFooter : null}
        </ContentColumn>
      </MessageWrapper>
    );
  };

  const renderArtifactCards = (artifacts: Artifact[] | undefined) => {
    const visibleArtifacts =
      artifacts?.filter(
        (artifact) =>
          !isHiddenConversationArtifactPath(
            resolveArtifactProtocolFilePath(artifact),
          ),
      ) || [];
    if (visibleArtifacts.length === 0) {
      return null;
    }

    return (
      <div className="flex flex-col gap-2">
        {visibleArtifacts.map((artifact) => {
          const filePath = resolveArtifactProtocolFilePath(artifact);
          const displayTitle = resolveContentPostArtifactDisplayTitle({
            title: artifact.title,
            filePath,
            metadata: artifact.meta,
          });
          const writePhase = resolveArtifactWritePhase(artifact);
          const statusLabel = formatArtifactWritePhaseLabel(writePhase);
          const previewText = resolveArtifactPreviewText(artifact, 180);

          return (
            <button
              key={artifact.id}
              type="button"
              onClick={() => onArtifactClick?.(artifact)}
              className="w-full flex items-center gap-3 rounded-lg border border-border/70 bg-background/70 px-3 py-2 text-left transition-colors hover:border-primary/50 hover:bg-background"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                {artifact.status === "streaming" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileText className="h-4 w-4" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">
                  {displayTitle}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {filePath}
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    {statusLabel}
                  </span>
                  {previewText ? (
                    <span className="line-clamp-1 text-xs text-muted-foreground">
                      {previewText}
                    </span>
                  ) : artifact.status === "streaming" ? (
                    <span className="text-xs text-muted-foreground">
                      正在准备文件内容...
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <MessageListContainer ref={containerRef}>
      <div
        data-testid="message-list-column"
        className={
          compactLeadingSpacing
            ? "mx-auto flex w-full max-w-[1040px] flex-col gap-4 py-4 pl-2.5 pr-3"
            : "mx-auto flex w-full max-w-[1040px] flex-col gap-4 py-4 pl-4 pr-4"
        }
      >
        {leadingContent ? (
          <div data-testid="message-list-leading-content">{leadingContent}</div>
        ) : null}
        {messageGroups.length === 0 &&
          (isRestoringSession ? (
            <div
              className="flex h-64 flex-col items-center justify-center gap-3 text-muted-foreground"
              data-testid="message-list-restoring-session"
              role="status"
              aria-live="polite"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border/70 bg-background/80 shadow-sm">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
              <div className="space-y-1 text-center">
                <p className="text-lg font-medium text-foreground">
                  正在恢复生成会话...
                </p>
                <p className="text-sm text-muted-foreground">
                  正在同步最近一次生成会话，请稍候。
                </p>
              </div>
            </div>
          ) : isTaskCenterEmptyState ? (
            <div className="flex min-h-[24rem] items-center justify-center py-8">
              <section
                data-testid="message-list-empty-task-center"
                className="w-full max-w-[760px] rounded-[30px] border border-slate-200/80 bg-white px-6 py-7 text-left shadow-sm shadow-slate-950/5 md:px-8 md:py-8"
              >
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[18px] border border-slate-200/80 bg-slate-50/80">
                    <img
                      src={LIME_BRAND_LOGO_SRC}
                      alt={LIME_BRAND_NAME}
                      className="h-7 w-7 opacity-80"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="inline-flex items-center rounded-full border border-slate-200/80 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
                      创作
                    </span>

                    <div className="mt-4 space-y-2">
                      <h2 className="text-[32px] font-semibold tracking-tight text-slate-900 md:text-[36px]">
                        生成
                      </h2>
                      <p className="max-w-[48rem] text-[15px] leading-7 text-slate-600">
                        这里是 Lime 的生成主执行面，可以继续进行中的创作、回看最近结果和旧历史。
                      </p>
                      <p className="text-sm leading-7 text-slate-500">
                        还没开始生成时，从“开始生成”发起也很自然；跑过的结果、做法和中间素材后面都会继续留在这里。
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-6 flex flex-wrap gap-2">
                  <span className="inline-flex items-center rounded-full border border-slate-200/80 bg-white px-3 py-1.5 text-xs text-slate-500">
                    左侧会继续显示待继续的生成记录
                  </span>
                  <span className="inline-flex items-center rounded-full border border-slate-200/80 bg-white px-3 py-1.5 text-xs text-slate-500">
                    最近结果会继续在这里回访
                  </span>
                  <span className="inline-flex items-center rounded-full border border-slate-200/80 bg-white px-3 py-1.5 text-xs text-slate-500">
                    常用做法和恢复中的会话会自动回到这里继续生成
                  </span>
                </div>
              </section>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground opacity-50">
              <img
                src={LIME_BRAND_LOGO_SRC}
                alt={LIME_BRAND_NAME}
                className="w-12 h-12 mb-4 opacity-20"
              />
              <p className="text-lg font-medium">开始一段新的对话吧</p>
            </div>
          ))}

        {renderGroups.map((group, groupIndex) => {
          return (
            <section
              key={group.id}
              data-testid="message-turn-group"
              data-group-index={groupIndex + 1}
              className="py-2"
            >
              <div className="space-y-1">
                {group.messages.map((msg) => renderMessageItem(msg, group))}
              </div>
            </section>
          );
        })}
        <div ref={scrollRef} />
      </div>
    </MessageListContainer>
  );
};

export const MessageList = React.memo(MessageListInner);
MessageList.displayName = "MessageList";
