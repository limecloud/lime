/**
 * 手动测试：验证图片任务预览能否正确识别顶层数据
 */

import { describe, it, expect } from "vitest";
import { buildImageTaskPreviewFromToolResult } from "./taskPreviewImage";

describe("buildImageTaskPreviewFromToolResult - 顶层数据识别", () => {
  it("应该能识别顶层的图片任务数据", () => {
    const toolResult = {
      success: true,
      task_id: "8f36782d-4c53-42c0-b558-40d27d0c9ca0",
      task_type: "image_generate",
      task_family: "image",
      status: "pending_submit",
      normalized_status: "pending",
      current_attempt_id: "attempt_dcfd2d751c374056a11306bcf26f6b8f",
      path: ".lime/tasks/image_generate/20260702-131835-e94c71281edd47849ce64242842e8b62.json",
      absolute_path:
        "/Users/coso/Library/Application Support/lime/projects/Skill Think Keep Audit 20260513/.lime/tasks/image_generate/20260702-131835-e94c71281edd47849ce64242842e8b62.json",
      artifact_path:
        ".lime/tasks/image_generate/20260702-131835-e94c71281edd47849ce64242842e8b62.json",
      absolute_artifact_path:
        "/Users/coso/Library/Application Support/lime/projects/Skill Think Keep Audit 20260513/.lime/tasks/image_generate/20260702-131835-e94c71281edd47849ce64242842e8b62.json",
      reused_existing: false,
      idempotency_key: "app",
    };

    const preview = buildImageTaskPreviewFromToolResult({
      toolId: "tool-1",
      toolName: "create_image_task",
      toolArguments: '{"prompt": "画一张深圳夏天的图"}',
      toolResult,
      fallbackPrompt: "画一张深圳夏天的图",
    });

    expect(preview).not.toBeNull();
    expect(preview?.taskId).toBe("8f36782d-4c53-42c0-b558-40d27d0c9ca0");
    expect(preview?.status).toBe("running");
    expect(preview?.prompt).toBe("画一张深圳夏天的图");
  });

  it("应该能识别嵌套在 metadata 中的图片任务数据", () => {
    const toolResult = {
      success: true,
      metadata: {
        task_id: "test-image-task-1",
        task_type: "image_generate",
        task_family: "image",
        status: "complete",
      },
    };

    const preview = buildImageTaskPreviewFromToolResult({
      toolId: "tool-2",
      toolName: "image_task",
      toolArguments: undefined,
      toolResult,
      fallbackPrompt: "生成图片",
    });

    expect(preview).not.toBeNull();
    expect(preview?.taskId).toBe("test-image-task-1");
    expect(preview?.status).toBe("complete");
  });

  it("应该能识别 task_family 为 image 的任务", () => {
    const toolResult = {
      task_id: "family-test-1",
      task_family: "image",
      status: "running",
    };

    const preview = buildImageTaskPreviewFromToolResult({
      toolId: "tool-3",
      toolName: "test",
      toolArguments: undefined,
      toolResult,
      fallbackPrompt: "测试",
    });

    expect(preview).not.toBeNull();
    expect(preview?.taskId).toBe("family-test-1");
  });

  it("应该能提取 providerName 和 modelName", () => {
    const toolResult = {
      task_id: "provider-test-1",
      task_type: "image_generate",
      task_family: "image",
      provider_name: "Nanobanana Pro",
      model_name: "stable-diffusion-v3",
      status: "complete",
    };

    const preview = buildImageTaskPreviewFromToolResult({
      toolId: "tool-4",
      toolName: "test",
      toolArguments: undefined,
      toolResult,
      fallbackPrompt: "测试",
    });

    expect(preview).not.toBeNull();
    expect(preview?.providerName).toBe("Nanobanana Pro");
    expect(preview?.modelName).toBe("stable-diffusion-v3");
  });


});
