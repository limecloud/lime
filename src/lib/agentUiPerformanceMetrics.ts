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
  homeInputToPendingShellMs?: number;
  homeInputToPendingPreviewPaintMs?: number;
  homeInputToSendDispatchMs?: number;
  homeInputToStreamRequestStartMs?: number;
  homeInputToSubmitAcceptedMs?: number;
  homeInputToFirstEventMs?: number;
  homeInputToFirstRuntimeStatusMs?: number;
  homeInputToFirstTextDeltaMs?: number;
  homeInputToFirstTextRenderFlushMs?: number;
  homeInputToFirstTextPaintMs?: number;
  sendDispatchToSubmitAcceptedMs?: number;
  streamSubmitDispatchedToAcceptedMs?: number;
  submitAcceptedToFirstEventMs?: number;
  firstEventToFirstTextDeltaMs?: number;
  firstTextDeltaToFirstTextPaintMs?: number;
  streamEnsureSessionDurationMs?: number;
  streamSubmitInvokeDurationMs?: number;
  homeInputMaterializeDurationMs?: number;
  clickToSwitchStartMs?: number;
  clickToCachedSnapshotMs?: number;
  clickToPendingShellMs?: number;
  clickToFetchStartMs?: number;
  fetchDetailDurationMs?: number;
  runtimeGetSessionDurationMs?: number;
  clickToSwitchSuccessMs?: number;
  clickToFirstMessageListPaintMs?: number;
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
  longTaskCount?: number;
  longTaskMaxMs?: number;
  messageListComputeMaxMs?: number;
  messageListGroupBuildMaxMs?: number;
  messageListHistoricalContentPartsScanMaxMs?: number;
  messageListHistoricalMarkdownTargetScanMaxMs?: number;
  messageListRenderGroupsMaxMs?: number;
  messageListThreadItemsScanMaxMs?: number;
  messageListTimelineBuildMaxMs?: number;
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
let latestSessionId: string | null = null;
let latestWorkspaceId: string | null = null;
let longTaskObserverInstallAttempted = false;
let longTaskObserver: PerformanceObserver | null = null;

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

function maxMetricForPhase(
  sessionEntries: AgentUiPerformanceEntry[],
  phase: string,
  key: string,
): number | undefined {
  return maxMetric(
    sessionEntries.filter((entry) => entry.phase === phase),
    key,
  );
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

function installLongTaskObserver(): void {
  if (
    typeof window === "undefined" ||
    longTaskObserverInstallAttempted ||
    longTaskObserver
  ) {
    return;
  }
  longTaskObserverInstallAttempted = true;

  const ObserverCtor = window.PerformanceObserver;
  if (typeof ObserverCtor !== "function") {
    return;
  }

  const supportedEntryTypes = ObserverCtor.supportedEntryTypes;
  if (
    Array.isArray(supportedEntryTypes) &&
    !supportedEntryTypes.includes("longtask")
  ) {
    return;
  }

  try {
    const observer = new ObserverCtor((list) => {
      for (const entry of list.getEntries()) {
        recordAgentUiPerformanceMetric("agentUi.longTask", {
          durationMs: entry.duration,
          name: entry.name,
          sessionId: latestSessionId,
          startTimeMs: entry.startTime,
          workspaceId: latestWorkspaceId,
        });
      }
    });

    try {
      observer.observe({ type: "longtask", buffered: true });
    } catch {
      observer.observe({ entryTypes: ["longtask"] });
    }
    longTaskObserver = observer;
  } catch {
    // 当前 WebView / 测试环境可能不支持 longtask，忽略即可。
  }
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
    const homeInputSubmit = firstEntry(sessionEntries, "homeInput.submit");
    const homeInputPendingShell = firstEntry(
      sessionEntries,
      "homeInput.pendingShellApplied",
    );
    const homeInputPendingPreviewPaint = firstEntry(
      sessionEntries,
      "homeInput.pendingPreviewPaint",
    );
    const homeInputSendDispatch = firstEntry(
      sessionEntries,
      "homeInput.sendDispatch.start",
    );
    const streamRequestStart = firstEntry(
      sessionEntries,
      "agentStream.request.start",
    );
    const streamEnsureSessionDone = lastEntry(
      sessionEntries,
      "agentStream.ensureSession.done",
    );
    const streamSubmitDispatched = firstEntry(
      sessionEntries,
      "agentStream.submitDispatched",
    );
    const streamSubmitAccepted = firstEntry(
      sessionEntries,
      "agentStream.submitAccepted",
    );
    const streamFirstEvent = firstEntry(
      sessionEntries,
      "agentStream.firstEvent",
    );
    const streamFirstRuntimeStatus = firstEntry(
      sessionEntries,
      "agentStream.firstRuntimeStatus",
    );
    const streamFirstTextDelta = firstEntry(
      sessionEntries,
      "agentStream.firstTextDelta",
    );
    const streamFirstTextRenderFlush = firstEntry(
      sessionEntries,
      "agentStream.firstTextRenderFlush",
    );
    const streamFirstTextPaint = firstEntry(
      sessionEntries,
      "agentStream.firstTextPaint",
    );
    const draftMaterializeSuccess = lastEntry(
      sessionEntries,
      "taskCenter.draftMaterialize.success",
    );
    const firstMessageListPaint = firstEntry(sessionEntries, "messageList.paint");
    const messageListPaint = lastEntry(sessionEntries, "messageList.paint");
    const finalMessageList =
      messageListPaint ?? lastEntry(sessionEntries, "messageList.commit");

    return {
      sessionId,
      workspaceId:
        sessionEntries.find((entry) => entry.workspaceId)?.workspaceId ?? null,
      homeInputToPendingShellMs: deltaMs(
        homeInputSubmit,
        homeInputPendingShell,
      ),
      homeInputToPendingPreviewPaintMs: deltaMs(
        homeInputSubmit,
        homeInputPendingPreviewPaint,
      ),
      homeInputToSendDispatchMs: deltaMs(homeInputSubmit, homeInputSendDispatch),
      homeInputToStreamRequestStartMs: deltaMs(
        homeInputSubmit,
        streamRequestStart,
      ),
      homeInputToSubmitAcceptedMs: deltaMs(homeInputSubmit, streamSubmitAccepted),
      homeInputToFirstEventMs: deltaMs(homeInputSubmit, streamFirstEvent),
      homeInputToFirstRuntimeStatusMs: deltaMs(
        homeInputSubmit,
        streamFirstRuntimeStatus,
      ),
      homeInputToFirstTextDeltaMs: deltaMs(
        homeInputSubmit,
        streamFirstTextDelta,
      ),
      homeInputToFirstTextRenderFlushMs: deltaMs(
        homeInputSubmit,
        streamFirstTextRenderFlush,
      ),
      homeInputToFirstTextPaintMs: deltaMs(
        homeInputSubmit,
        streamFirstTextPaint,
      ),
      sendDispatchToSubmitAcceptedMs: deltaMs(
        homeInputSendDispatch,
        streamSubmitAccepted,
      ),
      streamSubmitDispatchedToAcceptedMs: deltaMs(
        streamSubmitDispatched,
        streamSubmitAccepted,
      ),
      submitAcceptedToFirstEventMs: deltaMs(
        streamSubmitAccepted,
        streamFirstEvent,
      ),
      firstEventToFirstTextDeltaMs: deltaMs(
        streamFirstEvent,
        streamFirstTextDelta,
      ),
      firstTextDeltaToFirstTextPaintMs: deltaMs(
        streamFirstTextDelta,
        streamFirstTextPaint,
      ),
      streamEnsureSessionDurationMs: metricNumber(
        streamEnsureSessionDone,
        "durationMs",
      ),
      streamSubmitInvokeDurationMs: metricNumber(
        streamSubmitAccepted,
        "submitInvokeMs",
      ),
      homeInputMaterializeDurationMs: metricNumber(
        draftMaterializeSuccess,
        "durationMs",
      ),
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
      clickToFirstMessageListPaintMs: deltaMs(click, firstMessageListPaint),
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
      longTaskCount: countEntries(sessionEntries, "agentUi.longTask"),
      longTaskMaxMs: maxMetricForPhase(
        sessionEntries,
        "agentUi.longTask",
        "durationMs",
      ),
      messageListComputeMaxMs: maxMetric(sessionEntries, "messageListComputeMs"),
      messageListGroupBuildMaxMs: maxMetric(
        sessionEntries,
        "messageListGroupBuildMs",
      ),
      messageListHistoricalContentPartsScanMaxMs: maxMetric(
        sessionEntries,
        "messageListHistoricalContentPartsScanMs",
      ),
      messageListHistoricalMarkdownTargetScanMaxMs: maxMetric(
        sessionEntries,
        "messageListHistoricalMarkdownTargetScanMs",
      ),
      messageListRenderGroupsMaxMs: maxMetric(
        sessionEntries,
        "messageListRenderGroupsMs",
      ),
      messageListThreadItemsScanMaxMs: maxMetric(
        sessionEntries,
        "messageListThreadItemsScanMs",
      ),
      messageListTimelineBuildMaxMs: maxMetric(
        sessionEntries,
        "messageListTimelineBuildMs",
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
  latestSessionId = null;
  latestWorkspaceId = null;
}

export function getAgentUiPerformanceMetrics(): AgentUiPerformanceEntry[] {
  return entries.slice();
}

export function recordAgentUiPerformanceMetric(
  phase: string,
  context?: Record<string, unknown>,
): AgentUiPerformanceEntry {
  const sessionId = normalizeSessionId(context);
  const workspaceId = normalizeString(context?.workspaceId);
  if (sessionId && phase !== "agentUi.longTask") {
    latestSessionId = sessionId;
    latestWorkspaceId = workspaceId;
  }

  const entry: AgentUiPerformanceEntry = {
    id: nextEntryId,
    phase,
    at: now(),
    wallTime: Date.now(),
    sessionId,
    workspaceId,
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

  installLongTaskObserver();

  const api: AgentUiPerformanceApi = {
    entries: getAgentUiPerformanceMetrics,
    clear: clearAgentUiPerformanceMetrics,
    summary: summarizeAgentUiPerformanceMetrics,
  };
  window.__LIME_AGENTUI_PERF__ = api;
  return api;
}

installAgentUiPerformanceApi();
