import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Artifact } from "@/lib/artifact/types";
import type { TaskFile } from "./TaskFiles";
import {
  CanvasWorkbenchLayout,
  type CanvasWorkbenchDefaultPreview,
  type CanvasWorkbenchPreviewTarget,
} from "./CanvasWorkbenchLayout";

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

const { mockListDirectory, mockToast, resizeObserverState } = vi.hoisted(() => ({
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
}));

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

function mount(
  props: React.ComponentProps<typeof CanvasWorkbenchLayout>,
): HTMLDivElement {
  return mountHarness(props).container;
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

function clickButtonByLabel(container: HTMLElement, ariaLabel: string) {
  const button = container.querySelector(
    `button[aria-label="${ariaLabel}"]`,
  ) as HTMLButtonElement | null;
  if (!button) {
    throw new Error(`未找到按钮: ${ariaLabel}`);
  }

  act(() => {
    button.click();
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
            observer.callback !== this.callback || observer.target !== this.target,
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
  it("应支持默认画布、标签切换、文件树、diff 与下载动作", async () => {
    const previewTargets: CanvasWorkbenchPreviewTarget[] = [];
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
      renderPreview: (target, options) => {
        previewTargets.push(target);
        return (
          <div data-testid="preview-panel">
            {options?.stackedWorkbenchTrigger}
            {target.kind}:{target.title}
          </div>
        );
      },
    });

    await flushEffects();

    expect(mockListDirectory).toHaveBeenCalledWith("/workspace");
    expect(container.querySelector('[data-testid="preview-panel"]')?.textContent).toContain(
      "default-canvas:draft.md",
    );

    clickButtonByLabel(container, "切换画布标签-变更");
    await flushEffects();
    expect(container.textContent).toContain("上一版本");
    expect(container.textContent).toContain("当前画布正文");

    clickButtonByLabel(container, "切换画布标签-预览");
    expect(container.textContent).toContain("当前画布正文");

    clickButtonByLabel(container, "折叠画布工作台");
    expect(
      container.querySelector('button[aria-label="展开画布工作台"]'),
    ).not.toBeNull();
    clickButtonByLabel(container, "展开画布工作台");

    clickButtonByLabel(container, "切换画布标签-产物");
    clickButtonByLabel(container, "选择画布产物-draft.md");
    await flushEffects();
    expect(container.querySelector('[data-testid="preview-panel"]')?.textContent).toContain(
      "artifact:draft.md",
    );

    clickButtonByLabel(container, "切换画布标签-全部文件");
    await flushEffects();
    clickButtonByLabel(container, "选择工作区文件-README.md");
    await flushEffects();

    expect(loadFilePreview).toHaveBeenCalledWith("/workspace/README.md");
    expect(previewTargets.at(-1)?.kind).toBe("synthetic-artifact");

    clickButtonByLabel(container, "复制当前路径");
    await flushEffects();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "/workspace/README.md",
    );

    clickButtonByLabel(container, "定位当前文件");
    await flushEffects();
    expect(onRevealPath).toHaveBeenCalledWith("/workspace/README.md");

    clickButtonByLabel(container, "系统打开当前文件");
    await flushEffects();
    expect(onOpenPath).toHaveBeenCalledWith("/workspace/README.md");

    clickButtonByLabel(container, "下载当前画布项");
    expect(globalThis.URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
  });

  it("工作区文件为二进制时应展示不支持预览提示", async () => {
    const previewTargets: CanvasWorkbenchPreviewTarget[] = [];

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
      renderPreview: (target, options) => {
        previewTargets.push(target);
        return (
          <div data-testid="preview-panel">
            {options?.stackedWorkbenchTrigger}
            {target.kind}:{target.title}
          </div>
        );
      },
    });

    await flushEffects();

    clickButtonByLabel(container, "切换画布标签-全部文件");
    await flushEffects();
    clickButtonByLabel(container, "展开目录-src");
    await flushEffects();
    clickButtonByLabel(container, "选择工作区文件-binary.dat");
    await flushEffects();

    expect(previewTargets.at(-1)?.kind).toBe("unsupported");

    clickButtonByLabel(container, "切换画布标签-预览");
    expect(container.textContent).toContain("该文件为二进制内容");
  });

  it("启用 teamView 且没有默认预览时应优先展示 Team Workbench", async () => {
    const renderPreview = vi.fn((_target: CanvasWorkbenchPreviewTarget) => (
      <div data-testid="fallback-preview">fallback</div>
    ));
    const renderTeamPreview = vi.fn(
      (_options?: { stackedWorkbenchTrigger?: React.ReactNode }) => (
        <div data-testid="team-preview">team-preview</div>
      ),
    );
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
        title: "Team Workbench",
        subtitle: "多 agent 实时协作",
        renderPreview: renderTeamPreview,
        renderPanel: renderTeamPanel,
      },
    });

    await flushEffects();

    expect(container.querySelector('[data-testid="team-preview"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="team-panel"]')).not.toBeNull();
    expect(container.textContent).toContain("多 agent 实时协作");
    expect(renderTeamPreview).toHaveBeenCalled();
    expect(renderTeamPanel).toHaveBeenCalled();
    expect(renderPreview).not.toHaveBeenCalled();
  });

  it("teamView 的 autoFocusToken 变化时应切到 Team Workbench", async () => {
    const renderPreview = vi.fn((target: CanvasWorkbenchPreviewTarget) => (
      <div data-testid="fallback-preview">
        fallback:{target.kind}
      </div>
    ));
    const renderTeamPreview = vi.fn(
      (_options?: { stackedWorkbenchTrigger?: React.ReactNode }) => (
        <div data-testid="team-preview">team-preview</div>
      ),
    );
    const renderTeamPanel = vi.fn(() => (
      <div data-testid="team-panel">team-panel</div>
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
        title: "Team Workbench",
        subtitle: "多成员实时协作",
        autoFocusToken: 1,
        renderPreview: renderTeamPreview,
        renderPanel: renderTeamPanel,
      },
    };

    const harness = mountHarness(baseProps);
    await flushEffects();

    expect(harness.container.querySelector('[data-testid="team-preview"]')).toBeNull();
    expect(harness.container.querySelector('[data-testid="team-panel"]')).toBeNull();
    expect(harness.container.querySelector('[data-testid="fallback-preview"]')).not.toBeNull();

    harness.rerender({
      ...baseProps,
      teamView: {
        ...baseProps.teamView!,
        autoFocusToken: 2,
      },
    });
    await flushEffects();

    expect(harness.container.querySelector('[data-testid="team-preview"]')).not.toBeNull();
    expect(harness.container.querySelector('[data-testid="team-panel"]')).not.toBeNull();
    expect(harness.container.textContent).toContain("多成员实时协作");
  });

  it("teamView 存在活动态提示时，应在窄屏悬浮入口显示状态标签", async () => {
    const container = mount({
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
      renderPreview: (target, options) => (
        <div data-testid="preview-panel">
          {options?.stackedWorkbenchTrigger}
          {target.kind}:{target.title}
        </div>
      ),
      teamView: {
        enabled: true,
        title: "Team Workbench",
        subtitle: "多成员实时协作",
        triggerState: {
          tone: "active",
          label: "组建中",
        },
        renderPreview: () => <div data-testid="team-preview">team-preview</div>,
        renderPanel: () => <div data-testid="team-panel">team-panel</div>,
      },
    });

    await flushEffects();
    await resizeWorkbench(820);
    await flushEffects();

    const trigger = container.querySelector<HTMLElement>(
      '[data-testid="canvas-workbench-trigger"]',
    );

    expect(trigger).toBeTruthy();
    expect(trigger?.textContent).toContain("工作台");
    expect(trigger?.textContent).toContain("组建中");
    expect(trigger?.className).toContain("bg-sky-50");
  });

  it("容器变窄时应切换为底部工作台布局并保持工作台可展开收起", async () => {
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
      renderPreview: (target, options) => (
        <div data-testid="preview-panel">
          {options?.stackedWorkbenchTrigger}
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
    expect(
      container
        .querySelector('[data-testid="canvas-workbench-layout"]')
        ?.getAttribute("data-panel-placement"),
    ).toBe("side");

    await resizeWorkbench(820);
    await flushEffects();

    expect(
      container
        .querySelector('[data-testid="canvas-workbench-shell"]')
        ?.getAttribute("data-layout-mode"),
    ).toBe("stacked");
    expect(
      container.querySelector('button[aria-label="展开画布工作台"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="canvas-workbench-trigger"]')
        ?.textContent,
    ).toContain("工作台");

    clickButtonByLabel(container, "展开画布工作台");
    expect(
      container
        .querySelector('[data-testid="canvas-workbench-layout"]')
        ?.getAttribute("data-panel-placement"),
    ).toBe("overlay-bottom");
    expect(
      container.querySelector('button[aria-label="折叠画布工作台"]'),
    ).not.toBeNull();

    clickButtonByLabel(container, "折叠画布工作台");
    expect(
      container.querySelector('button[aria-label="展开画布工作台"]'),
    ).not.toBeNull();

    clickButtonByLabel(container, "展开画布工作台");
    clickButtonByLabel(container, "切换画布标签-预览");
    expect(container.textContent).toContain("当前画布正文");
  });

  it("窄屏底部工作台应支持拖拽调整高度", async () => {
    const container = mount({
      artifacts: [
        createArtifact("artifact-new", "draft.md", "标题\n产物版本", 20),
      ],
      canvasState: null,
      taskFiles: [],
      workspaceRoot: "/workspace",
      workspaceUnavailable: false,
      defaultPreview: {
        selectionKey: "artifact:artifact-new",
        title: "draft.md",
        content: "标题\n产物版本",
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
      renderPreview: (target, options) => (
        <div data-testid="preview-panel">
          {options?.stackedWorkbenchTrigger}
          {target.kind}:{target.title}
        </div>
      ),
    });

    await flushEffects();
    await resizeWorkbench(820, 640);
    await flushEffects();

    clickButtonByLabel(container, "展开画布工作台");
    await flushEffects();

    const layout = container.querySelector<HTMLElement>(
      '[data-testid="canvas-workbench-layout"]',
    );
    const resizeHandle = container.querySelector<HTMLElement>(
      '[data-testid="canvas-workbench-resize-handle"]',
    );

    expect(layout).toBeTruthy();
    expect(resizeHandle).toBeTruthy();

    const initialHeight = Number.parseFloat(layout?.style.height || "0");
    expect(initialHeight).toBeGreaterThan(0);

    await act(async () => {
      resizeHandle?.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          clientY: 520,
        }),
      );
      window.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientY: 420,
        }),
      );
      window.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          clientY: 420,
        }),
      );
      await Promise.resolve();
    });

    const expandedHeight = Number.parseFloat(layout?.style.height || "0");
    expect(expandedHeight).toBeGreaterThan(initialHeight);

    await act(async () => {
      resizeHandle?.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          clientY: 420,
        }),
      );
      window.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientY: 560,
        }),
      );
      window.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          clientY: 560,
        }),
      );
      await Promise.resolve();
    });

    const reducedHeight = Number.parseFloat(layout?.style.height || "0");
    expect(reducedHeight).toBeLessThan(expandedHeight);
    expect(reducedHeight).toBeGreaterThanOrEqual(220);
  });
});
