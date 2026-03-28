import { useEffect, useMemo, useState } from "react";
import { parseAIResponse } from "@/components/content-creator/a2ui/parser";
import type { A2UIResponse } from "@/components/content-creator/a2ui/types";
import {
  buildActionRequestA2UI,
  isActionRequestA2UICompatible,
  summarizeActionRequestSubmission,
} from "../utils/actionRequestA2UI";
import { buildLegacyQuestionnaireA2UI } from "../utils/legacyQuestionnaireA2UI";
import type { ActionRequired, Message } from "../types";

interface A2UISubmissionNotice {
  title: string;
  summary: string;
}

type PendingA2UIResolution =
  | {
      form: A2UIResponse;
      source: {
        kind: "assistant_message" | "legacy_message";
        messageId: string;
      };
    }
  | {
      form: A2UIResponse;
      source: {
        kind: "action_request";
        requestId: string;
      };
    };

interface UseWorkspaceA2UIRuntimeParams {
  messages: Message[];
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
  pendingActionRequest: ActionRequired | null;
  pendingLegacyQuestionnaireA2UIForm: A2UIResponse | null;
  pendingPromotedA2UIActionRequest: ActionRequired | null;
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

    return (
      [...latestPendingMessage.actionRequests]
        .reverse()
        .find((request) => request.status === "pending") || null
    );
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
        return pendingRequest;
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

  const a2uiSubmissionNotice = useMemo<A2UISubmissionNotice | null>(() => {
    if (resolvedPendingA2UI) {
      return null;
    }

    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (message.role === "assistant") {
        const submittedActionRequest = [...(message.actionRequests || [])]
          .reverse()
          .find(
            (request) =>
              request.status === "submitted" &&
              isActionRequestA2UICompatible(request),
          );

        if (submittedActionRequest) {
          return {
            title: "补充信息已确认",
            summary:
              summarizeActionRequestSubmission(submittedActionRequest) ||
              "已收到你的补充信息，正在继续推进下一步。",
          };
        }

        continue;
      }

      if (message.role !== "user") {
        continue;
      }

      const content = message.content.trim();
      if (!content.startsWith("我的选择：")) {
        return null;
      }

      const summary = content
        .split("\n")
        .slice(1)
        .map((line) => line.replace(/^[-•]\s*/, "").trim())
        .filter(Boolean)
        .slice(0, 3)
        .join(" · ");

      return {
        title: "需求已确认",
        summary: summary || "已收到你的补充信息，正在继续推进下一步。",
      };
    }

    return null;
  }, [messages, resolvedPendingA2UI]);

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

    if (a2uiSubmissionNotice) {
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
  }, [a2uiSubmissionNotice, messages, resolvedPendingA2UI]);

  const pendingA2UIForm =
    resolvedPendingA2UI?.form ?? retainedPendingA2UI?.form ?? null;

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
    pendingActionRequest,
    pendingLegacyQuestionnaireA2UIForm,
    pendingPromotedA2UIActionRequest,
  };
}
