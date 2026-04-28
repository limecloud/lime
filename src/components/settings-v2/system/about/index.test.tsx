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
        return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
          String(values[name] ?? ""),
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
    message: "安装更新失败: signature mismatch。请前往发布页手动下载最新版",
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
  it("应只渲染必要的品牌、版本与更新信息", async () => {
    const container = renderComponent();
    await waitForLoad();

    const text = container.textContent ?? "";
    expect(container.querySelector("img[alt='Lime']")).toBeInstanceOf(
      HTMLImageElement,
    );
    expect(text).toContain("Lime");
    expect(text).toContain("Version 1.10.0 (1.10.0)");
    expect(text).toContain("Copyright © 2026 Lime");
    expect(text).toContain("可更新到 1.10.1");
    expect(text).toContain("检查更新");
    expect(text).toContain("下载更新");
  });

  it("应移除关于页里的营销与能力说明噪音", async () => {
    const container = renderComponent();
    await waitForLoad();

    const text = container.textContent ?? "";
    expect(text).not.toContain("产品定位");
    expect(text).not.toContain("3 步开始创作");
    expect(text).not.toContain("适合谁");
    expect(text).not.toContain("工作区主线");
    expect(text).not.toContain("可选能力");
    expect(text).not.toContain("Made for creators");
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
    expect(container.textContent).toContain(
      "暂时无法自动安装更新，请使用网页下载最新版。",
    );
    expect(container.textContent).not.toContain("signature mismatch");
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

  it("更新检查失败时应隐藏技术错误", async () => {
    mockCheckForUpdates.mockResolvedValueOnce({
      current: "1.10.0",
      latest: "1.10.1",
      hasUpdate: false,
      downloadUrl: undefined,
      releaseNotes: undefined,
      pubDate: undefined,
      error: "更新清单请求失败（HTTP 404 Not Found），已回退本地缓存",
    });

    const container = renderComponent();
    await waitForLoad();

    const text = container.textContent ?? "";
    expect(text).toContain("暂时无法检查更新，请稍后再试。");
    expect(text).not.toContain("HTTP 404");
    expect(text).not.toContain("已回退本地缓存");
  });
});
