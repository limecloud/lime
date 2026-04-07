import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Artifact } from "@/lib/artifact/types";
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
    const artifact = createArtifact();
    const { render, getValue } = renderHook({
      suppressBrowserAssistCanvasAutoOpen,
      setSelectedArtifactId,
      setArtifactViewMode,
      setLayoutMode,
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

  it("通用模式打开文件预览时应把生成的 artifact 标记为持久项，避免后续同步被清掉", async () => {
    const upsertGeneralArtifact = vi.fn();
    const { render, getValue } = renderHook({
      upsertGeneralArtifact,
    });

    await render();

    act(() => {
      getValue().handleFileClick(
        ".lime/artifacts/thread-1/report.md",
        "# 研究简报\n\n这里是预览内容。",
      );
    });

    expect(upsertGeneralArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "artifact:session:.lime/artifacts/thread-1/report.md",
        meta: expect.objectContaining({
          persistOutsideMessages: true,
          filePath: ".lime/artifacts/thread-1/report.md",
        }),
      }),
    );
  });
});
