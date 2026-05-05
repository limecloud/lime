import type {
  AsterExecutionStrategy,
  AutoContinueRequestPayload,
} from "@/lib/api/agentRuntime";
import {
  activityLogger,
  type ActivityLog,
} from "@/lib/workspace/workbenchRuntime";
import { mapProviderName } from "./agentChatCoreUtils";
import type { StreamRequestState } from "./agentStreamSubmissionLifecycle";
import {
  recordAgentStreamPerformanceMetric,
  type AgentUiPerformanceTraceMetadata,
} from "./agentStreamPerformanceMetrics";

type AgentStreamRequestStartMetricRecorder = (
  phase: string,
  trace: AgentUiPerformanceTraceMetadata | null | undefined,
  context: Record<string, unknown>,
) => unknown;

type AgentStreamActivityLogInput = Omit<ActivityLog, "id" | "timestamp">;
type AgentStreamActivityLogger = (event: AgentStreamActivityLogInput) => string;

export interface AgentStreamRequestStartDeps {
  logActivity?: AgentStreamActivityLogger;
  now?: () => number;
  recordMetric?: AgentStreamRequestStartMetricRecorder;
}

export interface AgentStreamRequestStartParams {
  activeSessionId: string;
  autoContinue?: AutoContinueRequestPayload;
  content: string;
  effectiveExecutionStrategy: AsterExecutionStrategy;
  effectiveModel: string;
  effectiveProviderType: string;
  eventName: string;
  expectingQueue: boolean;
  requestState: StreamRequestState;
  resolvedWorkspaceId: string;
  skipUserMessage: boolean;
  systemPrompt?: string;
  deps?: AgentStreamRequestStartDeps;
}

interface AgentStreamRequestStartPayloadParams {
  activeSessionId: string;
  autoContinue?: AutoContinueRequestPayload;
  content: string;
  effectiveExecutionStrategy: AsterExecutionStrategy;
  effectiveModel: string;
  effectiveProviderType: string;
  eventName: string;
  expectingQueue: boolean;
  resolvedWorkspaceId: string;
  skipUserMessage: boolean;
  systemPrompt?: string;
}

function resolveContentLength(content: string): number {
  return content.trim().length;
}

export function buildAgentStreamRequestStartMetricContext(
  params: AgentStreamRequestStartPayloadParams,
): Record<string, unknown> {
  return {
    contentLength: resolveContentLength(params.content),
    eventName: params.eventName,
    expectingQueue: params.expectingQueue,
    model: params.effectiveModel,
    provider: params.effectiveProviderType,
    sessionId: params.activeSessionId,
    skipUserMessage: params.skipUserMessage,
    systemPromptLength: params.systemPrompt?.length ?? 0,
    systemPromptPreview: params.systemPrompt?.slice(0, 48) ?? null,
  };
}

export function buildAgentStreamRequestStartActivityLog(
  params: AgentStreamRequestStartPayloadParams,
): AgentStreamActivityLogInput {
  return {
    eventType: "chat_request_start",
    status: "pending",
    title: params.skipUserMessage ? "系统引导请求" : "发送请求",
    description: `模型: ${params.effectiveModel} · 策略: ${params.effectiveExecutionStrategy}`,
    workspaceId: params.resolvedWorkspaceId,
    sessionId: params.activeSessionId,
    source: "aster-chat",
    metadata: {
      provider: mapProviderName(params.effectiveProviderType),
      model: params.effectiveModel,
      executionStrategy: params.effectiveExecutionStrategy,
      contentLength: resolveContentLength(params.content),
      skipUserMessage: params.skipUserMessage,
      systemPromptLength: params.systemPrompt?.length ?? 0,
      autoContinueEnabled: params.autoContinue?.enabled ?? false,
      autoContinue: params.autoContinue?.enabled
        ? params.autoContinue
        : undefined,
      queuedSubmission: params.expectingQueue,
    },
  };
}

export function startAgentStreamRequest(
  params: AgentStreamRequestStartParams,
): string {
  const now = params.deps?.now ?? Date.now;
  const recordMetric =
    params.deps?.recordMetric ?? recordAgentStreamPerformanceMetric;
  const logActivity = params.deps?.logActivity ?? activityLogger.log.bind(
    activityLogger,
  );

  params.requestState.requestStartedAt = now();
  recordMetric(
    "agentStream.request.start",
    params.requestState.performanceTrace,
    buildAgentStreamRequestStartMetricContext(params),
  );
  const requestLogId = logActivity(
    buildAgentStreamRequestStartActivityLog(params),
  );
  params.requestState.requestLogId = requestLogId;
  return requestLogId;
}
