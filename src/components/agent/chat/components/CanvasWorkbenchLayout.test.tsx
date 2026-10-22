import { describe, expect, it, vi } from "vitest";
import type { CanvasWorkbenchDefaultPreview } from "./CanvasWorkbenchLayout";
import {
  type CanvasWorkbenchLayoutProps,
  clickByAriaLabel,
  toggleFilePreview,
  createArtifact,
  createTaskFile,
  flushEffects,
  mockListDirectory,
  mockReadFileBytes,
  mount,
  mountHarness,
  resizeWorkbench,
} from "./CanvasWorkbenchLayout.testFixtures";

describe("CanvasWorkbenchLayout", () => {
  it.each(["default", "coding"] as const)(
    "%s 预览不再创建第二套 Files 或终端标签",
    async (workbenchMode) => {
      const container = mount({
        artifacts: [],
        canvasState: null,
        taskFiles: [],
        workspaceRoot: "/workspace",
        defaultPreview: null,
        loadFilePreview: vi.fn(),
        onOpenPath: vi.fn(),
        onRevealPath: vi.fn(),
        workbenchMode,
      });
      await flushEffects();
      expect(mockListDirectory).not.toHaveBeenCalled();
      expect(
        container.querySelector(
          '[data-testid="canvas-workbench-panel-workspace"]',
        ),
      ).toBeNull();
      expect(
        container.querySelector(
          '[data-testid="canvas-workbench-tab-menu-trigger"]',
        ),
      ).toBeNull();
      expect(
        container.querySelector(
          '[data-testid="canvas-workbench-panel-terminal"]',
        ),
      ).toBeNull();
      expect(
        container.querySelector(
          '[data-testid="canvas-workbench-panel-project-files"]',
        ),
      ).toBeNull();
    },
  );

  it("预览壳保留审查与文件模式，文件操作仍使用真实路径", async () => {
    const onOpenPath = vi.fn(async () => undefined);
    const onRevealPath = vi.fn(async () => undefined);
    const loadFilePreview = vi.fn(async (path: string) => {
      if (path === "/workspace/README.md") {
        return {
          path,
          content: "README 内容",
          isBinary: false,
          size: 12,
          error: null,
        };
      }

      return {
        path,
        content: null,
        isBinary: true,
        size: 0,
        error: null,
      };
    });

    const container = mount({
      artifacts: [
        createArtifact("artifact-old", "draft.md", "标题\n上一版本", 10),
        createArtifact("artifact-new", "draft.md", "标题\n产物版本", 20),
      ],
      canvasState: null,
      taskFiles: [
        createTaskFile("task-current", "draft.md", "标题\n当前画布正文", 30),
      ],
      selectedFileId: "task-current",
      workspaceRoot: "/workspace",
      defaultPreview: {
        selectionKey: "task:task-current",
        title: "draft.md",
        content: "标题\n当前画布正文",
        filePath: "draft.md",
        absolutePath: "/workspace/draft.md",
        previousContent: "标题\n上一版本",
      } satisfies CanvasWorkbenchDefaultPreview,
      loadFilePreview,
      onOpenPath,
      onRevealPath,
    });

    await flushEffects();

    expect(mockListDirectory).not.toHaveBeenCalled();
    expect(
      container
        .querySelector('[data-testid="canvas-workbench-shell"]')
        ?.getAttribute("data-layout-mode"),
    ).toBe("split");
    expect(
      container.querySelector('[data-testid="canvas-workbench-shell"]')
        ?.className,
    ).toContain("lime-workbench-theme-scope");
    expect(
      container.querySelector('[data-testid="canvas-workbench-shell"]')
        ?.className,
    ).toContain("lime-workbench-surface-scope");
    expect(
      container.querySelector('[data-testid="canvas-workbench-shell"]')
        ?.className,
    ).toContain("bg-[color:var(--lime-surface)]");
    expect(
      container.querySelector('[data-testid="canvas-workbench-shell"]')
        ?.className,
    ).not.toContain("rounded-[12px]");
    expect(
      container.querySelector('[data-testid="canvas-workbench-top-tabs-slot"]')
        ?.className,
    ).toContain("overflow-visible");
    expect(
      container.querySelector('button[aria-label="切换画布标签-审查"]'),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[data-testid="canvas-workbench-direct-tabs"] [aria-label="切换画布标签-文件"]',
      ),
    ).toBeNull();
    expect(
      container.querySelector(
        '[data-testid="canvas-workbench-direct-tabs"] [aria-label="切换画布标签-Markdown"]',
      ),
    ).toBeNull();
    expect(
      container.querySelector(
        '[data-testid="canvas-workbench-direct-tabs"] [aria-label="切换画布标签-HTML"]',
      ),
    ).toBeNull();
    expect(
      container.querySelector(
        '[data-testid="canvas-workbench-direct-tabs"] [aria-label="切换画布标签-Code"]',
      ),
    ).toBeNull();
    const draftTab = container.querySelector(
      '[data-testid="canvas-workbench-direct-tabs"] [aria-label="切换画布标签-draft.md"]',
    );
    expect(draftTab).not.toBeNull();
    expect(draftTab?.getAttribute("data-canvas-tab-kind")).toBe("markdown");
    expect(
      container.querySelector('[data-testid="canvas-workbench-panel-changes"]'),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[data-testid="canvas-workbench-changes-file-list"]',
      ),
    ).toBeNull();
    expect(
      container
        .querySelector('[data-testid="canvas-workbench-changes-files-toggle"]')
        ?.getAttribute("aria-expanded"),
    ).toBe("false");
    clickByAriaLabel(container, "显示文件");
    await flushEffects();
    expect(
      container
        .querySelector('[data-testid="canvas-workbench-changes-files-toggle"]')
        ?.getAttribute("aria-expanded"),
    ).toBe("true");
    expect(
      container.querySelector(
        '[data-testid="canvas-workbench-changes-file-list"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[data-testid="canvas-workbench-changes-files-resizer"]',
      ),
    ).not.toBeNull();
    clickByAriaLabel(container, "隐藏文件");
    await flushEffects();
    expect(
      container
        .querySelector('[data-testid="canvas-workbench-changes-files-toggle"]')
        ?.getAttribute("aria-expanded"),
    ).toBe("false");
    expect(
      container.querySelector(
        '[data-testid="canvas-workbench-changes-file-list"]',
      ),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="canvas-workbench-header-actions"]')
        ?.textContent ?? "",
    ).toBe("");

    clickByAriaLabel(container, "切换画布标签-draft.md");
    await flushEffects();
    expect(
      container.querySelector('[data-testid="file-preview-markdown"]'),
    ).not.toBeNull();
    toggleFilePreview(container);
    await flushEffects();
    expect(
      container.querySelector('[data-testid="file-preview-code"]'),
    ).not.toBeNull();
    const documentPreviewRegion = container.querySelector(
      '[data-testid="file-preview-panel"]',
    ) as HTMLElement | null;
    expect(documentPreviewRegion?.className).toContain("bg-background");
    expect(documentPreviewRegion?.className).not.toContain("bg-white");
    expect(documentPreviewRegion?.className).not.toContain("rounded-[14px]");
    expect(documentPreviewRegion?.className).not.toContain("border");
    expect(container.textContent).toContain("draft.md");
    expect(
      container.querySelector(
        '[data-testid="canvas-workbench-header-actions"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="canvas-workbench-header-actions"]')
        ?.textContent ?? "",
    ).toBe("");
    const readmeTab = container.querySelector(
      '[data-testid="canvas-workbench-direct-tabs"] [aria-label="切换画布标签-draft.md"]',
    );
    expect(readmeTab).not.toBeNull();
    expect(readmeTab?.getAttribute("data-canvas-tab-kind")).toBe("markdown");

    clickByAriaLabel(container, "复制路径");
    await flushEffects();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "/workspace/draft.md",
    );

    clickByAriaLabel(container, "显示位置");
    await flushEffects();
    expect(onRevealPath).toHaveBeenCalledWith("/workspace/draft.md");

    clickByAriaLabel(container, "打开");
    await flushEffects();
    expect(onOpenPath).toHaveBeenCalledWith("/workspace/draft.md");

    clickByAriaLabel(container, "下载");
    await flushEffects();
    expect(mockReadFileBytes).toHaveBeenCalledWith("/workspace/draft.md");
    expect(globalThis.URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
  }, 15_000);

  it("命中文档产物时应使用 Markdown 与 Code 模式预览，不再走旧文稿 inspector", async () => {
    const artifact = createArtifact(
      "artifact-doc",
      ".lime/artifacts/thread-1/board-review.artifact.json",
      "# 董事会季度复盘\n\n需要优先补齐来源与版本线索。",
      40,
    );
    const container = mount({
      artifacts: [artifact],
      canvasState: null,
      taskFiles: [],
      workspaceRoot: "/workspace",
      defaultPreview: null,
      loadFilePreview: vi.fn(async (path: string) => ({
        path,
        content: null,
        isBinary: true,
        size: 0,
        error: null,
      })),
      onOpenPath: vi.fn(async () => undefined),
      onRevealPath: vi.fn(async () => undefined),
    });

    await flushEffects();

    expect(
      container.querySelector('[data-testid="file-preview-code"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("董事会季度复盘");
    expect(container.textContent).toContain("需要优先补齐来源与版本线索。");
    expect(
      container.querySelector('button[aria-label="展开当前文稿检查器"]'),
    ).toBeNull();
    toggleFilePreview(container);
    await flushEffects();
    expect(
      container.querySelector('[data-testid="file-preview-markdown"]'),
    ).not.toBeNull();
    toggleFilePreview(container);
    await flushEffects();
    expect(
      container.querySelector('[data-testid="file-preview-code"]'),
    ).not.toBeNull();
  });

  it("内容发布主链输出应直接打开真实文件标签，同时预览保留语义标题", async () => {
    const artifact = createArtifact(
      "artifact-content-preview",
      "content-posts/demo-preview.md",
      "# 春日咖啡活动\n\n首屏预览",
      60,
    );
    artifact.meta = {
      ...artifact.meta,
      contentPostIntent: "preview",
      contentPostLabel: "渠道预览稿",
      contentPostPlatformLabel: "小红书",
    };

    const container = mount({
      artifacts: [artifact],
      canvasState: null,
      taskFiles: [],
      workspaceRoot: "/workspace",
      defaultPreview: null,
      loadFilePreview: vi.fn(async (path: string) => ({
        path,
        content: null,
        isBinary: true,
        size: 0,
        error: null,
      })),
      onOpenPath: vi.fn(async () => undefined),
      onRevealPath: vi.fn(async () => undefined),
    });

    await flushEffects();

    expect(
      container.querySelector('[data-testid="file-preview-markdown"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("渠道预览稿");
    const previewTab = container.querySelector(
      '[data-testid="canvas-workbench-direct-tabs"] [aria-label="切换画布标签-demo-preview.md"]',
    );
    expect(previewTab).not.toBeNull();
    expect(previewTab?.getAttribute("data-canvas-tab-kind")).toBe("markdown");
    expect(
      container.querySelector(
        '[data-testid="canvas-workbench-direct-tabs"] [aria-label="切换画布标签-渠道预览稿"]',
      ),
    ).toBeNull();
  });

  it("previewOpenRequest 命中媒体 preview artifact 时应打开统一 artifact 预览", async () => {
    const artifact = createArtifact(
      "preview-session-file-image",
      "/tmp/imported-attachment.png",
      "asset://imported-attachment.png",
      80,
    );
    artifact.meta = {
      ...artifact.meta,
      previewArtifact: true,
      isSourceBacked: true,
      source: "session_file",
      sourceRef: "/tmp/imported-attachment.png",
      sourcePath: "/tmp/imported-attachment.png",
      contentKind: "image",
      renderMode: "media",
      previewUrl: "asset://imported-attachment.png",
      openedFrom: "message-attachment",
    };

    const onPreviewOpenRequestHandled = vi.fn();
    const container = mount({
      artifacts: [artifact],
      canvasState: null,
      taskFiles: [],
      workspaceRoot: "/workspace",
      defaultPreview: null,
      loadFilePreview: vi.fn(async (path: string) => ({
        path,
        content: null,
        isBinary: true,
        size: 0,
        error: null,
      })),
      onOpenPath: vi.fn(async () => undefined),
      onRevealPath: vi.fn(async () => undefined),
      previewOpenRequest: {
        requestKey: 1,
        filePath: "/tmp/imported-attachment.png",
        selectionKey: "artifact:preview-session-file-image",
      },
      onPreviewOpenRequestHandled,
    });

    await flushEffects();

    expect(onPreviewOpenRequestHandled).toHaveBeenCalledWith(1);
    const image = container.querySelector(
      '[data-testid="preview-artifact-image"]',
    ) as HTMLImageElement | null;
    expect(image).not.toBeNull();
    expect(image?.getAttribute("src")).toBe("asset://imported-attachment.png");
    expect(
      container.querySelector('[data-testid="file-preview-panel"]')
        ?.textContent,
    ).toContain("imported-attachment.png");
  });

  it("当前停在图片附件时，previewOpenRequest 应切到导入 Markdown artifact", async () => {
    const imageArtifact = createArtifact(
      "preview-session-file-image",
      "/tmp/attachment-1.png",
      "asset://attachment-1.png",
      70,
    );
    imageArtifact.meta = {
      ...imageArtifact.meta,
      previewArtifact: true,
      isSourceBacked: true,
      source: "session_file",
      sourceRef: "/tmp/attachment-1.png",
      sourcePath: "/tmp/attachment-1.png",
      contentKind: "image",
      renderMode: "media",
      previewUrl: "asset://attachment-1.png",
      openedFrom: "message-attachment",
    };
    const markdownArtifact = createArtifact(
      "preview-imported-markdown",
      "/tmp/imported-preview.md",
      "# 导入会话 Markdown 预览内容\n\n文件打开链路进入 Artifact Workbench。",
      80,
    );
    markdownArtifact.meta = {
      ...markdownArtifact.meta,
      previewArtifact: true,
      isSourceBacked: true,
      source: "file",
      sourceRef: "/tmp/imported-preview.md",
      sourcePath: "/tmp/imported-preview.md",
      filePath: "/tmp/imported-preview.md",
      contentKind: "markdown",
      renderMode: "inline",
      openedFrom: "general-workbench-file",
    };

    const onPreviewOpenRequestHandled = vi.fn();
    const container = mount({
      artifacts: [imageArtifact, markdownArtifact],
      canvasState: null,
      taskFiles: [],
      workspaceRoot: "/workspace",
      defaultPreview: {
        selectionKey: "artifact:preview-session-file-image",
        title: "attachment-1",
        content: "asset://attachment-1.png",
        filePath: "/tmp/attachment-1.png",
        absolutePath: "/tmp/attachment-1.png",
        previousContent: null,
      } satisfies CanvasWorkbenchDefaultPreview,
      loadFilePreview: vi.fn(async (path: string) => ({
        path,
        content: null,
        isBinary: true,
        size: 0,
        error: null,
      })),
      onOpenPath: vi.fn(async () => undefined),
      onRevealPath: vi.fn(async () => undefined),
      previewOpenRequest: {
        requestKey: 12,
        filePath: "/tmp/imported-preview.md",
        selectionKey: "artifact:preview-imported-markdown",
      },
      onPreviewOpenRequestHandled,
    });

    await flushEffects();

    expect(onPreviewOpenRequestHandled).toHaveBeenCalledWith(12);
    expect(
      container.querySelector('[data-testid="file-preview-markdown"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="file-preview-panel"]')
        ?.textContent,
    ).toContain("导入会话 Markdown 预览内容");
    expect(
      container.querySelector('[data-testid="file-preview-panel"]')
        ?.textContent,
    ).not.toContain("attachment-1.png");
  });

  it("当前停在图片附件时，previewOpenRequest 应切到更新后的工作区文件默认预览", async () => {
    const imageArtifact = createArtifact(
      "preview-session-file-image-before-default-preview",
      "/tmp/attachment-before-default-preview.png",
      "asset://attachment-before-default-preview.png",
      70,
    );
    imageArtifact.meta = {
      ...imageArtifact.meta,
      previewArtifact: true,
      isSourceBacked: true,
      source: "session_file",
      sourceRef: "/tmp/attachment-before-default-preview.png",
      sourcePath: "/tmp/attachment-before-default-preview.png",
      contentKind: "image",
      renderMode: "media",
      previewUrl: "asset://attachment-before-default-preview.png",
      openedFrom: "message-attachment",
    };

    const onPreviewOpenRequestHandled = vi.fn();
    const baseProps: CanvasWorkbenchLayoutProps = {
      artifacts: [imageArtifact],
      canvasState: null,
      taskFiles: [],
      workspaceRoot: "/workspace",
      defaultPreview: null,
      loadFilePreview: vi.fn(async (path: string) => ({
        path,
        content: null,
        isBinary: true,
        size: 0,
        error: null,
      })),
      onOpenPath: vi.fn(async () => undefined),
      onRevealPath: vi.fn(async () => undefined),
      previewOpenRequest: {
        requestKey: 12,
        filePath: "/tmp/attachment-before-default-preview.png",
        selectionKey:
          "artifact:preview-session-file-image-before-default-preview",
      },
      onPreviewOpenRequestHandled,
    };

    const harness = mountHarness(baseProps);
    await flushEffects();

    expect(onPreviewOpenRequestHandled).toHaveBeenCalledWith(12);
    expect(
      harness.container.querySelector('[data-testid="preview-artifact-image"]'),
    ).not.toBeNull();

    onPreviewOpenRequestHandled.mockClear();
    const markdownSelectionKey = "default-preview:/tmp/imported-preview.md";
    harness.rerender({
      ...baseProps,
      defaultPreview: {
        selectionKey: markdownSelectionKey,
        title: "imported-preview.md",
        content: "# 导入会话 Markdown 预览内容\n\n来自工作区文件预览。",
        filePath: "/tmp/imported-preview.md",
        absolutePath: "/tmp/imported-preview.md",
        previousContent: null,
      },
      previewOpenRequest: {
        requestKey: 13,
        filePath: "/tmp/imported-preview.md",
        selectionKey: markdownSelectionKey,
      },
      onPreviewOpenRequestHandled,
    });
    await flushEffects();

    expect(onPreviewOpenRequestHandled).toHaveBeenCalledWith(13);
    expect(
      harness.container.querySelector('[data-testid="file-preview-markdown"]'),
    ).not.toBeNull();
    expect(
      harness.container.querySelector('[data-testid="file-preview-panel"]')
        ?.textContent,
    ).toContain("来自工作区文件预览");
    expect(
      harness.container.querySelector('[data-testid="preview-artifact-image"]'),
    ).toBeNull();
    const shell = harness.container.querySelector(
      '[data-testid="canvas-workbench-shell"]',
    ) as HTMLElement | null;
    expect(shell?.dataset.documentSelectionKey).toBe(markdownSelectionKey);
    expect(shell?.dataset.documentContextKey).toBe(markdownSelectionKey);
    expect(shell?.dataset.previewRequestSelectionKey).toBe(
      markdownSelectionKey,
    );
  });

  it("工作区默认预览连续切换时应先更新内部 selection 再确认请求", async () => {
    const markdownPreview = {
      selectionKey: "default-preview:/tmp/imported-preview.md",
      title: "imported-preview.md",
      content: "# Markdown 预览",
      filePath: "/tmp/imported-preview.md",
      absolutePath: "/tmp/imported-preview.md",
      previousContent: null,
    } satisfies CanvasWorkbenchDefaultPreview;
    const onPreviewOpenRequestHandled = vi.fn();
    const baseProps: CanvasWorkbenchLayoutProps = {
      artifacts: [],
      canvasState: null,
      taskFiles: [],
      workspaceRoot: "/workspace",
      defaultPreview: markdownPreview,
      loadFilePreview: vi.fn(async (path: string) => ({
        path,
        content: null,
        isBinary: true,
        size: 0,
        error: null,
      })),
      onOpenPath: vi.fn(async () => undefined),
      onRevealPath: vi.fn(async () => undefined),
    };
    const harness = mountHarness(baseProps);
    await flushEffects();

    expect(
      harness.container.querySelector('[data-testid="file-preview-markdown"]'),
    ).not.toBeNull();

    const htmlSelectionKey = "default-preview:/tmp/imported-preview.html";
    harness.rerender({
      ...baseProps,
      defaultPreview: {
        selectionKey: htmlSelectionKey,
        title: "imported-preview.html",
        content: "<!doctype html><html><body>HTML 预览</body></html>",
        filePath: "/tmp/imported-preview.html",
        absolutePath: "/tmp/imported-preview.html",
        previousContent: null,
      },
      previewOpenRequest: {
        requestKey: 14,
        filePath: "/tmp/imported-preview.html",
        selectionKey: htmlSelectionKey,
      },
      onPreviewOpenRequestHandled,
    });
    await flushEffects();

    expect(onPreviewOpenRequestHandled).toHaveBeenCalledWith(14);
    expect(
      harness.container.querySelector('[data-testid="file-preview-html"]'),
    ).not.toBeNull();
    const shell = harness.container.querySelector(
      '[data-testid="canvas-workbench-shell"]',
    ) as HTMLElement | null;
    expect(shell?.dataset.documentSelectionKey).toBe(htmlSelectionKey);
    expect(shell?.dataset.documentContextKey).toBe(htmlSelectionKey);
  });

  it("previewOpenRequest 早于 artifact 入库时应等待选择上下文命中再确认并切到 HTML 预览", async () => {
    const imageArtifact = createArtifact(
      "preview-session-file-image-before-html",
      "/tmp/attachment-before-html.png",
      "asset://attachment-before-html.png",
      70,
    );
    imageArtifact.meta = {
      ...imageArtifact.meta,
      previewArtifact: true,
      isSourceBacked: true,
      source: "session_file",
      sourceRef: "/tmp/attachment-before-html.png",
      sourcePath: "/tmp/attachment-before-html.png",
      contentKind: "image",
      renderMode: "media",
      previewUrl: "asset://attachment-before-html.png",
      openedFrom: "message-attachment",
    };
    const artifact = createArtifact(
      "preview-imported-html",
      "/tmp/imported-preview.html",
      "<!doctype html><html><body>导入 HTML 预览内容</body></html>",
      80,
    );
    artifact.type = "html";
    artifact.meta = {
      ...artifact.meta,
      previewArtifact: true,
      isSourceBacked: true,
      source: "file",
      sourceRef: "/tmp/imported-preview.html",
      sourcePath: "/tmp/imported-preview.html",
      filePath: "/tmp/imported-preview.html",
      contentKind: "html",
      renderMode: "external_window",
      openedFrom: "general-workbench-file",
    };

    const onPreviewOpenRequestHandled = vi.fn();
    const baseProps: CanvasWorkbenchLayoutProps = {
      artifacts: [imageArtifact],
      canvasState: null,
      taskFiles: [],
      workspaceRoot: "/workspace",
      defaultPreview: {
        selectionKey: "artifact:preview-session-file-image-before-html",
        title: "attachment-before-html",
        content: "asset://attachment-before-html.png",
        filePath: "/tmp/attachment-before-html.png",
        absolutePath: "/tmp/attachment-before-html.png",
        previousContent: null,
      } satisfies CanvasWorkbenchDefaultPreview,
      loadFilePreview: vi.fn(async (path: string) => ({
        path,
        content: null,
        isBinary: true,
        size: 0,
        error: null,
      })),
      onOpenPath: vi.fn(async () => undefined),
      onRevealPath: vi.fn(async () => undefined),
      previewOpenRequest: {
        requestKey: 11,
        filePath: "/tmp/imported-preview.html",
        selectionKey: "artifact:preview-imported-html",
      },
      onPreviewOpenRequestHandled,
    };

    const harness = mountHarness(baseProps);
    await flushEffects();

    expect(onPreviewOpenRequestHandled).not.toHaveBeenCalled();

    harness.rerender({
      ...baseProps,
      artifacts: [imageArtifact, artifact],
    });
    await flushEffects();

    expect(onPreviewOpenRequestHandled).toHaveBeenCalledWith(11);
    expect(
      harness.container.querySelector('[data-testid="file-preview-html"]'),
    ).not.toBeNull();
    expect(
      harness.container
        .querySelector('[data-testid="file-preview-panel"]')
        ?.getAttribute("data-preview-mode"),
    ).toBe("html");
    expect(harness.container.textContent).toContain("imported-preview.html");
  });

  it("容器变窄时应继续保持顶部标签壳，但 data-layout-mode 切到 stacked", async () => {
    const container = mount({
      artifacts: [
        createArtifact("artifact-new", "draft.md", "标题\n产物版本", 20),
      ],
      canvasState: null,
      taskFiles: [
        createTaskFile("task-current", "draft.md", "标题\n当前画布正文", 30),
      ],
      selectedFileId: "task-current",
      workspaceRoot: "/workspace",
      defaultPreview: {
        selectionKey: "task:task-current",
        title: "draft.md",
        content: "标题\n当前画布正文",
        filePath: "draft.md",
        absolutePath: "/workspace/draft.md",
        previousContent: "标题\n上一版本",
      } satisfies CanvasWorkbenchDefaultPreview,
      loadFilePreview: vi.fn(async (path: string) => ({
        path,
        content: "README 内容",
        isBinary: false,
        size: 12,
        error: null,
      })),
      onOpenPath: vi.fn(async () => undefined),
      onRevealPath: vi.fn(async () => undefined),
    });

    await flushEffects();

    expect(
      container
        .querySelector('[data-testid="canvas-workbench-shell"]')
        ?.getAttribute("data-layout-mode"),
    ).toBe("split");

    await resizeWorkbench(820);
    await flushEffects();

    expect(
      container
        .querySelector('[data-testid="canvas-workbench-shell"]')
        ?.getAttribute("data-layout-mode"),
    ).toBe("stacked");
    expect(
      container.querySelector('button[aria-label="展开画布工作台"]'),
    ).toBeNull();
    expect(
      container.querySelector('button[aria-label="切换画布标签-审查"]'),
    ).not.toBeNull();

    clickByAriaLabel(container, "切换画布标签-draft.md");
    await flushEffects();
    expect(
      container.querySelector('[data-testid="file-preview-markdown"]'),
    ).not.toBeNull();
  });
});
