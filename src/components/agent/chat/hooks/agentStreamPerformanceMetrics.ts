import {
  recordAgentUiPerformanceMetric,
  type AgentUiPerformanceEntry,
} from "@/lib/agentUiPerformanceMetrics";
import {
  createTraceId,
  createW3cTraceContextCarrier,
  normalizeW3cTraceContextCarrier,
  type W3cTraceContextCarrier,
} from "@/lib/trace/traceContext";
import {
  enqueueAgentUiProjectionEvents,
  recordConversationStreamDiagnostic,
} from "../projection/conversationProjectionStore";
import { buildAgentUiMetricChangedEvent } from "../projection/agentUiEventProjection";

export const AGENT_UI_PERFORMANCE_TRACE_METADATA_KEY =
  "agentUiPerformanceTrace";

export interface AgentUiPerformanceTraceMetadata {
  requestId?: string | null;
  runId?: string | null;
  sessionId?: string | null;
  traceId?: string | null;
  turnId?: string | null;
  workspaceId?: string | null;
  source?: string | null;
  submittedAt?: number | null;
  serverEventEmittedAt?: number | null;
  serverEventId?: string | null;
  serverEventSequence?: number | null;
  serverEventType?: string | null;
  rendererEventReceivedAt?: number | null;
  providerWaitMs?: number | null;
  w3cTraceContext?: W3cTraceContextCarrier | null;
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
  const runId = normalizeString(record.runId);
  const sessionId = normalizeString(record.sessionId);
  const traceId = normalizeString(record.traceId);
  const turnId = normalizeString(record.turnId);
  const workspaceId = normalizeString(record.workspaceId);
  const source = normalizeString(record.source);
  const submittedAt = normalizeTimestamp(record.submittedAt);
  const serverEventEmittedAt = normalizeTimestamp(record.serverEventEmittedAt);
  const serverEventId = normalizeString(record.serverEventId);
  const serverEventSequence = normalizeTimestamp(record.serverEventSequence);
  const serverEventType = normalizeString(record.serverEventType);
  const rendererEventReceivedAt = normalizeTimestamp(
    record.rendererEventReceivedAt,
  );
  const providerWaitMs = normalizeTimestamp(record.providerWaitMs);
  const w3cTraceContext = normalizeW3cTraceContextCarrier(
    record.w3cTraceContext ?? record.w3c_trace_context,
  );

  if (
    !requestId &&
    !runId &&
    !sessionId &&
    !traceId &&
    !turnId &&
    !workspaceId &&
    !source &&
    !submittedAt &&
    !serverEventEmittedAt &&
    !serverEventId &&
    !serverEventSequence &&
    !serverEventType &&
    !rendererEventReceivedAt &&
    providerWaitMs === null &&
    !w3cTraceContext
  ) {
    return null;
  }

  return {
    requestId,
    runId,
    sessionId,
    traceId,
    turnId,
    workspaceId,
    source,
    submittedAt,
    serverEventEmittedAt,
    serverEventId,
    serverEventSequence,
    serverEventType,
    rendererEventReceivedAt,
    providerWaitMs,
    w3cTraceContext,
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
      runId: trace.runId ?? null,
      sessionId: trace.sessionId ?? null,
      traceId: trace.traceId ?? null,
      turnId: trace.turnId ?? null,
      workspaceId: trace.workspaceId ?? null,
      source: trace.source ?? null,
      submittedAt: trace.submittedAt ?? null,
      serverEventEmittedAt: trace.serverEventEmittedAt ?? null,
      serverEventId: trace.serverEventId ?? null,
      serverEventSequence: trace.serverEventSequence ?? null,
      serverEventType: trace.serverEventType ?? null,
      rendererEventReceivedAt: trace.rendererEventReceivedAt ?? null,
      providerWaitMs: trace.providerWaitMs ?? null,
      w3cTraceContext: trace.w3cTraceContext ?? null,
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

export function ensureAgentUiPerformanceTraceMetadata(
  requestMetadata: Record<string, unknown> | undefined,
  options: {
    enabled: boolean;
    requestId?: string | null;
    sessionId?: string | null;
    source?: string | null;
    submittedAt?: number | null;
    workspaceId?: string | null;
  },
): Record<string, unknown> | undefined {
  const existingTrace = extractAgentUiPerformanceTraceMetadata(requestMetadata);
  if (!options.enabled && !existingTrace) {
    return requestMetadata;
  }
  if (!options.enabled) {
    return requestMetadata
      ? {
          ...requestMetadata,
        }
      : undefined;
  }

  return mergeAgentUiPerformanceTraceMetadata(requestMetadata, {
    requestId:
      existingTrace?.requestId ??
      normalizeString(options.requestId) ??
      createTraceId("conversation_request"),
    runId: existingTrace?.runId ?? createTraceId("conversation_run"),
    sessionId: existingTrace?.sessionId ?? normalizeString(options.sessionId),
    traceId: existingTrace?.traceId ?? createTraceId("conversation_trace"),
    turnId: existingTrace?.turnId ?? null,
    workspaceId:
      existingTrace?.workspaceId ?? normalizeString(options.workspaceId),
    source: existingTrace?.source ?? normalizeString(options.source),
    submittedAt:
      existingTrace?.submittedAt ??
      normalizeTimestamp(options.submittedAt) ??
      Date.now(),
    serverEventEmittedAt: existingTrace?.serverEventEmittedAt ?? null,
    serverEventId: existingTrace?.serverEventId ?? null,
    serverEventSequence: existingTrace?.serverEventSequence ?? null,
    serverEventType: existingTrace?.serverEventType ?? null,
    rendererEventReceivedAt: existingTrace?.rendererEventReceivedAt ?? null,
    providerWaitMs: existingTrace?.providerWaitMs ?? null,
    w3cTraceContext:
      existingTrace?.w3cTraceContext ?? createW3cTraceContextCarrier(),
  });
}

export function recordAgentStreamPerformanceMetric(
  phase: string,
  trace: AgentUiPerformanceTraceMetadata | null | undefined,
  context: Record<string, unknown> = {},
): AgentUiPerformanceEntry {
  const actualSessionId = normalizeString(context.sessionId);
  const traceSessionId = normalizeString(trace?.sessionId);
  const traceId = normalizeString(trace?.traceId);
  const runId = normalizeString(trace?.runId);
  const turnId =
    normalizeString(trace?.turnId) ?? normalizeString(context.turnId);
  const workspaceId =
    normalizeString(trace?.workspaceId) ?? normalizeString(context.workspaceId);
  const source =
    normalizeString(trace?.source) ??
    normalizeString(context.source) ??
    "agent-stream";
  const submittedAt = normalizeTimestamp(trace?.submittedAt);
  const serverEventEmittedAt = normalizeTimestamp(trace?.serverEventEmittedAt);
  const rendererEventReceivedAt = normalizeTimestamp(
    trace?.rendererEventReceivedAt,
  );
  const providerWaitMs = normalizeTimestamp(trace?.providerWaitMs);
  const normalizedContext: Record<string, unknown> = {
    ...context,
    sessionId: traceSessionId ?? actualSessionId,
    traceId: traceId ?? context.traceId ?? null,
    runId: runId ?? context.runId ?? null,
    turnId: turnId ?? null,
    workspaceId,
    source,
    requestId: normalizeString(trace?.requestId) ?? context.requestId ?? null,
    serverEventEmittedAt:
      serverEventEmittedAt ?? context.serverEventEmittedAt ?? null,
    serverEventId:
      normalizeString(trace?.serverEventId) ?? context.serverEventId ?? null,
    serverEventSequence:
      normalizeTimestamp(trace?.serverEventSequence) ??
      context.serverEventSequence ??
      null,
    serverEventType:
      normalizeString(trace?.serverEventType) ??
      context.serverEventType ??
      null,
    rendererEventReceivedAt:
      rendererEventReceivedAt ?? context.rendererEventReceivedAt ?? null,
    providerWaitMs: providerWaitMs ?? context.providerWaitMs ?? null,
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
  if (serverEventEmittedAt !== null && rendererEventReceivedAt !== null) {
    normalizedContext.bridgeDeliveryDeltaMs = Math.max(
      0,
      rendererEventReceivedAt - serverEventEmittedAt,
    );
  }

  const entry = recordAgentUiPerformanceMetric(phase, normalizedContext);
  recordConversationStreamDiagnostic({
    phase: entry.phase,
    at: entry.at,
    wallTime: entry.wallTime,
    sessionId: entry.sessionId,
    workspaceId: entry.workspaceId,
    source: entry.source,
    requestId:
      typeof entry.metrics.requestId === "string"
        ? entry.metrics.requestId
        : null,
    actualSessionId:
      typeof entry.metrics.actualSessionId === "string"
        ? entry.metrics.actualSessionId
        : null,
    metrics: entry.metrics,
  });
  enqueueAgentUiProjectionEvents([
    buildAgentUiMetricChangedEvent({
      phase: entry.phase,
      at: entry.at,
      wallTime: entry.wallTime,
      sessionId: entry.sessionId,
      workspaceId: entry.workspaceId,
      source: entry.source,
      requestId:
        typeof entry.metrics.requestId === "string"
          ? entry.metrics.requestId
          : null,
      actualSessionId:
        typeof entry.metrics.actualSessionId === "string"
          ? entry.metrics.actualSessionId
          : null,
      metrics: entry.metrics,
    }),
  ]);
  return entry;
}
