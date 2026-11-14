import { describe, expect, it, vi } from "vitest";
import type { MenuItemConstructorOptions } from "electron";
import {
  applicationMenuLabels,
  buildApplicationMenuTemplate,
  formatTaskManagerDetail,
  resolveApplicationMenuLocale,
} from "./applicationMenu";

function submenu(
  item: MenuItemConstructorOptions,
): MenuItemConstructorOptions[] {
  return item.submenu as MenuItemConstructorOptions[];
}

const handlers = {
  onOpenAbout: vi.fn(),
  onOpenSettings: vi.fn(),
  onCheckForUpdates: vi.fn(),
  onOpenDocumentation: vi.fn(),
  onOpenLogs: vi.fn(),
  onOpenSystemStatus: vi.fn(),
  onOpenTaskManager: vi.fn(),
  onOpenTroubleshooting: vi.fn(),
};

describe("applicationMenu", () => {
  it("按系统语言选择五种菜单文案", () => {
    expect(resolveApplicationMenuLocale("zh-CN")).toBe("zh-CN");
    expect(resolveApplicationMenuLocale("zh-Hant-TW")).toBe("zh-TW");
    expect(resolveApplicationMenuLocale("ja-JP")).toBe("ja-JP");
    expect(resolveApplicationMenuLocale("ko-KR")).toBe("ko-KR");
    expect(resolveApplicationMenuLocale("en-GB")).toBe("en-US");
    expect(applicationMenuLabels("zh-CN")).toMatchObject({
      about: "关于 Lime",
      settings: "设置…",
    });
    expect(applicationMenuLabels("zh-TW").settings).toBe("設定…");
  });

  it("格式化任务管理器的进程指标", () => {
    expect(
      formatTaskManagerDetail([
        {
          type: "Browser",
          pid: 42,
          cpu: { percentCPUUsage: 12.34 },
          memory: { workingSetSize: 2048 },
        },
      ]),
    ).toBe("Browser  pid=42  CPU 12.3%  MEM 2 MB");
    expect(formatTaskManagerDetail([])).toBe("-");
  });

  it("macOS 菜单包含关于/设置与标准编辑视图窗口菜单", () => {
    const template = buildApplicationMenuTemplate({
      appName: "Lime",
      locale: "zh-CN",
      isMac: true,
      ...handlers,
    });
    expect(template.map((item) => item.role ?? item.label)).toEqual([
      "Lime",
      "editMenu",
      "viewMenu",
      "windowMenu",
      "help",
    ]);
    const appItems = submenu(template[0]);
    expect(appItems[0]).toMatchObject({ label: "关于 Lime" });
    expect(appItems[1]).toMatchObject({
      label: "设置…",
      accelerator: "CommandOrControl+,",
    });
    expect(appItems[2]).toMatchObject({ label: "检查更新…" });
    (appItems[0].click as () => void)();
    (appItems[1].click as () => void)();
    (appItems[2].click as () => void)();
    expect(handlers.onOpenAbout).toHaveBeenCalledOnce();
    expect(handlers.onOpenSettings).toHaveBeenCalledOnce();
    expect(handlers.onCheckForUpdates).toHaveBeenCalledOnce();
  });

  it("帮助菜单提供文档与日志入口", () => {
    const template = buildApplicationMenuTemplate({
      appName: "Lime",
      locale: "zh-CN",
      isMac: true,
      ...handlers,
    });
    const help = template.at(-1)!;
    expect(help).toMatchObject({ label: "帮助", role: "help" });
    const items = submenu(help);
    expect(items[0]).toMatchObject({ label: "系统状态" });
    expect(items[1]).toMatchObject({ label: "任务管理器" });
    expect(items[2]).toMatchObject({ label: "故障排查" });
    const documentation = items.find((item) => item.label === "帮助文档")!;
    const logs = items.find((item) => item.label === "打开日志目录")!;
    (items[0].click as () => void)();
    (items[1].click as () => void)();
    (items[2].click as () => void)();
    (documentation.click as () => void)();
    (logs.click as () => void)();
    expect(handlers.onOpenSystemStatus).toHaveBeenCalledOnce();
    expect(handlers.onOpenTaskManager).toHaveBeenCalledOnce();
    expect(handlers.onOpenTroubleshooting).toHaveBeenCalledOnce();
    expect(handlers.onOpenDocumentation).toHaveBeenCalledOnce();
    expect(handlers.onOpenLogs).toHaveBeenCalledOnce();
  });

  it("非 macOS 菜单在文件菜单提供设置入口", () => {
    const template = buildApplicationMenuTemplate({
      appName: "Lime",
      locale: "en-US",
      isMac: false,
      ...handlers,
    });
    expect(template[0]).toMatchObject({ label: "File" });
    expect(submenu(template[0])[0]).toMatchObject({ label: "Settings…" });
    expect(submenu(template[0])[1]).toMatchObject({
      label: "Check for Updates…",
    });
    expect(template.map((item) => item.role ?? item.label)).toEqual([
      "File",
      "editMenu",
      "viewMenu",
      "windowMenu",
      "help",
    ]);
  });
});
