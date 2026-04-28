import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RootRouter } from "./RootRouter";

const {
  mockFinalizeModuleImportAutoReload,
  mockGetRuntimeAppVersion,
  mockStartOemCloudStartupLoginIfRequired,
} = vi.hoisted(() => ({
  mockFinalizeModuleImportAutoReload: vi.fn(),
  mockGetRuntimeAppVersion: vi.fn(() => "0.0.0-test"),
  mockStartOemCloudStartupLoginIfRequired: vi.fn(),
}));

vi.mock("./App", () => ({
  default: () => <div data-testid="main-app">主应用</div>,
}));

vi.mock("./pages/smart-input", () => ({
  SmartInputPage: () => <div data-testid="smart-input-page" />,
}));

vi.mock("./pages/update-notification", () => ({
  UpdateNotificationPage: () => <div data-testid="update-notification-page" />,
}));

vi.mock("./pages", () => ({
  BrowserRuntimeDebuggerPage: () => (
    <div data-testid="browser-runtime-debugger-page" />
  ),
}));

vi.mock("./features/resource-manager", () => ({
  ResourceManagerPage: () => <div data-testid="resource-manager-page" />,
}));

vi.mock("./components/settings-v2/system/chrome-relay/guide-window", () => ({
  BrowserConnectorGuideWindow: () => (
    <div data-testid="browser-connector-guide-page" />
  ),
}));

vi.mock("./components/ui/sonner", () => ({
  Toaster: () => <div data-testid="toaster" />,
}));

vi.mock("./components/layout/AppCrashBoundary", () => ({
  AppCrashBoundary: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("./components/layout/CrashRecoveryPanel.helpers", () => ({
  finalizeModuleImportAutoReload: mockFinalizeModuleImportAutoReload,
}));

vi.mock("./lib/appVersion", () => ({
  getRuntimeAppVersion: mockGetRuntimeAppVersion,
}));

vi.mock("./lib/oemCloudStartupLogin", () => ({
  startOemCloudStartupLoginIfRequired:
    mockStartOemCloudStartupLoginIfRequired,
}));

interface MountedRootRouter {
  container: HTMLDivElement;
  root: Root;
}

const mounted: MountedRootRouter[] = [];

async function renderRootRouter(pathname: string) {
  window.history.pushState({}, "", pathname);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<RootRouter />);
    await Promise.resolve();
  });

  const page = { container, root };
  mounted.push(page);
  return page;
}

describe("RootRouter", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mockStartOemCloudStartupLoginIfRequired.mockResolvedValue({
      status: "not_configured",
    });
  });

  afterEach(() => {
    for (const item of mounted.splice(0)) {
      act(() => item.root.unmount());
      item.container.remove();
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("打开主应用时应触发启动期云端登录判断", async () => {
    const { container } = await renderRootRouter("/");

    expect(container.textContent).toContain("主应用");
    expect(mockStartOemCloudStartupLoginIfRequired).toHaveBeenCalledTimes(1);
  });

  it("独立工具窗口不应触发主应用登录流程", async () => {
    const { container } = await renderRootRouter("/smart-input");

    expect(
      container.querySelector('[data-testid="smart-input-page"]'),
    ).not.toBeNull();
    expect(mockStartOemCloudStartupLoginIfRequired).not.toHaveBeenCalled();
  });
});
