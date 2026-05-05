import type { AsterExecutionStrategy } from "@/lib/api/agentRuntime";

export interface CrossWorkspaceSessionRestoreContext {
  currentWorkspaceId: string;
  knownWorkspaceId: string;
  topicId: string;
}

export interface SessionWorkspaceRestorePlan {
  crossWorkspaceContext: CrossWorkspaceSessionRestoreContext | null;
  knownWorkspaceId: string | null;
  shouldReject: boolean;
}

export function resolveSessionKnownWorkspaceId(params: {
  runtimeWorkspaceId?: string | null;
  shadowWorkspaceId?: string | null;
  topicWorkspaceId?: string | null;
}): string | null {
  return (
    params.runtimeWorkspaceId ||
    params.topicWorkspaceId ||
    params.shadowWorkspaceId ||
    null
  );
}

export function isCrossWorkspaceSessionDetail(params: {
  knownWorkspaceId?: string | null;
  resolvedWorkspaceId?: string | null;
}): boolean {
  return Boolean(
    params.resolvedWorkspaceId &&
      params.knownWorkspaceId &&
      params.knownWorkspaceId !== params.resolvedWorkspaceId,
  );
}

export function buildCrossWorkspaceSessionRestoreContext(params: {
  knownWorkspaceId: string;
  resolvedWorkspaceId: string;
  topicId: string;
}): CrossWorkspaceSessionRestoreContext {
  return {
    currentWorkspaceId: params.resolvedWorkspaceId,
    knownWorkspaceId: params.knownWorkspaceId,
    topicId: params.topicId,
  };
}

export function buildSessionWorkspaceRestorePlan(params: {
  resolvedWorkspaceId?: string | null;
  runtimeWorkspaceId?: string | null;
  shadowWorkspaceId?: string | null;
  topicId: string;
  topicWorkspaceId?: string | null;
}): SessionWorkspaceRestorePlan {
  const knownWorkspaceId = resolveSessionKnownWorkspaceId(params);
  const shouldReject = isCrossWorkspaceSessionDetail({
    knownWorkspaceId,
    resolvedWorkspaceId: params.resolvedWorkspaceId,
  });

  return {
    crossWorkspaceContext:
      shouldReject && params.resolvedWorkspaceId && knownWorkspaceId
        ? buildCrossWorkspaceSessionRestoreContext({
            knownWorkspaceId,
            resolvedWorkspaceId: params.resolvedWorkspaceId,
            topicId: params.topicId,
          })
        : null,
    knownWorkspaceId,
    shouldReject,
  };
}

export function resolveShadowSessionExecutionStrategyFallback(params: {
  persistedExecutionStrategy?: AsterExecutionStrategy | null;
  runtimeExecutionStrategy?: AsterExecutionStrategy | null;
  topicExecutionStrategy?: AsterExecutionStrategy | null;
}): AsterExecutionStrategy | null {
  if (params.runtimeExecutionStrategy || params.topicExecutionStrategy) {
    return null;
  }
  return params.persistedExecutionStrategy ?? null;
}

export function resolveSessionExecutionStrategyOverride(params: {
  defaultExecutionStrategy?: AsterExecutionStrategy;
  runtimeExecutionStrategy?: AsterExecutionStrategy | null;
  shadowExecutionStrategyFallback?: AsterExecutionStrategy | null;
  topicExecutionStrategy?: AsterExecutionStrategy | null;
}): AsterExecutionStrategy {
  return (
    params.runtimeExecutionStrategy ||
    params.topicExecutionStrategy ||
    params.shadowExecutionStrategyFallback ||
    params.defaultExecutionStrategy ||
    "react"
  );
}
