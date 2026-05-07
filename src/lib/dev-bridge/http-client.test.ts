import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tauri-runtime", () => ({
  hasTauriInvokeCapability: vi.fn(() => false),
  hasTauriRuntimeMarkers: vi.fn(() => false),
}));

import {
  __resetDevBridgeHttpStateForTests,
  healthCheck,
  invokeViaHttp,
  listenViaHttpEvent,
} from "./http-client";

type FetchInput = Parameters<typeof fetch>[0];
type FetchOptions = Parameters<typeof fetch>[1];

function createAbortablePendingFetch() {
  return vi.fn((_input: FetchInput, init?: FetchOptions) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      signal?.addEventListener("abort", () => {
        reject(new DOMException("The operation was aborted.", "AbortError"));
      });
    });
  });
}

function createHardConnectionFailure(message = "Failed to fetch") {
  return vi.fn<typeof fetch>().mockRejectedValue(new TypeError(message));
}

describe("http-client", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetDevBridgeHttpStateForTests();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "debug").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    __resetDevBridgeHttpStateForTests();
  });

  it("桥健康探测硬连接失败后，后续检查会在短退避窗口内快速失败", async () => {
    const fetchMock = createHardConnectionFailure();
    vi.stubGlobal("fetch", fetchMock);

    await expect(healthCheck()).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(invokeViaHttp("get_api_key_providers")).rejects.toThrow(
      "Failed to fetch",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("旧会话恢复命令应允许绕过短退避重新探测，避免恢复时卡在 cooldown", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: {
              id: "session-1",
              name: "旧会话",
              messages: [],
              created_at: 1,
              updated_at: 2,
            },
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(healthCheck()).resolves.toBe(false);

    await expect(
      invokeViaHttp("agent_runtime_get_session", {
        sessionId: "session-1",
        historyLimit: 40,
      }),
    ).resolves.toMatchObject({
      id: "session-1",
      name: "旧会话",
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://127.0.0.1:3030/health");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("http://127.0.0.1:3030/invoke");
  });

  it("工作区与会话列表命令应允许绕过短退避重新探测，恢复首页和侧栏", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: [{ id: "session-1" }] }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(healthCheck()).resolves.toBe(false);

    await expect(
      invokeViaHttp("agent_runtime_list_sessions", {
        request: { workspace_id: "workspace-1", limit: 21 },
      }),
    ).resolves.toEqual([{ id: "session-1" }]);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://127.0.0.1:3030/health");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("http://127.0.0.1:3030/invoke");
  });

  it("默认项目命令应允许绕过短退避重新探测，避免空 mock 触发重复错误", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: { id: "workspace-default" } }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(healthCheck()).resolves.toBe(false);

    await expect(
      invokeViaHttp<{ id: string }>("get_or_create_default_project"),
    ).resolves.toEqual({ id: "workspace-default" });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://127.0.0.1:3030/health");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("http://127.0.0.1:3030/invoke");
  });

  it("桥首次健康探测超时后，后续调用应重新探测而不是进入 cooldown", async () => {
    const firstHealthTimeout = createAbortablePendingFetch();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(firstHealthTimeout)
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: ["project-a"] }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const firstCheck = healthCheck();
    await vi.advanceTimersByTimeAsync(3200);
    await expect(firstCheck).resolves.toBe(false);

    await expect(invokeViaHttp<string[]>("workspace_list")).resolves.toEqual([
      "project-a",
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://127.0.0.1:3030/health");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("http://127.0.0.1:3030/invoke");
  });

  it("首次 invoke 的健康探测超时后，后续调用应重新探测而不是进入 cooldown", async () => {
    const firstHealthTimeout = createAbortablePendingFetch();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(firstHealthTimeout)
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: { id: "default-project" } }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const firstInvoke = invokeViaHttp("workspace_list").then(
      () => ({ ok: true as const }),
      (error) => ({ ok: false as const, error }),
    );
    await vi.advanceTimersByTimeAsync(3200);
    await expect(firstInvoke).resolves.toMatchObject({
      ok: false,
      error: expect.objectContaining({
        message: expect.stringContaining("bridge health check failed"),
      }),
    });

    await expect(
      invokeViaHttp<{ id: string }>("workspace_get_default"),
    ).resolves.toEqual({ id: "default-project" });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://127.0.0.1:3030/health");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("http://127.0.0.1:3030/invoke");
  });

  it("桥健康时会复用短期健康缓存，避免每次调用都重复探测", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: ["project-a"] }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: { id: "default-project" } }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(invokeViaHttp<string[]>("workspace_list")).resolves.toEqual([
      "project-a",
    ]);
    await expect(
      invokeViaHttp<{ id: string }>("workspace_get_default"),
    ).resolves.toEqual({ id: "default-project" });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:3030/health");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://127.0.0.1:3030/invoke");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("http://127.0.0.1:3030/invoke");
  });

  it("桥已健康后，健康探测短暂超时不应立刻进入 cooldown", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: ["project-a"] }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }),
      )
      .mockImplementationOnce(createAbortablePendingFetch())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: { id: "default-project" } }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(invokeViaHttp<string[]>("workspace_list")).resolves.toEqual([
      "project-a",
    ]);

    await vi.advanceTimersByTimeAsync(11000);

    const secondInvoke = invokeViaHttp<{ id: string }>("workspace_get_default");
    await vi.advanceTimersByTimeAsync(3200);
    await expect(secondInvoke).resolves.toEqual({ id: "default-project" });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[2]?.[0]).toBe("http://127.0.0.1:3030/health");
    expect(fetchMock.mock.calls[3]?.[0]).toBe("http://127.0.0.1:3030/invoke");
  });

  it("agent runtime 提交命令应保留长请求超时窗口", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockImplementationOnce(createAbortablePendingFetch());
    vi.stubGlobal("fetch", fetchMock);

    let settled = false;
    const invokePromise = invokeViaHttp("agent_runtime_submit_turn").then(
      () => ({ ok: true as const }),
      (error) => ({ ok: false as const, error }),
    );
    invokePromise.finally(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(2000);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(58000);
    await expect(invokePromise).resolves.toMatchObject({
      ok: false,
      error: expect.objectContaining({
        message: expect.stringContaining("timeout after 60000ms"),
      }),
    });
  });

  it("会话列表读取命令应使用较短超时，避免恢复链路卡住 60 秒", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockImplementationOnce(createAbortablePendingFetch());
    vi.stubGlobal("fetch", fetchMock);

    const listSessionsPromise = invokeViaHttp("agent_runtime_list_sessions", {
      request: { workspace_id: "workspace-1", limit: 21 },
    }).then(
      () => ({ ok: true as const }),
      (error) => ({ ok: false as const, error }),
    );
    await vi.advanceTimersByTimeAsync(8000);

    await expect(listSessionsPromise).resolves.toMatchObject({
      ok: false,
      error: expect.objectContaining({
        message: expect.stringContaining("timeout after 8000ms"),
      }),
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("旧会话读取命令硬连接失败后应强制健康探测并重试一次", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: {
              id: "session-1",
              name: "旧会话",
              messages: [],
              created_at: 1,
              updated_at: 2,
            },
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const invokePromise = invokeViaHttp("agent_runtime_get_session", {
      sessionId: "session-1",
      historyLimit: 40,
    });

    await expect(invokePromise).resolves.toMatchObject({
      id: "session-1",
      name: "旧会话",
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[2]?.[0]).toBe("http://127.0.0.1:3030/health");
    expect(fetchMock.mock.calls[3]?.[0]).toBe("http://127.0.0.1:3030/invoke");
  });

  it("会话后台回填命令应快速超时，避免占用旧会话恢复通道", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockImplementationOnce(createAbortablePendingFetch());
    vi.stubGlobal("fetch", fetchMock);

    const invokePromise = invokeViaHttp("agent_runtime_update_session", {
      request: { session_id: "session-1" },
    }).then(
      () => ({ ok: true as const }),
      (error) => ({ ok: false as const, error }),
    );

    await vi.advanceTimersByTimeAsync(5000);
    await expect(invokePromise).resolves.toMatchObject({
      ok: false,
      error: expect.objectContaining({
        message: expect.stringContaining("timeout after 5000ms"),
      }),
    });
  });

  it("agent 标题生成命令应使用 agent 长超时窗口", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockImplementationOnce(createAbortablePendingFetch());
    vi.stubGlobal("fetch", fetchMock);

    let settled = false;
    const invokePromise = invokeViaHttp("agent_generate_title", {
      sessionId: "session-1",
    }).then(
      () => ({ ok: true as const }),
      (error) => ({ ok: false as const, error }),
    );
    invokePromise.finally(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(5000);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(55000);
    await expect(invokePromise).resolves.toMatchObject({
      ok: false,
      error: expect.objectContaining({
        message: expect.stringContaining("timeout after 60000ms"),
      }),
    });
  });

  it("bridge 真相命令应使用 5000ms 的请求超时窗口", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockImplementationOnce(createAbortablePendingFetch());
    vi.stubGlobal("fetch", fetchMock);

    let settled = false;
    const invokePromise = invokeViaHttp("gateway_channel_status", {
      request: { channel: "wechat" },
    }).then(
      () => ({ ok: true as const }),
      (error) => ({ ok: false as const, error }),
    );
    invokePromise.finally(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(2000);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(2800);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(400);
    await expect(invokePromise).resolves.toMatchObject({
      ok: false,
      error: expect.objectContaining({
        message: expect.stringContaining("timeout after 5000ms"),
      }),
    });
  });

  it("语音模型下载命令应保留长下载窗口", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockImplementationOnce(createAbortablePendingFetch());
    vi.stubGlobal("fetch", fetchMock);

    let settled = false;
    const invokePromise = invokeViaHttp("voice_models_download", {
      modelId: "sensevoice-small-int8-2024-07-17",
    }).then(
      () => ({ ok: true as const }),
      (error) => ({ ok: false as const, error }),
    );
    invokePromise.finally(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(29 * 60 * 1000);
    await expect(invokePromise).resolves.toMatchObject({
      ok: false,
      error: expect.objectContaining({
        message: expect.stringContaining("timeout after 1800000ms"),
      }),
    });
  });

  it("Provider 模型探测命令应使用更长的请求超时窗口", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockImplementationOnce(createAbortablePendingFetch());
    vi.stubGlobal("fetch", fetchMock);

    let settled = false;
    const invokePromise = invokeViaHttp("fetch_provider_models_auto", {
      providerId: "custom-minimax",
    }).then(
      () => ({ ok: true as const }),
      (error) => ({ ok: false as const, error }),
    );
    invokePromise.finally(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(15000);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(15000);
    await expect(invokePromise).resolves.toMatchObject({
      ok: false,
      error: expect.objectContaining({
        message: expect.stringContaining("timeout after 30000ms"),
      }),
    });
  });

  it("桥失败短退避期间，事件监听不应继续创建 EventSource 连接", async () => {
    const fetchMock = createHardConnectionFailure();
    const eventSourceMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "EventSource",
      eventSourceMock as unknown as typeof EventSource,
    );

    await expect(healthCheck()).resolves.toBe(false);

    await expect(listenViaHttpEvent("config-changed", vi.fn())).rejects.toThrow(
      "Failed to fetch",
    );

    expect(eventSourceMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("多个浏览器事件监听应复用一条 multiplex SSE 连接，避免占满 invoke 连接槽", async () => {
    class MockEventSource {
      static instances: MockEventSource[] = [];

      onopen: (() => void) | null = null;
      onerror: ((error: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      readyState = 0;
      readonly close = vi.fn(() => {
        this.readyState = 2;
      });

      constructor(readonly url: string) {
        MockEventSource.instances.push(this);
      }

      emitOpen() {
        this.readyState = 1;
        this.onopen?.();
      }

      emitMessage(payload: unknown) {
        this.onmessage?.({
          data: JSON.stringify(payload),
        } as MessageEvent);
      }
    }

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "EventSource",
      MockEventSource as unknown as typeof EventSource,
    );

    const configHandler = vi.fn();
    const taskHandler = vi.fn();
    const configUnlistenPromise = listenViaHttpEvent(
      "config-changed",
      configHandler,
    );
    const taskUnlistenPromise = listenViaHttpEvent(
      "lime://creation_task_submitted",
      taskHandler,
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(MockEventSource.instances).toHaveLength(1);

    const source = MockEventSource.instances[0]!;
    const sourceUrl = new URL(source.url);
    expect(JSON.parse(sourceUrl.searchParams.get("events") ?? "[]")).toEqual([
      "config-changed",
      "lime://creation_task_submitted",
    ]);

    source.emitOpen();
    const [configUnlisten, taskUnlisten] = await Promise.all([
      configUnlistenPromise,
      taskUnlistenPromise,
    ]);

    source.emitMessage({
      event: "lime://creation_task_submitted",
      payload: { taskId: "task-1" },
    });
    expect(taskHandler).toHaveBeenCalledWith({
      payload: { taskId: "task-1" },
    });
    expect(configHandler).not.toHaveBeenCalled();

    configUnlisten();
    taskUnlisten();
  });

  it("事件流本地冷启动超过 1.5 秒但未超出桥接窗口时不应误判失败", async () => {
    class MockEventSource {
      static instances: MockEventSource[] = [];

      onopen: (() => void) | null = null;
      onerror: ((error: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      readyState = 0;
      readonly close = vi.fn(() => {
        this.readyState = 2;
      });

      constructor(readonly url: string) {
        MockEventSource.instances.push(this);
      }

      emitOpen() {
        this.readyState = 1;
        this.onopen?.();
      }
    }

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "EventSource",
      MockEventSource as unknown as typeof EventSource,
    );

    const unlistenPromise = listenViaHttpEvent("aster_stream_test", vi.fn());
    await vi.advanceTimersByTimeAsync(1_800);

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0]?.close).not.toHaveBeenCalled();

    MockEventSource.instances[0]?.emitOpen();
    const unlisten = await unlistenPromise;

    unlisten();
  });

  it("事件流在已建立连接后断开时应关闭连接，避免浏览器自动重连风暴", async () => {
    class MockEventSource {
      static instances: MockEventSource[] = [];

      onopen: (() => void) | null = null;
      onerror: ((error: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      readyState = 0;
      readonly close = vi.fn(() => {
        this.readyState = 2;
      });

      constructor(readonly url: string) {
        MockEventSource.instances.push(this);
      }

      emitOpen() {
        this.readyState = 1;
        this.onopen?.();
      }

      emitError(error = new Event("error")) {
        this.onerror?.(error);
      }
    }

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 200 }));
    const debugSpy = vi.mocked(console.debug);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "EventSource",
      MockEventSource as unknown as typeof EventSource,
    );

    const unlistenPromise = listenViaHttpEvent("config-changed", vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(MockEventSource.instances).toHaveLength(1);

    const source = MockEventSource.instances[0]!;
    source.emitOpen();
    const unlisten = await unlistenPromise;

    source.emitError();
    source.emitError();

    const secondUnlistenPromise = listenViaHttpEvent("config-changed", vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(MockEventSource.instances).toHaveLength(2);
    const nextSource = MockEventSource.instances[1]!;
    nextSource.emitOpen();
    const secondUnlisten = await secondUnlistenPromise;

    expect(MockEventSource.instances).toHaveLength(2);
    expect(source.close).toHaveBeenCalledTimes(1);
    expect(debugSpy).toHaveBeenCalledTimes(1);

    unlisten();
    secondUnlisten();
    expect(source.close).toHaveBeenCalledTimes(1);
    expect(nextSource.close).toHaveBeenCalledTimes(1);
  });

  it("事件流在建立后结束不应把整个桥接误标记为 unavailable", async () => {
    class MockEventSource {
      static instances: MockEventSource[] = [];

      onopen: (() => void) | null = null;
      onerror: ((error: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      readyState = 0;
      readonly close = vi.fn(() => {
        this.readyState = 2;
      });

      constructor(readonly url: string) {
        MockEventSource.instances.push(this);
      }

      emitOpen() {
        this.readyState = 1;
        this.onopen?.();
      }

      emitError(error = new Event("error")) {
        this.onerror?.(error);
      }
    }

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: ["project-a"] }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "EventSource",
      MockEventSource as unknown as typeof EventSource,
    );

    const unlistenPromise = listenViaHttpEvent("aster_stream_test", vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(MockEventSource.instances).toHaveLength(1);

    const source = MockEventSource.instances[0]!;
    source.emitOpen();
    const unlisten = await unlistenPromise;

    source.emitError();

    await expect(invokeViaHttp<string[]>("workspace_list")).resolves.toEqual([
      "project-a",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://127.0.0.1:3030/invoke");

    unlisten();
  });
});
