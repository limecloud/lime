import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCrashRecoveryReloadUrl,
  isModuleImportFailureErrorMessage,
} from "./CrashRecoveryPanel.helpers";

vi.mock("@/lib/api/appConfig", () => ({
  getConfig: vi.fn(async () => null),
}));

vi.mock("@/lib/api/logs", () => ({
  getLogs: vi.fn(async () => []),
  getPersistedLogsTail: vi.fn(async () => []),
}));

vi.mock("@/lib/crashDiagnostic", () => ({
  buildCrashDiagnosticPayload: vi.fn(() => ({})),
  clearCrashDiagnosticHistory: vi.fn(async () => undefined),
  collectThemeWorkbenchDocumentStateForDiagnostic: vi.fn(async () => null),
  CLEAR_CRASH_DIAGNOSTIC_HISTORY_CONFIRM_TEXT: "confirm",
  copyCrashDiagnosticJsonToClipboard: vi.fn(async () => undefined),
  copyCrashDiagnosticToClipboard: vi.fn(async () => undefined),
  exportCrashDiagnosticToJson: vi.fn(() => ({
    fileName: "diagnostic.json",
    locationHint: "Downloads",
  })),
  isClipboardPermissionDeniedError: vi.fn(() => false),
  normalizeCrashReportingConfig: vi.fn(() => null),
  openCrashDiagnosticDownloadDirectory: vi.fn(async () => ({
    openedPath: "/tmp",
  })),
}));

vi.mock("@/lib/api/project", () => ({
  getProjectByRootPath: vi.fn(async () => null),
  updateProject: vi.fn(async () => undefined),
}));

vi.mock(
  "@/components/settings-v2/system/shared/ClipboardPermissionGuideCard",
  () => ({
    ClipboardPermissionGuideCard: ({
      className,
    }: {
      className?: string;
    }) => <div className={className}>clipboard-guide</div>,
  }),
);

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(async () => null),
}));

vi.mock("@/components/workspace/services/runtimeAgentsGuideService", () => ({
  notifyProjectRuntimeAgentsGuide: vi.fn(),
}));

import { CrashRecoveryPanel } from "./CrashRecoveryPanel";

interface RenderResult {
  container: HTMLDivElement;
  root: Root;
}

const mounted: RenderResult[] = [];

function renderPanel(error: Error | null) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <CrashRecoveryPanel
        error={error}
        componentStack=""
        onRetry={vi.fn()}
      />,
    );
  });

  const rendered = { container, root };
  mounted.push(rendered);
  return rendered;
}

describe("CrashRecoveryPanel", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });

  afterEach(() => {
    while (mounted.length > 0) {
      const target = mounted.pop();
      if (!target) {
        continue;
      }
      act(() => {
        target.root.unmount();
      });
      target.container.remove();
    }

    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("应识别模块脚本导入失败错误", () => {
    expect(
      isModuleImportFailureErrorMessage("Importing a module script failed."),
    ).toBe(true);
    expect(
      isModuleImportFailureErrorMessage(
        "Failed to fetch dynamically imported module: /src/app.tsx",
      ),
    ).toBe(true);
    expect(isModuleImportFailureErrorMessage("Random render error")).toBe(
      false,
    );
  });

  it("应为强制刷新资源构造带缓存刷新参数的地址", () => {
    expect(
      buildCrashRecoveryReloadUrl(
        "http://127.0.0.1:1420/settings",
        "123456",
      ),
    ).toBe(
      "http://127.0.0.1:1420/settings?__lime_resource_reload=123456",
    );

    const reloadUrl = buildCrashRecoveryReloadUrl(
      "http://127.0.0.1:1420/settings?tab=providers",
      "654321",
    );
    expect(reloadUrl).toContain("tab=providers");
    expect(reloadUrl).toContain("__lime_resource_reload=654321");
  });

  it("模块导入失败时应展示强制刷新资源入口", () => {
    const { container } = renderPanel(
      new Error("Importing a module script failed."),
    );
    const text = container.textContent ?? "";

    expect(text).toContain("强制刷新资源");
    expect(text).toContain("仅重试恢复");
    expect(text).toContain("node_modules/.vite-tauri");
  });
});
