import {
  buildSessionDetailHydrationOptions,
  buildSessionDetailPrefetchKey,
  type SessionDetailHydrationOptions,
} from "./sessionHydrationController";

export type SessionDetailFetchMode = "direct" | "deferred";

export interface SessionDetailFetchDetailLike {
  messages: readonly unknown[];
  items?: readonly unknown[] | null;
  turns?: readonly unknown[] | null;
  queued_turns?: readonly unknown[] | null;
}

export interface SessionDetailPrefetchEntry<TDetail> {
  signature: string;
  promise: Promise<TDetail>;
}

export interface SessionDetailPrefetchRegistry<TDetail> {
  get: (key: string) => SessionDetailPrefetchEntry<TDetail> | undefined;
  set: (key: string, entry: SessionDetailPrefetchEntry<TDetail>) => void;
  deleteIfCurrent: (key: string, promise: Promise<TDetail>) => void;
  clear: () => void;
}

export interface SessionDetailFetchEvent {
  logEvent: string;
  logContext: Record<string, unknown>;
  metricName?: string;
  metricContext?: Record<string, unknown>;
  logLevel?: "warn" | "error";
  throttleMs?: number;
}

export function createSessionDetailPrefetchRegistry<
  TDetail,
>(): SessionDetailPrefetchRegistry<TDetail> {
  const entries = new Map<string, SessionDetailPrefetchEntry<TDetail>>();

  return {
    get: (key) => entries.get(key),
    set: (key, entry) => {
      entries.set(key, entry);
    },
    deleteIfCurrent: (key, promise) => {
      const current = entries.get(key);
      if (current?.promise === promise) {
        entries.delete(key);
      }
    },
    clear: () => entries.clear(),
  };
}

function buildSessionDetailFetchMetricContext<TDetail extends SessionDetailFetchDetailLike>(params: {
  detail: TDetail;
  mode: SessionDetailFetchMode;
  requestDurationMs: number;
  resumeSessionStartHooks?: boolean;
  startedAt: number;
  topicId: string;
  workspaceId?: string | null;
  now: () => number;
}): Record<string, unknown> {
  return {
    itemsCount: params.detail.items?.length ?? 0,
    messagesCount: params.detail.messages.length,
    mode: params.mode,
    queuedTurnsCount: params.detail.queued_turns?.length ?? 0,
    requestDurationMs: params.requestDurationMs,
    ...(params.resumeSessionStartHooks !== undefined
      ? { resumeSessionStartHooks: params.resumeSessionStartHooks }
      : {}),
    sessionId: params.topicId,
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
  prefetchRegistry: SessionDetailPrefetchRegistry<TDetail>;
  prefetchWorkspaceId?: string | null;
  resumeSessionStartHooks?: boolean;
  startedAt: number;
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
    topicId: params.topicId,
    workspaceId: params.workspaceId,
  };
  params.onEvent?.({
    logEvent: "switchTopic.fetchDetail.start",
    logContext: startContext,
    metricName: "session.switch.fetchDetail.start",
    metricContext: startContext,
  });

  try {
    const prefetchKey = buildSessionDetailPrefetchKey(
      params.prefetchWorkspaceId ?? params.workspaceId ?? "",
      params.topicId,
    );
    const prefetchedDetail = !resumeSessionStartHooks
      ? params.prefetchRegistry.get(prefetchKey)
      : undefined;

    if (prefetchedDetail) {
      try {
        const detail = await prefetchedDetail.promise;
        const context = buildSessionDetailFetchMetricContext({
          detail,
          mode: params.mode,
          requestDurationMs: now() - requestStartedAt,
          startedAt: params.startedAt,
          topicId: params.topicId,
          workspaceId: params.workspaceId,
          now,
        });
        params.onEvent?.({
          logEvent: "switchTopic.fetchDetail.prefetch",
          logContext: context,
          metricName: "session.switch.fetchDetail.prefetch",
          metricContext: context,
        });
        return detail;
      } catch (error) {
        params.onEvent?.({
          logEvent: "switchTopic.fetchDetail.prefetchFallback",
          logContext: {
            error,
            mode: params.mode,
            topicId: params.topicId,
            workspaceId: params.workspaceId,
          },
          logLevel: "warn",
          throttleMs: 1000,
        });
      }
    }

    const detail = await params.getSession(
      params.topicId,
      buildSessionDetailHydrationOptions({ resumeSessionStartHooks }),
    );
    const context = buildSessionDetailFetchMetricContext({
      detail,
      mode: params.mode,
      requestDurationMs: now() - requestStartedAt,
      resumeSessionStartHooks,
      startedAt: params.startedAt,
      topicId: params.topicId,
      workspaceId: params.workspaceId,
      now,
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
