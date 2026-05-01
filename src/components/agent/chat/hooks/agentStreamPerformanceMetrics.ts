import {
  recordAgentUiPerformanceMetric,
  type AgentUiPerformanceEntry,
} from "@/lib/agentUiPerformanceMetrics";

export const AGENT_UI_PERFORMANCE_TRACE_METADATA_KEY =
  "agentUiPerformanceTrace";

export interface AgentUiPerformanceTraceMetadata {
  requestId?: string | null;
  sessionId?: string | null;
  workspaceId?: string | null;
  source?: string | null;
  submittedAt?: number | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeTimestamp(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeTraceMetadata(
  value: unknown,
): AgentUiPerformanceTraceMetadata | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const requestId = normalizeString(record.requestId);
  const sessionId = normalizeString(record.sessionId);
  const workspaceId = normalizeString(record.workspaceId);
  const source = normalizeString(record.source);
  const submittedAt = normalizeTimestamp(record.submittedAt);

  if (!requestId && !sessionId && !workspaceId && !source && !submittedAt) {
    return null;
  }

  return {
    requestId,
    sessionId,
    workspaceId,
    source,
    submittedAt,
  };
}

export function mergeAgentUiPerformanceTraceMetadata(
  requestMetadata: Record<string, unknown> | undefined,
  trace: AgentUiPerformanceTraceMetadata,
): Record<string, unknown> {
  return {
    ...(requestMetadata || {}),
    [AGENT_UI_PERFORMANCE_TRACE_METADATA_KEY]: {
      requestId: trace.requestId ?? null,
      sessionId: trace.sessionId ?? null,
      workspaceId: trace.workspaceId ?? null,
      source: trace.source ?? null,
      submittedAt: trace.submittedAt ?? null,
    },
  };
}

export function extractAgentUiPerformanceTraceMetadata(
  requestMetadata: Record<string, unknown> | undefined,
): AgentUiPerformanceTraceMetadata | null {
  if (!requestMetadata) {
    return null;
  }

  return normalizeTraceMetadata(
    requestMetadata[AGENT_UI_PERFORMANCE_TRACE_METADATA_KEY],
  );
}

export function recordAgentStreamPerformanceMetric(
  phase: string,
  trace: AgentUiPerformanceTraceMetadata | null | undefined,
  context: Record<string, unknown> = {},
): AgentUiPerformanceEntry {
  const actualSessionId = normalizeString(context.sessionId);
  const traceSessionId = normalizeString(trace?.sessionId);
  const workspaceId =
    normalizeString(trace?.workspaceId) ?? normalizeString(context.workspaceId);
  const source =
    normalizeString(trace?.source) ??
    normalizeString(context.source) ??
    "agent-stream";
  const submittedAt = normalizeTimestamp(trace?.submittedAt);
  const normalizedContext: Record<string, unknown> = {
    ...context,
    sessionId: traceSessionId ?? actualSessionId,
    workspaceId,
    source,
    requestId: normalizeString(trace?.requestId) ?? context.requestId ?? null,
  };

  if (actualSessionId && traceSessionId && actualSessionId !== traceSessionId) {
    normalizedContext.actualSessionId = actualSessionId;
  }
  if (submittedAt !== null) {
    normalizedContext.homeSubmittedDeltaMs = Math.max(
      0,
      Date.now() - submittedAt,
    );
  }

  return recordAgentUiPerformanceMetric(phase, normalizedContext);
}
