import { useCallback, useEffect, useRef, useState } from "react";
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

export function useThemeScopedChatToolPreferences(activeTheme: string) {
  const [chatToolPreferences, setChatToolPreferences] =
    useState<ChatToolPreferences>(() => loadChatToolPreferences(activeTheme));
  const lastHydratedSourceRef = useRef(
    `${activeTheme}:${serializePreferenceSource(null)}`,
  );

  const syncChatToolPreferencesSource = useCallback(
    (theme: string, runtimePreferences?: ChatToolPreferences | null) => {
      const nextSourceKey = `${theme}:${serializePreferenceSource(
        runtimePreferences,
      )}`;
      if (lastHydratedSourceRef.current === nextSourceKey) {
        return;
      }

      setChatToolPreferences(
        runtimePreferences ?? loadChatToolPreferences(theme),
      );
      lastHydratedSourceRef.current = nextSourceKey;
    },
    [],
  );

  useEffect(() => {
    syncChatToolPreferencesSource(activeTheme);
  }, [activeTheme, syncChatToolPreferencesSource]);

  useEffect(() => {
    saveChatToolPreferences(chatToolPreferences, activeTheme);
  }, [activeTheme, chatToolPreferences]);

  return {
    chatToolPreferences,
    setChatToolPreferences,
    syncChatToolPreferencesSource,
  };
}
