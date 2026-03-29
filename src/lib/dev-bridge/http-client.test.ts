import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockMessageEvent = {
  data: string;
};

class MockEventSource {
  static instances: MockEventSource[] = [];

  readonly url: string;
  readonly withCredentials = false;
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MockMessageEvent) => void) | null = null;
  onerror: ((event: Event | unknown) => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
    this.readyState = 2;
  }

  emitOpen() {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }

  emitMessage(data: string) {
    this.onmessage?.({ data });
  }
}

describe("http-client listenViaHttpEvent", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    MockEventSource.instances = [];
    vi.stubEnv("MODE", "development");
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITEST", "");
    vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("会等待事件流真正连上后再返回订阅", async () => {
    const { listenViaHttpEvent } = await import("./http-client");
    const handler = vi.fn();
    let resolved = false;

    const promise = listenViaHttpEvent("agent_stream", handler).then((unlisten) => {
      resolved = true;
      return unlisten;
    });

    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(MockEventSource.instances).toHaveLength(1);

    const source = MockEventSource.instances[0];
    source.emitOpen();

    const unlisten = await promise;
    expect(resolved).toBe(true);

    source.emitMessage(JSON.stringify({ payload: { delta: "hello" } }));
    expect(handler).toHaveBeenCalledWith({ payload: { delta: "hello" } });

    unlisten();
    expect(source.closed).toBe(true);
  });

  it("连接超时会拒绝订阅并关闭事件流", async () => {
    const { listenViaHttpEvent } = await import("./http-client");

    const promise = listenViaHttpEvent("agent_stream", vi.fn());
    const rejection = expect(promise).rejects.toThrow("事件流连接超时");
    await vi.advanceTimersByTimeAsync(1500);

    await rejection;
    expect(MockEventSource.instances[0]?.closed).toBe(true);
  });
});
