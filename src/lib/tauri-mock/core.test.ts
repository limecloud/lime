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

    await expect(
      invoke("list_plugin_tasks", { taskState: null, limit: 300 }),
    ).resolves.toEqual([]);

    expect(mocks.invokeViaHttp).not.toHaveBeenCalled();
  });

  it("工具库存 fallback mock 不应再返回空壳清单", async () => {
    mocks.invokeViaHttp.mockRejectedValueOnce(new Error("Failed to fetch"));
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});

    try {
      await expect(
        invoke("agent_runtime_get_tool_inventory", {
          request: {
            caller: "assistant",
            browserAssist: true,
          },
        }),
      ).resolves.toEqual(
        expect.objectContaining({
          request: expect.objectContaining({
            caller: "assistant",
            surface: expect.objectContaining({
              browser_assist: true,
            }),
          }),
          default_allowed_tools: expect.arrayContaining([
            "ToolSearch",
            "WebSearch",
            "ask",
          ]),
          counts: expect.objectContaining({
            catalog_total: expect.any(Number),
            registry_visible_total: expect.any(Number),
          }),
          catalog_tools: expect.arrayContaining([
            expect.objectContaining({ name: "ToolSearch" }),
            expect.objectContaining({ name: "WebSearch" }),
          ]),
          registry_tools: expect.arrayContaining([
            expect.objectContaining({ name: "ask" }),
          ]),
          mcp_tools: expect.arrayContaining([
            expect.objectContaining({ name: "mcp__lime-browser__navigate" }),
          ]),
        }),
      );
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it("bridge 失败且命令存在 mock 时回退默认 mock 数据", async () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    mocks.invokeViaHttp.mockRejectedValueOnce(new Error("Failed to fetch"));

    try {
      await expect(invoke("workspace_get_projects_root")).resolves.toBe(
        "/mock/workspace/projects",
      );
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it("OpenClaw 环境状态命令在 bridge 失败时回退默认 mock", async () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    mocks.invokeViaHttp.mockRejectedValueOnce(new Error("Failed to fetch"));

    try {
      await expect(invoke("openclaw_get_environment_status")).resolves.toEqual(
        expect.objectContaining({
          recommendedAction: "install_openclaw",
          summary: "运行环境已就绪，可以继续一键安装 OpenClaw。",
          diagnostics: expect.objectContaining({
            npmPath: "/opt/homebrew/bin/npm",
            npmGlobalPrefix: "/opt/homebrew",
          }),
          node: expect.objectContaining({ status: "ok" }),
          git: expect.objectContaining({ status: "ok" }),
        }),
      );
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it("旧 Agent 命令别名应直接报废弃错误，不再静默返回 mock 成功结果", async () => {
    mocks.isDevBridgeAvailable.mockReturnValue(false);

    await expect(invoke("list_agent_sessions")).rejects.toThrow(
      "命令 list_agent_sessions 已废弃，请迁移到 agent_runtime_list_sessions",
    );
    await expect(invoke("get_agent_process_status")).rejects.toThrow(
      "命令 get_agent_process_status 已废弃，请迁移到 agent_get_process_status",
    );
  });
});
