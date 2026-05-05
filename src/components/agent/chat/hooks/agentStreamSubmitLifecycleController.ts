import { logAgentDebug } from "@/lib/agentDebug";
import type { StreamRequestState } from "./agentStreamSubmissionLifecycle";
import {
  recordAgentStreamPerformanceMetric,
  type AgentUiPerformanceTraceMetadata,
} from "./agentStreamPerformanceMetrics";
import {
  buildAgentStreamSubmitAcceptedContext,
  buildAgentStreamSubmitDispatchedContext,
  buildAgentStreamSubmitFailedContext,
  buildAgentStreamSubmitFailedLogContext,
} from "./agentStreamSubmissionController";

type AgentStreamSubmitMetricRecorder = (
  phase: string,
  trace: AgentUiPerformanceTraceMetadata | null | undefined,
  context: Record<string, unknown>,
) => unknown;

type AgentStreamSubmitDebugLogger = typeof logAgentDebug;

export interface AgentStreamSubmitLifecycleDeps {
  logDebug?: AgentStreamSubmitDebugLogger;
  now?: () => number;
  recordMetric?: AgentStreamSubmitMetricRecorder;
}

export interface RunAgentStreamSubmitLifecycleOptions {
  activeSessionId: string;
  effectiveModel: string;
  effectiveProviderType: string;
  eventName: string;
  expectingQueue: boolean;
  requestState: StreamRequestState;
  submit: () => Promise<void>;
  deps?: AgentStreamSubmitLifecycleDeps;
}

export async function runAgentStreamSubmitLifecycle(
  options: RunAgentStreamSubmitLifecycleOptions,
): Promise<void> {
  const {
    activeSessionId,
    effectiveModel,
    effectiveProviderType,
    eventName,
    expectingQueue,
    requestState,
    submit,
    deps,
  } = options;
  const now = deps?.now ?? Date.now;
  const recordMetric = deps?.recordMetric ?? recordAgentStreamPerformanceMetric;
  const logDebug = deps?.logDebug ?? logAgentDebug;

  requestState.submissionDispatchedAt = now();
  const submitDispatchedContext = buildAgentStreamSubmitDispatchedContext({
    activeSessionId,
    effectiveModel,
    effectiveProviderType,
    eventName,
    expectingQueue,
    timing: {
      listenerBoundAt: requestState.listenerBoundAt,
      now: requestState.submissionDispatchedAt,
      requestStartedAt: requestState.requestStartedAt,
    },
  });
  recordMetric(
    "agentStream.submitDispatched",
    requestState.performanceTrace,
    submitDispatchedContext,
  );
  logDebug("AgentStream", "submitDispatched", submitDispatchedContext);

  try {
    await submit();
    const submitAcceptedContext = buildAgentStreamSubmitAcceptedContext({
      activeSessionId,
      eventName,
      timing: {
        now: now(),
        requestStartedAt: requestState.requestStartedAt,
        submissionDispatchedAt: requestState.submissionDispatchedAt,
      },
    });
    recordMetric(
      "agentStream.submitAccepted",
      requestState.performanceTrace,
      submitAcceptedContext,
    );
    logDebug("AgentStream", "submitAccepted", submitAcceptedContext);
  } catch (error) {
    const failedTiming = {
      now: now(),
      requestStartedAt: requestState.requestStartedAt,
      submissionDispatchedAt: requestState.submissionDispatchedAt,
    };
    recordMetric(
      "agentStream.submitFailed",
      requestState.performanceTrace,
      buildAgentStreamSubmitFailedContext({
        activeSessionId,
        error,
        eventName,
        timing: failedTiming,
      }),
    );
    logDebug(
      "AgentStream",
      "submitFailed",
      buildAgentStreamSubmitFailedLogContext({
        activeSessionId,
        error,
        eventName,
        timing: failedTiming,
      }),
      { level: "error" },
    );
    throw error;
  }
}
