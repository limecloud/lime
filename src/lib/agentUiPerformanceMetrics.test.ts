import { afterEach, describe, expect, it } from "vitest";
import {
  clearAgentUiPerformanceMetrics,
  getAgentUiPerformanceMetrics,
  recordAgentUiPerformanceMetric,
  summarizeAgentUiPerformanceMetrics,
} from "./agentUiPerformanceMetrics";

describe("agentUiPerformanceMetrics", () => {
  afterEach(() => {
    clearAgentUiPerformanceMetrics();
  });

  it("应按会话汇总旧会话打开链路的关键耗时", () => {
    clearAgentUiPerformanceMetrics();

    recordAgentUiPerformanceMetric("sidebar.conversation.click", {
      sessionId: "session-a",
      source: "conversation_shelf",
      workspaceId: "workspace-a",
    });
    recordAgentUiPerformanceMetric("session.switch.start", {
      sessionId: "session-a",
      workspaceId: "workspace-a",
    });
    recordAgentUiPerformanceMetric("session.switch.fetchDetail.start", {
      sessionId: "session-a",
      workspaceId: "workspace-a",
    });
    recordAgentUiPerformanceMetric("session.switch.fetchDetail.success", {
      requestDurationMs: 174,
      sessionId: "session-a",
      workspaceId: "workspace-a",
    });
    recordAgentUiPerformanceMetric("agentRuntime.getSession.start", {
      sessionId: "session-a",
    });
    recordAgentUiPerformanceMetric("agentRuntime.getSession.success", {
      durationMs: 181,
      sessionId: "session-a",
    });
    recordAgentUiPerformanceMetric("session.switch.success", {
      durationMs: 220,
      sessionId: "session-a",
    });
    recordAgentUiPerformanceMetric("messageList.paint", {
      historicalContentPartsDeferredCount: 2,
      historicalMarkdownDeferredCount: 3,
      hiddenHistoryCount: 120,
      messagesCount: 40,
      persistedHiddenHistoryCount: 120,
      renderedMessagesCount: 10,
      sessionId: "session-a",
      threadItemsScanDeferred: true,
      threadItemsCount: 0,
    });

    const summary = summarizeAgentUiPerformanceMetrics();
    expect(summary.sessions).toEqual([
      expect.objectContaining({
        sessionId: "session-a",
        workspaceId: "workspace-a",
        fetchDetailDurationMs: 174,
        runtimeGetSessionDurationMs: 181,
        switchStartCount: 1,
        fetchDetailStartCount: 1,
        fetchDetailErrorCount: 0,
        runtimeGetSessionStartCount: 1,
        runtimeGetSessionErrorCount: 0,
        messageListPaintCount: 1,
        finalMessagesCount: 40,
        finalRenderedMessagesCount: 10,
        hiddenHistoryCount: 120,
        historicalContentPartsDeferredMax: 2,
        historicalMarkdownDeferredMax: 3,
        persistedHiddenHistoryCount: 120,
        threadItemsScanDeferredCount: 1,
      }),
    ]);
    expect(summary.sessions[0]?.clickToSwitchStartMs).toBeGreaterThanOrEqual(0);
    expect(
      summary.sessions[0]?.clickToMessageListPaintMs,
    ).toBeGreaterThanOrEqual(0);
  });

  it("应在 window 上暴露给 Playwright 读取的 API", () => {
    recordAgentUiPerformanceMetric("sidebar.conversation.click", {
      sessionId: "session-window-api",
    });

    expect(window.__LIME_AGENTUI_PERF__?.entries()).toHaveLength(1);
    expect(window.__LIME_AGENTUI_PERF__?.summary().sessions[0]?.sessionId).toBe(
      "session-window-api",
    );

    window.__LIME_AGENTUI_PERF__?.clear();
    expect(getAgentUiPerformanceMetrics()).toHaveLength(0);
  });
});
