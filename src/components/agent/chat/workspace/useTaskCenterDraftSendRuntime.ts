import {
  isRuntimeSubmissionAccepted,
  type AcceptedRuntimeSubmissionResult,
} from "../hooks/agentSendResult";
import { createTaskCenterSubmissionSettlement } from "./taskCenterSubmissionSettlement";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { flushSync } from "react-dom";
import { recordAgentUiPerformanceMetric } from "@/lib/agentUiPerformanceMetrics";
import { mergeAgentUiPerformanceTraceMetadata } from "../hooks/agentStreamPerformanceMetrics";
import {
  buildHomePendingPreviewMessages,
  type TaskCenterDraftSendRequest,
  type TaskCenterSessionReadyOptions,
} from "../homePendingPreview";
import type { Message } from "../types";
import {
  getInputbarSendOptions,
  type InputbarSendHandler,
} from "../components/Inputbar/inputbarSendPayload";
import type { WorkspaceHandleSend } from "./useWorkspaceSendActions";
import {
  createTaskCenterDraftSendRequestId,
  scheduleAfterCommit,
  scheduleAfterNextPaint,
} from "./agentChatWorkspaceHelpers";
import type { HandleSendOptions } from "../hooks/handleSendTypes";

import { logAgentDebug } from "@/lib/agentDebug";

type TaskCenterDraftSendExecutionStrategy = NonNullable<
  TaskCenterDraftSendRequest["sendExecutionStrategy"]
>;

function flushHomePendingPreview(apply: () => void): void {
  flushSync(apply);
}

interface UseTaskCenterHomePendingPreviewRuntimeParams {
  homePendingPreviewRequest: TaskCenterDraftSendRequest | null;
  displayMessagesLength: number;
  executionStrategy: TaskCenterDraftSendExecutionStrategy;
  workspaceId?: string | null;

}

interface UseTaskCenterEmptyStateSendRuntimeParams {
  agentEntry: string;
  input: string;
  setInput: (value: string) => void;
  activeSessionIdRef?: MutableRefObject<string | null>;
  getComposerDraftNavigationEpoch?: () => number;
  newChatAt?: number;
  isSendSourceCurrent?: (
    options: TaskCenterSessionReadyOptions,
    acceptedSessionId?: string,
  ) => boolean;
  hasDisplayMessages: boolean;
  handleSend: WorkspaceHandleSend;
  sessionId?: string | null;
  taskCenterWorkspaceId?: string | null;
  setTaskCenterDraftSendRequest: Dispatch<
    SetStateAction<TaskCenterDraftSendRequest | null>
  >;
  taskCenterDraftSendRequest: TaskCenterDraftSendRequest | null;
  setHomePendingPreviewRequest: Dispatch<
    SetStateAction<TaskCenterDraftSendRequest | null>
  >;
  onSessionAccepted?: (
    sessionId: string,
    options?: TaskCenterSessionReadyOptions,
  ) => void;
}

export function useTaskCenterHomePendingPreviewRuntime({
  homePendingPreviewRequest,
  displayMessagesLength,
  executionStrategy,
  workspaceId,

}: UseTaskCenterHomePendingPreviewRuntimeParams): {
  homePendingPreviewMessages: Message[];
  isHomePendingPreviewActive: boolean;
} {
  const committedRequestIdsRef = useRef<Set<string>>(new Set());
  const paintedRequestIdsRef = useRef<Set<string>>(new Set());
  const shouldRenderPendingPreview =
    Boolean(homePendingPreviewRequest) &&
    (!homePendingPreviewRequest?.sessionReady || displayMessagesLength === 0);
  const homePendingPreviewMessages = useMemo(
    () =>
      homePendingPreviewRequest && shouldRenderPendingPreview
        ? buildHomePendingPreviewMessages(
            homePendingPreviewRequest,
            executionStrategy,

          )
        : [],
    [
      executionStrategy,
      homePendingPreviewRequest,
      shouldRenderPendingPreview,

    ],
  );

  useLayoutEffect(() => {
    if (
      !homePendingPreviewRequest ||
      homePendingPreviewMessages.length === 0 ||
      committedRequestIdsRef.current.has(homePendingPreviewRequest.id)
    ) {
      return;
    }

    const request = homePendingPreviewRequest;
    committedRequestIdsRef.current.add(request.id);
    recordAgentUiPerformanceMetric("homeInput.pendingPreviewCommitted", {
      durationMs: Date.now() - request.submittedAt,
      requestId: request.id,
      sessionId: request.sessionId,
      source: request.source,
      workspaceId: workspaceId ?? null,
    });
  }, [
    homePendingPreviewMessages.length,
    homePendingPreviewRequest,
    workspaceId,
  ]);

  useEffect(() => {
    if (
      !homePendingPreviewRequest ||
      homePendingPreviewMessages.length === 0 ||
      paintedRequestIdsRef.current.has(homePendingPreviewRequest.id)
    ) {
      return;
    }

    const request = homePendingPreviewRequest;
    paintedRequestIdsRef.current.add(request.id);
    return scheduleAfterNextPaint(() => {
      recordAgentUiPerformanceMetric("homeInput.pendingPreviewPaint", {
        durationMs: Date.now() - request.submittedAt,
        requestId: request.id,
        sessionId: request.sessionId,
        source: request.source,
        workspaceId: workspaceId ?? null,
      });
    });
  }, [
    homePendingPreviewMessages.length,
    homePendingPreviewRequest,
    workspaceId,
  ]);

  return {
    homePendingPreviewMessages,
    isHomePendingPreviewActive: homePendingPreviewMessages.length > 0,
  };
}

export function useTaskCenterEmptyStateSendRuntime({
  agentEntry,
  input,
  setInput,
  activeSessionIdRef,
  getComposerDraftNavigationEpoch,
  isSendSourceCurrent,
  newChatAt,
  hasDisplayMessages,
  handleSend,
  sessionId,
  taskCenterWorkspaceId,
  setTaskCenterDraftSendRequest,
  taskCenterDraftSendRequest,
  setHomePendingPreviewRequest,
  onSessionAccepted,
}: UseTaskCenterEmptyStateSendRuntimeParams): InputbarSendHandler {
  const homeSendInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!taskCenterDraftSendRequest) {
      homeSendInFlightRef.current = false;
    }
  }, [taskCenterDraftSendRequest]);

  return useCallback<InputbarSendHandler>(
    (payload = {}) => {
      const handlerEnteredAt = Date.now();
      const triggeredAt =
        typeof payload.triggeredAt === "number" &&
        Number.isFinite(payload.triggeredAt)
          ? payload.triggeredAt
          : handlerEnteredAt;
      const triggerSource = payload.triggerSource ?? "adapter";
      if (homeSendInFlightRef.current || taskCenterDraftSendRequest) {
        logAgentDebug("LocalConversationPage", "homeInput.submit.blocked", {
          hasPendingRequest: Boolean(taskCenterDraftSendRequest),
          homeSendInFlight: homeSendInFlightRef.current,
          source: "empty-state",
          triggerSource,
          workspaceId: taskCenterWorkspaceId,
        });
        return Promise.resolve({ kind: "rejected" });
      }

      const text = payload.textOverride ?? input;
      const images = payload.images ?? [];
      const originalSendOptions = getInputbarSendOptions(payload);
      const settlement = createTaskCenterSubmissionSettlement(
        originalSendOptions?.observer,
      );
      const sendOptions = {
        ...originalSendOptions,
        observer: settlement.observer,
      };
      const { completion } = settlement;
      const settleSend = settlement.settle;
      const normalizedText = text.trim();
      const sendSource = {
        sessionId: activeSessionIdRef?.current ?? sessionId ?? null,
        workspaceId: taskCenterWorkspaceId ?? null,
        navigationEpoch: getComposerDraftNavigationEpoch?.() ?? null,
        newChatAt: newChatAt ?? null,
      };
      const sourceOptions: TaskCenterSessionReadyOptions = {
        composerDraftCapture: payload.composerDraftCapture,
        sendSource,
      };
      const restoreRejectedInput = () => {
        if (
          mountedRef.current &&
          !sendOptions.composerDraft &&
          isSendSourceCurrent?.(sourceOptions) !== false
        )
          setInput(text);
      };
      const handleAcceptedSessionReady = (
        id: string,
        result: AcceptedRuntimeSubmissionResult,
      ) => {
        const readySessionId = result.receipt.sessionId;
        if (!mountedRef.current) return;
        if (
          isSendSourceCurrent?.(
            { ...sourceOptions, acceptedResult: result },
            readySessionId,
          ) === false
        ) {
          setHomePendingPreviewRequest((current) =>
            current?.id === id ? null : current,
          );
          return;
        }
        settlement.effect("accepted_submit", () =>
          onSessionAccepted?.(readySessionId, {
            ...sourceOptions,
            acceptedResult: result,
          }),
        );
        setHomePendingPreviewRequest((current) =>
          current?.id === id
            ? { ...current, sessionId: readySessionId, sessionReady: true }
            : current,
        );
      };
      const shouldQueueHomeSend =
        !hasDisplayMessages &&
        (agentEntry === "conversation" || agentEntry === "new-task");
      if (shouldQueueHomeSend) {
        homeSendInFlightRef.current = true;
        const submittedAt = triggeredAt;
        const requestId = createTaskCenterDraftSendRequestId();
        const existingSessionId = sessionId?.trim() || null;
        settlement.effect("accepted_metric", () =>
          recordAgentUiPerformanceMetric("homeInput.submit", {
            inputbarHandlerToHomeSubmitMs: Math.max(
              0,
              Date.now() - handlerEnteredAt,
            ),
            inputLength: normalizedText.length,
            requestId,
            sessionId: existingSessionId,
            source: "empty-state",
            triggerToHomeSubmitMs: Math.max(0, Date.now() - triggeredAt),
            triggerSource,
            workspaceId: taskCenterWorkspaceId,
          }),
        );
        if (!existingSessionId) {
          const tracedSendOptions: HandleSendOptions = {
            ...(sendOptions || {}),
            skipWorkspaceCommandRouting: true,
            skipSessionRestore: true,
            skipSessionStartHooks: true,
            requestMetadata: mergeAgentUiPerformanceTraceMetadata(
              sendOptions?.requestMetadata,
              {
                requestId,
                sessionId: null,
                source: "empty-state",
                submittedAt,
                workspaceId: taskCenterWorkspaceId ?? null,
              },
            ),
          };
          const previewRequest: TaskCenterDraftSendRequest = {
            id: requestId,
            sessionId: null,
            text,
            images,
            sendOptions: tracedSendOptions,
            composerDraftCapture: payload.composerDraftCapture,
            sendSource,
            submittedAt,
            dispatchState: "dispatched",
            source: "empty-state",
            triggerSource,
          };
          flushHomePendingPreview(() => {
            if (!sendOptions?.composerDraft) setInput("");
            setTaskCenterDraftSendRequest(previewRequest);
            setHomePendingPreviewRequest(previewRequest);
          });
          settlement.effect("accepted_log", () =>
            logAgentDebug("LocalConversationPage", "homeInput.directDispatch.start", {
              requestId,
              source: "empty-state",
              workspaceId: taskCenterWorkspaceId,
            }),
          );
          scheduleAfterCommit(() => {
            settlement.effect("accepted_metric", () =>
              recordAgentUiPerformanceMetric("homeInput.sendDispatch.start", {
                elapsedMs: Date.now() - submittedAt,
                requestId,
                sessionId: null,
                source: "empty-state",
                workspaceId: taskCenterWorkspaceId ?? null,
              }),
            );
            void (async () =>
              handleSend(
                images,
                undefined,
                undefined,
                text,
                undefined,
                undefined,
                tracedSendOptions,
              ))()
              .then(
                (actualResult) => {
                  const result = settleSend(actualResult);
                  settlement.effect("accepted_metric", () =>
                    recordAgentUiPerformanceMetric(
                      "homeInput.sendDispatch.done",
                      {
                        durationMs: Date.now() - submittedAt,
                        requestId,
                        result: result.kind,
                        sessionId: null,
                        source: "empty-state",
                        workspaceId: taskCenterWorkspaceId ?? null,
                      },
                    ),
                  );
                  settlement.effect("accepted_log", () =>
                    logAgentDebug(
                      "LocalConversationPage",
                      "homeInput.directDispatch.done",
                      {
                        requestId,
                        result: result.kind,
                        source: "empty-state",
                        workspaceId: taskCenterWorkspaceId,
                      },
                    ),
                  );
                  if (!isRuntimeSubmissionAccepted(result)) {
                    restoreRejectedInput();
                    setHomePendingPreviewRequest((current) =>
                      current?.id === requestId ? null : current,
                    );
                  } else {
                    handleAcceptedSessionReady(requestId, result);
                  }
                  setTaskCenterDraftSendRequest((current) =>
                    current?.id === requestId ? null : current,
                  );
                  homeSendInFlightRef.current = false;
                  settleSend(result);
                },
                (error) => {
                  const result = settlement.reject(error);
                  if (isRuntimeSubmissionAccepted(result)) {
                    homeSendInFlightRef.current = false;
                    return;
                  }
                  settlement.effect("accepted_metric", () =>
                    recordAgentUiPerformanceMetric(
                      "homeInput.sendDispatch.error",
                      {
                        durationMs: Date.now() - submittedAt,
                        error: "request_rejected",
                        requestId,
                        sessionId: null,
                        source: "empty-state",
                        workspaceId: taskCenterWorkspaceId ?? null,
                      },
                    ),
                  );
                  settlement.effect("accepted_log", () =>
                    logAgentDebug(
                      "LocalConversationPage",
                      "homeInput.directDispatch.error",
                      {
                        error: "request_rejected",
                        requestId,
                        source: "empty-state",
                        workspaceId: taskCenterWorkspaceId,
                      },
                      { level: "error" },
                    ),
                  );
                  restoreRejectedInput();
                  setTaskCenterDraftSendRequest((current) =>
                    current?.id === requestId ? null : current,
                  );
                  setHomePendingPreviewRequest((current) =>
                    current?.id === requestId ? null : current,
                  );
                  homeSendInFlightRef.current = false;
                  settleSend(result);
                },
              )
              .catch((error) => {
                homeSendInFlightRef.current = false;
                settlement.reject(error);
              });
          });
          return completion;
        }
        const tracedSendOptions: HandleSendOptions = {
          ...(sendOptions || {}),
          skipWorkspaceCommandRouting: true,
          skipSessionRestore: true,
          skipSessionStartHooks: true,
          requestMetadata: mergeAgentUiPerformanceTraceMetadata(
            sendOptions?.requestMetadata,
            {
              requestId,
              sessionId: existingSessionId,
              source: "empty-state",
              submittedAt,
              workspaceId: taskCenterWorkspaceId ?? null,
            },
          ),
        };
        const previewRequest: TaskCenterDraftSendRequest = {
          id: requestId,
          sessionId: existingSessionId,
          text,
          images,
          sendOptions: tracedSendOptions,
          composerDraftCapture: payload.composerDraftCapture,
          sendSource,
          submittedAt,
          dispatchState: "dispatched",
          source: "empty-state",
          triggerSource,
        };
        flushHomePendingPreview(() => {
          if (!sendOptions?.composerDraft) setInput("");
          setTaskCenterDraftSendRequest(previewRequest);
          setHomePendingPreviewRequest(previewRequest);
        });
        scheduleAfterCommit(() => {
          settlement.effect("accepted_metric", () =>
            recordAgentUiPerformanceMetric("homeInput.sendDispatch.start", {
              elapsedMs: Date.now() - submittedAt,
              requestId,
              sessionId: existingSessionId,
              source: "empty-state",
              workspaceId: taskCenterWorkspaceId ?? null,
            }),
          );
          void (async () =>
            handleSend(
              images,
              undefined,
              undefined,
              text,
              undefined,
              undefined,
              tracedSendOptions,
            ))()
            .then(
              (actualResult) => {
                const result = settleSend(actualResult);
                settlement.effect("accepted_metric", () =>
                  recordAgentUiPerformanceMetric(
                    "homeInput.sendDispatch.done",
                    {
                      durationMs: Date.now() - submittedAt,
                      requestId,
                      result: result.kind,
                      sessionId: existingSessionId,
                      source: "empty-state",
                      workspaceId: taskCenterWorkspaceId ?? null,
                    },
                  ),
                );
                if (!isRuntimeSubmissionAccepted(result)) {
                  restoreRejectedInput();
                  setHomePendingPreviewRequest((current) =>
                    current?.id === requestId ? null : current,
                  );
                }
                setTaskCenterDraftSendRequest((current) =>
                  current?.id === requestId ? null : current,
                );
                homeSendInFlightRef.current = false;
                settleSend(result);
              },
              (error) => {
                const result = settlement.reject(error);
                if (isRuntimeSubmissionAccepted(result)) {
                  homeSendInFlightRef.current = false;
                  return;
                }
                settlement.effect("accepted_metric", () =>
                  recordAgentUiPerformanceMetric(
                    "homeInput.sendDispatch.error",
                    {
                      durationMs: Date.now() - submittedAt,
                      error: "request_rejected",
                      requestId,
                      sessionId: existingSessionId,
                      source: "empty-state",
                      workspaceId: taskCenterWorkspaceId ?? null,
                    },
                  ),
                );
                restoreRejectedInput();
                setTaskCenterDraftSendRequest((current) =>
                  current?.id === requestId ? null : current,
                );
                setHomePendingPreviewRequest((current) =>
                  current?.id === requestId ? null : current,
                );
                homeSendInFlightRef.current = false;
                settleSend(result);
              },
            )
            .catch((error) => {
              homeSendInFlightRef.current = false;
              settlement.reject(error);
            });
        });
        return completion;
      }

      settlement.effect("accepted_metric", () =>
        recordAgentUiPerformanceMetric("homeInput.submit", {
          inputbarHandlerToHomeSubmitMs: Math.max(
            0,
            Date.now() - handlerEnteredAt,
          ),
          inputLength: normalizedText.length,
          sessionId: sessionId ?? null,
          source: "empty-state",
          triggerToHomeSubmitMs: Math.max(0, Date.now() - triggeredAt),
          triggerSource,
          workspaceId: taskCenterWorkspaceId,
        }),
      );
      void (async () =>
        handleSend(
          images,
          undefined,
          undefined,
          text,
          undefined,
          undefined,
          sendOptions,
        ))().then(settlement.settle, settlement.reject);
      return completion;
    },
    [
      activeSessionIdRef,
      getComposerDraftNavigationEpoch,
      isSendSourceCurrent,
      newChatAt,
      agentEntry,
      handleSend,
      hasDisplayMessages,
      input,
      sessionId,
      onSessionAccepted,
      setHomePendingPreviewRequest,
      setInput,
      setTaskCenterDraftSendRequest,
      taskCenterDraftSendRequest,
      taskCenterWorkspaceId,
    ],
  );
}

export { useTaskCenterDraftSendDispatchRuntime } from "./useTaskCenterDraftSendDispatchRuntime";
