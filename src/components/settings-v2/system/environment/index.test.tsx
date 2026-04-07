import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetConfig, mockGetEnvironmentPreview, mockSaveConfig } = vi.hoisted(
  () => ({
    mockGetConfig: vi.fn(),
    mockGetEnvironmentPreview: vi.fn(),
    mockSaveConfig: vi.fn(),
  }),
);

vi.mock("@/lib/api/appConfig", () => ({
  getConfig: mockGetConfig,
  getEnvironmentPreview: mockGetEnvironmentPreview,
  saveConfig: mockSaveConfig,
}));

import { EnvironmentSettings } from ".";

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
    root.render(<EnvironmentSettings />);
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
    await flushEffects();
  });

  return trigger as HTMLButtonElement;
}

async function leaveTip(trigger: HTMLButtonElement | null) {
  await act(async () => {
    trigger?.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    await flushEffects();
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

function findInput(container: HTMLElement, id: string): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(`#${id}`);
  if (!input) {
    throw new Error(`未找到输入框: ${id}`);
  }
  return input;
}

async function clickButton(button: HTMLButtonElement) {
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushEffects();
  });
}

async function setInputValue(input: HTMLInputElement, value: string) {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  if (!nativeSetter) {
    throw new Error("未找到 input value setter");
  }

  await act(async () => {
    nativeSetter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
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

  mockGetConfig.mockResolvedValue({
    environment: {
      shell_import: {
        enabled: true,
        timeout_ms: 1800,
      },
      variables: [
        {
          key: "OPENAI_BASE_URL",
          value: "https://old.example.com",
          enabled: true,
        },
      ],
    },
  });

  mockGetEnvironmentPreview.mockResolvedValue({
    shellImport: {
      enabled: true,
      status: "ok",
      message: "已从登录 Shell 导入 PATH 与代理变量",
      importedCount: 5,
      durationMs: 42,
    },
    entries: [
      {
        key: "OPENAI_API_KEY",
        value: "sk-live-secret-value",
        maskedValue: "sk-live-***",
        source: "override",
        sourceLabel: "环境变量覆盖",
        sensitive: true,
        overriddenSources: ["shell_import"],
      },
      {
        key: "HTTP_PROXY",
        value: "http://127.0.0.1:7890",
        maskedValue: "http://127.0.0.1:7890",
        source: "shell_import",
        sourceLabel: "Shell 环境导入",
        sensitive: false,
        overriddenSources: [],
      },
    ],
  });

  mockSaveConfig.mockResolvedValue(undefined);
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

describe("EnvironmentSettings", () => {
  it("应渲染新的环境变量总览与关键分区", async () => {
    const container = renderComponent();
    await waitForLoad();

    const text = container.textContent ?? "";
    expect(text).toContain("ENVIRONMENT LAYER");
    expect(text).toContain("Shell 环境导入");
    expect(text).toContain("环境变量覆盖");
    expect(text).toContain("合并规则");
    expect(text).toContain("生效预览");
    expect(text).toContain("已从登录 Shell 导入 PATH 与代理变量");
    expect(findInput(container, "environment-variable-key-0").value).toBe(
      "OPENAI_BASE_URL",
    );
  });

  it("点击添加变量后应新增一条覆盖项", async () => {
    const container = renderComponent();
    await waitForLoad();

    expect(
      container.querySelectorAll('input[id^="environment-variable-key-"]')
        .length,
    ).toBe(1);

    await clickButton(findButton(container, "添加变量"));

    expect(
      container.querySelectorAll('input[id^="environment-variable-key-"]')
        .length,
    ).toBe(2);

    expect(findInput(container, "environment-variable-key-1").value).toBe("");
    expect(findInput(container, "environment-variable-value-1").value).toBe("");
  });

  it("修改覆盖项后应调用保存接口", async () => {
    const container = renderComponent();
    await waitForLoad();

    await setInputValue(
      findInput(container, "environment-variable-key-0"),
      "OPENAI_API_BASE",
    );
    await setInputValue(
      findInput(container, "environment-variable-value-0"),
      "https://override.example.com",
    );
    await setInputValue(
      findInput(container, "environment-shell-import-timeout"),
      "2200",
    );

    await clickButton(findButton(container, "保存并应用"));
    await waitForLoad();

    expect(mockSaveConfig).toHaveBeenCalledTimes(1);
    expect(mockSaveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: {
          shell_import: {
            enabled: true,
            timeout_ms: 2200,
          },
          variables: [
            {
              key: "OPENAI_API_BASE",
              value: "https://override.example.com",
              enabled: true,
            },
          ],
        },
      }),
    );
  });

  it("应在预览区支持敏感值显隐切换", async () => {
    const container = renderComponent();
    await waitForLoad();

    expect(container.textContent).toContain("sk-live-***");
    expect(container.textContent).not.toContain("sk-live-secret-value");

    await clickButton(findButton(container, "显示值"));

    expect(container.textContent).toContain("sk-live-secret-value");
    expect(container.textContent).toContain("已覆盖来源：Shell 环境导入");
  });

  it("应把首屏说明和字段 hint 收进 tips", async () => {
    renderComponent();
    await waitForLoad();

    expect(getBodyText()).not.toContain(
      "这里把 Shell 导入、显式覆盖和运行时预览放在同一个工作区里，减少分散配置。敏感值默认保持掩码，避免在设置页里意外暴露。",
    );

    const heroTip = await hoverTip("环境变量设置总览说明");
    expect(getBodyText()).toContain(
      "这里把 Shell 导入、显式覆盖和运行时预览放在同一个工作区里，减少分散配置。敏感值默认保持掩码，避免在设置页里意外暴露。",
    );
    await leaveTip(heroTip);

    const fieldTip = await hoverTip("导入超时（ms）说明");
    expect(getBodyText()).toContain(
      "超时后会回退为仅使用显式覆盖，不阻塞整体运行。",
    );
    await leaveTip(fieldTip);
  });
});
