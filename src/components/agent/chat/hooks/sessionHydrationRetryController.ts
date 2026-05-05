import {
  classifySessionDetailHydrationError,
  getSessionDetailHydrationErrorMessage,
  type SessionDetailHydrationErrorCategory,
} from "./agentSessionDetailHydrationError";

export type DeferredSessionHydrationErrorAction =
  | {
      kind: "retry";
      nextRetryCount: number;
      retryDelayMs: number;
      metricName: "session.switch.fetchDetail.retryScheduled";
      logEvent: "switchTopic.fetchDetail.retryScheduled";
      logContext: DeferredSessionHydrationRetryContext;
    }
  | {
      kind: "skip";
      metricName: "session.switch.fetchDetail.retrySkipped";
      logEvent: "switchTopic.fetchDetail.retrySkipped";
      logContext: DeferredSessionHydrationSkipContext;
    }
  | {
      kind: "fail";
      error: unknown;
    };

export interface DeferredSessionHydrationRetryContext
  extends Record<string, unknown> {
  error: string;
  errorCategory: SessionDetailHydrationErrorCategory;
  retryCount: number;
  retryDelayMs: number;
  sessionId: string;
  topicId: string;
  workspaceId?: string | null;
}

export interface DeferredSessionHydrationSkipContext
  extends Record<string, unknown> {
  error: string;
  errorCategory: SessionDetailHydrationErrorCategory;
  retryCount: number;
  sessionId: string;
  topicId: string;
  workspaceId?: string | null;
}

export function resolveDeferredSessionHydrationErrorAction(params: {
  error: unknown;
  retryCount: number;
  maxRetry: number;
  retryDelayMs: number;
  topicId: string;
  workspaceId?: string | null;
}): DeferredSessionHydrationErrorAction {
  const hydrationError = classifySessionDetailHydrationError(params.error);
  const errorMessage = getSessionDetailHydrationErrorMessage(params.error);

  if (hydrationError.retryable && params.retryCount < params.maxRetry) {
    const nextRetryCount = params.retryCount + 1;
    return {
      kind: "retry",
      nextRetryCount,
      retryDelayMs: params.retryDelayMs,
      metricName: "session.switch.fetchDetail.retryScheduled",
      logEvent: "switchTopic.fetchDetail.retryScheduled",
      logContext: {
        error: errorMessage,
        errorCategory: hydrationError.category,
        retryCount: nextRetryCount,
        retryDelayMs: params.retryDelayMs,
        sessionId: params.topicId,
        topicId: params.topicId,
        workspaceId: params.workspaceId,
      },
    };
  }

  if (hydrationError.transient) {
    return {
      kind: "skip",
      metricName: "session.switch.fetchDetail.retrySkipped",
      logEvent: "switchTopic.fetchDetail.retrySkipped",
      logContext: {
        error: errorMessage,
        errorCategory: hydrationError.category,
        retryCount: params.retryCount,
        sessionId: params.topicId,
        topicId: params.topicId,
        workspaceId: params.workspaceId,
      },
    };
  }

  return {
    kind: "fail",
    error: params.error,
  };
}
