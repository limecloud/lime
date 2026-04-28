import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetConfig, mockSaveConfig } = vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
  mockSaveConfig: vi.fn(),
}));

const {
  mockGetExperimentalConfig,
  mockSaveExperimentalConfig,
  mockUpdateScreenshotShortcut,
  mockValidateShortcut,
} = vi.hoisted(() => ({
  mockGetExperimentalConfig: vi.fn(),
  mockSaveExperimentalConfig: vi.fn(),
  mockUpdateScreenshotShortcut: vi.fn(),
  mockValidateShortcut: vi.fn(),
}));

const { mockGetLogs, mockGetPersistedLogsTail } = vi.hoisted(() => ({
  mockGetLogs: vi.fn(),
  mockGetPersistedLogsTail: vi.fn(),
}));

const {
  mockGetLogStorageDiagnostics,
  mockGetServerDiagnostics,
  mockGetWindowsStartupDiagnostics,
} = vi.hoisted(() => ({
  mockGetLogStorageDiagnostics: vi.fn(),
  mockGetServerDiagnostics: vi.fn(),
  mockGetWindowsStartupDiagnostics: vi.fn(),
}));

const { mockApplyCrashReportingSettings } = vi.hoisted(() => ({
  mockApplyCrashReportingSettings: vi.fn(),
}));

const {
  mockBuildCrashDiagnosticPayload,
  mockCollectRuntimeSnapshotForDiagnostic,
  mockCollectGeneralWorkbenchDocumentStateForDiagnostic,
  mockCopyCrashDiagnosticJsonToClipboard,
  mockCopyCrashDiagnosticToClipboard,
  mockExportCrashDiagnosticToJson,
  mockIsClipboardPermissionDeniedError,
  mockNormalizeCrashReportingConfig,
  mockOpenCrashDiagnosticDownloadDirectory,
} = vi.hoisted(() => ({
  mockBuildCrashDiagnosticPayload: vi.fn(),
  mockCollectRuntimeSnapshotForDiagnostic: vi.fn(),
  mockCollectGeneralWorkbenchDocumentStateForDiagnostic: vi.fn(),
  mockCopyCrashDiagnosticJsonToClipboard: vi.fn(),
  mockCopyCrashDiagnosticToClipboard: vi.fn(),
  mockExportCrashDiagnosticToJson: vi.fn(),
  mockIsClipboardPermissionDeniedError: vi.fn(),
  mockNormalizeCrashReportingConfig: vi.fn(),
  mockOpenCrashDiagnosticDownloadDirectory: vi.fn(),
}));

vi.mock("@/lib/api/appConfig", () => ({
  getConfig: mockGetConfig,
  saveConfig: mockSaveConfig,
}));

vi.mock("@/lib/api/experimentalFeatures", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/api/experimentalFeatures")
  >("@/lib/api/experimentalFeatures");
  return {
    ...actual,
    getExperimentalConfig: mockGetExperimentalConfig,
    saveExperimentalConfig: mockSaveExperimentalConfig,
    updateScreenshotShortcut: mockUpdateScreenshotShortcut,
    validateShortcut: mockValidateShortcut,
  };
});

vi.mock("@/lib/api/logs", () => ({
  getLogs: mockGetLogs,
  getPersistedLogsTail: mockGetPersistedLogsTail,
}));

vi.mock("@/lib/api/serverRuntime", () => ({
  getLogStorageDiagnostics: mockGetLogStorageDiagnostics,
  getServerDiagnostics: mockGetServerDiagnostics,
  getWindowsStartupDiagnostics: mockGetWindowsStartupDiagnostics,
}));

vi.mock("@/lib/crashReporting", () => ({
  applyCrashReportingSettings: mockApplyCrashReportingSettings,
}));

vi.mock("@/lib/crashDiagnostic", () => {
  const defaultCrashReportingConfig = {
    enabled: false,
    dsn: null,
    environment: "production",
    sample_rate: 1,
    send_pii: false,
  };

  return {
    buildCrashDiagnosticPayload: mockBuildCrashDiagnosticPayload,
    collectRuntimeSnapshotForDiagnostic:
      mockCollectRuntimeSnapshotForDiagnostic,
    collectGeneralWorkbenchDocumentStateForDiagnostic:
      mockCollectGeneralWorkbenchDocumentStateForDiagnostic,
    copyCrashDiagnosticJsonToClipboard: mockCopyCrashDiagnosticJsonToClipboard,
    copyCrashDiagnosticToClipboard: mockCopyCrashDiagnosticToClipboard,
    DEFAULT_CRASH_REPORTING_CONFIG: defaultCrashReportingConfig,
    exportCrashDiagnosticToJson: mockExportCrashDiagnosticToJson,
    isClipboardPermissionDeniedError: mockIsClipboardPermissionDeniedError,
    normalizeCrashReportingConfig: mockNormalizeCrashReportingConfig,
    openCrashDiagnosticDownloadDirectory:
      mockOpenCrashDiagnosticDownloadDirectory,
  };
});

vi.mock("@/components/smart-input/ShortcutSettings", () => ({
  ShortcutSettings: () => <div>快捷键设置占位</div>,
}));

vi.mock("./UpdateCheckSettings", () => ({
  UpdateCheckSettings: () => <div>更新设置占位</div>,
}));

vi.mock("../shared/ClipboardPermissionGuideCard", () => ({
  ClipboardPermissionGuideCard: () => <div>剪贴板权限占位</div>,
}));

vi.mock("../shared/WorkspaceRepairHistoryCard", () => ({
  WorkspaceRepairHistoryCard: () => <div>工作区自愈占位</div>,
}));

import { ExperimentalSettings } from ".";

interface Mounted {
  container: HTMLDivElement;
  root: Root;
}

const mounted: Mounted[] = [];

function renderComponent(): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<ExperimentalSettings />);
  });

  mounted.push({ container, root });
  return container;
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function waitForLoad() {
  await flushEffects();
  await flushEffects();
  await flushEffects();
}

function getText(container: HTMLElement): string {
  return (container.textContent ?? "").replace(/\s+/g, " ").trim();
}

function getBodyText() {
  return document.body.textContent ?? "";
}

function findSwitchByLabel(
  container: HTMLElement,
  ariaLabel: string,
): HTMLButtonElement {
  const switchButton = container.querySelector<HTMLButtonElement>(
    `button[aria-label="${ariaLabel}"]`,
  );
  if (!switchButton) {
    throw new Error(`未找到开关: ${ariaLabel}`);
  }
  return switchButton;
}

async function clickButton(button: HTMLButtonElement) {
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushEffects();
  });
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)",
  });

  vi.clearAllMocks();

  mockGetExperimentalConfig.mockResolvedValue({
    screenshot_chat: {
      enabled: false,
      shortcut: "CommandOrControl+Alt+Q",
    },
    webmcp: {
      enabled: false,
    },
  });
  mockSaveExperimentalConfig.mockResolvedValue(undefined);
  mockUpdateScreenshotShortcut.mockResolvedValue(undefined);
  mockValidateShortcut.mockResolvedValue(true);

  mockGetConfig.mockResolvedValue({
    tool_calling: {
      enabled: true,
      dynamic_filtering: true,
      native_input_examples: false,
    },
    crash_reporting: {
      enabled: false,
      dsn: null,
      environment: "production",
      sample_rate: 1,
      send_pii: false,
    },
  });
  mockSaveConfig.mockResolvedValue(undefined);

  mockNormalizeCrashReportingConfig.mockImplementation((config) => ({
    enabled: config?.enabled ?? false,
    dsn: config?.dsn ?? null,
    environment: config?.environment ?? "production",
    sample_rate: config?.sample_rate ?? 1,
    send_pii: config?.send_pii ?? false,
  }));
  mockIsClipboardPermissionDeniedError.mockReturnValue(false);
  mockApplyCrashReportingSettings.mockResolvedValue(undefined);

  mockGetLogs.mockResolvedValue([]);
  mockGetPersistedLogsTail.mockResolvedValue([]);
  mockGetServerDiagnostics.mockResolvedValue(null);
  mockGetLogStorageDiagnostics.mockResolvedValue(null);
  mockGetWindowsStartupDiagnostics.mockResolvedValue(null);
  mockCollectRuntimeSnapshotForDiagnostic.mockResolvedValue({
    collectionNotes: [],
    runtimeSnapshot: null,
  });
  mockCollectGeneralWorkbenchDocumentStateForDiagnostic.mockResolvedValue(null);
  mockBuildCrashDiagnosticPayload.mockReturnValue({});
  mockCopyCrashDiagnosticToClipboard.mockResolvedValue(undefined);
  mockCopyCrashDiagnosticJsonToClipboard.mockResolvedValue(undefined);
  mockExportCrashDiagnosticToJson.mockReturnValue({
    fileName: "diagnostic.json",
    locationHint: "/tmp",
  });
  mockOpenCrashDiagnosticDownloadDirectory.mockResolvedValue({
    openedPath: "/tmp",
  });
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

describe("ExperimentalSettings", () => {
  it("应移除空洞头部与占位实验能力文案", async () => {
    const container = renderComponent();
    await waitForLoad();

    const text = getText(container);
    expect(text).not.toContain("EXPERIMENT LAB");
    expect(text).not.toContain(
      "把还在试验中的能力统一放到一处管理，但不要把风险提示藏起来",
    );
    expect(text).not.toContain("更多实验功能即将推出");
    expect(text).toContain("实验功能");
    expect(text).toContain("不稳定能力集中开关，用完及时关回。");
    expect(text).toContain("Tool Calling 2.0");
    expect(text).toContain("截图对话");
    expect(text).not.toContain("当前空闲");
  });

  it("应直接移除实验页冗余说明和状态噪音", async () => {
    const container = renderComponent();
    await waitForLoad();

    expect(getBodyText()).not.toContain(
      "集中管理仍在验证阶段的功能开关和诊断能力，保持风险可见，同时避免说明区压过真正的配置面板。",
    );
    expect(getBodyText()).not.toContain("控制编程式工具调用与动态过滤链路。");
    expect(getBodyText()).not.toContain(
      "控制编程式工具调用、动态过滤和 input examples 透传。",
    );
    expect(getBodyText()).not.toContain("这部分更适合用于调优复杂工具调用链路");
    expect(getBodyText()).not.toContain("诊断动作：4 项");
    expect(getBodyText()).not.toContain("先做小范围验证");
    expect(getBodyText()).not.toContain("排障时减少变量");
    expect(getBodyText()).not.toContain("需要复现场景时先清理旧样本");
    expect(
      container.querySelector(`button[aria-label='实验功能总览说明']`),
    ).toBeNull();
    expect(
      container.querySelector(`button[aria-label='Tool Calling说明']`),
    ).toBeNull();
  });

  it("应继续渲染后置加载的实验辅助区块", async () => {
    const container = renderComponent();
    await waitForLoad();

    const text = getText(container);
    expect(text).toContain("更新设置占位");
    expect(text).toContain("工作区自愈占位");
    expect(text).not.toContain("语音设置占位");
  });

  it("应展示默认关闭的 WebMCP 预留开关", async () => {
    const container = renderComponent();
    await waitForLoad();

    const text = getText(container);
    expect(text).toContain("WebMCP（预留）");
    expect(text).not.toContain("当前默认关闭，不参与实际执行链");
    expect(text).toContain("仅保留配置位，当前不切换执行链。");
    expect(text).toContain("开启后只写入配置，不改变浏览器执行路径。");
    expect(text).not.toContain("现阶段浏览器业务仍走 Bridge / CDP 主线");

    const switchButton = findSwitchByLabel(container, "切换 WebMCP 预留入口");
    expect(switchButton.getAttribute("aria-checked")).toBe("false");
  });

  it("切换 WebMCP 开关时应写回实验配置", async () => {
    const container = renderComponent();
    await waitForLoad();

    await clickButton(findSwitchByLabel(container, "切换 WebMCP 预留入口"));
    await waitForLoad();

    expect(mockSaveExperimentalConfig).toHaveBeenCalledTimes(1);
    expect(mockSaveExperimentalConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        screenshot_chat: expect.objectContaining({
          enabled: false,
          shortcut: "CommandOrControl+Alt+Q",
        }),
        webmcp: {
          enabled: true,
        },
      }),
    );
    expect(getText(container)).toContain("WebMCP 预留入口已启用");
  });
});
