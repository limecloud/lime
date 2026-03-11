import { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { safeListen } from "@/lib/dev-bridge";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  startAgentProcess,
  stopAgentProcess,
  getAgentProcessStatus,
  createAgentSession,
  sendAsterMessageStream,
  listAgentSessions,
  deleteAgentSession,
  getAgentSessionMessages,
  renameAgentSession,
  generateAgentTitle,
  confirmAsterAction,
  submitAsterElicitationResponse,
  stopAsterSession,
  type AgentProcessStatus,
  type SessionInfo,
  type SkillInfo,
} from "@/lib/api/agentRuntime";
import { parseStreamEvent, type StreamEvent } from "@/lib/api/agentStream";
import { skillsApi } from "@/lib/api/skills";
import { A2UIFormAPI } from "@/lib/api/a2uiForm";
import type { A2UIFormData } from "@/components/content-creator/a2ui/types";
import {
  Message,
  MessageImage,
  ContentPart,
  ActionRequired,
  ConfirmResponse,
  PROVIDER_CONFIG,
  getProviderConfig,
  type ProviderConfigMap,
} from "../types";
import { useArtifactParser } from "@/lib/artifact/hooks/useArtifactParser";
import {
  parseSkillSlashCommand,
  tryExecuteSlashSkillCommand,
} from "./skillCommand";
import {
  isValidSessionId,
  resolveRestorableSessionId,
} from "../utils/sessionRecovery";
import { createStreamDiagnosticsReporter } from "../utils/streamDiagnostics";

/** 话题（会话）信息 */
export interface Topic {
  id: string;
  title: string;
  createdAt: Date;
  messagesCount: number;
}

// 音效播放器（模块级别单例）
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

// Helper for localStorage (Persistent across reloads)
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

// Helper for session storage (Transient data like messages)
const loadTransient = <T>(key: string, defaultValue: T): T => {
  try {
    const stored = sessionStorage.getItem(key);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (key.startsWith("agent_messages") && Array.isArray(parsed)) {
        return parsed.map((msg: any) => ({
          ...msg,
          timestamp: new Date(msg.timestamp),
        })) as unknown as T;
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

// 标题手动编辑状态跟踪
const TITLE_EDITED_KEY_PREFIX = "agent_title_manually_edited_";

const isTitleManuallyEdited = (sessionId: string): boolean => {
  return loadPersisted(`${TITLE_EDITED_KEY_PREFIX}${sessionId}`, false);
};

const setTitleManuallyEdited = (sessionId: string, edited: boolean) => {
  savePersisted(`${TITLE_EDITED_KEY_PREFIX}${sessionId}`, edited);
};

const DEFAULT_AGENT_PROVIDER = "claude";
const DEFAULT_AGENT_MODEL = PROVIDER_CONFIG["claude"]?.models[0] || "";
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

/** useAgentChat 的配置选项 */
interface UseAgentChatOptions {
  /** 系统提示词（用于内容创作等场景） */
  systemPrompt?: string;
  /** 文件写入回调 */
  onWriteFile?: (content: string, fileName: string) => void;
  /** 绑定的工作区 ID（用于本地 sandbox） */
  workspaceId: string;
}

export function useAgentChat(options: UseAgentChatOptions) {
  const { systemPrompt, onWriteFile, workspaceId } = options;
  const streamDiagnosticsRef = useRef(
    createStreamDiagnosticsReporter("useAgentChat"),
  );

  const getRequiredWorkspaceId = (): string => {
    const resolvedWorkspaceId = workspaceId?.trim();
    if (!resolvedWorkspaceId) {
      throw new Error("缺少项目工作区，请先选择项目后再使用 Agent");
    }
    return resolvedWorkspaceId;
  };

  const getScopedKey = (key: string): string => {
    const resolvedWorkspaceId = workspaceId?.trim();
    return resolvedWorkspaceId
      ? `${key}_${resolvedWorkspaceId}`
      : `${key}_global`;
  };

  const getScopedSessionKey = () => getScopedKey("agent_curr_sessionId");
  const getScopedMessagesKey = () => getScopedKey("agent_messages");
  const getScopedRoundCountKey = () => getScopedKey("agent_curr_roundCount");
  const getScopedPersistedSessionKey = () =>
    getScopedKey("agent_last_sessionId");

  const [processStatus, setProcessStatus] = useState<AgentProcessStatus>({
    running: false,
  });

  // 动态模型配置（从后端加载）
  const [providerConfig, setProviderConfig] =
    useState<ProviderConfigMap>(PROVIDER_CONFIG);
  const [isConfigLoading, setIsConfigLoading] = useState(true);

  const initialPreferencesRef = useRef<AgentPreferences>(
    resolveWorkspaceAgentPreferences(workspaceId),
  );

  // Provider/Model（按工作区保存）
  const [providerType, setProviderType] = useState(
    () => initialPreferencesRef.current.providerType,
  );
  const [model, setModel] = useState(() => initialPreferencesRef.current.model);

  // Session State
  const [sessionId, setSessionId] = useState<string | null>(() => {
    if (!workspaceId?.trim()) {
      return null;
    }

    const scopedSessionId = loadTransient<string | null>(
      getScopedSessionKey(),
      null,
    );
    if (scopedSessionId) {
      return scopedSessionId;
    }

    const persistedSessionId = loadPersisted<string | null>(
      getScopedPersistedSessionKey(),
      null,
    );
    if (persistedSessionId) {
      return persistedSessionId;
    }

    // 兼容旧版本（未按 workspace 分片）
    return loadTransient<string | null>("agent_curr_sessionId", null);
  });

  const [messages, setMessages] = useState<Message[]>(() => {
    if (!workspaceId?.trim()) {
      return [];
    }

    const scopedMessages = loadTransient<Message[]>(getScopedMessagesKey(), []);
    if (scopedMessages.length > 0) {
      return scopedMessages;
    }

    // 兼容旧版本（未按 workspace 分片）
    return loadTransient<Message[]>("agent_messages", []);
  });

  // 话题列表
  const [topics, setTopics] = useState<Topic[]>([]);

  // A2UI 表单数据缓存（按消息 ID 索引）
  const [a2uiFormDataMap, setA2uiFormDataMap] = useState<
    Record<string, { formId: string; formData: A2UIFormData }>
  >({});

  const [isSending, setIsSending] = useState(false);

  // 当前会话的轮数计数器（用于判断何时生成标题）
  const [_roundCount, _setRoundCount] = useState(() =>
    workspaceId?.trim()
      ? loadTransient<number>(getScopedRoundCountKey(), 0)
      : 0,
  );

  // 用于保存当前流式请求的取消函数
  const unlistenRef = useRef<UnlistenFn | null>(null);
  // 用于保存当前正在处理的消息 ID
  const currentAssistantMsgIdRef = useRef<string | null>(null);
  // 当前流式请求对应的会话 ID（用于 stop 时通知后端取消）
  const currentStreamingSessionIdRef = useRef<string | null>(null);
  // 自动恢复/水合状态跟踪
  const restoredWorkspaceRef = useRef<string | null>(null);
  const hydratedSessionRef = useRef<string | null>(null);
  const skipAutoRestoreRef = useRef(false);
  const sessionResetVersionRef = useRef(0);
  const scopedProviderPrefKeyRef = useRef<string>(
    getAgentPreferenceKeys(workspaceId).providerKey,
  );
  const scopedModelPrefKeyRef = useRef<string>(
    getAgentPreferenceKeys(workspaceId).modelKey,
  );

  // Artifact 解析器 - 用于流式解析 AI 响应中的 artifact
  const {
    startParsing: startArtifactParsing,
    appendChunk: appendArtifactChunk,
    finalizeParsing: finalizeArtifactParsing,
    reset: _resetArtifactParser,
  } = useArtifactParser();

  // 加载动态模型配置
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const config = await getProviderConfig();
        console.log("[useAgentChat] 加载模型配置成功:", config);
        console.log("[useAgentChat] codex 模型列表:", config.codex?.models);
        setProviderConfig(config);
      } catch (error) {
        console.warn("加载模型配置失败，使用默认配置:", error);
      } finally {
        setIsConfigLoading(false);
      }
    };
    loadConfig();
  }, []);

  // workspace 变化时恢复 Provider/Model 偏好
  useEffect(() => {
    const { providerKey, modelKey } = getAgentPreferenceKeys(workspaceId);

    scopedProviderPrefKeyRef.current = providerKey;
    scopedModelPrefKeyRef.current = modelKey;

    const scopedPreferences = resolveWorkspaceAgentPreferences(workspaceId);
    setProviderType(scopedPreferences.providerType);
    setModel(scopedPreferences.model);

    savePersisted(providerKey, scopedPreferences.providerType);
    savePersisted(modelKey, scopedPreferences.model);
  }, [workspaceId]);

  // 持久化 provider/model（仅写当前工作区）
  useEffect(() => {
    savePersisted(scopedProviderPrefKeyRef.current, providerType);
  }, [providerType]);

  useEffect(() => {
    savePersisted(scopedModelPrefKeyRef.current, model);
  }, [model]);

  // 当 provider 改变时，检查当前模型是否兼容
  // 如果不兼容，自动切换到新 provider 的第一个模型
  // 注意：model 不能放在依赖中，否则会导致无限循环
  useEffect(() => {
    const currentProviderModels = providerConfig[providerType]?.models || [];
    // 只有当模型列表非空时才检查兼容性
    if (currentProviderModels.length > 0) {
      // 使用 setModel 的函数形式来访问当前 model 值，避免将 model 放入依赖
      setModel((currentModel) => {
        if (!currentProviderModels.includes(currentModel)) {
          console.log(
            `[useAgentChat] 模型 ${currentModel} 不在 ${providerType} 支持列表中，自动切换到 ${currentProviderModels[0]}`,
          );
          return currentProviderModels[0];
        }
        return currentModel;
      });
    }
  }, [providerType, providerConfig]);

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
      savePersisted(
        `agent_session_workspace_${sessionId}`,
        resolvedWorkspaceId,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, workspaceId]);

  useEffect(() => {
    if (!workspaceId?.trim()) {
      return;
    }
    saveTransient(getScopedMessagesKey(), messages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, workspaceId]);

  useEffect(() => {
    if (!workspaceId?.trim()) {
      return;
    }
    saveTransient(getScopedRoundCountKey(), _roundCount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [_roundCount, workspaceId]);

  // workspace 变化时恢复对应会话状态
  useEffect(() => {
    if (!workspaceId?.trim()) {
      setSessionId(null);
      setMessages([]);
      currentStreamingSessionIdRef.current = null;
      _setRoundCount(0);
      setA2uiFormDataMap({});
      restoredWorkspaceRef.current = null;
      hydratedSessionRef.current = null;
      skipAutoRestoreRef.current = false;
      return;
    }

    const scopedSessionId =
      loadTransient<string | null>(getScopedSessionKey(), null) ??
      loadPersisted<string | null>(getScopedPersistedSessionKey(), null);

    const scopedMessages = loadTransient<Message[]>(getScopedMessagesKey(), []);
    const scopedRoundCount = loadTransient<number>(getScopedRoundCountKey(), 0);

    setSessionId(scopedSessionId);
    setMessages(scopedMessages);
    _setRoundCount(scopedRoundCount);
    setA2uiFormDataMap({});

    restoredWorkspaceRef.current = null;
    hydratedSessionRef.current = null;
    skipAutoRestoreRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  // 加载话题列表
  const loadTopics = async () => {
    try {
      const sessions = await listAgentSessions();
      const resolvedWorkspaceId = workspaceId?.trim();

      const validSessions = sessions.filter((s) =>
        isValidSessionId(s.session_id),
      );

      for (const session of validSessions) {
        if (session.workspace_id) {
          savePersisted(
            `agent_session_workspace_${session.session_id}`,
            session.workspace_id,
          );
        }
      }

      const filteredSessions = resolvedWorkspaceId
        ? validSessions.filter((session) => {
            const mappedWorkspaceId =
              session.workspace_id ||
              loadPersisted<string | null>(
                `agent_session_workspace_${session.session_id}`,
                null,
              );

            return mappedWorkspaceId === resolvedWorkspaceId;
          })
        : validSessions;

      const topicList: Topic[] = filteredSessions.map((s: SessionInfo) => ({
        id: s.session_id,
        title: s.title || generateTopicTitle(s),
        createdAt: new Date(s.created_at),
        messagesCount: s.messages_count,
      }));
      setTopics(topicList);
    } catch (error) {
      console.error("加载话题列表失败:", error);
    }
  };

  // 根据会话信息生成话题标题（后备方案）
  const generateTopicTitle = (session: SessionInfo): string => {
    if (session.messages_count === 0) {
      return "新话题";
    }
    // 使用创建时间作为默认标题
    const date = new Date(session.created_at);
    return `话题 ${date.toLocaleDateString("zh-CN")} ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
  };

  // 生成智能标题
  const generateSmartTitle = async (targetSessionId: string) => {
    // 检查是否已手动编辑过
    if (isTitleManuallyEdited(targetSessionId)) {
      console.log("[useAgentChat] 标题已手动编辑，跳过自动生成");
      return;
    }

    try {
      const title = await generateAgentTitle(targetSessionId);
      if (title && title !== "新话题") {
        await renameAgentSession(targetSessionId, title);
        // 刷新话题列表
        await loadTopics();
        console.log("[useAgentChat] 智能标题已生成:", title);
      }
    } catch (error) {
      console.warn("[useAgentChat] 生成智能标题失败:", error);
      // 静默失败，不影响用户体验
    }
  };

  // 重命名话题
  const renameTopic = async (targetSessionId: string, newTitle: string) => {
    try {
      await renameAgentSession(targetSessionId, newTitle);
      // 标记为已手动编辑
      setTitleManuallyEdited(targetSessionId, true);
      // 刷新话题列表
      await loadTopics();
    } catch (error) {
      console.error("[useAgentChat] 重命名话题失败:", error);
      toast.error("重命名失败");
    }
  };

  // Initial Load
  useEffect(() => {
    getAgentProcessStatus().then(setProcessStatus).catch(console.error);
    loadTopics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // workspace 变化时刷新话题
  useEffect(() => {
    if (!workspaceId?.trim()) {
      setTopics([]);
      return;
    }
    loadTopics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  // 监听截图对话消息事件
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    const setupListener = async () => {
      unlisten = await safeListen<{
        message: string;
        image_path: string | null;
        image_base64: string | null;
      }>("smart-input-message", async (event) => {
        console.log("[AgentChat] 收到截图对话消息:", event.payload);
        const { message, image_base64 } = event.payload;

        // 构建图片数组
        const images: MessageImage[] = [];
        if (image_base64) {
          images.push({
            data: image_base64,
            mediaType: "image/png",
          });
        }

        // 发送消息
        await sendMessage(message, images, false, false);
      });
    };

    setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerType, model, sessionId]);

  // 当 sessionId 变化时刷新话题列表
  useEffect(() => {
    if (sessionId) {
      loadTopics();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const createFreshSession = async (): Promise<string | null> => {
    try {
      const [allProxycastSkills, localInstalledSkills] = await Promise.all([
        skillsApi.getAll("proxycast").catch(() => []),
        skillsApi.getInstalledProxyCastSkills().catch(() => []),
      ]);
      const detailsByName = new Map<string, SkillInfo>();

      allProxycastSkills
        .filter((skill) => skill.installed)
        .forEach((skill) => {
          const skillName = (
            skill.directory ||
            skill.key ||
            skill.name ||
            ""
          ).trim();
          if (!skillName) return;
          detailsByName.set(skillName, {
            name: skillName,
            description: skill.description || undefined,
            path: `~/.proxycast/skills/${skillName}/SKILL.md`,
          });
        });

      localInstalledSkills.forEach((name) => {
        const skillName = (name || "").trim();
        if (!skillName || detailsByName.has(skillName)) return;
        detailsByName.set(skillName, {
          name: skillName,
          path: `~/.proxycast/skills/${skillName}/SKILL.md`,
        });
      });

      const details = Array.from(detailsByName.values());

      // Create new session with CURRENT provider/model as baseline
      // 传递 systemPrompt 用于内容创作等场景
      const resolvedWorkspaceId = getRequiredWorkspaceId();
      const response = await createAgentSession(
        providerType,
        resolvedWorkspaceId,
        model || undefined,
        systemPrompt, // 传递系统提示词
        details.length > 0 ? details : undefined,
      );

      setSessionId(response.session_id);
      skipAutoRestoreRef.current = false;
      return response.session_id;
    } catch (error) {
      console.error("[AgentChat] Auto-creation failed:", error);
      toast.error("Failed to initialize session", {
        id: "session-init-error",
        duration: 8000,
      });
      return null;
    }
  };

  // Ensure an active session exists (internal helper)
  const _ensureSession = async (): Promise<string | null> => {
    // If we already have a session, we might want to continue using it.
    // However, check if we need to "re-initialize" if critical params changed?
    // User said: "选择模型后，不用和会话绑定". So we keep the session ID if it exists.
    if (sessionId) return sessionId;
    return createFreshSession();
  };

  const isSessionWorkspaceMismatchError = (error: unknown): boolean => {
    const errorMessage = `${error}`;
    return (
      errorMessage.includes("workspace_mismatch|") ||
      errorMessage.includes("会话工作目录与 workspace 不匹配")
    );
  };

  const resetBrokenSessionBinding = (staleSessionId: string | null) => {
    const resolvedWorkspaceId = workspaceId?.trim();

    sessionResetVersionRef.current += 1;
    setSessionId(null);
    currentStreamingSessionIdRef.current = null;
    hydratedSessionRef.current = null;
    skipAutoRestoreRef.current = true;
    restoredWorkspaceRef.current = resolvedWorkspaceId || null;

    if (resolvedWorkspaceId) {
      saveTransient(`agent_curr_sessionId_${resolvedWorkspaceId}`, null);
      savePersisted(`agent_last_sessionId_${resolvedWorkspaceId}`, null);
    }

    if (staleSessionId) {
      savePersisted(`agent_session_workspace_${staleSessionId}`, "__invalid__");
    }
  };

  const sendStreamWithSessionRecovery = async (
    message: string,
    eventName: string,
    resolvedWorkspaceId: string,
    activeSessionId: string,
    modelName?: string,
    images?: Array<{ data: string; media_type: string }>,
    projectId?: string,
  ): Promise<void> => {
    currentStreamingSessionIdRef.current = activeSessionId;

    try {
      await sendAsterMessageStream(
        message,
        activeSessionId,
        eventName,
        resolvedWorkspaceId,
        images,
        providerType
          ? {
              provider_id: providerType,
              provider_name: providerType,
              model_name: modelName || "claude-sonnet-4-20250514",
            }
          : undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        projectId,
      );
      return;
    } catch (error) {
      if (!isSessionWorkspaceMismatchError(error)) {
        throw error;
      }

      console.warn("[AgentChat] 检测到会话工作目录不匹配，准备自动重建会话", {
        sessionId: activeSessionId,
        workspaceId: resolvedWorkspaceId,
      });

      resetBrokenSessionBinding(activeSessionId);
      const freshSessionId = await createFreshSession();
      if (!freshSessionId) {
        throw error;
      }

      currentStreamingSessionIdRef.current = freshSessionId;
      toast.info("检测到旧会话目录异常，已自动切换新会话");
      console.info("[AgentChat] session_auto_recovered", {
        staleSessionId: activeSessionId,
        freshSessionId,
        workspaceId: resolvedWorkspaceId,
      });
      await sendAsterMessageStream(
        message,
        freshSessionId,
        eventName,
        resolvedWorkspaceId,
        images,
        providerType
          ? {
              provider_id: providerType,
              provider_name: providerType,
              model_name: modelName || "claude-sonnet-4-20250514",
            }
          : undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        projectId,
      );
    }
  };

  const sendMessage = async (
    content: string,
    images: MessageImage[],
    webSearch?: boolean,
    thinking?: boolean,
  ) => {
    // 1. Optimistic UI Update
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      images: images.length > 0 ? images : undefined,
      timestamp: new Date(),
    };

    // Placeholder for assistant
    const assistantMsgId = crypto.randomUUID();
    let thinkingText = "思考中...";
    if (thinking && webSearch) {
      thinkingText = "深度思考 + 联网搜索中...";
    } else if (thinking) {
      thinkingText = "深度思考中...";
    } else if (webSearch) {
      thinkingText = "正在搜索网络...";
    }

    const assistantMsg: Message = {
      id: assistantMsgId,
      role: "assistant",
      content: "",
      timestamp: new Date(),
      isThinking: true,
      thinkingContent: thinkingText,
      contentParts: [], // 初始化交错内容列表
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setIsSending(true);

    // 保存当前消息 ID 到 ref，用于停止时更新状态
    currentAssistantMsgIdRef.current = assistantMsgId;

    // 用于累积流式内容
    let accumulatedContent = "";
    let unlisten: UnlistenFn | null = null;

    // === Skill 拦截逻辑 ===
    // 检测 /skill-name args 格式的输入，直接调用 execute_skill 命令
    // 绕过 aster_agent_chat_stream 路径（某些 Provider 如 Codex 不支持工具调用）
    const parsedSkillCommand = parseSkillSlashCommand(content);
    if (parsedSkillCommand) {
      const skillHandled = await tryExecuteSlashSkillCommand({
        command: parsedSkillCommand,
        rawContent: content,
        assistantMsgId,
        providerType,
        model: model || undefined,
        ensureSession: _ensureSession,
        setMessages,
        setIsSending,
        setCurrentAssistantMsgId: (id) => {
          currentAssistantMsgIdRef.current = id;
        },
        setStreamUnlisten: (unlistenFn) => {
          unlistenRef.current = unlistenFn;
        },
        setActiveSessionIdForStop: (sessionIdForStop) => {
          currentStreamingSessionIdRef.current = sessionIdForStop;
        },
        isExecutionCancelled: () =>
          currentAssistantMsgIdRef.current !== assistantMsgId,
        playTypewriterSound,
        playToolcallSound,
        onWriteFile,
      });

      if (skillHandled) {
        return;
      }
    }
    // === Skill 拦截结束 ===

    // 初始化 Artifact 解析器，开始新的解析会话
    startArtifactParsing();

    /**
     * 辅助函数：更新 contentParts，支持交错显示
     * - text_delta: 追加到最后一个 text 类型，或创建新的 text 类型
     * - thinking_delta: 追加到最后一个 thinking 类型，或创建新的 thinking 类型
     * - tool_start: 添加新的 tool_use 类型
     * - tool_end: 更新对应的 tool_use 状态
     */
    const appendTextToParts = (
      parts: ContentPart[],
      text: string,
    ): ContentPart[] => {
      const newParts = [...parts];
      const lastPart = newParts[newParts.length - 1];

      if (lastPart && lastPart.type === "text") {
        // 追加到最后一个 text 类型
        newParts[newParts.length - 1] = {
          type: "text",
          text: lastPart.text + text,
        };
      } else {
        // 创建新的 text 类型
        newParts.push({ type: "text", text });
      }
      return newParts;
    };

    const appendThinkingToParts = (
      parts: ContentPart[],
      text: string,
    ): ContentPart[] => {
      const newParts = [...parts];
      const lastPart = newParts[newParts.length - 1];

      if (lastPart && lastPart.type === "thinking") {
        // 追加到最后一个 thinking 类型
        newParts[newParts.length - 1] = {
          type: "thinking",
          text: lastPart.text + text,
        };
      } else {
        // 创建新的 thinking 类型
        newParts.push({ type: "thinking", text });
      }
      return newParts;
    };

    const addActionRequiredToParts = (
      parts: ContentPart[],
      actionRequired: ActionRequired,
    ): ContentPart[] => {
      const newParts = [...parts];
      newParts.push({ type: "action_required", actionRequired });
      return newParts;
    };

    try {
      // 2. 确保有一个活跃的 session（用于保持上下文）
      const activeSessionId = await _ensureSession();
      if (!activeSessionId) {
        throw new Error("无法创建或获取会话");
      }
      currentStreamingSessionIdRef.current = activeSessionId;

      // 3. 创建唯一事件名称
      const eventName = `agent_stream_${assistantMsgId}`;

      // 4. 设置事件监听器（流式接收）
      console.log(
        `[AgentChat] 设置事件监听器: ${eventName}, sessionId: ${activeSessionId}`,
      );
      streamDiagnosticsRef.current.start({
        sessionId: activeSessionId,
        eventName,
        assistantMessageId: assistantMsgId,
        source: "sendMessage",
      });
      unlisten = await safeListen<StreamEvent>(eventName, (event) => {
        console.log("[AgentChat] 收到事件:", eventName, event.payload);
        const data = parseStreamEvent(event.payload);
        if (!data) {
          console.warn("[AgentChat] 解析事件失败:", event.payload);
          streamDiagnosticsRef.current.recordInvalidEvent(event.payload);
          return;
        }
        streamDiagnosticsRef.current.record(data);
        console.log("[AgentChat] 解析后数据:", data);

        switch (data.type) {
          case "text_delta":
            // 累积文本并实时更新 UI（同时更新 content 和 contentParts）
            accumulatedContent += data.text;

            // 播放打字机音效
            playTypewriterSound();

            // 流式解析 Artifact
            appendArtifactChunk(data.text);

            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMsgId
                  ? {
                      ...msg,
                      content: accumulatedContent,
                      thinkingContent: undefined,
                      // 更新 contentParts，支持交错显示
                      contentParts: appendTextToParts(
                        msg.contentParts || [],
                        data.text,
                      ),
                    }
                  : msg,
              ),
            );
            break;

          case "thinking_delta":
            // 处理推理内容增量（DeepSeek reasoner 等模型的思考过程）
            console.log("[AgentChat] 收到 thinking_delta:", data.text);
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMsgId
                  ? {
                      ...msg,
                      thinkingContent: (msg.thinkingContent || "") + data.text,
                      isThinking: true,
                      // 同时更新 contentParts，支持交错显示
                      contentParts: appendThinkingToParts(
                        msg.contentParts || [],
                        data.text,
                      ),
                    }
                  : msg,
              ),
            );
            break;

          case "done":
            // 完成一次 API 响应，但工具循环可能还在继续
            // 不要取消监听，继续等待更多事件
            console.log("[AgentChat] 收到 done 事件，工具循环可能还在继续...");
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMsgId
                  ? {
                      ...msg,
                      // 保持 isThinking 为 true，直到收到 final_done 或 error
                      content: accumulatedContent || msg.content,
                    }
                  : msg,
              ),
            );
            // 注意：不要在这里 setIsSending(false) 或 unlisten()
            // 工具循环会继续发送事件
            break;

          case "final_done":
            // 整个对话完成（包括所有工具调用）
            console.log("[AgentChat] 收到 final_done 事件，对话完成");

            // 完成 Artifact 解析
            finalizeArtifactParsing();

            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMsgId
                  ? {
                      ...msg,
                      isThinking: false,
                      content: accumulatedContent || "(No response)",
                    }
                  : msg,
              ),
            );
            setIsSending(false);
            // 清理 ref
            unlistenRef.current = null;
            currentAssistantMsgIdRef.current = null;
            currentStreamingSessionIdRef.current = null;
            streamDiagnosticsRef.current.markDone();
            if (unlisten) {
              unlisten();
              unlisten = null;
            }

            // 触发智能标题生成（在第 2 轮对话完成后）
            // 使用闭包中的 activeSessionId 确保获取正确的会话 ID
            setTimeout(() => {
              // 从 messages 推断这是第几轮对话
              setMessages((currentMessages) => {
                const userMsgCount = currentMessages.filter(
                  (m) => m.role === "user",
                ).length;
                if (userMsgCount === 2 && activeSessionId) {
                  console.log(
                    "[useAgentChat] 第 2 轮对话完成，触发智能标题生成",
                  );
                  // 异步生成标题，不阻塞消息更新
                  generateSmartTitle(activeSessionId).catch(console.error);
                }
                return currentMessages;
              });
            }, 100);
            break;

          case "error":
            // 错误处理
            console.error("[AgentChat] Stream error:", data.message);
            toast.error(`响应错误: ${data.message}`, {
              id: `stream-error-${Date.now()}`,
              duration: 8000,
            });
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
            // 清理 ref
            unlistenRef.current = null;
            currentAssistantMsgIdRef.current = null;
            currentStreamingSessionIdRef.current = null;
            streamDiagnosticsRef.current.markError(data.message);
            if (unlisten) {
              unlisten();
              unlisten = null;
            }
            break;

          case "tool_start": {
            // 工具开始执行 - 添加到工具调用列表和 contentParts
            console.log(`[Tool Start] ${data.tool_name} (${data.tool_id})`);

            // 播放工具调用音效
            playToolcallSound();

            const newToolCall = {
              id: data.tool_id,
              name: data.tool_name,
              arguments: data.arguments,
              status: "running" as const,
              startTime: new Date(),
            };

            // 如果是写入文件工具，立即调用 onWriteFile 展开右边栏
            const toolName = data.tool_name.toLowerCase();
            console.log(
              `[Tool Start] 工具名称: ${data.tool_name}, 小写: ${toolName}`,
            );
            console.log(`[Tool Start] 工具参数: ${data.arguments}`);
            console.log(`[Tool Start] onWriteFile 回调存在: ${!!onWriteFile}`);

            if (toolName.includes("write") || toolName.includes("create")) {
              console.log(`[Tool Start] 匹配到文件写入工具: ${data.tool_name}`);
              try {
                const args = JSON.parse(data.arguments || "{}");
                console.log(`[Tool Start] 解析后的参数:`, args);
                const filePath = args.path || args.file_path || args.filePath;
                const content = args.content || args.text || "";
                console.log(
                  `[Tool Start] 文件路径: ${filePath}, 内容长度: ${content.length}`,
                );
                if (filePath && content && onWriteFile) {
                  console.log(`[Tool Start] 触发文件写入: ${filePath}`);
                  onWriteFile(content, filePath);
                } else {
                  console.log(
                    `[Tool Start] 文件写入条件不满足: filePath=${!!filePath}, content=${!!content}, onWriteFile=${!!onWriteFile}`,
                  );
                }
              } catch (e) {
                console.warn("[Tool Start] 解析工具参数失败:", e);
              }
            } else {
              console.log(`[Tool Start] 工具名称不匹配文件写入: ${toolName}`);
            }

            setMessages((prev) =>
              prev.map((msg) => {
                if (msg.id !== assistantMsgId) return msg;

                // 检查是否已存在相同 ID 的工具调用（避免重复）
                const existingToolCall = msg.toolCalls?.find(
                  (tc) => tc.id === data.tool_id,
                );
                if (existingToolCall) {
                  console.log(
                    `[Tool Start] 工具调用已存在，跳过: ${data.tool_id}`,
                  );
                  return msg;
                }

                return {
                  ...msg,
                  toolCalls: [...(msg.toolCalls || []), newToolCall],
                  // 添加到 contentParts，支持交错显示
                  contentParts: [
                    ...(msg.contentParts || []),
                    { type: "tool_use" as const, toolCall: newToolCall },
                  ],
                };
              }),
            );
            break;
          }

          case "action_required": {
            // 权限确认请求 - 添加到权限请求列表和 contentParts
            console.log(
              `[Action Required] ${data.action_type} (${data.request_id})`,
            );

            const actionRequired: ActionRequired = {
              requestId: data.request_id,
              actionType: data.action_type as
                | "tool_confirmation"
                | "ask_user"
                | "elicitation",
              toolName: data.tool_name,
              arguments: data.arguments,
              prompt: data.prompt,
              questions: data.questions,
              requestedSchema: data.requested_schema,
            };

            setMessages((prev) =>
              prev.map((msg) => {
                if (msg.id !== assistantMsgId) return msg;

                // 检查是否已存在相同 ID 的权限请求（避免重复）
                const existingRequest = msg.actionRequests?.find(
                  (ar) => ar.requestId === data.request_id,
                );
                if (existingRequest) {
                  console.log(
                    `[Action Required] 权限请求已存在，跳过: ${data.request_id}`,
                  );
                  return msg;
                }

                return {
                  ...msg,
                  actionRequests: [
                    ...(msg.actionRequests || []),
                    actionRequired,
                  ],
                  // 添加到 contentParts，支持交错显示
                  contentParts: addActionRequiredToParts(
                    msg.contentParts || [],
                    actionRequired,
                  ),
                };
              }),
            );
            break;
          }

          case "tool_end": {
            // 工具执行完成 - 更新工具调用状态和 contentParts
            console.log(`[Tool End] ${data.tool_id}`);
            setMessages((prev) =>
              prev.map((msg) => {
                if (msg.id !== assistantMsgId) return msg;

                // 更新 toolCalls
                const updatedToolCalls = (msg.toolCalls || []).map((tc) =>
                  tc.id === data.tool_id
                    ? {
                        ...tc,
                        status: data.result.success
                          ? ("completed" as const)
                          : ("failed" as const),
                        result: data.result,
                        endTime: new Date(),
                      }
                    : tc,
                );

                // 更新 contentParts 中对应的 tool_use
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
                          result: data.result,
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
          }
        }
      });

      // 保存 unlisten 到 ref，用于停止功能
      unlistenRef.current = unlisten;

      // 5. 发送流式请求（传递 sessionId 以保持上下文）
      const imagesToSend =
        images.length > 0
          ? images.map((img) => ({ data: img.data, media_type: img.mediaType }))
          : undefined;

      // systemPrompt 已在创建 session 时传递给后端，无需前端注入
      const messageToSend = content;

      console.log("[AgentChat] 发送消息:", {
        content: messageToSend.slice(0, 100),
        sessionId: activeSessionId,
        model,
        provider: providerType,
        hasSystemPrompt: !!systemPrompt,
      });

      const resolvedWorkspaceId = getRequiredWorkspaceId();
      await sendStreamWithSessionRecovery(
        messageToSend,
        eventName,
        resolvedWorkspaceId,
        activeSessionId,
        model || undefined,
        imagesToSend,
      );
    } catch (error) {
      console.error("[AgentChat] Send failed:", error);
      streamDiagnosticsRef.current.markError(String(error));
      toast.error(`发送失败: ${error}`, {
        id: `send-error-${Date.now()}`,
        duration: 8000,
      });
      // Remove the optimistic assistant message on failure
      setMessages((prev) => prev.filter((msg) => msg.id !== assistantMsgId));
      setIsSending(false);
      currentStreamingSessionIdRef.current = null;
      if (unlisten) {
        unlisten();
      }
    }
  };

  // 删除单条消息
  const deleteMessage = (id: string) => {
    setMessages((prev) => prev.filter((msg) => msg.id !== id));
  };

  // 编辑消息
  const editMessage = (id: string, newContent: string) => {
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === id ? { ...msg, content: newContent } : msg,
      ),
    );
  };

  const clearMessages = (
    options: {
      showToast?: boolean;
      toastMessage?: string;
    } = {},
  ) => {
    const { showToast = true, toastMessage = "新话题已创建" } = options;
    const resolvedWorkspaceId = workspaceId?.trim();

    sessionResetVersionRef.current += 1;

    setMessages([]);
    setSessionId(null);
    currentStreamingSessionIdRef.current = null;
    _setRoundCount(0);
    setA2uiFormDataMap({});
    restoredWorkspaceRef.current = resolvedWorkspaceId || null;
    hydratedSessionRef.current = null;
    skipAutoRestoreRef.current = true;

    if (resolvedWorkspaceId) {
      saveTransient(`agent_curr_sessionId_${resolvedWorkspaceId}`, null);
      savePersisted(`agent_last_sessionId_${resolvedWorkspaceId}`, null);
      saveTransient(`agent_messages_${resolvedWorkspaceId}`, []);
      saveTransient(`agent_curr_roundCount_${resolvedWorkspaceId}`, 0);
    }

    // 清理旧版本兼容键，避免被误用为恢复候选
    saveTransient("agent_curr_sessionId", null);

    if (showToast) {
      toast.success(toastMessage);
    }
  };

  // 切换话题
  const switchTopic = async (topicId: string) => {
    if (topicId === sessionId && messages.length > 0) return;

    const resolvedWorkspaceId = workspaceId?.trim();
    if (resolvedWorkspaceId) {
      const topicWorkspaceId = loadPersisted<string | null>(
        `agent_session_workspace_${topicId}`,
        null,
      );
      if (topicWorkspaceId && topicWorkspaceId !== resolvedWorkspaceId) {
        console.warn("[AgentChat] cross_workspace_topic_blocked", {
          topicId,
          topicWorkspaceId,
          currentWorkspaceId: resolvedWorkspaceId,
        });
        toast.error("该话题不属于当前项目，已阻止切换");
        return;
      }
    }

    const restoreRequestVersion = sessionResetVersionRef.current;
    skipAutoRestoreRef.current = false;
    console.log("[useAgentChat] 切换话题:", topicId);

    try {
      // 从后端加载消息历史
      const agentMessages = await getAgentSessionMessages(topicId);
      console.log("[useAgentChat] 加载到消息数量:", agentMessages.length);

      // 加载 A2UI 表单数据
      let formDataMap: Record<
        string,
        { formId: string; formData: A2UIFormData }
      > = {};
      try {
        const forms = await A2UIFormAPI.getBySession(topicId);
        console.log("[useAgentChat] 加载到 A2UI 表单数量:", forms.length);
        for (const form of forms) {
          const msgId = `${topicId}-${form.messageId}`;
          formDataMap[msgId] = {
            formId: form.id,
            formData: form.formDataJson ? JSON.parse(form.formDataJson) : {},
          };
        }
      } catch (formError) {
        console.warn("[useAgentChat] 加载 A2UI 表单数据失败:", formError);
      }
      setA2uiFormDataMap(formDataMap);

      // 转换为前端 Message 格式
      // 注意：不设置 contentParts，让 StreamingRenderer 使用回退模式
      // 回退模式会直接解析 content 中的 A2UI 代码块
      const loadedMessages: Message[] = agentMessages
        .filter((msg) => msg.role === "user" || msg.role === "assistant")
        .map((msg, index) => {
          // 提取文本内容
          let content = "";
          if (typeof msg.content === "string") {
            content = msg.content;
          } else if (Array.isArray(msg.content)) {
            content = msg.content
              .filter(
                (part): part is { type: "text"; text: string } =>
                  part.type === "text",
              )
              .map((part) => part.text)
              .join("\n");
          }

          // 检查是否包含 A2UI 内容（用于调试）
          if (msg.role === "assistant" && content.includes("```a2ui")) {
            console.log(
              `[useAgentChat] 消息 ${index} 包含 A2UI 代码块，将由 StreamingRenderer 解析`,
            );
          }

          return {
            id: `${topicId}-${index}`,
            role: msg.role as "user" | "assistant",
            content,
            timestamp: new Date(msg.timestamp),
            isThinking: false,
            // 不设置 contentParts，让 StreamingRenderer 使用回退模式解析 A2UI
          };
        })
        // 过滤仅包含工具协议的空白 assistant 消息，避免历史里出现无意义气泡
        .filter(
          (msg) =>
            !(msg.role === "assistant" && msg.content.trim().length === 0),
        );

      if (restoreRequestVersion !== sessionResetVersionRef.current) {
        console.log("[useAgentChat] 忽略过期会话切换:", topicId);
        return;
      }

      console.log("[useAgentChat] 转换后消息数量:", loadedMessages.length);
      setMessages(loadedMessages);
      setSessionId(topicId);
    } catch (error) {
      if (restoreRequestVersion !== sessionResetVersionRef.current) {
        console.log("[useAgentChat] 忽略过期会话切换错误:", topicId);
        return;
      }

      console.error("[useAgentChat] 加载消息历史失败:", error);
      // 加载失败时回退到新会话态，避免卡在无效会话
      setMessages([]);
      setSessionId(null);
      currentStreamingSessionIdRef.current = null;
      saveTransient(getScopedSessionKey(), null);
      savePersisted(getScopedPersistedSessionKey(), null);
      toast.error("加载对话历史失败");
    }
  };

  // 自动恢复当前 workspace 最近会话
  useEffect(() => {
    const resolvedWorkspaceId = workspaceId?.trim();
    if (!resolvedWorkspaceId) return;
    if (skipAutoRestoreRef.current) return;
    if (sessionId) return;
    if (topics.length === 0) return;
    if (restoredWorkspaceRef.current === resolvedWorkspaceId) return;

    restoredWorkspaceRef.current = resolvedWorkspaceId;

    const scopedTransientCandidate = loadTransient<string | null>(
      getScopedSessionKey(),
      null,
    );
    const scopedPersistedCandidate = loadPersisted<string | null>(
      getScopedPersistedSessionKey(),
      null,
    );
    const legacyCandidate = loadTransient<string | null>(
      "agent_curr_sessionId",
      null,
    );

    const targetSessionId = resolveRestorableSessionId({
      workspaceId: resolvedWorkspaceId,
      topics,
      scopedTransientCandidate,
      scopedPersistedCandidate,
      legacyCandidate,
      resolveWorkspaceIdBySessionId: (candidate) =>
        loadPersisted<string | null>(
          `agent_session_workspace_${candidate}`,
          null,
        ),
    });

    if (!targetSessionId) {
      return;
    }

    switchTopic(targetSessionId).catch((error) => {
      console.warn("[useAgentChat] 自动恢复会话失败:", error);
      saveTransient(getScopedSessionKey(), null);
      savePersisted(getScopedPersistedSessionKey(), null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, sessionId, topics]);

  useEffect(() => {
    if (sessionId) {
      skipAutoRestoreRef.current = false;
    }
  }, [sessionId]);

  // 如果有 sessionId 但消息为空，主动回填历史消息
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
      console.warn("[useAgentChat] 会话水合失败:", error);
      hydratedSessionRef.current = null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, messages.length]);

  // 删除话题
  const deleteTopic = async (topicId: string) => {
    try {
      await deleteAgentSession(topicId);
      setTopics((prev) => prev.filter((t) => t.id !== topicId));

      // 如果删除的是当前话题，清空状态
      if (topicId === sessionId) {
        setSessionId(null);
        setMessages([]);
        currentStreamingSessionIdRef.current = null;
      }
      toast.success("话题已删除");
    } catch (_error) {
      toast.error("删除话题失败");
    }
  };

  // Status management wrappers
  const handleStartProcess = async () => {
    try {
      await startAgentProcess();
      setProcessStatus({ running: true });
    } catch (_e) {
      toast.error("Start failed");
    }
  };

  const handleStopProcess = async () => {
    try {
      await stopAgentProcess();
      setProcessStatus({ running: false });
      setSessionId(null); // Reset session on stop
      currentStreamingSessionIdRef.current = null;
    } catch (_e) {
      toast.error("Stop failed");
    }
  };

  // 停止当前发送中的消息
  const stopSending = async () => {
    const streamingSessionId = currentStreamingSessionIdRef.current;

    // 取消事件监听
    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }

    // 更新当前消息状态为已停止
    if (currentAssistantMsgIdRef.current) {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === currentAssistantMsgIdRef.current
            ? {
                ...msg,
                isThinking: false,
                content: msg.content || "(已停止生成)",
              }
            : msg,
        ),
      );
      currentAssistantMsgIdRef.current = null;
    }

    currentStreamingSessionIdRef.current = null;
    setIsSending(false);
    toast.info("已停止生成");

    if (streamingSessionId) {
      try {
        await stopAsterSession(streamingSessionId);
      } catch (error) {
        console.warn("[useAgentChat] 停止会话失败:", error);
      }
    }
  };

  // 触发 AI 引导（不显示用户消息，直接让 AI 开始引导）
  const triggerAIGuide = async () => {
    // 只创建 assistant 消息占位符，不创建用户消息
    const assistantMsgId = crypto.randomUUID();
    const assistantMsg: Message = {
      id: assistantMsgId,
      role: "assistant",
      content: "",
      timestamp: new Date(),
      isThinking: true,
      thinkingContent: "正在准备创作引导...",
      contentParts: [],
    };

    setMessages((prev) => [...prev, assistantMsg]);
    setIsSending(true);

    // 保存当前消息 ID 到 ref，用于停止时更新状态
    currentAssistantMsgIdRef.current = assistantMsgId;

    // 用于累积流式内容
    let accumulatedContent = "";
    let unlisten: UnlistenFn | null = null;

    // 辅助函数（与 sendMessage 相同）
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

    const appendThinkingToParts = (
      parts: ContentPart[],
      text: string,
    ): ContentPart[] => {
      const newParts = [...parts];
      const lastPart = newParts[newParts.length - 1];

      if (lastPart && lastPart.type === "thinking") {
        newParts[newParts.length - 1] = {
          type: "thinking",
          text: lastPart.text + text,
        };
      } else {
        newParts.push({ type: "thinking", text });
      }
      return newParts;
    };

    const addActionRequiredToParts = (
      parts: ContentPart[],
      actionRequired: ActionRequired,
    ): ContentPart[] => {
      const newParts = [...parts];
      newParts.push({ type: "action_required", actionRequired });
      return newParts;
    };

    try {
      // 确保有一个活跃的 session
      const activeSessionId = await _ensureSession();
      if (!activeSessionId) {
        throw new Error("无法创建或获取会话");
      }
      currentStreamingSessionIdRef.current = activeSessionId;

      // 创建唯一事件名称
      const eventName = `agent_stream_${assistantMsgId}`;

      // 设置事件监听器（流式接收）
      console.log(
        `[AgentChat] triggerAIGuide 设置事件监听器: ${eventName}, sessionId: ${activeSessionId}`,
      );
      streamDiagnosticsRef.current.start({
        sessionId: activeSessionId,
        eventName,
        assistantMessageId: assistantMsgId,
        source: "triggerAIGuide",
      });
      unlisten = await safeListen<StreamEvent>(eventName, (event) => {
        console.log(
          "[AgentChat] triggerAIGuide 收到事件:",
          eventName,
          event.payload,
        );
        const data = parseStreamEvent(event.payload);
        if (!data) {
          console.warn(
            "[AgentChat] triggerAIGuide 解析事件失败:",
            event.payload,
          );
          streamDiagnosticsRef.current.recordInvalidEvent(event.payload);
          return;
        }
        streamDiagnosticsRef.current.record(data);

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

          case "thinking_delta":
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMsgId
                  ? {
                      ...msg,
                      thinkingContent: (msg.thinkingContent || "") + data.text,
                      isThinking: true,
                      contentParts: appendThinkingToParts(
                        msg.contentParts || [],
                        data.text,
                      ),
                    }
                  : msg,
              ),
            );
            break;

          case "done":
            console.log("[AgentChat] triggerAIGuide 收到 done 事件");
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMsgId
                  ? {
                      ...msg,
                      content: accumulatedContent || msg.content,
                    }
                  : msg,
              ),
            );
            break;

          case "final_done":
            console.log("[AgentChat] triggerAIGuide 收到 final_done 事件");
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMsgId
                  ? {
                      ...msg,
                      isThinking: false,
                      content: accumulatedContent || "(No response)",
                    }
                  : msg,
              ),
            );
            setIsSending(false);
            unlistenRef.current = null;
            currentAssistantMsgIdRef.current = null;
            currentStreamingSessionIdRef.current = null;
            streamDiagnosticsRef.current.markDone();
            if (unlisten) {
              unlisten();
              unlisten = null;
            }
            break;

          case "error":
            console.error(
              "[AgentChat] triggerAIGuide Stream error:",
              data.message,
            );
            toast.error(`响应错误: ${data.message}`, {
              id: `stream-error-${Date.now()}`,
              duration: 8000,
            });
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
            unlistenRef.current = null;
            currentAssistantMsgIdRef.current = null;
            currentStreamingSessionIdRef.current = null;
            streamDiagnosticsRef.current.markError(data.message);
            if (unlisten) {
              unlisten();
              unlisten = null;
            }
            break;

          case "tool_start": {
            console.log(`[Tool Start] ${data.tool_name} (${data.tool_id})`);
            playToolcallSound();

            const newToolCall = {
              id: data.tool_id,
              name: data.tool_name,
              arguments: data.arguments,
              status: "running" as const,
              startTime: new Date(),
            };

            const toolName = data.tool_name.toLowerCase();
            if (toolName.includes("write") || toolName.includes("create")) {
              try {
                const args = JSON.parse(data.arguments || "{}");
                const filePath = args.path || args.file_path || args.filePath;
                const content = args.content || args.text || "";
                if (filePath && content && onWriteFile) {
                  onWriteFile(content, filePath);
                }
              } catch (e) {
                console.warn("[Tool Start] 解析工具参数失败:", e);
              }
            }

            setMessages((prev) =>
              prev.map((msg) => {
                if (msg.id !== assistantMsgId) return msg;
                const existingToolCall = msg.toolCalls?.find(
                  (tc) => tc.id === data.tool_id,
                );
                if (existingToolCall) return msg;

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
            break;
          }

          case "action_required": {
            console.log(
              `[Action Required] ${data.action_type} (${data.request_id})`,
            );

            const actionRequired: ActionRequired = {
              requestId: data.request_id,
              actionType: data.action_type as
                | "tool_confirmation"
                | "ask_user"
                | "elicitation",
              toolName: data.tool_name,
              arguments: data.arguments,
              prompt: data.prompt,
              questions: data.questions,
              requestedSchema: data.requested_schema,
            };

            setMessages((prev) =>
              prev.map((msg) => {
                if (msg.id !== assistantMsgId) return msg;
                const existingRequest = msg.actionRequests?.find(
                  (ar) => ar.requestId === data.request_id,
                );
                if (existingRequest) return msg;

                return {
                  ...msg,
                  actionRequests: [
                    ...(msg.actionRequests || []),
                    actionRequired,
                  ],
                  contentParts: addActionRequiredToParts(
                    msg.contentParts || [],
                    actionRequired,
                  ),
                };
              }),
            );
            break;
          }

          case "tool_end": {
            console.log(`[Tool End] ${data.tool_id}`);
            setMessages((prev) =>
              prev.map((msg) => {
                if (msg.id !== assistantMsgId) return msg;

                const updatedToolCalls = (msg.toolCalls || []).map((tc) =>
                  tc.id === data.tool_id
                    ? {
                        ...tc,
                        status: data.result.success
                          ? ("completed" as const)
                          : ("failed" as const),
                        result: data.result,
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
                          result: data.result,
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
          }
        }
      });

      // 保存 unlisten 到 ref
      unlistenRef.current = unlisten;

      // 发送空消息，让 AI 根据系统提示词开始引导
      console.log("[AgentChat] triggerAIGuide 发送空消息触发引导");
      const resolvedWorkspaceId = getRequiredWorkspaceId();
      await sendStreamWithSessionRecovery(
        "", // 空消息，让 AI 根据系统提示词开始引导
        eventName,
        resolvedWorkspaceId,
        activeSessionId,
        model || undefined,
      );
    } catch (error) {
      console.error("[AgentChat] triggerAIGuide failed:", error);
      streamDiagnosticsRef.current.markError(String(error));
      toast.error(`启动引导失败: ${error}`, {
        id: `guide-error-${Date.now()}`,
        duration: 8000,
      });
      setMessages((prev) => prev.filter((msg) => msg.id !== assistantMsgId));
      setIsSending(false);
      currentStreamingSessionIdRef.current = null;
      if (unlisten) {
        unlisten();
      }
    }
  };

  // 处理权限确认响应
  const handlePermissionResponse = async (response: ConfirmResponse) => {
    try {
      const findActionTypeByRequestId = (
        requestId: string,
      ): ConfirmResponse["actionType"] => {
        for (const message of messages) {
          const action = message.actionRequests?.find(
            (item) => item.requestId === requestId,
          );
          if (action) {
            return action.actionType;
          }
        }
        return undefined;
      };

      const actionType =
        response.actionType || findActionTypeByRequestId(response.requestId);
      const normalizedResponse =
        typeof response.response === "string" ? response.response.trim() : "";
      let submittedUserData: unknown = response.userData;

      if (actionType === "elicitation" || actionType === "ask_user") {
        const activeSessionId =
          currentStreamingSessionIdRef.current || sessionId;
        if (!activeSessionId) {
          throw new Error("缺少会话 ID，无法提交 elicitation 响应");
        }

        let userData: unknown;
        if (!response.confirmed) {
          // 传空字符串给 ask_bridge，表示用户取消（extract_response 会返回 None）
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

        await submitAsterElicitationResponse(
          activeSessionId,
          response.requestId,
          userData,
        );
      } else {
        await confirmAsterAction(
          response.requestId,
          response.confirmed,
          response.response,
        );
      }

      const shouldPersistSubmittedAction =
        actionType === "elicitation" || actionType === "ask_user";

      // ask/elicitation 提交后保留只读回显，tool_confirmation 继续移除
      setMessages((prev) =>
        prev.map((msg) => ({
          ...msg,
          actionRequests: shouldPersistSubmittedAction
            ? msg.actionRequests?.map((ar) =>
                ar.requestId === response.requestId
                  ? {
                      ...ar,
                      status: "submitted" as const,
                      submittedResponse: normalizedResponse || undefined,
                      submittedUserData,
                    }
                  : ar,
              )
            : msg.actionRequests?.filter(
                (ar) => ar.requestId !== response.requestId,
              ),
          contentParts: shouldPersistSubmittedAction
            ? msg.contentParts?.map((part) =>
                part.type === "action_required" &&
                part.actionRequired.requestId === response.requestId
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
                  part.actionRequired.requestId !== response.requestId,
              ),
        })),
      );

      toast.success(response.confirmed ? "已提交操作" : "已拒绝操作");
    } catch (error) {
      console.error("[AgentChat] 权限确认响应失败:", error);
      toast.error("权限确认响应失败");
    }
  };

  // A2UI 表单数据保存（防抖由 A2UIRenderer 处理）
  const saveA2UIFormData = useCallback(
    async (formId: string, formData: A2UIFormData) => {
      try {
        await A2UIFormAPI.saveFormData(formId, JSON.stringify(formData));
        console.log("[useAgentChat] A2UI 表单数据已保存:", formId);
      } catch (error) {
        console.error("[useAgentChat] 保存 A2UI 表单数据失败:", error);
      }
    },
    [],
  );

  // A2UI 表单提交处理
  const handleA2UISubmit = useCallback(
    async (formData: A2UIFormData, messageId: string) => {
      console.log("[useAgentChat] A2UI 表单提交:", messageId, formData);

      // 获取或创建表单记录
      const existingForm = a2uiFormDataMap[messageId];
      if (existingForm) {
        try {
          await A2UIFormAPI.submit(
            existingForm.formId,
            JSON.stringify(formData),
          );
          toast.success("表单已提交");
        } catch (error) {
          console.error("[useAgentChat] 提交 A2UI 表单失败:", error);
          toast.error("表单提交失败");
        }
      }

      // TODO: 可以在这里触发后续的 AI 处理流程
    },
    [a2uiFormDataMap],
  );

  return {
    processStatus,
    handleStartProcess,
    handleStopProcess,

    // Config
    providerType,
    setProviderType,
    model,
    setModel,
    providerConfig, // 动态模型配置
    isConfigLoading, // 配置加载状态

    // Chat
    messages,
    isSending,
    sendMessage,
    stopSending,
    clearMessages,
    deleteMessage,
    editMessage,
    handlePermissionResponse, // 权限确认响应处理
    triggerAIGuide, // 触发 AI 引导

    // 话题管理
    topics,
    sessionId,
    switchTopic,
    deleteTopic,
    loadTopics,
    renameTopic, // 重命名话题
    generateSmartTitle, // 智能标题生成

    // A2UI 表单持久化
    a2uiFormDataMap,
    saveA2UIFormData,
    handleA2UISubmit,
  };
}
