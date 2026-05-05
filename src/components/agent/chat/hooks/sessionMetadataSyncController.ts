import type { AsterExecutionStrategy } from "@/lib/api/agentRuntime";
import type { AgentSessionMetadataPatch } from "./agentRuntimeAdapter";
import type { AgentAccessMode } from "./agentChatStorage";
import type { SessionModelPreference } from "./agentChatShared";

export type SessionAccessModeSource =
  | "execution_runtime"
  | "session_storage"
  | "workspace_default";

export type SessionExecutionStrategySource =
  | "session_detail"
  | "topics_snapshot"
  | "shadow_cache"
  | "default";

export type SessionModelPreferenceSource = "execution_runtime" | "session_storage";

export interface SessionMetadataSyncPlan {
  accessMode: AgentAccessMode;
  accessModeSource: SessionAccessModeSource;
  fallbackExecutionStrategy: AsterExecutionStrategy | null;
  fallbackProviderPreference: SessionModelPreference | null;
  hasPatch: boolean;
  modelPreferenceSource: SessionModelPreferenceSource | null;
  patch: AgentSessionMetadataPatch;
  providerPreferenceToApply: SessionModelPreference | null;
  shouldPersistAccessMode: boolean;
}

export interface SessionMetadataSyncRuntime {
  setSessionAccessMode?: (
    sessionId: string,
    accessMode: AgentAccessMode,
  ) => Promise<void>;
  setSessionExecutionStrategy: (
    sessionId: string,
    executionStrategy: AsterExecutionStrategy,
  ) => Promise<void>;
  setSessionProviderSelection: (
    sessionId: string,
    providerType: string,
    model: string,
  ) => Promise<void>;
  updateSessionMetadata?: (
    sessionId: string,
    patch: AgentSessionMetadataPatch,
  ) => Promise<void>;
}

export function resolveSessionExecutionStrategySource(params: {
  runtimeExecutionStrategy?: AsterExecutionStrategy | null;
  topicExecutionStrategy?: AsterExecutionStrategy | null;
  shadowExecutionStrategyFallback?: AsterExecutionStrategy | null;
}): SessionExecutionStrategySource {
  if (params.runtimeExecutionStrategy) {
    return "session_detail";
  }
  if (params.topicExecutionStrategy) {
    return "topics_snapshot";
  }
  if (params.shadowExecutionStrategyFallback) {
    return "shadow_cache";
  }
  return "default";
}

export function buildSessionMetadataSyncPlan(params: {
  runtimeAccessMode?: AgentAccessMode | null;
  runtimePreference?: SessionModelPreference | null;
  shadowAccessMode?: AgentAccessMode | null;
  shadowExecutionStrategyFallback?: AsterExecutionStrategy | null;
  topicPreference?: SessionModelPreference | null;
  workspaceDefaultAccessMode: AgentAccessMode;
}): SessionMetadataSyncPlan {
  const patch: AgentSessionMetadataPatch = {};
  let accessMode: AgentAccessMode;
  let accessModeSource: SessionAccessModeSource;
  let shouldPersistAccessMode = false;

  if (params.runtimeAccessMode) {
    accessMode = params.runtimeAccessMode;
    accessModeSource = "execution_runtime";
    shouldPersistAccessMode = true;
  } else if (params.shadowAccessMode) {
    accessMode = params.shadowAccessMode;
    accessModeSource = "session_storage";
    patch.accessMode = params.shadowAccessMode;
  } else {
    accessMode = params.workspaceDefaultAccessMode;
    accessModeSource = "workspace_default";
    shouldPersistAccessMode = true;
    patch.accessMode = params.workspaceDefaultAccessMode;
  }

  const providerPreferenceToApply = params.topicPreference ?? null;
  const fallbackProviderPreference =
    providerPreferenceToApply && !params.runtimePreference
      ? providerPreferenceToApply
      : null;
  if (fallbackProviderPreference) {
    patch.providerType = fallbackProviderPreference.providerType;
    patch.model = fallbackProviderPreference.model;
  }

  const fallbackExecutionStrategy =
    params.shadowExecutionStrategyFallback ?? null;
  if (fallbackExecutionStrategy) {
    patch.executionStrategy = fallbackExecutionStrategy;
  }

  return {
    accessMode,
    accessModeSource,
    fallbackExecutionStrategy,
    fallbackProviderPreference,
    hasPatch: Boolean(
      patch.accessMode ||
        patch.providerType ||
        patch.model ||
        patch.executionStrategy,
    ),
    modelPreferenceSource: params.runtimePreference
      ? "execution_runtime"
      : providerPreferenceToApply
        ? "session_storage"
        : null,
    patch,
    providerPreferenceToApply,
    shouldPersistAccessMode,
  };
}

export function buildSessionSwitchSuccessMetricContext(params: {
  accessModeSource: SessionAccessModeSource;
  durationMs: number;
  executionStrategySource: SessionExecutionStrategySource;
  itemsCount: number;
  messagesCount: number;
  modelPreferenceSource: SessionModelPreferenceSource | null;
  queuedTurnsCount: number;
  topicId: string;
  turnsCount: number;
  workspaceId?: string | null;
}): Record<string, unknown> {
  return {
    accessModeSource: params.accessModeSource,
    durationMs: params.durationMs,
    executionStrategySource: params.executionStrategySource,
    itemsCount: params.itemsCount,
    messagesCount: params.messagesCount,
    modelPreferenceSource: params.modelPreferenceSource,
    queuedTurnsCount: params.queuedTurnsCount,
    sessionId: params.topicId,
    topicId: params.topicId,
    turnsCount: params.turnsCount,
    workspaceId: params.workspaceId,
  };
}

export async function executeSessionMetadataSync(params: {
  fallbackExecutionStrategy: AsterExecutionStrategy | null;
  fallbackProviderPreference: SessionModelPreference | null;
  patch: AgentSessionMetadataPatch;
  runtime: SessionMetadataSyncRuntime;
  sessionId: string;
}): Promise<void> {
  if (params.runtime.updateSessionMetadata) {
    return params.runtime.updateSessionMetadata(params.sessionId, params.patch);
  }

  const tasks: Promise<void>[] = [];
  if (params.patch.accessMode && params.runtime.setSessionAccessMode) {
    tasks.push(
      params.runtime.setSessionAccessMode(
        params.sessionId,
        params.patch.accessMode,
      ),
    );
  }
  if (params.fallbackProviderPreference) {
    tasks.push(
      params.runtime.setSessionProviderSelection(
        params.sessionId,
        params.fallbackProviderPreference.providerType,
        params.fallbackProviderPreference.model,
      ),
    );
  }
  if (params.fallbackExecutionStrategy) {
    tasks.push(
      params.runtime.setSessionExecutionStrategy(
        params.sessionId,
        params.fallbackExecutionStrategy,
      ),
    );
  }

  await Promise.all(tasks);
}
