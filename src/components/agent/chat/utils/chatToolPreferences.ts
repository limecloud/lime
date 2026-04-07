import type { AsterExecutionStrategy } from "@/lib/api/agentRuntime";
import { isGeneralResearchTheme } from "./generalAgentPrompt";

export interface ChatToolPreferences {
  webSearch: boolean;
  thinking: boolean;
  task: boolean;
  subagent: boolean;
}

export function isPlanExecutionStrategy(
  executionStrategy?: AsterExecutionStrategy | null,
): boolean {
  return executionStrategy === "code_orchestrated";
}

export function alignChatToolPreferencesWithExecutionStrategy(
  preferences: ChatToolPreferences,
  executionStrategy?: AsterExecutionStrategy | null,
): ChatToolPreferences {
  const nextTask = isPlanExecutionStrategy(executionStrategy);
  if (preferences.task === nextTask) {
    return preferences;
  }

  return {
    ...preferences,
    task: nextTask,
  };
}

export const DEFAULT_CHAT_TOOL_PREFERENCES: ChatToolPreferences = {
  webSearch: false,
  thinking: false,
  task: false,
  subagent: false,
};

const LEGACY_CHAT_TOOL_PREFERENCES_KEY = "lime.chat.tool_preferences.v1";
const CHAT_TOOL_PREFERENCES_KEY_PREFIX = "lime.chat.tool_preferences";
const CHAT_TOOL_PREFERENCES_KEY_VERSION = "v3";

const normalizeBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const normalizeThemeScope = (theme?: string | null): string => {
  const normalizedTheme = theme?.trim().toLowerCase();
  return normalizedTheme || "global";
};

const getScopedChatToolPreferencesKey = (theme?: string | null): string =>
  `${CHAT_TOOL_PREFERENCES_KEY_PREFIX}.${normalizeThemeScope(theme)}.${CHAT_TOOL_PREFERENCES_KEY_VERSION}`;

const parseStoredPreferences = (
  raw: string,
  fallback: ChatToolPreferences,
): ChatToolPreferences => {
  const parsed = JSON.parse(raw) as Partial<ChatToolPreferences>;
  return {
    webSearch: normalizeBoolean(parsed.webSearch, fallback.webSearch),
    thinking: normalizeBoolean(parsed.thinking, fallback.thinking),
    task: normalizeBoolean(parsed.task, fallback.task),
    subagent: normalizeBoolean(parsed.subagent, fallback.subagent),
  };
};

export function getDefaultChatToolPreferences(
  _theme?: string | null,
): ChatToolPreferences {
  return DEFAULT_CHAT_TOOL_PREFERENCES;
}

export function loadChatToolPreferences(
  theme?: string | null,
): ChatToolPreferences {
  const defaults = getDefaultChatToolPreferences(theme);

  try {
    const scopedRaw = localStorage.getItem(
      getScopedChatToolPreferencesKey(theme),
    );
    if (scopedRaw) {
      return parseStoredPreferences(scopedRaw, defaults);
    }

    if (isGeneralResearchTheme(theme)) {
      return defaults;
    }

    const legacyRaw = localStorage.getItem(LEGACY_CHAT_TOOL_PREFERENCES_KEY);
    if (legacyRaw) {
      return parseStoredPreferences(legacyRaw, defaults);
    }

    return defaults;
  } catch {
    return defaults;
  }
}

export function saveChatToolPreferences(
  preferences: ChatToolPreferences,
  theme?: string | null,
): void {
  try {
    localStorage.setItem(
      getScopedChatToolPreferencesKey(theme),
      JSON.stringify(preferences),
    );
  } catch {
    // ignore persistence errors
  }
}
