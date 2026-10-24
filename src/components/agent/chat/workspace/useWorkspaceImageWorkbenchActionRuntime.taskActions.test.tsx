import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { emitImageWorkbenchTaskAction } from "@/lib/imageWorkbenchEvents";
import { createInitialSessionImageWorkbenchState } from "./imageWorkbenchHelpers";
import {
  type HookProps,
  renderHook,
  toast,
} from "./useWorkspaceImageWorkbenchActionRuntime.testFixtures";

describe("useWorkspaceImageWorkbenchActionRuntime task actions", () => {
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
          title_generation_result: {
            title: "城市夜景主视觉",
            sessionId: "title-session-1",
            executionRuntime: {
              route: "auxiliary.generate_title",
            },
            usedFallback: false,
            fallbackReason: null,
          },
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
      titleGenerationResult: {
        title: "城市夜景主视觉",
        sessionId: "title-session-1",
        executionRuntime: {
          route: "auxiliary.generate_title",
        },
        usedFallback: false,
        fallbackReason: null,
      },
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

  it("草稿图片任务失败后应允许从轻卡单独重试", async () => {
    const getImageTask = vi.fn().mockRejectedValue(new Error("not found"));
    const createImageGenerationTask = vi.fn().mockResolvedValue({
      task_id: "task-image-retry-from-draft",
      task_type: "image_generate",
      status: "pending_submit",
    });
    const currentImageWorkbenchState: HookProps["currentImageWorkbenchState"] =
      {
        ...createInitialSessionImageWorkbenchState(),
        tasks: [
          {
            id: "draft-image-failed-1",
            sessionId: "draft-image-failed-1",
            mode: "generate",
            status: "error",
            prompt: "极简线稿风的柠檬水杯配图",
            rawText: "@配图 生成一张极简线稿风的柠檬水杯配图，1:1",
            expectedCount: 1,
            outputIds: [],
            targetOutputId: null,
            createdAt: 100,
            hookImageIds: [],
            applyTarget: null,
            taskFilePath: null,
            artifactPath: null,
          },
        ],
      };
    const { render } = renderHook({
      currentImageWorkbenchState,
      createImageGenerationTask,
      getImageTask,
    });

    await render();

    await act(async () => {
      emitImageWorkbenchTaskAction({
        action: "retry",
        taskId: "draft-image-failed-1",
        projectId: "project-1",
        contentId: null,
      });
      await Promise.resolve();
    });

    expect(getImageTask).toHaveBeenCalledWith({
      projectRootPath: "/workspace/project-1",
      taskRef: "draft-image-failed-1",
    });
    expect(createImageGenerationTask).toHaveBeenCalledWith({
      projectRootPath: "/workspace/project-1",
      prompt: "极简线稿风的柠檬水杯配图",
      title: "极简线稿风的柠檬水杯配图",
      titleGenerationResult: undefined,
      mode: "generate",
      rawText: "@配图 生成一张极简线稿风的柠檬水杯配图，1:1",
      layoutHint: undefined,
      size: "1024x1024",
      aspectRatio: undefined,
      count: 1,
      usage: "claw-image-workbench",
      slotId: undefined,
      anchorHint: undefined,
      anchorSectionTitle: undefined,
      anchorText: undefined,
      style: undefined,
      providerId: "fal",
      model: "fal-ai/nano-banana-pro",
      sessionId: "session-1",
      projectId: "project-1",
      contentId: undefined,
      entrySource: "image_workbench_retry",
      requestedTarget: "generate",
      targetOutputId: undefined,
      targetOutputRefId: undefined,
      referenceImages: [],
    });
    expect(toast.success).toHaveBeenCalledWith("已重新创建图片任务");
  });

  it("草稿重试不应从 runtimeContract 展示元数据恢复 provider/model 路由", async () => {
    const getImageTask = vi.fn().mockRejectedValue(new Error("not found"));
    const createImageGenerationTask = vi.fn().mockResolvedValue({
      task_id: "task-image-retry-with-route-resolver",
      task_type: "image_generate",
      status: "pending_submit",
    });
    const currentImageWorkbenchState: HookProps["currentImageWorkbenchState"] =
      {
        ...createInitialSessionImageWorkbenchState(),
        tasks: [
          {
            id: "draft-image-runtime-contract-1",
            sessionId: "draft-image-runtime-contract-1",
            mode: "generate",
            status: "error",
            prompt: "复用当前路由生成插画",
            rawText: "复用当前路由生成插画",
            expectedCount: 1,
            outputIds: [],
            targetOutputId: null,
            createdAt: 100,
            hookImageIds: [],
            applyTarget: null,
            taskFilePath: null,
            artifactPath: null,
            runtimeContract: {
              contractKey: "image_generation",
              routingSlot: "image_generation_model",
              providerId: "legacy-provider-from-display",
              model: "legacy-model-from-display",
            },
          },
        ],
      };
    const { render } = renderHook({
      currentImageWorkbenchState,
      createImageGenerationTask,
      getImageTask,
      imageWorkbenchSelectedModelId: undefined,
      imageWorkbenchSelectedProviderId: undefined,
    });

    await render();

    await act(async () => {
      emitImageWorkbenchTaskAction({
        action: "retry",
        taskId: "draft-image-runtime-contract-1",
        projectId: "project-1",
        contentId: null,
      });
      await Promise.resolve();
    });

    expect(createImageGenerationTask).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: undefined,
        model: undefined,
        entrySource: "image_workbench_retry",
      }),
    );
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
});
