import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialSessionImageWorkbenchState } from "./imageWorkbenchHelpers";
import { useWorkspaceImageWorkbenchActionRuntime } from "./useWorkspaceImageWorkbenchActionRuntime";

const { toast } = vi.hoisted(() => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast,
}));

type HookProps = Parameters<typeof useWorkspaceImageWorkbenchActionRuntime>[0];

const mountedRoots: Array<{ container: HTMLDivElement; root: Root }> = [];

function createParsedCommand() {
  return {
    rawText: "@配图 生成 城市夜景主视觉",
    trigger: "@配图" as const,
    body: "生成 城市夜景主视觉",
    mode: "generate" as const,
    prompt: "城市夜景主视觉",
    count: 1,
    size: "1024x1024",
    aspectRatio: undefined,
    targetRef: undefined,
  };
}

function renderHook(props?: Partial<HookProps>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let latestValue: ReturnType<typeof useWorkspaceImageWorkbenchActionRuntime> | null =
    null;

  const defaultProps: HookProps = {
    appendLocalDispatchMessages: vi.fn(),
    contentId: null,
    createImageGenerationTask: vi.fn().mockResolvedValue({
      task_id: "task-image-1",
      task_type: "image_generate",
    }),
    currentImageWorkbenchState: createInitialSessionImageWorkbenchState(),
    imageWorkbenchSelectedModelId: "fal-ai/nano-banana-pro",
    imageWorkbenchSelectedProviderId: "fal",
    imageWorkbenchSelectedSize: "1024x1024",
    imageWorkbenchSessionKey: "session-1",
    projectId: "project-1",
    projectRootPath: "/workspace/project-1",
    saveImageWorkbenchImagesToResource: vi.fn().mockResolvedValue({
      saved: 0,
      skipped: 0,
      errors: [],
    }),
    setCanvasState: vi.fn(),
    setInput: vi.fn(),
    setLayoutMode: vi.fn(),
    setMentionedCharacters: vi.fn(),
    updateCurrentImageWorkbenchState: vi.fn(),
  };

  function Probe(currentProps: HookProps) {
    latestValue = useWorkspaceImageWorkbenchActionRuntime(currentProps);
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
  };
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  toast.error.mockReset();
  toast.info.mockReset();
  toast.success.mockReset();
  toast.warning.mockReset();
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

describe("useWorkspaceImageWorkbenchActionRuntime", () => {
  it("应创建标准图片任务 artifact，并只先写入用户消息", async () => {
    const appendLocalDispatchMessages = vi.fn();
    const createImageGenerationTask = vi.fn().mockResolvedValue({
      task_id: "task-image-1",
      task_type: "image_generate",
    });
    const setInput = vi.fn();
    const setMentionedCharacters = vi.fn();
    const setLayoutMode = vi.fn();
    const { render, getValue } = renderHook({
      appendLocalDispatchMessages,
      createImageGenerationTask,
      setInput,
      setMentionedCharacters,
      setLayoutMode,
    });

    await render();

    let handled = false;
    await act(async () => {
      handled = await getValue().handleImageWorkbenchCommand({
        rawText: "@配图 生成 城市夜景主视觉",
        parsedCommand: createParsedCommand(),
        images: [],
      });
    });

    expect(handled).toBe(true);
    expect(appendLocalDispatchMessages).toHaveBeenCalledTimes(1);
    expect(appendLocalDispatchMessages.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({
        role: "user",
        content: "@配图 生成 城市夜景主视觉",
      }),
    ]);
    expect(createImageGenerationTask).toHaveBeenCalledWith({
      projectRootPath: "/workspace/project-1",
      prompt: "城市夜景主视觉",
      title: "城市夜景主视觉",
      mode: "generate",
      rawText: "@配图 生成 城市夜景主视觉",
      size: "1024x1024",
      aspectRatio: undefined,
      count: 1,
      usage: "claw-image-workbench",
      providerId: "fal",
      model: "fal-ai/nano-banana-pro",
      sessionId: "session-1",
      projectId: "project-1",
      contentId: undefined,
      entrySource: "at_image_command",
      requestedTarget: "generate",
      targetOutputId: undefined,
      targetOutputRefId: undefined,
      referenceImages: [],
    });
    expect(setInput).toHaveBeenCalledWith("");
    expect(setMentionedCharacters).toHaveBeenCalledWith([]);
    expect(setLayoutMode).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("创建 task artifact 失败时应回填本地失败消息", async () => {
    const appendLocalDispatchMessages = vi.fn();
    const createImageGenerationTask = vi
      .fn()
      .mockRejectedValue(new Error("图片服务暂不可用"));
    const { render, getValue } = renderHook({
      appendLocalDispatchMessages,
      createImageGenerationTask,
    });

    await render();

    await act(async () => {
      await getValue().handleImageWorkbenchCommand({
        rawText: "@配图 生成 城市夜景主视觉",
        parsedCommand: createParsedCommand(),
        images: [],
      });
    });

    expect(appendLocalDispatchMessages).toHaveBeenCalledTimes(2);
    expect(appendLocalDispatchMessages.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({
        role: "user",
        content: "@配图 生成 城市夜景主视觉",
      }),
    ]);
    expect(appendLocalDispatchMessages.mock.calls[1]?.[0]).toEqual([
      expect.objectContaining({
        role: "assistant",
        content: "图片任务创建失败：图片服务暂不可用",
        isThinking: false,
      }),
    ]);
    expect(toast.error).toHaveBeenCalledWith("图片服务暂不可用");
  });
});
