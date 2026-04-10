import React, {
  useState,
  useRef,
  useEffect,
  useMemo,
  useLayoutEffect,
} from "react";
import {
  Copy,
  Quote,
  Check,
  FileText,
  Loader2,
  ExternalLink,
  Sparkles,
  BookmarkPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { Artifact } from "@/lib/artifact/types";
import { resolveArtifactProtocolFilePath } from "@/lib/artifact-protocol";
import {
  MessageListContainer,
  MessageWrapper,
  ContentColumn,
  MessageBubble,
  MessageActions,
} from "../styles";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { StreamingRenderer } from "./StreamingRenderer";
import { TokenUsageDisplay } from "./TokenUsageDisplay";
import { AgentThreadTimeline } from "./AgentThreadTimeline";
import { ImageWorkbenchMessagePreview } from "./ImageWorkbenchMessagePreview";
import { TaskMessagePreview } from "./TaskMessagePreview";
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
import { isInternalRoutingTurnSummaryText } from "../utils/turnSummaryPresentation";
import {
  Message,
  type ActionRequired,
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
  AgentRuntimeThreadReadModel,
  QueuedTurnSnapshot,
} from "@/lib/api/agentRuntime";
import { buildMessageTurnTimeline } from "../utils/threadTimelineView";
import { buildMessageTurnGroups } from "../utils/messageTurnGrouping";
import { resolveLatestProjectFileSavedSiteContentTargetFromMessage } from "../utils/latestSavedSiteContentTarget";
import {
  resolveSiteSavedContentTargetDisplayName,
  resolveSiteSavedContentTargetRelativePath,
} from "../utils/siteToolResultSummary";
import logoImg from "/logo.png";
import {
  type ArtifactTimelineOpenTarget,
} from "../utils/artifactTimelineNavigation";

interface MessageListProps {
  messages: Message[];
  emptyStateVariant?: "default" | "task-center";
  turns?: AgentThreadTurn[];
  threadItems?: AgentThreadItem[];
  currentTurnId?: string | null;
  threadRead?: AgentRuntimeThreadReadModel | null;
  pendingActions?: ActionRequired[];
  submittedActionsInFlight?: ActionRequired[];
  queuedTurns?: QueuedTurnSnapshot[];
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

  if (item.status === "in_progress" && options?.hasInlineRuntimeStatus) {
    return false;
  }

  if (item.status !== "completed") {
    return true;
  }

  if (isInternalRoutingTurnSummaryText(item.text)) {
    return false;
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
  if (contentParts.length > 0) {
    const toolNameCounts = new Map<string, number>();
    const actionRequestCounts = new Map<string, number>();
    const thinking = contentParts.some(
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
    return {
      hasInlineProcessEntries:
        thinking || toolNameCounts.size > 0 || actionRequestCounts.size > 0,
      thinking,
      toolNameCounts,
      actionRequestCounts,
    };
  }

  const toolNameCounts = new Map<string, number>();
  const actionRequestCounts = new Map<string, number>();
  const thinking = Boolean(params.thinkingContent?.trim());
  (params.toolCalls || []).forEach((toolCall) => {
    incrementInlineCoverageCount(
      toolNameCounts,
      normalizeInlineCoverageKey(toolCall.name),
    );
  });
  (params.actionRequests || []).forEach((actionRequest) => {
    incrementInlineCoverageCount(
      actionRequestCounts,
      normalizeInlineCoverageKey(actionRequest.requestId),
    );
  });

  return {
    hasInlineProcessEntries:
      thinking || toolNameCounts.size > 0 || actionRequestCounts.size > 0,
    thinking,
    toolNameCounts,
    actionRequestCounts,
  };
}

const MessageListInner: React.FC<MessageListProps> = ({
  messages,
  emptyStateVariant = "default",
  turns = [],
  threadItems = [],
  currentTurnId = null,
  threadRead = null,
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
  compactLeadingSpacing = false,
  focusedTimelineItemId = null,
  timelineFocusRequestKey = 0,
  activePendingA2UISource = null,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const previousVisibleMessageCountRef = useRef<number | null>(null);
  const isTaskCenterEmptyState = emptyStateVariant === "task-center";
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);

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
  const currentTurnTimeline = useMemo(() => {
    if (!currentTurnId || !lastAssistantMessageId) {
      return null;
    }

    const turn = turns.find((entry) => entry.id === currentTurnId);
    if (!turn) {
      return null;
    }

    return {
      messageId: lastAssistantMessageId,
      turn,
      items: threadItems.filter((item) => item.turn_id === turn.id),
    };
  }, [currentTurnId, lastAssistantMessageId, threadItems, turns]);
  const messageGroups = useMemo(
    () => buildMessageTurnGroups(visibleMessages),
    [visibleMessages],
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

  const renderMessageItem = (msg: Message) => {
    const hasImages = Array.isArray(msg.images) && msg.images.length > 0;
    const displayContent = sanitizeMessageTextForDisplay(msg.content || "", {
      role: msg.role,
      hasImages,
    });
    const displayContentParts = sanitizeContentPartsForDisplay(
      msg.contentParts,
      {
        role: msg.role,
        hasImages,
      },
    );
    const inlineProcessCoverage = resolveInlineProcessCoverage({
      contentParts: displayContentParts,
      thinkingContent: msg.thinkingContent,
      toolCalls: msg.toolCalls,
      actionRequests: msg.actionRequests,
    });
    const mappedTimeline = timelineByMessageId.get(msg.id);
    const timeline =
      msg.role !== "assistant"
        ? null
        : msg.id === lastAssistantMessageId
          ? currentTurnTimeline || mappedTimeline || null
          : mappedTimeline?.turn.id === currentTurnTimeline?.turn.id
            ? null
            : mappedTimeline || null;
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
          timelineConversationItems.filter((item) => isDeferredTimelineItem(item)),
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
    const timelineActionRequests = inlineProcessCoverage.actionRequestCounts.size
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
    const messageCanvasShortcutTitle = messageSavedSiteContentTarget
      ? resolveSiteSavedContentTargetDisplayName(messageSavedSiteContentTarget) ||
        "导出稿"
      : "文件";
    const messageCanvasShortcutPath = messageSavedSiteContentTarget
      ? resolveSiteSavedContentTargetRelativePath(messageSavedSiteContentTarget)
      : null;

    return (
      <MessageWrapper
        key={msg.id}
        $isUser={msg.role === "user"}
        $compactLeadingSpacing={compactLeadingSpacing}
      >
        <ContentColumn $isUser={msg.role === "user"}>
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
                  isStreaming={msg.isThinking}
                  toolCalls={msg.toolCalls}
                  showCursor={msg.isThinking && !displayContent}
                  thinkingContent={msg.thinkingContent}
                  runtimeStatus={msg.runtimeStatus}
                  contentParts={displayContentParts}
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
                            sourceMessageId: context?.sourceMessageId || msg.id,
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
                      ? (quotedContent) => onQuoteMessage(quotedContent, msg.id)
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
              <MarkdownRenderer
                content={displayContent}
                onA2UISubmit={
                  onA2UISubmit
                    ? (formData) => onA2UISubmit(formData, msg.id)
                    : undefined
                }
                renderA2UIInline={renderA2UIInline}
              />
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

            {msg.role === "assistant" && renderArtifactCards(msg.artifacts)}

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

            {msg.role === "assistant" && !msg.isThinking && msg.usage && (
              <TokenUsageDisplay usage={msg.usage} />
            )}

            {msg.role === "assistant" &&
              !msg.isThinking &&
              msg.contextTrace &&
              msg.contextTrace.length > 0 && (
                <details className="rounded border border-border/60 bg-muted/20">
                  <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground hover:text-foreground">
                    上下文轨迹 ({msg.contextTrace.length})
                  </summary>
                  <div className="border-t border-border/60 px-3 py-2 space-y-1.5">
                    {msg.contextTrace.map((step, index) => (
                      <div key={`${step.stage}-${index}`} className="text-xs">
                        <span className="font-medium text-foreground/90">
                          {step.stage}
                        </span>
                        <span className="text-muted-foreground">: </span>
                        <span className="text-muted-foreground">
                          {step.detail}
                        </span>
                      </div>
                    ))}
                  </div>
                </details>
              )}

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
                  正在恢复任务中心...
                </p>
                <p className="text-sm text-muted-foreground">
                  正在同步最近一次任务会话，请稍候。
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
                      src={logoImg}
                      alt="Lime"
                      className="h-7 w-7 opacity-80"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="inline-flex items-center rounded-full border border-slate-200/80 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
                      创作
                    </span>

                    <div className="mt-4 space-y-2">
                      <h2 className="text-[32px] font-semibold tracking-tight text-slate-900 md:text-[36px]">
                        任务中心
                      </h2>
                      <p className="max-w-[48rem] text-[15px] leading-7 text-slate-600">
                        回到进行中的任务、旧历史和最近工作现场。
                      </p>
                      <p className="text-sm leading-7 text-slate-500">
                        还没有进行中的任务时，从新建任务开始也很自然。
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-6 flex flex-wrap gap-2">
                  <span className="inline-flex items-center rounded-full border border-slate-200/80 bg-white px-3 py-1.5 text-xs text-slate-500">
                    左侧会继续显示最近任务
                  </span>
                  <span className="inline-flex items-center rounded-full border border-slate-200/80 bg-white px-3 py-1.5 text-xs text-slate-500">
                    旧历史会继续在这里回访
                  </span>
                  <span className="inline-flex items-center rounded-full border border-slate-200/80 bg-white px-3 py-1.5 text-xs text-slate-500">
                    恢复中的会话会自动回到这里
                  </span>
                </div>
              </section>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground opacity-50">
              <img
                src={logoImg}
                alt="Lime"
                className="w-12 h-12 mb-4 opacity-20"
              />
              <p className="text-lg font-medium">开始一段新的对话吧</p>
            </div>
          ))}

        {messageGroups.map((group, groupIndex) => {
          return (
            <section
              key={group.id}
              data-testid="message-turn-group"
              data-group-index={groupIndex + 1}
              className="py-2"
            >
              <div className="space-y-1">
                {group.messages.map((msg) => renderMessageItem(msg))}
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
