import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { toast } from "sonner";
import type {
  ConfirmResponse,
  Message,
  ActionRequired,
  AgentThreadItem,
} from "../types";
import {
  normalizeActionQuestions,
  resolveActionPromptKey,
} from "./agentChatCoreUtils";
import type { AgentRuntimeAdapter } from "./agentRuntimeAdapter";
import { upsertAssistantActionRequest } from "./agentChatActionState";
import { markThreadActionItemSubmitted } from "./agentThreadState";
import { buildActionRequestSubmissionContext } from "../utils/actionRequestA2UI";
import { buildActionResumeRuntimeStatus } from "../utils/agentRuntimeStatus";
import { governActionRequest } from "../utils/actionRequestGovernance";

interface UseAgentToolsOptions {
  runtime: AgentRuntimeAdapter;
  sessionIdRef: MutableRefObject<string | null>;
  currentStreamingSessionIdRef: MutableRefObject<string | null>;
  currentStreamingEventNameRef: MutableRefObject<string | null>;
  messages: Message[];
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setThreadItems: Dispatch<SetStateAction<AgentThreadItem[]>>;
  refreshSessionReadModel: (targetSessionId?: string) => Promise<boolean>;
}

function upsertSubmittedAction(
  actions: ActionRequired[],
  nextAction: ActionRequired,
): ActionRequired[] {
  const next = actions.filter(
    (item) => item.requestId !== nextAction.requestId,
  );
  next.push(nextAction);
  return next;
}

export function useAgentTools(options: UseAgentToolsOptions) {
  const {
    runtime,
    sessionIdRef,
    currentStreamingSessionIdRef,
    currentStreamingEventNameRef,
    messages,
    setMessages,
    setThreadItems,
    refreshSessionReadModel,
  } = options;

  const [pendingActions, setPendingActions] = useState<ActionRequired[]>([]);
  const [submittedActionsInFlight, setSubmittedActionsInFlight] = useState<
    ActionRequired[]
  >([]);
  const warnedKeysRef = useRef<Set<string>>(new Set());
  const queuedFallbackResponsesRef = useRef<
    Map<
      string,
      Omit<ConfirmResponse, "requestId"> & {
        requestId: string;
      }
    >
  >(new Map());

  const confirmAction = useCallback(
    async (response: ConfirmResponse) => {
      const acknowledgedRequestIds = new Set<string>([response.requestId]);
      try {
        const pendingAction = pendingActions.find(
          (item) => item.requestId === response.requestId,
        );
        const persistedActionRaw =
          pendingAction ||
          messages
            .flatMap((message) => message.actionRequests || [])
            .find((item) => item.requestId === response.requestId);
        const persistedAction = persistedActionRaw
          ? governActionRequest(persistedActionRaw)
          : undefined;
        const actionType = response.actionType || persistedAction?.actionType;
        if (!actionType) {
          throw new Error("缺少 actionType，无法提交确认");
        }

        const normalizedResponse =
          typeof response.response === "string" ? response.response.trim() : "";
        let submittedUserData: unknown = response.userData;
        let effectiveRequestId = response.requestId;
        let metadataAction = persistedAction;
        let refreshSessionId: string | null = null;

        if (actionType === "elicitation" || actionType === "ask_user") {
          const activeSessionId =
            currentStreamingSessionIdRef.current || sessionIdRef.current;
          if (!activeSessionId) {
            throw new Error("缺少会话 ID，无法提交 elicitation 响应");
          }
          refreshSessionId = activeSessionId;

          let userData: unknown;
          if (!response.confirmed) {
            userData = "";
          } else if (response.userData !== undefined) {
            userData = response.userData;
          } else if (response.response !== undefined) {
            const rawResponse = response.response.trim();
            if (!rawResponse) {
              userData = "";
            } else {
              try {
                userData = JSON.parse(rawResponse);
              } catch {
                userData = rawResponse;
              }
            }
          } else {
            userData = "";
          }

          submittedUserData = userData;

          if (persistedAction?.isFallback) {
            const fallbackPromptKey = resolveActionPromptKey(persistedAction);
            if (fallbackPromptKey) {
              const resolvedAction = pendingActions.find((item) => {
                if (item.requestId === persistedAction.requestId) return false;
                if (item.isFallback) return false;
                if (item.actionType !== persistedAction.actionType)
                  return false;
                return resolveActionPromptKey(item) === fallbackPromptKey;
              });

              if (!resolvedAction) {
                queuedFallbackResponsesRef.current.set(fallbackPromptKey, {
                  ...response,
                  actionType,
                  requestId: persistedAction.requestId,
                  userData,
                });
                setPendingActions((prev) =>
                  prev.map((item) =>
                    item.requestId === persistedAction.requestId
                      ? {
                          ...item,
                          status: "queued",
                          submittedResponse: normalizedResponse || undefined,
                          submittedUserData,
                        }
                      : item,
                  ),
                );
                setMessages((prev) =>
                  prev.map((msg) => ({
                    ...msg,
                    actionRequests: msg.actionRequests?.map((item) =>
                      item.requestId === persistedAction.requestId
                        ? {
                            ...item,
                            status: "queued" as const,
                            submittedResponse: normalizedResponse || undefined,
                            submittedUserData,
                          }
                        : item,
                    ),
                    contentParts: msg.contentParts?.map((part) =>
                      part.type === "action_required" &&
                      part.actionRequired.requestId ===
                        persistedAction.requestId
                        ? {
                            ...part,
                            actionRequired: {
                              ...part.actionRequired,
                              status: "queued" as const,
                              submittedResponse:
                                normalizedResponse || undefined,
                              submittedUserData,
                            },
                          }
                        : part,
                    ),
                  })),
                );
                await refreshSessionReadModel(activeSessionId);
                toast.info("已记录你的回答，等待系统请求就绪后自动提交");
                return;
              }

              effectiveRequestId = resolvedAction.requestId;
              metadataAction = governActionRequest(resolvedAction);
              acknowledgedRequestIds.add(resolvedAction.requestId);
            }
          }

          setSubmittedActionsInFlight((prev) =>
            upsertSubmittedAction(prev, {
              ...(metadataAction ||
                persistedAction || {
                  requestId: effectiveRequestId,
                  actionType,
                }),
              requestId: effectiveRequestId,
              actionType,
              status: "submitted",
              submittedResponse: normalizedResponse || undefined,
              submittedUserData,
            }),
          );

          const submissionContext = metadataAction
            ? buildActionRequestSubmissionContext(metadataAction, userData)
            : null;
          const activeEventName =
            currentStreamingSessionIdRef.current === activeSessionId
              ? currentStreamingEventNameRef.current
              : null;
          const submissionEventName =
            activeEventName || metadataAction?.eventName;

          await runtime.respondToAction({
            sessionId: activeSessionId,
            requestId: effectiveRequestId,
            actionType,
            confirmed: response.confirmed,
            response: response.response,
            userData,
            metadata: submissionContext?.requestMetadata,
            eventName: submissionEventName || undefined,
            actionScope: metadataAction?.scope,
          });
        } else {
          refreshSessionId = sessionIdRef.current;
          setSubmittedActionsInFlight((prev) =>
            upsertSubmittedAction(prev, {
              ...(metadataAction ||
                persistedAction || {
                  requestId: effectiveRequestId,
                  actionType,
                }),
              requestId: effectiveRequestId,
              actionType,
              status: "submitted",
              submittedResponse: normalizedResponse || undefined,
              submittedUserData,
            }),
          );
          await runtime.respondToAction({
            sessionId: refreshSessionId || "",
            requestId: effectiveRequestId,
            actionType,
            confirmed: response.confirmed,
            response: response.response,
          });
        }

        setPendingActions((prev) =>
          prev.filter((a) => !acknowledgedRequestIds.has(a.requestId)),
        );
        const shouldPersistSubmittedAction =
          actionType === "elicitation" || actionType === "ask_user";
        setMessages((prev) =>
          prev.map((msg) => ({
            ...msg,
            actionRequests: shouldPersistSubmittedAction
              ? msg.actionRequests?.map((item) =>
                  acknowledgedRequestIds.has(item.requestId)
                    ? {
                        ...item,
                        status: "submitted" as const,
                        submittedResponse: normalizedResponse || undefined,
                        submittedUserData,
                      }
                    : item,
                )
              : msg.actionRequests?.filter(
                  (item) => !acknowledgedRequestIds.has(item.requestId),
                ),
            contentParts: shouldPersistSubmittedAction
              ? msg.contentParts?.map((part) =>
                  part.type === "action_required" &&
                  acknowledgedRequestIds.has(part.actionRequired.requestId)
                    ? {
                        ...part,
                        actionRequired: {
                          ...part.actionRequired,
                          status: "submitted" as const,
                          submittedResponse: normalizedResponse || undefined,
                          submittedUserData,
                        },
                      }
                    : part,
                )
              : msg.contentParts?.filter(
                  (part) =>
                    part.type !== "action_required" ||
                    !acknowledgedRequestIds.has(part.actionRequired.requestId),
                ),
            runtimeStatus:
              shouldPersistSubmittedAction &&
              msg.actionRequests?.some((item) =>
                acknowledgedRequestIds.has(item.requestId),
              )
                ? buildActionResumeRuntimeStatus()
                : msg.runtimeStatus,
          })),
        );
        setThreadItems((prev) =>
          markThreadActionItemSubmitted(
            prev,
            acknowledgedRequestIds,
            normalizedResponse || undefined,
            submittedUserData,
          ),
        );
        if (refreshSessionId) {
          await refreshSessionReadModel(refreshSessionId);
        }
        setSubmittedActionsInFlight((prev) =>
          prev.filter((item) => !acknowledgedRequestIds.has(item.requestId)),
        );
      } catch (error) {
        setSubmittedActionsInFlight((prev) =>
          prev.filter((item) => !acknowledgedRequestIds.has(item.requestId)),
        );
        console.error("[AsterChat] 确认失败:", error);
        toast.error(
          error instanceof Error && error.message
            ? error.message
            : "确认操作失败",
        );
      }
    },
    [
      currentStreamingSessionIdRef,
      currentStreamingEventNameRef,
      messages,
      pendingActions,
      runtime,
      refreshSessionReadModel,
      sessionIdRef,
      setMessages,
      setThreadItems,
    ],
  );

  useEffect(() => {
    for (const pendingAction of pendingActions) {
      if (
        pendingAction.isFallback ||
        pendingAction.status === "submitted" ||
        (pendingAction.actionType !== "ask_user" &&
          pendingAction.actionType !== "elicitation")
      ) {
        continue;
      }

      const promptKey = resolveActionPromptKey(pendingAction);
      if (!promptKey) {
        continue;
      }

      const queuedResponse = queuedFallbackResponsesRef.current.get(promptKey);
      if (!queuedResponse) {
        continue;
      }

      queuedFallbackResponsesRef.current.delete(promptKey);
      void confirmAction({
        ...queuedResponse,
        requestId: pendingAction.requestId,
        actionType: pendingAction.actionType,
      });
      break;
    }
  }, [confirmAction, pendingActions]);

  const handlePermissionResponse = useCallback(
    async (response: ConfirmResponse) => {
      await confirmAction(response);
    },
    [confirmAction],
  );

  const replayPendingAction = useCallback(
    async (requestId: string, assistantMessageId: string) => {
      const activeSessionId = sessionIdRef.current;
      if (!activeSessionId) {
        toast.error("当前没有激活会话，无法重新拉起请求");
        return false;
      }

      try {
        const replayedAction = await runtime.replayRequest(
          activeSessionId,
          requestId,
        );

        if (!replayedAction) {
          await refreshSessionReadModel(activeSessionId);
          toast.error("待处理请求已不存在，无法重新拉起");
          return false;
        }

        const actionData: ActionRequired = {
          requestId: replayedAction.request_id,
          actionType: replayedAction.action_type,
          toolName: replayedAction.tool_name,
          arguments:
            replayedAction.arguments &&
            typeof replayedAction.arguments === "object" &&
            !Array.isArray(replayedAction.arguments)
              ? replayedAction.arguments
              : undefined,
          prompt: replayedAction.prompt,
          questions: normalizeActionQuestions(
            replayedAction.questions,
            replayedAction.prompt,
          ),
          requestedSchema: replayedAction.requested_schema,
          scope: replayedAction.scope
            ? {
                sessionId: replayedAction.scope.session_id,
                threadId: replayedAction.scope.thread_id,
                turnId: replayedAction.scope.turn_id,
              }
            : undefined,
          status: "pending",
          isFallback: false,
        };

        upsertAssistantActionRequest({
          assistantMsgId: assistantMessageId,
          actionData,
          replaceByPrompt:
            actionData.actionType === "ask_user" ||
            actionData.actionType === "elicitation",
          setPendingActions,
          setMessages,
        });
        setSubmittedActionsInFlight((prev) =>
          prev.filter(
            (item) =>
              item.requestId !== requestId &&
              item.requestId !== actionData.requestId,
          ),
        );
        toast.success("已重新拉起待处理请求");
        return true;
      } catch (error) {
        console.error("[AsterChat] 重新拉起请求失败:", error);
        toast.error(
          error instanceof Error && error.message
            ? error.message
            : "重新拉起请求失败",
        );
        return false;
      }
    },
    [refreshSessionReadModel, runtime, sessionIdRef, setMessages],
  );

  return {
    pendingActions,
    submittedActionsInFlight,
    setPendingActions,
    warnedKeysRef,
    confirmAction,
    handlePermissionResponse,
    replayPendingAction,
  };
}
