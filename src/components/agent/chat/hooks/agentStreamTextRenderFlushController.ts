export interface AgentStreamTextRenderFlushPlan {
  backlogChars: number;
  firstTextRenderFlushAt: number | null;
  firstTextRenderFlushContext: Record<string, unknown> | null;
  flushLogContext: Record<string, unknown>;
  flushLogDedupeKey: string;
  nextLastTextRenderFlushAt: number;
  nextMaxTextDeltaBacklogChars: number;
  nextRenderedContent: string;
  nextTextDeltaFlushCount: number;
  shouldLogFlush: boolean;
  shouldScheduleFirstTextPaint: boolean;
  textDelta: string;
}

export function resolveAgentStreamPendingRenderedTextDelta(params: {
  accumulatedContent: string;
  renderedContent: string;
}): string {
  if (!params.renderedContent) {
    return params.accumulatedContent;
  }
  if (params.accumulatedContent.startsWith(params.renderedContent)) {
    return params.accumulatedContent.slice(params.renderedContent.length);
  }
  return params.accumulatedContent;
}

export function shouldFlushAgentStreamVisibleFirstText(params: {
  accumulatedContent: string;
  renderedContent: string;
}): boolean {
  return (
    !params.renderedContent && params.accumulatedContent.trim().length > 0
  );
}

export function shouldScheduleAgentStreamTextRenderTimer(params: {
  hasPendingTimer: boolean;
}): boolean {
  return !params.hasPendingTimer;
}

export function buildAgentStreamTextRenderFlushPlan(params: {
  activeSessionId: string;
  eventName: string;
  firstTextDeltaAt?: number | null;
  firstTextPaintAt?: number | null;
  firstTextPaintScheduled?: boolean | null;
  firstTextRenderFlushAt?: number | null;
  flushStartedAt: number;
  maxTextDeltaBacklogChars?: number | null;
  nextContent: string;
  renderedContent: string;
  requestStartedAt: number;
  textDeltaFlushCount?: number | null;
}): AgentStreamTextRenderFlushPlan | null {
  if (params.nextContent === params.renderedContent) {
    return null;
  }

  const nextTextDeltaFlushCount = (params.textDeltaFlushCount ?? 0) + 1;
  const backlogChars = Math.max(
    0,
    params.nextContent.length - params.renderedContent.length,
  );
  const nextMaxTextDeltaBacklogChars = Math.max(
    params.maxTextDeltaBacklogChars ?? 0,
    backlogChars,
  );
  const shouldRecordFirstFlush = !params.firstTextRenderFlushAt;
  const shouldScheduleFirstTextPaint =
    !params.firstTextPaintAt &&
    !params.firstTextPaintScheduled &&
    params.nextContent.trim().length > 0;
  const flushLogContext = {
    accumulatedChars: params.nextContent.length,
    backlogChars,
    elapsedMs: params.flushStartedAt - params.requestStartedAt,
    eventName: params.eventName,
    flushCount: nextTextDeltaFlushCount,
    maxBacklogChars: nextMaxTextDeltaBacklogChars,
    sessionId: params.activeSessionId,
  };

  return {
    backlogChars,
    firstTextRenderFlushAt: shouldRecordFirstFlush
      ? params.flushStartedAt
      : null,
    firstTextRenderFlushContext: shouldRecordFirstFlush
      ? {
          elapsedMs: params.flushStartedAt - params.requestStartedAt,
          eventName: params.eventName,
          firstTextDeltaDeltaMs: params.firstTextDeltaAt
            ? params.flushStartedAt - params.firstTextDeltaAt
            : null,
          sessionId: params.activeSessionId,
        }
      : null,
    flushLogContext,
    flushLogDedupeKey: `AgentStream:textRenderFlush:${params.eventName}:${nextTextDeltaFlushCount}`,
    nextLastTextRenderFlushAt: params.flushStartedAt,
    nextMaxTextDeltaBacklogChars,
    nextRenderedContent: params.nextContent,
    nextTextDeltaFlushCount,
    shouldLogFlush: backlogChars >= 80 || nextTextDeltaFlushCount === 1,
    shouldScheduleFirstTextPaint,
    textDelta: resolveAgentStreamPendingRenderedTextDelta({
      accumulatedContent: params.nextContent,
      renderedContent: params.renderedContent,
    }),
  };
}

export function buildAgentStreamFirstTextPaintContext(params: {
  activeSessionId: string;
  eventName: string;
  firstTextDeltaAt?: number | null;
  flushStartedAt: number;
  paintedAt: number;
  requestStartedAt: number;
}): Record<string, unknown> {
  return {
    elapsedMs: params.paintedAt - params.requestStartedAt,
    eventName: params.eventName,
    firstTextDeltaDeltaMs: params.firstTextDeltaAt
      ? params.paintedAt - params.firstTextDeltaAt
      : null,
    renderFlushDeltaMs: params.paintedAt - params.flushStartedAt,
    sessionId: params.activeSessionId,
  };
}
