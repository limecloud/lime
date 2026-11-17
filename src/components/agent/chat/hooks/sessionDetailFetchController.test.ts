import { describe, expect, it, vi } from "vitest";
import { loadSessionDetailWithPrefetch } from "./sessionDetailFetchController";
import type { SessionDetailFetchDetailLike } from "./sessionDetailFetchController";

function detail(
  messagesCount: number,
  overrides: Partial<SessionDetailFetchDetailLike> = {},
): SessionDetailFetchDetailLike {
  return {
    messages: Array.from({ length: messagesCount }, (_, index) => ({
      id: `message-${index}`,
    })),
    items: [],
    turns: [],
    ...overrides,
  };
}

function createClock(values: number[]) {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)] ?? 0;
    index += 1;
    return value;
  };
}

describe("sessionDetailFetchController", () => {
  it("应直接拉取详情并记录 start / success", async () => {
    const getSession = vi.fn().mockResolvedValue(detail(2));
    const onEvent = vi.fn();

    const result = await loadSessionDetailWithPrefetch({
      getSession,
      mode: "direct",
      now: createClock([100, 140, 160]),
      onEvent,
      startedAt: 20,
      topicId: "session-a",
      workspaceId: "workspace-a",
    });

    expect(result.messages).toHaveLength(2);
    expect(getSession).toHaveBeenCalledWith("session-a", {
      historyLimit: 40,
    });
    expect(onEvent.mock.calls.map(([event]) => event.logEvent)).toEqual([
      "switchTopic.fetchDetail.start",
      "switchTopic.fetchDetail.success",
    ]);
  });

  it("resumeSessionStartHooks 时应透传请求参数", async () => {
    const getSession = vi.fn().mockResolvedValue(detail(1));

    await loadSessionDetailWithPrefetch({
      getSession,
      mode: "deferred",
      resumeSessionStartHooks: true,
      startedAt: 0,
      topicId: "session-a",
      workspaceId: "workspace-a",
    });

    expect(getSession).toHaveBeenCalledWith("session-a", {
      historyLimit: 40,
      resumeSessionStartHooks: true,
    });
  });

  it("getSession 失败时应记录 error", async () => {
    const getSession = vi.fn().mockRejectedValue(new Error("detail failed"));
    const onEvent = vi.fn();

    await expect(
      loadSessionDetailWithPrefetch({
        getSession,
        mode: "direct",
        now: createClock([100, 120]),
        onEvent,
        startedAt: 80,
        topicId: "session-a",
        workspaceId: "workspace-a",
      }),
    ).rejects.toThrow("detail failed");

    expect(onEvent.mock.calls.map(([event]) => event.logEvent)).toEqual([
      "switchTopic.fetchDetail.start",
      "switchTopic.fetchDetail.error",
    ]);
    expect(onEvent.mock.calls[1]?.[0]).toMatchObject({
      logLevel: "error",
    });
  });

  it("详情请求超时应结束恢复而不是无限等待", async () => {
    const getSession = vi.fn(() => new Promise(() => undefined));
    const onEvent = vi.fn();

    await expect(
      loadSessionDetailWithPrefetch({
        getSession,
        mode: "direct",
        timeoutMs: 10,
        onEvent,
        startedAt: 0,
        topicId: "session-timeout",
      }),
    ).rejects.toThrow("timed out after 10ms");

    expect(onEvent.mock.calls.map(([event]) => event.logEvent)).toEqual([
      "switchTopic.fetchDetail.start",
      "switchTopic.fetchDetail.error",
    ]);
  });
});
