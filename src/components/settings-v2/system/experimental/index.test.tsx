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

const { mockGetVoiceInputConfig, mockSaveVoiceInputConfig } = vi.hoisted(
  () => ({
    mockGetVoiceInputConfig: vi.fn(),
    mockSaveVoiceInputConfig: vi.fn(),
  }),
);

const { mockApplyCrashReportingSettings } = vi.hoisted(() => ({
  mockApplyCrashReportingSettings: vi.fn(),
}));

const {
  mockBuildCrashDiagnosticPayload,
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
  mockCollectRuntimeSnapshotForDiagnostic: vi.fn(),
  mockCollectThemeWorkbenchDocumentStateForDiagnostic: vi.fn(),
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

vi.mock("@/lib/api/asrProvider", () => ({
  getVoiceInputConfig: mockGetVoiceInputConfig,
  saveVoiceInputConfig: mockSaveVoiceInputConfig,
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
    collectThemeWorkbenchDocumentStateForDiagnostic:
      mockCollectThemeWorkbenchDocumentStateForDiagnostic,
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

vi.mock("@/components/voice", () => ({
  VoiceSettings: () => <div>语音设置占位</div>,
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

  mockGetVoiceInputConfig.mockResolvedValue({
    enabled: false,
    shortcut: "CommandOrControl+Shift+V",
    processor: {
      polish_enabled: true,
      default_instruction_id: "default",
    },
    output: {
      mode: "type",
      type_delay_ms: 10,
    },
    instructions: [],
    sound_enabled: true,
    translate_instruction_id: "default",
  });
  mockSaveVoiceInputConfig.mockResolvedValue(undefined);

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
  mockCollectThemeWorkbenchDocumentStateForDiagnostic.mockResolvedValue(null);
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
    expect(text).toContain("Tool Calling");
    expect(text).toContain("当前空闲");
  });

  it("应继续渲染后置加载的实验辅助区块", async () => {
    const container = renderComponent();
    await waitForLoad();

    const text = getText(container);
    expect(text).toContain("更新设置占位");
    expect(text).toContain("语音设置占位");
    expect(text).toContain("工作区自愈占位");
  });

  it("应展示默认关闭的 WebMCP 预留开关", async () => {
    const container = renderComponent();
    await waitForLoad();

    const text = getText(container);
    expect(text).toContain("WebMCP（预留）");
    expect(text).toContain("当前默认关闭，不参与实际执行链");
    expect(text).toContain("现阶段浏览器业务仍走 Bridge / CDP 主线");

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
