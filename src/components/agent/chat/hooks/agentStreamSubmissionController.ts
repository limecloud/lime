export interface AgentStreamSubmissionTimingState {
  listenerBoundAt?: number | null;
  now: number;
  requestStartedAt: number;
  submissionDispatchedAt?: number | null;
}

export function resolveAgentStreamSubmitErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function buildAgentStreamSubmitDispatchedContext(params: {
  activeSessionId: string;
  effectiveModel: string;
  effectiveProviderType: string;
  eventName: string;
  expectingQueue: boolean;
  timing: AgentStreamSubmissionTimingState;
}): Record<string, unknown> {
  return {
    elapsedMs: params.timing.now - params.timing.requestStartedAt,
    eventName: params.eventName,
    expectingQueue: params.expectingQueue,
    listenerBoundDeltaMs: params.timing.listenerBoundAt
      ? params.timing.now - params.timing.listenerBoundAt
      : null,
    model: params.effectiveModel,
    provider: params.effectiveProviderType,
    sessionId: params.activeSessionId,
  };
}

export function buildAgentStreamSubmitAcceptedContext(params: {
  activeSessionId: string;
  eventName: string;
  timing: AgentStreamSubmissionTimingState;
}): Record<string, unknown> {
  return {
    elapsedMs: params.timing.now - params.timing.requestStartedAt,
    eventName: params.eventName,
    sessionId: params.activeSessionId,
    submitInvokeMs: params.timing.submissionDispatchedAt
      ? params.timing.now - params.timing.submissionDispatchedAt
      : null,
  };
}

export function buildAgentStreamSubmitFailedContext(params: {
  activeSessionId: string;
  error: unknown;
  eventName: string;
  timing: AgentStreamSubmissionTimingState;
}): Record<string, unknown> {
  return {
    elapsedMs: params.timing.now - params.timing.requestStartedAt,
    error: resolveAgentStreamSubmitErrorMessage(params.error),
    eventName: params.eventName,
    sessionId: params.activeSessionId,
    submitInvokeMs: params.timing.submissionDispatchedAt
      ? params.timing.now - params.timing.submissionDispatchedAt
      : null,
  };
}

export function buildAgentStreamSubmitFailedLogContext(params: {
  activeSessionId: string;
  error: unknown;
  eventName: string;
  timing: AgentStreamSubmissionTimingState;
}): Record<string, unknown> {
  return {
    ...buildAgentStreamSubmitFailedContext(params),
    error: params.error,
  };
}
