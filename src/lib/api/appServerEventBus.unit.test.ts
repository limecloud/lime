import { afterEach, describe, expect, it, vi } from "vitest";
import {
  METHOD_SERVER_REQUEST_RESOLVED,
  type JsonRpcRequest,
} from "../../../packages/app-server-client/src/protocol";
import {
  AppServerEventBus,
  getDefaultAppServerEventBus,
  resetDefaultAppServerEventBusForTests,
} from "./appServerEventBus";

describe("AppServerEventBus", () => {
  afterEach(() => {
    resetDefaultAppServerEventBusForTests();
    vi.useRealTimers();
  });

  it("流式请求完成后排空已入队输出，不让更早的在途 drain 提前确认", async () => {
    vi.useFakeTimers();
    const firstDrain = Promise.withResolvers<unknown[]>();
    const delta = (text: string) => ({
      method: "command/exec/outputDelta",
      params: {
        processId: "action-1",
        stream: "stdout",
        deltaBase64: btoa(text),
        capReached: false,
      },
    });
    const drainEvents = vi
      .fn()
      .mockReturnValueOnce(firstDrain.promise)
      .mockResolvedValueOnce([delta("first"), delta("second")])
      .mockResolvedValueOnce([delta("last")])
      .mockResolvedValue([]);
    const eventBus = new AppServerEventBus({ drainEvents });
    const delivered: string[] = [];
    const unsubscribe = eventBus.subscribe({
      getDrainOptions: () => ({ limit: 2 }),
      onNotifications: (notifications) => {
        delivered.push(
          ...notifications.map((notification) =>
            atob((notification.params as { deltaBase64: string }).deltaBase64),
          ),
        );
      },
    });
    let flushed = false;
    const flush = eventBus.flushNotifications().then(() => {
      flushed = true;
      expect(delivered).toEqual(["first", "second", "last"]);
    });
    try {
      expect(flushed).toBe(false);
      firstDrain.resolve([]);
      await flush;
      expect(drainEvents).toHaveBeenCalledTimes(3);
      expect(flushed).toBe(true);
    } finally {
      unsubscribe();
      eventBus.reset();
      await vi.runOnlyPendingTimersAsync();
    }
  });

  it("排空失败或连接重置显式失败，不把缺失输出当成成功终态", async () => {
    vi.useFakeTimers();
    const firstDrain = Promise.withResolvers<unknown[]>();
    const error = new Error("drain failed");
    const drainEvents = vi
      .fn()
      .mockReturnValueOnce(firstDrain.promise)
      .mockRejectedValueOnce(error)
      .mockResolvedValue([]);
    const eventBus = new AppServerEventBus({ drainEvents });
    const onError = vi.fn();
    const unsubscribe = eventBus.subscribe({
      onNotifications: vi.fn(),
      onError,
    });
    const failed = expect(eventBus.flushNotifications()).rejects.toThrow(error);
    try {
      firstDrain.resolve([]);
      await failed;
      expect(onError).toHaveBeenCalledExactlyOnceWith(error);
      const reset = expect(eventBus.flushNotifications()).rejects.toThrow(
        "notification flush was reset",
      );
      eventBus.reset();
      await reset;
    } finally {
      unsubscribe();
      eventBus.reset();
      await vi.runOnlyPendingTimersAsync();
    }
  });

  it("drain 在途切换订阅时，应向当前订阅交付问题与终态，不能回投已卸载订阅", async () => {
    vi.useFakeTimers();
    const pendingDrain = Promise.withResolvers<unknown[]>();
    const drainEvents = vi
      .fn()
      .mockReturnValueOnce(pendingDrain.promise)
      .mockResolvedValue([]);
    const eventBus = new AppServerEventBus({ drainEvents });
    const previous = vi.fn();
    const current = vi.fn();
    const unsubscribePrevious = eventBus.subscribe({
      onNotifications: previous,
    });
    const unsubscribeCurrent = eventBus.subscribe({ onNotifications: current });
    unsubscribePrevious();
    const notifications = [
      {
        method: "item/completed",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          item: {
            id: "question-1",
            type: "agentMessage",
            delivery: "async",
            text: "How should I continue?",
            questions: [{ title: "How should I continue?", options: [] }],
          },
        },
      },
      {
        method: "turn/completed",
        params: {
          threadId: "thread-1",
          turn: { id: "turn-1", status: "completed" },
        },
      },
    ];
    try {
      pendingDrain.resolve(notifications);
      await vi.advanceTimersByTimeAsync(0);
      expect(current).toHaveBeenCalledExactlyOnceWith(notifications);
      expect(previous).not.toHaveBeenCalled();
    } finally {
      unsubscribeCurrent();
      eventBus.reset();
      await vi.runOnlyPendingTimersAsync();
    }
  });

  it("重置默认 event bus 后旧 drain loop 应退出", async () => {
    vi.useFakeTimers();
    const oldDrainEvents = vi.fn().mockResolvedValue([]);
    const oldEventBus = getDefaultAppServerEventBus({
      drainEvents: oldDrainEvents,
    });
    oldEventBus.subscribe({ onNotifications: vi.fn() });
    await Promise.resolve();

    expect(oldDrainEvents).toHaveBeenCalledTimes(1);

    resetDefaultAppServerEventBusForTests();
    const nextDrainEvents = vi.fn().mockResolvedValue([]);
    const nextEventBus = getDefaultAppServerEventBus({
      drainEvents: nextDrainEvents,
    });
    const unsubscribe = nextEventBus.subscribe({ onNotifications: vi.fn() });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(500);

    expect(oldDrainEvents).toHaveBeenCalledTimes(1);
    expect(nextDrainEvents.mock.calls.length).toBeGreaterThan(1);

    unsubscribe();
    await vi.runOnlyPendingTimersAsync();
  });

  it("includeRecent subscription 应以对象参数 drain 最近镜像事件", async () => {
    vi.useFakeTimers();
    const drainEvents = vi.fn().mockResolvedValue([]);
    const eventBus = new AppServerEventBus({ drainEvents });

    const unsubscribe = eventBus.subscribe({
      getDrainOptions: () => ({
        includeRecent: true,
        intervalMs: 1_000,
        limit: 7,
      }),
      onNotifications: vi.fn(),
    });

    await Promise.resolve();

    expect(drainEvents).toHaveBeenCalledWith({
      includeRecent: true,
      limit: 7,
    });

    await vi.advanceTimersByTimeAsync(1_000);

    expect(drainEvents).toHaveBeenLastCalledWith(7);

    unsubscribe();
    await vi.runOnlyPendingTimersAsync();
  });

  it("includeRecent subscription 不应被 fast-first limit 压成 1", async () => {
    vi.useFakeTimers();
    const drainEvents = vi.fn().mockResolvedValue([]);
    const eventBus = new AppServerEventBus({ drainEvents });

    const unsubscribeRecent = eventBus.subscribe({
      getDrainOptions: () => ({
        includeRecent: true,
        intervalMs: 1_000,
        limit: 7,
      }),
      onNotifications: vi.fn(),
    });
    const unsubscribeFastFirst = eventBus.subscribe({
      getDrainOptions: () => ({
        intervalMs: 10,
        limit: 1,
      }),
      onNotifications: vi.fn(),
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(drainEvents).toHaveBeenNthCalledWith(1, {
      includeRecent: true,
      limit: 7,
    });

    await vi.advanceTimersByTimeAsync(10);

    expect(drainEvents).toHaveBeenLastCalledWith(1);

    unsubscribeFastFirst();
    unsubscribeRecent();
    await vi.runOnlyPendingTimersAsync();
  });

  it("共享 includeRecent 订阅只应启动回放一次，避免重复流式通知", async () => {
    vi.useFakeTimers();
    const delta = {
      method: "item/agentMessage/delta",
      params: {
        delta: "唯一正文",
        itemId: "item-1",
        threadId: "thread-1",
        turnId: "turn-1",
      },
    };
    const drainEvents = vi.fn(
      (request?: number | { includeRecent?: boolean }) =>
        Promise.resolve(
          typeof request === "object" && request.includeRecent === true
            ? [delta]
            : [],
        ),
    );
    const eventBus = new AppServerEventBus({ drainEvents });
    const onAgentNotifications = vi.fn();
    const unsubscribeAgent = eventBus.subscribe({
      getDrainOptions: () => ({ intervalMs: 10, limit: 50 }),
      onNotifications: onAgentNotifications,
    });
    const unsubscribeRecent = eventBus.subscribe({
      getDrainOptions: () => ({
        includeRecent: true,
        intervalMs: 10,
        limit: 100,
      }),
      onNotifications: vi.fn(),
    });

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(40);

    const includeRecentCalls = drainEvents.mock.calls.filter(
      ([request]) =>
        typeof request === "object" && request.includeRecent === true,
    );
    expect(includeRecentCalls).toEqual([[{ includeRecent: true, limit: 100 }]]);
    expect(onAgentNotifications).toHaveBeenCalledTimes(1);
    expect(onAgentNotifications).toHaveBeenCalledWith([delta]);

    unsubscribeRecent();
    unsubscribeAgent();
    await vi.runOnlyPendingTimersAsync();
  });

  it("handler 尚未注册时保留 server request 并只投递一次", async () => {
    vi.useFakeTimers();
    const request: JsonRpcRequest = {
      id: "app-server-request:pending",
      method: "mcpServer/elicitation/request",
      params: {},
    };
    const drainEvents = vi
      .fn()
      .mockResolvedValueOnce([request])
      .mockResolvedValueOnce([request])
      .mockResolvedValue([]);
    const eventBus = new AppServerEventBus({ drainEvents });
    const unsubscribeNotifications = eventBus.subscribe({
      getDrainOptions: () => ({ intervalMs: 1, limit: 1 }),
      onNotifications: vi.fn(),
    });

    await vi.advanceTimersByTimeAsync(1);
    expect(drainEvents).toHaveBeenCalledTimes(2);
    const onServerRequests = vi.fn();
    const unsubscribeRequests = eventBus.subscribe({ onServerRequests });

    expect(onServerRequests).toHaveBeenCalledTimes(1);
    expect(onServerRequests).toHaveBeenCalledWith([request]);

    unsubscribeRequests();
    unsubscribeNotifications();
    eventBus.reset();
    await vi.runOnlyPendingTimersAsync();
  });

  it("只允许一个 server request handler", () => {
    const eventBus = new AppServerEventBus({ drainEvents: vi.fn() });
    const unsubscribe = eventBus.subscribe({ onServerRequests: vi.fn() });

    expect(() => eventBus.subscribe({ onServerRequests: vi.fn() })).toThrow(
      "already has a server request handler",
    );

    unsubscribe();
    eventBus.reset();
  });

  it.each([
    ["request 后 resolved", false],
    ["resolved 后 request", true],
  ])(
    "%s 且 handler 晚注册时不投递已撤销请求",
    async (_label, resolvedFirst) => {
      vi.useFakeTimers();
      const request: JsonRpcRequest = {
        id: "app-server-request:resolved-before-handler",
        method: "mcpServer/elicitation/request",
        params: { threadId: "thread-1" },
      };
      const resolved = {
        method: METHOD_SERVER_REQUEST_RESOLVED,
        params: { requestId: request.id, threadId: "thread-1" },
      };
      const drainEvents = vi
        .fn()
        .mockResolvedValueOnce(resolvedFirst ? [resolved, request] : [request])
        .mockResolvedValueOnce(resolvedFirst ? [] : [resolved])
        .mockResolvedValue([]);
      const eventBus = new AppServerEventBus({ drainEvents });
      const unsubscribeNotifications = eventBus.subscribe({
        getDrainOptions: () => ({ intervalMs: 1, limit: 2 }),
        onNotifications: vi.fn(),
      });

      await vi.advanceTimersByTimeAsync(resolvedFirst ? 1 : 2);
      const onServerRequests = vi.fn();
      const unsubscribeRequests = eventBus.subscribe({ onServerRequests });

      expect(onServerRequests).not.toHaveBeenCalled();

      unsubscribeRequests();
      unsubscribeNotifications();
      eventBus.reset();
      await vi.runOnlyPendingTimersAsync();
    },
  );

  it("reset 后应清除旧 generation 的 resolved tombstone", async () => {
    vi.useFakeTimers();
    const request: JsonRpcRequest = {
      id: "app-server-request:reset-tombstone",
      method: "mcpServer/elicitation/request",
      params: { threadId: "thread-1" },
    };
    const resolved = {
      method: METHOD_SERVER_REQUEST_RESOLVED,
      params: { requestId: request.id, threadId: "thread-1" },
    };
    const drainEvents = vi
      .fn()
      .mockResolvedValueOnce([resolved])
      .mockResolvedValue([]);
    const eventBus = new AppServerEventBus({ drainEvents });
    eventBus.subscribe({
      getDrainOptions: () => ({ intervalMs: 1, limit: 1 }),
      onNotifications: vi.fn(),
    });
    await Promise.resolve();

    eventBus.reset();
    drainEvents
      .mockReset()
      .mockResolvedValueOnce([request])
      .mockResolvedValue([]);
    const onServerRequests = vi.fn();
    const unsubscribeRequests = eventBus.subscribe({
      getDrainOptions: () => ({ intervalMs: 1, limit: 1 }),
      onServerRequests,
    });
    await vi.advanceTimersByTimeAsync(1);

    expect(onServerRequests).toHaveBeenCalledWith([request]);

    unsubscribeRequests();
    eventBus.reset();
    await vi.runOnlyPendingTimersAsync();
  });

  it("reset 后应忽略旧 generation 尚未完成的 drain", async () => {
    vi.useFakeTimers();
    const request: JsonRpcRequest = {
      id: "app-server-request:old-drain",
      method: "mcpServer/elicitation/request",
      params: { threadId: "thread-1" },
    };
    const resolved = {
      method: METHOD_SERVER_REQUEST_RESOLVED,
      params: { requestId: request.id, threadId: "thread-1" },
    };
    let resolveOldDrain: ((messages: unknown[]) => void) | undefined;
    const drainEvents = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<unknown[]>((resolve) => {
            resolveOldDrain = resolve;
          }),
      )
      .mockResolvedValueOnce([request])
      .mockResolvedValue([]);
    const eventBus = new AppServerEventBus({ drainEvents });
    eventBus.subscribe({ onNotifications: vi.fn() });
    await Promise.resolve();

    eventBus.reset();
    const onServerRequests = vi.fn();
    const unsubscribeRequests = eventBus.subscribe({ onServerRequests });
    resolveOldDrain?.([resolved, request]);
    await vi.advanceTimersByTimeAsync(0);

    expect(onServerRequests).toHaveBeenCalledTimes(1);
    expect(onServerRequests).toHaveBeenCalledWith([request]);

    unsubscribeRequests();
    eventBus.reset();
    await vi.runOnlyPendingTimersAsync();
  });

  it("缺少 threadId 的 resolved 不得撤销后续 server request", async () => {
    vi.useFakeTimers();
    const request: JsonRpcRequest = {
      id: "app-server-request:unscoped-resolved",
      method: "mcpServer/elicitation/request",
      params: {},
    };
    const drainEvents = vi
      .fn()
      .mockResolvedValueOnce([
        {
          method: METHOD_SERVER_REQUEST_RESOLVED,
          params: { requestId: request.id },
        },
        request,
      ])
      .mockResolvedValue([]);
    const eventBus = new AppServerEventBus({ drainEvents });
    const onServerRequests = vi.fn();
    const unsubscribe = eventBus.subscribe({
      getDrainOptions: () => ({ intervalMs: 1, limit: 2 }),
      onServerRequests,
    });

    await vi.advanceTimersByTimeAsync(1);

    expect(onServerRequests).toHaveBeenCalledWith([request]);

    unsubscribe();
    eventBus.reset();
    await vi.runOnlyPendingTimersAsync();
  });

  it("不同 thread 的 resolved 不得吞掉同 outer id 请求", async () => {
    vi.useFakeTimers();
    const request: JsonRpcRequest = {
      id: "app-server-request:thread-scope",
      method: "mcpServer/elicitation/request",
      params: { threadId: "thread-2" },
    };
    const drainEvents = vi
      .fn()
      .mockResolvedValueOnce([
        {
          method: METHOD_SERVER_REQUEST_RESOLVED,
          params: { requestId: request.id, threadId: "thread-1" },
        },
        request,
      ])
      .mockResolvedValue([]);
    const eventBus = new AppServerEventBus({ drainEvents });
    const onServerRequests = vi.fn();
    const unsubscribe = eventBus.subscribe({
      getDrainOptions: () => ({ intervalMs: 1, limit: 2 }),
      onServerRequests,
    });

    await vi.advanceTimersByTimeAsync(1);

    expect(onServerRequests).toHaveBeenCalledWith([request]);

    unsubscribe();
    eventBus.reset();
    await vi.runOnlyPendingTimersAsync();
  });
});
