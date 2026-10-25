import React, { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { A2UIFormData } from "@/components/workspace/a2ui/types";
import type { AgentRuntimeThreadReadModel } from "@/lib/api/agentRuntime/sessionTypes";
import { formatDate } from "@/i18n/format";
import type {
  ContentPart,
  Message,
  MessageImage,
  MessagePreviewTarget,
} from "../types";
import type {
  ActionRequired,
  ConfirmResponse,
  SiteSavedContentTarget,
  WriteArtifactContext,
} from "../types";
import type { ArtifactTimelineOpenTarget } from "../utils/artifactTimelineNavigation";
import type { SearchResultPreviewItem } from "../utils/searchResultPreview";
import type {
  CanonicalTurnMediaSegment,
  CanonicalTurnMessageSegment,
  CanonicalTurnRenderEntry,
} from "../projection/turnTimelineRenderProjection";
import { readQuestionReplies } from "./asyncUserInput/questions";
import {
  expandQuestionSegments,
  questionRepliesText,
  type QuestionMessageSegment,
  type QuestionRenderSegment,
} from "./asyncUserInput/timelineProjection";
import {
  QuestionAnswerButton,
  QuestionReplies,
} from "./asyncUserInput/QuestionTimeline";
import {
  imageGenerationContentPartFromThreadItem,
  mediaReferenceContentPartFromThreadItem,
  messageContentPartsFromAgentThreadItem,
} from "../hooks/agentThreadMessageContentParts";
import { ContentColumn, MessageBubble, MessageWrapper } from "../styles";
import { AgentThreadTimeline } from "./AgentThreadTimeline";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { CollapsibleUserMessageContent } from "./CollapsibleUserMessageContent";
import { MessageActionButtons } from "./MessageActionButtons";
import { MessageImageAttachments } from "./MessageImageAttachments";
import { HistoricalAssistantMessagePreview } from "./MessageListHistoricalPreviews";
import {
  MESSAGE_LIST_COMPACT_HISTORICAL_ASSISTANT_PREVIEW_CHARS,
  MESSAGE_LIST_COMPACT_HISTORICAL_ASSISTANT_THRESHOLD,
  MESSAGE_LIST_LONG_HISTORICAL_MESSAGE_PREVIEW_CHARS,
  MESSAGE_LIST_LONG_HISTORICAL_MESSAGE_THRESHOLD,
} from "./messageListConstants";
import { buildHistoricalMessagePreview } from "./messageListHistoricalPreviewText";
import { isTerminalThreadTurnStatus } from "./messageListItemProjectionHelpers";
import { isActiveThreadTurnStatus } from "./messageListProjectionWebRetrieval";
import { sanitizeMessageTextForDisplay } from "../utils/messageDisplaySanitizer";
import { StreamingRenderer } from "./StreamingRenderer";
import {
  ThreadRevertTrigger,
  type ThreadRevertTarget,
} from "./ThreadRevertTrigger";

interface ConversationTurnTimelineProps {
  entry: CanonicalTurnRenderEntry;
  sessionId?: string | null;
  userMessageId?: string | null;
  assistantMessageId?: string | null;
  threadRead: AgentRuntimeThreadReadModel | null;
  pendingActions: readonly ActionRequired[];
  submittedActionsInFlight: readonly ActionRequired[];
  assistantLabel: string;
  copiedId: string | null;
  compactLeadingSpacing: boolean;
  isSending: boolean;
  renderA2UIInline: boolean;
  a2uiFormDataMap?: Record<string, { formId: string; formData: A2UIFormData }>;
  collapseCodeBlocks?: boolean;
  shouldCollapseCodeBlock?: (language: string, code: string) => boolean;
  focusedTimelineItemId?: string | null;
  timelineFocusRequestKey: number;
  shouldDeferHistoricalTimelineDetails: boolean;
  handleCopy: (content: string, id: string) => void | Promise<void>;
  onBeforeUserMessageToggle?: () => void;
  onA2UISubmit?: (formData: A2UIFormData, messageId: string) => void;
  onA2UIFormChange?: (formId: string, formData: A2UIFormData) => void;
  onWriteFile?: (
    content: string,
    fileName: string,
    context?: WriteArtifactContext,
  ) => void;
  onFileClick?: (fileName: string, content: string) => void;
  onOpenArtifactFromTimeline?: (target: ArtifactTimelineOpenTarget) => void;
  onOpenUrlPreview?: (item: SearchResultPreviewItem) => void;
  onOpenSavedSiteContent?: (target: SiteSavedContentTarget) => void;
  onOpenMessagePreview?: (
    target: MessagePreviewTarget,
    message: Message,
  ) => void;
  onOpenSubagentSession?: (sessionId: string) => void;
  onPermissionResponse?: (response: ConfirmResponse) => void;
  onQuoteMessage?: (content: string, id: string) => void;
  onRequestThreadRevert?: (target: ThreadRevertTarget) => void;
  onCodeBlockClick?: (language: string, code: string) => void;
}

function resolveUserMessageContent(
  segment: CanonicalTurnMessageSegment,
): string {
  if (segment.item.type !== "user_message") return "";
  const content = segment.item.content ?? "";
  return sanitizeMessageTextForDisplay(
    content.trim()
      ? content
      : (segment.item.content_parts ?? [])
          .flatMap((part) => (part.type === "text" ? [part.text] : []))
          .join("\n"),
    { role: "user" },
  );
}

function normalizeInlineImageData(data: string): string {
  const normalized = data.trim();
  if (!normalized.toLowerCase().startsWith("data:")) return normalized;
  const commaIndex = normalized.indexOf(",");
  return commaIndex >= 0 ? normalized.slice(commaIndex + 1) : "";
}

function resolveUserMessageImages(
  segment: CanonicalTurnMessageSegment,
): MessageImage[] {
  if (segment.item.type !== "user_message") return [];
  return (segment.item.content_parts ?? []).flatMap((part, index) => {
    if (part.type !== "image") return [];
    return [
      {
        data: normalizeInlineImageData(part.data),
        mediaType: part.mime_type,
        sourceUri: part.uri,
        sourcePath: part.source_path,
        previewUrl: part.uri,
        index,
      },
    ];
  });
}

function resolveAgentMessageContentParts(
  segment: CanonicalTurnMessageSegment,
  canonicalMediaReferenceKeys: ReadonlySet<string>,
): ContentPart[] | undefined {
  if (segment.item.type !== "agent_message") return undefined;
  const parts = messageContentPartsFromAgentThreadItem(segment.item).filter(
    (part) =>
      part.type !== "media_reference" ||
      !mediaReferenceKeys(part).some((key) =>
        canonicalMediaReferenceKeys.has(key),
      ),
  );
  if (parts.length === 0) return undefined;
  const agentText = segment.item.text ?? "";
  if (agentText.trim() && !parts.some((part) => part.type === "text")) {
    return [{ type: "text", text: agentText }, ...parts];
  }
  return parts;
}

function mediaReferenceKeys(
  part: Extract<ContentPart, { type: "media_reference" }>,
): string[] {
  return [
    part.reference.refId,
    part.reference.uri,
    part.reference.sourcePath,
    part.reference.sourceUri,
  ].flatMap((value) => {
    const normalized = value?.trim();
    return normalized ? [normalized] : [];
  });
}

function resolveMediaContentPart(
  segment: CanonicalTurnMediaSegment,
): ContentPart | null {
  return segment.item.type === "media"
    ? mediaReferenceContentPartFromThreadItem(segment.item)
    : imageGenerationContentPartFromThreadItem(segment.item);
}

function buildCanonicalPreviewMessage(params: {
  entry: CanonicalTurnRenderEntry;
  id: string;
  role?: Message["role"];
  content?: string;
  images?: MessageImage[];
}): Message {
  return {
    id: params.id,
    role: params.role ?? "assistant",
    content: params.content ?? "",
    images: params.images,
    timestamp: new Date(params.entry.turn.started_at),
    runtimeTurnId: params.entry.turn.id,
  };
}

export function ConversationTurnTimeline({
  entry,
  sessionId,
  userMessageId,
  assistantMessageId,
  threadRead,
  pendingActions,
  submittedActionsInFlight,
  assistantLabel,
  copiedId,
  compactLeadingSpacing,
  isSending,
  renderA2UIInline,
  a2uiFormDataMap,
  collapseCodeBlocks,
  shouldCollapseCodeBlock,
  focusedTimelineItemId,
  timelineFocusRequestKey,
  shouldDeferHistoricalTimelineDetails,
  handleCopy,
  onBeforeUserMessageToggle,
  onA2UISubmit,
  onA2UIFormChange,
  onWriteFile,
  onFileClick,
  onOpenArtifactFromTimeline,
  onOpenUrlPreview,
  onOpenSavedSiteContent,
  onOpenMessagePreview,
  onOpenSubagentSession,
  onPermissionResponse,
  onQuoteMessage,
  onRequestThreadRevert,

  onCodeBlockClick,
}: ConversationTurnTimelineProps) {
  const { i18n, t } = useTranslation("agent");
  const [
    expandedHistoricalAssistantItemIds,
    setExpandedHistoricalAssistantItemIds,
  ] = useState<Set<string>>(() => new Set());
  const processSegmentIds = useMemo(
    () =>
      entry.segments
        .filter((segment) => segment.kind === "process")
        .map((segment) => segment.id),
    [entry.segments],
  );
  const isActiveOperationalTurn =
    entry.isActive &&
    isActiveThreadTurnStatus(entry.turn.status) &&
    !isTerminalThreadTurnStatus(entry.turn.status);
  const revertThreadId = threadRead?.thread_id?.trim() || "";
  const canRevertTurn = Boolean(
    onRequestThreadRevert &&
    revertThreadId &&
    !isSending &&
    !isActiveOperationalTurn &&
    isTerminalThreadTurnStatus(entry.turn.status) &&
    threadRead?.can_accept_direct_input !== false,
  );
  const renderSegments = useMemo<QuestionRenderSegment[]>(
    () => expandQuestionSegments(entry.segments),
    [entry.segments],
  );
  const assistantActionOwnerId = useMemo(
    () =>
      renderSegments
        .filter(
          (segment): segment is QuestionMessageSegment =>
            segment.kind === "message" &&
            segment.item.type === "agent_message" &&
            (segment.question?.title ?? segment.item.text ?? "").trim().length >
              0,
        )
        .at(-1)?.id ?? null,
    [renderSegments],
  );
  const lastAssistantSegmentId = useMemo(
    () =>
      renderSegments
        .filter(
          (segment): segment is QuestionMessageSegment =>
            segment.kind === "message" && segment.item.type === "agent_message",
        )
        .at(-1)?.id ?? null,
    [renderSegments],
  );
  const canonicalMediaReferenceKeys = useMemo(
    () =>
      new Set(
        entry.segments.flatMap((segment) => {
          if (segment.kind !== "media") return [];
          const part = resolveMediaContentPart(segment);
          return part?.type === "media_reference"
            ? mediaReferenceKeys(part)
            : [];
        }),
      ),
    [entry.segments],
  );
  const actionRequests = useMemo(() => {
    if (!isActiveOperationalTurn) return [];
    const scoped = [...pendingActions, ...submittedActionsInFlight].filter(
      (action) =>
        action.scope?.turnId === entry.turn.id || !action.scope?.turnId,
    );
    return [
      ...new Map(scoped.map((action) => [action.requestId, action])).values(),
    ];
  }, [
    entry.turn.id,
    isActiveOperationalTurn,
    pendingActions,
    submittedActionsInFlight,
  ]);
  return (
    <div
      data-testid="conversation-turn-timeline"
      data-runtime-turn-id={entry.turn.id}
      data-runtime-turn-status={entry.turn.status}
    >
      {renderSegments.map((segment) => {
        if (segment.kind === "process") {
          return (
            <MessageWrapper
              key={segment.id}
              $isUser={false}
              $compactLeadingSpacing={compactLeadingSpacing}
              data-testid="conversation-turn-process-segment"
              data-direct-segment-kind="process"
              data-segment-id={segment.id}
            >
              <ContentColumn $isUser={false}>
                {
                  <AgentThreadTimeline
                    turn={entry.turn}
                    items={segment.items}
                    threadRead={threadRead}
                    actionRequests={actionRequests}
                    isCurrentTurn={isActiveOperationalTurn}
                    collapseInactiveDetails={
                      isActiveOperationalTurn ? !isSending : false
                    }
                    expandCompletedProcessDetails={false}
                    deferCompletedSingleDetails={!isActiveOperationalTurn}
                    placement="leading"
                    showOperationalDetails={true}
                    showInlineStatusHint={processSegmentIds[0] === segment.id}
                    onFileClick={onFileClick}
                    onOpenArtifactFromTimeline={onOpenArtifactFromTimeline}
                    onOpenSavedSiteContent={onOpenSavedSiteContent}
                    onOpenSubagentSession={onOpenSubagentSession}
                    onPermissionResponse={onPermissionResponse}
                    focusedItemId={focusedTimelineItemId}
                    focusRequestKey={timelineFocusRequestKey}
                  />
                }
              </ContentColumn>
            </MessageWrapper>
          );
        }

        if (segment.kind === "media") {
          const contentPart = resolveMediaContentPart(segment);
          const previewMessage = buildCanonicalPreviewMessage({
            entry,
            id: segment.item.id,
          });
          return (
            <MessageWrapper
              key={segment.id}
              $isUser={false}
              $compactLeadingSpacing={compactLeadingSpacing}
              data-direct-segment-kind="media"
            >
              <ContentColumn $isUser={false}>
                <MessageBubble
                  $isUser={false}
                  data-message-id={segment.item.id}
                  data-message-role="media"
                  data-runtime-turn-id={entry.turn.id}
                  data-thread-item-id={segment.item.id}
                  data-visual-tone="neutral-assistant"
                  aria-label={assistantLabel}
                >
                  {contentPart ? (
                    <StreamingRenderer
                      content=""
                      rawContent=""
                      contentParts={[contentPart]}
                      isStreaming={false}
                      suppressProcessFlow={true}
                      renderA2UIInline={false}
                      readOnlyA2UI={true}
                      readOnlyActionRequests={true}
                      onOpenMediaReference={
                        onOpenMessagePreview
                          ? (reference, index) =>
                              onOpenMessagePreview(
                                { kind: "media_reference", reference, index },
                                previewMessage,
                              )
                          : undefined
                      }
                    />
                  ) : (
                    <AgentThreadTimeline
                      turn={entry.turn}
                      items={[segment.item]}
                      threadRead={threadRead}
                      isCurrentTurn={false}
                      placement="leading"
                      showOperationalDetails={true}
                      showInlineStatusHint={false}
                      expandCompletedProcessDetails={true}
                      focusedItemId={focusedTimelineItemId}
                      focusRequestKey={timelineFocusRequestKey}
                    />
                  )}
                </MessageBubble>
              </ContentColumn>
            </MessageWrapper>
          );
        }

        const isUser = segment.item.type === "user_message";
        const questionReplies = readQuestionReplies(segment.item);
        const content = questionReplies
          ? questionRepliesText(questionReplies)
          : segment.item.type === "user_message"
            ? resolveUserMessageContent(segment)
            : (segment.question?.title ?? segment.item.text ?? "");
        const isStreaming =
          !isUser &&
          !segment.question &&
          entry.isActive &&
          entry.turn.status === "running" &&
          segment.item.status === "in_progress";
        const userImages = isUser ? resolveUserMessageImages(segment) : [];
        const previewMessage = buildCanonicalPreviewMessage({
          entry,
          id: segment.item.id,
          role: isUser ? "user" : "assistant",
          content,
          images: userImages,
        });
        const agentContentParts = isUser
          ? undefined
          : segment.question
            ? [{ type: "text" as const, text: segment.question.title }]
            : resolveAgentMessageContentParts(
                segment,
                canonicalMediaReferenceKeys,
              );
        const hasNonTextAgentContent = Boolean(
          agentContentParts?.some((part) => part.type !== "text"),
        );
        const shouldPreviewHistoricalAssistant =
          !isUser &&
          !isStreaming &&
          shouldDeferHistoricalTimelineDetails &&
          content.length >
            MESSAGE_LIST_COMPACT_HISTORICAL_ASSISTANT_THRESHOLD &&
          !content.includes("```a2ui") &&
          !hasNonTextAgentContent &&
          !expandedHistoricalAssistantItemIds.has(segment.item.id);
        const isLongHistoricalAssistant =
          content.length > MESSAGE_LIST_LONG_HISTORICAL_MESSAGE_THRESHOLD;
        const historicalAssistantPreview = shouldPreviewHistoricalAssistant
          ? buildHistoricalMessagePreview(
              content,
              isLongHistoricalAssistant
                ? MESSAGE_LIST_LONG_HISTORICAL_MESSAGE_PREVIEW_CHARS
                : MESSAGE_LIST_COMPACT_HISTORICAL_ASSISTANT_PREVIEW_CHARS,
            )
          : "";

        return (
          <MessageWrapper
            key={segment.id}
            $isUser={isUser}
            $compactLeadingSpacing={compactLeadingSpacing}
          >
            <ContentColumn $isUser={isUser}>
              <MessageBubble
                $isUser={isUser}
                data-message-id={
                  segment.question
                    ? segment.question.id
                    : isUser
                      ? userMessageId || segment.item.id
                      : segment.id ===
                          (assistantActionOwnerId ?? lastAssistantSegmentId)
                        ? assistantMessageId || segment.item.id
                        : segment.item.id
                }
                data-message-role={isUser ? "user" : "assistant"}
                data-runtime-turn-id={entry.turn.id}
                data-thread-item-id={segment.item.id}
                data-question-item-id={segment.question?.id}
                data-direct-segment-kind="message"
                data-visual-tone={isUser ? "neutral-user" : "neutral-assistant"}
                aria-label={isUser ? undefined : assistantLabel}
              >
                {isUser ? (
                  <div className="space-y-2">
                    {questionReplies ? (
                      <QuestionReplies replies={questionReplies} />
                    ) : content ? (
                      <CollapsibleUserMessageContent
                        content={content}
                        onBeforeToggle={onBeforeUserMessageToggle}
                        revealRequestKey={
                          focusedTimelineItemId === segment.item.id
                            ? timelineFocusRequestKey
                            : 0
                        }
                      >
                        <MarkdownRenderer
                          content={content}
                          promptLinkItemId={segment.item.id}
                          renderA2UIInline={renderA2UIInline}
                          readOnlyA2UI={!isActiveOperationalTurn}
                        />
                      </CollapsibleUserMessageContent>
                    ) : null}
                    <MessageImageAttachments
                      images={userImages}
                      threadId={threadRead?.thread_id}
                      onOpenImage={
                        onOpenMessagePreview
                          ? (attachment, index) =>
                              onOpenMessagePreview(
                                {
                                  kind: "message_attachment",
                                  attachment,
                                  index,
                                },
                                previewMessage,
                              )
                          : undefined
                      }
                    />
                  </div>
                ) : shouldPreviewHistoricalAssistant ? (
                  <HistoricalAssistantMessagePreview
                    content={historicalAssistantPreview}
                    contentLength={content.length}
                    variant={isLongHistoricalAssistant ? "long" : "compact"}
                    onExpand={() => {
                      setExpandedHistoricalAssistantItemIds((current) => {
                        const next = new Set(current);
                        next.add(segment.item.id);
                        return next;
                      });
                    }}
                  />
                ) : (
                  <StreamingRenderer
                    content={content}
                    rawContent={content}
                    isStreaming={isStreaming}
                    contentParts={agentContentParts}
                    showCursor={isStreaming}
                    suppressProcessFlow={true}
                    renderA2UIInline={renderA2UIInline}
                    readOnlyA2UI={!isActiveOperationalTurn}
                    readOnlyActionRequests={!isActiveOperationalTurn}
                    onA2UISubmit={
                      onA2UISubmit
                        ? (formData) => onA2UISubmit(formData, segment.item.id)
                        : undefined
                    }
                    a2uiFormId={a2uiFormDataMap?.[segment.item.id]?.formId}
                    a2uiInitialFormData={
                      a2uiFormDataMap?.[segment.item.id]?.formData
                    }
                    onA2UIFormChange={onA2UIFormChange}
                    onWriteFile={
                      onWriteFile
                        ? (fileContent, fileName, context) =>
                            onWriteFile(fileContent, fileName, {
                              ...context,
                              sourceMessageId:
                                context?.sourceMessageId || segment.item.id,
                              source: context?.source || "message_content",
                            })
                        : undefined
                    }
                    onFileClick={onFileClick}
                    fileChangesUndoSessionId={sessionId}
                    onOpenSavedSiteContent={onOpenSavedSiteContent}
                    onOpenUrlPreview={onOpenUrlPreview}
                    onOpenMediaReference={
                      onOpenMessagePreview
                        ? (reference, index) =>
                            onOpenMessagePreview(
                              { kind: "media_reference", reference, index },
                              previewMessage,
                            )
                        : undefined
                    }
                    onPermissionResponse={onPermissionResponse}
                    collapseCodeBlocks={collapseCodeBlocks}
                    shouldCollapseCodeBlock={shouldCollapseCodeBlock}
                    onCodeBlockClick={onCodeBlockClick}
                  />
                )}

                {segment.question ? (
                  <QuestionAnswerButton
                    question={segment.question}
                    threadId={segment.item.thread_id}
                    active={Boolean(
                      sessionId &&
                      threadRead &&
                      entry.turn.status === "running" &&
                      threadRead.can_accept_direct_input !== false,
                    )}
                  />
                ) : null}

                {!isUser &&
                content.trim() &&
                segment.id === assistantActionOwnerId ? (
                  <MessageActionButtons
                    actionContent={content}
                    canCopyMessage={true}
                    canQuoteMessage={Boolean(onQuoteMessage)}
                    copied={copiedId === segment.item.id}
                    isImageWorkbenchMessage={false}
                    messageId={segment.item.id}
                    onCopy={handleCopy}
                    onQuoteMessage={onQuoteMessage}
                  />
                ) : null}
              </MessageBubble>

              {isUser ? (
                <div
                  className="user-message-footer flex items-center justify-end gap-2 pr-1 text-xs leading-5 text-slate-400"
                  data-testid="user-message-footer"
                >
                  <span data-testid="user-message-timestamp">
                    {formatDate(new Date(segment.item.started_at), {
                      locale: i18n.language,
                      weekday: "long",
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    })}
                  </span>
                  {content.trim() ? (
                    <button
                      type="button"
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                      onClick={() => void handleCopy(content, segment.item.id)}
                      aria-label={t("agentChat.messageList.actions.copy")}
                      title={t("agentChat.messageList.actions.copy")}
                    >
                      {copiedId === segment.item.id ? (
                        <Check size={13} />
                      ) : (
                        <Copy size={13} />
                      )}
                    </button>
                  ) : null}
                  {canRevertTurn && onRequestThreadRevert ? (
                    <ThreadRevertTrigger
                      target={{
                        messageId: userMessageId || segment.item.id,
                        threadId: revertThreadId,
                        beforeTurnId: entry.turn.id,
                      }}
                      onRequest={onRequestThreadRevert}
                    />
                  ) : null}
                </div>
              ) : null}
            </ContentColumn>
          </MessageWrapper>
        );
      })}
    </div>
  );
}
