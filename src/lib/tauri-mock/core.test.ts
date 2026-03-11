/* eslint-disable no-restricted-syntax -- 测试底层 invoke 机制，需要直接使用命令名 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invokeViaHttp: vi.fn(),
  isDevBridgeAvailable: vi.fn(),
  normalizeDevBridgeError: vi.fn((cmd: string, error: unknown) => {
    if (error instanceof Error) {
      return new Error(`[${cmd}] ${error.message}`);
    }
    return new Error(`[${cmd}] ${String(error)}`);
  }),
}));

vi.mock("../dev-bridge/http-client", () => ({
  invokeViaHttp: mocks.invokeViaHttp,
  isDevBridgeAvailable: mocks.isDevBridgeAvailable,
  normalizeDevBridgeError: mocks.normalizeDevBridgeError,
}));

vi.mock("../dev-bridge/mockPriorityCommands", () => ({
  shouldPreferMockInBrowser: vi.fn(() => false),
}));

import { shouldPreferMockInBrowser } from "../dev-bridge/mockPriorityCommands";
import { clearMocks, invoke } from "./core";

describe("tauri-mock/core invoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearMocks();
    mocks.isDevBridgeAvailable.mockReturnValue(true);
  });

  it("浏览器模式下 direct invoke 走 HTTP bridge", async () => {
    mocks.invokeViaHttp.mockResolvedValueOnce("/real/backend/root");

    const result = await invoke<string>("workspace_get_projects_root");

    expect(result).toBe("/real/backend/root");
    expect(mocks.invokeViaHttp).toHaveBeenCalledWith(
      "workspace_get_projects_root",
      undefined,
    );
  });

  it("mock 优先命令直接返回默认 mock，不访问 bridge", async () => {
    vi.mocked(shouldPreferMockInBrowser).mockReturnValueOnce(true);

    await expect(invoke("list_plugin_tasks", { taskState: null, limit: 300 })).resolves.toEqual([]);

    expect(mocks.invokeViaHttp).not.toHaveBeenCalled();
  });

  it("bridge 失败且命令存在 mock 时回退默认 mock 数据", async () => {
    mocks.invokeViaHttp.mockRejectedValueOnce(new Error("Failed to fetch"));

    await expect(invoke("workspace_get_projects_root")).resolves.toBe(
      "/mock/workspace/projects",
    );
  });
});
