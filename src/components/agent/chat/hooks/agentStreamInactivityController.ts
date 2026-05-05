export const AGENT_STREAM_FIRST_EVENT_TIMEOUT_MESSAGE =
  "执行已中断：运行时未返回任何进度事件，请重试。";

export const AGENT_STREAM_INACTIVITY_TIMEOUT_MESSAGE =
  "执行已中断：运行时长时间没有返回新进度，请重试。";

export type AgentStreamFirstEventTimeoutAction =
  | "defer"
  | "fail"
  | "ignore"
  | "recover";

export type AgentStreamInactivityTimeoutAction =
  | "fail"
  | "ignore"
  | "recover";

export function buildAgentStreamFirstEventSilentRecoveryWarning(params: {
  eventName: string;
}): string {
  return `[AsterChat] 首个运行时事件静默，已降级切换为会话快照同步: ${params.eventName}`;
}

export function buildAgentStreamFirstEventDeferredWarning(params: {
  eventName: string;
}): string {
  return `[AsterChat] 首个运行时事件暂未到达，已基于提交派发继续等待后续进度: ${params.eventName}`;
}

export function buildAgentStreamInactivitySilentRecoveryWarning(params: {
  eventName: string;
}): string {
  return `[AsterChat] 运行时事件静默，已降级切换为会话快照同步: ${params.eventName}`;
}

export function resolveAgentStreamFirstEventTimeoutAction(params: {
  canDeferAfterSubmission: boolean;
  firstEventReceived: boolean;
  recovered: boolean;
  requestFinished: boolean;
}): AgentStreamFirstEventTimeoutAction {
  if (params.firstEventReceived || params.requestFinished) {
    return "ignore";
  }
  if (params.recovered) {
    return "recover";
  }
  if (params.canDeferAfterSubmission) {
    return "defer";
  }
  return "fail";
}

export function resolveAgentStreamInactivityTimeoutAction(params: {
  recovered: boolean;
  shouldIgnore: boolean;
}): AgentStreamInactivityTimeoutAction {
  if (params.shouldIgnore) {
    return "ignore";
  }
  if (params.recovered) {
    return "recover";
  }
  return "fail";
}
