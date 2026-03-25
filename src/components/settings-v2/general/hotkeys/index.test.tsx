import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetExperimentalConfig,
  mockGetVoiceInputConfig,
  mockGetHotkeyRuntimeStatus,
} = vi.hoisted(() => ({
  mockGetExperimentalConfig: vi.fn(),
  mockGetVoiceInputConfig: vi.fn(),
  mockGetHotkeyRuntimeStatus: vi.fn(),
}));

vi.mock("@/lib/api/experimentalFeatures", () => ({
  getExperimentalConfig: mockGetExperimentalConfig,
}));

vi.mock("@/lib/api/asrProvider", () => ({
  getVoiceInputConfig: mockGetVoiceInputConfig,
}));

vi.mock("@/lib/api/hotkeys", () => ({
  getHotkeyRuntimeStatus: mockGetHotkeyRuntimeStatus,
}));

import { HotkeysSettings } from ".";

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
    root.render(<HotkeysSettings />);
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

function findButtonByText(
  container: HTMLElement,
  text: string,
): HTMLButtonElement {
  const element = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent?.includes(text),
  );
  if (!element) {
    throw new Error(`未找到按钮文本: ${text}`);
  }
  return element as HTMLButtonElement;
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

  Object.defineProperty(window.navigator, "platform", {
    configurable: true,
    value: "MacIntel",
  });
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)",
  });

  vi.clearAllMocks();

  mockGetExperimentalConfig.mockResolvedValue({
    screenshot_chat: {
      enabled: true,
      shortcut: "CommandOrControl+Shift+4",
    },
  });

  mockGetVoiceInputConfig.mockResolvedValue({
    enabled: true,
    shortcut: "CommandOrControl+Shift+V",
    processor: {
      polish_enabled: true,
      default_instruction_id: "default",
    },
    output: {
      mode: "type",
      type_delay_ms: 0,
    },
    instructions: [],
    sound_enabled: true,
    translate_shortcut: "",
    translate_instruction_id: "",
  });

  mockGetHotkeyRuntimeStatus.mockResolvedValue({
    screenshot: {
      shortcut_registered: true,
      registered_shortcut: "CommandOrControl+Shift+4",
    },
    voice: {
      shortcut_registered: true,
      registered_shortcut: "CommandOrControl+Shift+V",
      translate_shortcut_registered: false,
      registered_translate_shortcut: null,
    },
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

describe("HotkeysSettings", () => {
  it("应渲染简化后的已审计快捷键布局与分区", async () => {
    const container = renderComponent();
    await waitForLoad();

    const text = getText(container);
    expect(text).toContain("已审计快捷键");
    expect(text).toContain("快捷键审计");
    expect(text).toContain("全局运行中 2 / 3");
    expect(text).toContain("运行时状态已连接");
    expect(text).toContain("终端页面");
    expect(text).toContain("共 10 项");
    expect(text).toContain("滚动到终端底部（macOS）");
    expect(text).toContain("海报画布");
  });

  it("运行时状态读取失败时应回退到配置判断", async () => {
    mockGetHotkeyRuntimeStatus.mockRejectedValueOnce(new Error("bridge down"));

    const container = renderComponent();
    await waitForLoad();

    const text = getText(container);
    expect(text).toContain("运行时状态不可读，已回退到配置判断");
    expect(text).toContain("全局运行中 2 / 3");
  });

  it("加载失败后应支持重试", async () => {
    mockGetExperimentalConfig
      .mockRejectedValueOnce(new Error("网络异常"))
      .mockResolvedValue({
        screenshot_chat: {
          enabled: true,
          shortcut: "CommandOrControl+Shift+4",
        },
      });

    const container = renderComponent();
    await waitForLoad();

    expect(getText(container)).toContain("加载快捷键失败：网络异常");

    await clickButton(findButtonByText(container, "重试"));
    await waitForLoad();

    expect(mockGetExperimentalConfig).toHaveBeenCalledTimes(2);
    expect(getText(container)).toContain("已审计快捷键");
  });

  it("应展示未启用、未注册和未绑定指令状态", async () => {
    mockGetExperimentalConfig.mockResolvedValue({
      screenshot_chat: {
        enabled: false,
        shortcut: "",
      },
    });
    mockGetVoiceInputConfig.mockResolvedValue({
      enabled: true,
      shortcut: "CommandOrControl+Shift+V",
      processor: {
        polish_enabled: true,
        default_instruction_id: "default",
      },
      output: {
        mode: "type",
        type_delay_ms: 0,
      },
      instructions: [],
      sound_enabled: true,
      translate_shortcut: "CommandOrControl+Shift+T",
      translate_instruction_id: "",
    });
    mockGetHotkeyRuntimeStatus.mockResolvedValue({
      screenshot: {
        shortcut_registered: false,
        registered_shortcut: null,
      },
      voice: {
        shortcut_registered: false,
        registered_shortcut: null,
        translate_shortcut_registered: false,
        registered_translate_shortcut: null,
      },
    });

    const container = renderComponent();
    await waitForLoad();

    const text = getText(container);
    expect(text).toContain("功能未启用");
    expect(text).toContain("未注册到系统");
    expect(text).toContain("未绑定翻译指令");
  });
});
