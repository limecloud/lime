export interface AgentStreamFirstRuntimeStatusMetricContextParams {
  activeSessionId: string;
  eventName: string;
  firstEventReceivedAt?: number | null;
  firstRuntimeStatusAt: number;
  requestStartedAt: number;
  statusPhase: string;
  statusTitle: string;
}

export interface AgentStreamFirstTextDeltaMetricContextParams {
  activeSessionId: string;
  deltaText: string;
  eventName: string;
  firstEventReceivedAt?: number | null;
  firstRuntimeStatusAt?: number | null;
  firstTextDeltaAt: number;
  requestStartedAt: number;
}

export function shouldRecordAgentStreamFirstRuntimeStatus(params: {
  firstRuntimeStatusAt?: number | null;
}): boolean {
  return !params.firstRuntimeStatusAt;
}

export function shouldRecordAgentStreamFirstTextDelta(params: {
  firstTextDeltaAt?: number | null;
}): boolean {
  return !params.firstTextDeltaAt;
}

export function buildAgentStreamFirstRuntimeStatusMetricContext(
  params: AgentStreamFirstRuntimeStatusMetricContextParams,
): Record<string, unknown> {
  return {
    elapsedMs: params.firstRuntimeStatusAt - params.requestStartedAt,
    eventName: params.eventName,
    firstEventDeltaMs: params.firstEventReceivedAt
      ? params.firstRuntimeStatusAt - params.firstEventReceivedAt
      : null,
    phase: params.statusPhase,
    sessionId: params.activeSessionId,
    title: params.statusTitle,
  };
}

export function buildAgentStreamFirstTextDeltaMetricContext(
  params: AgentStreamFirstTextDeltaMetricContextParams,
): Record<string, unknown> {
  return {
    deltaChars: params.deltaText.length,
    elapsedMs: params.firstTextDeltaAt - params.requestStartedAt,
    eventName: params.eventName,
    firstEventDeltaMs: params.firstEventReceivedAt
      ? params.firstTextDeltaAt - params.firstEventReceivedAt
      : null,
    firstRuntimeStatusDeltaMs: params.firstRuntimeStatusAt
      ? params.firstTextDeltaAt - params.firstRuntimeStatusAt
      : null,
    sessionId: params.activeSessionId,
  };
}
