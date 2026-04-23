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
const { mockGenerateAgentRuntimeTitle } = vi.hoisted(() => ({
  mockGenerateAgentRuntimeTitle: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast,
}));

vi.mock("@/lib/api/agentRuntime", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/api/agentRuntime")>();

  return {
    ...actual,
    generateAgentRuntimeTitle: (...args: unknown[]) =>
      mockGenerateAgentRuntimeTitle(...args),
  };
});

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
    submitImageWorkbenchAgentCommand: vi.fn().mockResolvedValue(true),
    setCanvasState: vi.fn(),
    setInput: vi.fn(),
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

  mockGenerateAgentRuntimeTitle.mockReset();
  mockGenerateAgentRuntimeTitle.mockResolvedValue("城市夜景主视觉");
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
  it("应通过 Agent 主链提交图片 skill launch，而不是前端直建 task", async () => {
    const submitImageWorkbenchAgentCommand = vi.fn().mockResolvedValue(true);
    const createImageGenerationTask = vi.fn();
    const { render, getValue } = renderHook({
      submitImageWorkbenchAgentCommand,
      createImageGenerationTask,
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
    expect(submitImageWorkbenchAgentCommand).toHaveBeenCalledTimes(1);
    expect(submitImageWorkbenchAgentCommand).toHaveBeenCalledWith({
      rawText: "@配图 生成 城市夜景主视觉",
      displayContent: "@配图 生成 城市夜景主视觉",
      images: [],
      requestContext: expect.objectContaining({
        kind: "image_task",
        image_task: expect.objectContaining({
          title: "城市夜景主视觉",
          mode: "generate",
          prompt: "城市夜景主视觉",
          size: "1024x1024",
          usage: "claw-image-workbench",
          session_id: "session-1",
          project_id: "project-1",
          entry_source: "at_image_command",
          requested_target: "generate",
        }),
      }),
    });
    expect(mockGenerateAgentRuntimeTitle).toHaveBeenCalledWith({
      previewText: "城市夜景主视觉",
      titleKind: "image_task",
    });
    expect(createImageGenerationTask).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("本地图片工作台 key 首次提交时应保留统一发送主线，延后由发送边界绑定真实会话", async () => {
    const submitImageWorkbenchAgentCommand = vi.fn().mockResolvedValue(true);
    const localImageWorkbenchSessionKey =
      "__local_image_workbench__:draft:image";
    const { render, getValue } = renderHook({
      submitImageWorkbenchAgentCommand,
      imageWorkbenchSessionKey: localImageWorkbenchSessionKey,
    });

    await render();

    await act(async () => {
      await getValue().handleImageWorkbenchCommand({
        rawText: "@配图 生成 城市夜景主视觉",
        parsedCommand: createParsedCommand(),
        images: [],
      });
    });

    expect(submitImageWorkbenchAgentCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        requestContext: expect.objectContaining({
          image_task: expect.objectContaining({
            session_id: localImageWorkbenchSessionKey,
          }),
        }),
      }),
    );
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

  it("跨根目录图片任务应优先使用 task file 进行重试与取消", async () => {
    const externalTaskPath =
      "/Users/youmin/.lime/tasks/image_generate/task-image-external-1.json";
    const externalArtifactPath =
      ".lime/tasks/image_generate/task-image-external-1.json";
    const currentImageWorkbenchState = {
      ...createInitialSessionImageWorkbenchState(),
      tasks: [
        {
          id: "task-image-external-1",
          sessionId: "task-image-external-1",
          mode: "generate" as const,
          status: "cancelled" as const,
          prompt: "跨根目录任务",
          rawText: "跨根目录任务",
          expectedCount: 1,
          outputIds: [],
          targetOutputId: null,
          createdAt: 100,
          hookImageIds: [],
          applyTarget: null,
          taskFilePath: externalTaskPath,
          artifactPath: externalArtifactPath,
        },
      ],
    };
    const getImageTask = vi.fn().mockResolvedValue({
      success: true,
      task_id: "task-image-external-1",
      task_type: "image_generate",
      task_family: "image",
      status: "cancelled",
      normalized_status: "cancelled",
      path: externalArtifactPath,
      absolute_path: externalTaskPath,
      artifact_path: externalArtifactPath,
      absolute_artifact_path: externalTaskPath,
      reused_existing: false,
      record: {
        task_id: "task-image-external-1",
        task_type: "image_generate",
        task_family: "image",
        payload: {
          prompt: "跨根目录任务",
          mode: "generate",
          raw_text: "@配图 生成 跨根目录任务",
          size: "1024x1024",
          count: 1,
          usage: "claw-image-workbench",
          session_id: "session-1",
          project_id: "project-1",
          entry_source: "at_image_command",
          requested_target: "generate",
          reference_images: [],
        },
        status: "cancelled",
        normalized_status: "cancelled",
        created_at: "2026-04-04T12:10:00Z",
      },
    });
    const createImageGenerationTask = vi.fn().mockResolvedValue({
      task_id: "task-image-external-new",
      task_type: "image_generate",
      status: "pending_submit",
    });
    const cancelImageTask = vi.fn().mockResolvedValue({
      task_id: "task-image-external-1",
      task_type: "image_generate",
      status: "cancelled",
    });
    const { render } = renderHook({
      currentImageWorkbenchState,
      getImageTask,
      createImageGenerationTask,
      cancelImageTask,
    });

    await render();

    await act(async () => {
      emitImageWorkbenchTaskAction({
        action: "retry",
        taskId: "task-image-external-1",
        projectId: "project-1",
        contentId: null,
      });
      emitImageWorkbenchTaskAction({
        action: "cancel",
        taskId: "task-image-external-1",
        projectId: "project-1",
        contentId: null,
      });
      await Promise.resolve();
    });

    expect(getImageTask).toHaveBeenCalledWith({
      projectRootPath: "/Users/youmin",
      taskRef: externalTaskPath,
    });
    expect(createImageGenerationTask).toHaveBeenCalledWith(
      expect.objectContaining({
        projectRootPath: "/Users/youmin",
      }),
    );
    expect(cancelImageTask).toHaveBeenCalledWith({
      projectRootPath: "/Users/youmin",
      taskRef: externalTaskPath,
    });
  });

  it("文稿插图任务应把 document-inline slot 信息写入 Agent launch 上下文", async () => {
    const submitImageWorkbenchAgentCommand = vi.fn().mockResolvedValue(true);
    const { render, getValue } = renderHook({
      submitImageWorkbenchAgentCommand,
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

    expect(submitImageWorkbenchAgentCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        requestContext: expect.objectContaining({
          image_task: expect.objectContaining({
            usage: "document-inline",
            slot_id: expect.stringMatching(/^document-image-slot-/),
            anchor_hint: "section_end",
            anchor_section_title: "核心观点",
            anchor_text: "这里是核心观点段落。",
          }),
        }),
      }),
    );
  });

  it("应用图片结果时应只关闭图片工作台并派发插入，不主动切换布局", async () => {
    const updateCurrentImageWorkbenchState = vi.fn();
    const currentImageWorkbenchState: HookProps["currentImageWorkbenchState"] = {
      ...createInitialSessionImageWorkbenchState(),
      selectedOutputId: "task-image-1:output:1",
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
          applyTarget: {
            kind: "canvas-insert" as const,
            canvasType: "document" as const,
            anchorHint: "section_end" as const,
            sectionTitle: "核心观点",
            anchorText: "这里是核心观点段落。",
            actionLabel: "插入文稿",
            dispatchLabel: "已切回文稿，正在插入图片",
          },
        },
      ],
    };
    const { render, getValue } = renderHook({
      currentImageWorkbenchState,
      updateCurrentImageWorkbenchState,
    });

    await render();

    act(() => {
      getValue().handleApplySelectedImageWorkbenchOutput();
    });

    expect(updateCurrentImageWorkbenchState).toHaveBeenCalledTimes(1);
    expect(updateCurrentImageWorkbenchState).toHaveBeenCalledWith(
      expect.any(Function),
    );
    expect(toast.info).toHaveBeenCalledWith("已切回文稿，正在插入图片");
    expect(toast.error).not.toHaveBeenCalled();
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
