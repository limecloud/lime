import type { SessionModelPreference } from "./agentChatShared";

export interface SessionPostFinalizePersistencePlan {
  persistedWorkspaceId: string | null;
  providerPreferenceToApply: SessionModelPreference | null;
  runtimeTopicWorkspaceIdToApply: string | null;
  topicWorkspaceId: string | null;
}

export function resolveSessionDetailTopicWorkspaceId(params: {
  knownWorkspaceId?: string | null;
  resolvedWorkspaceId?: string | null;
  runtimeWorkspaceId?: string | null;
}): string | null {
  return (
    params.runtimeWorkspaceId ||
    params.knownWorkspaceId ||
    params.resolvedWorkspaceId ||
    null
  );
}

export function resolvePersistedSessionWorkspaceId(params: {
  resolvedWorkspaceId?: string | null;
  runtimeWorkspaceId?: string | null;
}): string | null {
  return params.runtimeWorkspaceId || params.resolvedWorkspaceId || null;
}

export function buildSessionPostFinalizePersistencePlan(params: {
  knownWorkspaceId?: string | null;
  providerPreferenceToApply?: SessionModelPreference | null;
  resolvedWorkspaceId?: string | null;
  runtimeWorkspaceId?: string | null;
}): SessionPostFinalizePersistencePlan {
  return {
    persistedWorkspaceId: resolvePersistedSessionWorkspaceId(params),
    providerPreferenceToApply: params.providerPreferenceToApply ?? null,
    runtimeTopicWorkspaceIdToApply: params.runtimeWorkspaceId || null,
    topicWorkspaceId: resolveSessionDetailTopicWorkspaceId(params),
  };
}
