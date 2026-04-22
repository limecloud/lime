import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import type React from "react";
import {
  cleanupMountedRoots,
  clickElement,
  fillTextInput,
  flushEffects,
  mountHarness,
  setupReactActEnvironment,
  type MountedRoot,
} from "@/components/workspace/hooks/testUtils";

const { mockSafeInvoke, mockSafeListen, mockToast } = vi.hoisted(() => ({
  mockSafeInvoke: vi.fn(),
  mockSafeListen: vi.fn(async () => () => {}),
  mockToast: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));
const mockOpenExternal = vi.fn();

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: (...args: unknown[]) => mockSafeInvoke(...args),
  safeListen: mockSafeListen,
}));

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: (...args: unknown[]) => mockOpenExternal(...args),
}));

vi.mock("sonner", () => ({
  toast: mockToast,
}));

vi.mock("./PluginInstallDialog", () => ({
  PluginInstallDialog: () => null,
}));

vi.mock("./PluginUninstallDialog", () => ({
  PluginUninstallDialog: () => null,
}));

vi.mock("./PluginItemContextMenu", () => ({
  PluginItemContextMenu: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

import { PluginManager } from "./PluginManager";

const mountedRoots: MountedRoot[] = [];
const runtimeFilterStorageKey = "lime.pluginDiagnostics.filters.v1";
let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
let clipboardWriteTextMock: ReturnType<typeof vi.fn>;
let originalClipboard: Clipboard | undefined;
let originalUserAgent: PropertyDescriptor | undefined;

function changeSelectValue(element: HTMLSelectElement | null, value: string) {
  act(() => {
    if (!element) {
      return;
    }
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLSelectElement.prototype,
      "value",
    )?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function changeDateTimeInputValue(
  element: HTMLInputElement | null,
  value: string,
) {
  act(() => {
    if (!element) {
      return;
    }
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function toDateTimeLocalValue(value: Date): string {
  const pad = (num: number) => String(num).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(
    value.getHours(),
  )}:${pad(value.getMinutes())}`;
}

function buildMockTasks() {
  const now = Date.now();
  return Array.from({ length: 12 }).map((_, index) => {
    const id = index + 1;
    let startedAtOffset = id * 60 * 1000;
    if (id === 11) {
      startedAtOffset = 2 * 60 * 60 * 1000;
    }
    if (id === 12) {
      startedAtOffset = 8 * 24 * 60 * 60 * 1000;
    }
    return {
      taskId: `task-${id}`,
      pluginId: "demo-plugin",
      operation: id === 9 ? "special-op" : "handle_plugin_action",
      state: id % 3 === 0 ? "succeeded" : "running",
      attempt: 1,
      maxRetries: 2,
      startedAt: new Date(now - startedAtOffset).toISOString(),
      durationMs: 100 + id,
      error:
        id === 7
          ? {
              code: "UPSTREAM_5XX",
              message: "upstream error",
              retryable: true,
            }
          : null,
    };
  });
}

describe("PluginManager 任务可观测", () => {
  beforeEach(() => {
    setupReactActEnvironment();
    vi.clearAllMocks();
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    originalClipboard = navigator.clipboard;
    clipboardWriteTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: clipboardWriteTextMock,
      },
    });
    originalUserAgent = Object.getOwnPropertyDescriptor(
      Navigator.prototype,
      "userAgent",
    );
    window.localStorage.clear();
    const mockTasks = buildMockTasks();

    mockSafeInvoke.mockImplementation(
      async (command: string, args?: Record<string, unknown>) => {
        switch (command) {
          case "get_plugin_status":
            return {
              enabled: true,
              plugin_count: 1,
              plugins_dir: "/tmp/plugins",
            };
          case "get_plugins":
            return [
              {
                name: "demo-plugin",
                version: "1.0.0",
                description: "Demo plugin",
                author: "tester",
                status: "enabled",
                path: "/tmp/plugins/demo-plugin",
                hooks: ["on_request"],
                min_lime_version: null,
                config_schema: null,
                config: {
                  enabled: true,
                  timeout_ms: 5000,
                  settings: {},
                },
                state: {
                  name: "demo-plugin",
                  status: "enabled",
                  loaded_at: new Date().toISOString(),
                  last_executed: null,
                  execution_count: 12,
                  error_count: 1,
                  last_error: null,
                },
              },
            ];
          case "list_installed_plugins":
            return [];
          case "list_plugin_tasks":
            if (args?.taskState && args.taskState !== "all") {
              return mockTasks.filter((task) => task.state === args.taskState);
            }
            return mockTasks;
          case "get_plugin_queue_stats":
            return [
              {
                pluginId: "demo-plugin",
                running: 1,
                waiting: 2,
                rejected: 0,
                completed: 10,
                failed: 1,
                cancelled: 0,
                timedOut: 0,
              },
            ];
          case "cancel_plugin_task":
            expect(args).toEqual({ taskId: "task-1" });
            return true;
          case "get_plugin_task":
            expect(args).toEqual({ taskId: "task-1" });
            return {
              taskId: "task-1",
              pluginId: "demo-plugin",
              operation: "handle_plugin_action",
              state: "running",
              attempt: 1,
              maxRetries: 2,
              startedAt: new Date().toISOString(),
              durationMs: 120,
              error: null,
            };
          case "check_for_updates":
            return {
              current: "0.89.0",
              latest: "0.89.0",
              hasUpdate: false,
              downloadUrl: "https://github.com/aiclientproxy/lime/releases",
              error: undefined,
            };
          default:
            return [];
        }
      },
    );
  });

  afterEach(() => {
    cleanupMountedRoots(mountedRoots);
    consoleWarnSpy.mockRestore();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: originalClipboard,
    });
    if (originalUserAgent) {
      Object.defineProperty(
        Navigator.prototype,
        "userAgent",
        originalUserAgent,
      );
    }
  });

  it("仅在 Windows 下展示主程序更新卡片", async () => {
    Object.defineProperty(Navigator.prototype, "userAgent", {
      configurable: true,
      get: () => "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    });
    mockSafeInvoke.mockImplementation(async (command: string) => {
      switch (command) {
        case "check_for_updates":
          return {
            current: "0.88.0",
            latest: "0.89.0",
            hasUpdate: true,
            downloadUrl: "https://github.com/aiclientproxy/lime/releases",
            error: undefined,
          };
        case "get_plugin_status":
          return {
            enabled: true,
            plugin_count: 0,
            plugins_dir: "/tmp/plugins",
          };
        case "get_plugins":
        case "list_installed_plugins":
        case "list_plugin_tasks":
        case "get_plugin_queue_stats":
          return [];
        default:
          return [];
      }
    });

    const onNavigate = vi.fn();
    const { container } = mountHarness(
      PluginManager,
      { onNavigate },
      mountedRoots,
    );
    await flushEffects(8);

    expect(
      container.querySelector("[data-testid='plugin-windows-update-card']"),
    ).not.toBeNull();
    expect(container.textContent).toContain("Windows 主程序更新与安装包");
    expect(container.textContent).toContain("新版本 0.89.0");
    expect(container.textContent).toContain("安装包类型：Windows setup");
    expect(container.textContent).not.toContain("online 安装包");
    expect(container.textContent).not.toContain("offline 安装包");

    const aboutButton = container.querySelector(
      "[data-testid='plugin-windows-update-open-about']",
    );
    expect(aboutButton).not.toBeNull();
    clickElement(aboutButton);

    expect(onNavigate).toHaveBeenCalledWith("settings", { tab: "about" });
  });

  it("在 Windows 下提示插件要求更高主程序版本", async () => {
    Object.defineProperty(Navigator.prototype, "userAgent", {
      configurable: true,
      get: () => "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    });
    mockSafeInvoke.mockImplementation(async (command: string) => {
      switch (command) {
        case "check_for_updates":
          return {
            current: "0.88.0",
            latest: "0.89.0",
            hasUpdate: true,
            downloadUrl: "https://github.com/aiclientproxy/lime/releases",
            error: undefined,
          };
        case "get_plugin_status":
          return {
            enabled: true,
            plugin_count: 1,
            plugins_dir: "/tmp/plugins",
          };
        case "get_plugins":
          return [
            {
              name: "compat-plugin",
              version: "1.2.0",
              description: "Need newer app",
              author: "tester",
              status: "enabled",
              path: "/tmp/plugins/compat-plugin",
              hooks: ["on_request"],
              min_lime_version: "0.89.0",
              config_schema: null,
              config: {
                enabled: true,
                timeout_ms: 5000,
                settings: {},
              },
              state: {
                name: "compat-plugin",
                status: "enabled",
                loaded_at: new Date().toISOString(),
                last_executed: null,
                execution_count: 0,
                error_count: 0,
                last_error: null,
              },
            },
          ];
        case "list_installed_plugins":
        case "list_plugin_tasks":
        case "get_plugin_queue_stats":
          return [];
        default:
          return [];
      }
    });

    const { container } = mountHarness(PluginManager, {}, mountedRoots);
    await flushEffects(8);

    expect(
      container.querySelector(
        "[data-testid='plugin-windows-version-requirement-notice']",
      ),
    ).not.toBeNull();
    expect(container.textContent).toContain(
      "建议先升级主程序，再继续安装或排查插件",
    );
    expect(container.textContent).toContain(
      "当前已加载插件中有 1 个插件要求更高主程序版本",
    );
    expect(container.textContent).toContain("最高要求 Lime >= 0.89.0");
  });

  it("展示插件任务状态和队列统计", async () => {
    const { container } = mountHarness(PluginManager, {}, mountedRoots);
    await flushEffects(6);

    const expandButton = container.querySelector(
      "button[data-testid='plugin-expand-demo-plugin']",
    );
    expect(expandButton).not.toBeNull();
    clickElement(expandButton);
    await flushEffects(3);

    expect(container.textContent).toContain("最近任务");
    expect(container.textContent).toContain("handle_plugin_action");
    expect(container.textContent).toContain("执行队列");
    expect(container.textContent).toContain("运行中");
  });

  it("支持取消运行中的任务", async () => {
    const { container } = mountHarness(PluginManager, {}, mountedRoots);
    await flushEffects(6);

    const expandButton = container.querySelector(
      "button[data-testid='plugin-expand-demo-plugin']",
    );
    clickElement(expandButton);
    await flushEffects(3);

    const cancelButton = container.querySelector(
      "button[data-testid='plugin-cancel-task-task-1']",
    );
    expect(cancelButton).not.toBeNull();
    clickElement(cancelButton);
    await flushEffects(4);

    expect(mockSafeInvoke).toHaveBeenCalledWith("cancel_plugin_task", {
      taskId: "task-1",
    });
    expect(mockToast.success).toHaveBeenCalled();
  });

  it("支持查看单任务详情", async () => {
    const { container } = mountHarness(PluginManager, {}, mountedRoots);
    await flushEffects(6);

    const detailButton = container.querySelector(
      "button[data-testid='plugin-task-detail-task-1']",
    );
    expect(detailButton).not.toBeNull();
    clickElement(detailButton);
    await flushEffects(4);

    expect(mockSafeInvoke).toHaveBeenCalledWith("get_plugin_task", {
      taskId: "task-1",
    });
    expect(
      container.querySelector("[data-testid='plugin-task-detail-panel']"),
    ).not.toBeNull();
    expect(container.textContent).toContain("任务详情");
  });

  it("支持诊断面板搜索和分页", async () => {
    const { container } = mountHarness(PluginManager, {}, mountedRoots);
    await flushEffects(6);

    expect(
      container.querySelector("[data-testid='plugin-runtime-row-task-1']"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid='plugin-runtime-row-task-11']"),
    ).toBeNull();

    const nextPageBtn = container.querySelector(
      "button[data-testid='plugin-runtime-next-page']",
    );
    expect(nextPageBtn).not.toBeNull();
    clickElement(nextPageBtn);
    await flushEffects(3);
    expect(
      container.querySelector("[data-testid='plugin-runtime-row-task-11']"),
    ).not.toBeNull();

    const searchInput = container.querySelector(
      "input[data-testid='plugin-runtime-search-input']",
    );
    expect(searchInput).not.toBeNull();
    if (searchInput instanceof HTMLInputElement) {
      fillTextInput(searchInput, "special-op");
      await flushEffects(3);
      expect(
        container.querySelector("[data-testid='plugin-runtime-row-task-9']"),
      ).not.toBeNull();
      expect(
        container.querySelector("[data-testid='plugin-runtime-row-task-1']"),
      ).toBeNull();
    }
  });

  it("支持按时间范围筛选任务", async () => {
    const { container } = mountHarness(PluginManager, {}, mountedRoots);
    await flushEffects(6);

    const timeRangeFilter = container.querySelector(
      "select[data-testid='plugin-runtime-time-range-filter']",
    ) as HTMLSelectElement | null;
    expect(timeRangeFilter).not.toBeNull();

    changeSelectValue(timeRangeFilter, "1h");
    await flushEffects(3);

    expect(
      container.querySelector("[data-testid='plugin-runtime-row-task-1']"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid='plugin-runtime-row-task-11']"),
    ).toBeNull();
    expect(
      container.querySelector("[data-testid='plugin-runtime-row-task-12']"),
    ).toBeNull();
  });

  it("支持自定义时间区间筛选并持久化", async () => {
    const now = Date.now();
    const customStart = toDateTimeLocalValue(
      new Date(now - 3 * 60 * 60 * 1000),
    );
    const customEnd = toDateTimeLocalValue(new Date(now - 30 * 60 * 1000));
    const { container } = mountHarness(PluginManager, {}, mountedRoots);
    await flushEffects(6);

    const timeRangeFilter = container.querySelector(
      "select[data-testid='plugin-runtime-time-range-filter']",
    ) as HTMLSelectElement | null;
    expect(timeRangeFilter).not.toBeNull();
    changeSelectValue(timeRangeFilter, "custom");
    await flushEffects(2);

    const customStartInput = container.querySelector(
      "input[data-testid='plugin-runtime-custom-start-input']",
    ) as HTMLInputElement | null;
    const customEndInput = container.querySelector(
      "input[data-testid='plugin-runtime-custom-end-input']",
    ) as HTMLInputElement | null;
    expect(customStartInput).not.toBeNull();
    expect(customEndInput).not.toBeNull();

    changeDateTimeInputValue(customStartInput, customStart);
    changeDateTimeInputValue(customEndInput, customEnd);
    await flushEffects(3);

    expect(
      container.querySelector("[data-testid='plugin-runtime-row-task-1']"),
    ).toBeNull();
    expect(
      container.querySelector("[data-testid='plugin-runtime-row-task-11']"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid='plugin-runtime-row-task-12']"),
    ).toBeNull();

    const stored = JSON.parse(
      window.localStorage.getItem(runtimeFilterStorageKey) ?? "{}",
    ) as {
      timeRangeFilter?: string;
      customStartTime?: string;
      customEndTime?: string;
    };
    expect(stored.timeRangeFilter).toBe("custom");
    expect(stored.customStartTime).toBe(customStart);
    expect(stored.customEndTime).toBe(customEnd);
  });

  it("支持快捷时间按钮快速设定自定义区间", async () => {
    const { container } = mountHarness(PluginManager, {}, mountedRoots);
    await flushEffects(6);

    const timeRangeFilter = container.querySelector(
      "select[data-testid='plugin-runtime-time-range-filter']",
    ) as HTMLSelectElement | null;
    changeSelectValue(timeRangeFilter, "custom");
    await flushEffects(2);

    const quickRangeButton = container.querySelector(
      "button[data-testid='plugin-runtime-quick-range-15m']",
    );
    expect(quickRangeButton).not.toBeNull();
    clickElement(quickRangeButton);
    await flushEffects(2);

    const customStartInput = container.querySelector(
      "input[data-testid='plugin-runtime-custom-start-input']",
    ) as HTMLInputElement | null;
    const customEndInput = container.querySelector(
      "input[data-testid='plugin-runtime-custom-end-input']",
    ) as HTMLInputElement | null;
    expect(customStartInput?.value).not.toBe("");
    expect(customEndInput?.value).not.toBe("");
    expect(
      container.querySelector("[data-testid='plugin-runtime-row-task-1']"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid='plugin-runtime-row-task-11']"),
    ).toBeNull();

    const stored = JSON.parse(
      window.localStorage.getItem(runtimeFilterStorageKey) ?? "{}",
    ) as {
      timeRangeFilter?: string;
      customStartTime?: string;
      customEndTime?: string;
    };
    expect(stored.timeRangeFilter).toBe("custom");
    expect(stored.customStartTime).toBeTruthy();
    expect(stored.customEndTime).toBeTruthy();
  });

  it("自定义区间开始晚于结束时展示自动处理提示", async () => {
    const now = Date.now();
    const lateStart = toDateTimeLocalValue(new Date(now - 20 * 60 * 1000));
    const earlyEnd = toDateTimeLocalValue(new Date(now - 50 * 60 * 1000));

    const { container } = mountHarness(PluginManager, {}, mountedRoots);
    await flushEffects(6);

    const timeRangeFilter = container.querySelector(
      "select[data-testid='plugin-runtime-time-range-filter']",
    ) as HTMLSelectElement | null;
    changeSelectValue(timeRangeFilter, "custom");
    await flushEffects(2);

    const customStartInput = container.querySelector(
      "input[data-testid='plugin-runtime-custom-start-input']",
    ) as HTMLInputElement | null;
    const customEndInput = container.querySelector(
      "input[data-testid='plugin-runtime-custom-end-input']",
    ) as HTMLInputElement | null;
    changeDateTimeInputValue(customStartInput, lateStart);
    changeDateTimeInputValue(customEndInput, earlyEnd);
    await flushEffects(2);

    const hint = container.querySelector(
      "[data-testid='plugin-runtime-custom-range-hint']",
    );
    expect(hint?.textContent).toContain("自动按时间先后处理");
  });

  it("支持清空自定义区间并恢复提示文案", async () => {
    const { container } = mountHarness(PluginManager, {}, mountedRoots);
    await flushEffects(6);

    const timeRangeFilter = container.querySelector(
      "select[data-testid='plugin-runtime-time-range-filter']",
    ) as HTMLSelectElement | null;
    changeSelectValue(timeRangeFilter, "custom");
    await flushEffects(2);

    const quickRangeButton = container.querySelector(
      "button[data-testid='plugin-runtime-quick-range-30m']",
    );
    clickElement(quickRangeButton);
    await flushEffects(2);

    const clearRangeButton = container.querySelector(
      "button[data-testid='plugin-runtime-custom-clear-range']",
    );
    expect(clearRangeButton).not.toBeNull();
    clickElement(clearRangeButton);
    await flushEffects(2);

    const customStartInput = container.querySelector(
      "input[data-testid='plugin-runtime-custom-start-input']",
    ) as HTMLInputElement | null;
    const customEndInput = container.querySelector(
      "input[data-testid='plugin-runtime-custom-end-input']",
    ) as HTMLInputElement | null;
    expect(customStartInput?.value).toBe("");
    expect(customEndInput?.value).toBe("");

    const hint = container.querySelector(
      "[data-testid='plugin-runtime-custom-range-hint']",
    );
    expect(hint?.textContent).toContain("展示全部任务");
  });

  it("支持记忆并一键应用上次自定义区间", async () => {
    const now = Date.now();
    const customStart = toDateTimeLocalValue(new Date(now - 70 * 60 * 1000));
    const customEnd = toDateTimeLocalValue(new Date(now - 20 * 60 * 1000));

    const { container } = mountHarness(PluginManager, {}, mountedRoots);
    await flushEffects(6);

    const timeRangeFilter = container.querySelector(
      "select[data-testid='plugin-runtime-time-range-filter']",
    ) as HTMLSelectElement | null;
    changeSelectValue(timeRangeFilter, "custom");
    await flushEffects(2);

    const customStartInput = container.querySelector(
      "input[data-testid='plugin-runtime-custom-start-input']",
    ) as HTMLInputElement | null;
    const customEndInput = container.querySelector(
      "input[data-testid='plugin-runtime-custom-end-input']",
    ) as HTMLInputElement | null;
    changeDateTimeInputValue(customStartInput, customStart);
    changeDateTimeInputValue(customEndInput, customEnd);
    await flushEffects(2);

    const clearRangeButton = container.querySelector(
      "button[data-testid='plugin-runtime-custom-clear-range']",
    );
    clickElement(clearRangeButton);
    await flushEffects(2);
    expect(customStartInput?.value).toBe("");
    expect(customEndInput?.value).toBe("");

    const applyLastRangeButton = container.querySelector(
      "button[data-testid='plugin-runtime-custom-apply-last-range']",
    );
    expect(applyLastRangeButton).not.toBeNull();
    clickElement(applyLastRangeButton);
    await flushEffects(2);

    expect(customStartInput?.value).toBe(customStart);
    expect(customEndInput?.value).toBe(customEnd);

    const lastRangeText = container.querySelector(
      "[data-testid='plugin-runtime-custom-last-range']",
    );
    expect(lastRangeText?.textContent).not.toContain("暂无");

    const stored = JSON.parse(
      window.localStorage.getItem(runtimeFilterStorageKey) ?? "{}",
    ) as {
      lastAppliedCustomStartTime?: string;
      lastAppliedCustomEndTime?: string;
    };
    expect(stored.lastAppliedCustomStartTime).toBe(customStart);
    expect(stored.lastAppliedCustomEndTime).toBe(customEnd);
  });

  it("支持复制上次区间并展示最近使用时间", async () => {
    const now = Date.now();
    const customStart = toDateTimeLocalValue(new Date(now - 80 * 60 * 1000));
    const customEnd = toDateTimeLocalValue(new Date(now - 10 * 60 * 1000));

    const { container } = mountHarness(PluginManager, {}, mountedRoots);
    await flushEffects(6);

    const timeRangeFilter = container.querySelector(
      "select[data-testid='plugin-runtime-time-range-filter']",
    ) as HTMLSelectElement | null;
    changeSelectValue(timeRangeFilter, "custom");
    await flushEffects(2);

    const customStartInput = container.querySelector(
      "input[data-testid='plugin-runtime-custom-start-input']",
    ) as HTMLInputElement | null;
    const customEndInput = container.querySelector(
      "input[data-testid='plugin-runtime-custom-end-input']",
    ) as HTMLInputElement | null;
    changeDateTimeInputValue(customStartInput, customStart);
    changeDateTimeInputValue(customEndInput, customEnd);
    await flushEffects(2);

    const copyButton = container.querySelector(
      "button[data-testid='plugin-runtime-custom-copy-last-range']",
    );
    expect(copyButton).not.toBeNull();
    clickElement(copyButton);
    await flushEffects(2);

    expect(clipboardWriteTextMock).toHaveBeenCalledWith(
      `上次区间: ${customStart} ~ ${customEnd}`,
    );
    expect(mockToast.success).toHaveBeenCalledWith("已复制上次区间");

    const updatedAtLabel = container.querySelector(
      "[data-testid='plugin-runtime-custom-last-range-updated-at']",
    );
    expect(updatedAtLabel?.textContent).not.toContain("暂无");

    const stored = JSON.parse(
      window.localStorage.getItem(runtimeFilterStorageKey) ?? "{}",
    ) as {
      lastAppliedCustomUpdatedAt?: string;
    };
    expect(stored.lastAppliedCustomUpdatedAt).toBeTruthy();
  });

  it("支持复制结构化区间 JSON", async () => {
    const now = Date.now();
    const customStart = toDateTimeLocalValue(new Date(now - 95 * 60 * 1000));
    const customEnd = toDateTimeLocalValue(new Date(now - 25 * 60 * 1000));

    const { container } = mountHarness(PluginManager, {}, mountedRoots);
    await flushEffects(6);

    const timeRangeFilter = container.querySelector(
      "select[data-testid='plugin-runtime-time-range-filter']",
    ) as HTMLSelectElement | null;
    changeSelectValue(timeRangeFilter, "custom");
    await flushEffects(2);

    const customStartInput = container.querySelector(
      "input[data-testid='plugin-runtime-custom-start-input']",
    ) as HTMLInputElement | null;
    const customEndInput = container.querySelector(
      "input[data-testid='plugin-runtime-custom-end-input']",
    ) as HTMLInputElement | null;
    changeDateTimeInputValue(customStartInput, customStart);
    changeDateTimeInputValue(customEndInput, customEnd);
    await flushEffects(2);

    const copyJsonButton = container.querySelector(
      "button[data-testid='plugin-runtime-custom-copy-last-range-json']",
    );
    expect(copyJsonButton).not.toBeNull();
    clickElement(copyJsonButton);
    await flushEffects(2);

    expect(clipboardWriteTextMock).toHaveBeenCalled();
    const copiedValue = clipboardWriteTextMock.mock.calls[
      clipboardWriteTextMock.mock.calls.length - 1
    ]?.[0] as string | undefined;
    expect(copiedValue).toBeTruthy();
    const parsed = JSON.parse(copiedValue ?? "{}") as {
      start?: string;
      end?: string;
      updatedAt?: string | null;
    };
    expect(parsed.start).toBe(customStart);
    expect(parsed.end).toBe(customEnd);
    expect(parsed.updatedAt).toBeTruthy();
    expect(mockToast.success).toHaveBeenCalledWith("已复制区间 JSON");
  });

  it("支持保存并应用最近区间历史（最多5条）", async () => {
    const now = Date.now();
    const ranges = Array.from({ length: 6 }).map((_, index) => {
      const start = toDateTimeLocalValue(
        new Date(now - (index + 7) * 60 * 60 * 1000),
      );
      const end = toDateTimeLocalValue(
        new Date(now - (index + 6) * 60 * 60 * 1000),
      );
      return { start, end };
    });

    const { container } = mountHarness(PluginManager, {}, mountedRoots);
    await flushEffects(6);

    const timeRangeFilter = container.querySelector(
      "select[data-testid='plugin-runtime-time-range-filter']",
    ) as HTMLSelectElement | null;
    changeSelectValue(timeRangeFilter, "custom");
    await flushEffects(2);

    const customStartInput = container.querySelector(
      "input[data-testid='plugin-runtime-custom-start-input']",
    ) as HTMLInputElement | null;
    const customEndInput = container.querySelector(
      "input[data-testid='plugin-runtime-custom-end-input']",
    ) as HTMLInputElement | null;
    const historySelect = container.querySelector(
      "select[data-testid='plugin-runtime-custom-history-select']",
    ) as HTMLSelectElement | null;

    for (const range of ranges) {
      changeDateTimeInputValue(customStartInput, range.start);
      changeDateTimeInputValue(customEndInput, range.end);
      await flushEffects(2);
    }

    const stored = JSON.parse(
      window.localStorage.getItem(runtimeFilterStorageKey) ?? "{}",
    ) as {
      customRangeHistory?: Array<{
        id: string;
        start: string;
        end: string;
      }>;
    };

    expect(stored.customRangeHistory).toBeTruthy();
    expect(stored.customRangeHistory?.length).toBe(5);
    const latestRange = ranges[ranges.length - 1];
    expect(stored.customRangeHistory?.[0]?.start).toBe(latestRange.start);
    expect(stored.customRangeHistory?.[0]?.end).toBe(latestRange.end);

    const oldestInHistory = stored.customRangeHistory?.[4];
    expect(oldestInHistory).toBeTruthy();
    changeSelectValue(historySelect, oldestInHistory?.id ?? "");
    await flushEffects(2);

    expect(customStartInput?.value).toBe(oldestInHistory?.start);
    expect(customEndInput?.value).toBe(oldestInHistory?.end);
    expect(container.textContent).toContain("共 5 条");
  });

  it("支持为历史区间命名标签并持久化", async () => {
    const now = Date.now();
    const customStart = toDateTimeLocalValue(
      new Date(now - 3 * 60 * 60 * 1000),
    );
    const customEnd = toDateTimeLocalValue(new Date(now - 2 * 60 * 60 * 1000));
    const originalPrompt = window.prompt;
    const promptMock = vi.fn(() => "早高峰");
    Object.defineProperty(window, "prompt", {
      configurable: true,
      value: promptMock,
    });

    try {
      const { container } = mountHarness(PluginManager, {}, mountedRoots);
      await flushEffects(6);

      const timeRangeFilter = container.querySelector(
        "select[data-testid='plugin-runtime-time-range-filter']",
      ) as HTMLSelectElement | null;
      changeSelectValue(timeRangeFilter, "custom");
      await flushEffects(2);

      const customStartInput = container.querySelector(
        "input[data-testid='plugin-runtime-custom-start-input']",
      ) as HTMLInputElement | null;
      const customEndInput = container.querySelector(
        "input[data-testid='plugin-runtime-custom-end-input']",
      ) as HTMLInputElement | null;
      changeDateTimeInputValue(customStartInput, customStart);
      changeDateTimeInputValue(customEndInput, customEnd);
      await flushEffects(2);

      const renameButton = container.querySelector(
        "button[data-testid='plugin-runtime-custom-history-rename-0']",
      );
      expect(renameButton).not.toBeNull();
      clickElement(renameButton);
      await flushEffects(2);

      expect(promptMock).toHaveBeenCalled();
      expect(container.textContent).toContain("早高峰");

      const stored = JSON.parse(
        window.localStorage.getItem(runtimeFilterStorageKey) ?? "{}",
      ) as {
        customRangeHistory?: Array<{
          label?: string;
        }>;
      };
      expect(stored.customRangeHistory?.[0]?.label).toBe("早高峰");
    } finally {
      Object.defineProperty(window, "prompt", {
        configurable: true,
        value: originalPrompt,
      });
    }
  });

  it("支持历史区间按标签排序与搜索过滤", async () => {
    const now = Date.now();
    const history = [
      {
        start: toDateTimeLocalValue(new Date(now - 6 * 60 * 60 * 1000)),
        end: toDateTimeLocalValue(new Date(now - 5 * 60 * 60 * 1000)),
        updatedAt: new Date(now - 6 * 60 * 60 * 1000).toISOString(),
        label: "C标签",
      },
      {
        start: toDateTimeLocalValue(new Date(now - 5 * 60 * 60 * 1000)),
        end: toDateTimeLocalValue(new Date(now - 4 * 60 * 60 * 1000)),
        updatedAt: new Date(now - 5 * 60 * 60 * 1000).toISOString(),
        label: "A标签",
      },
      {
        start: toDateTimeLocalValue(new Date(now - 4 * 60 * 60 * 1000)),
        end: toDateTimeLocalValue(new Date(now - 3 * 60 * 60 * 1000)),
        updatedAt: new Date(now - 4 * 60 * 60 * 1000).toISOString(),
        label: "B标签",
      },
    ];

    window.localStorage.setItem(
      runtimeFilterStorageKey,
      JSON.stringify({
        timeRangeFilter: "custom",
        customRangeHistory: history,
      }),
    );

    const { container } = mountHarness(PluginManager, {}, mountedRoots);
    await flushEffects(6);

    const historySort = container.querySelector(
      "select[data-testid='plugin-runtime-custom-history-sort']",
    ) as HTMLSelectElement | null;
    changeSelectValue(historySort, "label");
    await flushEffects(2);

    const firstHistoryItem = container.querySelector(
      "[data-testid='plugin-runtime-custom-history-item-0']",
    );
    expect(firstHistoryItem?.textContent).toContain("A标签");

    const historySearch = container.querySelector(
      "input[data-testid='plugin-runtime-custom-history-search']",
    ) as HTMLInputElement | null;
    fillTextInput(historySearch, "B标签");
    await flushEffects(2);

    expect(container.textContent).toContain("匹配 1 条");
    const filteredFirstItem = container.querySelector(
      "[data-testid='plugin-runtime-custom-history-item-0']",
    );
    expect(filteredFirstItem?.textContent).toContain("B标签");
    expect(
      container.querySelector(
        "[data-testid='plugin-runtime-custom-history-item-1']",
      ),
    ).toBeNull();
  });

  it("支持收藏历史区间并置顶展示", async () => {
    const now = Date.now();
    const history = [
      {
        start: toDateTimeLocalValue(new Date(now - 6 * 60 * 60 * 1000)),
        end: toDateTimeLocalValue(new Date(now - 5 * 60 * 60 * 1000)),
        updatedAt: new Date(now - 6 * 60 * 60 * 1000).toISOString(),
        label: "C标签",
      },
      {
        start: toDateTimeLocalValue(new Date(now - 5 * 60 * 60 * 1000)),
        end: toDateTimeLocalValue(new Date(now - 4 * 60 * 60 * 1000)),
        updatedAt: new Date(now - 5 * 60 * 60 * 1000).toISOString(),
        label: "B标签",
      },
      {
        start: toDateTimeLocalValue(new Date(now - 4 * 60 * 60 * 1000)),
        end: toDateTimeLocalValue(new Date(now - 3 * 60 * 60 * 1000)),
        updatedAt: new Date(now - 4 * 60 * 60 * 1000).toISOString(),
        label: "A标签",
      },
    ];

    window.localStorage.setItem(
      runtimeFilterStorageKey,
      JSON.stringify({
        timeRangeFilter: "custom",
        customRangeHistory: history,
      }),
    );

    const { container } = mountHarness(PluginManager, {}, mountedRoots);
    await flushEffects(6);

    const firstBeforePin = container.querySelector(
      "[data-testid='plugin-runtime-custom-history-item-0']",
    );
    expect(firstBeforePin?.textContent).toContain("A标签");
    expect(container.textContent).toContain("收藏 0 条");

    const pinButton = container.querySelector(
      "button[data-testid='plugin-runtime-custom-history-pin-2']",
    );
    expect(pinButton).not.toBeNull();
    clickElement(pinButton);
    await flushEffects(2);

    const firstAfterPin = container.querySelector(
      "[data-testid='plugin-runtime-custom-history-item-0']",
    );
    expect(firstAfterPin?.textContent).toContain("C标签");
    expect(container.textContent).toContain("收藏 1 条");

    const stored = JSON.parse(
      window.localStorage.getItem(runtimeFilterStorageKey) ?? "{}",
    ) as {
      customRangeHistory?: Array<{ label?: string; pinned?: boolean }>;
    };
    const pinnedItem = stored.customRangeHistory?.find(
      (item) => item.label === "C标签",
    );
    expect(pinnedItem?.pinned).toBe(true);
  });

  it("支持仅看收藏历史区间并持久化筛选状态", async () => {
    const now = Date.now();
    window.localStorage.setItem(
      runtimeFilterStorageKey,
      JSON.stringify({
        timeRangeFilter: "custom",
        customRangeHistory: [
          {
            start: toDateTimeLocalValue(new Date(now - 5 * 60 * 60 * 1000)),
            end: toDateTimeLocalValue(new Date(now - 4 * 60 * 60 * 1000)),
            updatedAt: new Date(now - 5 * 60 * 60 * 1000).toISOString(),
            label: "未收藏",
            pinned: false,
          },
          {
            start: toDateTimeLocalValue(new Date(now - 4 * 60 * 60 * 1000)),
            end: toDateTimeLocalValue(new Date(now - 3 * 60 * 60 * 1000)),
            updatedAt: new Date(now - 4 * 60 * 60 * 1000).toISOString(),
            label: "已收藏",
            pinned: true,
          },
        ],
      }),
    );

    const { container } = mountHarness(PluginManager, {}, mountedRoots);
    await flushEffects(6);

    expect(container.textContent).toContain("匹配 2 条");

    const viewModeSelect = container.querySelector(
      "select[data-testid='plugin-runtime-custom-history-view-mode']",
    ) as HTMLSelectElement | null;
    expect(viewModeSelect).not.toBeNull();
    changeSelectValue(viewModeSelect, "only_pinned");
    await flushEffects(2);

    expect(container.textContent).toContain("匹配 1 条");
    expect(container.textContent).toContain("仅收藏匹配 1 条");
    const firstFilteredItem = container.querySelector(
      "[data-testid='plugin-runtime-custom-history-item-0']",
    );
    expect(firstFilteredItem?.textContent).toContain("已收藏");
    expect(
      container.querySelector(
        "[data-testid='plugin-runtime-custom-history-item-1']",
      ),
    ).toBeNull();

    let stored = JSON.parse(
      window.localStorage.getItem(runtimeFilterStorageKey) ?? "{}",
    ) as {
      customRangeHistoryOnlyPinned?: boolean;
    };
    expect(stored.customRangeHistoryOnlyPinned).toBe(true);

    changeSelectValue(viewModeSelect, "default");
    await flushEffects(2);
    expect(container.textContent).toContain("匹配 2 条");

    stored = JSON.parse(
      window.localStorage.getItem(runtimeFilterStorageKey) ?? "{}",
    ) as {
      customRangeHistoryOnlyPinned?: boolean;
    };
    expect(stored.customRangeHistoryOnlyPinned).toBe(false);
  });

  it("仅收藏模式下无收藏区间时展示专属空态提示", async () => {
    const now = Date.now();
    window.localStorage.setItem(
      runtimeFilterStorageKey,
      JSON.stringify({
        timeRangeFilter: "custom",
        customRangeHistory: [
          {
            start: toDateTimeLocalValue(new Date(now - 5 * 60 * 60 * 1000)),
            end: toDateTimeLocalValue(new Date(now - 4 * 60 * 60 * 1000)),
            updatedAt: new Date(now - 5 * 60 * 60 * 1000).toISOString(),
            label: "普通区间",
            pinned: false,
          },
        ],
      }),
    );

    const { container } = mountHarness(PluginManager, {}, mountedRoots);
    await flushEffects(6);

    const viewModeSelect = container.querySelector(
      "select[data-testid='plugin-runtime-custom-history-view-mode']",
    ) as HTMLSelectElement | null;
    expect(viewModeSelect).not.toBeNull();
    changeSelectValue(viewModeSelect, "only_pinned");
    await flushEffects(2);

    const emptyHint = container.querySelector(
      "[data-testid='plugin-runtime-custom-history-empty']",
    );
    expect(emptyHint?.textContent).toContain("当前仅收藏模式下暂无历史区间");
    expect(container.textContent).toContain("匹配 0 条");
    expect(container.textContent).toContain("仅收藏匹配 0 条");
    expect(container.textContent).toContain("收藏 0 条");
  });

  it("支持关闭收藏置顶后按当前排序规则展示", async () => {
    const now = Date.now();
    window.localStorage.setItem(
      runtimeFilterStorageKey,
      JSON.stringify({
        timeRangeFilter: "custom",
        customRangeHistory: [
          {
            start: toDateTimeLocalValue(new Date(now - 6 * 60 * 60 * 1000)),
            end: toDateTimeLocalValue(new Date(now - 5 * 60 * 60 * 1000)),
            updatedAt: new Date(now - 6 * 60 * 60 * 1000).toISOString(),
            label: "C标签",
            pinned: true,
          },
          {
            start: toDateTimeLocalValue(new Date(now - 5 * 60 * 60 * 1000)),
            end: toDateTimeLocalValue(new Date(now - 4 * 60 * 60 * 1000)),
            updatedAt: new Date(now - 5 * 60 * 60 * 1000).toISOString(),
            label: "A标签",
            pinned: false,
          },
          {
            start: toDateTimeLocalValue(new Date(now - 4 * 60 * 60 * 1000)),
            end: toDateTimeLocalValue(new Date(now - 3 * 60 * 60 * 1000)),
            updatedAt: new Date(now - 4 * 60 * 60 * 1000).toISOString(),
            label: "B标签",
            pinned: false,
          },
        ],
      }),
    );

    const { container } = mountHarness(PluginManager, {}, mountedRoots);
    await flushEffects(6);

    const historySort = container.querySelector(
      "select[data-testid='plugin-runtime-custom-history-sort']",
    ) as HTMLSelectElement | null;
    changeSelectValue(historySort, "label");
    await flushEffects(2);

    const firstWithPinnedFirst = container.querySelector(
      "[data-testid='plugin-runtime-custom-history-item-0']",
    );
    expect(firstWithPinnedFirst?.textContent).toContain("C标签");

    const viewModeSelect = container.querySelector(
      "select[data-testid='plugin-runtime-custom-history-view-mode']",
    ) as HTMLSelectElement | null;
    expect(viewModeSelect).not.toBeNull();
    changeSelectValue(viewModeSelect, "flat");
    await flushEffects(2);

    const firstWithPureSort = container.querySelector(
      "[data-testid='plugin-runtime-custom-history-item-0']",
    );
    expect(firstWithPureSort?.textContent).toContain("A标签");

    let stored = JSON.parse(
      window.localStorage.getItem(runtimeFilterStorageKey) ?? "{}",
    ) as {
      customRangeHistoryPinnedFirst?: boolean;
    };
    expect(stored.customRangeHistoryPinnedFirst).toBe(false);

    changeSelectValue(viewModeSelect, "default");
    await flushEffects(2);

    const firstPinnedAgain = container.querySelector(
      "[data-testid='plugin-runtime-custom-history-item-0']",
    );
    expect(firstPinnedAgain?.textContent).toContain("C标签");

    stored = JSON.parse(
      window.localStorage.getItem(runtimeFilterStorageKey) ?? "{}",
    ) as {
      customRangeHistoryPinnedFirst?: boolean;
    };
    expect(stored.customRangeHistoryPinnedFirst).toBe(true);
  });

  it("支持导出历史区间 JSON", async () => {
    const now = Date.now();
    window.localStorage.setItem(
      runtimeFilterStorageKey,
      JSON.stringify({
        timeRangeFilter: "custom",
        customRangeHistory: [
          {
            start: toDateTimeLocalValue(new Date(now - 2 * 60 * 60 * 1000)),
            end: toDateTimeLocalValue(new Date(now - 90 * 60 * 1000)),
            updatedAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
            label: "午高峰",
          },
        ],
      }),
    );

    const { container } = mountHarness(PluginManager, {}, mountedRoots);
    await flushEffects(6);

    const exportButton = container.querySelector(
      "button[data-testid='plugin-runtime-custom-history-export-json']",
    );
    expect(exportButton).not.toBeNull();
    clickElement(exportButton);
    await flushEffects(2);

    expect(clipboardWriteTextMock).toHaveBeenCalled();
    const copied = clipboardWriteTextMock.mock.calls[
      clipboardWriteTextMock.mock.calls.length - 1
    ]?.[0] as string | undefined;
    const parsed = JSON.parse(copied ?? "{}") as {
      version?: number;
      customRangeHistory?: Array<{ label?: string }>;
    };
    expect(parsed.version).toBe(1);
    expect(parsed.customRangeHistory?.[0]?.label).toBe("午高峰");
    expect(mockToast.success).toHaveBeenCalledWith("已复制历史区间 JSON");
  });

  it("支持导入历史区间 JSON", async () => {
    const now = Date.now();
    const originalPrompt = window.prompt;
    Object.defineProperty(window, "prompt", {
      configurable: true,
      value: vi.fn(() =>
        JSON.stringify({
          customRangeHistory: [
            {
              start: toDateTimeLocalValue(new Date(now - 7 * 60 * 60 * 1000)),
              end: toDateTimeLocalValue(new Date(now - 6 * 60 * 60 * 1000)),
              updatedAt: new Date(now - 7 * 60 * 60 * 1000).toISOString(),
              label: "晨间",
            },
            {
              start: toDateTimeLocalValue(new Date(now - 5 * 60 * 60 * 1000)),
              end: toDateTimeLocalValue(new Date(now - 4 * 60 * 60 * 1000)),
              updatedAt: new Date(now - 5 * 60 * 60 * 1000).toISOString(),
              label: "午后",
            },
          ],
        }),
      ),
    });

    try {
      const { container } = mountHarness(PluginManager, {}, mountedRoots);
      await flushEffects(6);

      const timeRangeFilter = container.querySelector(
        "select[data-testid='plugin-runtime-time-range-filter']",
      ) as HTMLSelectElement | null;
      changeSelectValue(timeRangeFilter, "custom");
      await flushEffects(2);

      const importButton = container.querySelector(
        "button[data-testid='plugin-runtime-custom-history-import-json']",
      );
      expect(importButton).not.toBeNull();
      clickElement(importButton);
      await flushEffects(3);

      expect(container.textContent).toContain("共 2 条，匹配 2 条");
      expect(container.textContent).toContain("晨间");
      expect(container.textContent).toContain("午后");

      const stored = JSON.parse(
        window.localStorage.getItem(runtimeFilterStorageKey) ?? "{}",
      ) as {
        customRangeHistory?: Array<{ label?: string }>;
      };
      expect(stored.customRangeHistory?.length).toBe(2);
      expect(mockToast.success).toHaveBeenCalledWith("已导入 2 条历史区间");
    } finally {
      Object.defineProperty(window, "prompt", {
        configurable: true,
        value: originalPrompt,
      });
    }
  });

  it("导入历史区间 JSON 格式错误时提示失败", async () => {
    const originalPrompt = window.prompt;
    Object.defineProperty(window, "prompt", {
      configurable: true,
      value: vi.fn(() => "{bad-json"),
    });

    try {
      const { container } = mountHarness(PluginManager, {}, mountedRoots);
      await flushEffects(6);

      const timeRangeFilter = container.querySelector(
        "select[data-testid='plugin-runtime-time-range-filter']",
      ) as HTMLSelectElement | null;
      changeSelectValue(timeRangeFilter, "custom");
      await flushEffects(2);

      const importButton = container.querySelector(
        "button[data-testid='plugin-runtime-custom-history-import-json']",
      );
      clickElement(importButton);
      await flushEffects(2);

      expect(mockToast.error).toHaveBeenCalled();
      const latestError =
        mockToast.error.mock.calls[mockToast.error.mock.calls.length - 1]?.[0];
      expect(String(latestError)).toContain("导入历史 JSON 失败");
    } finally {
      Object.defineProperty(window, "prompt", {
        configurable: true,
        value: originalPrompt,
      });
    }
  });

  it("支持删除单条与清空历史区间", async () => {
    const now = Date.now();
    const ranges = Array.from({ length: 3 }).map((_, index) => {
      const start = toDateTimeLocalValue(
        new Date(now - (index + 4) * 60 * 60 * 1000),
      );
      const end = toDateTimeLocalValue(
        new Date(now - (index + 3) * 60 * 60 * 1000),
      );
      return { start, end };
    });

    const { container } = mountHarness(PluginManager, {}, mountedRoots);
    await flushEffects(6);

    const timeRangeFilter = container.querySelector(
      "select[data-testid='plugin-runtime-time-range-filter']",
    ) as HTMLSelectElement | null;
    changeSelectValue(timeRangeFilter, "custom");
    await flushEffects(2);

    const customStartInput = container.querySelector(
      "input[data-testid='plugin-runtime-custom-start-input']",
    ) as HTMLInputElement | null;
    const customEndInput = container.querySelector(
      "input[data-testid='plugin-runtime-custom-end-input']",
    ) as HTMLInputElement | null;
    for (const range of ranges) {
      changeDateTimeInputValue(customStartInput, range.start);
      changeDateTimeInputValue(customEndInput, range.end);
      await flushEffects(2);
    }

    let stored = JSON.parse(
      window.localStorage.getItem(runtimeFilterStorageKey) ?? "{}",
    ) as {
      customRangeHistory?: Array<{
        id: string;
      }>;
    };
    const historyLengthBeforeDelete = stored.customRangeHistory?.length ?? 0;
    expect(historyLengthBeforeDelete).toBeGreaterThan(0);
    expect(container.textContent).toContain(
      `共 ${historyLengthBeforeDelete} 条`,
    );

    const deleteFirstHistoryButton = container.querySelector(
      "button[data-testid='plugin-runtime-custom-history-delete-0']",
    );
    expect(deleteFirstHistoryButton).not.toBeNull();
    clickElement(deleteFirstHistoryButton);
    await flushEffects(2);

    stored = JSON.parse(
      window.localStorage.getItem(runtimeFilterStorageKey) ?? "{}",
    ) as {
      customRangeHistory?: Array<{
        id: string;
      }>;
    };
    const historyLengthAfterDelete = stored.customRangeHistory?.length ?? 0;
    expect(historyLengthAfterDelete).toBe(historyLengthBeforeDelete - 1);
    expect(container.textContent).toContain(
      `共 ${historyLengthAfterDelete} 条`,
    );

    const clearHistoryButton = container.querySelector(
      "button[data-testid='plugin-runtime-custom-history-clear-all']",
    );
    expect(clearHistoryButton).not.toBeNull();
    clickElement(clearHistoryButton);
    await flushEffects(2);

    expect(container.textContent).toContain("共 0 条");
    stored = JSON.parse(
      window.localStorage.getItem(runtimeFilterStorageKey) ?? "{}",
    ) as {
      customRangeHistory?: Array<{
        id: string;
      }>;
    };
    expect(stored.customRangeHistory).toEqual([]);
  });

  it("Clipboard API 不可用时回退 execCommand 复制", async () => {
    const now = Date.now();
    const customStart = toDateTimeLocalValue(new Date(now - 65 * 60 * 1000));
    const customEnd = toDateTimeLocalValue(new Date(now - 5 * 60 * 1000));
    const originalExecCommand = document.execCommand;
    const execCommandMock = vi.fn(() => true);

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommandMock,
    });

    try {
      const { container } = mountHarness(PluginManager, {}, mountedRoots);
      await flushEffects(6);

      const timeRangeFilter = container.querySelector(
        "select[data-testid='plugin-runtime-time-range-filter']",
      ) as HTMLSelectElement | null;
      changeSelectValue(timeRangeFilter, "custom");
      await flushEffects(2);

      const customStartInput = container.querySelector(
        "input[data-testid='plugin-runtime-custom-start-input']",
      ) as HTMLInputElement | null;
      const customEndInput = container.querySelector(
        "input[data-testid='plugin-runtime-custom-end-input']",
      ) as HTMLInputElement | null;
      changeDateTimeInputValue(customStartInput, customStart);
      changeDateTimeInputValue(customEndInput, customEnd);
      await flushEffects(2);

      const copyButton = container.querySelector(
        "button[data-testid='plugin-runtime-custom-copy-last-range']",
      );
      clickElement(copyButton);
      await flushEffects(2);

      expect(execCommandMock).toHaveBeenCalledWith("copy");
      expect(mockToast.success).toHaveBeenCalledWith("已复制上次区间");
      expect(clipboardWriteTextMock).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(document, "execCommand", {
        configurable: true,
        value: originalExecCommand,
      });
    }
  });

  it("降级复制失败时展示错误提示", async () => {
    const now = Date.now();
    const customStart = toDateTimeLocalValue(new Date(now - 50 * 60 * 1000));
    const customEnd = toDateTimeLocalValue(new Date(now - 15 * 60 * 1000));
    const originalExecCommand = document.execCommand;
    const execCommandMock = vi.fn(() => false);

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommandMock,
    });

    try {
      const { container } = mountHarness(PluginManager, {}, mountedRoots);
      await flushEffects(6);

      const timeRangeFilter = container.querySelector(
        "select[data-testid='plugin-runtime-time-range-filter']",
      ) as HTMLSelectElement | null;
      changeSelectValue(timeRangeFilter, "custom");
      await flushEffects(2);

      const customStartInput = container.querySelector(
        "input[data-testid='plugin-runtime-custom-start-input']",
      ) as HTMLInputElement | null;
      const customEndInput = container.querySelector(
        "input[data-testid='plugin-runtime-custom-end-input']",
      ) as HTMLInputElement | null;
      changeDateTimeInputValue(customStartInput, customStart);
      changeDateTimeInputValue(customEndInput, customEnd);
      await flushEffects(2);

      const copyButton = container.querySelector(
        "button[data-testid='plugin-runtime-custom-copy-last-range']",
      );
      clickElement(copyButton);
      await flushEffects(2);

      expect(execCommandMock).toHaveBeenCalledWith("copy");
      expect(mockToast.error).toHaveBeenCalled();
      const latestError =
        mockToast.error.mock.calls[mockToast.error.mock.calls.length - 1]?.[0];
      expect(String(latestError)).toContain("浏览器不支持复制");
    } finally {
      Object.defineProperty(document, "execCommand", {
        configurable: true,
        value: originalExecCommand,
      });
    }
  });

  it("支持恢复并持久化诊断筛选条件", async () => {
    window.localStorage.setItem(
      runtimeFilterStorageKey,
      JSON.stringify({
        taskFilter: "all",
        globalPluginFilter: "demo-plugin",
        taskSearchKeyword: "special-op",
        taskPageSize: 20,
        timeRangeFilter: "24h",
      }),
    );

    const { container } = mountHarness(PluginManager, {}, mountedRoots);
    await flushEffects(6);

    const pluginFilter = container.querySelector(
      "select[data-testid='plugin-runtime-plugin-filter']",
    ) as HTMLSelectElement | null;
    const searchInput = container.querySelector(
      "input[data-testid='plugin-runtime-search-input']",
    ) as HTMLInputElement | null;
    const pageSize = container.querySelector(
      "select[data-testid='plugin-runtime-page-size']",
    ) as HTMLSelectElement | null;
    const timeRangeFilter = container.querySelector(
      "select[data-testid='plugin-runtime-time-range-filter']",
    ) as HTMLSelectElement | null;

    expect(pluginFilter?.value).toBe("demo-plugin");
    expect(searchInput?.value).toBe("special-op");
    expect(pageSize?.value).toBe("20");
    expect(timeRangeFilter?.value).toBe("24h");
    expect(
      container.querySelector("[data-testid='plugin-runtime-row-task-9']"),
    ).not.toBeNull();

    changeSelectValue(timeRangeFilter, "1h");
    await flushEffects(2);

    const stored = JSON.parse(
      window.localStorage.getItem(runtimeFilterStorageKey) ?? "{}",
    ) as {
      timeRangeFilter?: string;
      taskPageSize?: number;
      taskSearchKeyword?: string;
    };
    expect(stored.timeRangeFilter).toBe("1h");
    expect(stored.taskPageSize).toBe(20);
    expect(stored.taskSearchKeyword).toBe("special-op");
  });

  it("支持恢复自定义时间区间配置", async () => {
    const now = Date.now();
    const customStart = toDateTimeLocalValue(
      new Date(now - 4 * 60 * 60 * 1000),
    );
    const customEnd = toDateTimeLocalValue(new Date(now - 90 * 60 * 1000));

    window.localStorage.setItem(
      runtimeFilterStorageKey,
      JSON.stringify({
        taskFilter: "all",
        globalPluginFilter: "all",
        taskSearchKeyword: "",
        taskPageSize: 10,
        timeRangeFilter: "custom",
        customStartTime: customStart,
        customEndTime: customEnd,
      }),
    );

    const { container } = mountHarness(PluginManager, {}, mountedRoots);
    await flushEffects(6);

    const timeRangeFilter = container.querySelector(
      "select[data-testid='plugin-runtime-time-range-filter']",
    ) as HTMLSelectElement | null;
    const customStartInput = container.querySelector(
      "input[data-testid='plugin-runtime-custom-start-input']",
    ) as HTMLInputElement | null;
    const customEndInput = container.querySelector(
      "input[data-testid='plugin-runtime-custom-end-input']",
    ) as HTMLInputElement | null;

    expect(timeRangeFilter?.value).toBe("custom");
    expect(customStartInput?.value).toBe(customStart);
    expect(customEndInput?.value).toBe(customEnd);
    expect(
      container.querySelector("[data-testid='plugin-runtime-row-task-1']"),
    ).toBeNull();
    expect(
      container.querySelector("[data-testid='plugin-runtime-row-task-11']"),
    ).not.toBeNull();
  });

  it("支持重置筛选并回到默认分页", async () => {
    const { container } = mountHarness(PluginManager, {}, mountedRoots);
    await flushEffects(6);

    const nextPageBtn = container.querySelector(
      "button[data-testid='plugin-runtime-next-page']",
    );
    expect(nextPageBtn).not.toBeNull();
    clickElement(nextPageBtn);
    await flushEffects(2);
    expect(
      container.querySelector("[data-testid='plugin-runtime-row-task-11']"),
    ).not.toBeNull();

    const searchInput = container.querySelector(
      "input[data-testid='plugin-runtime-search-input']",
    ) as HTMLInputElement | null;
    const pageSize = container.querySelector(
      "select[data-testid='plugin-runtime-page-size']",
    ) as HTMLSelectElement | null;
    const timeRangeFilter = container.querySelector(
      "select[data-testid='plugin-runtime-time-range-filter']",
    ) as HTMLSelectElement | null;
    const resetButton = container.querySelector(
      "button[data-testid='plugin-runtime-reset-filters']",
    );

    fillTextInput(searchInput, "special-op");
    changeSelectValue(pageSize, "20");
    changeSelectValue(timeRangeFilter, "24h");
    await flushEffects(2);

    clickElement(resetButton);
    await flushEffects(3);

    expect(searchInput?.value).toBe("");
    expect(pageSize?.value).toBe("10");
    expect(timeRangeFilter?.value).toBe("all");
    expect(
      container.querySelector("[data-testid='plugin-runtime-row-task-1']"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid='plugin-runtime-row-task-11']"),
    ).toBeNull();

    const stored = JSON.parse(
      window.localStorage.getItem(runtimeFilterStorageKey) ?? "{}",
    ) as {
      taskSearchKeyword?: string;
      taskPageSize?: number;
      timeRangeFilter?: string;
      globalPluginFilter?: string;
      customStartTime?: string;
      customEndTime?: string;
    };
    expect(stored.taskSearchKeyword).toBe("");
    expect(stored.taskPageSize).toBe(10);
    expect(stored.timeRangeFilter).toBe("all");
    expect(stored.globalPluginFilter).toBe("all");
    expect(stored.customStartTime).toBe("");
    expect(stored.customEndTime).toBe("");
  });

  it("持久化筛选中的无效插件会自动回退到全部", async () => {
    window.localStorage.setItem(
      runtimeFilterStorageKey,
      JSON.stringify({
        taskFilter: "all",
        globalPluginFilter: "missing-plugin",
        taskSearchKeyword: "",
        taskPageSize: 10,
        timeRangeFilter: "all",
      }),
    );

    const { container } = mountHarness(PluginManager, {}, mountedRoots);
    await flushEffects(6);

    const pluginFilter = container.querySelector(
      "select[data-testid='plugin-runtime-plugin-filter']",
    ) as HTMLSelectElement | null;
    expect(pluginFilter?.value).toBe("all");

    const stored = JSON.parse(
      window.localStorage.getItem(runtimeFilterStorageKey) ?? "{}",
    ) as {
      globalPluginFilter?: string;
    };
    expect(stored.globalPluginFilter).toBe("all");
  });

  it("持久化配置损坏时会回退默认筛选", async () => {
    window.localStorage.setItem(runtimeFilterStorageKey, "{bad-json");

    const { container } = mountHarness(PluginManager, {}, mountedRoots);
    await flushEffects(6);

    const pluginFilter = container.querySelector(
      "select[data-testid='plugin-runtime-plugin-filter']",
    ) as HTMLSelectElement | null;
    const stateFilter = container.querySelector(
      "select[data-testid='plugin-runtime-state-filter']",
    ) as HTMLSelectElement | null;
    const pageSize = container.querySelector(
      "select[data-testid='plugin-runtime-page-size']",
    ) as HTMLSelectElement | null;
    const timeRangeFilter = container.querySelector(
      "select[data-testid='plugin-runtime-time-range-filter']",
    ) as HTMLSelectElement | null;
    const searchInput = container.querySelector(
      "input[data-testid='plugin-runtime-search-input']",
    ) as HTMLInputElement | null;

    expect(pluginFilter?.value).toBe("all");
    expect(stateFilter?.value).toBe("all");
    expect(pageSize?.value).toBe("10");
    expect(timeRangeFilter?.value).toBe("all");
    expect(searchInput?.value).toBe("");
    expect(consoleWarnSpy).toHaveBeenCalled();
  });

  it("支持导出CSV", async () => {
    const createObjectURL = vi.fn(() => "blob:mock-url");
    const revokeObjectURL = vi.fn();
    const originCreate = URL.createObjectURL;
    const originRevoke = URL.revokeObjectURL;
    const originAnchorClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    HTMLAnchorElement.prototype.click = vi.fn();

    try {
      const { container } = mountHarness(PluginManager, {}, mountedRoots);
      await flushEffects(6);

      const exportButton = container.querySelector(
        "button[data-testid='plugin-runtime-export-csv']",
      );
      expect(exportButton).not.toBeNull();
      clickElement(exportButton);
      await flushEffects(2);

      expect(createObjectURL).toHaveBeenCalled();
      expect(revokeObjectURL).toHaveBeenCalled();
      expect(mockToast.success).toHaveBeenCalled();
    } finally {
      URL.createObjectURL = originCreate;
      URL.revokeObjectURL = originRevoke;
      HTMLAnchorElement.prototype.click = originAnchorClick;
    }
  });
});
