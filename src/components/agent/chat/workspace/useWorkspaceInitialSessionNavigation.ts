import { useEffect, useRef } from "react";
import { logAgentDebug } from "@/lib/agentDebug";

const INITIAL_SESSION_NAVIGATION_DEDUPE_MS = 2_000;
const recentInitialSessionNavigationStarts = new Map<string, number>();

interface InitialSessionSwitchOptions {
  forceRefresh?: boolean;
  resumeSessionStartHooks?: boolean;
  allowDetachedSession?: boolean;
}

interface InitialSessionSwitchResolution extends InitialSessionSwitchOptions {
  waitForResolution?: boolean;
}

interface UseWorkspaceInitialSessionNavigationParams {
  initialSessionId?: string | null;
  currentSessionId?: string | null;
  switchTopic: (
    topicId: string,
    options?: {
      forceRefresh?: boolean;
      resumeSessionStartHooks?: boolean;
      allowDetachedSession?: boolean;
    },
  ) => Promise<unknown>;
  resolveInitialSessionSwitch?: (
    sessionId: string,
  ) => InitialSessionSwitchResolution | null | undefined;
}

function normalizeSessionId(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

export function resetInitialSessionNavigationDeduplicationForTests() {
  recentInitialSessionNavigationStarts.clear();
}

export function rememberInitialSessionNavigationStart(sessionId: string) {
  const normalizedSessionId = normalizeSessionId(sessionId);
  if (!normalizedSessionId) {
    return;
  }

  recentInitialSessionNavigationStarts.set(normalizedSessionId, Date.now());
}

export function useWorkspaceInitialSessionNavigation({
  initialSessionId,
  currentSessionId,
  switchTopic,
  resolveInitialSessionSwitch,
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
      recentInitialSessionNavigationStarts.delete(normalizedInitialSessionId);
      return;
    }

    if (appliedInitialSessionIdRef.current === normalizedInitialSessionId) {
      return;
    }

    const resolvedSwitchOptions =
      resolveInitialSessionSwitch?.(normalizedInitialSessionId) ?? null;
    if (resolvedSwitchOptions?.waitForResolution) {
      logAgentDebug(
        "AgentChatPage",
        "initialSessionNavigation.waitForResolution",
        {
          currentSessionId: normalizedCurrentSessionId,
          initialSessionId: normalizedInitialSessionId,
        },
        {
          dedupeKey: `initialSessionNavigation.wait:${normalizedInitialSessionId}`,
          throttleMs: 1000,
        },
      );
      return;
    }

    const startedAt = Date.now();
    const lastStartedAt =
      recentInitialSessionNavigationStarts.get(normalizedInitialSessionId) ?? 0;
    if (startedAt - lastStartedAt < INITIAL_SESSION_NAVIGATION_DEDUPE_MS) {
      logAgentDebug(
        "AgentChatPage",
        "initialSessionNavigation.deduped",
        {
          currentSessionId: normalizedCurrentSessionId,
          initialSessionId: normalizedInitialSessionId,
          elapsedSinceLastStartMs: startedAt - lastStartedAt,
        },
        {
          dedupeKey: `initialSessionNavigation.deduped:${normalizedInitialSessionId}`,
          throttleMs: INITIAL_SESSION_NAVIGATION_DEDUPE_MS,
        },
      );
      return;
    }

    appliedInitialSessionIdRef.current = normalizedInitialSessionId;
    recentInitialSessionNavigationStarts.set(
      normalizedInitialSessionId,
      startedAt,
    );
    logAgentDebug("AgentChatPage", "initialSessionNavigation.start", {
      currentSessionId: normalizedCurrentSessionId,
      initialSessionId: normalizedInitialSessionId,
      resumeSessionStartHooks:
        resolvedSwitchOptions?.resumeSessionStartHooks === true,
      allowDetachedSession:
        resolvedSwitchOptions?.allowDetachedSession === true,
    });

    const switchOptions: InitialSessionSwitchOptions = {
      forceRefresh: resolvedSwitchOptions?.forceRefresh ?? true,
      ...(resolvedSwitchOptions?.resumeSessionStartHooks === true
        ? { resumeSessionStartHooks: true }
        : {}),
      ...(resolvedSwitchOptions?.allowDetachedSession === true
        ? { allowDetachedSession: true }
        : {}),
    };

    void switchTopic(normalizedInitialSessionId, switchOptions).catch(
      (error) => {
        appliedInitialSessionIdRef.current = null;
        recentInitialSessionNavigationStarts.delete(normalizedInitialSessionId);
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
      },
    );
  }, [
    normalizedCurrentSessionId,
    normalizedInitialSessionId,
    resolveInitialSessionSwitch,
    switchTopic,
  ]);
}
