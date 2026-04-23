import { useEffect, useRef } from "react";
import { logAgentDebug } from "@/lib/agentDebug";

interface UseWorkspaceInitialSessionNavigationParams {
  initialSessionId?: string | null;
  currentSessionId?: string | null;
  switchTopic: (
    topicId: string,
    options?: {
      forceRefresh?: boolean;
      resumeSessionStartHooks?: boolean;
    },
  ) => Promise<unknown>;
}

function normalizeSessionId(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

export function useWorkspaceInitialSessionNavigation({
  initialSessionId,
  currentSessionId,
  switchTopic,
}: UseWorkspaceInitialSessionNavigationParams) {
  const appliedInitialSessionIdRef = useRef<string | null>(null);
  const normalizedInitialSessionId = normalizeSessionId(initialSessionId);
  const normalizedCurrentSessionId = normalizeSessionId(currentSessionId);

  useEffect(() => {
    if (!normalizedInitialSessionId) {
      appliedInitialSessionIdRef.current = null;
      return;
    }

    if (normalizedCurrentSessionId === normalizedInitialSessionId) {
      appliedInitialSessionIdRef.current = normalizedInitialSessionId;
      return;
    }

    if (appliedInitialSessionIdRef.current === normalizedInitialSessionId) {
      return;
    }

    appliedInitialSessionIdRef.current = normalizedInitialSessionId;
    logAgentDebug("AgentChatPage", "initialSessionNavigation.start", {
      currentSessionId: normalizedCurrentSessionId,
      initialSessionId: normalizedInitialSessionId,
    });

    void switchTopic(normalizedInitialSessionId, {
      forceRefresh: true,
      resumeSessionStartHooks: true,
    }).catch((error) => {
      appliedInitialSessionIdRef.current = null;
      logAgentDebug(
        "AgentChatPage",
        "initialSessionNavigation.error",
        {
          error,
          initialSessionId: normalizedInitialSessionId,
        },
        { level: "error" },
      );
      console.error("[AgentChatPage] 恢复初始会话失败:", error);
    });
  }, [normalizedCurrentSessionId, normalizedInitialSessionId, switchTopic]);
}
