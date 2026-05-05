export interface AgentStreamRequestLogFinishPayload {
  eventType: "chat_request_complete" | "chat_request_error";
  status: "success" | "error";
  description?: string;
  error?: string;
}

export interface AgentStreamRequestLogFinishUpdatePayload
  extends AgentStreamRequestLogFinishPayload {
  duration: number;
}

export interface AgentStreamRequestLogFinishPlan {
  shouldUpdate: boolean;
  nextRequestFinished: boolean;
  logId: string | null;
  updatePayload?: AgentStreamRequestLogFinishUpdatePayload;
}

export function buildAgentStreamRequestLogFinishPlan(params: {
  requestLogId?: string | null;
  requestFinished: boolean;
  requestStartedAt: number;
  finishedAt: number;
  payload: AgentStreamRequestLogFinishPayload;
}): AgentStreamRequestLogFinishPlan {
  const logId = params.requestLogId ?? null;
  if (!logId || params.requestFinished) {
    return {
      shouldUpdate: false,
      nextRequestFinished: params.requestFinished,
      logId,
    };
  }

  return {
    shouldUpdate: true,
    nextRequestFinished: true,
    logId,
    updatePayload: {
      eventType: params.payload.eventType,
      status: params.payload.status,
      duration: params.finishedAt - params.requestStartedAt,
      description: params.payload.description,
      error: params.payload.error,
    },
  };
}
