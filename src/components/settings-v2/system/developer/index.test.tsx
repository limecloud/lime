import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockUseComponentDebug } = vi.hoisted(() => ({
  mockUseComponentDebug: vi.fn(),
}));

const { mockGetConfig } = vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
}));

const {
  mockClearServiceSkillCatalogCache,
  mockGetServiceSkillCatalog,
  mockSubscribeServiceSkillCatalogChanged,
} = vi.hoisted(() => ({
  mockClearServiceSkillCatalogCache: vi.fn(),
  mockGetServiceSkillCatalog: vi.fn(),
  mockSubscribeServiceSkillCatalogChanged: vi.fn(),
}));

const { mockGetLogs, mockGetPersistedLogsTail } = vi.hoisted(() => ({
  mockGetLogs: vi.fn(),
  mockGetPersistedLogsTail: vi.fn(),
}));

const {
  mockGetServerDiagnostics,
  mockGetLogStorageDiagnostics,
  mockGetWindowsStartupDiagnostics,
} = vi.hoisted(() => ({
  mockGetServerDiagnostics: vi.fn(),
  mockGetLogStorageDiagnostics: vi.fn(),
  mockGetWindowsStartupDiagnostics: vi.fn(),
}));

const {
  mockBuildCrashDiagnosticPayload,
  mockClearCrashDiagnosticHistory,
  mockCollectRuntimeSnapshotForDiagnostic,
  mockCollectThemeWorkbenchDocumentStateForDiagnostic,
  mockCopyCrashDiagnosticJsonToClipboard,
  mockCopyCrashDiagnosticToClipboard,
  mockExportCrashDiagnosticToJson,
  mockIsClipboardPermissionDeniedError,
  mockNormalizeCrashReportingConfig,
  mockOpenCrashDiagnosticDownloadDirectory,
} = vi.hoisted(() => ({
  mockBuildCrashDiagnosticPayload: vi.fn(),
  mockClearCrashDiagnosticHistory: vi.fn(),
  mockCollectRuntimeSnapshotForDiagnostic: vi.fn(),
  mockCollectThemeWorkbenchDocumentStateForDiagnostic: vi.fn(),
  mockCopyCrashDiagnosticJsonToClipboard: vi.fn(),
  mockCopyCrashDiagnosticToClipboard: vi.fn(),
  mockExportCrashDiagnosticToJson: vi.fn(),
  mockIsClipboardPermissionDeniedError: vi.fn(),
  mockNormalizeCrashReportingConfig: vi.fn(),
  mockOpenCrashDiagnosticDownloadDirectory: vi.fn(),
}));

const {
  mockEmitServiceSkillCatalogBootstrap,
  mockExtractServiceSkillCatalogFromBootstrapPayload,
} = vi.hoisted(() => ({
  mockEmitServiceSkillCatalogBootstrap: vi.fn(),
  mockExtractServiceSkillCatalogFromBootstrapPayload: vi.fn(),
}));

const {
  mockClearSiteAdapterCatalogCache,
  mockEmitSiteAdapterCatalogBootstrap,
  mockExtractSiteAdapterCatalogFromBootstrapPayload,
  mockSubscribeSiteAdapterCatalogChanged,
} = vi.hoisted(() => ({
  mockClearSiteAdapterCatalogCache: vi.fn(),
  mockEmitSiteAdapterCatalogBootstrap: vi.fn(),
  mockExtractSiteAdapterCatalogFromBootstrapPayload: vi.fn(),
  mockSubscribeSiteAdapterCatalogChanged: vi.fn(),
}));

const { mockSiteGetAdapterCatalogStatus, mockSiteListAdapters } = vi.hoisted(
  () => ({
    mockSiteGetAdapterCatalogStatus: vi.fn(),
    mockSiteListAdapters: vi.fn(),
  }),
);

vi.mock("@/contexts/ComponentDebugContext", () => ({
  useComponentDebug: mockUseComponentDebug,
}));

vi.mock("@/lib/api/appConfig", () => ({
  getConfig: mockGetConfig,
}));

vi.mock("@/lib/api/serviceSkills", () => ({
  clearServiceSkillCatalogCache: mockClearServiceSkillCatalogCache,
  getServiceSkillCatalog: mockGetServiceSkillCatalog,
  subscribeServiceSkillCatalogChanged: mockSubscribeServiceSkillCatalogChanged,
}));

vi.mock("@/lib/api/logs", () => ({
  getLogs: mockGetLogs,
  getPersistedLogsTail: mockGetPersistedLogsTail,
}));

vi.mock("@/lib/api/serverRuntime", () => ({
  getServerDiagnostics: mockGetServerDiagnostics,
  getLogStorageDiagnostics: mockGetLogStorageDiagnostics,
  getWindowsStartupDiagnostics: mockGetWindowsStartupDiagnostics,
}));

vi.mock("@/lib/crashDiagnostic", () => ({
  buildCrashDiagnosticPayload: mockBuildCrashDiagnosticPayload,
  clearCrashDiagnosticHistory: mockClearCrashDiagnosticHistory,
  collectRuntimeSnapshotForDiagnostic: mockCollectRuntimeSnapshotForDiagnostic,
  collectThemeWorkbenchDocumentStateForDiagnostic:
    mockCollectThemeWorkbenchDocumentStateForDiagnostic,
  CLEAR_CRASH_DIAGNOSTIC_HISTORY_CONFIRM_TEXT: "确认清空诊断信息？",
  copyCrashDiagnosticJsonToClipboard: mockCopyCrashDiagnosticJsonToClipboard,
  copyCrashDiagnosticToClipboard: mockCopyCrashDiagnosticToClipboard,
  exportCrashDiagnosticToJson: mockExportCrashDiagnosticToJson,
  isClipboardPermissionDeniedError: mockIsClipboardPermissionDeniedError,
  normalizeCrashReportingConfig: mockNormalizeCrashReportingConfig,
  openCrashDiagnosticDownloadDirectory:
    mockOpenCrashDiagnosticDownloadDirectory,
}));

vi.mock("@/lib/serviceSkillCatalogBootstrap", () => ({
  emitServiceSkillCatalogBootstrap: mockEmitServiceSkillCatalogBootstrap,
  extractServiceSkillCatalogFromBootstrapPayload:
    mockExtractServiceSkillCatalogFromBootstrapPayload,
}));

vi.mock("@/lib/siteAdapterCatalogBootstrap", () => ({
  clearSiteAdapterCatalogCache: mockClearSiteAdapterCatalogCache,
  emitSiteAdapterCatalogBootstrap: mockEmitSiteAdapterCatalogBootstrap,
  extractSiteAdapterCatalogFromBootstrapPayload:
    mockExtractSiteAdapterCatalogFromBootstrapPayload,
  subscribeSiteAdapterCatalogChanged: mockSubscribeSiteAdapterCatalogChanged,
}));

vi.mock("@/lib/webview-api", () => ({
  siteGetAdapterCatalogStatus: mockSiteGetAdapterCatalogStatus,
  siteListAdapters: mockSiteListAdapters,
}));

vi.mock("../shared/ClipboardPermissionGuideCard", () => ({
  ClipboardPermissionGuideCard: () => <div>剪贴板权限卡片占位</div>,
}));

vi.mock("../shared/WorkspaceRepairHistoryCard", () => ({
  WorkspaceRepairHistoryCard: () => <div>自愈记录卡片占位</div>,
}));

import { DeveloperSettings } from ".";

interface Mounted {
  container: HTMLDivElement;
  root: Root;
}

const remoteCatalog = {
  version: "tenant-2026-03-24",
  tenantId: "tenant-demo",
  syncedAt: "2026-03-24T12:00:00.000Z",
  items: [
    {
      id: "tenant-skill-1",
      title: "租户技能 1",
    },
    {
      id: "tenant-skill-2",
      title: "租户技能 2",
    },
  ],
};

const seededCatalog = {
  version: "client-seed-2026-03-24",
  tenantId: "local-seeded",
  syncedAt: "2026-03-24T00:00:00.000Z",
  items: [
    {
      id: "seeded-skill-1",
      title: "Seeded 技能 1",
    },
  ],
};

const siteCatalogStatus = {
  exists: false,
  source_kind: "bundled" as const,
  registry_version: 1,
  directory: "/tmp/lime/site-adapters/server-synced",
  adapter_count: 2,
};

const siteAdapters = [
  {
    name: "github/search",
    domain: "github.com",
    description: "GitHub 搜索",
    read_only: true,
    capabilities: ["search"],
    input_schema: { type: "object" },
    example_args: {},
    example: 'github/search {"query":"lime"}',
    source_kind: "bundled" as const,
  },
  {
    name: "zhihu/hot",
    domain: "www.zhihu.com",
    description: "知乎热榜",
    read_only: true,
    capabilities: ["hot"],
    input_schema: { type: "object" },
    example_args: {},
    example: 'zhihu/hot {"limit":10}',
    source_kind: "bundled" as const,
  },
];

const mounted: Mounted[] = [];

function renderComponent(): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<DeveloperSettings />);
  });

  mounted.push({ container, root });
  return container;
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

function findButton(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find((item) =>
    item.textContent?.includes(text),
  );
  if (!button) {
    throw new Error(`未找到按钮: ${text}`);
  }
  return button as HTMLButtonElement;
}

function findSwitch(
  container: HTMLElement,
  ariaLabel: string,
): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(
    `button[aria-label="${ariaLabel}"]`,
  );
  if (!button) {
    throw new Error(`未找到开关: ${ariaLabel}`);
  }
  return button;
}

function findTextarea(
  container: HTMLElement,
  ariaLabel: string,
): HTMLTextAreaElement {
  const textarea = container.querySelector<HTMLTextAreaElement>(
    `textarea[aria-label="${ariaLabel}"]`,
  );
  if (!textarea) {
    throw new Error(`未找到输入框: ${ariaLabel}`);
  }
  return textarea;
}

async function clickButton(button: HTMLButtonElement) {
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushEffects();
  });
}

async function inputTextarea(textarea: HTMLTextAreaElement, value: string) {
  const prototype = Object.getPrototypeOf(textarea) as HTMLTextAreaElement;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  const setValue = descriptor?.set;
  if (!setValue) {
    throw new Error("未找到 textarea value setter");
  }

  await act(async () => {
    setValue.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    await flushEffects();
  });
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  vi.clearAllMocks();

  mockUseComponentDebug.mockReturnValue({
    enabled: false,
    setEnabled: vi.fn(),
    componentInfo: null,
    showComponentInfo: vi.fn(),
    hideComponentInfo: vi.fn(),
  });

  mockGetConfig.mockResolvedValue({
    crash_reporting: {
      enabled: true,
      dsn: null,
      environment: "production",
      sample_rate: 1,
      send_pii: false,
    },
  });
  mockGetLogs.mockResolvedValue([{ level: "error", message: "boom" }]);
  mockGetPersistedLogsTail.mockResolvedValue([
    { level: "info", message: "ok" },
  ]);
  mockGetServerDiagnostics.mockResolvedValue({ ok: true });
  mockGetLogStorageDiagnostics.mockResolvedValue({ ok: true });
  mockGetWindowsStartupDiagnostics.mockResolvedValue({ ok: true });

  mockCollectRuntimeSnapshotForDiagnostic.mockResolvedValue({
    runtimeSnapshot: { summary: "runtime" },
    collectionNotes: ["note-a"],
  });
  mockCollectThemeWorkbenchDocumentStateForDiagnostic.mockResolvedValue({
    documentId: "doc-1",
  });
  mockNormalizeCrashReportingConfig.mockImplementation((config) => config);
  mockBuildCrashDiagnosticPayload.mockReturnValue({ payload: "diagnostic" });
  mockCopyCrashDiagnosticToClipboard.mockResolvedValue(undefined);
  mockCopyCrashDiagnosticJsonToClipboard.mockResolvedValue(undefined);
  mockExportCrashDiagnosticToJson.mockReturnValue({
    fileName: "diagnostic.json",
    locationHint: "/tmp",
  });
  mockOpenCrashDiagnosticDownloadDirectory.mockResolvedValue({
    openedPath: "/tmp",
  });
  mockClearCrashDiagnosticHistory.mockResolvedValue(undefined);
  mockIsClipboardPermissionDeniedError.mockReturnValue(false);
  mockGetServiceSkillCatalog.mockResolvedValue(remoteCatalog);
  mockSubscribeServiceSkillCatalogChanged.mockImplementation(() => vi.fn());
  mockClearServiceSkillCatalogCache.mockImplementation(() => undefined);
  mockExtractServiceSkillCatalogFromBootstrapPayload.mockReturnValue(
    remoteCatalog,
  );
  mockSiteGetAdapterCatalogStatus.mockResolvedValue(siteCatalogStatus);
  mockSiteListAdapters.mockResolvedValue(siteAdapters);
  mockClearSiteAdapterCatalogCache.mockResolvedValue(siteCatalogStatus);
  mockSubscribeSiteAdapterCatalogChanged.mockImplementation(() => vi.fn());
  mockExtractSiteAdapterCatalogFromBootstrapPayload.mockImplementation(
    (payload) =>
      (
        payload as {
          siteAdapterCatalog?: {
            adapters?: unknown[];
          };
        }
      ).siteAdapterCatalog ?? null,
  );
});

afterEach(() => {
  while (mounted.length > 0) {
    const target = mounted.pop();
    if (!target) {
      break;
    }

    act(() => {
      target.root.unmount();
    });
    target.container.remove();
  }

  vi.clearAllMocks();
});

describe("DeveloperSettings", () => {
  it("应渲染新的开发者工作台与主要分区", async () => {
    const container = renderComponent();
    await flushEffects();

    const text = container.textContent ?? "";
    expect(text).toContain("DEVELOPER DESK");
    expect(text).toContain("服务型技能目录联调");
    expect(text).toContain("站点脚本目录联调");
    expect(text).toContain("组件视图调试");
    expect(text).toContain("崩溃诊断日志（开发协作）");
    expect(text).toContain("诊断建议");
    expect(text).toContain("动作清单");
    expect(text).toContain("自愈记录卡片占位");
  });

  it("切换组件调试开关后应调用 setEnabled", async () => {
    const setEnabled = vi.fn();
    mockUseComponentDebug.mockReturnValue({
      enabled: false,
      setEnabled,
      componentInfo: null,
      showComponentInfo: vi.fn(),
      hideComponentInfo: vi.fn(),
    });

    const container = renderComponent();
    await clickButton(findSwitch(container, "切换组件视图调试"));

    expect(setEnabled).toHaveBeenCalledTimes(1);
    expect(setEnabled).toHaveBeenCalledWith(true);
  });

  it("点击复制诊断信息后应构建并复制诊断载荷", async () => {
    const container = renderComponent();

    await clickButton(findButton(container, "复制诊断信息"));
    await flushEffects();

    expect(mockCollectRuntimeSnapshotForDiagnostic).toHaveBeenCalledTimes(1);
    expect(mockBuildCrashDiagnosticPayload).toHaveBeenCalledTimes(1);
    expect(mockCopyCrashDiagnosticToClipboard).toHaveBeenCalledWith({
      payload: "diagnostic",
    });
    expect(container.textContent).toContain("诊断信息已复制，可直接发给开发者");
  });

  it("复制诊断因剪贴板权限失败时应显示权限指引", async () => {
    mockCopyCrashDiagnosticToClipboard.mockRejectedValueOnce(
      new Error("clipboard denied"),
    );
    mockIsClipboardPermissionDeniedError.mockReturnValue(true);

    const container = renderComponent();

    await clickButton(findButton(container, "复制诊断信息"));
    await flushEffects();

    expect(container.textContent).toContain("剪贴板权限卡片占位");
    expect(container.textContent).toContain("clipboard denied");
  });

  it("点击载入当前目录后应把 serviceSkillCatalog 写入调试输入框", async () => {
    const container = renderComponent();

    await clickButton(findButton(container, "载入当前目录"));
    await flushEffects();

    const textarea = findTextarea(container, "服务型技能目录调试输入");
    expect(textarea.value).toContain('"tenantId": "tenant-demo"');
    expect(container.textContent).toContain("已把当前目录写入调试编辑器");
  });

  it("输入 JSON 后通过事件注入应调用 bootstrap 桥接", async () => {
    const container = renderComponent();
    await flushEffects();
    const textarea = findTextarea(container, "服务型技能目录调试输入");

    await inputTextarea(
      textarea,
      JSON.stringify(
        {
          serviceSkillCatalog: remoteCatalog,
        },
        null,
        2,
      ),
    );
    await clickButton(findButton(container, "通过事件注入"));
    await flushEffects();

    expect(
      mockExtractServiceSkillCatalogFromBootstrapPayload,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceSkillCatalog: expect.objectContaining({
          tenantId: "tenant-demo",
        }),
      }),
    );
    expect(mockEmitServiceSkillCatalogBootstrap).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceSkillCatalog: expect.objectContaining({
          tenantId: "tenant-demo",
        }),
      }),
    );
    expect(container.textContent).toContain(
      "已通过 bootstrap 事件注入目录：2 项",
    );
  });

  it("清空目录缓存后应回退 seeded 目录并展示提示", async () => {
    mockGetServiceSkillCatalog.mockResolvedValueOnce(remoteCatalog);
    mockGetServiceSkillCatalog.mockResolvedValueOnce(seededCatalog);

    const container = renderComponent();
    await flushEffects();

    await clickButton(findButton(container, "清空目录缓存"));
    await flushEffects();

    expect(mockClearServiceSkillCatalogCache).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain(
      "已清空远端目录缓存，当前回退到 seeded：1 项",
    );
  });

  it("应展示站点脚本目录摘要", async () => {
    const container = renderComponent();
    await flushEffects();

    expect(container.textContent).toContain("站点脚本目录联调");
    expect(container.textContent).toContain("应用内置");
    expect(container.textContent).toContain("github/search");
    expect(container.textContent).toContain("zhihu/hot");
  });

  it("输入 JSON 后注入站点脚本目录应调用 bootstrap 桥接", async () => {
    const container = renderComponent();
    await flushEffects();
    const textarea = findTextarea(container, "站点脚本目录调试输入");

    await inputTextarea(
      textarea,
      JSON.stringify(
        {
          siteAdapterCatalog: {
            adapters: [{ name: "github/search" }, { name: "zhihu/hot" }],
          },
        },
        null,
        2,
      ),
    );
    await clickButton(findButton(container, "注入站点目录"));
    await flushEffects();

    expect(
      mockExtractSiteAdapterCatalogFromBootstrapPayload,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        siteAdapterCatalog: expect.objectContaining({
          adapters: expect.any(Array),
        }),
      }),
    );
    expect(mockEmitSiteAdapterCatalogBootstrap).toHaveBeenCalledWith(
      expect.objectContaining({
        siteAdapterCatalog: expect.objectContaining({
          adapters: expect.any(Array),
        }),
      }),
    );
    expect(container.textContent).toContain(
      "已通过 bootstrap 事件注入站点脚本目录：2 项",
    );
  });

  it("清空站点脚本目录缓存后应提示回退到应用内置", async () => {
    const container = renderComponent();
    await flushEffects();

    await clickButton(findButton(container, "清空站点目录缓存"));
    await flushEffects();

    expect(mockClearSiteAdapterCatalogCache).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain(
      "已清空站点脚本目录缓存，当前回退到应用内置：2 项",
    );
  });

  it("站点目录变更事件后应自动刷新开发页摘要", async () => {
    const container = renderComponent();
    await flushEffects();

    expect(mockSiteGetAdapterCatalogStatus).toHaveBeenCalledTimes(1);
    expect(mockSiteListAdapters).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("应用内置");

    mockSiteGetAdapterCatalogStatus.mockResolvedValueOnce({
      exists: true,
      source_kind: "server_synced",
      registry_version: 2,
      directory: "/tmp/lime/site-adapters/server-synced",
      catalog_version: "tenant-site-2026-03-27",
      tenant_id: "tenant-demo",
      synced_at: "2026-03-27T08:00:00.000Z",
      adapter_count: 1,
    });
    mockSiteListAdapters.mockResolvedValueOnce([
      {
        name: "bilibili/hot",
        domain: "www.bilibili.com",
        description: "B 站热榜",
        read_only: true,
        capabilities: ["hot"],
        input_schema: { type: "object" },
        example_args: {},
        example: 'bilibili/hot {"limit":10}',
        source_kind: "server_synced" as const,
      },
    ]);

    const changedListener =
      mockSubscribeSiteAdapterCatalogChanged.mock.calls[0]?.[0];
    expect(changedListener).toBeTypeOf("function");

    await act(async () => {
      changedListener?.({
        exists: true,
        source_kind: "server_synced",
        adapter_count: 1,
      });
      await flushEffects();
    });

    expect(mockSiteGetAdapterCatalogStatus).toHaveBeenCalledTimes(2);
    expect(mockSiteListAdapters).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("服务端同步");
    expect(container.textContent).toContain("bilibili/hot");
    expect(container.textContent).toContain("tenant-site-2026-03-27");
  });
});
