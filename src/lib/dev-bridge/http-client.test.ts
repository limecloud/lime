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

describe("http-client", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetDevBridgeHttpStateForTests();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    __resetDevBridgeHttpStateForTests();
  });

  it("桥健康探测失败后，后续检查会在短退避窗口内快速失败", async () => {
    const fetchMock = createAbortablePendingFetch();
    vi.stubGlobal("fetch", fetchMock);

    const firstCheck = healthCheck();
    await vi.advanceTimersByTimeAsync(1000);
    await expect(firstCheck).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(invokeViaHttp("workspace_list")).rejects.toThrow(
      "Failed to fetch",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
    await vi.advanceTimersByTimeAsync(1000);
    await expect(secondInvoke).resolves.toEqual({ id: "default-project" });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[2]?.[0]).toBe("http://127.0.0.1:3030/health");
    expect(fetchMock.mock.calls[3]?.[0]).toBe("http://127.0.0.1:3030/invoke");
  });

  it("桥失败短退避期间，事件监听不应继续创建 EventSource 连接", async () => {
    const fetchMock = createAbortablePendingFetch();
    const eventSourceMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "EventSource",
      eventSourceMock as unknown as typeof EventSource,
    );

    const firstCheck = healthCheck();
    await vi.advanceTimersByTimeAsync(1000);
    await expect(firstCheck).resolves.toBe(false);

    await expect(listenViaHttpEvent("config-changed", vi.fn())).rejects.toThrow(
      "Failed to fetch",
    );

    expect(eventSourceMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
