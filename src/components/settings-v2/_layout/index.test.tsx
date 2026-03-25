import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsTabs } from "@/types/settings";

const { mockResolveOemCloudRuntimeContext } = vi.hoisted(() => ({
  mockResolveOemCloudRuntimeContext: vi.fn(),
}));

vi.mock("./SettingsSidebar", () => ({
  SettingsSidebar: () => <div data-testid="settings-sidebar">sidebar</div>,
}));

vi.mock(
  "@/components/content-creator/canvas/shared/CanvasBreadcrumbHeader",
  () => ({
    CanvasBreadcrumbHeader: ({ label }: { label: string }) => (
      <div>{label}</div>
    ),
  }),
);

vi.mock("../general/appearance", () => ({
  AppearanceSettings: () => <div>appearance</div>,
}));
vi.mock("../general/memory", () => ({
  MemorySettings: () => <div>memory</div>,
}));
vi.mock("../system/security-performance", () => ({
  SecurityPerformanceSettings: () => <div>security</div>,
}));
vi.mock("../system/automation", () => ({
  AutomationSettings: () => <div>automation</div>,
}));
vi.mock("../system/execution-tracker", () => ({
  ExecutionTrackerSettings: () => <div>execution-tracker</div>,
}));
vi.mock("../system/experimental", () => ({
  ExperimentalSettings: () => <div>experimental</div>,
}));
vi.mock("../system/developer", () => ({
  DeveloperSettings: () => <div>developer</div>,
}));
vi.mock("../system/about", () => ({
  AboutSection: () => <div>about</div>,
}));
vi.mock("../agent/skills", () => ({
  ExtensionsSettings: () => <div>skills</div>,
}));
vi.mock("../general/hotkeys", () => ({
  HotkeysSettings: () => <div>hotkeys</div>,
}));
vi.mock("../agent/media-services", () => ({
  MediaServicesSettings: () => <div>media-services</div>,
}));
vi.mock("../account/stats", () => ({
  StatsSettings: () => <div>stats</div>,
}));
vi.mock("../account/profile", () => ({
  ProfileSettings: () => <div>PROFILE_SETTINGS</div>,
}));
vi.mock("../account/user-center-session", () => ({
  UserCenterSessionSettings: () => <div>USER_CENTER_SESSION</div>,
}));
vi.mock("../agent/providers", () => ({
  CloudProviderSettings: () => <div>providers</div>,
}));
vi.mock("@/components/api-server/ApiServerPage", () => ({
  ApiServerPage: () => <div>api-server</div>,
}));
vi.mock("@/components/mcp", () => ({
  McpPanel: () => <div>mcp</div>,
}));
vi.mock("../system/channels", () => ({
  ChannelsSettings: () => <div>channels</div>,
}));
vi.mock("../system/environment", () => ({
  EnvironmentSettings: () => <div>environment</div>,
}));
vi.mock("../system/web-search", () => ({
  WebSearchSettings: () => <div>web-search</div>,
}));
vi.mock("../system/chrome-relay", () => ({
  ChromeRelaySettings: () => <div>chrome-relay</div>,
}));
vi.mock("../features/SettingHeader", () => ({
  SettingHeader: ({ title }: { title: string }) => <div>{title}</div>,
}));
vi.mock("../home", () => ({
  SettingsHomePage: () => <div>home</div>,
}));
vi.mock("@/lib/api/oemCloudRuntime", () => ({
  resolveOemCloudRuntimeContext: () => mockResolveOemCloudRuntimeContext(),
}));

import { SettingsLayoutV2 } from ".";

interface Mounted {
  container: HTMLDivElement;
  root: Root;
}

const mounted: Mounted[] = [];

function renderComponent(initialTab: SettingsTabs) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<SettingsLayoutV2 initialTab={initialTab} />);
  });

  mounted.push({ container, root });
  return container;
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  mockResolveOemCloudRuntimeContext.mockReturnValue({
    baseUrl: "https://user.example.com",
  });
});

afterEach(() => {
  vi.clearAllMocks();

  while (mounted.length > 0) {
    const current = mounted.pop();
    if (!current) {
      break;
    }

    act(() => {
      current.root.unmount();
    });
    current.container.remove();
  }
});

describe("SettingsLayoutV2 Profile Tab", () => {
  it("OEM 运行时下只展示统一账户页，不再渲染本地资料编辑器", () => {
    const container = renderComponent(SettingsTabs.Profile);
    const text = container.textContent ?? "";

    expect(text).toContain("账号与资料");
    expect(text).toContain("USER_CENTER_SESSION");
    expect(text).not.toContain("PROFILE_SETTINGS");
  });

  it("非 OEM 运行时下仍保留本地资料编辑器", () => {
    mockResolveOemCloudRuntimeContext.mockReturnValue(null);

    const container = renderComponent(SettingsTabs.Profile);
    const text = container.textContent ?? "";

    expect(text).toContain("个人资料");
    expect(text).toContain("USER_CENTER_SESSION");
    expect(text).toContain("PROFILE_SETTINGS");
  });
});
