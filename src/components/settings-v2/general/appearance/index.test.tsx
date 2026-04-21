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
      enabled_items: [],
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
  it("应在同一页面中渲染基础外观、初始化恢复与推荐行为设置", async () => {
    const { container } = await renderPage();
    const text = container.textContent ?? "";
    const buttonTexts = Array.from(container.querySelectorAll("button")).map(
      (button) => button.textContent?.trim() ?? "",
    );

    expect(text).toContain("外观");
    expect(text).toContain("管理主题、语言、提示音效、推荐行为和隐藏入口。");
    expect(text).toContain("主题：跟随系统");
    expect(text).toContain("语言：中文");
    expect(text).toContain("提示音效：已开启");
    expect(text).toContain("基础外观");
    expect(text).toContain("主题模式");
    expect(text).toContain("界面语言");
    expect(text).toContain("隐藏系统入口");
    expect(text).toContain("插件中心");
    expect(text).toContain("OpenClaw");
    expect(text).toContain("桌宠");
    expect(text).toContain("推荐行为");
    expect(text).toContain("推荐自动附带选中内容");
    expect(text).toContain("重新运行引导");
    expect(text).not.toContain("已合并旧入口");
    expect(buttonTexts).not.toContain("设置");
  });

  it("切换推荐行为时应保留 workspace_preferences 的其他配置", async () => {
    const { container } = await renderPage();
    const switchButton = container.querySelector(
      'button[aria-label="切换推荐自动附带选中内容"]',
    );

    await act(async () => {
      switchButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const savedConfig = mockSaveConfig.mock.calls.at(-1)?.[0] as any;

    expect(
      savedConfig.chat_appearance.append_selected_text_to_recommendation,
    ).toBe(false);
    expect(
      savedConfig.workspace_preferences.media_defaults.voice
        .preferredProviderId,
    ).toBe("openai");
  });

  it("切换推荐行为时应写回完整的聊天外观配置", async () => {
    const { container } = await renderPage();
    const switchButton = container.querySelector(
      'button[aria-label="切换推荐自动附带选中内容"]',
    );

    await act(async () => {
      switchButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const savedConfig = mockSaveConfig.mock.calls.at(-1)?.[0] as any;

    expect(savedConfig.chat_appearance).toEqual(
      expect.objectContaining({
        append_selected_text_to_recommendation: false,
        showAvatar: false,
      }),
    );
  });

  it("应把首屏和基础外观说明收进 tips", async () => {
    await renderPage();

    expect(getBodyText()).not.toContain(
      "管理主题、语言、提示音效、推荐问题的上下文带入方式，以及隐藏系统入口的显示状态。",
    );
    expect(getBodyText()).not.toContain(
      "先确定全局主题、语言和声音反馈，再统一工作区里的视觉节奏。",
    );

    const heroTip = await hoverTip("外观设置总览说明");
    expect(getBodyText()).toContain(
      "管理主题、语言、提示音效、推荐问题的上下文带入方式，以及隐藏系统入口的显示状态。",
    );
    await leaveTip(heroTip);

    const sectionTip = await hoverTip("基础外观说明");
    expect(getBodyText()).toContain(
      "先确定全局主题、语言和声音反馈，再统一工作区里的视觉节奏。",
    );
    await leaveTip(sectionTip);
  });

  it("切换隐藏系统入口时应写回 navigation.enabled_items 并保留其他配置", async () => {
    const { container } = await renderPage();
    const switchButton = container.querySelector(
      'button[aria-label="切换显示插件中心入口"]',
    );

    await act(async () => {
      switchButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const savedConfig = mockSaveConfig.mock.calls.at(-1)?.[0] as any;

    expect(savedConfig.navigation.enabled_items).toEqual(["plugins"]);
    expect(
      savedConfig.workspace_preferences.media_defaults.voice
        .preferredProviderId,
    ).toBe("openai");
    expect(savedConfig.chat_appearance.showAvatar).toBe(false);
  });
});
