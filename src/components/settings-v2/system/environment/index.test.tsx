import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { SettingsDraftContext } from "../../_layout/useSettingsDraft";

const { mockGetConfig, mockGetEnvironmentPreview, mockUpdateConfig } =
  vi.hoisted(() => ({
    mockGetConfig: vi.fn(),
    mockGetEnvironmentPreview: vi.fn(),
    mockUpdateConfig: vi.fn(),
  }));

vi.mock("@/lib/api/appConfig", () => ({
  getConfig: mockGetConfig,
  getEnvironmentPreview: mockGetEnvironmentPreview,
  updateConfig: mockUpdateConfig,
}));

import { EnvironmentSettings } from ".";

interface Mounted {
  container: HTMLDivElement;
  root: Root;
}

const mounted: Mounted[] = [];

function renderComponent(
  register?: (state: { dirty: boolean; saving: boolean }) => () => void,
): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      register ? (
        <SettingsDraftContext.Provider value={register}>
          <EnvironmentSettings />
        </SettingsDraftContext.Provider>
      ) : (
        <EnvironmentSettings />
      ),
    );
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

beforeEach(async () => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  vi.clearAllMocks();
  await changeLimeLocale("en-US");

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

  mockUpdateConfig.mockImplementation(
    async (updater: (config: unknown) => unknown) =>
      updater({
        default_provider: "openai",
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
      }),
  );
});

afterEach(async () => {
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
  await changeLimeLocale("zh-CN");
});

describe("EnvironmentSettings", () => {
  it("应渲染新的环境变量总览与关键分区", async () => {
    const container = renderComponent();
    await waitForLoad();

    const text = container.textContent ?? "";
    expect(text).toContain("Environment Variables");
    expect(text).toContain("Shell Environment Import");
    expect(text).toContain("Environment Overrides");
    expect(text).toContain("Merge Rules");
    expect(text).toContain("Effective Preview");
    expect(text).toContain("Imported 5 variables from the Shell environment.");
    expect(text).not.toContain("settings.environment");
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

    await clickButton(findButton(container, "Add variable"));

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

    await clickButton(findButton(container, "Save and apply"));
    await waitForLoad();

    expect(mockUpdateConfig).toHaveBeenCalledTimes(1);
    const updater = mockUpdateConfig.mock.calls[0]?.[0] as (
      config: unknown,
    ) => { environment?: unknown };
    expect(
      updater({
        default_provider: "openai",
        environment: {
          shell_import: { enabled: true, timeout_ms: 1800 },
          variables: [
            {
              key: "OPENAI_BASE_URL",
              value: "https://old.example.com",
              enabled: true,
            },
          ],
        },
      }),
    ).toEqual(
      expect.objectContaining({
        environment: {
          shell_import: { enabled: true, timeout_ms: 2200 },
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

    await clickButton(findButton(container, "Show values"));

    expect(container.textContent).toContain("sk-live-secret-value");
    expect(container.textContent).toContain(
      "Overridden sources: Shell environment import",
    );
  });

  it("移除重复总览说明并保留字段的帮助信息", async () => {
    renderComponent();
    await waitForLoad();

    expect(getBodyText()).not.toContain(
      "Manage Shell imports, explicit overrides, and the final environment preview. Sensitive values stay masked by default to reduce accidental exposure in Settings.",
    );

    const fieldTip = await hoverTip("Import timeout details");
    expect(getBodyText()).toContain(
      "If the import times out, Lime falls back to explicit overrides only and does not block the runtime.",
    );
    await leaveTip(fieldTip);
  });

  it("存在环境草稿时应向设置根导航注册 dirty 状态", async () => {
    const register = vi.fn(() => () => undefined);
    const container = renderComponent(register);
    await waitForLoad();

    await setInputValue(
      findInput(container, "environment-variable-value-0"),
      "https://draft.example.com",
    );

    expect(register).toHaveBeenLastCalledWith({ dirty: true, saving: false });
  });

  it("保存失败时应保留环境草稿", async () => {
    const container = renderComponent();
    await waitForLoad();
    await setInputValue(
      findInput(container, "environment-variable-value-0"),
      "https://draft.example.com",
    );
    mockUpdateConfig.mockRejectedValueOnce(new Error("fixture failure"));

    await clickButton(findButton(container, "Save and apply"));

    expect(findInput(container, "environment-variable-value-0").value).toBe(
      "https://draft.example.com",
    );
    expect(container.textContent).toContain(
      "Failed to save environment settings",
    );
  });

  it("保存期间的新编辑不能被旧响应清除", async () => {
    const container = renderComponent();
    await waitForLoad();
    await setInputValue(
      findInput(container, "environment-variable-value-0"),
      "https://first.example.com",
    );

    let resolveUpdate!: (config: unknown) => void;
    mockUpdateConfig.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveUpdate = resolve;
      }),
    );
    await clickButton(findButton(container, "Save and apply"));
    await setInputValue(
      findInput(container, "environment-variable-value-0"),
      "https://second.example.com",
    );

    resolveUpdate({
      default_provider: "openai",
      environment: {
        shell_import: { enabled: true, timeout_ms: 2200 },
        variables: [
          {
            key: "OPENAI_BASE_URL",
            value: "https://first.example.com",
            enabled: true,
          },
        ],
      },
    });
    await waitForLoad();

    expect(findInput(container, "environment-variable-value-0").value).toBe(
      "https://second.example.com",
    );
  });
});
