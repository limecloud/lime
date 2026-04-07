import type { Message } from "../types";
import type { AsterExecutionStrategy } from "@/lib/api/agentRuntime";
import type {
  AgentPreferenceKeys,
  AgentPreferences,
  SessionModelPreference,
} from "./agentChatShared";
import {
  hasLegacyFallbackToolNames,
  normalizeHistoryMessages,
} from "./agentChatHistory";
import { normalizeExecutionStrategy } from "./agentChatCoreUtils";

export const DEFAULT_AGENT_PROVIDER = "claude";
export const DEFAULT_AGENT_MODEL = "claude-sonnet-4-5";
export type AgentAccessMode = "read-only" | "current" | "full-access";
export const DEFAULT_AGENT_ACCESS_MODE: AgentAccessMode = "current";
export const GLOBAL_PROVIDER_PREF_KEY = "agent_pref_provider_global";
export const GLOBAL_MODEL_PREF_KEY = "agent_pref_model_global";
export const GLOBAL_MIGRATED_PREF_KEY = "agent_pref_migrated_global";

let toolcallAudio: HTMLAudioElement | null = null;
let typewriterAudio: HTMLAudioElement | null = null;
let lastTypewriterTime = 0;
const TYPEWRITER_INTERVAL = 120;

const initAudio = () => {
  if (!toolcallAudio) {
    toolcallAudio = new Audio("/sounds/tool-call.mp3");
    toolcallAudio.volume = 1;
    toolcallAudio.load();
  }
  if (!typewriterAudio) {
    typewriterAudio = new Audio("/sounds/typing.mp3");
    typewriterAudio.volume = 0.6;
    typewriterAudio.load();
  }
};

const getSoundEnabled = (): boolean => {
  return localStorage.getItem("lime_sound_enabled") === "true";
};

export const playToolcallSound = () => {
  if (!getSoundEnabled()) return;
  initAudio();
  if (toolcallAudio) {
    toolcallAudio.currentTime = 0;
    toolcallAudio.play().catch(console.error);
  }
};

export const playTypewriterSound = () => {
  if (!getSoundEnabled()) return;
  const now = Date.now();
  if (now - lastTypewriterTime < TYPEWRITER_INTERVAL) return;
  initAudio();
  if (typewriterAudio) {
    typewriterAudio.currentTime = 0;
    typewriterAudio.play().catch(console.error);
    lastTypewriterTime = now;
  }
};

export const loadPersisted = <T>(key: string, defaultValue: T): T => {
  try {
    const stored = localStorage.getItem(key);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error(e);
  }
  return defaultValue;
};

export const savePersisted = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error(e);
  }
};

export const loadTransient = <T>(key: string, defaultValue: T): T => {
  try {
    const stored = sessionStorage.getItem(key);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (key.startsWith("aster_messages") && Array.isArray(parsed)) {
        const normalizedMessages = parsed.map((msg: any) => ({
          ...msg,
          timestamp: new Date(msg.timestamp),
        })) as Message[];
        const normalized = normalizeHistoryMessages(normalizedMessages);
        if (hasLegacyFallbackToolNames(normalized)) {
          return [] as unknown as T;
        }
        return normalized as unknown as T;
      }
      return parsed;
    }
  } catch (e) {
    console.error(e);
  }
  return defaultValue;
};

export const saveTransient = (key: string, value: unknown) => {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error(e);
  }
};

export const loadPersistedString = (key: string): string | null => {
  try {
    const stored = localStorage.getItem(key);
    if (stored === null) {
      return null;
    }

    try {
      const parsed = JSON.parse(stored);
      return typeof parsed === "string" ? parsed : stored;
    } catch {
      return stored;
    }
  } catch (e) {
    console.error(e);
    return null;
  }
};

export const getAgentPreferenceKeys = (
  workspaceId?: string | null,
): AgentPreferenceKeys => {
  const resolvedWorkspaceId = workspaceId?.trim();
  if (!resolvedWorkspaceId) {
    return {
      providerKey: GLOBAL_PROVIDER_PREF_KEY,
      modelKey: GLOBAL_MODEL_PREF_KEY,
      migratedKey: GLOBAL_MIGRATED_PREF_KEY,
    };
  }

  return {
    providerKey: `agent_pref_provider_${resolvedWorkspaceId}`,
    modelKey: `agent_pref_model_${resolvedWorkspaceId}`,
    migratedKey: `agent_pref_migrated_${resolvedWorkspaceId}`,
  };
};

export const getSessionModelPreferenceKey = (
  workspaceId: string | null | undefined,
  sessionId: string,
): string => {
  const resolvedWorkspaceId = workspaceId?.trim();
  if (!resolvedWorkspaceId) {
    return `agent_topic_model_pref_global_${sessionId}`;
  }
  return `agent_topic_model_pref_${resolvedWorkspaceId}_${sessionId}`;
};

export const getExecutionStrategyStorageKey = (
  workspaceId?: string | null,
): string | null => {
  const resolvedWorkspaceId = workspaceId?.trim();
  if (!resolvedWorkspaceId) {
    return null;
  }

  return `aster_execution_strategy_${resolvedWorkspaceId}`;
};

export const getSessionAccessModeKey = (
  workspaceId: string | null | undefined,
  sessionId: string,
): string => {
  const resolvedWorkspaceId = workspaceId?.trim();
  if (!resolvedWorkspaceId) {
    return `aster_session_access_mode_global_${sessionId}`;
  }
  return `aster_session_access_mode_${resolvedWorkspaceId}_${sessionId}`;
};

export const getAccessModeStorageKey = (
  workspaceId?: string | null,
): string | null => {
  const resolvedWorkspaceId = workspaceId?.trim();
  if (!resolvedWorkspaceId) {
    return null;
  }

  return `aster_access_mode_${resolvedWorkspaceId}`;
};

export const normalizeAccessMode = (value: unknown): AgentAccessMode => {
  if (value === "read-only" || value === "current" || value === "full-access") {
    return value;
  }
  return DEFAULT_AGENT_ACCESS_MODE;
};

export const resolvePersistedAccessMode = (
  workspaceId?: string | null,
): AgentAccessMode => {
  const storageKey = getAccessModeStorageKey(workspaceId);
  if (!storageKey) {
    return DEFAULT_AGENT_ACCESS_MODE;
  }

  return normalizeAccessMode(
    loadPersisted<string | null>(storageKey, DEFAULT_AGENT_ACCESS_MODE),
  );
};

export const loadSessionAccessMode = (
  workspaceId: string | null | undefined,
  sessionId: string,
): AgentAccessMode | null => {
  const key = getSessionAccessModeKey(workspaceId, sessionId);
  const parsed = loadPersisted<string | null>(key, null);
  if (parsed === null) {
    return null;
  }
  return normalizeAccessMode(parsed);
};

export const resolvePersistedExecutionStrategy = (
  workspaceId?: string | null,
): AsterExecutionStrategy => {
  const storageKey = getExecutionStrategyStorageKey(workspaceId);
  if (!storageKey) {
    return "react";
  }

  return normalizeExecutionStrategy(
    loadPersisted<string | null>(storageKey, "react"),
  );
};

export const loadSessionModelPreference = (
  workspaceId: string | null | undefined,
  sessionId: string,
): SessionModelPreference | null => {
  const key = getSessionModelPreferenceKey(workspaceId, sessionId);
  const parsed = loadPersisted<SessionModelPreference | null>(key, null);
  if (!parsed) {
    return null;
  }
  if (
    typeof parsed.providerType !== "string" ||
    typeof parsed.model !== "string"
  ) {
    return null;
  }
  return parsed;
};

export const resolveWorkspaceAgentPreferences = (
  workspaceId?: string | null,
): AgentPreferences => {
  const { providerKey, modelKey, migratedKey } =
    getAgentPreferenceKeys(workspaceId);

  const scopedProvider = loadPersistedString(providerKey);
  const scopedModel = loadPersistedString(modelKey);
  if (scopedProvider || scopedModel) {
    return {
      providerType: scopedProvider || DEFAULT_AGENT_PROVIDER,
      model: scopedModel || DEFAULT_AGENT_MODEL,
    };
  }

  const migrated = loadPersisted<boolean>(migratedKey, false);
  if (!migrated) {
    const legacyProvider =
      loadPersistedString("agent_pref_provider") ||
      loadPersistedString(GLOBAL_PROVIDER_PREF_KEY);
    const legacyModel =
      loadPersistedString("agent_pref_model") ||
      loadPersistedString(GLOBAL_MODEL_PREF_KEY);

    if (legacyProvider) {
      savePersisted(providerKey, legacyProvider);
    }
    if (legacyModel) {
      savePersisted(modelKey, legacyModel);
    }

    savePersisted(migratedKey, true);

    return {
      providerType: legacyProvider || DEFAULT_AGENT_PROVIDER,
      model: legacyModel || DEFAULT_AGENT_MODEL,
    };
  }

  return {
    providerType: DEFAULT_AGENT_PROVIDER,
    model: DEFAULT_AGENT_MODEL,
  };
};
