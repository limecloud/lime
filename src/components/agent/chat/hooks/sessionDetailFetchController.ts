import {
  buildSessionDetailHydrationOptions,
  type SessionDetailHydrationOptions,
} from "./sessionHydrationController";

export type SessionDetailFetchMode = "direct" | "deferred";

const SESSION_DETAIL_FETCH_TIMEOUT_MS = 12_000;

export interface SessionDetailFetchDetailLike {
  messages: readonly unknown[];
  items?: readonly unknown[] | null;
  turns?: readonly unknown[] | null;
}

export interface SessionDetailFetchEvent {
  logEvent: string;
  logContext: Record<string, unknown>;
  metricName?: string;
  metricContext?: Record<string, unknown>;
  logLevel?: "warn" | "error";
  throttleMs?: number;
}

function buildSessionDetailFetchMetricContext<
  TDetail extends SessionDetailFetchDetailLike,
>(params: {
  detail: TDetail;
  mode: SessionDetailFetchMode;
  requestDurationMs: number;
  resumeSessionStartHooks?: boolean;
  startedAt: number;
  timeoutMs?: number;
  topicId: string;
  workspaceId?: string | null;
  now: () => number;
  source?: string | null;
}): Record<string, unknown> {
  return {
    itemsCount: params.detail.items?.length ?? 0,
    messagesCount: params.detail.messages.length,
    mode: params.mode,
    requestDurationMs: params.requestDurationMs,
    ...(params.resumeSessionStartHooks !== undefined
      ? { resumeSessionStartHooks: params.resumeSessionStartHooks }
      : {}),
    sessionId: params.topicId,
    source: params.source,
    topicId: params.topicId,
    totalElapsedMs: params.now() - params.startedAt,
    turnsCount: params.detail.turns?.length ?? 0,
    workspaceId: params.workspaceId,
  };
}

export async function loadSessionDetailWithPrefetch<
  TDetail extends SessionDetailFetchDetailLike,
>(params: {
  getSession: (
    topicId: string,
    options: SessionDetailHydrationOptions,
  ) => Promise<TDetail>;
  mode: SessionDetailFetchMode;
  now?: () => number;
  onEvent?: (event: SessionDetailFetchEvent) => void;
  resumeSessionStartHooks?: boolean;
  source?: string | null;
  startedAt: number;
  timeoutMs?: number;
  topicId: string;
  workspaceId?: string | null;
}): Promise<TDetail> {
  const now = params.now ?? Date.now;
  const requestStartedAt = now();
  const resumeSessionStartHooks = params.resumeSessionStartHooks === true;
  const startContext = {
    elapsedBeforeRequestMs: requestStartedAt - params.startedAt,
    mode: params.mode,
    resumeSessionStartHooks,
    sessionId: params.topicId,
    source: params.source ?? null,
    topicId: params.topicId,
    workspaceId: params.workspaceId,
  };
  params.onEvent?.({
    logEvent: "switchTopic.fetchDetail.start",
    logContext: startContext,
    metricName: "session.switch.fetchDetail.start",
    metricContext: startContext,
  });

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const detail = await Promise.race([
      params.getSession(
        params.topicId,
        buildSessionDetailHydrationOptions({
          resumeSessionStartHooks,
          source: params.source,
        }),
      ),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () =>
            reject(
              new Error(
                `Session detail request timed out after ${params.timeoutMs ?? SESSION_DETAIL_FETCH_TIMEOUT_MS}ms`,
              ),
            ),
          params.timeoutMs ?? SESSION_DETAIL_FETCH_TIMEOUT_MS,
        );
      }),
    ]).finally(() => {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    });
    const context = buildSessionDetailFetchMetricContext({
      detail,
      mode: params.mode,
      requestDurationMs: now() - requestStartedAt,
      resumeSessionStartHooks,
      startedAt: params.startedAt,
      topicId: params.topicId,
      workspaceId: params.workspaceId,
      now,
      source: params.source ?? null,
    });
    params.onEvent?.({
      logEvent: "switchTopic.fetchDetail.success",
      logContext: context,
      metricName: "session.switch.fetchDetail.success",
      metricContext: context,
    });
    return detail;
  } catch (error) {
    const context = {
      error,
      mode: params.mode,
      requestDurationMs: now() - requestStartedAt,
      resumeSessionStartHooks,
      sessionId: params.topicId,
      source: params.source ?? null,
      topicId: params.topicId,
      totalElapsedMs: now() - params.startedAt,
      workspaceId: params.workspaceId,
    };
    params.onEvent?.({
      logEvent: "switchTopic.fetchDetail.error",
      logContext: context,
      metricName: "session.switch.fetchDetail.error",
      metricContext: context,
      logLevel: "error",
    });
    throw error;
  }
}
