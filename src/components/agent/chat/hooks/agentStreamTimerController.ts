import {
  shouldFlushAgentStreamVisibleFirstText,
  shouldScheduleAgentStreamTextRenderTimer,
} from "./agentStreamTextRenderFlushController";

export const AGENT_STREAM_QUEUED_DRAFT_CLEANUP_GRACE_MS = 1800;
export const AGENT_STREAM_TEXT_DELTA_RENDER_FLUSH_MS = 32;

export interface AgentStreamTimerClearPlan {
  shouldClearTimer: boolean;
  nextTimerId: null;
}

export type AgentStreamTextRenderTimerAction =
  | "flush_now"
  | "schedule_timer"
  | "skip";

export interface AgentStreamTextRenderTimerSchedulePlan {
  action: AgentStreamTextRenderTimerAction;
  delayMs: number | null;
}

export interface AgentStreamQueuedDraftCleanupTimerSchedulePlan {
  shouldClearExistingTimer: boolean;
  shouldScheduleTimer: boolean;
  delayMs: number | null;
}

export interface AgentStreamQueuedDraftCleanupTimerFirePlan {
  shouldCleanup: boolean;
}

export function buildAgentStreamTimerClearPlan(params: {
  hasTimer: boolean;
}): AgentStreamTimerClearPlan {
  return {
    shouldClearTimer: params.hasTimer,
    nextTimerId: null,
  };
}

export function buildAgentStreamTextRenderTimerSchedulePlan(params: {
  accumulatedContent: string;
  hasPendingTimer: boolean;
  renderedContent: string;
}): AgentStreamTextRenderTimerSchedulePlan {
  if (
    shouldFlushAgentStreamVisibleFirstText({
      accumulatedContent: params.accumulatedContent,
      renderedContent: params.renderedContent,
    })
  ) {
    return {
      action: "flush_now",
      delayMs: null,
    };
  }

  if (
    !shouldScheduleAgentStreamTextRenderTimer({
      hasPendingTimer: params.hasPendingTimer,
    })
  ) {
    return {
      action: "skip",
      delayMs: null,
    };
  }

  return {
    action: "schedule_timer",
    delayMs: AGENT_STREAM_TEXT_DELTA_RENDER_FLUSH_MS,
  };
}

export function buildAgentStreamQueuedDraftCleanupTimerSchedulePlan(params: {
  shouldWatchCurrentRequest: boolean;
  streamActivated: boolean;
}): AgentStreamQueuedDraftCleanupTimerSchedulePlan {
  const shouldScheduleTimer =
    params.shouldWatchCurrentRequest && !params.streamActivated;

  return {
    shouldClearExistingTimer: true,
    shouldScheduleTimer,
    delayMs: shouldScheduleTimer
      ? AGENT_STREAM_QUEUED_DRAFT_CLEANUP_GRACE_MS
      : null,
  };
}

export function buildAgentStreamQueuedDraftCleanupTimerFirePlan(params: {
  requestFinished: boolean;
  streamActivated: boolean;
}): AgentStreamQueuedDraftCleanupTimerFirePlan {
  return {
    shouldCleanup: !params.requestFinished && !params.streamActivated,
  };
}
