import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import {
  loadChatToolPreferences,
  saveChatToolPreferences,
  type ChatToolPreferences,
} from "../utils/chatToolPreferences";

function serializePreferenceSource(
  preferences?: ChatToolPreferences | null,
): string {
  if (!preferences) {
    return "storage";
  }

  return JSON.stringify([
    preferences.webSearch,
    preferences.thinking,
    preferences.task,
    preferences.subagent,
  ]);
}

function normalizeThemeScope(theme?: string | null): string {
  return theme?.trim().toLowerCase() || "general";
}

interface ThemeScopedChatToolPreferencesSessionSyncOptions {
  getSessionId: () => string | null;
  setSessionRecentPreferences: (
    sessionId: string,
    preferences: ChatToolPreferences,
  ) => Promise<void>;
}

interface UseThemeScopedChatToolPreferencesOptions {
  scopeId?: string | null;
  sessionSync?: ThemeScopedChatToolPreferencesSessionSyncOptions;
}

export function useThemeScopedChatToolPreferences(
  activeTheme: string,
  options: UseThemeScopedChatToolPreferencesOptions = {},
) {
  const { scopeId, sessionSync } = options;
  const normalizedScopeId =
    scopeId?.trim() || sessionSync?.getSessionId()?.trim() || "__no_scope__";
  const scopeKey = `${normalizedScopeId}:${normalizeThemeScope(activeTheme)}`;
  const [chatToolPreferences, setChatToolPreferences] =
    useState<ChatToolPreferences>(() => loadChatToolPreferences(activeTheme));
  const chatToolPreferencesRef = useRef(chatToolPreferences);
  const manualMutationVersionRef = useRef(0);
  const lastScopeKeyRef = useRef(scopeKey);
  const lastHydratedSourceRef = useRef<string | null>(null);
  const pendingSessionPreferenceSyncRef = useRef(
    new Map<string, ChatToolPreferences>(),
  );
  const syncedSessionPreferenceRef = useRef(
    new Map<string, ChatToolPreferences>(),
  );

  if (lastScopeKeyRef.current !== scopeKey) {
    lastScopeKeyRef.current = scopeKey;
    manualMutationVersionRef.current = 0;
    lastHydratedSourceRef.current = null;
  }

  chatToolPreferencesRef.current = chatToolPreferences;

  const scheduleSessionRecentPreferencesSync = useCallback(
    (preferences: ChatToolPreferences) => {
      const trimmedSessionId = sessionSync?.getSessionId()?.trim();
      const syncRecentPreferences = sessionSync?.setSessionRecentPreferences;
      if (!trimmedSessionId || !syncRecentPreferences) {
        return;
      }

      const pending = pendingSessionPreferenceSyncRef.current;
      const alreadyQueued = pending.has(trimmedSessionId);
      pending.set(trimmedSessionId, preferences);
      if (alreadyQueued) {
        return;
      }

      queueMicrotask(() => {
        const latestPreferences = pending.get(trimmedSessionId);
        pending.delete(trimmedSessionId);
        if (!latestPreferences) {
          return;
        }

        void syncRecentPreferences(trimmedSessionId, latestPreferences)
          .then(() => {
            syncedSessionPreferenceRef.current.set(
              trimmedSessionId,
              latestPreferences,
            );
          })
          .catch((error) => {
            console.warn("[AgentChat] 回写会话 recent_preferences 失败:", error);
          });
      });
    },
    [sessionSync],
  );

  const getSyncedSessionRecentPreferences = useCallback(
    (sessionId: string): ChatToolPreferences | null => {
      const trimmedSessionId = sessionId.trim();
      if (!trimmedSessionId) {
        return null;
      }
      return syncedSessionPreferenceRef.current.get(trimmedSessionId) || null;
    },
    [],
  );

  const syncChatToolPreferencesSource = useCallback(
    (theme: string, runtimePreferences?: ChatToolPreferences | null) => {
      const normalizedTheme = normalizeThemeScope(theme);
      const nextScopeKey = `${normalizedScopeId}:${normalizedTheme}`;
      if (runtimePreferences && manualMutationVersionRef.current > 0) {
        return;
      }

      const nextSourceKey = `${nextScopeKey}:${serializePreferenceSource(
        runtimePreferences,
      )}`;
      if (lastHydratedSourceRef.current === nextSourceKey) {
        return;
      }

      const nextPreferences = runtimePreferences ?? loadChatToolPreferences(theme);
      const currentSessionId = sessionSync?.getSessionId()?.trim();
      if (runtimePreferences && currentSessionId) {
        syncedSessionPreferenceRef.current.set(currentSessionId, nextPreferences);
      }
      chatToolPreferencesRef.current = nextPreferences;
      setChatToolPreferences(nextPreferences);
      lastHydratedSourceRef.current = nextSourceKey;
    },
    [normalizedScopeId, sessionSync],
  );

  const updateChatToolPreferences = useCallback(
    (nextPreferencesAction: SetStateAction<ChatToolPreferences>) => {
      const previousPreferences = chatToolPreferencesRef.current;
      const nextPreferences =
        typeof nextPreferencesAction === "function"
          ? nextPreferencesAction(previousPreferences)
          : nextPreferencesAction;

      manualMutationVersionRef.current += 1;
      chatToolPreferencesRef.current = nextPreferences;
      setChatToolPreferences(nextPreferences);
      scheduleSessionRecentPreferencesSync(nextPreferences);
    },
    [scheduleSessionRecentPreferencesSync],
  );

  useEffect(() => {
    syncChatToolPreferencesSource(activeTheme);
  }, [activeTheme, syncChatToolPreferencesSource]);

  useEffect(() => {
    saveChatToolPreferences(chatToolPreferences, activeTheme);
  }, [activeTheme, chatToolPreferences]);

  return {
    chatToolPreferences,
    setChatToolPreferences: updateChatToolPreferences,
    syncChatToolPreferencesSource,
    getSyncedSessionRecentPreferences,
  };
}
