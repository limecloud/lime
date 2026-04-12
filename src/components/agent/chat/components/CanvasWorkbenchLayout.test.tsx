import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArtifactDocumentV1 } from "@/lib/artifact-document";
import type { Artifact } from "@/lib/artifact/types";
import type { TaskFile } from "./TaskFiles";
import {
  CanvasWorkbenchLayout,
  type CanvasWorkbenchDefaultPreview,
  type CanvasWorkbenchPreviewTarget,
} from "./CanvasWorkbenchLayout";
import type { ArtifactWorkbenchDocumentController } from "../workspace/artifactWorkbenchDocument";

type MockResizeObserverCallback = (
  entries: Array<{
    target: Element;
    contentRect: {
      width: number;
      height: number;
    };
  }>,
  observer: unknown,
) => void;

const { mockListDirectory, mockToast, resizeObserverState } = vi.hoisted(
  () => ({
    mockListDirectory: vi.fn(),
    mockToast: {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    },
    resizeObserverState: {
      width: 1280,
      observers: [] as Array<{
        callback: MockResizeObserverCallback;
        target: Element | null;
      }>,
    },
  }),
);

vi.mock("sonner", () => ({
  toast: mockToast,
}));

vi.mock("@/lib/api/fileBrowser", () => ({
  listDirectory: mockListDirectory,
}));

interface MountedHarness {
  container: HTMLDivElement;
  root: Root;
  rerender: (props: React.ComponentProps<typeof CanvasWorkbenchLayout>) => void;
}

const mountedRoots: MountedHarness[] = [];

function createArtifact(
  id: string,
  filePath: string,
  content: string,
  updatedAt: number,
): Artifact {
  return {
    id,
    type: "document",
    title: filePath.split("/").pop() || filePath,
    content,
    status: "complete",
    meta: {
      filePath,
      filename: filePath.split("/").pop() || filePath,
      previewText: content,
    },
    position: { start: 0, end: content.length },
    createdAt: updatedAt - 100,
    updatedAt,
  };
}

function createTaskFile(
  id: string,
  name: string,
  content: string,
  updatedAt: number,
): TaskFile {
  return {
    id,
    name,
    type: "document",
    content,
    version: 1,
    createdAt: updatedAt - 100,
    updatedAt,
  };
}

function createMockArtifactDocumentController(
  overrides: Partial<ArtifactWorkbenchDocumentController> = {},
): ArtifactWorkbenchDocumentController {
  const versionHistory = [
    {
      id: "artifact-document:demo:v1",
      artifactId: "artifact-document:demo",
      versionNo: 1,
      title: "董事会季度复盘",
      summary: "第一版摘要",
      status: "ready" as const,
      createdAt: "2026-03-25T10:00:00Z",
    },
    {
      id: "artifact-document:demo:v2",
      artifactId: "artifact-document:demo",
      versionNo: 2,
      title: "董事会季度复盘",
      summary: "补齐来源与版本信息",
      status: "ready" as const,
      createdAt: "2026-03-26T10:00:00Z",
    },
  ];
  const currentVersionDiff = {
    baseVersionId: "artifact-document:demo:v1",
    baseVersionNo: 1,
    targetVersionId: "artifact-document:demo:v2",
    targetVersionNo: 2,
    updatedCount: 1,
    addedCount: 0,
    removedCount: 0,
    movedCount: 0,
    changedBlocks: [
      {
        blockId: "body-1",
        changeType: "updated" as const,
        beforeText: "旧正文",
        afterText: "正文内容",
        summary: "更新 block 内容",
      },
    ],
  };
  const editableDraft = {
    editorKind: "rich_text" as const,
    markdown: "正文内容",
  };
  const selectedEditableBlock = {
    blockId: "body-1",
    label: "正文块 1",
    detail: "正文",
    editorKind: "rich_text" as const,
    draft: editableDraft,
  };
  const document: ArtifactDocumentV1 = {
    schemaVersion: "artifact_document.v1",
    artifactId: "artifact-document:demo",
    kind: "analysis" as const,
    title: "董事会季度复盘",
    status: "ready" as const,
    language: "zh-CN",
    summary: "需要优先补齐来源与版本线索。",
    blocks: [
      {
        id: "body-1",
        type: "rich_text" as const,
        contentFormat: "markdown" as const,
        content: "正文内容",
        markdown: "正文内容",
      },
    ],
    sources: [
      {
        id: "source-1",
        type: "web" as const,
        label: "OpenAI Blog",
        locator: {
          url: "https://openai.com",
        },
      },
    ],
    metadata: {
      currentVersionId: "artifact-document:demo:v2",
      currentVersionNo: 2,
      currentVersionDiff,
      versionHistory,
    },
  };

  return {
    artifact: createArtifact(
      "artifact-doc",
      ".lime/artifacts/thread-1/board-review.artifact.json",
      JSON.stringify(document),
      40,
    ),
    document,
    currentVersion: versionHistory[1],
    currentVersionDiff,
    versionHistory,
    sourceLinks: [
      {
        artifactId: "artifact-document:demo",
        blockId: "body-1",
        sourceId: "source-1",
        sourceType: "web",
        sourceRef: "https://openai.com",
        label: "OpenAI Blog",
      },
    ],
    timelineLinksByBlockId: {},
    recoveryPresentation: null,
    canEditDocument: true,
    canMarkAsReady: false,
    inspectorTab: "overview",
    setInspectorTab: vi.fn(),
    editableBlocks: [selectedEditableBlock],
    draftByBlockId: {
      "body-1": editableDraft,
    },
    selectedEditableBlock,
    selectedEditableDraft: editableDraft,
    selectedTimelineLink: null,
    isSavingEdit: false,
    isUpdatingRecoveryState: false,
    editSaveError: null,
    recoveryActionError: null,
    lastSavedAt: null,
    rendererViewportRef: { current: null },
    focusBlock: vi.fn(),
    selectEditableBlock: vi.fn(),
    handleEditDraftChange: vi.fn(),
    handleEditCancel: vi.fn(),
    handleEditSave: vi.fn(async () => undefined),
    handleContinueEditing: vi.fn(),
    handleMarkAsReady: vi.fn(async () => undefined),
    onJumpToTimelineItem: vi.fn(),
    ...overrides,
  };
}

function MockArtifactDocumentPreview({
  controller,
  target,
  onArtifactDocumentControllerChange,
}: {
  controller: ArtifactWorkbenchDocumentController | null;
  target: CanvasWorkbenchPreviewTarget;
  onArtifactDocumentControllerChange?: (
    controller: ArtifactWorkbenchDocumentController | null,
  ) => void;
}) {
  React.useEffect(() => {
    onArtifactDocumentControllerChange?.(
      target.kind === "artifact" ? controller : null,
    );
    return () => {
      onArtifactDocumentControllerChange?.(null);
    };
  }, [controller, onArtifactDocumentControllerChange, target.kind]);

  return (
    <div data-testid="preview-panel">
      {target.kind}:{target.title}
    </div>
  );
}

function mountHarness(
  props: React.ComponentProps<typeof CanvasWorkbenchLayout>,
): MountedHarness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let currentProps = props;

  act(() => {
    root.render(<CanvasWorkbenchLayout {...currentProps} />);
  });

  const harness: MountedHarness = {
    container,
    root,
    rerender: (nextProps) => {
      currentProps = nextProps;
      act(() => {
        root.render(<CanvasWorkbenchLayout {...currentProps} />);
      });
    },
  };

  mountedRoots.push(harness);
  return harness;
}

function mount(
  props: React.ComponentProps<typeof CanvasWorkbenchLayout>,
): HTMLDivElement {
  return mountHarness(props).container;
}

async function flushEffects(times = 6) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function resizeWorkbench(width: number, height = 720) {
  resizeObserverState.width = width;
  await act(async () => {
    resizeObserverState.observers.forEach((observer) => {
      if (!observer.target) {
        return;
      }
      observer.callback(
        [
          {
            target: observer.target,
            contentRect: {
              width,
              height,
            },
          },
        ],
        {},
      );
    });
    await Promise.resolve();
  });
}

function clickByAriaLabel(container: HTMLElement, ariaLabel: string) {
  const element = container.querySelector(
    `[aria-label="${ariaLabel}"]`,
  ) as HTMLElement | null;
  if (!element) {
    throw new Error(`未找到元素: ${ariaLabel}`);
  }

  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  vi.clearAllMocks();
  resizeObserverState.width = 1280;
  resizeObserverState.observers = [];

  vi.stubGlobal(
    "ResizeObserver",
    class ResizeObserver {
      private callback: MockResizeObserverCallback;
      private target: Element | null = null;

      constructor(callback: MockResizeObserverCallback) {
        this.callback = callback;
      }

      observe = (target: Element) => {
        this.target = target;
        resizeObserverState.observers.push({
          callback: this.callback,
          target,
        });
        this.callback(
          [
            {
              target,
              contentRect: {
                width: resizeObserverState.width,
                height: 720,
              },
            },
          ],
          this,
        );
      };

      unobserve = () => {};

      disconnect = () => {
        resizeObserverState.observers = resizeObserverState.observers.filter(
          (observer) =>
            observer.callback !== this.callback ||
            observer.target !== this.target,
        );
      };
    },
  );

  mockListDirectory.mockImplementation(async (path: string) => {
    if (path === "/workspace") {
      return {
        path,
        parentPath: null,
        error: null,
        entries: [
          {
            name: ".lime",
            path: "/workspace/.lime",
            isDir: true,
            size: 0,
            modifiedAt: 100,
          },
          {
            name: "exports",
            path: "/workspace/exports",
            isDir: true,
            size: 0,
            modifiedAt: 100,
          },
          {
            name: "output",
            path: "/workspace/output",
            isDir: true,
            size: 0,
            modifiedAt: 100,
          },
          {
            name: ".DS_Store",
            path: "/workspace/.DS_Store",
            isDir: false,
            size: 10,
            modifiedAt: 100,
          },
          {
            name: "output_image.jpg",
            path: "/workspace/output_image.jpg",
            isDir: false,
            size: 512,
            modifiedAt: 100,
          },
          {
            name: "README.md",
            path: "/workspace/README.md",
            isDir: false,
            size: 128,
            modifiedAt: 100,
          },
          {
            name: "src",
            path: "/workspace/src",
            isDir: true,
            size: 0,
            modifiedAt: 100,
          },
        ],
      };
    }

    if (path === "/workspace/src") {
      return {
        path,
        parentPath: "/workspace",
        error: null,
        entries: [
          {
            name: "binary.dat",
            path: "/workspace/src/binary.dat",
            isDir: false,
            size: 2048,
            modifiedAt: 100,
          },
        ],
      };
    }

    if (path === "/workspace/exports/x-article-export/latest") {
      return {
        path,
        parentPath: "/workspace/exports/x-article-export",
        error: null,
        entries: [
          {
            name: "manifest.json",
            path: "/workspace/exports/x-article-export/latest/manifest.json",
            isDir: false,
            size: 1024,
            modifiedAt: 100,
          },
          {
            name: "images",
            path: "/workspace/exports/x-article-export/latest/images",
            isDir: true,
            size: 0,
            modifiedAt: 100,
          },
          {
            name: "skills",
            path: "/workspace/exports/x-article-export/latest/skills",
            isDir: true,
            size: 0,
            modifiedAt: 100,
          },
          {
            name: "Agents.md",
            path: "/workspace/exports/x-article-export/latest/Agents.md",
            isDir: false,
            size: 256,
            modifiedAt: 100,
          },
          {
            name: "index.md",
            path: "/workspace/exports/x-article-export/latest/index.md",
            isDir: false,
            size: 2048,
            modifiedAt: 100,
          },
        ],
      };
    }

    return {
      path,
      parentPath: "/workspace",
      error: null,
      entries: [],
    };
  });

  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: vi.fn(async () => undefined),
    },
  });

  Object.defineProperty(globalThis.URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:canvas-workbench"),
  });
  Object.defineProperty(globalThis.URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });

  HTMLAnchorElement.prototype.click = vi.fn();
});

afterEach(() => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) {
      break;
    }
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
});

describe("CanvasWorkbenchLayout", () => {
  it("应以顶部标签式画布承载 session、文件与结果文件标签", async () => {
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
      workspaceUnavailable: false,
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
      renderPreview: (target) => (
        <div data-testid="preview-panel">
          {target.kind}:{target.title}
        </div>
      ),
    });

    await flushEffects();

    expect(mockListDirectory).toHaveBeenCalledWith("/workspace");
    expect(
      container
        .querySelector('[data-testid="canvas-workbench-shell"]')
        ?.getAttribute("data-layout-mode"),
    ).toBe("split");
    expect(
      container.querySelector(
        'button[aria-label="切换画布标签-Session · Main"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector('button[aria-label="切换画布标签-文件"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('button[aria-label="切换画布标签-outputs"]'),
    ).toBeNull();
    expect(
      container.querySelector('button[aria-label="切换画布标签-draft.md"]'),
    ).not.toBeNull();
    expect(
      container.querySelectorAll('button[aria-label="切换画布标签-draft.md"]'),
    ).toHaveLength(1);
    expect(
      container.querySelector('[data-testid="preview-panel"]')?.textContent,
    ).toContain("default-canvas:draft.md");

    clickByAriaLabel(container, "切换画布标签-文件");
    await flushEffects();

    expect(container.textContent).not.toContain(".lime");
    expect(container.textContent).toContain("exports");
    expect(container.textContent).not.toContain("output_image.jpg");
    expect(container.textContent).not.toContain(".DS_Store");
    clickByAriaLabel(container, "选择工作区文件-README.md");
    await flushEffects();

    expect(loadFilePreview).toHaveBeenCalledWith("/workspace/README.md");
    expect(
      container.querySelector('[data-testid="preview-panel"]')?.textContent,
    ).toContain("default-canvas:README.md");
    expect(
      container.querySelector('button[aria-label="切换画布标签-README.md"]'),
    ).not.toBeNull();

    clickByAriaLabel(container, "复制当前路径");
    await flushEffects();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "/workspace/README.md",
    );

    clickByAriaLabel(container, "定位当前文件");
    await flushEffects();
    expect(onRevealPath).toHaveBeenCalledWith("/workspace/README.md");

    clickByAriaLabel(container, "系统打开当前文件");
    await flushEffects();
    expect(onOpenPath).toHaveBeenCalledWith("/workspace/README.md");

    clickByAriaLabel(container, "下载当前画布项");
    expect(globalThis.URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);

    clickByAriaLabel(container, "关闭文件标签-README.md");
    await flushEffects();
    expect(
      container.querySelector('button[aria-label="切换画布标签-README.md"]'),
    ).toBeNull();
  });

  it("命中导出结果文件时应将文件树聚焦到当前结果目录", async () => {
    const container = mount({
      artifacts: [],
      canvasState: null,
      taskFiles: [],
      workspaceRoot: "/workspace",
      workspaceUnavailable: false,
      defaultPreview: {
        selectionKey: "default-preview:exports/x-article-export/latest/index.md",
        title: "index.md",
        content: "# 导出结果\n\n这是正文。",
        filePath: "exports/x-article-export/latest/index.md",
        absolutePath: "/workspace/exports/x-article-export/latest/index.md",
        previousContent: null,
      },
      loadFilePreview: vi.fn(async (path: string) => ({
        path,
        content: "# 文件内容",
        isBinary: false,
        size: 128,
        error: null,
      })),
      onOpenPath: vi.fn(async () => undefined),
      onRevealPath: vi.fn(async () => undefined),
      renderPreview: (target) => (
        <div data-testid="preview-panel">
          {target.kind}:{target.title}
        </div>
      ),
    });

    await flushEffects();
    clickByAriaLabel(container, "切换画布标签-文件");
    await flushEffects();

    expect(mockListDirectory).toHaveBeenCalledWith(
      "/workspace/exports/x-article-export/latest",
    );
    expect(container.textContent).toContain("结果目录");
    expect(container.textContent).toContain("exports/x-article-export/latest");

    const workspaceButtons = Array.from(
      container.querySelectorAll(
        '[data-testid="canvas-workbench-panel-workspace"] button[aria-label]',
      ),
    ).map((element) => element.getAttribute("aria-label"));

    expect(workspaceButtons).toContain("选择工作区文件-index.md");
    expect(workspaceButtons).toContain("选择工作区文件-Agents.md");
    expect(workspaceButtons).toContain("展开目录-skills");
    expect(workspaceButtons).toContain("展开目录-images");

    const indexButtonPosition = workspaceButtons.indexOf("选择工作区文件-index.md");
    const agentsButtonPosition =
      workspaceButtons.indexOf("选择工作区文件-Agents.md");
    const manifestButtonPosition =
      workspaceButtons.indexOf("选择工作区文件-manifest.json");

    expect(indexButtonPosition).toBeGreaterThanOrEqual(0);
    expect(agentsButtonPosition).toBeGreaterThan(indexButtonPosition);
    expect(manifestButtonPosition).toBeGreaterThan(agentsButtonPosition);
  });

  it("命中文档产物时应在文件标签内提供文稿 inspector", async () => {
    const controller = createMockArtifactDocumentController();

    const container = mount({
      artifacts: [controller.artifact],
      canvasState: null,
      taskFiles: [],
      workspaceRoot: "/workspace",
      workspaceUnavailable: false,
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
      renderPreview: (target, options) => (
        <MockArtifactDocumentPreview
          controller={controller}
          target={target}
          onArtifactDocumentControllerChange={
            options?.onArtifactDocumentControllerChange
          }
        />
      ),
    });

    await flushEffects();

    expect(
      container.querySelector('[data-testid="preview-panel"]')?.textContent,
    ).toContain("artifact:board-review.artifact.json");
    expect(container.textContent).toContain("当前文稿");
    expect(container.textContent).toContain("董事会季度复盘");
    expect(container.textContent).toContain("需要优先补齐来源与版本线索。");
    expect(
      container.querySelector('button[aria-label="展开当前文稿检查器"]'),
    ).not.toBeNull();

    clickByAriaLabel(container, "展开当前文稿检查器");
    await flushEffects();

    expect(
      container.querySelector(
        '[data-testid="canvas-workbench-document-inspector"]',
      ),
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
      workspaceUnavailable: false,
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
      renderPreview: (target) => (
        <div data-testid="preview-panel">
          {target.kind}:{target.title}
        </div>
      ),
    });

    await flushEffects();

    expect(
      container.querySelector('[data-testid="preview-panel"]')?.textContent,
    ).toContain("artifact:渠道预览稿");
    expect(
      container.querySelector(
        'button[aria-label="切换画布标签-demo-preview.md"]',
      ),
    ).not.toBeNull();
  });

  it("sessionView 存在但没有默认主稿时，Session · Main 应回退渲染会话过程面板", async () => {
    const renderPreview = vi.fn((target: CanvasWorkbenchPreviewTarget) => (
      <div data-testid="preview-panel">
        {target.kind}:{target.title}
      </div>
    ));
    const renderSessionPanel = vi.fn(() => (
      <div data-testid="session-view-panel">session-runtime-panel</div>
    ));

    const container = mount({
      artifacts: [],
      canvasState: null,
      taskFiles: [],
      workspaceRoot: "/workspace",
      workspaceUnavailable: false,
      defaultPreview: null,
      loadFilePreview: vi.fn(async (path: string) => ({
        path,
        content: "",
        isBinary: false,
        size: 0,
        error: null,
      })),
      onOpenPath: vi.fn(async () => undefined),
      onRevealPath: vi.fn(async () => undefined),
      renderPreview,
      sessionView: {
        eyebrow: "Session Runtime",
        title: "执行过程",
        subtitle: "展示技能、工具和待处理交互。",
        badges: [
          {
            key: "session-status",
            label: "执行中",
            tone: "accent",
          },
        ],
        renderPanel: renderSessionPanel,
      },
    });

    await flushEffects();

    expect(
      container.querySelector('[data-testid="canvas-workbench-panel-session"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="session-view-panel"]')
        ?.textContent,
    ).toContain("session-runtime-panel");
    expect(renderSessionPanel).toHaveBeenCalled();
    expect(renderPreview).not.toHaveBeenCalled();
  });

  it("workspaceView 存在时，应优先使用运行时注入的头部语义", async () => {
    const container = mount({
      artifacts: [createArtifact("artifact-1", "draft.md", "标题\n内容", 20)],
      canvasState: null,
      taskFiles: [createTaskFile("task-1", "notes.md", "# notes", 30)],
      workspaceRoot: "/workspace",
      workspaceUnavailable: false,
      defaultPreview: null,
      loadFilePreview: vi.fn(async (path: string) => ({
        path,
        content: "README 内容",
        isBinary: false,
        size: 12,
        error: null,
      })),
      onOpenPath: vi.fn(async () => undefined),
      onRevealPath: vi.fn(async () => undefined),
      renderPreview: (target) => (
        <div data-testid="preview-panel">
          {target.kind}:{target.title}
        </div>
      ),
      workspaceView: {
        eyebrow: "Runtime Workspace",
        tabLabel: "项目文件",
        tabBadge: "已连接",
        tabBadgeTone: "sky",
        title: "工作区文件",
        subtitle: "运行时已经为 workspace 汇总了目录语义。",
        panelCopy: {
          emptyText: "工作区空态来自运行时。",
          unavailableText: "工作区不可用提示来自运行时。",
          sectionEyebrow: "运行时目录",
          loadingText: "目录加载文案来自运行时。",
          emptyDirectoryText: "目录空态来自运行时。",
        },
        badges: [
          {
            key: "workspace-runtime",
            label: "已连接",
            tone: "accent",
          },
        ],
        summaryStats: [
          {
            key: "workspace-runtime-stat",
            label: "目录状态",
            value: "运行时注入",
            detail: "workspace 头部信息不再由布局壳推断。",
            tone: "success",
          },
        ],
      },
    });

    await flushEffects();

    expect(
      container.querySelector('button[aria-label="切换画布标签-项目文件"]'),
    ).not.toBeNull();

    clickByAriaLabel(container, "切换画布标签-项目文件");
    await flushEffects();

    expect(container.textContent).toContain("运行时目录");
  });

  it("workspaceView 的 panelCopy 应覆盖空态与不可用提示", async () => {
    const unavailableContainer = mount({
      artifacts: [],
      canvasState: null,
      taskFiles: [],
      workspaceRoot: "/workspace",
      workspaceUnavailable: true,
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
      renderPreview: (target) => <div>{target.title}</div>,
      workspaceView: {
        panelCopy: {
          unavailableText: "工作区不可用提示来自运行时。",
        },
      },
    });

    await flushEffects();

    clickByAriaLabel(unavailableContainer, "切换画布标签-文件");
    await flushEffects();
    expect(unavailableContainer.textContent).toContain(
      "工作区不可用提示来自运行时。",
    );

    const emptyWorkspaceContainer = mount({
      artifacts: [],
      canvasState: null,
      taskFiles: [],
      workspaceRoot: null,
      workspaceUnavailable: false,
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
      renderPreview: (target) => <div>{target.title}</div>,
      workspaceView: {
        panelCopy: {
          emptyText: "工作区空态来自运行时。",
        },
      },
    });

    await flushEffects();

    clickByAriaLabel(emptyWorkspaceContainer, "切换画布标签-文件");
    await flushEffects();
    expect(emptyWorkspaceContainer.textContent).toContain(
      "工作区空态来自运行时。",
    );
  });

  it("sessionView 存在且有默认主稿时，应优先展示主稿预览", async () => {
    const renderSessionPanel = vi.fn(() => (
      <div data-testid="session-view-panel">session-runtime-panel</div>
    ));
    const container = mount({
      artifacts: [],
      canvasState: null,
      taskFiles: [
        createTaskFile("task-current", "draft.md", "# 标题\n\n当前主稿", 30),
      ],
      selectedFileId: "task-current",
      workspaceRoot: "/workspace",
      workspaceUnavailable: false,
      defaultPreview: {
        selectionKey: "task:task-current",
        title: "draft.md",
        content: "# 标题\n\n当前主稿",
        filePath: "draft.md",
        absolutePath: "/workspace/draft.md",
        previousContent: null,
      } satisfies CanvasWorkbenchDefaultPreview,
      loadFilePreview: vi.fn(async (path: string) => ({
        path,
        content: "",
        isBinary: false,
        size: 0,
        error: null,
      })),
      onOpenPath: vi.fn(async () => undefined),
      onRevealPath: vi.fn(async () => undefined),
      renderPreview: (target) => (
        <div data-testid="preview-panel">
          {target.kind}:{target.title}
        </div>
      ),
      sessionView: {
        eyebrow: "Session Runtime",
        title: "Session · Main",
        subtitle: "统一展示过程与主稿焦点。",
        badges: [
          {
            key: "session-status",
            label: "执行中",
            tone: "accent",
          },
          {
            key: "session-runtime-items",
            label: "轨迹 3",
            tone: "default",
          },
        ],
        renderPanel: renderSessionPanel,
      },
    });

    await flushEffects();

    expect(
      container.querySelector('[data-testid="canvas-workbench-panel-document"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="canvas-workbench-panel-session"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="preview-panel"]')?.textContent,
    ).toContain("default-canvas:draft.md");
    expect(
      container.querySelector('[data-testid="session-view-panel"]'),
    ).toBeNull();
    expect(renderSessionPanel).not.toHaveBeenCalled();
  });

  it("sessionView 首次落在过程页时，后续出现真实主稿应自动切到文件标签", async () => {
    const renderSessionPanel = vi.fn(() => (
      <div data-testid="session-view-panel">session-runtime-panel</div>
    ));
    const renderPreview = vi.fn((target: CanvasWorkbenchPreviewTarget) => (
      <div data-testid="preview-panel">
        {target.kind}:{target.title}
      </div>
    ));

    const baseProps: React.ComponentProps<typeof CanvasWorkbenchLayout> = {
      artifacts: [],
      canvasState: null,
      taskFiles: [],
      workspaceRoot: "/workspace",
      workspaceUnavailable: false,
      defaultPreview: null,
      loadFilePreview: vi.fn(async (path: string) => ({
        path,
        content: "",
        isBinary: false,
        size: 0,
        error: null,
      })),
      onOpenPath: vi.fn(async () => undefined),
      onRevealPath: vi.fn(async () => undefined),
      renderPreview,
      sessionView: {
        title: "Session · Main",
        renderPanel: renderSessionPanel,
      },
    };

    const harness = mountHarness(baseProps);
    await flushEffects();

    expect(
      harness.container.querySelector('[data-testid="canvas-workbench-panel-session"]'),
    ).not.toBeNull();
    expect(
      harness.container.querySelector('[data-testid="session-view-panel"]'),
    ).not.toBeNull();

    harness.rerender({
      ...baseProps,
      taskFiles: [
        createTaskFile("task-current", "index.md", "# 标题\n\n当前主稿", 30),
      ],
      selectedFileId: "task-current",
      defaultPreview: {
        selectionKey: "task:task-current",
        title: "index.md",
        content: "# 标题\n\n当前主稿",
        filePath: "index.md",
        absolutePath: "/workspace/index.md",
        previousContent: null,
      } satisfies CanvasWorkbenchDefaultPreview,
    });
    await flushEffects();

    expect(
      harness.container.querySelector(
        '[data-testid="canvas-workbench-panel-document"]',
      ),
    ).not.toBeNull();
    expect(
      harness.container.querySelector('[data-testid="session-view-panel"]'),
    ).toBeNull();
    expect(
      harness.container.querySelector('[data-testid="preview-panel"]')
        ?.textContent,
    ).toContain("default-canvas:index.md");
  });

  it("工作区文件为二进制时应在文件标签内显示 unsupported 目标", async () => {
    const container = mount({
      artifacts: [],
      canvasState: null,
      taskFiles: [],
      workspaceRoot: "/workspace",
      workspaceUnavailable: false,
      defaultPreview: null,
      loadFilePreview: vi.fn(async (path: string) => ({
        path,
        content: null,
        isBinary: true,
        size: 2048,
        error: null,
      })),
      onOpenPath: vi.fn(async () => undefined),
      onRevealPath: vi.fn(async () => undefined),
      renderPreview: (target) => (
        <div data-testid="preview-panel">
          {target.kind}:{target.title}
        </div>
      ),
    });

    await flushEffects();

    clickByAriaLabel(container, "切换画布标签-文件");
    await flushEffects();
    clickByAriaLabel(container, "展开目录-src");
    await flushEffects();
    clickByAriaLabel(container, "选择工作区文件-binary.dat");
    await flushEffects();

    expect(
      container.querySelector('[data-testid="preview-panel"]')?.textContent,
    ).toContain("unsupported:binary.dat");
  });

  it("重新展开结果目录下的 images 时应刷新目录子项，避免沿用空缓存", async () => {
    let imageListingRequestCount = 0;
    mockListDirectory.mockImplementation(async (path: string) => {
      if (path === "/workspace/exports/x-article-export/latest") {
        return {
          path,
          parentPath: "/workspace/exports/x-article-export",
          error: null,
          entries: [
            {
              name: "images",
              path: "/workspace/exports/x-article-export/latest/images",
              isDir: true,
              size: 0,
              modifiedAt: 100,
            },
            {
              name: "index.md",
              path: "/workspace/exports/x-article-export/latest/index.md",
              isDir: false,
              size: 2048,
              modifiedAt: 100,
            },
          ],
        };
      }

      if (path === "/workspace/exports/x-article-export/latest/images") {
        imageListingRequestCount += 1;
        return {
          path,
          parentPath: "/workspace/exports/x-article-export/latest",
          error: null,
          entries:
            imageListingRequestCount === 1
              ? []
              : [
                  {
                    name: "image-1.jpg",
                    path: `${path}/image-1.jpg`,
                    isDir: false,
                    size: 1024,
                    modifiedAt: 100,
                  },
                  {
                    name: "image-2.jpg",
                    path: `${path}/image-2.jpg`,
                    isDir: false,
                    size: 2048,
                    modifiedAt: 100,
                  },
                ],
        };
      }

      return {
        path,
        parentPath: "/workspace",
        error: null,
        entries: [],
      };
    });

    const container = mount({
      artifacts: [],
      canvasState: null,
      taskFiles: [],
      workspaceRoot: "/workspace",
      workspaceUnavailable: false,
      defaultPreview: {
        selectionKey: "default-preview:exports/x-article-export/latest/index.md",
        title: "index.md",
        content: "# 导出结果\n\n这是正文。",
        filePath: "exports/x-article-export/latest/index.md",
        absolutePath: "/workspace/exports/x-article-export/latest/index.md",
        previousContent: null,
      },
      loadFilePreview: vi.fn(async (path: string) => ({
        path,
        content: "# 文件内容",
        isBinary: false,
        size: 128,
        error: null,
      })),
      onOpenPath: vi.fn(async () => undefined),
      onRevealPath: vi.fn(async () => undefined),
      renderPreview: (target) => (
        <div data-testid="preview-panel">
          {target.kind}:{target.title}
        </div>
      ),
    });

    await flushEffects();
    clickByAriaLabel(container, "切换画布标签-文件");
    await flushEffects();

    clickByAriaLabel(container, "展开目录-images");
    await flushEffects();
    expect(container.textContent).not.toContain("image-1.jpg");

    clickByAriaLabel(container, "折叠目录-images");
    await flushEffects();
    clickByAriaLabel(container, "展开目录-images");
    await flushEffects();

    expect(mockListDirectory).toHaveBeenCalledWith(
      "/workspace/exports/x-article-export/latest/images",
    );
    expect(imageListingRequestCount).toBe(2);
    expect(container.textContent).toContain("image-1.jpg");
    expect(container.textContent).toContain("image-2.jpg");
  });

  it("启用 teamView 且没有默认预览时应默认落在 team 标签", async () => {
    const renderPreview = vi.fn((target: CanvasWorkbenchPreviewTarget) => (
      <div data-testid="preview-panel">preview:{target.kind}</div>
    ));
    const renderTeamPanel = vi.fn(() => (
      <div data-testid="team-panel">team-panel</div>
    ));

    const container = mount({
      artifacts: [],
      canvasState: null,
      taskFiles: [],
      workspaceRoot: "/workspace",
      workspaceUnavailable: false,
      defaultPreview: null,
      loadFilePreview: vi.fn(async (path: string) => ({
        path,
        content: "",
        isBinary: false,
        size: 0,
        error: null,
      })),
      onOpenPath: vi.fn(async () => undefined),
      onRevealPath: vi.fn(async () => undefined),
      renderPreview,
      teamView: {
        enabled: true,
        title: "任务工作台",
        subtitle: "任务进行时",
        badges: [
          {
            key: "team-runtime",
            label: "任务工作台",
            tone: "accent",
          },
          {
            key: "team-trigger-state",
            label: "处理中",
            tone: "accent",
          },
        ],
        summaryStats: [
          {
            key: "team-status",
            label: "任务状态",
            value: "处理中",
            detail: "2 项处理中，1 项排队中。",
            tone: "accent",
          },
        ],
        renderPreview: () => <div>unused-team-preview</div>,
        renderPanel: renderTeamPanel,
      },
    });

    await flushEffects();

    expect(
      container.querySelector('[data-testid="canvas-workbench-panel-team"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="preview-panel"]')?.textContent,
    ).toContain("preview:team-workbench");
    expect(
      container.querySelector('[data-testid="team-panel"]'),
    ).not.toBeNull();
    expect(
      container.querySelector(
        'button[aria-label="切换画布标签-任务工作台"]',
      ),
    ).not.toBeNull();
    expect(renderPreview).toHaveBeenCalled();
    expect(renderTeamPanel).toHaveBeenCalled();
  });

  it("teamView 的 autoFocusToken 变化时应切到 team 标签", async () => {
    const renderPreview = vi.fn((target: CanvasWorkbenchPreviewTarget) => (
      <div data-testid="preview-panel">preview:{target.kind}</div>
    ));

    const baseProps: React.ComponentProps<typeof CanvasWorkbenchLayout> = {
      artifacts: [
        createArtifact("artifact-1", "draft.md", "标题\n当前内容", 20),
      ],
      canvasState: null,
      taskFiles: [],
      workspaceRoot: "/workspace",
      workspaceUnavailable: false,
      defaultPreview: {
        selectionKey: "artifact:artifact-1",
        title: "draft.md",
        content: "标题\n当前内容",
        filePath: "draft.md",
        absolutePath: "/workspace/draft.md",
        previousContent: null,
      },
      loadFilePreview: vi.fn(async (path: string) => ({
        path,
        content: "",
        isBinary: false,
        size: 0,
        error: null,
      })),
      onOpenPath: vi.fn(async () => undefined),
      onRevealPath: vi.fn(async () => undefined),
      renderPreview,
      teamView: {
        enabled: true,
        title: "任务工作台",
        subtitle: "任务进行时",
        autoFocusToken: 1,
        renderPreview: () => <div>unused-team-preview</div>,
        renderPanel: () => <div data-testid="team-panel">team-panel</div>,
      },
    };

    const harness = mountHarness(baseProps);
    await flushEffects();

    expect(
      harness.container.querySelector(
        '[data-testid="canvas-workbench-panel-document"]',
      ),
    ).not.toBeNull();

    harness.rerender({
      ...baseProps,
      teamView: {
        ...baseProps.teamView!,
        autoFocusToken: 2,
      },
    });
    await flushEffects();

    expect(
      harness.container.querySelector(
        '[data-testid="canvas-workbench-panel-team"]',
      ),
    ).not.toBeNull();
    expect(
      harness.container.querySelector('[data-testid="team-panel"]'),
    ).not.toBeNull();
    expect(
      harness.container.querySelector('[data-testid="preview-panel"]')
        ?.textContent,
    ).toContain("preview:team-workbench");
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
      workspaceUnavailable: false,
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
      renderPreview: (target) => (
        <div data-testid="preview-panel">
          {target.kind}:{target.title}
        </div>
      ),
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
      container.querySelector(
        'button[aria-label="切换画布标签-Session · Main"]',
      ),
    ).not.toBeNull();

    clickByAriaLabel(container, "切换画布标签-文件");
    await flushEffects();
    expect(
      container.querySelector(
        '[data-testid="canvas-workbench-panel-workspace"]',
      ),
    ).not.toBeNull();
  });
});
