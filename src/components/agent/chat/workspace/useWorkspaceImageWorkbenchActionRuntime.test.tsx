import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emitImageWorkbenchTaskAction } from "@/lib/imageWorkbenchEvents";
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
  let latestValue: ReturnType<
    typeof useWorkspaceImageWorkbenchActionRuntime
  > | null = null;

  const defaultProps: HookProps = {
    appendLocalDispatchMessages: vi.fn(),
    canvasState: null,
    cancelImageTask: vi.fn().mockResolvedValue({
      task_id: "task-image-1",
      task_type: "image_generate",
      status: "cancelled",
    }),
    contentId: null,
    createImageGenerationTask: vi.fn().mockResolvedValue({
      task_id: "task-image-1",
      task_type: "image_generate",
    }),
    getImageTask: vi.fn().mockResolvedValue({
      task_id: "task-image-1",
      task_type: "image_generate",
      task_family: "image",
      status: "cancelled",
      normalized_status: "cancelled",
      path: ".lime/tasks/image_generate/task-image-1.json",
      absolute_path:
        "/workspace/project-1/.lime/tasks/image_generate/task-image-1.json",
      artifact_path: ".lime/tasks/image_generate/task-image-1.json",
      absolute_artifact_path:
        "/workspace/project-1/.lime/tasks/image_generate/task-image-1.json",
      reused_existing: false,
      record: {
        task_id: "task-image-1",
        task_type: "image_generate",
        task_family: "image",
        relationships: {
          slot_id: "document-slot-inline-retry",
        },
        payload: {
          prompt: "城市夜景主视觉",
          mode: "generate",
          raw_text: "@配图 生成 城市夜景主视觉",
          size: "1024x1024",
          count: 1,
          usage: "claw-image-workbench",
          provider_id: "fal",
          model: "fal-ai/nano-banana-pro",
          session_id: "session-1",
          project_id: "project-1",
          entry_source: "at_image_command",
          requested_target: "generate",
          anchor_hint: "section_end",
          anchor_section_title: "技术亮点",
          reference_images: [],
        },
        status: "cancelled",
        normalized_status: "cancelled",
        created_at: "2026-04-04T12:00:00Z",
      },
      success: true,
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
      success: true,
      task_id: "task-image-1",
      task_type: "image_generate",
      task_family: "image",
      status: "pending_submit",
      normalized_status: "pending",
      path: ".lime/tasks/image_generate/task-image-1.json",
      absolute_path:
        "/workspace/project-1/.lime/tasks/image_generate/task-image-1.json",
      artifact_path: ".lime/tasks/image_generate/task-image-1.json",
      absolute_artifact_path:
        "/workspace/project-1/.lime/tasks/image_generate/task-image-1.json",
      reused_existing: false,
      record: {
        task_id: "task-image-1",
        task_type: "image_generate",
        task_family: "image",
        status: "pending_submit",
        normalized_status: "pending",
        created_at: "2026-04-05T00:00:00Z",
        payload: {
          prompt: "城市夜景主视觉",
          raw_text: "@配图 生成 城市夜景主视觉",
          count: 1,
          size: "1024x1024",
        },
      },
    });
    const setInput = vi.fn();
    const setMentionedCharacters = vi.fn();
    const setLayoutMode = vi.fn();
    const updateCurrentImageWorkbenchState = vi.fn();
    const { render, getValue } = renderHook({
      appendLocalDispatchMessages,
      createImageGenerationTask,
      setInput,
      setMentionedCharacters,
      setLayoutMode,
      updateCurrentImageWorkbenchState,
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
    expect(appendLocalDispatchMessages).toHaveBeenCalledTimes(2);
    expect(appendLocalDispatchMessages.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({
        role: "user",
        content: "@配图 生成 城市夜景主视觉",
      }),
    ]);
    expect(appendLocalDispatchMessages.mock.calls[1]?.[0]).toEqual([
      expect.objectContaining({
        id: "image-workbench:task-image-1:assistant",
        role: "assistant",
        content: "图片任务已创建，正在准备执行。",
        isThinking: true,
        toolCalls: [
          expect.objectContaining({
            name: "limeCreateImageGenerationTask",
            status: "running",
          }),
        ],
        imageWorkbenchPreview: expect.objectContaining({
          taskId: "task-image-1",
          status: "running",
        }),
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
      slotId: undefined,
      anchorHint: undefined,
      anchorSectionTitle: undefined,
      anchorText: undefined,
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
    expect(updateCurrentImageWorkbenchState).toHaveBeenCalledTimes(1);
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

  it("应把编辑命令解析为统一的 skillRequest 上下文", async () => {
    const currentImageWorkbenchState = {
      ...createInitialSessionImageWorkbenchState(),
      outputs: [
        {
          id: "task-image-1:output:1",
          taskId: "task-image-1",
          hookImageId: "task-image-1:hook:1",
          refId: "img-2",
          url: "https://example.com/image-2.png",
          prompt: "原始图片",
          createdAt: Date.now(),
          providerName: "fal",
          modelName: "fal-ai/nano-banana-pro",
          size: "1024x1024",
          parentOutputId: null,
          resourceSaved: false,
          applyTarget: null,
        },
      ],
    };
    const { render, getValue } = renderHook({
      currentImageWorkbenchState,
    });

    await render();

    const skillRequest = getValue().resolveImageWorkbenchSkillRequest({
      rawText: "@配图 编辑 #img-2 去掉角标，保留主体",
      parsedCommand: {
        rawText: "@配图 编辑 #img-2 去掉角标，保留主体",
        trigger: "@配图",
        body: "编辑 #img-2 去掉角标，保留主体",
        mode: "edit",
        prompt: "去掉角标，保留主体",
        count: 1,
        size: undefined,
        aspectRatio: undefined,
        targetRef: "img-2",
      },
      images: [
        {
          data: "base64-image-1",
          mediaType: "image/png",
        },
      ],
    });

    expect(skillRequest).toMatchObject({
      images: [
        {
          data: "base64-image-1",
          mediaType: "image/png",
        },
      ],
      requestContext: {
        kind: "image_task",
        image_task: {
          mode: "edit",
          prompt: "去掉角标，保留主体",
          target_output_ref_id: "img-2",
          reference_images: [
            "https://example.com/image-2.png",
            "skill-input-image://1",
          ],
        },
      },
    });
  });

  it("停止图片生成时应取消最近仍在运行的任务", async () => {
    const cancelImageTask = vi.fn().mockResolvedValue({
      task_id: "task-running-2",
      task_type: "image_generate",
      status: "cancelled",
    });
    const currentImageWorkbenchState = {
      ...createInitialSessionImageWorkbenchState(),
      tasks: [
        {
          id: "task-running-1",
          sessionId: "task-running-1",
          mode: "generate" as const,
          status: "running" as const,
          prompt: "旧任务",
          rawText: "旧任务",
          expectedCount: 1,
          outputIds: [],
          targetOutputId: null,
          createdAt: 100,
          hookImageIds: [],
          applyTarget: null,
        },
        {
          id: "task-running-2",
          sessionId: "task-running-2",
          mode: "generate" as const,
          status: "queued" as const,
          prompt: "新任务",
          rawText: "新任务",
          expectedCount: 1,
          outputIds: [],
          targetOutputId: null,
          createdAt: 200,
          hookImageIds: [],
          applyTarget: null,
        },
      ],
    };
    const { render, getValue } = renderHook({
      cancelImageTask,
      currentImageWorkbenchState,
    });

    await render();

    await act(async () => {
      await getValue().handleStopImageWorkbenchGeneration();
    });

    expect(cancelImageTask).toHaveBeenCalledWith({
      projectRootPath: "/workspace/project-1",
      taskRef: "task-running-2",
    });
    expect(toast.success).toHaveBeenCalledWith("已提交取消请求");
  });

  it("应响应聊天区图片任务卡发出的重试与取消事件", async () => {
    const getImageTask = vi.fn().mockResolvedValue({
      success: true,
      task_id: "task-image-1",
      task_type: "image_generate",
      task_family: "image",
      status: "cancelled",
      normalized_status: "cancelled",
      path: ".lime/tasks/image_generate/task-image-1.json",
      absolute_path:
        "/workspace/project-1/.lime/tasks/image_generate/task-image-1.json",
      artifact_path: ".lime/tasks/image_generate/task-image-1.json",
      absolute_artifact_path:
        "/workspace/project-1/.lime/tasks/image_generate/task-image-1.json",
      reused_existing: false,
      record: {
        task_id: "task-image-1",
        task_type: "image_generate",
        task_family: "image",
        relationships: {
          slot_id: "document-slot-inline-retry",
        },
        payload: {
          prompt: "城市夜景主视觉",
          mode: "generate",
          raw_text: "@配图 生成 城市夜景主视觉",
          size: "1024x1024",
          count: 1,
          usage: "claw-image-workbench",
          provider_id: "fal",
          model: "fal-ai/nano-banana-pro",
          session_id: "session-1",
          project_id: "project-1",
          entry_source: "at_image_command",
          requested_target: "generate",
          anchor_hint: "section_end",
          anchor_section_title: "技术亮点",
          anchor_text: "这里是技术亮点段落。",
          reference_images: [],
        },
        status: "cancelled",
        normalized_status: "cancelled",
        created_at: "2026-04-04T12:10:00Z",
      },
    });
    const createImageGenerationTask = vi.fn().mockResolvedValue({
      task_id: "task-image-new-1",
      task_type: "image_generate",
      status: "pending_submit",
    });
    const cancelImageTask = vi.fn().mockResolvedValue({
      task_id: "task-image-2",
      task_type: "image_generate",
      status: "cancelled",
    });
    const { render } = renderHook({
      cancelImageTask,
      createImageGenerationTask,
      getImageTask,
    });

    await render();

    await act(async () => {
      emitImageWorkbenchTaskAction({
        action: "retry",
        taskId: "task-image-1",
        projectId: "project-1",
        contentId: null,
      });
      emitImageWorkbenchTaskAction({
        action: "cancel",
        taskId: "task-image-2",
        projectId: "project-1",
        contentId: null,
      });
      await Promise.resolve();
    });

    expect(getImageTask).toHaveBeenCalledWith({
      projectRootPath: "/workspace/project-1",
      taskRef: "task-image-1",
    });
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
      slotId: "document-slot-inline-retry",
      anchorHint: "section_end",
      anchorSectionTitle: "技术亮点",
      anchorText: "这里是技术亮点段落。",
      style: undefined,
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
    expect(cancelImageTask).toHaveBeenCalledWith({
      projectRootPath: "/workspace/project-1",
      taskRef: "task-image-2",
    });
  });

  it("文稿插图任务应创建 document-inline slot 绑定", async () => {
    const createImageGenerationTask = vi.fn().mockResolvedValue({
      task_id: "task-image-1",
      task_type: "image_generate",
    });
    const { render, getValue } = renderHook({
      createImageGenerationTask,
    });

    await render();

    await act(async () => {
      await getValue().handleImageWorkbenchCommand({
        rawText: "@配图 生成 城市夜景主视觉",
        parsedCommand: createParsedCommand(),
        images: [],
        applyTarget: {
          kind: "canvas-insert",
          canvasType: "document",
          anchorHint: "section_end",
          sectionTitle: "核心观点",
          anchorText: "这里是核心观点段落。",
          actionLabel: "插入文稿",
          dispatchLabel: "已切回文稿，正在插入图片",
        },
      });
    });

    expect(createImageGenerationTask).toHaveBeenCalledWith(
      expect.objectContaining({
        usage: "document-inline",
        slotId: expect.stringMatching(/^document-image-slot-/),
        anchorHint: "section_end",
        anchorSectionTitle: "核心观点",
        anchorText: "这里是核心观点段落。",
      }),
    );
  });

  it("继续修图 follow-up 应回填输入框并使用中性提示文案", async () => {
    const setInput = vi.fn();
    const { render, getValue } = renderHook({
      setInput,
    });

    await render();

    act(() => {
      getValue().handleSeedImageWorkbenchFollowUp("@修图 #img-2 去掉角标");
    });

    expect(setInput).toHaveBeenCalledWith("@修图 #img-2 去掉角标");
    expect(toast.info).toHaveBeenCalledWith("已在输入框填入图片命令");
  });
});
