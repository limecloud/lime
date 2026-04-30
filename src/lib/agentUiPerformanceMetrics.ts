export interface AgentUiPerformanceEntry {
  id: number;
  phase: string;
  at: number;
  wallTime: number;
  sessionId?: string | null;
  workspaceId?: string | null;
  source?: string | null;
  metrics: Record<string, string | number | boolean | null>;
}

export interface AgentUiPerformanceSessionSummary {
  sessionId: string;
  workspaceId?: string | null;
  clickToSwitchStartMs?: number;
  clickToCachedSnapshotMs?: number;
  clickToPendingShellMs?: number;
  clickToFetchStartMs?: number;
  fetchDetailDurationMs?: number;
  runtimeGetSessionDurationMs?: number;
  clickToSwitchSuccessMs?: number;
  clickToMessageListPaintMs?: number;
  switchStartCount?: number;
  fetchDetailStartCount?: number;
  fetchDetailErrorCount?: number;
  runtimeGetSessionStartCount?: number;
  runtimeGetSessionErrorCount?: number;
  messageListPaintCount?: number;
  finalMessagesCount?: number;
  finalRenderedMessagesCount?: number;
  finalThreadItemsCount?: number;
  hiddenHistoryCount?: number;
  persistedHiddenHistoryCount?: number;
  historicalContentPartsDeferredMax?: number;
  historicalMarkdownDeferredMax?: number;
  threadItemsScanDeferredCount?: number;
  maxUsedJSHeapSize?: number;
  phases: string[];
}

export interface AgentUiPerformanceSnapshot {
  entries: AgentUiPerformanceEntry[];
  sessions: AgentUiPerformanceSessionSummary[];
}

export interface AgentUiPerformanceApi {
  entries: () => AgentUiPerformanceEntry[];
  clear: () => void;
  summary: () => AgentUiPerformanceSnapshot;
}

type MetricValue = string | number | boolean | null;

const MAX_AGENT_UI_PERFORMANCE_ENTRIES = 500;
const entries: AgentUiPerformanceEntry[] = [];
let nextEntryId = 1;

declare global {
  interface Window {
    __LIME_AGENTUI_PERF__?: AgentUiPerformanceApi;
  }
}

function now(): number {
  if (typeof performance !== "undefined" && performance.now) {
    return performance.now();
  }
  return Date.now();
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizeMetricValue(value: unknown): MetricValue | undefined {
  if (value == null) {
    return null;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    return value.length > 200 ? `${value.slice(0, 200)}...` : value;
  }

  return undefined;
}

function normalizeMetrics(
  context: Record<string, unknown> | undefined,
): Record<string, MetricValue> {
  const metrics: Record<string, MetricValue> = {};
  for (const [key, value] of Object.entries(context ?? {})) {
    if (key === "sessionId" || key === "topicId" || key === "workspaceId") {
      continue;
    }

    const normalized = normalizeMetricValue(value);
    if (normalized !== undefined) {
      metrics[key] = normalized;
    }
  }

  const memory =
    typeof window !== "undefined"
      ? (
          window.performance as Performance & {
            memory?: {
              usedJSHeapSize?: number;
              totalJSHeapSize?: number;
            };
          }
        )?.memory
      : undefined;
  if (typeof memory?.usedJSHeapSize === "number") {
    metrics.usedJSHeapSize = memory.usedJSHeapSize;
  }
  if (typeof memory?.totalJSHeapSize === "number") {
    metrics.totalJSHeapSize = memory.totalJSHeapSize;
  }

  return metrics;
}

function normalizeSessionId(context?: Record<string, unknown>): string | null {
  return (
    normalizeString(context?.sessionId) ??
    normalizeString(context?.topicId) ??
    null
  );
}

function pushEntry(entry: AgentUiPerformanceEntry): void {
  entries.push(entry);
  if (entries.length > MAX_AGENT_UI_PERFORMANCE_ENTRIES) {
    entries.splice(0, entries.length - MAX_AGENT_UI_PERFORMANCE_ENTRIES);
  }
}

function firstEntry(
  sessionEntries: AgentUiPerformanceEntry[],
  phase: string,
): AgentUiPerformanceEntry | null {
  return sessionEntries.find((entry) => entry.phase === phase) ?? null;
}

function lastEntry(
  sessionEntries: AgentUiPerformanceEntry[],
  phase: string,
): AgentUiPerformanceEntry | null {
  for (let index = sessionEntries.length - 1; index >= 0; index -= 1) {
    const entry = sessionEntries[index];
    if (entry?.phase === phase) {
      return entry;
    }
  }
  return null;
}

function deltaMs(
  start: AgentUiPerformanceEntry | null,
  end: AgentUiPerformanceEntry | null,
): number | undefined {
  if (!start || !end) {
    return undefined;
  }
  return Math.max(0, Math.round(end.at - start.at));
}

function metricNumber(
  entry: AgentUiPerformanceEntry | null,
  key: string,
): number | undefined {
  const value = entry?.metrics[key];
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value)
    : undefined;
}

function maxMetric(
  sessionEntries: AgentUiPerformanceEntry[],
  key: string,
): number | undefined {
  let max: number | undefined;
  for (const entry of sessionEntries) {
    const value = entry.metrics[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      continue;
    }
    max = max === undefined ? value : Math.max(max, value);
  }
  return max === undefined ? undefined : Math.round(max);
}

function countEntries(
  sessionEntries: AgentUiPerformanceEntry[],
  phase: string,
): number {
  return sessionEntries.reduce(
    (count, entry) => count + (entry.phase === phase ? 1 : 0),
    0,
  );
}

function countMetricTrue(
  sessionEntries: AgentUiPerformanceEntry[],
  key: string,
): number {
  return sessionEntries.reduce(
    (count, entry) => count + (entry.metrics[key] === true ? 1 : 0),
    0,
  );
}

export function summarizeAgentUiPerformanceMetrics(): AgentUiPerformanceSnapshot {
  const grouped = new Map<string, AgentUiPerformanceEntry[]>();
  for (const entry of entries) {
    const sessionId = entry.sessionId?.trim();
    if (!sessionId) {
      continue;
    }
    const sessionEntries = grouped.get(sessionId) ?? [];
    sessionEntries.push(entry);
    grouped.set(sessionId, sessionEntries);
  }

  const sessions: AgentUiPerformanceSessionSummary[] = Array.from(
    grouped.entries(),
  ).map(([sessionId, sessionEntries]) => {
    const click = firstEntry(sessionEntries, "sidebar.conversation.click");
    const switchStart = firstEntry(sessionEntries, "session.switch.start");
    const cachedSnapshot = firstEntry(
      sessionEntries,
      "session.switch.cachedSnapshotApplied",
    );
    const pendingShell = firstEntry(
      sessionEntries,
      "session.switch.pendingShellApplied",
    );
    const fetchStart = firstEntry(
      sessionEntries,
      "session.switch.fetchDetail.start",
    );
    const fetchSuccess = lastEntry(
      sessionEntries,
      "session.switch.fetchDetail.success",
    );
    const runtimeGetSessionSuccess = lastEntry(
      sessionEntries,
      "agentRuntime.getSession.success",
    );
    const switchSuccess = lastEntry(sessionEntries, "session.switch.success");
    const messageListPaint = lastEntry(sessionEntries, "messageList.paint");
    const finalMessageList =
      messageListPaint ?? lastEntry(sessionEntries, "messageList.commit");

    return {
      sessionId,
      workspaceId:
        sessionEntries.find((entry) => entry.workspaceId)?.workspaceId ?? null,
      clickToSwitchStartMs: deltaMs(click, switchStart),
      clickToCachedSnapshotMs: deltaMs(click, cachedSnapshot),
      clickToPendingShellMs: deltaMs(click, pendingShell),
      clickToFetchStartMs: deltaMs(click, fetchStart),
      fetchDetailDurationMs: metricNumber(fetchSuccess, "requestDurationMs"),
      runtimeGetSessionDurationMs: metricNumber(
        runtimeGetSessionSuccess,
        "durationMs",
      ),
      clickToSwitchSuccessMs: deltaMs(click, switchSuccess),
      clickToMessageListPaintMs: deltaMs(click, messageListPaint),
      switchStartCount: countEntries(sessionEntries, "session.switch.start"),
      fetchDetailStartCount: countEntries(
        sessionEntries,
        "session.switch.fetchDetail.start",
      ),
      fetchDetailErrorCount: countEntries(
        sessionEntries,
        "session.switch.fetchDetail.error",
      ),
      runtimeGetSessionStartCount: countEntries(
        sessionEntries,
        "agentRuntime.getSession.start",
      ),
      runtimeGetSessionErrorCount: countEntries(
        sessionEntries,
        "agentRuntime.getSession.error",
      ),
      messageListPaintCount: countEntries(sessionEntries, "messageList.paint"),
      finalMessagesCount: metricNumber(finalMessageList, "messagesCount"),
      finalRenderedMessagesCount: metricNumber(
        finalMessageList,
        "renderedMessagesCount",
      ),
      finalThreadItemsCount: metricNumber(finalMessageList, "threadItemsCount"),
      hiddenHistoryCount: metricNumber(finalMessageList, "hiddenHistoryCount"),
      persistedHiddenHistoryCount: metricNumber(
        finalMessageList,
        "persistedHiddenHistoryCount",
      ),
      historicalContentPartsDeferredMax: maxMetric(
        sessionEntries,
        "historicalContentPartsDeferredCount",
      ),
      historicalMarkdownDeferredMax: maxMetric(
        sessionEntries,
        "historicalMarkdownDeferredCount",
      ),
      threadItemsScanDeferredCount: countMetricTrue(
        sessionEntries,
        "threadItemsScanDeferred",
      ),
      maxUsedJSHeapSize: maxMetric(sessionEntries, "usedJSHeapSize"),
      phases: sessionEntries.map((entry) => entry.phase),
    };
  });

  sessions.sort((left, right) => left.sessionId.localeCompare(right.sessionId));
  return {
    entries: entries.slice(),
    sessions,
  };
}

export function clearAgentUiPerformanceMetrics(): void {
  entries.splice(0, entries.length);
  nextEntryId = 1;
}

export function getAgentUiPerformanceMetrics(): AgentUiPerformanceEntry[] {
  return entries.slice();
}

export function recordAgentUiPerformanceMetric(
  phase: string,
  context?: Record<string, unknown>,
): AgentUiPerformanceEntry {
  const entry: AgentUiPerformanceEntry = {
    id: nextEntryId,
    phase,
    at: now(),
    wallTime: Date.now(),
    sessionId: normalizeSessionId(context),
    workspaceId: normalizeString(context?.workspaceId),
    source: normalizeString(context?.source),
    metrics: normalizeMetrics(context),
  };
  nextEntryId += 1;
  pushEntry(entry);
  installAgentUiPerformanceApi();
  return entry;
}

export function installAgentUiPerformanceApi(): AgentUiPerformanceApi | null {
  if (typeof window === "undefined") {
    return null;
  }

  const api: AgentUiPerformanceApi = {
    entries: getAgentUiPerformanceMetrics,
    clear: clearAgentUiPerformanceMetrics,
    summary: summarizeAgentUiPerformanceMetrics,
  };
  window.__LIME_AGENTUI_PERF__ = api;
  return api;
}

installAgentUiPerformanceApi();
