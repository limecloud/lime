import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Artifact } from "@/lib/artifact/types";
import * as fileBrowserModule from "@/lib/api/fileBrowser";
import { useWorkspaceArtifactPreviewActions } from "./useWorkspaceArtifactPreviewActions";

const { mockHasArtifactPreviewScope, mockReadArtifactPreviewContent } =
  vi.hoisted(() => ({
    mockHasArtifactPreviewScope: vi.fn(),
    mockReadArtifactPreviewContent: vi.fn(),
  }));

vi.mock("@/lib/api/agentRuntime/appServerArtifactClient", () => ({
  hasAgentRuntimeArtifactPreviewScope: mockHasArtifactPreviewScope,
  readAgentRuntimeArtifactPreviewContent: mockReadArtifactPreviewContent,
}));

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
    layoutMode: "chat-canvas",
    isGeneralCanvasOpen: true,
    artifacts: [],
    currentCanvasArtifact: null,
    taskFiles: [],
    sessionFiles: [],
    openWorkspaceFile: vi.fn(),
    readSessionFile: vi.fn(async () => null),
    upsertGeneralArtifact: vi.fn(),
    setSelectedArtifactId: vi.fn(),
    setArtifactViewMode: vi.fn(),
    setLayoutMode: vi.fn(),
    setGeneralCanvasState: vi.fn(),
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
  mockHasArtifactPreviewScope.mockReset();
  mockHasArtifactPreviewScope.mockReturnValue(false);
  mockReadArtifactPreviewContent.mockReset();
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
  vi.restoreAllMocks();
});

describe("useWorkspaceArtifactPreviewActions", () => {
  it("打开普通 artifact 时应进入工作台预览", async () => {
    const setSelectedArtifactId = vi.fn();
    const setArtifactViewMode = vi.fn();
    const setLayoutMode = vi.fn();
    const setGeneralCanvasState = vi.fn();
    const artifact = createArtifact();
    const { render, getValue } = renderHook({
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

    expect(setSelectedArtifactId).toHaveBeenCalledWith("artifact-doc-1");
    expect(setLayoutMode).toHaveBeenCalledWith("chat-canvas");
    expect(setArtifactViewMode).toHaveBeenCalledWith("preview", {
      artifactId: "artifact-doc-1",
    });
    expect(setGeneralCanvasState).toHaveBeenCalledTimes(1);
  });

  it("文章编辑器 详情页里的打开预览按钮仍应进入 workbench", async () => {
    const setSelectedArtifactId = vi.fn();
    const setArtifactViewMode = vi.fn();
    const setLayoutMode = vi.fn();
    const artifact = createArtifact({
      id: "preview-article-workspace-2",
      title: "文章编辑器",
      content: "# 文章编辑器",
      meta: {
        openedFrom: "general-workbench-file",
      },
    });
    const { render, getValue } = renderHook({
      setSelectedArtifactId,
      setArtifactViewMode,
      setLayoutMode,
    });

    await render();

    await act(async () => {
      await getValue().openArtifactInWorkbench(artifact);
    });

    expect(setSelectedArtifactId).toHaveBeenCalledWith(
      "preview-article-workspace-2",
    );
    expect(setArtifactViewMode).toHaveBeenCalledWith("preview", {
      artifactId: "preview-article-workspace-2",
    });
    expect(setLayoutMode).toHaveBeenCalledWith("chat-canvas");
  });

  it("通用模式打开媒体 preview artifact 时不应再按空文件懒加载", async () => {
    const readSessionFile = vi.fn(async () => "");
    const upsertGeneralArtifact = vi.fn();
    const setGeneralCanvasState = vi.fn();
    const setSelectedArtifactId = vi.fn();
    const setArtifactViewMode = vi.fn();
    const setLayoutMode = vi.fn();
    const onRequestCanvasPreviewOpen = vi.fn();
    const artifact = createArtifact({
      id: "preview-session_file-message-attachment",
      title: "attachment-1",
      content: "data:image/png;base64,aGVsbG8=",
      meta: {
        previewArtifact: true,
        isSourceBacked: true,
        source: "session_file",
        sourceRef: "message-1:attachment:0",
        sourcePath: "message-1:attachment:0",
        filePath: "message-1:attachment:0",
        filename: "attachment-1",
        contentKind: "image",
        renderMode: "media",
        previewUrl: "data:image/png;base64,aGVsbG8=",
      },
    });
    const { render, getValue } = renderHook({
      readSessionFile,
      upsertGeneralArtifact,
      setGeneralCanvasState,
      setSelectedArtifactId,
      setArtifactViewMode,
      setLayoutMode,
      onRequestCanvasPreviewOpen,
      isGeneralCanvasOpen: true,
    });

    await render();

    act(() => {
      getValue().handleArtifactClick(artifact);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(readSessionFile).not.toHaveBeenCalled();
    expect(upsertGeneralArtifact).toHaveBeenCalledTimes(1);
    expect(upsertGeneralArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        id: artifact.id,
        meta: expect.objectContaining({
          previewArtifact: true,
          contentKind: "image",
          renderMode: "media",
          previewUrl: "data:image/png;base64,aGVsbG8=",
        }),
      }),
    );
    expect(setGeneralCanvasState).toHaveBeenCalledWith(expect.any(Function));
    const resetGeneralCanvas = setGeneralCanvasState.mock
      .calls[0]?.[0] as (state: {
      isOpen: boolean;
      contentType: string;
      content: string;
      filename?: string;
      sourcePath?: string;
      isEditing: boolean;
    }) => unknown;
    expect(
      resetGeneralCanvas({
        isOpen: true,
        contentType: "markdown",
        content: "# 上轮对话",
        filename: "上轮对话.md",
        sourcePath: "/tmp/last-turn.md",
        isEditing: true,
      }),
    ).toEqual({
      isOpen: false,
      contentType: "empty",
      content: "",
      filename: undefined,
      sourcePath: undefined,
      isEditing: false,
    });
    expect(setSelectedArtifactId).toHaveBeenCalledWith(artifact.id);
    expect(setArtifactViewMode).toHaveBeenCalledWith("preview", {
      artifactId: artifact.id,
    });
    expect(onRequestCanvasPreviewOpen).toHaveBeenCalledWith({
      filePath: null,
      selectionKey: `artifact:${artifact.id}`,
    });
    expect(setLayoutMode).toHaveBeenCalledWith("chat-canvas");
  });

  it("通用模式打开来源摘要 preview artifact 时不应把 URL 当文件懒加载", async () => {
    const readFilePreviewSpy = vi.spyOn(fileBrowserModule, "readFilePreview");
    const upsertGeneralArtifact = vi.fn();
    const setGeneralCanvasState = vi.fn();
    const setSelectedArtifactId = vi.fn();
    const setArtifactViewMode = vi.fn();
    const setLayoutMode = vi.fn();
    const onRequestCanvasPreviewOpen = vi.fn();
    const artifact = createArtifact({
      id: "preview-url-example",
      title: "在线报告",
      content: "",
      meta: {
        previewArtifact: true,
        isSourceBacked: true,
        source: "url",
        sourceRef: "https://example.com/report",
        sourcePath: "https://example.com/report",
        filePath: "https://example.com/report",
        filename: "report",
        contentKind: "markdown",
        renderMode: "inline",
      },
    });
    const { render, getValue } = renderHook({
      upsertGeneralArtifact,
      setGeneralCanvasState,
      setSelectedArtifactId,
      setArtifactViewMode,
      setLayoutMode,
      onRequestCanvasPreviewOpen,
      isGeneralCanvasOpen: true,
    });

    await render();

    act(() => {
      getValue().handleArtifactClick(artifact);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(readFilePreviewSpy).not.toHaveBeenCalled();
    expect(upsertGeneralArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "preview-url-example",
        meta: expect.objectContaining({
          source: "url",
          renderMode: "inline",
        }),
      }),
    );
    expect(setSelectedArtifactId).toHaveBeenCalledWith("preview-url-example");
    expect(onRequestCanvasPreviewOpen).toHaveBeenCalledWith({
      filePath: null,
      selectionKey: "artifact:preview-url-example",
    });
    expect(setArtifactViewMode).toHaveBeenCalledWith("preview", {
      artifactId: "preview-url-example",
    });
    expect(setLayoutMode).toHaveBeenCalledWith("chat-canvas");
  });

  it("读取带 App Server scope 的 artifact 时应走 artifact/read current 主链", async () => {
    const readFilePreviewSpy = vi.spyOn(fileBrowserModule, "readFilePreview");
    mockHasArtifactPreviewScope.mockReturnValue(true);
    mockReadArtifactPreviewContent.mockResolvedValueOnce({
      artifactRef: "artifact-report",
      artifactId: "artifact-report",
      filePath: ".app-server/artifacts/report.md",
      content: "# App Server 正文",
    });
    const artifact = createArtifact({
      id: "artifact-report",
      content: "",
      meta: {
        filePath: ".app-server/artifacts/report.md",
        filename: "report.md",
        sessionId: "session-1",
        turnId: "turn-1",
        artifactRef: "artifact-report",
      },
    });
    const { render, getValue } = renderHook();

    await render();

    const preview = await getValue().handleHarnessLoadFilePreview(
      ".app-server/artifacts/report.md",
      artifact,
    );

    expect(mockHasArtifactPreviewScope).toHaveBeenCalledWith(
      artifact,
      ".app-server/artifacts/report.md",
    );
    expect(mockReadArtifactPreviewContent).toHaveBeenCalledWith(
      artifact,
      ".app-server/artifacts/report.md",
    );
    expect(readFilePreviewSpy).not.toHaveBeenCalled();
    expect(preview).toEqual({
      artifactId: "artifact-report",
      artifactRef: "artifact-report",
      path: ".app-server/artifacts/report.md",
      content: "# App Server 正文",
      isBinary: false,
      size: "# App Server 正文".length,
      error: null,
    });
  });

  it("带 App Server scope 的 artifact 内容不可用时不应回退旧文件预览", async () => {
    const readFilePreviewSpy = vi.spyOn(fileBrowserModule, "readFilePreview");
    mockHasArtifactPreviewScope.mockReturnValue(true);
    mockReadArtifactPreviewContent.mockResolvedValueOnce(null);
    const artifact = createArtifact({
      id: "artifact-report",
      content: "",
      meta: {
        filePath: "report.md",
        filename: "report.md",
        sessionId: "session-1",
        artifactRef: "artifact-report",
      },
    });
    const { render, getValue } = renderHook({
      taskFiles: [
        {
          id: "task-report",
          name: "report.md",
          type: "document",
          content: "# 旧任务文件",
          version: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });

    await render();

    const preview = await getValue().handleHarnessLoadFilePreview(
      "report.md",
      artifact,
    );

    expect(mockHasArtifactPreviewScope).toHaveBeenCalledWith(
      artifact,
      "report.md",
    );
    expect(mockReadArtifactPreviewContent).toHaveBeenCalledWith(
      artifact,
      "report.md",
    );
    expect(readFilePreviewSpy).not.toHaveBeenCalled();
    expect(preview).toEqual({
      path: "report.md",
      content: null,
      isBinary: false,
      size: 0,
      error: "App Server artifact 内容不可用",
    });
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
});
