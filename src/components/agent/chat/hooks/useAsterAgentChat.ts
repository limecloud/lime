/**
 * Aster Agent Chat Hook
 *
 * 基于 Aster 框架的聊天 hook
 * 接口与 useAgentChat 保持一致，便于切换
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";
import { safeListen } from "@/lib/dev-bridge";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  initAsterAgent,
  sendAsterMessageStream,
  createAsterSession,
  listAsterSessions,
  getAsterSession,
  renameAsterSession,
  deleteAsterSession,
  setAsterSessionExecutionStrategy,
  stopAsterSession,
  confirmAsterAction,
  submitAsterElicitationResponse,
  parseStreamEvent,
  type StreamEvent,
  type ContextTraceStep,
  type AsterSessionInfo,
  type AsterExecutionStrategy,
  type ToolResultImage,
} from "@/lib/api/agent";
import {
  Message,
  MessageImage,
  ContentPart,
  type ActionRequired,
  type ConfirmResponse,
  type Question,
} from "../types";

/** 话题信息 */
export interface Topic {
  id: string;
  title: string;
  createdAt: Date;
  messagesCount: number;
  executionStrategy: AsterExecutionStrategy;
}

/** Hook 配置选项 */
interface UseAsterAgentChatOptions {
  systemPrompt?: string;
  onWriteFile?: (content: string, fileName: string) => void;
  workspaceId: string;
}

const normalizeExecutionStrategy = (
  value?: string | null,
): AsterExecutionStrategy =>
  value === "code_orchestrated" || value === "auto" ? value : "react";

const normalizeActionType = (
  value?: string,
): ActionRequired["actionType"] | null => {
  if (
    value === "tool_confirmation" ||
    value === "ask_user" ||
    value === "elicitation"
  ) {
    return value;
  }
  if (value === "ask") {
    return "ask_user";
  }
  return null;
};

const WORKSPACE_PATH_AUTO_CREATED_WARNING_CODE = "workspace_path_auto_created";

const isWorkspacePathErrorMessage = (message: string): boolean => {
  return (
    message.includes("Workspace 路径不存在") ||
    message.includes("Workspace 路径不是目录") ||
    message.includes("Workspace 路径存在但不是目录") ||
    message.includes("工作区目录缺失") ||
    message.includes("workspace path")
  );
};

const appendActionRequiredToParts = (
  parts: ContentPart[],
  actionRequired: ActionRequired,
): ContentPart[] => {
  const exists = parts.some(
    (part) =>
      part.type === "action_required" &&
      part.actionRequired.requestId === actionRequired.requestId,
  );

  if (exists) {
    return parts;
  }

  return [...parts, { type: "action_required", actionRequired }];
};

const parseJsonObject = (raw?: string): Record<string, unknown> | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
};

const isAskToolName = (toolName: string): boolean => {
  const normalized = toolName.toLowerCase().trim();
  return (
    normalized === "ask" ||
    normalized === "ask_user" ||
    /(^|[_-])ask($|[_-])/.test(normalized)
  );
};

const normalizeAskOptions = (
  value: unknown,
): Array<{ label: string; description?: string }> | undefined => {
  if (!Array.isArray(value)) return undefined;

  const normalized = value
    .map((item) => {
      if (typeof item === "string") {
        const label = item.trim();
        return label ? { label } : null;
      }
      if (item && typeof item === "object") {
        const candidate = item as Record<string, unknown>;
        const label =
          (typeof candidate.label === "string" && candidate.label.trim()) ||
          (typeof candidate.value === "string" && candidate.value.trim()) ||
          "";
        if (!label) return null;
        const description =
          typeof candidate.description === "string"
            ? candidate.description
            : undefined;
        return { label, description };
      }
      return null;
    })
    .filter(
      (item): item is { label: string; description?: string } =>
        item !== null,
    );

  return normalized.length > 0 ? normalized : undefined;
};

const normalizeActionQuestions = (
  value: unknown,
  fallbackQuestion?: string,
): ActionRequired["questions"] | undefined => {
  const toQuestion = (item: unknown): Question | null => {
    if (typeof item === "string") {
      const question = item.trim();
      if (!question) return null;
      return {
        question,
        multiSelect: false,
      };
    }

    if (!item || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    const questionCandidate = [
      record.question,
      record.prompt,
      record.message,
      record.text,
      record.title,
    ].find(
      (candidate): candidate is string =>
        typeof candidate === "string" && candidate.trim().length > 0,
    );

    if (!questionCandidate) return null;

    const options = normalizeAskOptions(
      record.options || record.choices || record.enum,
    );
    const header =
      typeof record.header === "string" ? record.header : undefined;
    const multiSelect =
      record.multiSelect === true || record.multi_select === true;

    return {
      question: questionCandidate.trim(),
      header,
      options,
      multiSelect,
    };
  };

  const normalized = Array.isArray(value)
    ? value
        .map(toQuestion)
        .filter((item): item is Question => item !== null)
    : [];

  if (normalized.length > 0) return normalized;

  if (typeof fallbackQuestion === "string" && fallbackQuestion.trim()) {
    return [
      {
        question: fallbackQuestion.trim(),
        multiSelect: false,
      },
    ];
  }

  return undefined;
};

const resolveAskQuestionText = (
  args: Record<string, unknown>,
): string | undefined => {
  const candidates = [
    args.question,
    args.prompt,
    args.message,
    args.text,
    args.query,
    args.title,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const value = candidate.trim();
      if (value) return value;
    }
  }

  return undefined;
};

const resolveAskRequestId = (
  args: Record<string, unknown> | null,
): string | undefined => {
  if (!args) return undefined;

  const directCandidates = [
    args.request_id,
    args.requestId,
    args.action_request_id,
    args.actionRequestId,
    args.action_id,
    args.actionId,
    args.elicitation_id,
    args.elicitationId,
    args.id,
  ];

  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  const nestedData =
    args.data && typeof args.data === "object"
      ? (args.data as Record<string, unknown>)
      : undefined;

  if (nestedData) {
    const nestedCandidates = [
      nestedData.request_id,
      nestedData.requestId,
      nestedData.id,
      nestedData.action_id,
      nestedData.actionId,
    ];
    for (const candidate of nestedCandidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }
  }

  return undefined;
};

const resolveHistoryUserDataText = (userData: unknown): string | undefined => {
  if (typeof userData === "string") {
    const value = userData.trim();
    return value || undefined;
  }

  if (userData && typeof userData === "object") {
    const record = userData as Record<string, unknown>;
    const answer = record.answer;
    if (typeof answer === "string" && answer.trim()) {
      return answer.trim();
    }
    const other = record.other;
    if (typeof other === "string" && other.trim()) {
      return other.trim();
    }
    try {
      const serialized = JSON.stringify(record);
      return serialized === "{}" ? undefined : serialized;
    } catch {
      return undefined;
    }
  }

  if (userData === null || userData === undefined) return undefined;
  return String(userData);
};

const stringifyToolArguments = (argumentsValue: unknown): string | undefined => {
  if (argumentsValue === null || argumentsValue === undefined) return undefined;
  if (typeof argumentsValue === "string") {
    const value = argumentsValue.trim();
    return value || undefined;
  }
  try {
    return JSON.stringify(argumentsValue);
  } catch {
    return undefined;
  }
};

const parseDataUrlToHistoryImage = (rawUrl: string): MessageImage | null => {
  const normalized = rawUrl.trim();
  if (!normalized.startsWith("data:")) return null;

  const commaIndex = normalized.indexOf(",");
  if (commaIndex <= 5) return null;

  const meta = normalized.slice(5, commaIndex);
  const payload = normalized.slice(commaIndex + 1).trim();
  if (!payload) return null;

  const metaSegments = meta.split(";").map((segment) => segment.trim());
  const mediaType = metaSegments[0] || "image/png";
  const hasBase64 = metaSegments.some(
    (segment) => segment.toLowerCase() === "base64",
  );
  if (!hasBase64) return null;

  return {
    mediaType,
    data: payload,
  };
};

const normalizeHistoryImagePart = (
  rawPart: Record<string, unknown>,
): MessageImage | null => {
  if (typeof rawPart.data === "string" && rawPart.data.trim()) {
    const mediaType =
      (typeof rawPart.mime_type === "string" && rawPart.mime_type.trim()) ||
      (typeof rawPart.media_type === "string" && rawPart.media_type.trim()) ||
      "image/png";
    return {
      mediaType,
      data: rawPart.data.trim(),
    };
  }

  const imageUrlValue = rawPart.image_url ?? rawPart.url;
  if (typeof imageUrlValue === "string") {
    return parseDataUrlToHistoryImage(imageUrlValue);
  }

  if (imageUrlValue && typeof imageUrlValue === "object") {
    const imageUrlRecord = imageUrlValue as Record<string, unknown>;
    const nestedUrl =
      (typeof imageUrlRecord.url === "string" && imageUrlRecord.url) ||
      (typeof imageUrlRecord.image_url === "string" &&
        imageUrlRecord.image_url) ||
      "";
    if (nestedUrl) {
      return parseDataUrlToHistoryImage(nestedUrl);
    }
  }

  return null;
};

const parseMimeTypeFromDataUrl = (rawUrl: string): string | undefined => {
  const normalized = rawUrl.trim();
  if (!normalized.startsWith("data:image/")) return undefined;
  const commaIndex = normalized.indexOf(",");
  if (commaIndex <= 5) return undefined;
  const meta = normalized.slice(5, commaIndex);
  const mimeType = meta.split(";")[0]?.trim();
  if (!mimeType || !mimeType.startsWith("image/")) return undefined;
  return mimeType;
};

const extractDataImageUrlsFromText = (text: string): string[] => {
  if (!text.trim()) return [];
  const pattern = /data:image\/[\w.+-]+;base64,[A-Za-z0-9+/=]+/g;
  const matches = text.match(pattern);
  if (!matches) return [];
  const deduped = new Set<string>();
  for (const match of matches) {
    const value = match.trim();
    if (value) deduped.add(value);
  }
  return Array.from(deduped);
};

const normalizeToolResultImages = (
  value: unknown,
  fallbackText?: string,
): ToolResultImage[] | undefined => {
  const normalized: ToolResultImage[] = [];
  const seen = new Set<string>();

  const appendImage = (
    rawSrc: string,
    mimeType?: string,
    origin?: ToolResultImage["origin"],
  ) => {
    const src = rawSrc.trim();
    if (!src || seen.has(src)) return;
    seen.add(src);
    normalized.push({ src, mimeType, origin });
  };

  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string") {
        appendImage(item, parseMimeTypeFromDataUrl(item), "data_url");
        continue;
      }
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const src = typeof record.src === "string" ? record.src : "";
      if (!src.trim()) continue;
      const mimeType =
        (typeof record.mimeType === "string" && record.mimeType) ||
        (typeof record.mime_type === "string" && record.mime_type) ||
        parseMimeTypeFromDataUrl(src);
      const origin =
        record.origin === "data_url" ||
        record.origin === "tool_payload" ||
        record.origin === "file_path"
          ? record.origin
          : undefined;
      appendImage(src, mimeType, origin);
    }
  }

  if (normalized.length === 0 && typeof fallbackText === "string") {
    for (const dataUrl of extractDataImageUrlsFromText(fallbackText)) {
      appendImage(dataUrl, parseMimeTypeFromDataUrl(dataUrl), "data_url");
    }
  }

  return normalized.length > 0 ? normalized : undefined;
};

const normalizeHistoryPartType = (value: unknown): string => {
  if (typeof value !== "string") return "";
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
};

const normalizeHistoryMessage = (message: Message): Message | null => {
  if (message.role !== "user") return message;

  const text = message.content.trim();
  const hasImages = Array.isArray(message.images) && message.images.length > 0;
  if (text.length > 0 || hasImages) return message;

  const hasToolCalls =
    Array.isArray(message.toolCalls) && message.toolCalls.length > 0;
  const hasOnlyToolUseParts =
    Array.isArray(message.contentParts) &&
    message.contentParts.length > 0 &&
    message.contentParts.every((part) => part.type === "tool_use");

  // 历史里偶发 role=user 的工具协议记录：不展示成 user 空白气泡，
  // 改为 assistant 轨迹，保留工具执行历史。
  if (hasToolCalls || hasOnlyToolUseParts) {
    return {
      ...message,
      role: "assistant",
    };
  }

  return null;
};

const normalizeHistoryMessages = (messages: Message[]): Message[] =>
  messages
    .map((msg) => normalizeHistoryMessage(msg))
    .filter((msg): msg is Message => msg !== null);

const hasLegacyFallbackToolNames = (messages: Message[]): boolean =>
  messages.some((message) =>
    (message.toolCalls || []).some((toolCall) =>
      /^工具调用\s+call_[0-9a-z]+$/i.test(toolCall.name.trim()),
    ),
  );

const resolveHistoryToolName = (
  toolId: string,
  nameById: Map<string, string>,
): string => {
  const existing = nameById.get(toolId);
  if (existing && existing.trim()) {
    return existing.trim();
  }
  const shortId = toolId.trim().slice(0, 8);
  return shortId ? `工具调用 ${shortId}` : "工具调用";
};

const mergeAdjacentAssistantMessages = (messages: Message[]): Message[] => {
  const merged: Message[] = [];

  for (const current of messages) {
    if (merged.length === 0) {
      merged.push(current);
      continue;
    }

    const previous = merged[merged.length - 1];
    if (!previous || previous.role !== "assistant" || current.role !== "assistant") {
      merged.push(current);
      continue;
    }

    const content = [previous.content.trim(), current.content.trim()]
      .filter(Boolean)
      .join("\n\n");
    const contentParts = (() => {
      const nextParts: ContentPart[] = [...(previous.contentParts || [])];
      for (const part of current.contentParts || []) {
        if (part.type === "tool_use") {
          const existingIndex = nextParts.findIndex(
            (item) =>
              item.type === "tool_use" &&
              item.toolCall.id === part.toolCall.id,
          );
          if (existingIndex >= 0) {
            // 同一工具调用在历史里会先有 running，再有 completed/failed。
            // 这里保留同一位置并覆盖为最新状态，避免渲染重复条目。
            nextParts[existingIndex] = part;
            continue;
          }
          nextParts.push(part);
          continue;
        }

        if (part.type === "action_required") {
          const existingIndex = nextParts.findIndex(
            (item) =>
              item.type === "action_required" &&
              item.actionRequired.requestId === part.actionRequired.requestId,
          );
          if (existingIndex >= 0) {
            nextParts[existingIndex] = part;
            continue;
          }
          nextParts.push(part);
          continue;
        }

        nextParts.push(part);
      }
      return nextParts;
    })();
    const toolCallMap = new Map<string, NonNullable<Message["toolCalls"]>[number]>();
    for (const toolCall of [...(previous.toolCalls || []), ...(current.toolCalls || [])]) {
      toolCallMap.set(toolCall.id, toolCall);
    }
    const toolCalls = Array.from(toolCallMap.values());
    const contextTrace = (() => {
      const seen = new Set<string>();
      const mergedSteps: ContextTraceStep[] = [];
      for (const step of [...(previous.contextTrace || []), ...(current.contextTrace || [])]) {
        const key = `${step.stage}::${step.detail}`;
        if (!seen.has(key)) {
          seen.add(key);
          mergedSteps.push(step);
        }
      }
      return mergedSteps;
    })();

    merged[merged.length - 1] = {
      ...previous,
      content,
      contentParts: contentParts.length > 0 ? contentParts : undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      contextTrace: contextTrace.length > 0 ? contextTrace : undefined,
      timestamp: current.timestamp,
      isThinking: false,
      thinkingContent: undefined,
    };
  }

  return merged;
};

const resolveActionPromptKey = (action: ActionRequired): string | null => {
  if (typeof action.prompt === "string" && action.prompt.trim()) {
    return action.prompt.trim();
  }

  if (action.questions && action.questions.length > 0) {
    const question = action.questions[0]?.question;
    if (typeof question === "string" && question.trim()) {
      return question.trim();
    }
  }

  const schema = action.requestedSchema as Record<string, unknown> | undefined;
  const properties =
    schema?.properties && typeof schema.properties === "object"
      ? (schema.properties as Record<string, unknown>)
      : undefined;
  const answer =
    properties?.answer && typeof properties.answer === "object"
      ? (properties.answer as Record<string, unknown>)
      : undefined;
  const description = answer?.description;
  if (typeof description === "string" && description.trim()) {
    return description.trim();
  }

  return null;
};

// 音效相关（复用）
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
  return localStorage.getItem("proxycast_sound_enabled") === "true";
};

const playToolcallSound = () => {
  if (!getSoundEnabled()) return;
  initAudio();
  if (toolcallAudio) {
    toolcallAudio.currentTime = 0;
    toolcallAudio.play().catch(console.error);
  }
};

const playTypewriterSound = () => {
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

// 持久化 helpers
const loadPersisted = <T>(key: string, defaultValue: T): T => {
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

const savePersisted = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error(e);
  }
};

const loadTransient = <T>(key: string, defaultValue: T): T => {
  try {
    const stored = sessionStorage.getItem(key);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (key.startsWith("aster_messages") && Array.isArray(parsed)) {
        const normalizedMessages = parsed
          .map((msg: any) => ({
            ...msg,
            timestamp: new Date(msg.timestamp),
          })) as Message[];
        const normalized = normalizeHistoryMessages(normalizedMessages);
        // 清理旧版本历史缓存中的 fallback 工具名，触发回源重建真实工具名称。
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

const saveTransient = (key: string, value: unknown) => {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error(e);
  }
};

const DEFAULT_AGENT_PROVIDER = "claude";
const DEFAULT_AGENT_MODEL = "claude-sonnet-4-5";
const GLOBAL_PROVIDER_PREF_KEY = "agent_pref_provider_global";
const GLOBAL_MODEL_PREF_KEY = "agent_pref_model_global";
const GLOBAL_MIGRATED_PREF_KEY = "agent_pref_migrated_global";

const loadPersistedString = (key: string): string | null => {
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

interface AgentPreferences {
  providerType: string;
  model: string;
}

interface AgentPreferenceKeys {
  providerKey: string;
  modelKey: string;
  migratedKey: string;
}

interface SessionModelPreference {
  providerType: string;
  model: string;
}

const getAgentPreferenceKeys = (
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

const getSessionModelPreferenceKey = (
  workspaceId: string | null | undefined,
  sessionId: string,
): string => {
  const resolvedWorkspaceId = workspaceId?.trim();
  if (!resolvedWorkspaceId) {
    return `agent_topic_model_pref_global_${sessionId}`;
  }
  return `agent_topic_model_pref_${resolvedWorkspaceId}_${sessionId}`;
};

const loadSessionModelPreference = (
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

const resolveWorkspaceAgentPreferences = (
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

/**
 * 将前端 Provider 类型映射到 Aster Provider 名称
 */
const mapProviderName = (providerType: string): string => {
  const mapping: Record<string, string> = {
    // OpenAI 兼容
    openai: "openai",
    "gpt-4": "openai",
    "gpt-4o": "openai",
    // Anthropic
    claude: "anthropic",
    anthropic: "anthropic",
    // Google
    google: "google",
    gemini: "google",
    // DeepSeek（OpenAI 兼容）
    deepseek: "deepseek",
    "deepseek-reasoner": "deepseek",
    // Ollama
    ollama: "ollama",
    // OpenRouter
    openrouter: "openrouter",
    // 其他（OpenAI 兼容）
    groq: "openai",
    mistral: "openai",
  };
  return mapping[providerType.toLowerCase()] || providerType;
};

const mapSessionToTopic = (session: AsterSessionInfo): Topic => ({
  id: session.id,
  title:
    session.name ||
    `话题 ${new Date(session.created_at * 1000).toLocaleDateString("zh-CN")}`,
  createdAt: new Date(session.created_at * 1000),
  messagesCount: session.messages_count ?? 0,
  executionStrategy: normalizeExecutionStrategy(session.execution_strategy),
});

export function useAsterAgentChat(options: UseAsterAgentChatOptions) {
  const { onWriteFile, workspaceId } = options;

  const getRequiredWorkspaceId = useCallback((): string => {
    const resolvedWorkspaceId = workspaceId?.trim();
    if (!resolvedWorkspaceId) {
      throw new Error("缺少项目工作区，请先选择项目后再使用 Agent");
    }
    return resolvedWorkspaceId;
  }, [workspaceId]);

  const getScopedKey = useCallback(
    (key: string): string => {
      const resolvedWorkspaceId = workspaceId?.trim();
      return resolvedWorkspaceId
        ? `${key}_${resolvedWorkspaceId}`
        : `${key}_global`;
    },
    [workspaceId],
  );

  const getScopedSessionKey = useCallback(
    () => getScopedKey("aster_curr_sessionId"),
    [getScopedKey],
  );
  const getScopedMessagesKey = useCallback(
    () => getScopedKey("aster_messages"),
    [getScopedKey],
  );
  const getScopedPersistedSessionKey = useCallback(
    () => getScopedKey("aster_last_sessionId"),
    [getScopedKey],
  );

  // 状态
  const [isInitialized, setIsInitialized] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(() => {
    if (!workspaceId?.trim()) {
      return null;
    }

    const scopedSessionId = loadTransient<string | null>(
      `aster_curr_sessionId_${workspaceId.trim()}`,
      null,
    );
    if (scopedSessionId) {
      return scopedSessionId;
    }

    return loadPersisted<string | null>(
      `aster_last_sessionId_${workspaceId.trim()}`,
      null,
    );
  });
  const [messages, setMessages] = useState<Message[]>(() =>
    workspaceId?.trim()
      ? loadTransient<Message[]>(`aster_messages_${workspaceId.trim()}`, [])
      : [],
  );

  // 兜底清理：防止旧状态中遗留空白 user 消息导致历史出现空白气泡
  useEffect(() => {
    setMessages((prev) => {
      const normalized = normalizeHistoryMessages(prev);
      return normalized.length === prev.length ? prev : normalized;
    });
  }, [sessionId, workspaceId]);

  const [topics, setTopics] = useState<Topic[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [pendingActions, setPendingActions] = useState<ActionRequired[]>([]);
  const [workspacePathMissing, setWorkspacePathMissing] = useState<{
    content: string;
    images: MessageImage[];
  } | null>(null);

  const initialPreferencesRef = useRef<AgentPreferences>(
    resolveWorkspaceAgentPreferences(workspaceId),
  );

  // Provider/Model（按工作区保存）
  const [providerType, setProviderTypeState] = useState(
    () => initialPreferencesRef.current.providerType,
  );
  const [model, setModelState] = useState(
    () => initialPreferencesRef.current.model,
  );
  const [executionStrategy, setExecutionStrategyState] =
    useState<AsterExecutionStrategy>(() => {
      const resolvedWorkspaceId = workspaceId?.trim();
      if (!resolvedWorkspaceId) {
        return "react";
      }
      return normalizeExecutionStrategy(
        loadPersisted<string | null>(
          `aster_execution_strategy_${resolvedWorkspaceId}`,
          "react",
        ),
      );
    });

  // Refs
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const currentAssistantMsgIdRef = useRef<string | null>(null);
  const currentStreamingSessionIdRef = useRef<string | null>(null);
  const warnedKeysRef = useRef<Set<string>>(new Set());
  const restoredWorkspaceRef = useRef<string | null>(null);
  const hydratedSessionRef = useRef<string | null>(null);
  const skipAutoRestoreRef = useRef(false);
  const sessionIdRef = useRef<string | null>(sessionId);
  const providerTypeRef = useRef(providerType);
  const modelRef = useRef(model);
  const scopedProviderPrefKeyRef = useRef<string>(
    getAgentPreferenceKeys(workspaceId).providerKey,
  );
  const scopedModelPrefKeyRef = useRef<string>(
    getAgentPreferenceKeys(workspaceId).modelKey,
  );

  sessionIdRef.current = sessionId;
  providerTypeRef.current = providerType;
  modelRef.current = model;

  const persistSessionModelPreference = useCallback(
    (targetSessionId: string, targetProviderType: string, targetModel: string) => {
      savePersisted(getSessionModelPreferenceKey(workspaceId, targetSessionId), {
        providerType: targetProviderType,
        model: targetModel,
      });
    },
    [workspaceId],
  );

  const filterSessionsByWorkspace = useCallback(
    (sessions: AsterSessionInfo[]): AsterSessionInfo[] => {
      const resolvedWorkspaceId = workspaceId?.trim();
      if (!resolvedWorkspaceId) {
        return [];
      }

      return sessions.filter((session) => {
        const mappedWorkspaceId = loadPersistedString(
          `agent_session_workspace_${session.id}`,
        );

        if (!mappedWorkspaceId || mappedWorkspaceId === "__invalid__") {
          // 兼容历史会话：未写入映射时暂归入当前工作区，避免会话“消失”。
          return true;
        }

        return mappedWorkspaceId === resolvedWorkspaceId;
      });
    },
    [workspaceId],
  );

  const setProviderType = useCallback(
    (nextProviderType: string) => {
      providerTypeRef.current = nextProviderType;
      setProviderTypeState(nextProviderType);
      savePersisted(scopedProviderPrefKeyRef.current, nextProviderType);

      const currentSessionId = sessionIdRef.current;
      if (currentSessionId) {
        persistSessionModelPreference(
          currentSessionId,
          nextProviderType,
          modelRef.current,
        );
      }
    },
    [persistSessionModelPreference],
  );

  const setModel = useCallback(
    (nextModel: string) => {
      modelRef.current = nextModel;
      setModelState(nextModel);
      savePersisted(scopedModelPrefKeyRef.current, nextModel);

      const currentSessionId = sessionIdRef.current;
      if (currentSessionId) {
        persistSessionModelPreference(
          currentSessionId,
          providerTypeRef.current,
          nextModel,
        );
      }
    },
    [persistSessionModelPreference],
  );

  // workspace 变化时恢复 Provider/Model 偏好
  useEffect(() => {
    const { providerKey, modelKey } = getAgentPreferenceKeys(workspaceId);
    warnedKeysRef.current.clear();

    scopedProviderPrefKeyRef.current = providerKey;
    scopedModelPrefKeyRef.current = modelKey;

    const scopedPreferences = resolveWorkspaceAgentPreferences(workspaceId);
    setProviderTypeState(scopedPreferences.providerType);
    setModelState(scopedPreferences.model);

    savePersisted(providerKey, scopedPreferences.providerType);
    savePersisted(modelKey, scopedPreferences.model);

    const resolvedWorkspaceId = workspaceId?.trim();
    if (!resolvedWorkspaceId) {
      setExecutionStrategyState("react");
      return;
    }
    const persistedStrategy = loadPersisted<string | null>(
      `aster_execution_strategy_${resolvedWorkspaceId}`,
      "react",
    );
    setExecutionStrategyState(normalizeExecutionStrategy(persistedStrategy));
  }, [workspaceId]);

  // 持久化 provider/model（仅写当前工作区）
  useEffect(() => {
    savePersisted(scopedProviderPrefKeyRef.current, providerType);
  }, [providerType]);

  useEffect(() => {
    savePersisted(scopedModelPrefKeyRef.current, model);
  }, [model]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    savePersisted(getSessionModelPreferenceKey(workspaceId, sessionId), {
      providerType,
      model,
    });
  }, [model, providerType, sessionId, workspaceId]);

  useEffect(() => {
    const resolvedWorkspaceId = workspaceId?.trim();
    if (!resolvedWorkspaceId) {
      return;
    }
    savePersisted(
      `aster_execution_strategy_${resolvedWorkspaceId}`,
      executionStrategy,
    );
  }, [executionStrategy, workspaceId]);

  const setExecutionStrategy = useCallback(
    (nextStrategy: AsterExecutionStrategy) => {
      const normalized = normalizeExecutionStrategy(nextStrategy);
      setExecutionStrategyState(normalized);

      if (!sessionId) {
        return;
      }

      setAsterSessionExecutionStrategy(sessionId, normalized)
        .then(() => {
          setTopics((prev) =>
            prev.map((topic) =>
              topic.id === sessionId
                ? { ...topic, executionStrategy: normalized }
                : topic,
            ),
          );
        })
        .catch((error) => {
          console.warn("[AsterChat] 更新会话执行策略失败:", error);
        });
    },
    [sessionId],
  );

  useEffect(() => {
    const resolvedWorkspaceId = workspaceId?.trim();
    if (!resolvedWorkspaceId) {
      return;
    }

    const scopedSessionKey = getScopedSessionKey();
    const scopedPersistedSessionKey = getScopedPersistedSessionKey();

    saveTransient(scopedSessionKey, sessionId);
    savePersisted(scopedPersistedSessionKey, sessionId);

    if (sessionId) {
      const sessionWorkspaceKey = `agent_session_workspace_${sessionId}`;
      const existingWorkspaceId = loadPersistedString(sessionWorkspaceKey);

      if (
        existingWorkspaceId &&
        existingWorkspaceId !== "__invalid__" &&
        existingWorkspaceId !== resolvedWorkspaceId
      ) {
        console.warn("[AsterChat] 检测到会话与工作区映射冲突，跳过覆盖", {
          sessionId,
          existingWorkspaceId,
          currentWorkspaceId: resolvedWorkspaceId,
        });
      } else {
        savePersisted(sessionWorkspaceKey, resolvedWorkspaceId);
      }
    }
  }, [
    getScopedPersistedSessionKey,
    getScopedSessionKey,
    sessionId,
    workspaceId,
  ]);

  useEffect(() => {
    if (!workspaceId?.trim()) {
      return;
    }
    saveTransient(getScopedMessagesKey(), messages);
  }, [getScopedMessagesKey, messages, workspaceId]);

  // workspace 变化时恢复对应会话状态
  useEffect(() => {
    if (!workspaceId?.trim()) {
      setSessionId(null);
      setMessages([]);
      setPendingActions([]);
      currentAssistantMsgIdRef.current = null;
      currentStreamingSessionIdRef.current = null;
      restoredWorkspaceRef.current = null;
      hydratedSessionRef.current = null;
      skipAutoRestoreRef.current = false;
      return;
    }

    const scopedSessionId =
      loadTransient<string | null>(getScopedSessionKey(), null) ??
      loadPersisted<string | null>(getScopedPersistedSessionKey(), null);

    const scopedMessages = loadTransient<Message[]>(getScopedMessagesKey(), []);

    setSessionId(scopedSessionId);
    setMessages(scopedMessages);
    setPendingActions([]);
    currentAssistantMsgIdRef.current = null;
    currentStreamingSessionIdRef.current = null;
    restoredWorkspaceRef.current = null;
    hydratedSessionRef.current = null;
    skipAutoRestoreRef.current = false;
  }, [
    getScopedMessagesKey,
    getScopedPersistedSessionKey,
    getScopedSessionKey,
    workspaceId,
  ]);

  // 初始化 Aster Agent
  useEffect(() => {
    const init = async () => {
      try {
        await initAsterAgent();
        setIsInitialized(true);
        console.log("[AsterChat] Agent 初始化成功");
      } catch (err) {
        console.error("[AsterChat] 初始化失败:", err);
      }
    };
    init();
  }, []);

  useEffect(() => {
    if (!isInitialized) {
      return;
    }

    if (!workspaceId?.trim()) {
      setTopics([]);
      return;
    }

    listAsterSessions()
      .then((sessions) => {
        const topicList = filterSessionsByWorkspace(sessions).map(mapSessionToTopic);
        setTopics(topicList);
      })
      .catch((error) => {
        console.error("[AsterChat] 加载话题失败:", error);
      });
  }, [filterSessionsByWorkspace, isInitialized, workspaceId]);

  // 加载话题列表
  const loadTopics = useCallback(async () => {
    if (!workspaceId?.trim()) {
      setTopics([]);
      return;
    }

    try {
      const sessions = await listAsterSessions();
      const topicList = filterSessionsByWorkspace(sessions).map(mapSessionToTopic);
      setTopics(topicList);
    } catch (error) {
      console.error("[AsterChat] 加载话题失败:", error);
    }
  }, [filterSessionsByWorkspace, workspaceId]);

  // 确保有会话
  const ensureSession = useCallback(async (): Promise<string | null> => {
    if (sessionId) return sessionId;

    try {
      const resolvedWorkspaceId = getRequiredWorkspaceId();
      const newSessionId = await createAsterSession(
        resolvedWorkspaceId,
        undefined,
        undefined,
        executionStrategy,
      );
      setSessionId(newSessionId);
      skipAutoRestoreRef.current = false;
      return newSessionId;
    } catch (error) {
      console.error("[AsterChat] 创建会话失败:", error);
      toast.error(`创建会话失败: ${error}`);
      return null;
    }
  }, [executionStrategy, getRequiredWorkspaceId, sessionId]);

  // 辅助函数：追加文本到 contentParts
  const appendTextToParts = (
    parts: ContentPart[],
    text: string,
  ): ContentPart[] => {
    const newParts = [...parts];
    const lastPart = newParts[newParts.length - 1];

    if (lastPart && lastPart.type === "text") {
      newParts[newParts.length - 1] = {
        type: "text",
        text: lastPart.text + text,
      };
    } else {
      newParts.push({ type: "text", text });
    }
    return newParts;
  };

  // 发送消息
  const sendMessage = useCallback(
    async (
      content: string,
      images: MessageImage[],
      _webSearch?: boolean,
      _thinking?: boolean,
      skipUserMessage = false,
      executionStrategyOverride?: AsterExecutionStrategy,
    ) => {
      const effectiveExecutionStrategy =
        executionStrategyOverride || executionStrategy;
      // 助手消息占位符
      const assistantMsgId = crypto.randomUUID();
      const assistantMsg: Message = {
        id: assistantMsgId,
        role: "assistant",
        content: "",
        timestamp: new Date(),
        isThinking: true,
        thinkingContent: "思考中...",
        contentParts: [],
      };

      if (skipUserMessage) {
        setMessages((prev) => [...prev, assistantMsg]);
      } else {
        // 用户消息
        const userMsg: Message = {
          id: crypto.randomUUID(),
          role: "user",
          content,
          images: images.length > 0 ? images : undefined,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, userMsg, assistantMsg]);
      }
      setIsSending(true);
      currentAssistantMsgIdRef.current = assistantMsgId;

      let accumulatedContent = "";
      let unlisten: UnlistenFn | null = null;

      try {
        const activeSessionId = await ensureSession();
        if (!activeSessionId) throw new Error("无法创建会话");
        currentStreamingSessionIdRef.current = activeSessionId;

        const eventName = `aster_stream_${assistantMsgId}`;

        const upsertActionRequest = (
          actionData: ActionRequired,
          options?: { replaceByPrompt?: boolean },
        ) => {
          const replaceByPrompt = options?.replaceByPrompt ?? false;
          const promptKey = replaceByPrompt
            ? resolveActionPromptKey(actionData)
            : null;

          setPendingActions((prev) => {
            let next = [...prev];

            if (replaceByPrompt && promptKey) {
              next = next.filter((item) => {
                const itemKey = resolveActionPromptKey(item);
                return !(
                  item.requestId !== actionData.requestId &&
                  itemKey &&
                  itemKey === promptKey
                );
              });
            }

            if (next.some((item) => item.requestId === actionData.requestId)) {
              return next;
            }

            return [...next, actionData];
          });

          setMessages((prev) =>
            prev.map((msg) => {
              if (msg.id !== assistantMsgId) return msg;

              let nextRequests = [...(msg.actionRequests || [])];
              let nextParts = [...(msg.contentParts || [])];

              if (replaceByPrompt && promptKey) {
                nextRequests = nextRequests.filter((item) => {
                  const itemKey = resolveActionPromptKey(item);
                  return !(
                    item.requestId !== actionData.requestId &&
                    itemKey &&
                    itemKey === promptKey
                  );
                });
                nextParts = nextParts.filter(
                  (part) =>
                    !(
                      part.type === "action_required" &&
                      part.actionRequired.requestId !== actionData.requestId &&
                      resolveActionPromptKey(part.actionRequired) === promptKey
                    ),
                );
              }

              if (nextRequests.some((item) => item.requestId === actionData.requestId)) {
                return msg;
              }

              nextRequests.push(actionData);
              nextParts = appendActionRequiredToParts(nextParts, actionData);

              return {
                ...msg,
                actionRequests: nextRequests,
                contentParts: nextParts,
              };
            }),
          );
        };

        // 设置事件监听
        unlisten = await safeListen<StreamEvent>(eventName, (event) => {
          const data = parseStreamEvent(event.payload);
          if (!data) return;

          switch (data.type) {
            case "text_delta":
              accumulatedContent += data.text;
              playTypewriterSound();
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMsgId
                    ? {
                        ...msg,
                        content: accumulatedContent,
                        thinkingContent: undefined,
                        contentParts: appendTextToParts(
                          msg.contentParts || [],
                          data.text,
                        ),
                      }
                    : msg,
                ),
              );
              break;

            case "tool_start": {
              playToolcallSound();
              const newToolCall = {
                id: data.tool_id,
                name: data.tool_name,
                arguments: data.arguments,
                status: "running" as const,
                startTime: new Date(),
              };

              const toolArgs = parseJsonObject(data.arguments);

              // 检查是否是写入文件工具
              const toolName = data.tool_name.toLowerCase();
              if (toolName.includes("write") || toolName.includes("create")) {
                if (toolArgs) {
                  const filePath =
                    toolArgs.path || toolArgs.file_path || toolArgs.filePath;
                  const fileContent = toolArgs.content || toolArgs.text || "";
                  if (
                    typeof filePath === "string" &&
                    typeof fileContent === "string" &&
                    filePath &&
                    fileContent &&
                    onWriteFile
                  ) {
                    onWriteFile(fileContent, filePath);
                  }
                }
              }

              setMessages((prev) =>
                prev.map((msg) => {
                  if (msg.id !== assistantMsgId) return msg;
                  if (msg.toolCalls?.find((tc) => tc.id === data.tool_id))
                    return msg;
                  return {
                    ...msg,
                    toolCalls: [...(msg.toolCalls || []), newToolCall],
                    contentParts: [
                      ...(msg.contentParts || []),
                      { type: "tool_use" as const, toolCall: newToolCall },
                    ],
                  };
                }),
              );

              if (isAskToolName(data.tool_name)) {
                const requestIdFromArgs = resolveAskRequestId(toolArgs);
                const question =
                  (toolArgs && resolveAskQuestionText(toolArgs)) ||
                  "请提供继续执行所需信息";
                const options = normalizeAskOptions(
                  toolArgs?.options || toolArgs?.choices || toolArgs?.enum,
                );
                const explicitRequestId = requestIdFromArgs?.trim();
                const normalizedQuestions =
                  normalizeActionQuestions(toolArgs?.questions) ?? [
                    {
                      question,
                      options,
                      multiSelect: false,
                    },
                  ];

                const fallbackAction: ActionRequired = {
                  requestId:
                    explicitRequestId ||
                    `fallback:${data.tool_id || crypto.randomUUID()}`,
                  actionType: "ask_user",
                  prompt: question,
                  isFallback: !explicitRequestId,
                  questions: normalizedQuestions,
                };

                upsertActionRequest(fallbackAction, { replaceByPrompt: true });
              }
              break;
            }

            case "tool_end":
              setMessages((prev) =>
                prev.map((msg) => {
                  if (msg.id !== assistantMsgId) return msg;
                  const normalizedResult = {
                    ...data.result,
                    images: normalizeToolResultImages(
                      data.result?.images,
                      data.result?.output,
                    ),
                  };
                  const updatedToolCalls = (msg.toolCalls || []).map((tc) =>
                    tc.id === data.tool_id
                      ? {
                          ...tc,
                          status: data.result.success
                            ? ("completed" as const)
                            : ("failed" as const),
                          result: normalizedResult,
                          endTime: new Date(),
                        }
                      : tc,
                  );
                  const updatedContentParts = (msg.contentParts || []).map(
                    (part) => {
                      if (
                        part.type === "tool_use" &&
                        part.toolCall.id === data.tool_id
                      ) {
                        return {
                          ...part,
                          toolCall: {
                            ...part.toolCall,
                            status: data.result.success
                              ? ("completed" as const)
                              : ("failed" as const),
                            result: normalizedResult,
                            endTime: new Date(),
                          },
                        };
                      }
                      return part;
                    },
                  );
                  return {
                    ...msg,
                    toolCalls: updatedToolCalls,
                    contentParts: updatedContentParts,
                  };
                }),
              );
              break;

            case "action_required": {
              const actionType = normalizeActionType(data.action_type);
              if (!actionType) {
                console.warn(
                  `[AsterChat] 忽略未知 action_required 类型: ${data.action_type}`,
                );
                break;
              }

              const actionData: ActionRequired = {
                requestId: data.request_id,
                actionType,
                toolName: data.tool_name,
                arguments: data.arguments,
                prompt: data.prompt,
                questions: normalizeActionQuestions(data.questions, data.prompt),
                requestedSchema: data.requested_schema,
                isFallback: false,
              };

              if (
                effectiveExecutionStrategy === "auto" &&
                actionData.actionType === "tool_confirmation"
              ) {
                void confirmAsterAction(
                  actionData.requestId,
                  true,
                  "Auto 模式自动确认",
                ).catch((error) => {
                  console.error("[AsterChat] Auto 模式自动确认失败:", error);
                  upsertActionRequest(actionData);
                  toast.error("Auto 模式自动确认失败，请手动确认");
                });
                break;
              }

              upsertActionRequest(actionData, {
                replaceByPrompt:
                  actionData.actionType === "ask_user" ||
                  actionData.actionType === "elicitation",
              });
              break;
            }

            case "context_trace":
              if (!Array.isArray(data.steps) || data.steps.length === 0) {
                break;
              }

              setMessages((prev) =>
                prev.map((msg) => {
                  if (msg.id !== assistantMsgId) return msg;

                  const seen = new Set(
                    (msg.contextTrace || []).map(
                      (step) => `${step.stage}::${step.detail}`,
                    ),
                  );
                  const nextSteps = [...(msg.contextTrace || [])];

                  for (const step of data.steps) {
                    const key = `${step.stage}::${step.detail}`;
                    if (!seen.has(key)) {
                      seen.add(key);
                      nextSteps.push(step);
                    }
                  }

                  return {
                    ...msg,
                    contextTrace: nextSteps,
                  };
                }),
              );
              break;

            case "final_done":
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMsgId
                    ? {
                        ...msg,
                        isThinking: false,
                        content: accumulatedContent || "(无响应)",
                      }
                    : msg,
                ),
              );
              setIsSending(false);
              unlistenRef.current = null;
              currentAssistantMsgIdRef.current = null;
              currentStreamingSessionIdRef.current = null;
              if (unlisten) {
                unlisten();
                unlisten = null;
              }
              break;

            case "error":
              if (data.message.includes("429") || data.message.toLowerCase().includes("rate limit")) {
                toast.warning("请求过于频繁，请稍后重试");
              } else {
                toast.error(`响应错误: ${data.message}`);
              }
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMsgId
                    ? {
                        ...msg,
                        isThinking: false,
                        content: accumulatedContent || `错误: ${data.message}`,
                      }
                    : msg,
                ),
              );
              setIsSending(false);
              currentStreamingSessionIdRef.current = null;
              if (unlisten) {
                unlisten();
                unlisten = null;
              }
              break;

            case "warning": {
              if (data.code === WORKSPACE_PATH_AUTO_CREATED_WARNING_CODE) {
                break;
              }
              const warningKey = `${activeSessionId}:${data.code || data.message}`;
              if (!warnedKeysRef.current.has(warningKey)) {
                warnedKeysRef.current.add(warningKey);
                toast.warning(data.message);
              }
              break;
            }
            default:
              break;
          }
        });

        unlistenRef.current = unlisten;

        // 发送请求
        const imagesToSend =
          images.length > 0
            ? images.map((img) => ({
                data: img.data,
                media_type: img.mediaType,
              }))
            : undefined;

        // 构建 Provider 配置
        const providerConfig = {
          provider_name: mapProviderName(providerType),
          model_name: model,
        };

        const resolvedWorkspaceId = getRequiredWorkspaceId();

        await sendAsterMessageStream(
          content,
          activeSessionId,
          eventName,
          resolvedWorkspaceId,
          imagesToSend,
          providerConfig,
          effectiveExecutionStrategy,
        );
      } catch (error) {
        console.error("[AsterChat] 发送失败:", error);
        const errMsg =
          error instanceof Error ? error.message : String(error);
        if (errMsg.includes("429") || errMsg.toLowerCase().includes("rate limit")) {
          toast.warning("请求过于频繁，请稍后重试");
        } else if (isWorkspacePathErrorMessage(errMsg)) {
          setWorkspacePathMissing({ content, images });
        } else {
          toast.error(`发送失败: ${error}`);
        }
        setMessages((prev) => prev.filter((msg) => msg.id !== assistantMsgId));
        setIsSending(false);
        currentStreamingSessionIdRef.current = null;
        if (unlisten) unlisten();
      }
    },
    [
      ensureSession,
      executionStrategy,
      getRequiredWorkspaceId,
      onWriteFile,
      providerType,
      model,
    ],
  );

  // 停止发送
  const stopSending = useCallback(async () => {
    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }

    const activeSessionId = currentStreamingSessionIdRef.current || sessionId;
    if (activeSessionId) {
      try {
        await stopAsterSession(activeSessionId);
      } catch (e) {
        console.error("[AsterChat] 停止失败:", e);
      }
    }

    if (currentAssistantMsgIdRef.current) {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === currentAssistantMsgIdRef.current
            ? { ...msg, isThinking: false, content: msg.content || "(已停止)" }
            : msg,
        ),
      );
      currentAssistantMsgIdRef.current = null;
    }

    currentStreamingSessionIdRef.current = null;
    setIsSending(false);
    toast.info("已停止生成");
  }, [sessionId]);

  // 修复 workspace 路径并重试
  const fixWorkspacePathAndRetry = useCallback(
    async (newPath: string) => {
      if (!workspacePathMissing) return;
      const { content: retryContent, images: retryImages } = workspacePathMissing;
      setWorkspacePathMissing(null);
      try {
        await invoke("workspace_update", {
          id: workspaceId,
          request: { rootPath: newPath },
        });
        await sendMessage(retryContent, retryImages, false, false, true);
      } catch (err) {
        toast.error(
          `修复路径失败: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    [workspaceId, workspacePathMissing, sendMessage],
  );

  const dismissWorkspacePathError = useCallback(() => {
    setWorkspacePathMissing(null);
  }, []);

  // 确认权限请求
  const confirmAction = useCallback(
    async (response: ConfirmResponse) => {
      try {
        const pendingAction = pendingActions.find(
          (item) => item.requestId === response.requestId,
        );
        const actionType =
          response.actionType ||
          pendingAction?.actionType;
        const normalizedResponse =
          typeof response.response === "string" ? response.response.trim() : "";
        let submittedUserData: unknown = response.userData;
        let effectiveRequestId = response.requestId;
        const acknowledgedRequestIds = new Set<string>([response.requestId]);

        if (actionType === "elicitation" || actionType === "ask_user") {
          const activeSessionId =
            currentStreamingSessionIdRef.current || sessionId;
          if (!activeSessionId) {
            throw new Error("缺少会话 ID，无法提交 elicitation 响应");
          }

          let userData: unknown;
          if (!response.confirmed) {
            userData = "";
          } else if (response.userData !== undefined) {
            userData = response.userData;
          } else if (response.response !== undefined) {
            const rawResponse = response.response.trim();
            if (!rawResponse) {
              userData = "";
            } else {
              try {
                userData = JSON.parse(rawResponse);
              } catch {
                userData = rawResponse;
              }
            }
          } else {
            userData = "";
          }

          submittedUserData = userData;

          if (pendingAction?.isFallback) {
            const fallbackPromptKey = resolveActionPromptKey(pendingAction);
            const resolvedAction = pendingActions.find((item) => {
              if (item.requestId === pendingAction.requestId) return false;
              if (item.isFallback) return false;
              if (item.actionType !== pendingAction.actionType) return false;
              if (!fallbackPromptKey) return false;
              return resolveActionPromptKey(item) === fallbackPromptKey;
            });

            if (!resolvedAction) {
              throw new Error("Ask 请求 ID 尚未就绪，请稍后再试");
            }

            effectiveRequestId = resolvedAction.requestId;
            acknowledgedRequestIds.add(resolvedAction.requestId);
          }

          await submitAsterElicitationResponse(
            activeSessionId,
            effectiveRequestId,
            userData,
          );
        } else {
          await confirmAsterAction(
            effectiveRequestId,
            response.confirmed,
            response.response,
          );
        }

        // 移除已处理的请求
        setPendingActions((prev) =>
          prev.filter((a) => !acknowledgedRequestIds.has(a.requestId)),
        );
        const shouldPersistSubmittedAction =
          actionType === "elicitation" || actionType === "ask_user";
        setMessages((prev) =>
          prev.map((msg) => ({
            ...msg,
            actionRequests: shouldPersistSubmittedAction
              ? msg.actionRequests?.map((item) =>
                  acknowledgedRequestIds.has(item.requestId)
                    ? {
                        ...item,
                        status: "submitted" as const,
                        submittedResponse: normalizedResponse || undefined,
                        submittedUserData,
                      }
                    : item,
                )
              : msg.actionRequests?.filter(
                  (item) => !acknowledgedRequestIds.has(item.requestId),
                ),
            contentParts: shouldPersistSubmittedAction
              ? msg.contentParts?.map((part) =>
                  part.type === "action_required" &&
                  acknowledgedRequestIds.has(part.actionRequired.requestId)
                    ? {
                        ...part,
                        actionRequired: {
                          ...part.actionRequired,
                          status: "submitted" as const,
                          submittedResponse: normalizedResponse || undefined,
                          submittedUserData,
                        },
                      }
                    : part,
                )
              : msg.contentParts?.filter(
                  (part) =>
                    part.type !== "action_required" ||
                    !acknowledgedRequestIds.has(part.actionRequired.requestId),
                ),
          })),
        );
      } catch (error) {
        console.error("[AsterChat] 确认失败:", error);
        toast.error(
          error instanceof Error && error.message
            ? error.message
            : "确认操作失败",
        );
      }
    },
    [pendingActions, sessionId],
  );

  // 兼容 Native 接口：权限响应处理
  const handlePermissionResponse = useCallback(
    async (response: ConfirmResponse) => {
      await confirmAction(response);
    },
    [confirmAction],
  );

  // 兼容 Native 接口：触发 AI 引导（仅生成助手消息，不注入用户气泡）
  const triggerAIGuide = useCallback(
    async (initialPrompt?: string) => {
      await sendMessage(initialPrompt?.trim() || "", [], false, false, true);
    },
    [sendMessage],
  );

  // 清空消息（兼容 useAgentChat 的可选参数）
  const clearMessages = useCallback(
    (
      options: {
        showToast?: boolean;
        toastMessage?: string;
      } = {},
    ) => {
      const { showToast = true, toastMessage = "新话题已创建" } = options;

      setMessages([]);
      setSessionId(null);
      setPendingActions([]);
      restoredWorkspaceRef.current = null;
      hydratedSessionRef.current = null;
      skipAutoRestoreRef.current = true;
      currentAssistantMsgIdRef.current = null;
      currentStreamingSessionIdRef.current = null;

      if (showToast) {
        toast.success(toastMessage);
      }
    },
    [],
  );

  // 删除消息
  const deleteMessage = useCallback((id: string) => {
    setMessages((prev) => prev.filter((msg) => msg.id !== id));
  }, []);

  // 编辑消息
  const editMessage = useCallback((id: string, newContent: string) => {
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === id ? { ...msg, content: newContent } : msg,
      ),
    );
  }, []);

  // 切换话题
  const switchTopic = useCallback(
    async (topicId: string) => {
      if (topicId === sessionId && messages.length > 0) return;

      const currentSessionId = sessionIdRef.current;
      if (currentSessionId) {
        persistSessionModelPreference(
          currentSessionId,
          providerTypeRef.current,
          modelRef.current,
        );
      }

      skipAutoRestoreRef.current = false;
      try {
        const detail = await getAsterSession(topicId);
        const topicPreference = loadSessionModelPreference(workspaceId, topicId);
        const historyToolNameById = new Map<string, string>();
        const loadedMessages: Message[] = detail.messages
          .filter(
            (msg) =>
              msg.role === "user" || msg.role === "assistant" || msg.role === "tool",
          )
          .flatMap((msg, index) => {
            // 从 TauriMessageContent 数组中提取文本和 contentParts
            const contentParts: ContentPart[] = [];
            const textParts: string[] = [];
            const toolCalls: Message["toolCalls"] = [];
            const images: MessageImage[] = [];
            const messageTimestamp = new Date(msg.timestamp * 1000);
            const rawParts = Array.isArray(msg.content) ? msg.content : [];

            const appendText = (value: unknown) => {
              if (typeof value !== "string") return;
              const normalized = value.trim();
              if (!normalized) return;
              textParts.push(normalized);
              contentParts.push({ type: "text", text: normalized });
            };

            for (const rawPart of rawParts) {
              if (!rawPart || typeof rawPart !== "object") continue;
              const part = rawPart as unknown as Record<string, unknown>;
              const partType = normalizeHistoryPartType(part.type);

              if (
                partType === "text" ||
                partType === "input_text" ||
                partType === "output_text"
              ) {
                appendText(part.text ?? part.content);
                continue;
              }

              if (
                (partType === "thinking" || partType === "reasoning") &&
                typeof (part.text ?? part.content) === "string"
              ) {
                const thinkingText = String(part.text ?? part.content).trim();
                if (thinkingText) {
                  contentParts.push({ type: "thinking", text: thinkingText });
                }
                continue;
              }

              if (
                partType === "image" ||
                partType === "input_image" ||
                partType === "image_url"
              ) {
                const normalizedImage = normalizeHistoryImagePart(part);
                if (normalizedImage) {
                  images.push(normalizedImage);
                }
                continue;
              }

              if (partType === "tool_request") {
                if (!part.id || typeof part.id !== "string") continue;
                const nestedToolCall =
                  part.toolCall && typeof part.toolCall === "object"
                    ? (part.toolCall as Record<string, unknown>)
                    : part.tool_call && typeof part.tool_call === "object"
                      ? (part.tool_call as Record<string, unknown>)
                      : undefined;
                const nestedToolCallValue =
                  nestedToolCall?.value && typeof nestedToolCall.value === "object"
                    ? (nestedToolCall.value as Record<string, unknown>)
                    : undefined;
                const toolName =
                  (
                    (typeof part.tool_name === "string" && part.tool_name.trim()) ||
                    (typeof part.toolName === "string" && part.toolName.trim()) ||
                    (typeof part.name === "string" && part.name.trim()) ||
                    (typeof nestedToolCallValue?.name === "string" &&
                      nestedToolCallValue.name.trim())
                  )
                    ? (
                        (typeof part.tool_name === "string" &&
                          part.tool_name.trim()) ||
                        (typeof part.toolName === "string" &&
                          part.toolName.trim()) ||
                        (typeof part.name === "string" && part.name.trim()) ||
                        (typeof nestedToolCallValue?.name === "string" &&
                          nestedToolCallValue.name.trim()) ||
                        ""
                      )
                    : resolveHistoryToolName(part.id, historyToolNameById);
                const rawArguments =
                  part.arguments ??
                  nestedToolCallValue?.arguments ??
                  nestedToolCall?.arguments;
                const toolCall = {
                  id: part.id,
                  name: toolName,
                  arguments: stringifyToolArguments(rawArguments),
                  status: "running" as const,
                  startTime: messageTimestamp,
                };
                historyToolNameById.set(part.id, toolName);
                toolCalls.push(toolCall);
                contentParts.push({ type: "tool_use", toolCall });
                continue;
              }

              if (partType === "tool_response") {
                if (!part.id || typeof part.id !== "string") continue;
                const success = part.success !== false;
                const toolName =
                  resolveHistoryToolName(part.id, historyToolNameById);
                const outputText =
                  typeof part.output === "string" ? part.output : "";
                const toolCall = {
                  id: part.id,
                  name: toolName,
                  status: success ? ("completed" as const) : ("failed" as const),
                  startTime: messageTimestamp,
                  endTime: messageTimestamp,
                  result: {
                    success,
                    output: outputText,
                    error:
                      typeof part.error === "string"
                        ? part.error
                        : undefined,
                    images: normalizeToolResultImages(part.images, outputText),
                  },
                };
                toolCalls.push(toolCall);
                contentParts.push({ type: "tool_use", toolCall });
                continue;
              }

              if (partType !== "action_required") continue;

              const actionType =
                typeof part.action_type === "string" ? part.action_type : "";
              if (actionType !== "elicitation_response") continue;

              const data =
                part.data && typeof part.data === "object"
                  ? (part.data as Record<string, unknown>)
                  : undefined;
              const userData =
                data && "user_data" in data ? data.user_data : part.data;
              const resolved = resolveHistoryUserDataText(userData);
              if (!resolved) continue;

              textParts.push(resolved);
              contentParts.push({ type: "text", text: resolved });
            }

            const content = textParts.join("\n").trim();
            let normalizedRole =
              msg.role === "tool" ? "assistant" : (msg.role as "user" | "assistant");
            const hasToolMetadata =
              toolCalls.length > 0 ||
              contentParts.some((part) => part.type === "tool_use");

            if (normalizedRole === "user" && !content && images.length === 0) {
              if (hasToolMetadata) {
                normalizedRole = "assistant";
              } else {
                return [];
              }
            }

            if (
              !content &&
              images.length === 0 &&
              contentParts.length === 0 &&
              toolCalls.length === 0
            ) {
              return [];
            }

            return [
              {
                id: `${topicId}-${index}`,
                role: normalizedRole,
                content,
                images: images.length > 0 ? images : undefined,
                contentParts: contentParts.length > 0 ? contentParts : undefined,
                toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
                timestamp: messageTimestamp,
                isThinking: false,
              },
            ];
          });

        setMessages(mergeAdjacentAssistantMessages(loadedMessages));
        const selectedTopic = topics.find((topic) => topic.id === topicId);
        setExecutionStrategyState(
          normalizeExecutionStrategy(
            detail.execution_strategy || selectedTopic?.executionStrategy,
          ),
        );
        setSessionId(topicId);
        if (topicPreference) {
          providerTypeRef.current = topicPreference.providerType;
          modelRef.current = topicPreference.model;
          setProviderTypeState(topicPreference.providerType);
          setModelState(topicPreference.model);
          savePersisted(
            scopedProviderPrefKeyRef.current,
            topicPreference.providerType,
          );
          savePersisted(scopedModelPrefKeyRef.current, topicPreference.model);
          persistSessionModelPreference(
            topicId,
            topicPreference.providerType,
            topicPreference.model,
          );
        }
      } catch (error) {
        console.error("[AsterChat] 切换话题失败:", error);
        console.error("[AsterChat] 错误详情:", JSON.stringify(error, null, 2));
        setMessages([]);
        setSessionId(null);
        saveTransient(getScopedSessionKey(), null);
        savePersisted(getScopedPersistedSessionKey(), null);
        toast.error(`加载对话历史失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    [
      getScopedPersistedSessionKey,
      getScopedSessionKey,
      messages.length,
      persistSessionModelPreference,
      sessionId,
      topics,
      workspaceId,
    ],
  );

  // 自动恢复当前 workspace 最近会话
  useEffect(() => {
    const resolvedWorkspaceId = workspaceId?.trim();
    if (!resolvedWorkspaceId) return;
    if (!isInitialized) return;
    if (skipAutoRestoreRef.current) return;
    if (sessionId) return;
    if (topics.length === 0) return;
    if (restoredWorkspaceRef.current === resolvedWorkspaceId) return;

    restoredWorkspaceRef.current = resolvedWorkspaceId;

    const scopedCandidate =
      loadTransient<string | null>(getScopedSessionKey(), null) ||
      loadPersisted<string | null>(getScopedPersistedSessionKey(), null);
    const mappedFallbackCandidate =
      topics.find(
        (topic) =>
          loadPersisted<string | null>(
            `agent_session_workspace_${topic.id}`,
            null,
          ) === resolvedWorkspaceId,
      )?.id || null;

    const targetSessionId = scopedCandidate || mappedFallbackCandidate;
    if (!targetSessionId) {
      return;
    }

    switchTopic(targetSessionId).catch((error) => {
      console.warn("[AsterChat] 自动恢复会话失败:", error);
      saveTransient(getScopedSessionKey(), null);
      savePersisted(getScopedPersistedSessionKey(), null);
    });
  }, [
    getScopedPersistedSessionKey,
    getScopedSessionKey,
    isInitialized,
    sessionId,
    switchTopic,
    topics,
    workspaceId,
  ]);

  useEffect(() => {
    if (sessionId) {
      skipAutoRestoreRef.current = false;
    }
  }, [sessionId]);

  // 有 sessionId 但消息为空时，主动回填历史
  useEffect(() => {
    if (!sessionId) return;

    if (messages.length > 0) {
      hydratedSessionRef.current = sessionId;
      return;
    }

    if (hydratedSessionRef.current === sessionId) {
      return;
    }

    hydratedSessionRef.current = sessionId;

    switchTopic(sessionId).catch((error) => {
      console.warn("[AsterChat] 会话水合失败:", error);
      hydratedSessionRef.current = null;
    });
  }, [messages.length, sessionId, switchTopic]);

  // 删除话题
  const deleteTopic = useCallback(
    async (topicId: string) => {
      try {
        await deleteAsterSession(topicId);
        await loadTopics();

        if (topicId === sessionId) {
          setSessionId(null);
          setMessages([]);
          setPendingActions([]);
          currentAssistantMsgIdRef.current = null;
          currentStreamingSessionIdRef.current = null;
          hydratedSessionRef.current = null;
          restoredWorkspaceRef.current = null;
          saveTransient(getScopedSessionKey(), null);
          savePersisted(getScopedPersistedSessionKey(), null);
        }

        toast.success("话题已删除");
      } catch (error) {
        console.error("[AsterChat] 删除话题失败:", error);
        toast.error("删除话题失败");
      }
    },
    [
      getScopedPersistedSessionKey,
      getScopedSessionKey,
      loadTopics,
      sessionId,
    ],
  );

  // 重命名话题（持久化）
  const renameTopic = useCallback(async (topicId: string, newTitle: string) => {
    const normalizedTitle = newTitle.trim();
    if (!normalizedTitle) {
      return;
    }

    try {
      await renameAsterSession(topicId, normalizedTitle);
      await loadTopics();
      toast.success("话题已重命名");
    } catch (error) {
      console.error("[AsterChat] 重命名话题失败:", error);
      toast.error("重命名失败");
    }
  }, [loadTopics]);

  // 兼容接口
  const handleStartProcess = useCallback(async () => {
    // Aster 不需要单独启动进程
  }, []);

  const handleStopProcess = useCallback(async () => {
    setSessionId(null);
    setMessages([]);
    setPendingActions([]);
    currentAssistantMsgIdRef.current = null;
    currentStreamingSessionIdRef.current = null;
    restoredWorkspaceRef.current = null;
    hydratedSessionRef.current = null;
  }, []);

  return {
    // 兼容 useAgentChat 接口
    processStatus: { running: isInitialized },
    handleStartProcess,
    handleStopProcess,

    providerType,
    setProviderType,
    model,
    setModel,
    executionStrategy,
    setExecutionStrategy,
    providerConfig: {}, // 简化版本
    isConfigLoading: false,

    messages,
    isSending,
    sendMessage,
    stopSending,
    clearMessages,
    deleteMessage,
    editMessage,
    handlePermissionResponse,
    triggerAIGuide,

    topics,
    sessionId,
    switchTopic,
    deleteTopic,
    renameTopic,
    loadTopics,

    // Aster 特有功能
    pendingActions,
    confirmAction,

    // Workspace 路径修复
    workspacePathMissing,
    fixWorkspacePathAndRetry,
    dismissWorkspacePathError,
  };
}
