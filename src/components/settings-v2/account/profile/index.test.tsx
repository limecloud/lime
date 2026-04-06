import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetConfig, mockSaveConfig } = vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
  mockSaveConfig: vi.fn(),
}));

vi.mock("@/lib/api/appConfig", () => ({
  getConfig: mockGetConfig,
  saveConfig: mockSaveConfig,
}));

import { ProfileSettings } from ".";

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
    root.render(<ProfileSettings />);
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

function findInput(container: HTMLElement, id: string): HTMLInputElement {
  const element = container.querySelector<HTMLInputElement>(`#${id}`);
  if (!element) {
    throw new Error(`未找到输入框: ${id}`);
  }
  return element;
}

function findButtonByLabel(
  container: HTMLElement,
  label: string,
): HTMLButtonElement {
  const element = container.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
  if (!element) {
    throw new Error(`未找到按钮: ${label}`);
  }
  return element;
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

  vi.clearAllMocks();

  mockGetConfig.mockResolvedValue({
    default_provider: "openai",
    user_profile: {
      nickname: "张三",
      bio: "专注 AI 产品与工程效率，喜欢把复杂流程做得更顺手。",
      email: "zhangsan@example.com",
      tags: ["编程", "设计"],
    },
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

describe("ProfileSettings", () => {
  it("应加载并渲染新的资料摘要与偏好区域", async () => {
    const container = renderComponent();
    await waitForLoad();

    const text = container.textContent ?? "";
    expect(text).toContain("PROFILE SNAPSHOT");
    expect(text).toContain("张三");
    expect(text).toContain("专注 AI 产品与工程效率");
    expect(text).toContain("资料完成度");
    expect(text).toContain("偏好标签");
    expect(text).toContain("编程");
    expect(text).toContain("设计");
  });

  it("编辑昵称后应保存完整资料", async () => {
    const container = renderComponent();
    await waitForLoad();

    await clickButton(findButtonByLabel(container, "编辑昵称"));
    await setInputValue(findInput(container, "profile-field-nickname"), "李四");
    await clickButton(findButtonByLabel(container, "保存昵称"));

    expect(mockSaveConfig).toHaveBeenCalledTimes(1);
    expect(mockSaveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        default_provider: "openai",
        user_profile: expect.objectContaining({
          nickname: "李四",
          bio: "专注 AI 产品与工程效率，喜欢把复杂流程做得更顺手。",
          email: "zhangsan@example.com",
          tags: ["编程", "设计"],
        }),
      }),
    );
  });

  it("昵称输入框应支持连续输入与清空", async () => {
    const container = renderComponent();
    await waitForLoad();

    await clickButton(findButtonByLabel(container, "编辑昵称"));

    await setInputValue(findInput(container, "profile-field-nickname"), "王五");
    expect(findInput(container, "profile-field-nickname").value).toBe("王五");

    await setInputValue(findInput(container, "profile-field-nickname"), "");
    expect(findInput(container, "profile-field-nickname").value).toBe("");

    await setInputValue(findInput(container, "profile-field-nickname"), "赵六");
    expect(findInput(container, "profile-field-nickname").value).toBe("赵六");
  });

  it("添加自定义标签后应写回配置", async () => {
    const container = renderComponent();
    await waitForLoad();

    await setInputValue(findInput(container, "profile-new-tag"), "效率工具");
    await clickButton(findButtonByText(container, "添加标签"));

    expect(mockSaveConfig).toHaveBeenCalledTimes(1);
    expect(mockSaveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        user_profile: expect.objectContaining({
          tags: ["编程", "设计", "效率工具"],
        }),
      }),
    );
  });

  it("应把字段说明和资料用途说明收进 tips", async () => {
    renderComponent();
    await waitForLoad();

    const nicknameTip = await hoverTip("昵称说明");
    expect(getBodyText()).toContain(
      "建议使用你最常用的称呼，便于系统在多处一致展示。",
    );
    await leaveTip(nicknameTip);

    const usageTip = await hoverTip("资料如何被使用说明");
    expect(getBodyText()).toContain(
      "标签只用于偏好判断，不会替代系统提示词，也不会自动暴露给外部服务。",
    );
    await leaveTip(usageTip);
  });
});
