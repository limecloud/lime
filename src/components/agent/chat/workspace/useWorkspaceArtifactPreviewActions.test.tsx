import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Artifact } from "@/lib/artifact/types";
import * as fileBrowserModule from "@/lib/api/fileBrowser";
import { useWorkspaceArtifactPreviewActions } from "./useWorkspaceArtifactPreviewActions";

vi.mock("../hooks/useArtifactAutoPreviewSync", () => ({
  useArtifactAutoPreviewSync: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

type HookProps = Parameters<typeof useWorkspaceArtifactPreviewActions>[0];

const mountedRoots: Array<{ container: HTMLDivElement; root: Root }> = [];

function createArtifact(overrides: Partial<Artifact> = {}): Artifact {
  const content = overrides.content ?? "# 研究简报";

  return {
    id: overrides.id ?? "artifact-doc-1",
    type: overrides.type ?? "document",
    title: overrides.title ?? "report.md",
    content,
    status: overrides.status ?? "complete",
    meta: {
      filePath: overrides.meta?.filePath ?? "report.md",
      filename: overrides.meta?.filename ?? "report.md",
      ...overrides.meta,
    },
    position: overrides.position ?? { start: 0, end: content.length },
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
    error: overrides.error,
  };
}

function renderHook(props?: Partial<HookProps>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let latestValue: ReturnType<
    typeof useWorkspaceArtifactPreviewActions
  > | null = null;

  const defaultProps: HookProps = {
    activeTheme: "general",
    mappedTheme: "general",
    layoutMode: "chat-canvas",
    isThemeWorkbench: false,
    isGeneralCanvasOpen: true,
    artifacts: [],
    currentCanvasArtifact: null,
    taskFiles: [],
    sessionFiles: [],
    readSessionFile: vi.fn(async () => null),
    suppressBrowserAssistCanvasAutoOpen: vi.fn(),
    onOpenBrowserRuntimeForArtifact: undefined,
    upsertGeneralArtifact: vi.fn(),
    setSelectedArtifactId: vi.fn(),
    setArtifactViewMode: vi.fn(),
    setLayoutMode: vi.fn(),
    setTaskFiles: vi.fn(),
    setSelectedFileId: vi.fn(),
    setGeneralCanvasState: vi.fn(),
    setCanvasState: vi.fn(),
  };

  function Probe(currentProps: HookProps) {
    latestValue = useWorkspaceArtifactPreviewActions(currentProps);
    return null;
  }

  const render = async (nextProps?: Partial<HookProps>) => {
    await act(async () => {
      root.render(<Probe {...defaultProps} {...props} {...nextProps} />);
      await Promise.resolve();
    });
  };

  mountedRoots.push({ container, root });

  return {
    render,
    getValue: () => {
      if (!latestValue) {
        throw new Error("hook 尚未初始化");
      }
      return latestValue;
    },
    defaultProps: { ...defaultProps, ...props },
  };
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

async function flushAsyncWork(times = 4) {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

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
  vi.restoreAllMocks();
});

describe("useWorkspaceArtifactPreviewActions", () => {
  it("打开普通 artifact 时应先抑制浏览器协助自动抢焦点", async () => {
    const suppressBrowserAssistCanvasAutoOpen = vi.fn();
    const setSelectedArtifactId = vi.fn();
    const setArtifactViewMode = vi.fn();
    const setLayoutMode = vi.fn();
    const setGeneralCanvasState = vi.fn();
    const artifact = createArtifact();
    const { render, getValue } = renderHook({
      suppressBrowserAssistCanvasAutoOpen,
      setSelectedArtifactId,
      setArtifactViewMode,
      setLayoutMode,
      setGeneralCanvasState,
    });

    await render();

    act(() => {
      getValue().handleArtifactClick(artifact);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(suppressBrowserAssistCanvasAutoOpen).toHaveBeenCalledTimes(1);
    expect(setSelectedArtifactId).toHaveBeenCalledWith("artifact-doc-1");
    expect(setLayoutMode).toHaveBeenCalledWith("chat-canvas");
    expect(setArtifactViewMode).toHaveBeenCalledWith("preview", {
      artifactId: "artifact-doc-1",
    });
    expect(setGeneralCanvasState).toHaveBeenCalledTimes(1);
  });

  it("显式打开浏览器协助 artifact 时应改走浏览器工作台入口", async () => {
    const suppressBrowserAssistCanvasAutoOpen = vi.fn();
    const onOpenBrowserRuntimeForArtifact = vi.fn();
    const setSelectedArtifactId = vi.fn();
    const setLayoutMode = vi.fn();
    const artifact = createArtifact({
      id: "browser-assist:general",
      type: "browser_assist",
      title: "浏览器协助",
      content: "",
      meta: {
        profileKey: "general_browser_assist",
        sessionId: "browser-session-1",
      },
    });
    const { render, getValue } = renderHook({
      suppressBrowserAssistCanvasAutoOpen,
      onOpenBrowserRuntimeForArtifact,
      setSelectedArtifactId,
      setLayoutMode,
    });

    await render();

    act(() => {
      getValue().handleArtifactClick(artifact);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(suppressBrowserAssistCanvasAutoOpen).not.toHaveBeenCalled();
    expect(onOpenBrowserRuntimeForArtifact).toHaveBeenCalledWith(artifact);
    expect(setSelectedArtifactId).not.toHaveBeenCalled();
    expect(setLayoutMode).not.toHaveBeenCalled();
  });

  it("通用模式打开文件预览时应直接切到真实文件画布，而不是再包装成 artifact", async () => {
    const upsertGeneralArtifact = vi.fn();
    const setGeneralCanvasState = vi.fn();
    const setSelectedArtifactId = vi.fn();
    const setLayoutMode = vi.fn();
    const suppressBrowserAssistCanvasAutoOpen = vi.fn();
    const { render, getValue } = renderHook({
      upsertGeneralArtifact,
      setGeneralCanvasState,
      setSelectedArtifactId,
      setLayoutMode,
      suppressBrowserAssistCanvasAutoOpen,
    });

    await render();

    act(() => {
      getValue().handleFileClick(
        ".lime/artifacts/thread-1/report.md",
        "# 研究简报\n\n这里是预览内容。",
      );
    });

    expect(upsertGeneralArtifact).not.toHaveBeenCalled();
    expect(suppressBrowserAssistCanvasAutoOpen).toHaveBeenCalledTimes(1);
    expect(setSelectedArtifactId).toHaveBeenCalledWith(null);
    expect(setLayoutMode).toHaveBeenCalledWith("chat-canvas");
    expect(setGeneralCanvasState).toHaveBeenCalledWith(
      expect.objectContaining({
        isOpen: true,
        contentType: "markdown",
        filename: ".lime/artifacts/thread-1/report.md",
        content: "# 研究简报\n\n这里是预览内容。",
      }),
    );
  });

  it("读取带目录的真实结果路径时不应回退到同名裸任务文件", async () => {
    const readFilePreviewSpy = vi
      .spyOn(fileBrowserModule, "readFilePreview")
      .mockResolvedValue({
        path: "/tmp/project/exports/x-article-export/latest/index.md",
        content: "# 真实导出",
        isBinary: false,
        size: 12,
        error: null,
      });

    const { render, getValue } = renderHook({
      taskFiles: [
        {
          id: "task-index",
          name: "index.md",
          type: "document",
          content: "# 过程文件",
          version: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });

    await render();

    const preview = await getValue().handleHarnessLoadFilePreview(
      "/tmp/project/exports/x-article-export/latest/index.md",
    );

    expect(readFilePreviewSpy).toHaveBeenCalledWith(
      "/tmp/project/exports/x-article-export/latest/index.md",
      64 * 1024,
    );
    expect(preview).toEqual({
      path: "/tmp/project/exports/x-article-export/latest/index.md",
      content: "# 真实导出",
      isBinary: false,
      size: 12,
      error: null,
    });
  });

  it("读取裸文件名时仍可回退到同名任务文件", async () => {
    const readFilePreviewSpy = vi.spyOn(fileBrowserModule, "readFilePreview");
    const { render, getValue } = renderHook({
      taskFiles: [
        {
          id: "task-index",
          name: "index.md",
          type: "document",
          content: "# 过程文件",
          version: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });

    await render();

    const preview = await getValue().handleHarnessLoadFilePreview("index.md");

    expect(readFilePreviewSpy).not.toHaveBeenCalled();
    expect(preview).toEqual({
      path: "index.md",
      content: "# 过程文件",
      isBinary: false,
      size: "# 过程文件".length,
      error: null,
    });
  });

  it("读取裸文件名时可回退到带目录的同名任务文件", async () => {
    const readFilePreviewSpy = vi.spyOn(fileBrowserModule, "readFilePreview");
    const { render, getValue } = renderHook({
      taskFiles: [
        {
          id: "task-export-index",
          name: "exports/x-article-export/latest/index.md",
          type: "document",
          content: "# 正式结果",
          version: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });

    await render();

    const preview = await getValue().handleHarnessLoadFilePreview("index.md");

    expect(readFilePreviewSpy).not.toHaveBeenCalled();
    expect(preview).toEqual({
      path: "exports/x-article-export/latest/index.md",
      content: "# 正式结果",
      isBinary: false,
      size: "# 正式结果".length,
      error: null,
    });
  });

  it("点击占位任务文件时应按需读取会话内容并打开通用画布", async () => {
    const readSessionFile = vi.fn(async () => "# 会话主稿\n\n按需恢复");
    const setTaskFiles = vi.fn();
    const setGeneralCanvasState = vi.fn();
    const setSelectedArtifactId = vi.fn();
    const setLayoutMode = vi.fn();
    const suppressBrowserAssistCanvasAutoOpen = vi.fn();
    const placeholderFile = {
      id: "session-file:content-posts/draft.md",
      name: "content-posts/draft.md",
      type: "document" as const,
      version: 1,
      createdAt: 100,
      updatedAt: 100,
    };
    const { render, getValue } = renderHook({
      taskFiles: [placeholderFile],
      sessionFiles: [
        {
          name: "content-posts/draft.md",
          fileType: "document",
          metadata: {
            contentPostIntent: "draft",
          },
          size: 20,
          createdAt: 100,
          updatedAt: 200,
        },
      ],
      readSessionFile,
      setTaskFiles,
      setGeneralCanvasState,
      setSelectedArtifactId,
      setLayoutMode,
      suppressBrowserAssistCanvasAutoOpen,
    });

    await render();

    await act(async () => {
      getValue().handleTaskFileClick(placeholderFile);
      await flushAsyncWork();
    });

    expect(readSessionFile).toHaveBeenCalledWith("content-posts/draft.md");
    expect(setTaskFiles).toHaveBeenCalledTimes(1);

    const taskFilesUpdater = setTaskFiles.mock.calls[0]?.[0];
    expect(typeof taskFilesUpdater).toBe("function");
    expect(taskFilesUpdater([placeholderFile])).toEqual([
      expect.objectContaining({
        id: "session-file:content-posts/draft.md",
        name: "content-posts/draft.md",
        type: "document",
        content: "# 会话主稿\n\n按需恢复",
        metadata: expect.objectContaining({
          contentPostIntent: "draft",
        }),
        createdAt: 100,
        updatedAt: 200,
      }),
    ]);
    expect(suppressBrowserAssistCanvasAutoOpen).toHaveBeenCalledTimes(1);
    expect(setSelectedArtifactId).toHaveBeenCalledWith(null);
    expect(setLayoutMode).toHaveBeenCalledWith("chat-canvas");
    expect(setGeneralCanvasState).toHaveBeenCalledWith(
      expect.objectContaining({
        isOpen: true,
        filename: "content-posts/draft.md",
        content: "# 会话主稿\n\n按需恢复",
        contentType: "markdown",
      }),
    );
  });

  it("点击占位任务文件时应按需读取会话内容并更新主题工作台画布", async () => {
    const readSessionFile = vi.fn(async () => "# 主题工作台内容");
    const setTaskFiles = vi.fn();
    const setSelectedFileId = vi.fn();
    const setCanvasState = vi.fn();
    const setLayoutMode = vi.fn();
    const placeholderFile = {
      id: "session-file:result.md",
      name: "result.md",
      type: "document" as const,
      version: 1,
      createdAt: 10,
      updatedAt: 10,
    };
    const { render, getValue } = renderHook({
      activeTheme: "article",
      mappedTheme: "general",
      layoutMode: "chat",
      isThemeWorkbench: true,
      taskFiles: [placeholderFile],
      sessionFiles: [
        {
          name: "result.md",
          fileType: "document",
          size: 20,
          createdAt: 10,
          updatedAt: 30,
        },
      ],
      readSessionFile,
      setTaskFiles,
      setSelectedFileId,
      setCanvasState,
      setLayoutMode,
    });

    await render();

    await act(async () => {
      getValue().handleTaskFileClick(placeholderFile);
      await flushAsyncWork();
    });

    expect(readSessionFile).toHaveBeenCalledWith("result.md");
    expect(setSelectedFileId).toHaveBeenCalledWith("session-file:result.md");
    expect(setLayoutMode).toHaveBeenCalledWith("chat-canvas");

    const taskFilesUpdater = setTaskFiles.mock.calls[0]?.[0];
    expect(typeof taskFilesUpdater).toBe("function");
    expect(taskFilesUpdater([placeholderFile])).toEqual([
      expect.objectContaining({
        id: "session-file:result.md",
        name: "result.md",
        content: "# 主题工作台内容",
        updatedAt: 30,
      }),
    ]);

    const canvasStateUpdater = setCanvasState.mock.calls[0]?.[0];
    expect(typeof canvasStateUpdater).toBe("function");
    expect(
      canvasStateUpdater({
        type: "document",
        content: "旧内容",
        platform: "markdown",
        versions: [],
        currentVersionId: "version-1",
        isEditing: true,
      }),
    ).toEqual(
      expect.objectContaining({
        type: "document",
        content: "# 主题工作台内容",
        platform: "markdown",
        currentVersionId: "version-1",
      }),
    );
  });
});
