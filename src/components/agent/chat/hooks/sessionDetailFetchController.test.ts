import { describe, expect, it, vi } from "vitest";
import {
  createSessionDetailPrefetchRegistry,
  loadSessionDetailWithPrefetch,
  type SessionDetailFetchDetailLike,
} from "./sessionDetailFetchController";

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
    queued_turns: [],
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
  it("应优先复用 matching prefetch，不再重复调用 getSession", async () => {
    const registry = createSessionDetailPrefetchRegistry<SessionDetailFetchDetailLike>();
    registry.set("workspace-a:session-a", {
      signature: "signature-a",
      promise: Promise.resolve(
        detail(2, { items: [{ id: "item-a" }], turns: [{ id: "turn-a" }] }),
      ),
    });
    const getSession = vi.fn();
    const onEvent = vi.fn();

    const result = await loadSessionDetailWithPrefetch({
      getSession,
      mode: "direct",
      now: createClock([100, 140, 160]),
      onEvent,
      prefetchRegistry: registry,
      prefetchWorkspaceId: "workspace-a",
      startedAt: 20,
      topicId: "session-a",
      workspaceId: "workspace-a",
    });

    expect(result.messages).toHaveLength(2);
    expect(getSession).not.toHaveBeenCalled();
    expect(onEvent.mock.calls.map(([event]) => event.metricName)).toEqual([
      "session.switch.fetchDetail.start",
      "session.switch.fetchDetail.prefetch",
    ]);
  });

  it("prefetch 失败时应记录 fallback 并继续拉取详情", async () => {
    const registry = createSessionDetailPrefetchRegistry<SessionDetailFetchDetailLike>();
    registry.set("workspace-a:session-a", {
      signature: "signature-a",
      promise: Promise.reject(new Error("prefetch failed")),
    });
    const getSession = vi.fn().mockResolvedValue(detail(1));
    const onEvent = vi.fn();

    await expect(
      loadSessionDetailWithPrefetch({
        getSession,
        mode: "deferred",
        now: createClock([100, 120, 160, 180]),
        onEvent,
        prefetchRegistry: registry,
        prefetchWorkspaceId: "workspace-a",
        startedAt: 80,
        topicId: "session-a",
        workspaceId: "workspace-a",
      }),
    ).resolves.toMatchObject({ messages: [{ id: "message-0" }] });

    expect(getSession).toHaveBeenCalledWith("session-a", {
      historyLimit: 40,
    });
    expect(onEvent.mock.calls.map(([event]) => event.logEvent)).toEqual([
      "switchTopic.fetchDetail.start",
      "switchTopic.fetchDetail.prefetchFallback",
      "switchTopic.fetchDetail.success",
    ]);
    expect(onEvent.mock.calls[1]?.[0]).toMatchObject({
      logLevel: "warn",
      throttleMs: 1000,
    });
  });

  it("resumeSessionStartHooks 时应跳过 prefetch 并透传请求参数", async () => {
    const registry = createSessionDetailPrefetchRegistry<SessionDetailFetchDetailLike>();
    registry.set("workspace-a:session-a", {
      signature: "signature-a",
      promise: Promise.resolve(detail(2)),
    });
    const getSession = vi.fn().mockResolvedValue(detail(1));

    await loadSessionDetailWithPrefetch({
      getSession,
      mode: "direct",
      prefetchRegistry: registry,
      prefetchWorkspaceId: "workspace-a",
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

  it("registry 只删除当前 promise，避免清掉较新的 prefetch", async () => {
    const registry = createSessionDetailPrefetchRegistry<SessionDetailFetchDetailLike>();
    const olderPromise = Promise.resolve(detail(1));
    const newerPromise = Promise.resolve(detail(2));

    registry.set("workspace-a:session-a", {
      signature: "older",
      promise: olderPromise,
    });
    registry.set("workspace-a:session-a", {
      signature: "newer",
      promise: newerPromise,
    });
    registry.deleteIfCurrent("workspace-a:session-a", olderPromise);

    expect(registry.get("workspace-a:session-a")?.signature).toBe("newer");
    registry.deleteIfCurrent("workspace-a:session-a", newerPromise);
    expect(registry.get("workspace-a:session-a")).toBeUndefined();
  });
});
