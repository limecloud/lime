import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  MessageListContainer,
  MessageListFrame,
  MessageTurnGroup,
} from "../styles";
import type { AgentStreamTextOverlaySnapshot } from "../hooks/agentStreamTextOverlayStore";
import type { Message } from "../types";
import { MessageListItem } from "./MessageListItem";
import { ConversationTurnTimeline } from "./ConversationTurnTimeline";
import type {
  MessageListProps,
  MessageListRenderGroup,
} from "./MessageList.types";
import {
  PersistedHistoryWindow,
  RestoringSessionEmptyState,
  TaskCenterEmptyState,
} from "./MessageListHistoryChrome";
import { MessageListStreamingOverlayItem } from "./MessageListStreamingOverlayItem";
import { useMessageListHistoricalHydration } from "./useMessageListHistoricalHydration";
import { useMessageListPromptCacheNotice } from "./useMessageListPromptCacheNotice";
import { useMessageListHistoryState } from "./useMessageListHistoryState";
import { filterVisibleConversationMessages } from "../projection/conversationMessages";
import {
  VirtualizedTurnList,
  type VirtualizedTurnListSnapshot,
} from "./VirtualizedTurnList";
import { useMessageListScrollController } from "./useMessageListScrollController";
import { useMessageListTelemetry } from "./useMessageListTelemetry";
import { useMessageListTimelineState } from "./useMessageListTimelineState";
import { CONVERSATION_CONTENT_MAX_WIDTH } from "../styles/conversationLayoutTokens";
import { mergeRuntimeSyncThreadItems } from "../hooks/agentSessionTimelineMergePolicy";
import {
  ThreadRevertDialog,
  type ThreadRevertStatus,
} from "./ThreadRevertDialog";
import type { ThreadRevertTarget } from "./ThreadRevertTrigger";
import { ReasoningVisibility } from "./ReasoningVisibility";
import { PromptLinks } from "./PromptLinks";

function findLastMessage(
  messages: readonly Message[],
  predicate: (message: Message) => boolean,
): Message | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && predicate(message)) {
      return message;
    }
  }
  return undefined;
}

const MessageListInner: React.FC<MessageListProps> = ({
  sessionId = null,
  messages,
  leadingContent,
  trailingContent,
  emptyStateVariant = "none",
  turns = [],
  threadItems = [],
  currentTurnId = null,
  threadRead = null,
  pendingActions = [],
  submittedActionsInFlight = [],
  canonicalChildren = [],
  sessionHistoryWindow = null,
  onLoadFullHistory,
  isSending = false,
  assistantLabel = "Lime",
  onQuoteMessage,
  onRevertThread,
  onEditMessage,
  onA2UISubmit,
  renderA2UIInline = true,
  a2uiFormDataMap,
  onA2UIFormChange,
  onWriteFile,
  onFileClick,
  onOpenArtifactFromTimeline,
  onOpenUrlPreview,
  onOpenSavedSiteContent,
  onArtifactClick,
  onOpenMessagePreview,

  onOpenSubagentSession,
  onPermissionResponse,
  collapseCodeBlocks,
  shouldCollapseCodeBlock,
  onCodeBlockClick,
  isRestoringSession = false,
  onInterruptCurrentTurn,
  compactLeadingSpacing = false,
  focusedTimelineItemId = null,
  timelineFocusRequestKey = 0,
  activePendingA2UISource = null,
  providerType,
}) => {
  const { t } = useTranslation("agent");
  const isTaskCenterEmptyState = emptyStateVariant === "task-center";
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyGenerationRef = useRef(0);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setCopiedId(null);
    return () => {
      copyGenerationRef.current += 1;
      if (copyTimeoutRef.current !== null) {
        clearTimeout(copyTimeoutRef.current);
        copyTimeoutRef.current = null;
      }
    };
  }, [sessionId]);
  const [threadRevertTarget, setThreadRevertTarget] =
    useState<ThreadRevertTarget | null>(null);
  const [threadRevertStatus, setThreadRevertStatus] =
    useState<ThreadRevertStatus>("idle");
  const [
    expandedLongHistoricalMessageIds,
    setExpandedLongHistoricalMessageIds,
  ] = useState<Set<string>>(() => new Set());
  const [
    expandedHistoricalAssistantMessageIds,
    setExpandedHistoricalAssistantMessageIds,
  ] = useState<Set<string>>(() => new Set());
  // read model 可能比终态事件携带更长的 canonical assistant partial。
  // 统一在进入窗口和时间线投影前合并，避免 marker-only item 直接成为气泡正文。
  const effectiveThreadItems = useMemo(
    () =>
      mergeRuntimeSyncThreadItems(threadItems, threadRead?.thread_items ?? []),
    [threadItems, threadRead?.thread_items],
  );
  const scrollController = useMessageListScrollController(sessionId);
  const visibleMessages = useMemo(
    () => filterVisibleConversationMessages(messages),
    [messages],
  );
  const historyState = useMessageListHistoryState(
    isRestoringSession,
    Boolean(sessionHistoryWindow && sessionHistoryWindow.hasMore !== false),
  );
  const timelineState = useMessageListTimelineState({
    activePendingA2UISource,
    canonicalChildren,
    currentTurnId,
    focusedTimelineItemId,
    hasPersistedOlderHistory: historyState.hasPersistedOlderHistory,
    isRestoredHistoryWindow: historyState.isRestoredHistoryWindow,
    isSending,
    pendingActions,
    renderedMessages: visibleMessages,
    submittedActionsInFlight,
    threadItems: effectiveThreadItems,
    threadRead,
    turns: turns,
  });
  const historicalHydration = useMessageListHistoricalHydration({
    activeCurrentTurnId: timelineState.activeCurrentTurnId,
    focusedTimelineItemId,
    isHistoricalTimelineReady: timelineState.isHistoricalTimelineReady,
    isRestoredHistoryWindow: historyState.isRestoredHistoryWindow,
    isSending,
    renderedMessages: visibleMessages,
  });
  const promptCacheNotice = useMessageListPromptCacheNotice({
    lastAssistantMessage: timelineState.lastAssistantMessage,
    providerType,
    restoredPromptCacheNoticeReady: historyState.restoredPromptCacheNoticeReady,
  });
  const activeThreadId = threadRead?.thread_id?.trim() || "";

  useEffect(() => {
    setThreadRevertTarget(null);
    setThreadRevertStatus("idle");
  }, [activeThreadId, sessionId]);

  const [mountedSnapshot, setMountedSnapshot] =
    useState<VirtualizedTurnListSnapshot>({
      mountedKeys: [],
      startIndex: 0,
      endIndex: 0,
      offscreenCount: 0,
    });
  const handleRangeChange = useCallback(
    (snapshot: VirtualizedTurnListSnapshot) => {
      setMountedSnapshot((previous) =>
        previous.mountedKeys.join("\u0000") ===
          snapshot.mountedKeys.join("\u0000") &&
        previous.offscreenCount === snapshot.offscreenCount
          ? previous
          : snapshot,
      );
    },
    [],
  );
  const mountedKeys = new Set(mountedSnapshot.mountedKeys);
  const mountedTurnIds = new Set<string>();
  const mountedMessageIds = new Set<string>();
  for (const entry of timelineState.renderEntries) {
    if (!mountedKeys.has(entry.id)) continue;
    if (entry.kind === "canonical_turn") {
      mountedTurnIds.add(entry.turn.id);
      for (const segment of entry.segments) {
        if (segment.kind === "message") {
          mountedMessageIds.add(segment.item.id);
          if (segment.item.type === "user_message" && segment.item.client_id)
            mountedMessageIds.add(segment.item.client_id);
        }
      }
    } else {
      for (const message of entry.group.messages) {
        mountedMessageIds.add(message.id);
        if (message.runtimeTurnId) mountedTurnIds.add(message.runtimeTurnId);
      }
    }
  }
  const mountedMessages = visibleMessages.filter(
    (message) =>
      mountedMessageIds.has(message.id) ||
      Boolean(
        message.runtimeTurnId && mountedTurnIds.has(message.runtimeTurnId),
      ),
  );
  const focusedTurnId = focusedTimelineItemId
    ? effectiveThreadItems.find((item) => item.id === focusedTimelineItemId)
        ?.turn_id
    : null;
  const focusedEntryKey =
    timelineState.renderEntries.find((entry) =>
      entry.kind === "canonical_turn"
        ? entry.turn.id === focusedTurnId
        : entry.group.timeline?.turn.id === focusedTurnId,
    )?.id ?? null;
  const getFocusedElement = useCallback(
    (row: HTMLElement) =>
      [...row.querySelectorAll<HTMLElement>("[data-thread-item-id]")].find(
        (element) => element.dataset.threadItemId === focusedTimelineItemId,
      ) ?? null,
    [focusedTimelineItemId],
  );
  const latestMessageId = visibleMessages.at(-1)?.id;
  const retainedEntryKeys = timelineState.renderEntries
    .filter(
      (entry) =>
        entry.id === focusedEntryKey ||
        (entry.kind === "canonical_turn" && entry.isActive) ||
        (entry.kind === "message_group" &&
          entry.group.messages.some(
            (message) =>
              message.runtimeTurnId === currentTurnId ||
              (isSending && message.id === latestMessageId),
          )),
    )
    .map((entry) => entry.id);
  useMessageListTelemetry({
    hiddenHistoryCount: 0,
    virtualOffscreenCount: mountedSnapshot.offscreenCount,
    mountedEntryCount: mountedSnapshot.mountedKeys.length,
    indexedThreadItemsCount: timelineState.renderedThreadItems.length,
    canBuildHistoricalTimeline: timelineState.canBuildHistoricalTimeline,
    historicalContentPartsDeferredCount:
      historicalHydration.historicalContentPartsDeferredCount,
    historicalContentPartsDeferredMeasurement:
      historicalHydration.historicalContentPartsDeferredMeasurement,
    historicalMarkdownDeferredCount:
      historicalHydration.historicalMarkdownDeferredCount,
    historicalMarkdownHydrationTargetCount:
      historicalHydration.historicalMarkdownHydrationTargets.length,
    historicalMarkdownHydrationTargetsMeasurement:
      historicalHydration.historicalMarkdownHydrationTargetsMeasurement,
    hydratedHistoricalMarkdownCount:
      historicalHydration.hydratedHistoricalMarkdownCount,
    isHistoricalTimelineReady: timelineState.isHistoricalTimelineReady,
    isRestoredHistoryWindow: historyState.isRestoredHistoryWindow,
    isRestoringSession,
    messageGroupsMeasurement: timelineState.messageGroupsMeasurement,
    messagesCount: messages.length,
    persistedHiddenHistoryCount: Number(historyState.hasPersistedOlderHistory),
    renderedMessages: mountedMessages,
    renderedThreadItemsCount: timelineState.renderedThreadItems.filter((item) =>
      mountedTurnIds.has(item.turn_id),
    ).length,
    renderedThreadItemsMeasurement:
      timelineState.renderedThreadItemsMeasurement,
    renderedTurnsCount: mountedTurnIds.size,
    renderGroups: timelineState.renderGroups,
    renderGroupsMeasurement: timelineState.renderGroupsMeasurement,
    sessionId,
    shouldDeferHistoricalTimeline: timelineState.shouldDeferHistoricalTimeline,
    shouldDeferTailRuntimeStatusLine:
      timelineState.shouldDeferTailRuntimeStatusLine,
    shouldDeferThreadItemsScan: timelineState.shouldDeferThreadItemsScan,
    threadRead,
    timelineByMessageIdMeasurement:
      timelineState.timelineByMessageIdMeasurement,
    turnsCount: turns.length,
    visibleMessagesCount: visibleMessages.length,
  });

  const handleExpandLongHistoricalMessage = useCallback((messageId: string) => {
    setExpandedLongHistoricalMessageIds((current) => {
      if (current.has(messageId)) {
        return current;
      }

      const next = new Set(current);
      next.add(messageId);
      return next;
    });
  }, []);
  const handleExpandHistoricalAssistantMessage = useCallback(
    (messageId: string) => {
      setExpandedHistoricalAssistantMessageIds((current) => {
        if (current.has(messageId)) {
          return current;
        }

        const next = new Set(current);
        next.add(messageId);
        return next;
      });
    },
    [],
  );
  const handleCopy = useCallback(
    async (content: string, id: string) => {
      const generation = ++copyGenerationRef.current;
      try {
        await navigator.clipboard.writeText(content);
        if (generation !== copyGenerationRef.current) return;
        if (copyTimeoutRef.current !== null) {
          clearTimeout(copyTimeoutRef.current);
        }
        setCopiedId(id);
        toast.success(t("agentChat.messageList.toast.copySuccess"));
        copyTimeoutRef.current = setTimeout(() => {
          copyTimeoutRef.current = null;
          setCopiedId(null);
        }, 2000);
      } catch {
        if (generation !== copyGenerationRef.current) return;
        toast.error(t("agentChat.messageList.toast.copyFailed"));
      }
    },
    [t],
  );
  const handleRequestThreadRevert = useCallback(
    (target: ThreadRevertTarget) => {
      if (!onRevertThread || target.threadId !== activeThreadId) {
        return;
      }
      setThreadRevertTarget(target);
      setThreadRevertStatus("idle");
    },
    [activeThreadId, onRevertThread],
  );
  const handleCloseThreadRevert = useCallback(() => {
    if (threadRevertStatus === "submitting") return;
    setThreadRevertTarget(null);
    setThreadRevertStatus("idle");
  }, [threadRevertStatus]);
  const handleConfirmThreadRevert = useCallback(async () => {
    if (!threadRevertTarget || !onRevertThread) return;
    setThreadRevertStatus("submitting");
    try {
      await onRevertThread({
        threadId: threadRevertTarget.threadId,
        beforeTurnId: threadRevertTarget.beforeTurnId,
      });
      setThreadRevertStatus("success");
      setThreadRevertTarget(null);
      toast.success(t("agentChat.messageList.threadRevert.success"));
    } catch {
      setThreadRevertStatus("error");
      toast.error(t("agentChat.messageList.threadRevert.failed"));
    }
  }, [onRevertThread, t, threadRevertTarget]);

  const threadRevertStatusText =
    threadRevertStatus === "idle"
      ? ""
      : t(
          threadRevertStatus === "error"
            ? "agentChat.messageList.threadRevert.failed"
            : `agentChat.messageList.threadRevert.${threadRevertStatus}`,
        );

  const renderMessageItem = useCallback(
    (
      msg: Message,
      group: MessageListRenderGroup,
      streamingTextOverlay: AgentStreamTextOverlaySnapshot | null = null,
    ) => (
      <MessageListItem
        msg={msg}
        group={group}
        sessionId={sessionId}
        streamingTextOverlay={streamingTextOverlay}
        activeConversationRuntimeStatusLine={
          timelineState.activeConversationRuntimeStatusLine
        }
        activeCurrentTurnId={timelineState.activeCurrentTurnId}
        activePendingA2UISource={activePendingA2UISource}
        assistantLabel={assistantLabel}
        a2uiFormDataMap={a2uiFormDataMap}
        collapseCodeBlocks={collapseCodeBlocks}
        compactLeadingSpacing={compactLeadingSpacing}
        copiedId={copiedId}
        expandedHistoricalAssistantMessageIds={
          expandedHistoricalAssistantMessageIds
        }
        expandedLongHistoricalMessageIds={expandedLongHistoricalMessageIds}
        focusedTimelineItemId={focusedTimelineItemId}
        hasActiveInteractiveRuntime={timelineState.hasActiveInteractiveRuntime}
        isRestoredHistoryWindow={historyState.isRestoredHistoryWindow}
        isSending={isSending}
        lastAssistantMessageId={timelineState.lastAssistantMessageId}
        promptCacheNotice={promptCacheNotice}
        providerType={providerType}
        renderA2UIInline={renderA2UIInline}
        shouldCollapseCodeBlock={shouldCollapseCodeBlock}
        shouldDeferHistoricalAssistantMessageDetails={
          historicalHydration.shouldDeferHistoricalAssistantMessageDetails
        }
        shouldDeferHistoricalTimelineDetails={
          timelineState.shouldDeferHistoricalTimelineDetails
        }
        shouldDeferThreadItemsScan={timelineState.shouldDeferThreadItemsScan}
        tailRuntimeStatusLine={timelineState.tailRuntimeStatusLine}
        threadRead={threadRead}
        timelineFocusRequestKey={timelineFocusRequestKey}
        handleCopy={handleCopy}
        onBeforeUserMessageToggle={scrollController.holdViewport}
        handleExpandHistoricalAssistantMessage={
          handleExpandHistoricalAssistantMessage
        }
        handleExpandLongHistoricalMessage={handleExpandLongHistoricalMessage}
        onA2UIFormChange={onA2UIFormChange}
        onA2UISubmit={onA2UISubmit}
        onArtifactClick={onArtifactClick}
        onCodeBlockClick={onCodeBlockClick}
        onFileClick={onFileClick}
        onInterruptCurrentTurn={onInterruptCurrentTurn}
        onOpenArtifactFromTimeline={onOpenArtifactFromTimeline}
        onOpenUrlPreview={onOpenUrlPreview}
        onEditMessage={onEditMessage}
        onOpenMessagePreview={onOpenMessagePreview}
        onOpenSavedSiteContent={onOpenSavedSiteContent}
        onOpenSubagentSession={onOpenSubagentSession}
        onPermissionResponse={onPermissionResponse}
        onQuoteMessage={onQuoteMessage}
        onRequestThreadRevert={handleRequestThreadRevert}
        onWriteFile={onWriteFile}
      />
    ),
    [
      activePendingA2UISource,
      assistantLabel,
      a2uiFormDataMap,
      collapseCodeBlocks,
      compactLeadingSpacing,
      copiedId,
      expandedHistoricalAssistantMessageIds,
      expandedLongHistoricalMessageIds,
      focusedTimelineItemId,
      handleCopy,
      handleExpandHistoricalAssistantMessage,
      handleExpandLongHistoricalMessage,
      handleRequestThreadRevert,
      historicalHydration.shouldDeferHistoricalAssistantMessageDetails,
      isSending,
      onA2UIFormChange,
      onA2UISubmit,
      onArtifactClick,
      onCodeBlockClick,
      onEditMessage,
      onFileClick,
      onInterruptCurrentTurn,
      onOpenArtifactFromTimeline,
      onOpenUrlPreview,
      onOpenMessagePreview,
      onOpenSavedSiteContent,
      onOpenSubagentSession,
      onPermissionResponse,
      onQuoteMessage,

      onWriteFile,
      promptCacheNotice,
      providerType,
      renderA2UIInline,
      historyState.isRestoredHistoryWindow,
      sessionId,
      scrollController.holdViewport,
      shouldCollapseCodeBlock,
      threadRead,
      timelineFocusRequestKey,
      timelineState.activeConversationRuntimeStatusLine,
      timelineState.activeCurrentTurnId,
      timelineState.hasActiveInteractiveRuntime,
      timelineState.lastAssistantMessageId,
      timelineState.shouldDeferHistoricalTimelineDetails,
      timelineState.shouldDeferThreadItemsScan,
      timelineState.tailRuntimeStatusLine,
    ],
  );

  return (
    <PromptLinks
      key={sessionId ?? "no-session"}
      onOpenFile={
        threadRead?.environment_selections?.length
          ? undefined
          : onOpenArtifactFromTimeline
      }
    >
      <ReasoningVisibility>
        <MessageListFrame
          data-testid="message-list-frame"
          data-session-id={sessionId || ""}
        >
          <MessageListContainer
            ref={scrollController.containerRef}
            $taskCenterSurface={isTaskCenterEmptyState}
            data-testid="message-list-scroll-container"
            data-mounted-turns={mountedTurnIds.size}
            data-mounted-items={
              timelineState.renderedThreadItems.filter((item) =>
                mountedTurnIds.has(item.turn_id),
              ).length
            }
          >
            <div
              data-testid="message-list-column"
              data-content-axis="thread"
              data-layout-density="compact"
              style={{ maxWidth: CONVERSATION_CONTENT_MAX_WIDTH }}
              className={[
                "mx-auto flex min-h-full w-full flex-col gap-3 py-3",
                compactLeadingSpacing ? "pl-2.5 pr-3" : "pl-4 pr-4",
                "justify-start",
              ].join(" ")}
            >
              {leadingContent ? (
                <div data-testid="message-list-leading-content">
                  {leadingContent}
                </div>
              ) : null}
              {historyState.hasPersistedOlderHistory ? (
                <PersistedHistoryWindow
                  loadedEntries={timelineState.renderEntries.length}
                  hasMore
                  isLoadingFull={sessionHistoryWindow?.isLoadingFull === true}
                  error={sessionHistoryWindow?.error}
                  onLoadFullHistory={onLoadFullHistory}
                />
              ) : null}
              {timelineState.renderEntries.length === 0 &&
                (isRestoringSession ? (
                  <RestoringSessionEmptyState />
                ) : isTaskCenterEmptyState ? (
                  <TaskCenterEmptyState />
                ) : null)}

              <VirtualizedTurnList
                key={sessionId || activeThreadId || "conversation"}
                entries={timelineState.renderEntries}
                scrollContainerRef={scrollController.containerRef}
                isFollowingTail={scrollController.isFollowingTail}
                scrollToTail={scrollController.scrollToTail}
                setScrollTop={scrollController.setScrollTop}
                holdViewport={scrollController.holdViewport}
                retainedKeys={retainedEntryKeys}
                focusedKey={focusedEntryKey}
                getFocusedElement={getFocusedElement}
                focusRequestKey={timelineFocusRequestKey}
                onRangeChange={handleRangeChange}
                renderEntry={(entry, groupIndex) => {
                  if (entry.kind === "canonical_turn") {
                    const lastAssistantItemId = entry.segments
                      .filter(
                        (segment) =>
                          segment.kind === "message" &&
                          segment.item.type === "agent_message",
                      )
                      .at(-1)?.id;
                    const lastAssistantMessageId =
                      findLastMessage(
                        messages,
                        (message) =>
                          message.role === "assistant" &&
                          message.runtimeTurnId?.trim() === entry.turn.id,
                      )?.id ?? lastAssistantItemId;
                    const lastUserMessageId = findLastMessage(
                      messages,
                      (message) =>
                        message.role === "user" &&
                        message.runtimeTurnId?.trim() === entry.turn.id,
                    )?.id;
                    return (
                      <MessageTurnGroup
                        key={entry.id}
                        data-testid="message-turn-group"
                        data-render-entry-kind="canonical_turn"
                        data-group-index={groupIndex + 1}
                        data-runtime-turn-id={entry.turn.id}
                        data-runtime-turn-status={entry.turn.status}
                        data-last-assistant-message-id={
                          lastAssistantMessageId || ""
                        }
                        data-timeline-message-id={lastAssistantItemId || ""}
                        data-render-priority="viewport"
                        className="py-1"
                      >
                        <ConversationTurnTimeline
                          entry={entry}
                          sessionId={sessionId}
                          userMessageId={lastUserMessageId}
                          assistantMessageId={lastAssistantMessageId}
                          threadRead={threadRead}
                          pendingActions={pendingActions}
                          submittedActionsInFlight={submittedActionsInFlight}
                          assistantLabel={assistantLabel}
                          copiedId={copiedId}
                          compactLeadingSpacing={compactLeadingSpacing}
                          isSending={isSending}
                          renderA2UIInline={renderA2UIInline}
                          a2uiFormDataMap={a2uiFormDataMap}
                          collapseCodeBlocks={collapseCodeBlocks}
                          shouldCollapseCodeBlock={shouldCollapseCodeBlock}
                          focusedTimelineItemId={focusedTimelineItemId}
                          timelineFocusRequestKey={timelineFocusRequestKey}
                          shouldDeferHistoricalTimelineDetails={
                            timelineState.shouldDeferHistoricalTimelineDetails
                          }
                          handleCopy={handleCopy}
                          onBeforeUserMessageToggle={
                            scrollController.holdViewport
                          }
                          onA2UISubmit={onA2UISubmit}
                          onA2UIFormChange={onA2UIFormChange}
                          onWriteFile={onWriteFile}
                          onFileClick={onFileClick}
                          onOpenArtifactFromTimeline={
                            onOpenArtifactFromTimeline
                          }
                          onOpenUrlPreview={onOpenUrlPreview}
                          onOpenSavedSiteContent={onOpenSavedSiteContent}
                          onOpenMessagePreview={onOpenMessagePreview}
                          onOpenSubagentSession={onOpenSubagentSession}
                          onPermissionResponse={onPermissionResponse}
                          onQuoteMessage={onQuoteMessage}
                          onRequestThreadRevert={handleRequestThreadRevert}
                          onCodeBlockClick={onCodeBlockClick}
                        />
                      </MessageTurnGroup>
                    );
                  }

                  const group = entry.group;
                  const groupRuntimeTurnId =
                    group.timeline?.turn?.id ||
                    group.messages.find((message) => message.runtimeTurnId)
                      ?.runtimeTurnId ||
                    "";
                  const groupRuntimeTurnStatus =
                    group.timeline?.turn?.status ||
                    timelineState.renderedTurns.find(
                      (turn) => turn.id === groupRuntimeTurnId,
                    )?.status ||
                    "";
                  return (
                    <MessageTurnGroup
                      key={entry.id}
                      data-testid="message-turn-group"
                      data-render-entry-kind="message_group"
                      data-group-index={groupIndex + 1}
                      data-runtime-turn-id={groupRuntimeTurnId}
                      data-runtime-turn-status={groupRuntimeTurnStatus}
                      data-last-assistant-message-id={
                        group.lastAssistantId || ""
                      }
                      data-timeline-message-id={group.timelineMessageId || ""}
                      data-render-priority="viewport"
                      className="py-1"
                    >
                      <div className="space-y-1">
                        {group.messages.map((msg, messageIndex) => (
                          <MessageListStreamingOverlayItem
                            key={msg.id ?? `${group.id}:${messageIndex}`}
                            msg={msg}
                            group={group}
                            onOverlayUpdate={
                              scrollController.handleStreamingOverlayUpdate
                            }
                            render={renderMessageItem}
                          />
                        ))}
                      </div>
                    </MessageTurnGroup>
                  );
                }}
              />
              {trailingContent ? (
                <section
                  data-testid="message-list-trailing-content"
                  className="py-2"
                >
                  {trailingContent}
                </section>
              ) : null}
              <div ref={scrollController.scrollRef} />
            </div>
          </MessageListContainer>
        </MessageListFrame>
        <ThreadRevertDialog
          target={threadRevertTarget}
          status={threadRevertStatus}
          onClose={handleCloseThreadRevert}
          onConfirm={handleConfirmThreadRevert}
        />
        <span
          className="sr-only"
          data-testid="thread-revert-status"
          data-state={threadRevertStatus}
          aria-live="polite"
        >
          {threadRevertStatusText}
        </span>
      </ReasoningVisibility>
    </PromptLinks>
  );
};

export const MessageList = React.memo(MessageListInner);
MessageList.displayName = "MessageList";
