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
    currentStepIndex: 0,
    isSpecializedThemeMode: false,
    isThemeWorkbench: false,
    mappedTheme: "general",
    projectId: null,
    sessionId: null,
    themeWorkbenchActiveQueueItem: null,
    taskFilesRef: { current: [] },
    socialStageLogRef: { current: {} },
    setDocumentVersionStatusMap: vi.fn(),
    saveSessionFile: vi.fn(async () => undefined),
    syncGeneralArtifactToResource: vi.fn(async () => ({
      status: "inactive" as const,
    })),
    upsertGeneralArtifact: vi.fn(),
    setSelectedArtifactId: vi.fn(),
    setArtifactViewMode: vi.fn(),
    setLayoutMode: vi.fn(),
    suppressCanvasAutoOpen: false,
    completeStep: vi.fn(),
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

  it("进行中的流式写入仍应自动展开画布，便于实时查看输出", async () => {
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
    expect(setLayoutMode).toHaveBeenCalledWith("chat-canvas");
  });
});
