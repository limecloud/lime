import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetConfig = vi.fn();
const mockSaveConfig = vi.fn();
const mockSetLanguage = vi.fn();
const mockSetSoundEnabled = vi.fn();
const mockPlayToolcallSound = vi.fn();
const mockResetOnboarding = vi.fn();

vi.mock("@/lib/api/appConfig", () => ({
  getConfig: () => mockGetConfig(),
  saveConfig: (config: unknown) => mockSaveConfig(config),
}));

vi.mock("@/i18n/I18nPatchProvider", () => ({
  useI18nPatch: () => ({
    setLanguage: mockSetLanguage,
  }),
}));

vi.mock("@/contexts/useSoundContext", () => ({
  useSoundContext: () => ({
    soundEnabled: true,
    setSoundEnabled: mockSetSoundEnabled,
    playToolcallSound: mockPlayToolcallSound,
  }),
}));

vi.mock("@/components/onboarding", () => ({
  useOnboardingState: () => ({
    resetOnboarding: mockResetOnboarding,
  }),
}));

import { AppearanceSettings } from "./index";

interface RenderResult {
  container: HTMLDivElement;
  root: Root;
}

const mounted: RenderResult[] = [];

function createMockConfig() {
  return {
    language: "zh",
    workspace_preferences: {
      media_defaults: {
        voice: {
          preferredProviderId: "openai",
        },
      },
    },
    navigation: {
      enabled_items: ["home-general"],
    },
    chat_appearance: {
      append_selected_text_to_recommendation: true,
      showAvatar: false,
    },
  } as any;
}

async function renderPage() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<AppearanceSettings />);
  });

  await act(async () => {
    await Promise.resolve();
  });

  const rendered = { container, root };
  mounted.push(rendered);
  return rendered;
}

function getBodyText() {
  return document.body.textContent ?? "";
}

async function hoverTip(ariaLabel: string) {
  const trigger = document.body.querySelector(
    `button[aria-label='${ariaLabel}']`,
  );
  expect(trigger).toBeInstanceOf(HTMLButtonElement);

  await act(async () => {
    trigger?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await Promise.resolve();
  });

  return trigger as HTMLButtonElement;
}

async function leaveTip(trigger: HTMLButtonElement | null) {
  await act(async () => {
    trigger?.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    await Promise.resolve();
  });
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
      matchMedia?: typeof window.matchMedia;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  globalThis.matchMedia =
    globalThis.matchMedia ||
    (((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as typeof window.matchMedia);

  localStorage.clear();
  mockGetConfig.mockResolvedValue(createMockConfig());
  mockSaveConfig.mockResolvedValue(undefined);
});

afterEach(() => {
  mockGetConfig.mockReset();
  mockSaveConfig.mockReset();
  mockSetLanguage.mockReset();
  mockSetSoundEnabled.mockReset();
  mockPlayToolcallSound.mockReset();
  mockResetOnboarding.mockReset();

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
});

describe("AppearanceSettings", () => {
  it("应在同一页面中渲染基础外观、侧栏入口与推荐行为设置", async () => {
    const { container } = await renderPage();
    const text = container.textContent ?? "";
    const buttonTexts = Array.from(container.querySelectorAll("button")).map(
      (button) => button.textContent?.trim() ?? "",
    );

    expect(text).toContain("外观");
    expect(text).toContain("管理主题、语言、导航入口和推荐行为。");
    expect(text).toContain("主题：跟随系统");
    expect(text).toContain("语言：中文");
    expect(text).toContain("提示音效：已开启");
    expect(text).toContain("基础外观");
    expect(text).toContain("主题模式");
    expect(text).toContain("界面语言");
    expect(text).toContain("主导航入口与推荐行为");
    expect(text).toContain("左侧边栏导航");
    expect(text).toContain("主导航入口");
    expect(text).toContain("系统入口");
    expect(text).toContain(
      "核心入口固定显示：新建任务、任务中心、我的方法、场景应用、消息渠道、资料库、灵感库",
    );
    expect(text).toContain("推荐行为");
    expect(text).toContain("OpenClaw");
    expect(text).toContain("资料库");
    expect(text).toContain("灵感库");
    expect(text).toContain("推荐自动附带选中内容");
    expect(text).toContain("重新运行引导");
    expect(text).not.toContain("已合并旧入口");
    expect(buttonTexts).not.toContain("设置");
  });

  it("切换底部入口时应保留 workspace_preferences 的其他配置", async () => {
    const { container } = await renderPage();
    const button = Array.from(container.querySelectorAll("button")).find(
      (item) => item.textContent?.includes("插件中心"),
    );

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const savedConfig = mockSaveConfig.mock.calls.at(-1)?.[0] as any;

    expect(savedConfig.navigation.enabled_items).toEqual(["plugins"]);
    expect(
      savedConfig.workspace_preferences.media_defaults.voice
        .preferredProviderId,
    ).toBe("openai");
  });

  it("切换底部入口时应保存完整的侧栏导航配置", async () => {
    const { container } = await renderPage();
    const button = Array.from(container.querySelectorAll("button")).find(
      (item) => item.textContent?.includes("插件中心"),
    );

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const savedConfig = mockSaveConfig.mock.calls.at(-1)?.[0] as any;

    expect(savedConfig.navigation.enabled_items).toEqual(["plugins"]);
  });

  it("缺少导航配置时应回退到底部默认入口", async () => {
    mockGetConfig.mockResolvedValue({
      language: "zh",
      chat_appearance: {
        append_selected_text_to_recommendation: true,
      },
    });

    const { container } = await renderPage();
    const button = Array.from(container.querySelectorAll("button")).find(
      (item) => item.textContent?.includes("插件中心"),
    );

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const savedConfig = mockSaveConfig.mock.calls.at(-1)?.[0] as any;

    expect(savedConfig.navigation.enabled_items).toEqual(["plugins"]);
  });

  it("应允许把所有可选侧栏入口恢复为默认隐藏", async () => {
    mockGetConfig.mockResolvedValue({
      ...createMockConfig(),
      navigation: {
        enabled_items: ["plugins"],
      },
    });

    const { container } = await renderPage();
    const button = Array.from(container.querySelectorAll("button")).find(
      (item) => item.textContent?.includes("插件中心"),
    );

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const savedConfig = mockSaveConfig.mock.calls.at(-1)?.[0] as any;

    expect(savedConfig.navigation.enabled_items).toEqual([]);
  });

  it("应把首屏和基础外观说明收进 tips", async () => {
    await renderPage();

    expect(getBodyText()).not.toContain(
      "管理主题、语言、提示音效，以及左侧导航入口和推荐行为。",
    );
    expect(getBodyText()).not.toContain(
      "先确定全局主题、语言和声音反馈，再统一工作区里的视觉节奏。",
    );

    const heroTip = await hoverTip("外观设置总览说明");
    expect(getBodyText()).toContain(
      "管理主题、语言、提示音效，以及左侧导航入口和推荐行为。",
    );
    await leaveTip(heroTip);

    const sectionTip = await hoverTip("基础外观说明");
    expect(getBodyText()).toContain(
      "先确定全局主题、语言和声音反馈，再统一工作区里的视觉节奏。",
    );
    await leaveTip(sectionTip);
  });
});
