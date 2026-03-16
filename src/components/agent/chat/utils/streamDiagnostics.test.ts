import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStreamDiagnosticsReporter } from "./streamDiagnostics";

const updateCrashContextMock = vi.fn();

vi.mock("@/lib/crashReporting", () => ({
  updateCrashContext: (context: unknown) => updateCrashContextMock(context),
}));

describe("streamDiagnostics", () => {
  beforeEach(() => {
    updateCrashContextMock.mockClear();
  });

  it("开始流后应写入基础上下文", () => {
    const reporter = createStreamDiagnosticsReporter("useAgentChat");
    reporter.start({
      sessionId: "session-1",
      eventName: "agent_stream_1",
      assistantMessageId: "assistant-1",
      source: "sendMessage",
    });

    expect(updateCrashContextMock).toHaveBeenCalledTimes(1);
    expect(updateCrashContextMock.mock.calls[0]?.[0]).toMatchObject({
      agent_stream_diag: expect.objectContaining({
        component: "useAgentChat",
        sessionId: "session-1",
        eventName: "agent_stream_1",
        assistantMessageId: "assistant-1",
        state: "streaming",
      }),
    });
  });

  it("遇到关键事件应立即刷新上下文", () => {
    const reporter = createStreamDiagnosticsReporter("useAgentChat");
    reporter.start({
      sessionId: "session-1",
      eventName: "agent_stream_1",
      assistantMessageId: "assistant-1",
      source: "sendMessage",
    });

    reporter.record({
      type: "tool_start",
      tool_id: "tool-1",
      tool_name: "WebSearch",
    });
    reporter.record({
      type: "tool_end",
      tool_id: "tool-1",
      result: {
        success: true,
        output: "ok",
      },
    });
    reporter.record({
      type: "final_done",
    });

    const lastCall = updateCrashContextMock.mock.calls.at(-1)?.[0] as {
      agent_stream_diag: Record<string, unknown>;
    };
    expect(lastCall.agent_stream_diag).toMatchObject({
      state: "done",
      toolStartCount: 1,
      toolEndCount: 1,
      finalDoneCount: 1,
      lastToolId: "tool-1",
    });
  });

  it("tool_end 缺少 output 时不应抛错", () => {
    const reporter = createStreamDiagnosticsReporter("useAgentChat");
    reporter.start({
      sessionId: "session-1",
      eventName: "agent_stream_1",
      assistantMessageId: "assistant-1",
      source: "sendMessage",
    });

    expect(() =>
      reporter.record({
        type: "tool_end",
        tool_id: "tool-1",
        result: {
          success: false,
          output: "",
          error: "failed",
        },
      }),
    ).not.toThrow();
  });

  it("解析失败时应记录 invalid 事件", () => {
    const reporter = createStreamDiagnosticsReporter("useAgentChat");
    reporter.start({
      sessionId: "session-1",
      eventName: "agent_stream_1",
      assistantMessageId: "assistant-1",
      source: "sendMessage",
    });

    reporter.recordInvalidEvent({ foo: "bar" });

    const snapshot = reporter.getSnapshot();
    expect(snapshot).toMatchObject({
      invalidEventCount: 1,
      lastEventType: "invalid",
      state: "streaming",
    });
  });
});
