export interface AgentStreamListenerBoundContextParams {
  activeSessionId: string;
  eventName: string;
  expectingQueue: boolean;
  listenerBoundAt: number;
  requestStartedAt: number;
}

export interface AgentStreamFirstEventContextParams {
  activeSessionId: string;
  eventName: string;
  eventReceivedAt: number;
  eventType: string;
  recognized: boolean;
  requestStartedAt: number;
  submissionDispatchedAt?: number | null;
}

export interface AgentStreamFirstEventDeferredContextParams {
  activeSessionId: string;
  deferredAt: number;
  eventName: string;
  requestStartedAt: number;
  submissionDispatchedAt?: number | null;
}

export function extractAgentStreamRuntimeEventType(
  payload: unknown,
): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const type = (payload as { type?: unknown }).type;
  return typeof type === "string" && type.trim() ? type : null;
}

export function buildAgentStreamListenerBoundContext(
  params: AgentStreamListenerBoundContextParams,
): Record<string, unknown> {
  return {
    elapsedMs: params.listenerBoundAt - params.requestStartedAt,
    eventName: params.eventName,
    expectingQueue: params.expectingQueue,
    sessionId: params.activeSessionId,
  };
}

export function buildAgentStreamFirstEventContext(
  params: AgentStreamFirstEventContextParams,
): Record<string, unknown> {
  return {
    elapsedMs: params.eventReceivedAt - params.requestStartedAt,
    eventName: params.eventName,
    eventType: params.eventType,
    recognized: params.recognized,
    sessionId: params.activeSessionId,
    submissionDispatchedDeltaMs: params.submissionDispatchedAt
      ? params.eventReceivedAt - params.submissionDispatchedAt
      : null,
  };
}

export function buildAgentStreamFirstEventDeferredContext(
  params: AgentStreamFirstEventDeferredContextParams,
): Record<string, unknown> {
  return {
    elapsedMs: params.deferredAt - params.requestStartedAt,
    eventName: params.eventName,
    sessionId: params.activeSessionId,
    submissionDispatchedDeltaMs: params.submissionDispatchedAt
      ? params.deferredAt - params.submissionDispatchedAt
      : null,
  };
}

export function shouldDeferAgentStreamFirstEventTimeout(params: {
  firstEventReceived: boolean;
  requestFinished: boolean;
  submissionDispatchedAt?: number | null;
}): boolean {
  return (
    !params.firstEventReceived &&
    !params.requestFinished &&
    Boolean(params.submissionDispatchedAt)
  );
}

export function shouldScheduleAgentStreamInactivityWatchdog(params: {
  firstEventReceived: boolean;
  requestFinished: boolean;
  streamActivated: boolean;
}): boolean {
  return (
    params.firstEventReceived &&
    !params.requestFinished &&
    params.streamActivated
  );
}

export function shouldIgnoreAgentStreamInactivityResult(params: {
  lastEventReceivedAt: number;
  requestFinished: boolean;
  streamActivated: boolean;
  timeoutStartedAt: number;
}): boolean {
  return (
    params.requestFinished ||
    !params.streamActivated ||
    params.lastEventReceivedAt > params.timeoutStartedAt
  );
}
