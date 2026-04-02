import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsTabs } from "@/types/settings";

const { mockSettingsSidebar, mockPreloadDeveloperDefaultSections } =
  vi.hoisted(() => ({
    mockSettingsSidebar: vi.fn(),
    mockPreloadDeveloperDefaultSections: vi.fn(),
  }));

const { mockResolveOemCloudRuntimeContext } = vi.hoisted(() => ({
  mockResolveOemCloudRuntimeContext: vi.fn(),
}));

vi.mock("./SettingsSidebar", () => ({
  SettingsSidebar: (props: unknown) => {
    mockSettingsSidebar(props);
    return <div data-testid="settings-sidebar">sidebar</div>;
  },
}));

vi.mock(
  "@/lib/workspace/workbenchUi",
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
vi.mock("../system/developer/preload", () => ({
  preloadDeveloperDefaultSections: mockPreloadDeveloperDefaultSections,
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

function renderComponent(
  initialTab: SettingsTabs,
  onNavigate?: (page: string) => void,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <SettingsLayoutV2
        initialTab={initialTab}
        onNavigate={onNavigate as any}
      />,
    );
  });

  mounted.push({ container, root });
  return container;
}

async function flushEffects(times = 6) {
  await act(async () => {
    for (let index = 0; index < times; index += 1) {
      await Promise.resolve();
    }
  });
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
  mockSettingsSidebar.mockReset();
  mockPreloadDeveloperDefaultSections.mockReset();

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
  it("OEM 运行时下只展示统一账户页，不再渲染本地资料编辑器，也不再注入壳层标题", async () => {
    const container = renderComponent(SettingsTabs.Profile);
    await flushEffects();
    const text = container.textContent ?? "";

    expect(text).toContain("USER_CENTER_SESSION");
    expect(text).not.toContain("PROFILE_SETTINGS");
    expect(text).not.toContain("账号与资料");
  });

  it("非 OEM 运行时下仍保留本地资料编辑器，但不再显示重复页头", async () => {
    mockResolveOemCloudRuntimeContext.mockReturnValue(null);

    const container = renderComponent(SettingsTabs.Profile);
    await flushEffects();
    const text = container.textContent ?? "";

    expect(text).toContain("USER_CENTER_SESSION");
    expect(text).toContain("PROFILE_SETTINGS");
    expect(text).not.toContain("个人资料");
  });
});

describe("SettingsLayoutV2 Channels Redirect", () => {
  it("旧的设置渠道入口应跳转到能力里的 IM 配置", async () => {
    const onNavigate = vi.fn();

    renderComponent(SettingsTabs.Channels, onNavigate);
    await flushEffects();

    expect(onNavigate).toHaveBeenCalledWith("channels");
  });
});

describe("SettingsLayoutV2 Experimental Tab", () => {
  it("实验功能页应直接展示内容，不再复用壳层设置页标题", async () => {
    const container = renderComponent(SettingsTabs.Experimental);
    await flushEffects();
    const text = container.textContent ?? "";

    expect(text).toContain("experimental");
    expect(text).not.toContain("实验功能");
  });
});

describe("SettingsLayoutV2 Developer Tab", () => {
  it("开发者页应直接展示内容，不再复用壳层设置页标题", async () => {
    const container = renderComponent(SettingsTabs.Developer);
    await flushEffects();
    const text = container.textContent ?? "";

    expect(text).toContain("developer");
    expect(text).not.toContain("开发者");
  });

  it("设置内容区应挂载统一氛围层，避免页面背景过于单调", async () => {
    const container = renderComponent(SettingsTabs.Providers);
    await flushEffects();

    expect(
      container.querySelector('[data-testid="settings-content-atmosphere"]'),
    ).not.toBeNull();
  });

  it("预取开发者页时应连同延迟区块一起预热", async () => {
    renderComponent(SettingsTabs.Home);
    const sidebarProps = mockSettingsSidebar.mock.calls[0]?.[0] as
      | {
          onTabPrefetch?: (tab: SettingsTabs) => void;
        }
      | undefined;

    expect(sidebarProps?.onTabPrefetch).toBeTypeOf("function");

    await act(async () => {
      sidebarProps?.onTabPrefetch?.(SettingsTabs.Developer);
      await flushEffects();
    });

    expect(mockPreloadDeveloperDefaultSections).toHaveBeenCalledTimes(1);
  });
});
