import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockOpenPathWithDefaultApp,
  mockRevealPathInFinder,
  mockReadFilePreview,
} = vi.hoisted(() => ({
  mockOpenPathWithDefaultApp: vi.fn(),
  mockRevealPathInFinder: vi.fn(),
  mockReadFilePreview: vi.fn(),
}));

vi.mock("@/lib/api/fileSystem", () => ({
  openPathWithDefaultApp: mockOpenPathWithDefaultApp,
  revealPathInFinder: mockRevealPathInFinder,
  convertLocalFileSrc: (path: string) => `asset://${path}`,
}));

vi.mock("@/lib/api/fileBrowser", () => ({
  readFilePreview: mockReadFilePreview,
}));

vi.mock("@/lib/tauri-runtime", () => ({
  hasTauriEventCapability: () => false,
  hasTauriInvokeCapability: () => false,
}));

vi.mock("@/components/agent/chat/components/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => (
    <article data-testid="mock-markdown-renderer">{content}</article>
  ),
}));

import { ResourceManagerPage } from "./ResourceManagerPage";
import { RESOURCE_MANAGER_NAVIGATION_INTENT_KEY } from "./resourceManagerIntents";
import { getResourceManagerSessionStorageKey } from "./resourceManagerSession";
import type { ResourceManagerSession } from "./types";

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function renderPage(session: ResourceManagerSession | null) {
  localStorage.clear();
  if (session) {
    localStorage.setItem(
      getResourceManagerSessionStorageKey(session.id),
      JSON.stringify(session),
    );
    window.history.pushState({}, "", `/resource-manager?session=${session.id}`);
  } else {
    window.history.pushState({}, "", "/resource-manager?session=missing");
  }

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<ResourceManagerPage />);
  });
  mountedRoots.push({ root, container });
  return container;
}

function updateTextInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("ResourceManagerPage", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    mockReadFilePreview.mockResolvedValue({
      path: "/tmp/demo.txt",
      content: "来自文件的文本",
      isBinary: false,
      size: 7,
      error: null,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
    vi.spyOn(window, "open").mockImplementation(() => null);
  });

  afterEach(() => {
    while (mountedRoots.length > 0) {
      const mounted = mountedRoots.pop();
      if (!mounted) break;
      act(() => {
        mounted.root.unmount();
      });
      mounted.container.remove();
    }
    localStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("应渲染资源列表、当前图片和元信息", () => {
    const container = renderPage({
      id: "session-1",
      sourceLabel: "项目资料",
      initialIndex: 0,
      createdAt: Date.now(),
      items: [
        {
          id: "image-1",
          kind: "image",
          src: "https://example.com/1.png",
          filePath: "/tmp/1.png",
          title: "第一张",
          metadata: { size: "1024x1024", providerName: "测试模型" },
        },
        {
          id: "pdf-1",
          kind: "pdf",
          src: "asset:///tmp/a.pdf",
          filePath: "/tmp/a.pdf",
          title: "说明 PDF",
        },
      ],
    });

    expect(container.textContent).toContain("项目资料");
    expect(container.textContent).toContain("2 个资源");
    expect(container.textContent).toContain("第一张");
    expect(container.textContent).toContain("1024x1024");
    expect(
      container.querySelector('[data-testid="resource-manager-item-list"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('img[src="https://example.com/1.png"]'),
    ).toBeTruthy();

    const toolbar = container.querySelector(
      '[data-testid="resource-manager-type-toolbar"]',
    );
    expect(
      toolbar?.querySelector('button[aria-label="缩小图片"]'),
    ).toBeTruthy();
    expect(
      toolbar?.querySelector('button[aria-label="顺时针旋转"]'),
    ).toBeTruthy();
    expect(
      container
        .querySelector('[data-testid="resource-manager-image-stage"]')
        ?.querySelector('button[aria-label="缩小图片"]'),
    ).toBeNull();

    const zoomIn = toolbar?.querySelector('button[aria-label="放大图片"]');
    act(() => {
      zoomIn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(toolbar?.textContent).toContain("120%");
  });

  it("不同类型应展示不同预览 UI", async () => {
    const container = renderPage({
      id: "session-types",
      initialIndex: 0,
      createdAt: Date.now(),
      items: [
        {
          id: "video-1",
          kind: "video",
          src: "asset:///tmp/a.mp4",
          title: "视频",
        },
        {
          id: "pdf-1",
          kind: "pdf",
          src: "asset:///tmp/a.pdf",
          filePath: "/tmp/a.pdf",
          title: "PDF",
        },
        { id: "md-1", kind: "markdown", content: "# 标题", title: "文稿" },
        {
          id: "office-1",
          kind: "office",
          src: "asset:///tmp/a.docx",
          filePath: "/tmp/a.docx",
          title: "Word",
        },
        {
          id: "data-1",
          kind: "data",
          title: "metrics.csv",
          content: "name,count\nfoo,1",
          mimeType: "text/csv",
        },
      ],
    });

    expect(
      container.querySelector('[data-testid="resource-manager-video-player"]'),
    ).toBeTruthy();
    expect(container.querySelector('button[aria-label="复制图片"]')).toBeNull();

    const second = container.querySelector(
      'button[aria-label="查看第 2 个资源"]',
    );
    act(() => {
      second?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(
      container.querySelector('[data-testid="resource-manager-pdf-frame"]'),
    ).toBeTruthy();

    const third = container.querySelector(
      'button[aria-label="查看第 3 个资源"]',
    );
    await act(async () => {
      third?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(
      container.querySelector('[data-testid="mock-markdown-renderer"]')
        ?.textContent,
    ).toContain("# 标题");
    expect(
      container.querySelector('button[aria-label="复制内容"]'),
    ).toBeTruthy();

    const fourth = container.querySelector(
      'button[aria-label="查看第 4 个资源"]',
    );
    act(() => {
      fourth?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.textContent).toContain("Word 文档 暂不内置预览");
    expect(container.textContent).toContain("后续可接入");
    expect(
      container.querySelector(
        '[data-testid="resource-manager-office-preview"]',
      ),
    ).toBeTruthy();
    expect(
      container.querySelectorAll('button[aria-label="系统打开"]'),
    ).toHaveLength(1);
    expect(
      container.querySelectorAll('button[aria-label="定位文件"]'),
    ).toHaveLength(1);

    const fifth = container.querySelector(
      'button[aria-label="查看第 5 个资源"]',
    );
    await act(async () => {
      fifth?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(container.textContent).toContain("结构化数据预览");
    expect(
      container.querySelector('[data-testid="resource-manager-data-table"]'),
    ).toBeTruthy();
    expect(container.textContent).not.toContain(
      ["数据文件", "暂不内置预览"].join(""),
    );
  });

  it("本地资源应允许系统打开、定位文件和复制路径", async () => {
    const container = renderPage({
      id: "session-actions",
      initialIndex: 0,
      createdAt: Date.now(),
      items: [
        {
          id: "pdf-1",
          kind: "pdf",
          src: "asset:///tmp/1.pdf",
          filePath: "/tmp/1.pdf",
          title: "PDF",
        },
      ],
    });

    const openButton = container.querySelector('button[aria-label="系统打开"]');
    await act(async () => {
      openButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(mockOpenPathWithDefaultApp).toHaveBeenCalledWith("/tmp/1.pdf");

    const revealButton = container.querySelector(
      'button[aria-label="定位文件"]',
    );
    await act(async () => {
      revealButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(mockRevealPathInFinder).toHaveBeenCalledWith("/tmp/1.pdf");

    const copyButton = container.querySelector(
      'button[aria-label="复制路径 / 地址"]',
    );
    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("/tmp/1.pdf");
    expect(container.querySelector('button[aria-label="更多操作"]')).toBeNull();
  });

  it("顶部工具栏应展示 PDF 和媒体格式，并避免系统动作重复", () => {
    const container = renderPage({
      id: "session-format-toolbar",
      initialIndex: 0,
      createdAt: Date.now(),
      items: [
        {
          id: "pdf-1",
          kind: "pdf",
          src: "asset:///tmp/1.pdf",
          filePath: "/tmp/1.pdf",
          title: "说明.pdf",
        },
        {
          id: "video-1",
          kind: "video",
          src: "asset:///tmp/clip.m2ts",
          filePath: "/tmp/clip.m2ts",
          title: "摄像机素材.m2ts",
        },
        {
          id: "audio-1",
          kind: "audio",
          src: "asset:///tmp/song.opus",
          filePath: "/tmp/song.opus",
          title: "播客.opus",
        },
      ],
    });

    let toolbar = container.querySelector(
      '[data-testid="resource-manager-type-toolbar"]',
    );
    expect(toolbar?.textContent).toContain("PDF 文档");
    expect(toolbar?.textContent).toContain("打印");
    expect(toolbar?.textContent).toContain("浏览器 PDF 控件");
    expect(
      container.querySelectorAll('button[aria-label="系统打开"]'),
    ).toHaveLength(1);
    expect(
      container.querySelectorAll('button[aria-label="定位文件"]'),
    ).toHaveLength(1);

    const videoButton = container.querySelector(
      'button[aria-label="查看第 2 个资源"]',
    );
    act(() => {
      videoButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    toolbar = container.querySelector(
      '[data-testid="resource-manager-type-toolbar"]',
    );
    expect(toolbar?.textContent).toContain("移动/摄像机视频");
    expect(toolbar?.textContent).toContain("系统应用更稳");
    expect(toolbar?.textContent).toContain("原生播放控件");
    expect(
      container.querySelector(
        '[data-testid="resource-manager-system-delegated-preview"]',
      ),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="resource-manager-video-player"]'),
    ).toBeNull();
    expect(
      container.querySelectorAll('button[aria-label="系统打开"]'),
    ).toHaveLength(1);

    const audioButton = container.querySelector(
      'button[aria-label="查看第 3 个资源"]',
    );
    act(() => {
      audioButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    toolbar = container.querySelector(
      '[data-testid="resource-manager-type-toolbar"]',
    );
    expect(toolbar?.textContent).toContain("WebView 音频");
    expect(toolbar?.textContent).toContain("原生播放控件");
  });

  it("Office 系列应按文档、表格和幻灯片展示独立导航 UI", () => {
    const container = renderPage({
      id: "session-office-profiles",
      initialIndex: 0,
      createdAt: Date.now(),
      items: [
        {
          id: "word-1",
          kind: "office",
          src: "asset:///tmp/spec.docx",
          filePath: "/tmp/spec.docx",
          title: "spec.docx",
        },
        {
          id: "sheet-1",
          kind: "office",
          src: "asset:///tmp/report.xlsx",
          filePath: "/tmp/report.xlsx",
          title: "report.xlsx",
        },
        {
          id: "slides-1",
          kind: "office",
          src: "asset:///tmp/deck.pptx",
          filePath: "/tmp/deck.pptx",
          title: "deck.pptx",
        },
        {
          id: "keynote-1",
          kind: "office",
          src: "asset:///tmp/story.key",
          filePath: "/tmp/story.key",
          title: "story.key",
        },
      ],
    });

    let toolbar = container.querySelector(
      '[data-testid="resource-manager-type-toolbar"]',
    );
    expect(toolbar?.textContent).toContain("Word");
    expect(toolbar?.textContent).toContain("Word 文档");
    expect(toolbar?.textContent).toContain("系统文档处理");
    expect(container.textContent).toContain("文档类型：Word 文档");

    const spreadsheetButton = container.querySelector(
      'button[aria-label="查看第 2 个资源"]',
    );
    act(() => {
      spreadsheetButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    toolbar = container.querySelector(
      '[data-testid="resource-manager-type-toolbar"]',
    );
    expect(toolbar?.textContent).toContain("Excel");
    expect(toolbar?.textContent).toContain("Excel 表格");
    expect(toolbar?.textContent).toContain("系统表格处理");
    expect(container.textContent).toContain("Excel 表格 暂不内置预览");

    const presentationButton = container.querySelector(
      'button[aria-label="查看第 3 个资源"]',
    );
    act(() => {
      presentationButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    toolbar = container.querySelector(
      '[data-testid="resource-manager-type-toolbar"]',
    );
    expect(toolbar?.textContent).toContain("PowerPoint");
    expect(toolbar?.textContent).toContain("PowerPoint 幻灯片");
    expect(toolbar?.textContent).toContain("系统演示处理");
    expect(container.textContent).toContain("PowerPoint 幻灯片 暂不内置预览");

    const keynoteButton = container.querySelector(
      'button[aria-label="查看第 4 个资源"]',
    );
    act(() => {
      keynoteButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    toolbar = container.querySelector(
      '[data-testid="resource-manager-type-toolbar"]',
    );
    expect(toolbar?.textContent).toContain("Keynote");
    expect(toolbar?.textContent).toContain("Keynote 幻灯片");
    expect(toolbar?.textContent).toContain("Keynote 打开");
    expect(container.textContent).toContain("文档类型：Keynote 幻灯片");
    expect(
      container.querySelectorAll('button[aria-label="系统打开"]'),
    ).toHaveLength(1);
    expect(
      container.querySelectorAll('button[aria-label="定位文件"]'),
    ).toHaveLength(1);
  });

  it("压缩包和归档文件应展示独立 UI，并只在顶部导航交给系统处理", () => {
    const container = renderPage({
      id: "session-archive-profile",
      initialIndex: 0,
      createdAt: Date.now(),
      items: [
        {
          id: "archive-zip",
          kind: "archive",
          src: "asset:///tmp/assets.zip",
          filePath: "/tmp/assets.zip",
          title: "assets.zip",
          mimeType: "application/zip",
        },
        {
          id: "archive-dmg",
          kind: "archive",
          src: "asset:///tmp/installer.dmg",
          filePath: "/tmp/installer.dmg",
          title: "installer.dmg",
        },
      ],
    });

    let toolbar = container.querySelector(
      '[data-testid="resource-manager-type-toolbar"]',
    );
    expect(toolbar?.textContent).toContain("压缩包");
    expect(toolbar?.textContent).toContain("系统解压处理");
    expect(
      container.querySelector(
        '[data-testid="resource-manager-kind-filter-archive"]',
      ),
    ).toBeTruthy();
    expect(
      container.querySelector(
        '[data-testid="resource-manager-archive-preview"]',
      )?.textContent,
    ).toContain("建议交给系统归档工具");
    expect(
      container.querySelector(
        '[data-testid="resource-manager-archive-preview"]',
      )?.textContent,
    ).toContain("安全的只读目录索引");
    expect(
      container.querySelectorAll('button[aria-label="系统打开"]'),
    ).toHaveLength(1);
    expect(
      container.querySelectorAll('button[aria-label="定位文件"]'),
    ).toHaveLength(1);
    expect(
      container.querySelector(
        '[data-testid="resource-manager-system-delegated-preview"]',
      ),
    ).toBeNull();

    const dmgButton = container.querySelector(
      'button[aria-label="查看第 2 个资源"]',
    );
    act(() => {
      dmgButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    toolbar = container.querySelector(
      '[data-testid="resource-manager-type-toolbar"]',
    );
    expect(toolbar?.textContent).toContain("磁盘镜像");
    expect(
      container.querySelector(
        '[data-testid="resource-manager-archive-preview"]',
      )?.textContent,
    ).toContain("归档类型：磁盘镜像");
  });

  it("系统优先格式不应硬塞进 WebView 内置预览", () => {
    const container = renderPage({
      id: "session-system-delegated-formats",
      initialIndex: 0,
      createdAt: Date.now(),
      items: [
        {
          id: "heic-1",
          kind: "image",
          src: "asset:///tmp/photo.heic",
          filePath: "/tmp/photo.heic",
          title: "photo.heic",
          mimeType: "image/heic",
        },
        {
          id: "parquet-1",
          kind: "data",
          src: "asset:///tmp/events.parquet",
          filePath: "/tmp/events.parquet",
          title: "events.parquet",
        },
        {
          id: "heic-mime-only",
          kind: "image",
          src: "asset:///tmp/resource-without-extension",
          title: "iPhone 实况图",
          mimeType: "image/heic",
        },
      ],
    });

    let toolbar = container.querySelector(
      '[data-testid="resource-manager-type-toolbar"]',
    );
    expect(toolbar?.textContent).toContain("系统图片");
    expect(toolbar?.textContent).toContain("系统图片预览");
    expect(
      container.querySelector(
        '[data-testid="resource-manager-system-delegated-preview"]',
      ),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="resource-manager-image-stage"]'),
    ).toBeNull();
    expect(
      container.querySelector('img[src="asset:///tmp/photo.heic"]'),
    ).toBeNull();
    expect(
      container.querySelectorAll('button[aria-label="复制路径 / 地址"]'),
    ).toHaveLength(1);

    const dataButton = container.querySelector(
      'button[aria-label="查看第 2 个资源"]',
    );
    act(() => {
      dataButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    toolbar = container.querySelector(
      '[data-testid="resource-manager-type-toolbar"]',
    );
    expect(toolbar?.textContent).toContain("二进制数据集");
    expect(toolbar?.textContent).toContain("需要专用解析器");
    expect(
      toolbar?.querySelector('[data-testid="resource-preview-search-input"]'),
    ).toBeNull();
    expect(
      container.querySelector(
        '[data-testid="resource-manager-system-delegated-preview"]',
      )?.textContent,
    ).toContain("尚未接入安全可靠的内置解析器");
    expect(
      container.querySelector('[data-testid="resource-manager-data-code"]'),
    ).toBeNull();

    const mimeOnlyImageButton = container.querySelector(
      'button[aria-label="查看第 3 个资源"]',
    );
    act(() => {
      mimeOnlyImageButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    toolbar = container.querySelector(
      '[data-testid="resource-manager-type-toolbar"]',
    );
    expect(toolbar?.textContent).toContain("系统图片");
    expect(
      container.querySelector(
        '[data-testid="resource-manager-system-delegated-preview"]',
      ),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="resource-manager-image-stage"]'),
    ).toBeNull();
  });

  it("项目文件应把通用文件动作留在导航栏，更多菜单只展示业务动作", () => {
    const container = renderPage({
      id: "session-project-file-actions",
      sourceContext: {
        kind: "project_resource",
        projectId: "project-1",
        contentId: "content-1",
        sourcePage: "resources",
      },
      initialIndex: 0,
      createdAt: Date.now(),
      items: [
        {
          id: "pdf-1",
          kind: "pdf",
          src: "asset:///tmp/1.pdf",
          filePath: "/tmp/1.pdf",
          title: "PDF",
        },
      ],
    });

    expect(
      container.querySelectorAll('button[aria-label="复制路径 / 地址"]'),
    ).toHaveLength(1);
    expect(
      container.querySelectorAll('button[aria-label="定位文件"]'),
    ).toHaveLength(1);
    expect(
      container.querySelectorAll('button[aria-label="系统打开"]'),
    ).toHaveLength(1);

    const moreButton = container.querySelector('button[aria-label="更多操作"]');
    act(() => {
      moreButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("回到项目资料");
    expect(container.textContent).not.toContain("复制路径 / 地址");
    expect(container.textContent).not.toContain("用系统应用打开");
  });

  it("图片任务来源应只展示任务相关菜单并写入回跳意图", () => {
    const container = renderPage({
      id: "session-image-task-actions",
      initialIndex: 0,
      createdAt: Date.now(),
      items: [
        {
          id: "image-1",
          kind: "image",
          src: "https://example.com/1.png",
          title: "任务图",
          sourceContext: {
            kind: "image_task",
            taskId: "task-1",
            outputId: "output-1",
            sourcePage: "image-task-viewer",
          },
        },
      ],
    });

    const moreButton = container.querySelector('button[aria-label="更多操作"]');
    act(() => {
      moreButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("定位到图片任务");
    expect(container.textContent).toContain("作为后续任务输入");
    expect(container.textContent).not.toContain("转发");
    expect(container.textContent).not.toContain("收藏");
    expect(container.textContent).not.toContain("阅读原文");

    const locateButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("定位到图片任务"),
    );
    act(() => {
      locateButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(
      JSON.parse(localStorage.getItem(RESOURCE_MANAGER_NAVIGATION_INTENT_KEY)!),
    ).toEqual(
      expect.objectContaining({
        action: "locate_chat",
        item: expect.objectContaining({ id: "image-1", kind: "image" }),
        sourceContext: expect.objectContaining({
          kind: "image_task",
          taskId: "task-1",
          outputId: "output-1",
        }),
      }),
    );
  });

  it("项目文稿来源应展示项目回跳和原文入口，不再出现重复复制按钮", async () => {
    const container = renderPage({
      id: "session-project-actions",
      initialIndex: 0,
      createdAt: Date.now(),
      items: [
        {
          id: "md-1",
          kind: "markdown",
          content: "# 项目文稿",
          title: "项目文稿",
          sourceContext: {
            kind: "project_resource",
            projectId: "project-1",
            contentId: "content-1",
            originUrl: "https://example.com/source",
            sourcePage: "resources",
            resourceFolderId: "folder-1",
            resourceCategory: "document",
          },
        },
      ],
    });

    expect(
      container.querySelector('button[aria-label="复制内容"]'),
    ).toBeTruthy();
    expect(container.querySelector('button[aria-label="复制路径"]')).toBeNull();

    const moreButton = container.querySelector('button[aria-label="更多操作"]');
    act(() => {
      moreButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("回到项目资料");
    expect(container.textContent).toContain("阅读原文");
    expect(container.textContent).not.toContain("保存到系统照片");
    expect(container.textContent).not.toContain("复制路径 / 地址");

    const projectButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("回到项目资料"),
    );
    act(() => {
      projectButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(
      JSON.parse(localStorage.getItem(RESOURCE_MANAGER_NAVIGATION_INTENT_KEY)!),
    ).toEqual(
      expect.objectContaining({
        action: "open_project_resource",
        sourceContext: expect.objectContaining({
          kind: "project_resource",
          projectId: "project-1",
          contentId: "content-1",
          resourceFolderId: "folder-1",
          resourceCategory: "document",
        }),
      }),
    );

    act(() => {
      moreButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const originButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("阅读原文"),
    );
    await act(async () => {
      originButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(window.open).toHaveBeenCalledWith(
      "https://example.com/source",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("应支持搜索和类型筛选资源列表，并自动切换到匹配资源", async () => {
    const container = renderPage({
      id: "session-search",
      initialIndex: 0,
      createdAt: Date.now(),
      items: [
        {
          id: "image-1",
          kind: "image",
          src: "https://example.com/poster.png",
          title: "海报图片",
        },
        {
          id: "pdf-1",
          kind: "pdf",
          src: "asset:///tmp/product.pdf",
          filePath: "/tmp/product.pdf",
          title: "产品 PDF",
        },
        {
          id: "data-1",
          kind: "data",
          title: "metrics.csv",
          content: "name,count\nfoo,1",
        },
      ],
    });

    const searchInput = container.querySelector(
      '[data-testid="resource-manager-search-input"]',
    ) as HTMLInputElement;
    act(() => {
      updateTextInput(searchInput, "PDF");
    });
    await act(async () => {
      await Promise.resolve();
    });

    let listItems = container.querySelectorAll(
      '[data-testid="resource-manager-resource-list-item"]',
    );
    expect(listItems).toHaveLength(1);
    expect(listItems[0]?.textContent).toContain("产品 PDF");
    expect(container.textContent).toContain("匹配 1");
    expect(
      container.querySelector('[data-testid="resource-manager-pdf-frame"]'),
    ).toBeTruthy();

    act(() => {
      updateTextInput(searchInput, "");
    });
    const dataFilter = container.querySelector(
      '[data-testid="resource-manager-kind-filter-data"]',
    );
    await act(async () => {
      dataFilter?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    listItems = container.querySelectorAll(
      '[data-testid="resource-manager-resource-list-item"]',
    );
    expect(listItems).toHaveLength(1);
    expect(listItems[0]?.textContent).toContain("metrics.csv");
    expect(
      container.querySelector('[data-testid="resource-manager-data-table"]'),
    ).toBeTruthy();

    act(() => {
      updateTextInput(searchInput, "不存在");
    });
    expect(container.textContent).toContain("没有匹配资源");
  });

  it("JSON 数据应格式化展示为代码预览", async () => {
    const container = renderPage({
      id: "session-json-data",
      initialIndex: 0,
      createdAt: Date.now(),
      items: [
        {
          id: "data-json",
          kind: "data",
          title: "metrics.json",
          content: '{"ok":true,"count":2}',
          mimeType: "application/json",
        },
      ],
    });

    const code = container.querySelector(
      '[data-testid="resource-manager-data-code"]',
    );
    expect(container.textContent).toContain("结构化数据预览");
    expect(code?.textContent).toContain('"ok": true');
    expect(code?.textContent).toContain('"count": 2');

    const rawButton = container.querySelector(
      'button[aria-label="查看原始数据"]',
    );
    await act(async () => {
      rawButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(
      container.querySelector('[data-testid="resource-manager-data-code"]')
        ?.textContent,
    ).toContain('{"ok":true,"count":2}');

    const formattedButton = container.querySelector(
      'button[aria-label="查看格式化数据"]',
    );
    await act(async () => {
      formattedButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });
    expect(
      container.querySelector('[data-testid="resource-manager-data-code"]')
        ?.textContent,
    ).toContain('"count": 2');

    const previewSearch = container.querySelector(
      '[data-testid="resource-preview-search-input"]',
    ) as HTMLInputElement;
    await act(async () => {
      updateTextInput(previewSearch, "count");
      await Promise.resolve();
    });
    expect(container.textContent).toContain("1/1");
    expect(
      container.querySelectorAll('[data-testid="resource-preview-search-hit"]'),
    ).toHaveLength(1);
  });

  it("应在顶部详情按钮中展示资源 Inspector 与业务来源", () => {
    const container = renderPage({
      id: "session-inspector",
      sourceContext: {
        kind: "project_resource",
        projectId: "project-1",
        contentId: "content-1",
        sourcePage: "resources",
      },
      initialIndex: 0,
      createdAt: Date.now(),
      items: [
        {
          id: "data-1",
          kind: "data",
          title: "metrics.json",
          content: '{"ok":true}',
          mimeType: "application/json",
        },
      ],
    });

    const infoButton = container.querySelector(
      'button[aria-label="切换资源详情"]',
    );
    act(() => {
      infoButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const inspector = container.querySelector(
      '[data-testid="resource-manager-inspector"]',
    );
    expect(inspector).toBeTruthy();
    expect(inspector?.textContent).toContain("资源详情");
    expect(inspector?.textContent).toContain("资源 ID");
    expect(inspector?.textContent).toContain("data-1");
    expect(inspector?.textContent).toContain("来源类型");
    expect(inspector?.textContent).toContain("project_resource");
    expect(inspector?.textContent).toContain("project-1");
  });

  it("文本文件应通过文件预览命令加载内容", async () => {
    const container = renderPage({
      id: "session-text",
      initialIndex: 0,
      createdAt: Date.now(),
      items: [
        {
          id: "text-1",
          kind: "text",
          src: "asset:///tmp/demo.txt",
          filePath: "/tmp/demo.txt",
          title: "文本",
        },
      ],
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockReadFilePreview).toHaveBeenCalledWith(
      "/tmp/demo.txt",
      256 * 1024,
    );
    expect(container.textContent).toContain("来自文件的文本");

    const previewSearch = container.querySelector(
      '[data-testid="resource-preview-search-input"]',
    ) as HTMLInputElement;
    await act(async () => {
      updateTextInput(previewSearch, "文本");
      await Promise.resolve();
    });
    expect(container.textContent).toContain("1/1");
    expect(
      container.querySelectorAll('[data-testid="resource-preview-search-hit"]'),
    ).toHaveLength(1);
  });

  it("预览查找应放在顶部导航栏并支持上下命中", async () => {
    const container = renderPage({
      id: "session-preview-search-nav",
      initialIndex: 0,
      createdAt: Date.now(),
      items: [
        {
          id: "text-inline",
          kind: "text",
          title: "查找文本",
          content: "alpha beta alpha gamma alpha",
        },
      ],
    });

    const toolbar = container.querySelector(
      '[data-testid="resource-manager-type-toolbar"]',
    );
    const preview = container.querySelector(
      '[data-testid="resource-manager-text-preview"]',
    );
    const previewSearch = toolbar?.querySelector(
      '[data-testid="resource-preview-search-input"]',
    ) as HTMLInputElement;

    expect(previewSearch).toBeTruthy();
    expect(
      preview?.querySelector('[data-testid="resource-preview-search-input"]'),
    ).toBeNull();

    await act(async () => {
      updateTextInput(previewSearch, "alpha");
      await Promise.resolve();
    });

    expect(toolbar?.textContent).toContain("1/3");
    expect(
      container.querySelectorAll('[data-testid="resource-preview-search-hit"]'),
    ).toHaveLength(3);
    expect(
      container.querySelectorAll(
        '[data-resource-preview-search-active="true"]',
      ),
    ).toHaveLength(1);

    await act(async () => {
      previewSearch.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
      await Promise.resolve();
    });
    expect(toolbar?.textContent).toContain("2/3");

    await act(async () => {
      previewSearch.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          shiftKey: true,
          bubbles: true,
        }),
      );
      await Promise.resolve();
    });
    expect(toolbar?.textContent).toContain("1/3");

    const nextButton = toolbar?.querySelector(
      '[data-testid="resource-preview-search-next"]',
    );
    await act(async () => {
      nextButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(toolbar?.textContent).toContain("2/3");

    const previousButton = toolbar?.querySelector(
      '[data-testid="resource-preview-search-previous"]',
    );
    await act(async () => {
      previousButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(toolbar?.textContent).toContain("1/3");
  });

  it("Markdown 应支持顶部切换预览和源码，并在源码模式高亮查找", async () => {
    const container = renderPage({
      id: "session-markdown-source",
      initialIndex: 0,
      createdAt: Date.now(),
      items: [
        {
          id: "markdown-source",
          kind: "markdown",
          title: "Markdown 文稿",
          content: "# 标题\n\nalpha beta alpha",
        },
      ],
    });

    const toolbar = container.querySelector(
      '[data-testid="resource-manager-type-toolbar"]',
    );
    expect(
      container.querySelector('[data-testid="mock-markdown-renderer"]'),
    ).toBeTruthy();

    const sourceButton = toolbar?.querySelector(
      'button[aria-label="查看 Markdown 源码"]',
    );
    await act(async () => {
      sourceButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="mock-markdown-renderer"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="resource-manager-text-preview"]')
        ?.textContent,
    ).toContain("# 标题");

    const previewSearch = toolbar?.querySelector(
      '[data-testid="resource-preview-search-input"]',
    ) as HTMLInputElement;
    await act(async () => {
      updateTextInput(previewSearch, "alpha");
      await Promise.resolve();
    });

    expect(toolbar?.textContent).toContain("1/2");
    expect(
      container.querySelectorAll('[data-testid="resource-preview-search-hit"]'),
    ).toHaveLength(2);
    expect(
      container.querySelectorAll(
        '[data-resource-preview-search-active="true"]',
      ),
    ).toHaveLength(1);

    const previewButton = toolbar?.querySelector(
      'button[aria-label="查看 Markdown 预览"]',
    );
    await act(async () => {
      previewButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="mock-markdown-renderer"]'),
    ).toBeTruthy();
    expect(toolbar?.textContent).toContain("源码模式可高亮");
  });
});
