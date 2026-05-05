export interface AgentStreamUnknownEventPlan {
  eventType: string;
  shouldWarn: boolean;
  warningMessage: string | null;
}

export function buildAgentStreamUnknownEventWarningMessage(params: {
  eventName: string;
  eventType: string;
}): string {
  return `[AsterChat] 收到未识别的运行时事件，已保留流活跃态: ${params.eventName} · ${params.eventType}`;
}

export function resolveAgentStreamUnknownEventPlan(params: {
  eventName: string;
  eventType: string | null;
  warnedEventTypes: ReadonlySet<string>;
}): AgentStreamUnknownEventPlan | null {
  if (!params.eventType) {
    return null;
  }

  const shouldWarn = !params.warnedEventTypes.has(params.eventType);
  return {
    eventType: params.eventType,
    shouldWarn,
    warningMessage: shouldWarn
      ? buildAgentStreamUnknownEventWarningMessage({
          eventName: params.eventName,
          eventType: params.eventType,
        })
      : null,
  };
}

export function rememberAgentStreamUnknownEventWarning(params: {
  eventType: string;
  warnedEventTypes: Set<string>;
}): boolean {
  if (params.warnedEventTypes.has(params.eventType)) {
    return false;
  }

  params.warnedEventTypes.add(params.eventType);
  return true;
}
