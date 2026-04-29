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

    await expect(invokeViaHttp("workspace_list")).rejects.toThrow(
      "Failed to fetch",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

  it("agent runtime 命令应使用更长的请求超时窗口", async () => {
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

  it("事件流在已建立连接后断开时应保留连接并停止重复告警", async () => {
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

    const secondUnlisten = await listenViaHttpEvent("config-changed", vi.fn());

    expect(MockEventSource.instances).toHaveLength(1);
    expect(source.close).not.toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalledTimes(1);

    unlisten();
    secondUnlisten();
    expect(source.close).toHaveBeenCalledTimes(1);
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
