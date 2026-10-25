import { afterEach, describe, expect, it } from "vitest";
import {
  clearAgentUiPerformanceMetrics,
  summarizeAgentUiPerformanceMetrics,
} from "@/lib/agentUiPerformanceMetrics";
import {
  clearAgentUiProjectionEvents,
  clearConversationProjectionDiagnostics,
  conversationProjectionStore,
  selectAgentUiProjectionEvents,
  selectLatestConversationStreamDiagnostic,
} from "../projection/conversationProjectionStore";
import {
  ensureAgentUiPerformanceTraceMetadata,
  extractAgentUiPerformanceTraceMetadata,
  mergeAgentUiPerformanceTraceMetadata,
  recordAgentStreamPerformanceMetric,
} from "./agentStreamPerformanceMetrics";

describe("agentStreamPerformanceMetrics", () => {
  afterEach(() => {
    clearAgentUiPerformanceMetrics();
    clearAgentUiProjectionEvents();
    clearConversationProjectionDiagnostics();
  });

  async function flushProjectionQueue() {
    await Promise.resolve();
  }

  it("记录现有性能指标时应同步写入 diagnostics，并异步写入 Agent UI projection", async () => {
    const trace = {
      requestId: "request-stream-a",
      sessionId: "draft-session-a",
      workspaceId: "workspace-a",
      source: "home-input",
      submittedAt: Date.now(),
    };

    const entry = recordAgentStreamPerformanceMetric(
      "agentStream.firstTextDelta",
      trace,
      {
        sessionId: "runtime-session-a",
        deltaLength: 8,
      },
    );

    const projection = selectLatestConversationStreamDiagnostic(
      conversationProjectionStore.getSnapshot(),
      "draft-session-a",
    );
    expect(projection).toMatchObject({
      phase: "agentStream.firstTextDelta",
      sessionId: "draft-session-a",
      workspaceId: "workspace-a",
      source: "home-input",
      requestId: "request-stream-a",
      actualSessionId: "runtime-session-a",
      metrics: {
        deltaLength: 8,
        requestId: "request-stream-a",
        actualSessionId: "runtime-session-a",
      },
    });
    expect(projection?.at).toBe(entry.at);
    expect(
      selectAgentUiProjectionEvents(conversationProjectionStore.getSnapshot()),
    ).toEqual([]);
    await flushProjectionQueue();
    expect(
      selectAgentUiProjectionEvents(conversationProjectionStore.getSnapshot()),
    ).toEqual([
      expect.objectContaining({
        type: "metric.changed",
        sourceType: "performance_metric",
        sessionId: "draft-session-a",
        owner: "diagnostics",
        scope: "session",
        surface: "diagnostics",
        persistence: "diagnostics_log",
        payload: expect.objectContaining({
          metricPhase: "agentStream.firstTextDelta",
          workspaceId: "workspace-a",
          requestId: "request-stream-a",
          actualSessionId: "runtime-session-a",
          metrics: expect.objectContaining({
            deltaLength: 8,
          }),
        }),
      }),
    ]);
  });

  it("合并 trace metadata 后应可从 requestMetadata 继续记录 projection", () => {
    const requestMetadata = mergeAgentUiPerformanceTraceMetadata(undefined, {
      requestId: "request-stream-b",
      runId: "run-b",
      sessionId: "draft-session-b",
      traceId: "trace-b",
      turnId: "turn-b",
      workspaceId: "workspace-b",
      source: "test",
      submittedAt: null,
      serverEventEmittedAt: 120,
      serverEventId: "event-b",
      serverEventSequence: 3,
      serverEventType: "message.delta",
      rendererEventReceivedAt: 150,
    });

    recordAgentStreamPerformanceMetric(
      "agentStream.submitAccepted",
      extractAgentUiPerformanceTraceMetadata(requestMetadata),
      {
        accepted: true,
      },
    );

    expect(
      selectLatestConversationStreamDiagnostic(
        conversationProjectionStore.getSnapshot(),
        "draft-session-b",
      ),
    ).toMatchObject({
      phase: "agentStream.submitAccepted",
      requestId: "request-stream-b",
      metrics: {
        bridgeDeliveryDeltaMs: 30,
        accepted: true,
        runId: "run-b",
        traceId: "trace-b",
        turnId: "turn-b",
        serverEventId: "event-b",
        serverEventSequence: 3,
        serverEventType: "message.delta",
      },
    });
  });

  it("Trace 开启时应为 requestMetadata 补齐 traceId 和 runId", () => {
    const requestMetadata = ensureAgentUiPerformanceTraceMetadata(
      { source: "existing" },
      {
        enabled: true,
        sessionId: "session-c",
        source: "agent-chat",
        submittedAt: 100,
        workspaceId: "workspace-c",
      },
    );

    const trace = extractAgentUiPerformanceTraceMetadata(requestMetadata);
    expect(trace).toMatchObject({
      sessionId: "session-c",
      source: "agent-chat",
      submittedAt: 100,
      workspaceId: "workspace-c",
    });
    expect(trace?.requestId).toMatch(/^conversation_request_/);
    expect(trace?.runId).toMatch(/^conversation_run_/);
    expect(trace?.traceId).toMatch(/^conversation_trace_/);
    expect(trace?.w3cTraceContext).toMatchObject({
      traceparent: expect.stringMatching(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/),
      tracestate: null,
      traceId: expect.stringMatching(/^[0-9a-f]{32}$/),
    });
  });

  it("Trace 开启时应保留已有合法 W3C carrier", () => {
    const traceparent =
      "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01";
    const requestMetadata = ensureAgentUiPerformanceTraceMetadata(
      {
        agentUiPerformanceTrace: {
          requestId: "request-existing",
          traceId: "trace-existing",
          w3cTraceContext: {
            traceparent,
            tracestate: "vendor=value",
          },
        },
      },
      {
        enabled: true,
      },
    );

    expect(
      extractAgentUiPerformanceTraceMetadata(requestMetadata)?.w3cTraceContext,
    ).toEqual({
      traceparent,
      tracestate: "vendor=value",
      traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
  });

  it("Trace 关闭且没有既有 trace 时不应新增 requestMetadata", () => {
    const requestMetadata = { source: "existing" };

    expect(
      ensureAgentUiPerformanceTraceMetadata(requestMetadata, {
        enabled: false,
      }),
    ).toBe(requestMetadata);
    expect(
      ensureAgentUiPerformanceTraceMetadata(undefined, {
        enabled: false,
      }),
    ).toBeUndefined();
  });

  it("summary 应拆出 provider wait 与客户端本地输出耗时", () => {
    const trace = {
      requestId: "request-provider-summary",
      runId: "run-provider-summary",
      sessionId: "session-provider-summary",
      traceId: "trace-provider-summary",
      workspaceId: "workspace-provider-summary",
      providerWaitMs: 1500,
      serverEventEmittedAt: 2000,
      rendererEventReceivedAt: 2020,
    };

    recordAgentStreamPerformanceMetric("agentStream.providerTrace", trace, {
      elapsedMs: 1500,
      providerWaitMs: 1500,
      sessionId: "session-provider-summary",
      stage: "first_text_delta_received",
    });
    recordAgentStreamPerformanceMetric("agentStream.firstTextDelta", trace, {
      rendererEventReceivedDeltaMs: 15,
      serverToRendererDeltaMs: 20,
      sessionId: "session-provider-summary",
    });
    recordAgentStreamPerformanceMetric("agentStream.firstTextPaint", trace, {
      clientLocalOutputDeltaMs: 64,
      sessionId: "session-provider-summary",
    });

    expect(summarizeAgentUiPerformanceMetrics().sessions[0]).toMatchObject({
      sessionId: "session-provider-summary",
      workspaceId: "workspace-provider-summary",
      providerWaitMs: 1500,
      serverToRendererFirstTextDeltaMs: 20,
      rendererApplyFirstTextDeltaMs: 15,
      clientLocalOutputMs: 64,
    });
  });
});
