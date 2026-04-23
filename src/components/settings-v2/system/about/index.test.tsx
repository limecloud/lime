import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockCheckForUpdates, mockDownloadUpdate } = vi.hoisted(() => ({
  mockCheckForUpdates: vi.fn(),
  mockDownloadUpdate: vi.fn(),
}));

vi.mock("@/lib/api/appUpdate", () => ({
  checkForUpdates: mockCheckForUpdates,
  downloadUpdate: mockDownloadUpdate,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: unknown) => {
      if (typeof options === "string") {
        return options;
      }

      if (options && typeof options === "object") {
        const values = options as Record<string, unknown>;
        const template =
          typeof values.defaultValue === "string" ? values.defaultValue : key;
        return template.replace(
          /\{\{(\w+)\}\}/g,
          (_, name: string) => String(values[name] ?? ""),
        );
      }

      return key;
    },
  }),
}));

import { AboutSection } from ".";

interface Mounted {
  container: HTMLDivElement;
  root: Root;
}

const mounted: Mounted[] = [];
let originalUserAgent: PropertyDescriptor | undefined;

function renderComponent() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<AboutSection />);
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
  const target = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent?.includes(text),
  );

  if (!target) {
    throw new Error(`未找到按钮: ${text}`);
  }

  return target as HTMLButtonElement;
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  vi.clearAllMocks();
  originalUserAgent = Object.getOwnPropertyDescriptor(
    window.navigator,
    "userAgent",
  );
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  });

  mockCheckForUpdates.mockResolvedValue({
    current: "1.10.0",
    latest: "1.10.1",
    hasUpdate: true,
    downloadUrl: "https://example.com/lime",
    releaseNotes: "修复设置页视觉层级并优化更新体验。",
    pubDate: "2026-03-20T00:00:00.000Z",
    error: undefined,
  });
  mockDownloadUpdate.mockResolvedValue({
    success: false,
    message: "下载失败，请手动下载最新版",
    filePath: undefined,
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

  if (originalUserAgent) {
    Object.defineProperty(window.navigator, "userAgent", originalUserAgent);
  } else {
    Reflect.deleteProperty(window.navigator, "userAgent");
  }
});

describe("AboutSection", () => {
  it("应渲染轻量总览头部与主要信息分区", async () => {
    const container = renderComponent();
    await waitForLoad();

    const text = container.textContent ?? "";
    expect(text).toContain("关于 Lime");
    expect(text).toContain("了解版本、更新入口和 Lime 的工作区定位。");
    expect(text).toContain("当前版本 1.10.0");
    expect(text).toContain("工作区主线 4 项");
    expect(text).toContain("相关入口 3 个");
    expect(text).toContain("产品定位");
    expect(text).toContain("3 步开始创作");
    expect(text).toContain("相关链接");
  });

  it("应把关于总览说明收进 tips", async () => {
    renderComponent();
    await waitForLoad();

    expect(getBodyText()).not.toContain(
      "Lime 面向真实创作流程而不是单点问答。你可以从一句模糊需求开始，在同一个空间里完成方向判断、内容生成、素材制作和结果沉淀。",
    );

    const overviewTip = await hoverTip("关于 Lime 总览说明");
    expect(getBodyText()).toContain(
      "Lime 面向真实创作流程而不是单点问答。你可以从一句模糊需求开始，在同一个空间里完成方向判断、内容生成、素材制作和结果沉淀。",
    );
    await leaveTip(overviewTip);
  });

  it("点击更新按钮时应重新检查并允许触发下载", async () => {
    const container = renderComponent();
    await waitForLoad();

    await act(async () => {
      findButton(container, "检查更新").click();
      await waitForLoad();
    });

    expect(mockCheckForUpdates).toHaveBeenCalledTimes(2);

    await act(async () => {
      findButton(container, "下载更新").click();
      await waitForLoad();
    });

    expect(mockDownloadUpdate).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("下载失败，请手动下载最新版");
  });

  it("Windows 关于页应只提示单一 setup 安装包", async () => {
    const container = renderComponent();
    await waitForLoad();

    expect(container.textContent).toContain(
      "Windows 仅提供单一 setup 安装包；需要手动升级或重装时，可直接使用网页下载页中的最新版。",
    );
    expect(container.textContent).not.toContain("在线安装包");
    expect(container.textContent).not.toContain("offline 安装包");
  });
});
