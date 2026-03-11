/* eslint-disable no-restricted-syntax -- 测试底层 invoke 机制，需要直接使用命令名 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  baseInvoke: vi.fn(),
  baseListen: vi.fn(),
  baseEmit: vi.fn(),
  invokeViaHttp: vi.fn(),
  isDevBridgeAvailable: vi.fn(),
  normalizeDevBridgeError: vi.fn((cmd: string, error: unknown) => {
    if (error instanceof Error) {
      return new Error(`[${cmd}] ${error.message}`);
    }
    return new Error(`[${cmd}] ${String(error)}`);
  }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.baseInvoke,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.baseListen,
  emit: mocks.baseEmit,
}));

vi.mock("./http-client", () => ({
  invokeViaHttp: mocks.invokeViaHttp,
  isDevBridgeAvailable: mocks.isDevBridgeAvailable,
  normalizeDevBridgeError: mocks.normalizeDevBridgeError,
}));

vi.mock("./mockPriorityCommands", () => ({
  shouldPreferMockInBrowser: vi.fn(() => false),
}));

import {
  clearInvokeErrorBuffer,
  clearInvokeTraceBuffer,
  getInvokeErrorBuffer,
  getInvokeTraceBuffer,
  safeInvoke,
} from "./safeInvoke";
import { shouldPreferMockInBrowser } from "./mockPriorityCommands";

describe("safeInvoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isDevBridgeAvailable.mockReturnValue(true);
    window.localStorage.clear();
    clearInvokeErrorBuffer();
    clearInvokeTraceBuffer();
    delete (window as any).__TAURI__;
  });

  it("浏览器开发模式下优先走 HTTP bridge", async () => {
    mocks.invokeViaHttp.mockResolvedValueOnce({ ok: true });

    const result = await safeInvoke("workspace_list");

    expect(result).toEqual({ ok: true });
    expect(mocks.invokeViaHttp).toHaveBeenCalledWith("workspace_list", undefined);
    expect(mocks.baseInvoke).not.toHaveBeenCalled();

    expect(getInvokeTraceBuffer()).toEqual([
      expect.objectContaining({
        command: "workspace_list",
        transport: "http-bridge",
        status: "success",
      }),
    ]);
  });

  it("HTTP bridge 失败时会回退到 mock/baseInvoke", async () => {
    mocks.invokeViaHttp.mockRejectedValueOnce(new Error("Failed to fetch"));
    mocks.baseInvoke.mockResolvedValueOnce(["mocked"]);

    await expect(safeInvoke("workspace_list")).resolves.toEqual(["mocked"]);

    expect(mocks.normalizeDevBridgeError).toHaveBeenCalled();
    expect(mocks.baseInvoke).toHaveBeenCalledWith("workspace_list", undefined);

    expect(getInvokeErrorBuffer()).toEqual([
      expect.objectContaining({
        command: "workspace_list",
        transport: "http-bridge",
      }),
    ]);
    expect(getInvokeTraceBuffer()).toEqual([
      expect.objectContaining({
        command: "workspace_list",
        transport: "http-bridge",
        status: "error",
      }),
      expect.objectContaining({
        command: "workspace_list",
        transport: "fallback-invoke",
        status: "success",
      }),
    ]);
  });

  it("mock 优先命令会直接走 fallback invoke", async () => {
    vi.mocked(shouldPreferMockInBrowser).mockReturnValueOnce(true);
    mocks.baseInvoke.mockResolvedValueOnce(["mock-first"]);

    await expect(safeInvoke("list_plugin_tasks")).resolves.toEqual(["mock-first"]);

    expect(mocks.invokeViaHttp).not.toHaveBeenCalled();
    expect(mocks.baseInvoke).toHaveBeenCalledWith("list_plugin_tasks", undefined);
  });

  it("HTTP bridge 与 mock 都失败时抛出 bridge 错误", async () => {
    mocks.invokeViaHttp.mockRejectedValueOnce(new Error("Failed to fetch"));
    mocks.baseInvoke.mockRejectedValueOnce(new Error("mock failed"));

    await expect(safeInvoke("workspace_list")).rejects.toThrow(
      "[workspace_list] Failed to fetch",
    );
  });
});
