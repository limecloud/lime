import { useCallback, useEffect, useMemo, useState } from "react";
import { parseAIResponse } from "@/lib/workspace/a2ui";
import type {
  A2UIFormData,
  A2UIResponse,
} from "@/lib/workspace/a2ui";
import {
  buildActionRequestA2UI,
  isActionRequestA2UICompatible,
} from "../utils/actionRequestA2UI";
import { buildLegacyQuestionnaireA2UI } from "../utils/legacyQuestionnaireA2UI";
import {
  buildProgressiveA2UIStepForm,
  hasMeaningfulProgressiveA2UIAnswers,
  type ProgressiveA2UIStepView,
} from "../utils/progressivePendingA2UI";
import { governActionRequest } from "../utils/actionRequestGovernance";
import type { ActionRequired, Message, PendingA2UISource } from "../types";

interface A2UISubmissionNotice {
  title: string;
  summary: string;
}

type PendingA2UIResolution =
  | {
      form: A2UIResponse;
      source: PendingA2UISource & {
        kind: "assistant_message" | "legacy_message";
      };
    }
  | {
      form: A2UIResponse;
      source: PendingA2UISource & {
        kind: "action_request";
      };
    };

interface UseWorkspaceA2UIRuntimeParams {
  messages: Message[];
}

interface PendingA2UIProgressState {
  sourceKey: string;
  stepIndex: number;
  accumulatedFormData: A2UIFormData;
}

type PendingA2UISubmitResolution =
  | {
      status: "advance";
    }
  | {
      status: "empty";
    }
  | {
      status: "submit";
      formData: A2UIFormData;
    };

function getPendingA2UISourceKey(
  resolution: PendingA2UIResolution | null,
): string | null {
  if (!resolution) {
    return null;
  }

  if (resolution.source.kind === "action_request") {
    return `${resolution.source.kind}:${resolution.source.requestId}:${resolution.form.id}`;
  }

  return `${resolution.source.kind}:${resolution.source.messageId}:${resolution.form.id}`;
}

function isSamePendingA2UIResolution(
  previous: PendingA2UIResolution | null,
  next: PendingA2UIResolution,
): boolean {
  if (!previous || previous.source.kind !== next.source.kind) {
    return false;
  }

  if (
    previous.source.kind === "action_request" &&
    next.source.kind === "action_request"
  ) {
    return previous.source.requestId === next.source.requestId;
  }

  return (
    previous.source.kind !== "action_request" &&
    next.source.kind !== "action_request" &&
    previous.source.messageId === next.source.messageId
  );
}

export function useWorkspaceA2UIRuntime({
  messages,
}: UseWorkspaceA2UIRuntimeParams): {
  a2uiSubmissionNotice: A2UISubmissionNotice | null;
  pendingA2UIForm: A2UIResponse | null;
  pendingA2UISource: PendingA2UISource | null;
  pendingActionRequest: ActionRequired | null;
  pendingLegacyQuestionnaireA2UIForm: A2UIResponse | null;
  pendingPromotedA2UIActionRequest: ActionRequired | null;
  resolvePendingA2UISubmit: (
    formData: A2UIFormData,
  ) => PendingA2UISubmitResolution;
} {
  const pendingActionRequest = useMemo<ActionRequired | null>(() => {
    const latestPendingMessage = [...messages]
      .reverse()
      .find((message) =>
        message.actionRequests?.some((request) => request.status === "pending"),
      );

    if (!latestPendingMessage?.actionRequests) {
      return null;
    }

    const pendingRequest =
      [...latestPendingMessage.actionRequests]
        .reverse()
        .find((request) => request.status === "pending") || null;

    return pendingRequest ? governActionRequest(pendingRequest) : null;
  }, [messages]);

  const pendingMessageA2UI = useMemo<PendingA2UIResolution | null>(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];

      if (message.role === "user") {
        return null;
      }

      if (message.role !== "assistant" || !message.content) {
        continue;
      }

      try {
        const parsed = parseAIResponse(message.content, false);
        if (!parsed.hasA2UI) {
          continue;
        }

        for (let j = parsed.parts.length - 1; j >= 0; j -= 1) {
          const part = parsed.parts[j];
          if (part.type === "a2ui" && typeof part.content !== "string") {
            return {
              form: part.content,
              source: {
                kind: "assistant_message",
                messageId: message.id,
              },
            };
          }
        }
      } catch {
        // 解析失败时忽略，继续向前寻找最近可用表单
      }
    }

    return null;
  }, [messages]);
  const pendingMessageA2UIForm = pendingMessageA2UI?.form ?? null;

  const pendingPromotedA2UIActionRequest = useMemo<ActionRequired | null>(() => {
    if (pendingMessageA2UIForm) {
      return null;
    }

    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      const pendingRequest = [...(message.actionRequests || [])]
        .reverse()
        .find(
          (request) =>
            request.status === "pending" &&
            isActionRequestA2UICompatible(request),
        );

      if (pendingRequest) {
        return governActionRequest(pendingRequest);
      }
    }

    return null;
  }, [messages, pendingMessageA2UIForm]);

  const pendingLegacyQuestionnaireA2UI = useMemo<PendingA2UIResolution | null>(() => {
    if (pendingMessageA2UIForm || pendingActionRequest) {
      return null;
    }

    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];

      if (message.role === "user") {
        return null;
      }

      if (message.role !== "assistant") {
        continue;
      }

      if ((message.actionRequests || []).length > 0) {
        return null;
      }

      const form = buildLegacyQuestionnaireA2UI(message.content || "");
      if (!form) {
        return null;
      }

      return {
        form,
        source: {
          kind: "legacy_message",
          messageId: message.id,
        },
      };
    }

    return null;
  }, [messages, pendingActionRequest, pendingMessageA2UIForm]);
  const pendingLegacyQuestionnaireA2UIForm =
    pendingLegacyQuestionnaireA2UI?.form ?? null;

  const resolvedPendingA2UI = useMemo<PendingA2UIResolution | null>(() => {
    if (pendingMessageA2UI) {
      return pendingMessageA2UI;
    }

    if (pendingPromotedA2UIActionRequest) {
      const form = buildActionRequestA2UI(pendingPromotedA2UIActionRequest);
      if (!form) {
        return null;
      }

      return {
        form,
        source: {
          kind: "action_request",
          requestId: pendingPromotedA2UIActionRequest.requestId,
        },
      };
    }

    return pendingLegacyQuestionnaireA2UI;
  }, [
    pendingLegacyQuestionnaireA2UI,
    pendingMessageA2UI,
    pendingPromotedA2UIActionRequest,
  ]);

  const hasRecentA2UISubmission = useMemo(() => {
    if (resolvedPendingA2UI) {
      return false;
    }

    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (message.role === "assistant") {
        const hasSubmittedActionRequest = (message.actionRequests || []).some(
          (request) =>
            request.status === "submitted" &&
            isActionRequestA2UICompatible(request),
        );

        if (hasSubmittedActionRequest) {
          return true;
        }

        continue;
      }

      if (message.role !== "user") {
        continue;
      }

      const content = message.content.trim();
      if (!content.startsWith("我的选择：")) {
        return false;
      }

      return true;
    }

    return false;
  }, [messages, resolvedPendingA2UI]);

  const a2uiSubmissionNotice: A2UISubmissionNotice | null = null;

  const [retainedPendingA2UI, setRetainedPendingA2UI] =
    useState<PendingA2UIResolution | null>(resolvedPendingA2UI);

  useEffect(() => {
    if (resolvedPendingA2UI) {
      setRetainedPendingA2UI((previous) =>
        isSamePendingA2UIResolution(previous, resolvedPendingA2UI)
          ? previous
          : resolvedPendingA2UI,
      );
      return;
    }

    if (hasRecentA2UISubmission) {
      setRetainedPendingA2UI(null);
      return;
    }

    setRetainedPendingA2UI((previous) => {
      if (!previous) {
        return null;
      }

      const source = previous.source;
      if (source.kind === "action_request") {
        const requestStillExists = messages.some((message) =>
          (message.actionRequests || []).some(
            (request) => request.requestId === source.requestId,
          ),
        );
        return requestStillExists ? previous : null;
      }

      const sourceMessageStillExists = messages.some(
        (message) => message.id === source.messageId,
      );
      return sourceMessageStillExists ? previous : null;
    });
  }, [hasRecentA2UISubmission, messages, resolvedPendingA2UI]);

  const visiblePendingA2UI =
    resolvedPendingA2UI ?? retainedPendingA2UI ?? null;
  const [pendingA2UIProgressState, setPendingA2UIProgressState] =
    useState<PendingA2UIProgressState | null>(null);

  useEffect(() => {
    const sourceKey = getPendingA2UISourceKey(visiblePendingA2UI);
    if (!sourceKey) {
      if (hasRecentA2UISubmission) {
        setPendingA2UIProgressState(null);
      }
      return;
    }

    setPendingA2UIProgressState((previous) =>
      previous?.sourceKey === sourceKey
        ? previous
        : {
            sourceKey,
            stepIndex: 0,
            accumulatedFormData: {},
          },
    );
  }, [hasRecentA2UISubmission, visiblePendingA2UI]);

  const progressivePendingA2UI = useMemo<ProgressiveA2UIStepView | null>(() => {
    if (!visiblePendingA2UI) {
      return null;
    }

    if (
      visiblePendingA2UI.source.kind !== "assistant_message"
    ) {
      return null;
    }

    const sourceKey = getPendingA2UISourceKey(visiblePendingA2UI);
    const currentStepIndex =
      sourceKey && pendingA2UIProgressState?.sourceKey === sourceKey
        ? pendingA2UIProgressState.stepIndex
        : 0;

    return buildProgressiveA2UIStepForm(
      visiblePendingA2UI.form,
      currentStepIndex,
    );
  }, [pendingA2UIProgressState, visiblePendingA2UI]);

  const pendingA2UIForm =
    progressivePendingA2UI?.form ?? visiblePendingA2UI?.form ?? null;
  const pendingA2UISource = visiblePendingA2UI?.source ?? null;

  const resolvePendingA2UISubmit = useCallback(
    (formData: A2UIFormData): PendingA2UISubmitResolution => {
      if (!progressivePendingA2UI || !visiblePendingA2UI) {
        return {
          status: "submit",
          formData,
        };
      }

      const sourceKey = getPendingA2UISourceKey(visiblePendingA2UI);
      const accumulatedFormData =
        sourceKey && pendingA2UIProgressState?.sourceKey === sourceKey
          ? pendingA2UIProgressState.accumulatedFormData
          : {};
      const mergedFormData = {
        ...accumulatedFormData,
        ...formData,
      };

      if (
        !hasMeaningfulProgressiveA2UIAnswers(
          progressivePendingA2UI.meta.fieldIds,
          mergedFormData,
        )
      ) {
        return {
          status: "empty",
        };
      }

      if (!progressivePendingA2UI.meta.isFinalStep && sourceKey) {
        setPendingA2UIProgressState({
          sourceKey,
          stepIndex: progressivePendingA2UI.meta.currentStep,
          accumulatedFormData: mergedFormData,
        });
        return {
          status: "advance",
        };
      }

      return {
        status: "submit",
        formData: mergedFormData,
      };
    },
    [pendingA2UIProgressState, progressivePendingA2UI, visiblePendingA2UI],
  );

  useEffect(() => {
    if (
      !pendingActionRequest ||
      resolvedPendingA2UI ||
      !isActionRequestA2UICompatible(pendingActionRequest)
    ) {
      return;
    }

    console.warn("[AgentChatPage] 待处理 action_required 未生成输入区 A2UI", {
      requestId: pendingActionRequest.requestId,
      actionType: pendingActionRequest.actionType,
      prompt: pendingActionRequest.prompt,
      scope: pendingActionRequest.scope,
    });
  }, [pendingActionRequest, resolvedPendingA2UI]);

  return {
    a2uiSubmissionNotice,
    pendingA2UIForm,
    pendingA2UISource,
    pendingActionRequest,
    pendingLegacyQuestionnaireA2UIForm,
    pendingPromotedA2UIActionRequest,
    resolvePendingA2UISubmit,
  };
}
