import { useCallback, useEffect, useRef, useState } from "react";
import {
  getAgentRuntimeSession,
  listAgentRuntimeSessions,
  type AsterExecutionStrategy,
  type AsterSessionExecutionRuntime,
} from "@/lib/api/agentRuntime";
import { normalizeProjectId } from "../utils/topicProjectResolution";
import {
  createExecutionRuntimeFromSessionDetail,
  createSessionModelPreferenceFromExecutionRuntime,
} from "../utils/sessionExecutionRuntime";
import { normalizeExecutionStrategy } from "./agentChatCoreUtils";
import {
  getAgentPreferenceKeys,
  getExecutionStrategyStorageKey,
  resolvePersistedExecutionStrategy,
  resolveWorkspaceAgentPreferences,
  savePersisted,
} from "./agentChatStorage";
import { useWechatRuntimeModelSync } from "./useWechatRuntimeModelSync";

export function useHomeShellAgentPreferences(projectId?: string | null) {
  const normalizedProjectId = normalizeProjectId(projectId);
  const initialPreferences =
    resolveWorkspaceAgentPreferences(normalizedProjectId);
  const manualMutationVersionRef = useRef(0);
  const [providerType, setProviderTypeState] = useState(
    initialPreferences.providerType,
  );
  const [model, setModelState] = useState(initialPreferences.model);
  const [executionStrategy, setExecutionStrategyState] =
    useState<AsterExecutionStrategy>(() =>
      resolvePersistedExecutionStrategy(normalizedProjectId),
    );
  const [recentExecutionRuntime, setRecentExecutionRuntime] =
    useState<AsterSessionExecutionRuntime | null>(null);

  useWechatRuntimeModelSync({
    providerId: providerType,
    modelId: model,
    source: "home-shell",
  });

  useEffect(() => {
    const scopedPreferences =
      resolveWorkspaceAgentPreferences(normalizedProjectId);
    const persistedExecutionStrategy =
      resolvePersistedExecutionStrategy(normalizedProjectId);
    setProviderTypeState(scopedPreferences.providerType);
    setModelState(scopedPreferences.model);
    setExecutionStrategyState(persistedExecutionStrategy);
    setRecentExecutionRuntime(null);
    manualMutationVersionRef.current = 0;

    if (!normalizedProjectId) {
      return;
    }

    let cancelled = false;
    const hydrationVersion = manualMutationVersionRef.current;

    void (async () => {
      try {
        const sessions = await listAgentRuntimeSessions();
        const latestSession = sessions
          .filter((session) => session.workspace_id === normalizedProjectId)
          .sort((left, right) => right.updated_at - left.updated_at)[0];
        if (!latestSession) {
          return;
        }

        const detail = await getAgentRuntimeSession(latestSession.id);
        if (cancelled) {
          return;
        }

        setRecentExecutionRuntime(createExecutionRuntimeFromSessionDetail(detail));

        if (manualMutationVersionRef.current !== hydrationVersion) {
          return;
        }

        const runtimePreference =
          createSessionModelPreferenceFromExecutionRuntime(
            detail.execution_runtime,
          );
        const nextExecutionStrategy = normalizeExecutionStrategy(
          detail.execution_strategy ||
            latestSession.execution_strategy ||
            persistedExecutionStrategy,
        );

        if (runtimePreference) {
          setProviderTypeState(runtimePreference.providerType);
          setModelState(runtimePreference.model);
          const { providerKey, modelKey } =
            getAgentPreferenceKeys(normalizedProjectId);
          savePersisted(providerKey, runtimePreference.providerType);
          savePersisted(modelKey, runtimePreference.model);
        }

        setExecutionStrategyState(nextExecutionStrategy);
        const executionStrategyStorageKey =
          getExecutionStrategyStorageKey(normalizedProjectId);
        if (executionStrategyStorageKey) {
          savePersisted(executionStrategyStorageKey, nextExecutionStrategy);
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        console.warn(
          "[AgentChatHomeShell] 读取最近 session runtime 失败，继续沿用本地项目偏好:",
          error,
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [normalizedProjectId]);

  const setProviderType = useCallback(
    (nextProviderType: string) => {
      manualMutationVersionRef.current += 1;
      setProviderTypeState(nextProviderType);
      const { providerKey } = getAgentPreferenceKeys(normalizedProjectId);
      savePersisted(providerKey, nextProviderType);
    },
    [normalizedProjectId],
  );

  const setModel = useCallback(
    (nextModel: string) => {
      manualMutationVersionRef.current += 1;
      setModelState(nextModel);
      const { modelKey } = getAgentPreferenceKeys(normalizedProjectId);
      savePersisted(modelKey, nextModel);
    },
    [normalizedProjectId],
  );

  const setExecutionStrategy = useCallback(
    (nextExecutionStrategy: AsterExecutionStrategy) => {
      manualMutationVersionRef.current += 1;
      const normalized = normalizeExecutionStrategy(nextExecutionStrategy);
      setExecutionStrategyState(normalized);
      const storageKey = getExecutionStrategyStorageKey(normalizedProjectId);
      if (!storageKey) {
        return;
      }
      savePersisted(storageKey, normalized);
    },
    [normalizedProjectId],
  );

  return {
    providerType,
    setProviderType,
    model,
    setModel,
    executionStrategy,
    setExecutionStrategy,
    recentExecutionRuntime,
  };
}
