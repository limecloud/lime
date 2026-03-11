import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import {
  cancelPluginTask,
  disablePlugin,
  enablePlugin,
  getPluginQueueStats,
  getPluginStatus,
  getPlugins,
  getPluginTask,
  listInstalledPlugins,
  listPluginTasks,
  reloadPlugins,
  uninstallPlugin,
  unloadPlugin,
} from "./plugins";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("plugins API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应获取插件运行态数据", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce({ enabled: true })
      .mockResolvedValueOnce([{ name: "demo" }])
      .mockResolvedValueOnce([{ id: "plugin-1" }])
      .mockResolvedValueOnce([{ taskId: "task-1" }])
      .mockResolvedValueOnce([{ pluginId: "plugin-1", running: 1 }])
      .mockResolvedValueOnce({ taskId: "task-1" });

    await expect(getPluginStatus<{ enabled: boolean }>()).resolves.toEqual({
      enabled: true,
    });
    await expect(getPlugins<{ name: string }>()).resolves.toEqual([
      { name: "demo" },
    ]);
    await expect(listInstalledPlugins<{ id: string }>()).resolves.toEqual([
      { id: "plugin-1" },
    ]);
    await expect(
      listPluginTasks<{ taskId: string }>({ taskState: "running", limit: 100 }),
    ).resolves.toEqual([{ taskId: "task-1" }]);
    await expect(
      getPluginQueueStats<{ pluginId: string; running: number }>(),
    ).resolves.toEqual([{ pluginId: "plugin-1", running: 1 }]);
    await expect(getPluginTask<{ taskId: string }>("task-1")).resolves.toEqual({
      taskId: "task-1",
    });
  });

  it("应代理插件管理写操作", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);

    await expect(enablePlugin("demo")).resolves.toBeUndefined();
    await expect(disablePlugin("demo")).resolves.toBeUndefined();
    await expect(reloadPlugins()).resolves.toBeUndefined();
    await expect(unloadPlugin("demo")).resolves.toBeUndefined();
    await expect(uninstallPlugin("plugin-1")).resolves.toBe(true);
    await expect(cancelPluginTask("task-1")).resolves.toBe(true);
  });
});
