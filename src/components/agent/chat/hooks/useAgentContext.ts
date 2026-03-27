import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { toast } from "sonner";
import { updateProject } from "@/lib/api/project";
import type { AsterExecutionStrategy } from "@/lib/api/agentRuntime";
import { notifyProjectRuntimeAgentsGuide } from "@/components/workspace/services/runtimeAgentsGuideService";
import type {
  SendMessageFn,
  SessionModelPreference,
  WorkspacePathMissingState,
} from "./agentChatShared";
import {
  loadPersistedSessionWorkspaceId,
  savePersistedSessionWorkspaceId,
} from "./agentProjectStorage";
import {
  getAgentPreferenceKeys,
  getExecutionStrategyStorageKey,
  getSessionModelPreferenceKey,
  loadPersisted,
  resolvePersistedExecutionStrategy,
  resolveWorkspaceAgentPreferences,
  savePersisted,
} from "./agentChatStorage";
import { normalizeProjectId } from "../utils/topicProjectResolution";
import { normalizeExecutionStrategy } from "./agentChatCoreUtils";
import { useWechatRuntimeModelSync } from "./useWechatRuntimeModelSync";

interface UseAgentContextOptions {
  workspaceId: string;
  sessionIdRef: MutableRefObject<string | null>;
  topicsUpdaterRef: MutableRefObject<
    ((sessionId: string, executionStrategy: AsterExecutionStrategy) => void) | null
  >;
  sendMessageRef: MutableRefObject<SendMessageFn | null>;
  runtime: {
    setSessionExecutionStrategy: (
      sessionId: string,
      executionStrategy: AsterExecutionStrategy,
    ) => Promise<void>;
    setSessionProviderSelection?: (
      sessionId: string,
      providerType: string,
      model: string,
    ) => Promise<void>;
  };
}

export function useAgentContext(options: UseAgentContextOptions) {
  const {
    workspaceId,
    sessionIdRef,
    topicsUpdaterRef,
    sendMessageRef,
    runtime,
  } = options;

  const getRequiredWorkspaceId = useCallback((): string => {
    const resolvedWorkspaceId = workspaceId?.trim();
    if (!resolvedWorkspaceId) {
      throw new Error("缺少项目工作区，请先选择项目后再使用 Agent");
    }
    return resolvedWorkspaceId;
  }, [workspaceId]);

  const initialPreferencesRef = useRef(
    resolveWorkspaceAgentPreferences(workspaceId),
  );
  const [providerType, setProviderTypeState] = useState(
    () => initialPreferencesRef.current.providerType,
  );
  const [model, setModelState] = useState(
    () => initialPreferencesRef.current.model,
  );
  const [executionStrategy, setExecutionStrategyState] =
    useState<AsterExecutionStrategy>(() =>
      resolvePersistedExecutionStrategy(workspaceId),
    );
  const [workspacePathMissing, setWorkspacePathMissing] =
    useState<WorkspacePathMissingState | null>(null);

  const providerTypeRef = useRef(providerType);
  const modelRef = useRef(model);
  const scopedProviderPrefKeyRef = useRef<string>(
    getAgentPreferenceKeys(workspaceId).providerKey,
  );
  const scopedModelPrefKeyRef = useRef<string>(
    getAgentPreferenceKeys(workspaceId).modelKey,
  );
  const pendingSessionProviderSelectionSyncRef = useRef(
    new Map<string, SessionModelPreference>(),
  );
  const syncedSessionProviderSelectionRef = useRef(
    new Map<string, SessionModelPreference>(),
  );
  const pendingSessionExecutionStrategySyncRef = useRef(
    new Map<string, AsterExecutionStrategy>(),
  );
  const syncedSessionExecutionStrategyRef = useRef(
    new Map<string, AsterExecutionStrategy>(),
  );

  providerTypeRef.current = providerType;
  modelRef.current = model;

  useWechatRuntimeModelSync({
    providerId: providerType,
    modelId: model,
    source: "workspace",
  });

  const persistSessionModelPreference = useCallback(
    (
      targetSessionId: string,
      targetProviderType: string,
      targetModel: string,
    ) => {
      savePersisted(getSessionModelPreferenceKey(workspaceId, targetSessionId), {
        providerType: targetProviderType,
        model: targetModel,
      });
    },
    [workspaceId],
  );

  const loadSessionModelPreference = useCallback(
    (sessionId: string): SessionModelPreference | null => {
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
    },
    [workspaceId],
  );

  const markSessionModelPreferenceSynced = useCallback(
    (
      targetSessionId: string,
      targetProviderType: string,
      targetModel: string,
    ) => {
      const trimmedSessionId = targetSessionId.trim();
      if (!trimmedSessionId) {
        return;
      }
      syncedSessionProviderSelectionRef.current.set(trimmedSessionId, {
        providerType: targetProviderType,
        model: targetModel,
      });
    },
    [],
  );

  const getSyncedSessionModelPreference = useCallback(
    (targetSessionId: string): SessionModelPreference | null => {
      const trimmedSessionId = targetSessionId.trim();
      if (!trimmedSessionId) {
        return null;
      }
      return (
        syncedSessionProviderSelectionRef.current.get(trimmedSessionId) || null
      );
    },
    [],
  );

  const markSessionExecutionStrategySynced = useCallback(
    (
      targetSessionId: string,
      targetExecutionStrategy: AsterExecutionStrategy,
    ) => {
      const trimmedSessionId = targetSessionId.trim();
      if (!trimmedSessionId) {
        return;
      }
      syncedSessionExecutionStrategyRef.current.set(
        trimmedSessionId,
        normalizeExecutionStrategy(targetExecutionStrategy),
      );
    },
    [],
  );

  const getSyncedSessionExecutionStrategy = useCallback(
    (targetSessionId: string): AsterExecutionStrategy | null => {
      const trimmedSessionId = targetSessionId.trim();
      if (!trimmedSessionId) {
        return null;
      }
      return (
        syncedSessionExecutionStrategyRef.current.get(trimmedSessionId) || null
      );
    },
    [],
  );

  const scheduleSessionProviderSelectionSync = useCallback(
    (
      targetSessionId: string,
      targetProviderType: string,
      targetModel: string,
    ) => {
      persistSessionModelPreference(
        targetSessionId,
        targetProviderType,
        targetModel,
      );

      const syncSelection = runtime.setSessionProviderSelection;
      const trimmedSessionId = targetSessionId.trim();
      if (!syncSelection || !trimmedSessionId) {
        return;
      }

      const pending = pendingSessionProviderSelectionSyncRef.current;
      const alreadyQueued = pending.has(trimmedSessionId);
      pending.set(trimmedSessionId, {
        providerType: targetProviderType,
        model: targetModel,
      });
      if (alreadyQueued) {
        return;
      }

      queueMicrotask(() => {
        const latestPreference = pending.get(trimmedSessionId);
        pending.delete(trimmedSessionId);
        if (!latestPreference) {
          return;
        }

        void syncSelection(
          trimmedSessionId,
          latestPreference.providerType,
          latestPreference.model,
        )
          .then(() => {
            markSessionModelPreferenceSynced(
              trimmedSessionId,
              latestPreference.providerType,
              latestPreference.model,
            );
          })
          .catch((error) => {
            console.warn("[AsterChat] 回写会话 provider/model 失败:", error);
          });
      });
    },
    [markSessionModelPreferenceSynced, persistSessionModelPreference, runtime],
  );

  const filterSessionsByWorkspace = useCallback(
    <T extends { id: string; workspace_id?: string | null }>(
      sessions: T[],
    ): T[] => {
      const resolvedWorkspaceId = normalizeProjectId(workspaceId);
      if (!resolvedWorkspaceId) {
        return [];
      }

      return sessions.filter((session) => {
        const runtimeWorkspaceId = normalizeProjectId(session.workspace_id);
        if (runtimeWorkspaceId) {
          savePersistedSessionWorkspaceId(session.id, runtimeWorkspaceId);
          return runtimeWorkspaceId === resolvedWorkspaceId;
        }

        const mappedWorkspaceId = loadPersistedSessionWorkspaceId(session.id);

        if (!mappedWorkspaceId) {
          return true;
        }

        return mappedWorkspaceId === resolvedWorkspaceId;
      });
    },
    [workspaceId],
  );

  const applySessionModelPreference = useCallback(
    (sessionId: string, preference: SessionModelPreference) => {
      providerTypeRef.current = preference.providerType;
      modelRef.current = preference.model;
      setProviderTypeState(preference.providerType);
      setModelState(preference.model);
      savePersisted(scopedProviderPrefKeyRef.current, preference.providerType);
      savePersisted(scopedModelPrefKeyRef.current, preference.model);
      persistSessionModelPreference(
        sessionId,
        preference.providerType,
        preference.model,
      );
      markSessionModelPreferenceSynced(
        sessionId,
        preference.providerType,
        preference.model,
      );
    },
    [markSessionModelPreferenceSynced, persistSessionModelPreference],
  );

  const setProviderType = useCallback(
    (nextProviderType: string) => {
      providerTypeRef.current = nextProviderType;
      setProviderTypeState(nextProviderType);
      savePersisted(scopedProviderPrefKeyRef.current, nextProviderType);

      const currentSessionId = sessionIdRef.current;
      if (currentSessionId) {
        scheduleSessionProviderSelectionSync(
          currentSessionId,
          nextProviderType,
          modelRef.current,
        );
      }
    },
    [scheduleSessionProviderSelectionSync, sessionIdRef],
  );

  const setModel = useCallback(
    (nextModel: string) => {
      modelRef.current = nextModel;
      setModelState(nextModel);
      savePersisted(scopedModelPrefKeyRef.current, nextModel);

      const currentSessionId = sessionIdRef.current;
      if (currentSessionId) {
        scheduleSessionProviderSelectionSync(
          currentSessionId,
          providerTypeRef.current,
          nextModel,
        );
      }
    },
    [scheduleSessionProviderSelectionSync, sessionIdRef],
  );

  const scheduleSessionExecutionStrategySync = useCallback(
    (
      targetSessionId: string,
      targetExecutionStrategy: AsterExecutionStrategy,
    ) => {
      const trimmedSessionId = targetSessionId.trim();
      if (!trimmedSessionId) {
        return;
      }

      const pending = pendingSessionExecutionStrategySyncRef.current;
      const alreadyQueued = pending.has(trimmedSessionId);
      pending.set(trimmedSessionId, targetExecutionStrategy);
      if (alreadyQueued) {
        return;
      }

      queueMicrotask(() => {
        const latestExecutionStrategy = pending.get(trimmedSessionId);
        pending.delete(trimmedSessionId);
        if (!latestExecutionStrategy) {
          return;
        }

        void runtime
          .setSessionExecutionStrategy(
            trimmedSessionId,
            latestExecutionStrategy,
          )
          .then(() => {
            markSessionExecutionStrategySynced(
              trimmedSessionId,
              latestExecutionStrategy,
            );
            topicsUpdaterRef.current?.(
              trimmedSessionId,
              latestExecutionStrategy,
            );
          })
          .catch((error) => {
            console.warn("[AsterChat] 更新会话执行策略失败:", error);
          });
      });
    },
    [markSessionExecutionStrategySynced, runtime, topicsUpdaterRef],
  );

  const setExecutionStrategy = useCallback(
    (nextStrategy: AsterExecutionStrategy) => {
      const normalized = normalizeExecutionStrategy(nextStrategy);
      setExecutionStrategyState(normalized);

      const currentSessionId = sessionIdRef.current;
      if (currentSessionId) {
        scheduleSessionExecutionStrategySync(currentSessionId, normalized);
      }
    },
    [scheduleSessionExecutionStrategySync, sessionIdRef],
  );

  useEffect(() => {
    const { providerKey, modelKey } = getAgentPreferenceKeys(workspaceId);
    scopedProviderPrefKeyRef.current = providerKey;
    scopedModelPrefKeyRef.current = modelKey;
    pendingSessionProviderSelectionSyncRef.current.clear();
    syncedSessionProviderSelectionRef.current.clear();
    pendingSessionExecutionStrategySyncRef.current.clear();
    syncedSessionExecutionStrategyRef.current.clear();

    const scopedPreferences = resolveWorkspaceAgentPreferences(workspaceId);
    providerTypeRef.current = scopedPreferences.providerType;
    modelRef.current = scopedPreferences.model;
    setProviderTypeState(scopedPreferences.providerType);
    setModelState(scopedPreferences.model);

    savePersisted(providerKey, scopedPreferences.providerType);
    savePersisted(modelKey, scopedPreferences.model);

    const resolvedWorkspaceId = workspaceId?.trim();
    if (!resolvedWorkspaceId) {
      setExecutionStrategyState("react");
      return;
    }
    setExecutionStrategyState(
      resolvePersistedExecutionStrategy(resolvedWorkspaceId),
    );
  }, [workspaceId]);

  useEffect(() => {
    savePersisted(scopedProviderPrefKeyRef.current, providerType);
  }, [providerType]);

  useEffect(() => {
    savePersisted(scopedModelPrefKeyRef.current, model);
  }, [model]);

  useEffect(() => {
    const storageKey = getExecutionStrategyStorageKey(workspaceId);
    if (!storageKey) {
      return;
    }
    savePersisted(storageKey, executionStrategy);
  }, [executionStrategy, workspaceId]);

  const triggerAIGuide = useCallback(async (initialPrompt?: string) => {
    const sendMessage = sendMessageRef.current;
    if (!sendMessage) {
      throw new Error("发送器尚未就绪");
    }
    await sendMessage(initialPrompt?.trim() || "", [], false, false, true);
  }, [sendMessageRef]);

  const fixWorkspacePathAndRetry = useCallback(
    async (newPath: string) => {
      if (!workspacePathMissing) return;
      const sendMessage = sendMessageRef.current;
      if (!sendMessage) {
        throw new Error("发送器尚未就绪");
      }
      const { content: retryContent, images: retryImages } =
        workspacePathMissing;
      setWorkspacePathMissing(null);
      try {
        await updateProject(workspaceId, { rootPath: newPath });
        notifyProjectRuntimeAgentsGuide(
          {
            id: workspaceId,
            rootPath: newPath,
          },
          {
            successMessage: "工作区目录已重新关联",
            showSuccessWhenGuideAlreadySeen: false,
          },
        );
        await sendMessage(retryContent, retryImages, false, false, true);
      } catch (err) {
        toast.error(
          `修复路径失败: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    [sendMessageRef, workspaceId, workspacePathMissing],
  );

  const dismissWorkspacePathError = useCallback(() => {
    setWorkspacePathMissing(null);
  }, []);

  return {
    providerType,
    setProviderType,
    providerTypeRef,
    model,
    setModel,
    modelRef,
    executionStrategy,
    setExecutionStrategy,
    setExecutionStrategyState,
    workspacePathMissing,
    setWorkspacePathMissing,
    getRequiredWorkspaceId,
    persistSessionModelPreference,
    loadSessionModelPreference,
    applySessionModelPreference,
    markSessionModelPreferenceSynced,
    getSyncedSessionModelPreference,
    markSessionExecutionStrategySynced,
    getSyncedSessionExecutionStrategy,
    filterSessionsByWorkspace,
    triggerAIGuide,
    fixWorkspacePathAndRetry,
    dismissWorkspacePathError,
  };
}
