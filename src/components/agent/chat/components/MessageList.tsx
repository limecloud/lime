import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  Copy,
  Quote,
  Check,
  FileText,
  Loader2,
  ExternalLink,
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
import {
  formatArtifactWritePhaseLabel,
  resolveArtifactPreviewText,
  resolveArtifactWritePhase,
} from "../utils/messageArtifacts";
import {
  sanitizeContentPartsForDisplay,
  sanitizeMessageTextForDisplay,
} from "../utils/internalImagePlaceholder";
import { isInternalRoutingTurnSummaryText } from "../utils/turnSummaryPresentation";
import {
  Message,
  type ActionRequired,
  type AgentThreadItem,
  type AgentThreadTurn,
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
import logoImg from "/logo.png";
import type { ArtifactTimelineOpenTarget } from "../utils/artifactTimelineNavigation";

interface MessageListProps {
  messages: Message[];
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
  tools: boolean;
  actions: boolean;
}

function resolveInlineProcessCoverage(params: {
  contentParts?: Message["contentParts"];
  thinkingContent?: string;
  toolCalls?: Message["toolCalls"];
  actionRequests?: Message["actionRequests"];
}): InlineProcessCoverage {
  const contentParts = params.contentParts || [];
  if (contentParts.length > 0) {
    const thinking = contentParts.some(
      (part) => part.type === "thinking" && part.text.trim().length > 0,
    );
    const tools = contentParts.some((part) => part.type === "tool_use");
    const actions = contentParts.some(
      (part) => part.type === "action_required",
    );
    return {
      hasInlineProcessEntries: thinking || tools || actions,
      thinking,
      tools,
      actions,
    };
  }

  const thinking = Boolean(params.thinkingContent?.trim());
  const tools = Boolean(params.toolCalls?.length);
  const actions = Boolean(params.actionRequests?.length);

  return {
    hasInlineProcessEntries: thinking || tools || actions,
    thinking,
    tools,
    actions,
  };
}

function isInlineCoveredTimelineItem(
  item: AgentThreadItem,
  coverage: InlineProcessCoverage,
): boolean {
  switch (item.type) {
    case "reasoning":
      return coverage.thinking;
    case "tool_call":
    case "command_execution":
    case "web_search":
      return coverage.tools;
    case "approval_request":
    case "request_user_input":
      return coverage.actions;
    default:
      return false;
  }
}

const MessageListInner: React.FC<MessageListProps> = ({
  messages,
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
  onOpenSubagentSession,
  onPermissionResponse,
  collapseCodeBlocks,
  shouldCollapseCodeBlock,
  onCodeBlockClick,
  promoteActionRequestsToA2UI = false,
  compactLeadingSpacing = false,
  focusedTimelineItemId = null,
  timelineFocusRequestKey = 0,
  activePendingA2UISource = null,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
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

  // 智能自动滚动：只在用户没有手动滚动且在底部时才自动滚动
  useEffect(() => {
    if (shouldAutoScroll && !isUserScrolling && scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [visibleMessages, shouldAutoScroll, isUserScrolling]);

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

          if (isInlineCoveredTimelineItem(item, inlineProcessCoverage)) {
            return false;
          }

          return true;
        })
      : [];
    const trailingTimelineItems = timeline
      ? timelineConversationItems.filter((item) => isDeferredTimelineItem(item))
      : [];
    const primaryTimeline =
      timeline && primaryTimelineItems.length > 0
        ? { ...timeline, items: primaryTimelineItems }
        : null;
    const trailingTimeline =
      timeline && trailingTimelineItems.length > 0
        ? { ...timeline, items: trailingTimelineItems }
        : null;
    const timelineActionRequests = inlineProcessCoverage.actions
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
    const showMessageActions =
      msg.role === "user" && (canQuoteMessage || canCopyMessage);

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
                {msg.imageWorkbenchPreview ? (
                  <ImageWorkbenchMessagePreview
                    preview={msg.imageWorkbenchPreview}
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
              </MessageActions>
            ) : null}
          </MessageBubble>
        </ContentColumn>
      </MessageWrapper>
    );
  };

  const renderArtifactCards = (artifacts: Artifact[] | undefined) => {
    if (!artifacts || artifacts.length === 0) {
      return null;
    }

    return (
      <div className="flex flex-col gap-2">
        {artifacts.map((artifact) => {
          const filePath = resolveArtifactProtocolFilePath(artifact);
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
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary shrink-0">
                {artifact.status === "streaming" ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <FileText className="w-4 h-4" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">
                  {artifact.title}
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
              <div className="flex items-center gap-2 shrink-0">
                <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
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
        {messageGroups.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground opacity-50">
            <img
              src={logoImg}
              alt="Lime"
              className="w-12 h-12 mb-4 opacity-20"
            />
            <p className="text-lg font-medium">开始一段新的对话吧</p>
          </div>
        )}

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
