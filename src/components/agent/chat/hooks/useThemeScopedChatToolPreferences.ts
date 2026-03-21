import { useEffect, useState } from "react";
import {
  loadChatToolPreferences,
  saveChatToolPreferences,
  type ChatToolPreferences,
} from "../utils/chatToolPreferences";

export function useThemeScopedChatToolPreferences(activeTheme: string) {
  const [chatToolPreferences, setChatToolPreferences] =
    useState<ChatToolPreferences>(() => loadChatToolPreferences(activeTheme));
  const [chatToolPreferencesTheme, setChatToolPreferencesTheme] =
    useState<string>(activeTheme);

  useEffect(() => {
    if (chatToolPreferencesTheme === activeTheme) {
      return;
    }

    setChatToolPreferences(loadChatToolPreferences(activeTheme));
    setChatToolPreferencesTheme(activeTheme);
  }, [activeTheme, chatToolPreferencesTheme]);

  useEffect(() => {
    if (chatToolPreferencesTheme !== activeTheme) {
      return;
    }

    saveChatToolPreferences(chatToolPreferences, activeTheme);
  }, [activeTheme, chatToolPreferences, chatToolPreferencesTheme]);

  return {
    chatToolPreferences,
    setChatToolPreferences,
  };
}
