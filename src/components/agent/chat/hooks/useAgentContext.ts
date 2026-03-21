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
  getAgentPreferenceKeys,
  getSessionModelPreferenceKey,
  loadPersisted,
  loadPersistedString,
  resolveWorkspaceAgentPreferences,
  savePersisted,
} from "./agentChatStorage";
import { normalizeExecutionStrategy } from "./agentChatCoreUtils";

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

  providerTypeRef.current = providerType;
  modelRef.current = model;

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

  const filterSessionsByWorkspace = useCallback(
    <T extends { id: string }>(sessions: T[]): T[] => {
      const resolvedWorkspaceId = workspaceId?.trim();
      if (!resolvedWorkspaceId) {
        return [];
      }

      return sessions.filter((session) => {
        const mappedWorkspaceId = loadPersistedString(
          `agent_session_workspace_${session.id}`,
        );

        if (!mappedWorkspaceId || mappedWorkspaceId === "__invalid__") {
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
    },
    [persistSessionModelPreference],
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
    [persistSessionModelPreference, sessionIdRef],
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
    [persistSessionModelPreference, sessionIdRef],
  );

  const setExecutionStrategy = useCallback(
    (nextStrategy: AsterExecutionStrategy) => {
      const normalized = normalizeExecutionStrategy(nextStrategy);
      setExecutionStrategyState(normalized);

      const currentSessionId = sessionIdRef.current;
      if (!currentSessionId) {
        return;
      }

      runtime
        .setSessionExecutionStrategy(currentSessionId, normalized)
        .then(() => {
          topicsUpdaterRef.current?.(currentSessionId, normalized);
        })
        .catch((error) => {
          console.warn("[AsterChat] 更新会话执行策略失败:", error);
        });
    },
    [runtime, sessionIdRef, topicsUpdaterRef],
  );

  useEffect(() => {
    const { providerKey, modelKey } = getAgentPreferenceKeys(workspaceId);
    scopedProviderPrefKeyRef.current = providerKey;
    scopedModelPrefKeyRef.current = modelKey;

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
    const persistedStrategy = loadPersisted<string | null>(
      `aster_execution_strategy_${resolvedWorkspaceId}`,
      "react",
    );
    setExecutionStrategyState(normalizeExecutionStrategy(persistedStrategy));
  }, [workspaceId]);

  useEffect(() => {
    savePersisted(scopedProviderPrefKeyRef.current, providerType);
  }, [providerType]);

  useEffect(() => {
    savePersisted(scopedModelPrefKeyRef.current, model);
  }, [model]);

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
    filterSessionsByWorkspace,
    triggerAIGuide,
    fixWorkspacePathAndRetry,
    dismissWorkspacePathError,
  };
}
