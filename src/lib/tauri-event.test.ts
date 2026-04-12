import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockInvoke, mockTransformCallback } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockTransformCallback: vi.fn((handler) => handler),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
  transformCallback: mockTransformCallback,
}));

import { listen, once } from "./tauri-event";

describe("tauri-event", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Reflect.deleteProperty(
      window as Window & {
        __TAURI_EVENT_PLUGIN_INTERNALS__?: {
          unregisterListener: (event: string, eventId: number) => void;
        };
      },
      "__TAURI_EVENT_PLUGIN_INTERNALS__",
    );
  });

  it("listen 返回的 unlisten 应保持幂等", async () => {
    const unregisterListener = vi.fn();
    (
      window as Window & {
        __TAURI_EVENT_PLUGIN_INTERNALS__?: {
          unregisterListener: (event: string, eventId: number) => void;
        };
      }
    ).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener,
    };

    mockInvoke
      .mockResolvedValueOnce(42)
      .mockResolvedValueOnce(undefined);

    const unlisten = await listen("agent-event", vi.fn());

    unlisten();
    unlisten();
    await Promise.resolve();

    expect(unregisterListener).toHaveBeenCalledTimes(1);
    expect(unregisterListener).toHaveBeenCalledWith("agent-event", 42);
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(mockInvoke).toHaveBeenNthCalledWith(1, "plugin:event|listen", {
      event: "agent-event",
      handler: expect.any(Function),
      target: { kind: "Any" },
    });
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "plugin:event|unlisten", {
      event: "agent-event",
      eventId: 42,
    });
  });

  it("重复或失效的前端监听注销异常应被吞掉", async () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});

    (
      window as Window & {
        __TAURI_EVENT_PLUGIN_INTERNALS__?: {
          unregisterListener: (event: string, eventId: number) => void;
        };
      }
    ).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: vi.fn(() => {
        throw new TypeError(
          "undefined is not an object (evaluating 'listeners[eventId].handlerId')",
        );
      }),
    };

    mockInvoke
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(undefined);

    try {
      const unlisten = await listen("agent-event", vi.fn());
      expect(() => unlisten()).not.toThrow();
      await Promise.resolve();

      expect(mockInvoke).toHaveBeenNthCalledWith(2, "plugin:event|unlisten", {
        event: "agent-event",
        eventId: 7,
      });
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "[tauri-event] 忽略重复或失效的事件监听注销: agent-event#7",
        expect.any(TypeError),
      );
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it("once 自动注销后再次手动清理不应重复触发后端注销", async () => {
    mockInvoke
      .mockResolvedValueOnce(9)
      .mockResolvedValueOnce(undefined);

    const handler = vi.fn();
    const unlisten = await once("agent-once", handler);
    const onceHandler = mockInvoke.mock.calls[0]?.[1]?.handler as
      | ((event: { event: string; id: number; payload: string }) => void)
      | undefined;

    onceHandler?.({
      event: "agent-once",
      id: 9,
      payload: "hello",
    });
    unlisten();
    await Promise.resolve();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({
      event: "agent-once",
      id: 9,
      payload: "hello",
    });
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "plugin:event|unlisten", {
      event: "agent-once",
      eventId: 9,
    });
  });
});
