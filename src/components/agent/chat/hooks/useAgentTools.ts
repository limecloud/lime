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
import { resolveActionPromptKey } from "./agentChatCoreUtils";
import type { AgentRuntimeAdapter } from "./agentRuntimeAdapter";
import { markThreadActionItemSubmitted } from "./agentThreadState";
import { buildActionRequestSubmissionContext } from "../utils/actionRequestA2UI";

interface UseAgentToolsOptions {
  runtime: AgentRuntimeAdapter;
  sessionIdRef: MutableRefObject<string | null>;
  currentStreamingSessionIdRef: MutableRefObject<string | null>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setThreadItems: Dispatch<SetStateAction<AgentThreadItem[]>>;
}

export function useAgentTools(options: UseAgentToolsOptions) {
  const {
    runtime,
    sessionIdRef,
    currentStreamingSessionIdRef,
    setMessages,
    setThreadItems,
  } = options;

  const [pendingActions, setPendingActions] = useState<ActionRequired[]>([]);
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
      try {
        const pendingAction = pendingActions.find(
          (item) => item.requestId === response.requestId,
        );
        const actionType = response.actionType || pendingAction?.actionType;
        if (!actionType) {
          throw new Error("缺少 actionType，无法提交确认");
        }

        const normalizedResponse =
          typeof response.response === "string" ? response.response.trim() : "";
        let submittedUserData: unknown = response.userData;
        let effectiveRequestId = response.requestId;
        let metadataAction = pendingAction;
        const acknowledgedRequestIds = new Set<string>([response.requestId]);

        if (actionType === "elicitation" || actionType === "ask_user") {
          const activeSessionId =
            currentStreamingSessionIdRef.current || sessionIdRef.current;
          if (!activeSessionId) {
            throw new Error("缺少会话 ID，无法提交 elicitation 响应");
          }

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

          if (pendingAction?.isFallback) {
            const fallbackPromptKey = resolveActionPromptKey(pendingAction);
            if (fallbackPromptKey) {
              const resolvedAction = pendingActions.find((item) => {
                if (item.requestId === pendingAction.requestId) return false;
                if (item.isFallback) return false;
                if (item.actionType !== pendingAction.actionType) return false;
                return resolveActionPromptKey(item) === fallbackPromptKey;
              });

              if (!resolvedAction) {
                queuedFallbackResponsesRef.current.set(fallbackPromptKey, {
                  ...response,
                  actionType,
                  requestId: pendingAction.requestId,
                  userData,
                });
                setPendingActions((prev) =>
                  prev.map((item) =>
                    item.requestId === pendingAction.requestId
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
                      item.requestId === pendingAction.requestId
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
                      part.actionRequired.requestId === pendingAction.requestId
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
                toast.info("已记录你的回答，等待系统请求就绪后自动提交");
                return;
              }

              effectiveRequestId = resolvedAction.requestId;
              metadataAction = resolvedAction;
              acknowledgedRequestIds.add(resolvedAction.requestId);
            }
          }

          const submissionContext = metadataAction
            ? buildActionRequestSubmissionContext(metadataAction, userData)
            : null;

          await runtime.respondToAction({
            sessionId: activeSessionId,
            requestId: effectiveRequestId,
            actionType,
            confirmed: response.confirmed,
            response: response.response,
            userData,
            metadata: submissionContext?.requestMetadata,
          });
        } else {
          await runtime.respondToAction({
            sessionId: sessionIdRef.current || "",
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
      } catch (error) {
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
      pendingActions,
      runtime,
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

  return {
    pendingActions,
    setPendingActions,
    warnedKeysRef,
    confirmAction,
    handlePermissionResponse,
  };
}
