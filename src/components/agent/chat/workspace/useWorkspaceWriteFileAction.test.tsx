import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceWriteFileAction } from "./useWorkspaceWriteFileAction";

type HookProps = Parameters<typeof useWorkspaceWriteFileAction>[0];

const mountedRoots: Array<{ container: HTMLDivElement; root: Root }> = [];

function renderHook(props?: Partial<HookProps>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let latestValue: ReturnType<typeof useWorkspaceWriteFileAction> | null = null;

  const defaultProps: HookProps = {
    activeTheme: "general",
    artifacts: [],
    contentId: null,
    currentGateKey: "idle",
    isThemeWorkbench: false,
    mappedTheme: "general",
    projectId: null,
    sessionId: null,
    themeWorkbenchActiveQueueItem: null,
    taskFilesRef: { current: [] },
    socialStageLogRef: { current: {} },
    setDocumentVersionStatusMap: vi.fn(),
    saveSessionFile: vi.fn(async () => undefined),
    upsertGeneralArtifact: vi.fn(),
    setSelectedArtifactId: vi.fn(),
    setArtifactViewMode: vi.fn(),
    setLayoutMode: vi.fn(),
    suppressCanvasAutoOpen: false,
    setTaskFiles: vi.fn(),
    setSelectedFileId: vi.fn(),
    setCanvasState: vi.fn(),
  };

  function Probe(currentProps: HookProps) {
    latestValue = useWorkspaceWriteFileAction(currentProps);
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
    defaultProps,
  };
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
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

describe("useWorkspaceWriteFileAction", () => {
  it.each([false, true])(
    "普通文件保存失败=%s 时仍保留当前产物投影",
    async (failed) => {
      const saveSessionFile = failed
        ? vi.fn().mockRejectedValue(new Error("disk full"))
        : vi.fn().mockResolvedValue(undefined);
      const upsertGeneralArtifact = vi.fn();
      const setSelectedArtifactId = vi.fn();
      const error = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      const { render, getValue } = renderHook({
        saveSessionFile,
        upsertGeneralArtifact,
        setSelectedArtifactId,
      });
      await render();
      await act(async () => {
        getValue()("export const value = 1;", "result.ts", {
          status: "complete",
        });
        await Promise.resolve();
      });

      expect(saveSessionFile).toHaveBeenCalledTimes(1);
      expect(saveSessionFile).toHaveBeenCalledWith(
        "result.ts",
        "export const value = 1;",
        expect.any(Object),
      );
      const artifact = upsertGeneralArtifact.mock.calls[0]?.[0];
      expect(artifact).toMatchObject({
        content: "export const value = 1;",
        status: "complete",
      });
      expect(setSelectedArtifactId).toHaveBeenCalledWith(artifact.id);
      if (failed)
        expect(error).toHaveBeenCalledWith(
          "[LocalConversationPage] 持久化 artifact 失败:",
          expect.objectContaining({ message: "disk full" }),
        );
      else expect(error).not.toHaveBeenCalled();
    },
  );
  it("pending A2UI 期间写入编程产物时不应自动拉起画布", async () => {
    const setArtifactViewMode = vi.fn();
    const setLayoutMode = vi.fn();
    const { render, getValue } = renderHook({
      setArtifactViewMode,
      setLayoutMode,
      suppressCanvasAutoOpen: true,
    });

    await render();

    act(() => {
      getValue()("<html><body>spring</body></html>", "spring.html", {
        status: "streaming",
        metadata: {
          writePhase: "streaming",
        },
      });
    });

    expect(setArtifactViewMode).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        artifactId: expect.any(String),
      }),
    );
    expect(setLayoutMode).not.toHaveBeenCalled();
  });

  it("完成态 HTML 产物应更新预览选择，但不再被动打开画布", async () => {
    const setArtifactViewMode = vi.fn();
    const setLayoutMode = vi.fn();
    const { render, getValue } = renderHook({
      setArtifactViewMode,
      setLayoutMode,
      suppressCanvasAutoOpen: false,
    });

    await render();

    act(() => {
      getValue()("<html><body>spring</body></html>", "spring.html", {
        status: "complete",
        metadata: {
          writePhase: "completed",
        },
      });
    });

    expect(setArtifactViewMode).toHaveBeenCalledWith(
      "preview",
      expect.objectContaining({
        artifactId: expect.any(String),
      }),
    );
    expect(setLayoutMode).not.toHaveBeenCalled();
  });

  it("完成态文章文档应自动打开右侧画布", async () => {
    const setSelectedArtifactId = vi.fn();
    const setArtifactViewMode = vi.fn();
    const setLayoutMode = vi.fn();
    const { render, getValue } = renderHook({
      setSelectedArtifactId,
      setArtifactViewMode,
      setLayoutMode,
      suppressCanvasAutoOpen: false,
    });

    await render();

    act(() => {
      getValue()(
        "# AI 大模型观察\n\n这是一篇完整草稿。",
        "exports/x-article-export/latest/index.md",
        {
          source: "artifact_snapshot",
          status: "complete",
          metadata: {
            writePhase: "completed",
          },
        },
      );
    });

    expect(setSelectedArtifactId).toHaveBeenCalledWith(expect.any(String));
    expect(setArtifactViewMode).toHaveBeenCalledWith(
      "preview",
      expect.objectContaining({
        artifactId: expect.any(String),
      }),
    );
    expect(setLayoutMode).toHaveBeenCalledWith("chat-canvas");
  });

  it("tool_result 来源的通用产物不应自动选中或展开工作台", async () => {
    const setSelectedArtifactId = vi.fn();
    const setArtifactViewMode = vi.fn();
    const setLayoutMode = vi.fn();
    const { render, getValue } = renderHook({
      setSelectedArtifactId,
      setArtifactViewMode,
      setLayoutMode,
      suppressCanvasAutoOpen: false,
    });

    await render();

    act(() => {
      getValue()("## 结果摘要", "summary.md", {
        source: "tool_result",
        status: "complete",
        metadata: {
          writePhase: "completed",
        },
      });
    });

    expect(setSelectedArtifactId).not.toHaveBeenCalled();
    expect(setArtifactViewMode).not.toHaveBeenCalled();
    expect(setLayoutMode).not.toHaveBeenCalled();
  });

  it("document 型 tool_start 产物不应在通用对话里自动抢占当前画布", async () => {
    const setSelectedArtifactId = vi.fn();
    const setArtifactViewMode = vi.fn();
    const setLayoutMode = vi.fn();
    const { render, getValue } = renderHook({
      setSelectedArtifactId,
      setArtifactViewMode,
      setLayoutMode,
      suppressCanvasAutoOpen: false,
    });

    await render();

    act(() => {
      getValue()("# 导出中", "exports/x-article-export/result.md", {
        source: "tool_start",
        status: "streaming",
        metadata: {
          writePhase: "streaming",
        },
      });
    });

    expect(setSelectedArtifactId).not.toHaveBeenCalled();
    expect(setArtifactViewMode).not.toHaveBeenCalled();
    expect(setLayoutMode).not.toHaveBeenCalled();
  });

  it("空内容的图片 tool_result 不应进入通用 artifact 工作台", async () => {
    const upsertGeneralArtifact = vi.fn();
    const setSelectedArtifactId = vi.fn();
    const { render, getValue } = renderHook({
      upsertGeneralArtifact,
      setSelectedArtifactId,
    });

    await render();

    act(() => {
      getValue()("", "output_image.jpg", {
        source: "tool_result",
        status: "complete",
        metadata: {
          writePhase: "completed",
        },
      });
    });

    expect(upsertGeneralArtifact).not.toHaveBeenCalled();
    expect(setSelectedArtifactId).not.toHaveBeenCalled();
  });

  it("进行中的流式写入应只更新当前产物态，不再自动展开画布", async () => {
    const setArtifactViewMode = vi.fn();
    const setLayoutMode = vi.fn();
    const { render, getValue } = renderHook({
      setArtifactViewMode,
      setLayoutMode,
      suppressCanvasAutoOpen: false,
    });

    await render();

    act(() => {
      getValue()("# 研究简报\n\n第一段", "brief.md", {
        status: "streaming",
        metadata: {
          writePhase: "streaming",
        },
      });
    });

    expect(setArtifactViewMode).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        artifactId: expect.any(String),
      }),
    );
    expect(setLayoutMode).not.toHaveBeenCalled();
  });

  it("内容发布主稿写入时应把创作语义 metadata 一起持久化并挂到任务文件", async () => {
    const taskFilesRef: HookProps["taskFilesRef"] = { current: [] };
    const saveSessionFile = vi.fn(async () => undefined);
    const setTaskFiles = vi.fn((next) => {
      taskFilesRef.current =
        typeof next === "function" ? next(taskFilesRef.current) : next;
      return taskFilesRef.current;
    });
    const { render, getValue } = renderHook({
      isThemeWorkbench: true,
      activeTheme: "general",
      mappedTheme: "general",
      currentGateKey: "write_mode",
      themeWorkbenchActiveQueueItem: {
        run_id: "run-content-preview",
        title: "生成渠道预览稿",
        status: "running",
      },
      taskFilesRef,
      saveSessionFile,
      setTaskFiles,
    });

    await render();

    act(() => {
      getValue()(
        "# 春日咖啡活动\n\n首屏预览",
        "content-posts/demo-preview.md",
        {
          status: "complete",
          metadata: {
            writePhase: "completed",
            contentPostIntent: "preview",
            contentPostLabel: "渠道预览稿",
            contentPostPlatformLabel: "小红书",
          },
        },
      );
    });

    expect(saveSessionFile).toHaveBeenCalledWith(
      "content-posts/demo-preview.md",
      "# 春日咖啡活动\n\n首屏预览",
      expect.objectContaining({
        artifactType: "draft",
        stage: "drafting",
        versionLabel: "社媒初稿",
        contentPostIntent: "preview",
        contentPostLabel: "渠道预览稿",
        contentPostPlatformLabel: "小红书",
      }),
    );
    expect(taskFilesRef.current).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "content-posts/demo-preview.md",
          metadata: expect.objectContaining({
            artifactType: "draft",
            stage: "drafting",
            versionLabel: "社媒初稿",
            contentPostIntent: "preview",
            contentPostLabel: "渠道预览稿",
          }),
        }),
      ]),
    );
  });
});
