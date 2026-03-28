import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  User,
  Copy,
  Edit2,
  Trash2,
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
  AvatarColumn,
  ContentColumn,
  MessageHeader,
  AvatarCircle,
  SenderName,
  TimeStamp,
  MessageBubble,
  MessageActions,
} from "../styles";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { StreamingRenderer } from "./StreamingRenderer";
import { TokenUsageDisplay } from "./TokenUsageDisplay";
import { AgentThreadTimeline } from "./AgentThreadTimeline";
import {
  formatArtifactWritePhaseLabel,
  resolveArtifactPreviewText,
  resolveArtifactWritePhase,
} from "../utils/messageArtifacts";
import {
  sanitizeContentPartsForDisplay,
  sanitizeMessageTextForDisplay,
  sanitizeMessageTextForPreview,
} from "../utils/internalImagePlaceholder";
import {
  Message,
  type ActionRequired,
  type AgentThreadItem,
  type AgentThreadTurn,
  type SiteSavedContentTarget,
  type WriteArtifactContext,
} from "../types";
import type { A2UIFormData } from "@/components/content-creator/a2ui/types";
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
}

function isDeferredTimelineItem(item: AgentThreadItem): boolean {
  return item.type === "file_artifact";
}

const MessageListInner: React.FC<MessageListProps> = ({
  messages,
  turns = [],
  threadItems = [],
  currentTurnId = null,
  threadRead = null,
  assistantLabel = "Lime",
  onDeleteMessage,
  onEditMessage,
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
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
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

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const formatGroupNumber = (index: number) => {
    return String(index + 1).padStart(2, "0");
  };

  const truncatePreview = (value: string, maxLength = 56) => {
    const normalized = value.trim().replace(/\s+/g, " ");
    if (!normalized) {
      return "继续当前任务";
    }
    if (normalized.length <= maxLength) {
      return normalized;
    }
    return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
  };

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

  const handleEdit = (msg: Message) => {
    setEditingId(msg.id);
    setEditContent(msg.content);
  };

  const handleSaveEdit = (id: string) => {
    if (onEditMessage && editContent.trim()) {
      onEditMessage(id, editContent);
    }
    setEditingId(null);
    setEditContent("");
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditContent("");
  };

  const handleDelete = (id: string) => {
    if (onDeleteMessage) {
      onDeleteMessage(id);
      toast.success("消息已删除");
    }
  };

  const renderMessageItem = (
    msg: Message,
    options?: {
      showIdentity?: boolean;
    },
  ) => {
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
    const mappedTimeline = timelineByMessageId.get(msg.id);
    const timeline =
      msg.role !== "assistant"
        ? null
        : msg.id === lastAssistantMessageId
          ? currentTurnTimeline || mappedTimeline || null
          : mappedTimeline?.turn.id === currentTurnTimeline?.turn.id
            ? null
            : mappedTimeline || null;
    const primaryTimelineItems = timeline
      ? timeline.items.filter((item) => !isDeferredTimelineItem(item))
      : [];
    const trailingTimelineItems = timeline
      ? timeline.items.filter(isDeferredTimelineItem)
      : [];
    const primaryTimeline =
      timeline && primaryTimelineItems.length > 0
        ? { ...timeline, items: primaryTimelineItems }
        : null;
    const trailingTimeline =
      timeline && trailingTimelineItems.length > 0
        ? { ...timeline, items: trailingTimelineItems }
        : null;
    const primaryActionRequests =
      primaryTimelineItems.length > 0 ? msg.actionRequests : undefined;
    const trailingActionRequests =
      primaryTimelineItems.length === 0 ? msg.actionRequests : undefined;
    const showIdentity = options?.showIdentity ?? true;

    return (
      <MessageWrapper
        key={msg.id}
        $isUser={msg.role === "user"}
        $compactLeadingSpacing={compactLeadingSpacing}
      >
        <AvatarColumn>
          {msg.role === "user" ? (
            <AvatarCircle $isUser={true}>
              <User size={20} />
            </AvatarCircle>
          ) : showIdentity ? (
            <img
              src={logoImg}
              alt="Lime"
              style={{
                width: 45,
                height: 45,
                minWidth: 45,
                minHeight: 45,
                borderRadius: 8,
                display: "block",
              }}
            />
          ) : (
            <div className="flex h-[45px] w-[45px] items-start justify-center pt-4">
              <span className="h-2.5 w-2.5 rounded-full bg-slate-300/90 dark:bg-slate-600/90" />
            </div>
          )}
        </AvatarColumn>

        <ContentColumn>
          {showIdentity ? (
            <MessageHeader>
              <SenderName>
                {msg.role === "user" ? "用户" : assistantLabel}
              </SenderName>
              <TimeStamp>{formatTime(msg.timestamp)}</TimeStamp>
            </MessageHeader>
          ) : (
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center rounded-full border border-slate-200/80 bg-slate-50/80 px-2 py-0.5 font-medium text-slate-600 dark:border-slate-700/70 dark:bg-slate-900/40 dark:text-slate-300">
                继续处理
              </span>
              <span>{formatTime(msg.timestamp)}</span>
            </div>
          )}

          <MessageBubble $isUser={msg.role === "user"}>
            {editingId === msg.id ? (
              <div className="flex flex-col gap-2">
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full min-h-[100px] p-2 rounded border border-border bg-background resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                  autoFocus
                />
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" size="sm" onClick={handleCancelEdit}>
                    取消
                  </Button>
                  <Button size="sm" onClick={() => handleSaveEdit(msg.id)}>
                    保存
                  </Button>
                </div>
              </div>
            ) : msg.role === "assistant" ? (
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
                  renderA2UIInline={renderA2UIInline}
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
                  renderProposedPlanBlocks={!timeline}
                />
              </>
            ) : (
              displayContent ? (
                <MarkdownRenderer
                  content={displayContent}
                  onA2UISubmit={
                    onA2UISubmit
                      ? (formData) => onA2UISubmit(formData, msg.id)
                      : undefined
                  }
                  renderA2UIInline={renderA2UIInline}
                />
              ) : null
            )}

            {msg.images && msg.images.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3">
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
                <details className="mt-3 rounded border border-border/60 bg-muted/20">
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

            {editingId !== msg.id && (
              <MessageActions className="message-actions">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                  onClick={() => handleCopy(msg.content, msg.id)}
                >
                  {copiedId === msg.id ? (
                    <Check size={12} className="text-green-500" />
                  ) : (
                    <Copy size={12} />
                  )}
                </Button>
                {msg.role === "user" && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    onClick={() => handleEdit(msg)}
                  >
                    <Edit2 size={12} />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-destructive"
                  onClick={() => handleDelete(msg.id)}
                >
                  <Trash2 size={12} />
                </Button>
              </MessageActions>
            )}
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
      <div className="mt-3 flex flex-col gap-2">
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
        className={
          compactLeadingSpacing
            ? "mx-auto flex w-full max-w-[1180px] flex-col gap-4 py-3 pl-2.5 pr-3"
            : "mx-auto flex w-full max-w-[1180px] flex-col gap-4 py-3 pl-5 pr-4"
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
          const previewSource = group.userMessage
            ? sanitizeMessageTextForPreview(group.userMessage.content || "", {
                role: group.userMessage.role,
                hasImages:
                  Array.isArray(group.userMessage.images) &&
                  group.userMessage.images.length > 0,
              }) || "继续当前任务"
            : group.assistantMessages[0]
              ? sanitizeMessageTextForPreview(
                  group.assistantMessages[0].content || "",
                  {
                    role: group.assistantMessages[0].role,
                    hasImages:
                      Array.isArray(group.assistantMessages[0].images) &&
                      group.assistantMessages[0].images.length > 0,
                  },
                ) || "继续当前任务"
              : "继续当前任务";
          const hasTimeline = group.messages.some((message) =>
            timelineByMessageId.has(message.id),
          );
          let assistantMessageCount = 0;

          return (
            <section
              key={group.id}
              data-testid="message-turn-group"
              data-group-index={groupIndex + 1}
              className={
                compactLeadingSpacing
                  ? "border-t border-slate-200/70 py-4 pl-0 pr-0 first:border-t-0 first:pt-0 dark:border-slate-800/70"
                  : "border-t border-slate-200/70 py-4 pl-2 pr-1 first:border-t-0 first:pt-0 dark:border-slate-800/70"
              }
            >
              <div
                data-testid={`message-turn-group:${groupIndex + 1}:header`}
                className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
              >
                <span className="inline-flex items-center rounded-full border border-slate-200/80 bg-white/90 px-2.5 py-1 font-medium text-slate-700 shadow-sm shadow-slate-950/5 dark:border-slate-700/80 dark:bg-slate-900/80 dark:text-slate-200">
                  阶段 {formatGroupNumber(groupIndex)}
                </span>
                <span>{formatTime(group.startedAt)}</span>
                {group.endedAt.getTime() !== group.startedAt.getTime() ? (
                  <span>至 {formatTime(group.endedAt)}</span>
                ) : null}
                {group.assistantMessages.length > 1 ? (
                  <span className="inline-flex items-center rounded-full border border-sky-200/70 bg-sky-50/80 px-2 py-0.5 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200">
                    {group.assistantMessages.length} 条回复
                  </span>
                ) : hasTimeline ? (
                  <span className="inline-flex items-center rounded-full border border-emerald-200/70 bg-emerald-50/80 px-2 py-0.5 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
                    含执行轨迹
                  </span>
                ) : null}
                <span className="min-w-0 flex-1 rounded-full bg-slate-100/80 px-2.5 py-1 text-slate-600 dark:bg-slate-800/70 dark:text-slate-300">
                  <span className="block truncate">
                    {truncatePreview(previewSource)}
                  </span>
                </span>
              </div>

              <div className="space-y-1">
                {group.messages.map((msg) => {
                  const showIdentity =
                    msg.role === "user" || assistantMessageCount === 0;

                  if (msg.role === "assistant") {
                    assistantMessageCount += 1;
                  }

                  return renderMessageItem(msg, { showIdentity });
                })}
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
