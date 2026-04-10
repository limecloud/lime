import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeListen } from "@/lib/dev-bridge";
import {
  createAgentRuntimeEventListener,
  createAgentRuntimeEventSource,
  dedupeAgentRuntimeEventNames,
  defaultAgentRuntimeEventSource,
  getAgentSubagentStatusEventName,
  getAgentSubagentStreamEventName,
  listenAgentRuntimeEvent,
  listenAgentSubagentStatus,
  listenAgentSubagentStream,
} from "./agentRuntimeEvents";

vi.mock("@/lib/dev-bridge", () => ({
  safeListen: vi.fn(),
}));

describe("agentRuntimeEvents API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应生成并去重子代理运行时事件名", () => {
    expect(getAgentSubagentStatusEventName("session-1")).toBe(
      "agent_subagent_status:session-1",
    );
    expect(getAgentSubagentStreamEventName("session-1")).toBe(
      "agent_subagent_stream:session-1",
    );
    expect(
      dedupeAgentRuntimeEventNames([
        "agent_subagent_status:session-1",
        null,
        "agent_subagent_status:session-1",
        undefined,
        "agent_subagent_status:session-2",
      ]),
    ).toEqual([
      "agent_subagent_status:session-1",
      "agent_subagent_status:session-2",
    ]);
  });

  it("应代理子代理状态与流事件监听", async () => {
    vi.mocked(safeListen)
      .mockImplementationOnce(async (_event, handler) => {
        handler({
          payload: {
            type: "subagent_status_changed",
            session_id: "session-1",
            status: "running",
          },
        });
        return vi.fn();
      })
      .mockImplementationOnce(async (_event, handler) => {
        handler({
          payload: {
            type: "tool_start",
            tool_id: "tool-1",
            tool_name: "browser_snapshot",
          },
        });
        return vi.fn();
      });

    const statusListener = vi.fn();
    const streamListener = vi.fn();

    await listenAgentSubagentStatus("session-1", statusListener);
    await listenAgentSubagentStream("session-1", streamListener);

    expect(safeListen).toHaveBeenNthCalledWith(
      1,
      "agent_subagent_status:session-1",
      statusListener,
    );
    expect(safeListen).toHaveBeenNthCalledWith(
      2,
      "agent_subagent_stream:session-1",
      streamListener,
    );
    expect(statusListener).toHaveBeenCalledTimes(1);
    expect(streamListener).toHaveBeenCalledTimes(1);
  });

  it("应代理通用 runtime 事件监听", async () => {
    vi.mocked(safeListen).mockImplementationOnce(async (_event, handler) => {
      handler({
        payload: {
          type: "text_delta",
          text: "hello",
        },
      });
      return vi.fn();
    });

    const listener = vi.fn();
    await listenAgentRuntimeEvent("agent_turn_stream:session-1", listener);

    expect(safeListen).toHaveBeenCalledWith(
      "agent_turn_stream:session-1",
      listener,
    );
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("应支持注入自定义 listen transport 与 event source", async () => {
    const listen = vi.fn().mockResolvedValue(vi.fn());
    const listenEvent = createAgentRuntimeEventListener({ listen });
    const eventSource = createAgentRuntimeEventSource({ listenEvent });
    const handler = vi.fn();

    await eventSource.listenSubagentStatus("session-9", handler);
    await eventSource.listenSubagentStream("session-9", handler);

    expect(listen).toHaveBeenNthCalledWith(
      1,
      "agent_subagent_status:session-9",
      handler,
    );
    expect(listen).toHaveBeenNthCalledWith(
      2,
      "agent_subagent_stream:session-9",
      handler,
    );
    expect(defaultAgentRuntimeEventSource.listenRuntimeEvent).toBeTypeOf(
      "function",
    );
  });
});
