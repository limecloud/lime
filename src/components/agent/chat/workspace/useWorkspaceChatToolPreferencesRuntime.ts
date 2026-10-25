import {
  useEffect,
  useMemo,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";
import type {
  AgentExecutionStrategy,
  AgentSessionExecutionRuntime,
} from "@/lib/api/agentExecutionRuntime";
import {
  alignChatToolPreferencesWithExecutionStrategy,
  loadChatToolPreferences,
  type ChatToolPreferences,
} from "../utils/chatToolPreferences";
import { createChatToolPreferencesFromExecutionRuntime } from "../utils/sessionExecutionRuntime";
import type { SessionRecentMetadataSyncOptions } from "./agentChatWorkspaceHelpers";

interface UseWorkspaceChatToolPreferencesRuntimeParams {
  activeTheme: string;
  chatToolPreferences: ChatToolPreferences;
  executionRuntime?: Pick<
    AgentSessionExecutionRuntime,
    "recent_preferences" | "execution_strategy"
  > | null;
  executionStrategy?: AgentExecutionStrategy | null;
  sessionId?: string | null;
  setChatToolPreferences: Dispatch<SetStateAction<ChatToolPreferences>>;
  syncChatToolPreferencesSource: (
    theme: string,
    runtimePreferences?: ChatToolPreferences | null,
  ) => void;
  syncSessionRecentPreferences: (
    sessionId: string,
    preferences: ChatToolPreferences,
    options?: SessionRecentMetadataSyncOptions,
  ) => Promise<void>;
}

export function buildSessionRecentPreferencesBackfillKey(
  sessionId: string,
  preferences: ChatToolPreferences,
): string {
  return `${sessionId}:${JSON.stringify([
    preferences.task,
    preferences.subagent,
  ])}`;
}

export function resolveFallbackSessionRecentPreferences({
  activeTheme,
  executionStrategy,
}: {
  activeTheme: string;
  executionStrategy?: AgentExecutionStrategy | null;
}): ChatToolPreferences {
  return {
    ...alignChatToolPreferencesWithExecutionStrategy(
      loadChatToolPreferences(activeTheme),
      executionStrategy,
    ),
  };
}

export function useWorkspaceChatToolPreferencesRuntime({
  activeTheme,
  chatToolPreferences,
  executionRuntime,
  executionStrategy,
  sessionId,
  setChatToolPreferences,
  syncChatToolPreferencesSource,
  syncSessionRecentPreferences,
}: UseWorkspaceChatToolPreferencesRuntimeParams): ChatToolPreferences {
  const sessionRecentPreferencesBackfillKeyRef = useRef<string | null>(null);
  const runtimeChatToolPreferences = useMemo(
    () => createChatToolPreferencesFromExecutionRuntime(executionRuntime),
    [executionRuntime],
  );
  const effectiveChatToolPreferences = useMemo(
    () =>
      alignChatToolPreferencesWithExecutionStrategy(
        chatToolPreferences,
        executionStrategy,
      ),
    [chatToolPreferences, executionStrategy],
  );

  useEffect(() => {
    syncChatToolPreferencesSource(activeTheme, runtimeChatToolPreferences);
  }, [activeTheme, runtimeChatToolPreferences, syncChatToolPreferencesSource]);

  useEffect(() => {
    if (
      chatToolPreferences.task === effectiveChatToolPreferences.task &&
      chatToolPreferences.subagent === effectiveChatToolPreferences.subagent
    ) {
      return;
    }

    setChatToolPreferences(effectiveChatToolPreferences);
  }, [
    chatToolPreferences.subagent,
    chatToolPreferences.task,
    effectiveChatToolPreferences,
    setChatToolPreferences,
  ]);

  useEffect(() => {
    const trimmedSessionId = sessionId?.trim();
    if (!trimmedSessionId || runtimeChatToolPreferences) {
      return;
    }

    const fallbackPreferences = resolveFallbackSessionRecentPreferences({
      activeTheme,
      executionStrategy,
    });
    const backfillKey = buildSessionRecentPreferencesBackfillKey(
      trimmedSessionId,
      fallbackPreferences,
    );
    if (sessionRecentPreferencesBackfillKeyRef.current === backfillKey) {
      return;
    }
    sessionRecentPreferencesBackfillKeyRef.current = backfillKey;

    void syncSessionRecentPreferences(trimmedSessionId, fallbackPreferences, {
      priority: "background",
    }).catch((error) => {
      console.warn("[LocalConversationPage] 回填会话 recent_preferences 失败:", error);
    });
  }, [
    activeTheme,
    executionStrategy,
    runtimeChatToolPreferences,
    sessionId,
    syncSessionRecentPreferences,
  ]);

  return effectiveChatToolPreferences;
}
