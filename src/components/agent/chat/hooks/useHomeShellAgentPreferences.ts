import { useCallback, useEffect, useState } from "react";
import type { AsterExecutionStrategy } from "@/lib/api/agentRuntime";
import { normalizeProjectId } from "../utils/topicProjectResolution";
import { normalizeExecutionStrategy } from "./agentChatCoreUtils";
import {
  getAgentPreferenceKeys,
  loadPersisted,
  resolveWorkspaceAgentPreferences,
  savePersisted,
} from "./agentChatStorage";

function resolveExecutionStrategyStorageKey(
  projectId?: string | null,
): string | null {
  const normalizedProjectId = normalizeProjectId(projectId);
  if (!normalizedProjectId) {
    return null;
  }

  return `aster_execution_strategy_${normalizedProjectId}`;
}

function resolvePersistedExecutionStrategy(
  projectId?: string | null,
): AsterExecutionStrategy {
  const storageKey = resolveExecutionStrategyStorageKey(projectId);
  if (!storageKey) {
    return "react";
  }

  return normalizeExecutionStrategy(
    loadPersisted<string | null>(storageKey, "react"),
  );
}

export function useHomeShellAgentPreferences(projectId?: string | null) {
  const normalizedProjectId = normalizeProjectId(projectId);
  const initialPreferences =
    resolveWorkspaceAgentPreferences(normalizedProjectId);
  const [providerType, setProviderTypeState] = useState(
    initialPreferences.providerType,
  );
  const [model, setModelState] = useState(initialPreferences.model);
  const [executionStrategy, setExecutionStrategyState] =
    useState<AsterExecutionStrategy>(() =>
      resolvePersistedExecutionStrategy(normalizedProjectId),
    );

  useEffect(() => {
    const scopedPreferences =
      resolveWorkspaceAgentPreferences(normalizedProjectId);
    setProviderTypeState(scopedPreferences.providerType);
    setModelState(scopedPreferences.model);
    setExecutionStrategyState(
      resolvePersistedExecutionStrategy(normalizedProjectId),
    );
  }, [normalizedProjectId]);

  const setProviderType = useCallback(
    (nextProviderType: string) => {
      setProviderTypeState(nextProviderType);
      const { providerKey } = getAgentPreferenceKeys(normalizedProjectId);
      savePersisted(providerKey, nextProviderType);
    },
    [normalizedProjectId],
  );

  const setModel = useCallback(
    (nextModel: string) => {
      setModelState(nextModel);
      const { modelKey } = getAgentPreferenceKeys(normalizedProjectId);
      savePersisted(modelKey, nextModel);
    },
    [normalizedProjectId],
  );

  const setExecutionStrategy = useCallback(
    (nextExecutionStrategy: AsterExecutionStrategy) => {
      const normalized = normalizeExecutionStrategy(nextExecutionStrategy);
      setExecutionStrategyState(normalized);
      const storageKey = resolveExecutionStrategyStorageKey(normalizedProjectId);
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
  };
}
