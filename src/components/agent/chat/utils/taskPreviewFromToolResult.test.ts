import { describe, expect, it } from "vitest";
import {
  buildImageTaskPreviewFromToolResult,
  buildTaskPreviewFromToolResult,
} from "./taskPreviewFromToolResult";

describe("buildImageTaskPreviewFromToolResult", () => {
  it("应在图片任务完成后输出更友好的完成态摘要", () => {
    const preview = buildImageTaskPreviewFromToolResult({
      toolId: "tool-1",
      toolName: "Bash",
      toolArguments: JSON.stringify({
        command: 'lime media image generate --prompt "未来感青柠实验室"',
      }),
      toolResult: {
        metadata: {
          task_id: "task-1",
          task_type: "image_generate",
          status: "succeeded",
          prompt: "未来感青柠实验室",
          size: "1024x1024",
          project_id: "project-1",
          content_id: "content-1",
          path: "/tmp/task-1.json",
          artifact_path: ".lime/tasks/image_generate/task-1.json",
          requested_count: 2,
          received_count: 2,
        },
      },
      fallbackPrompt: "@配图 未来感青柠实验室",
    });

    expect(preview).toMatchObject({
      taskId: "task-1",
      prompt: "未来感青柠实验室",
      status: "complete",
      imageCount: 2,
      size: "1024x1024",
      projectId: "project-1",
      contentId: "content-1",
      taskFilePath: "/tmp/task-1.json",
      artifactPath: ".lime/tasks/image_generate/task-1.json",
      phase: "succeeded",
      statusMessage: "图片已生成完成，共 2 张。",
    });
  });

  it("应在图片任务失败时输出失败态摘要", () => {
    const preview = buildImageTaskPreviewFromToolResult({
      toolId: "tool-2",
      toolName: "Bash",
      toolArguments: JSON.stringify({
        command: 'lime media image generate --prompt "未来感青柠实验室"',
      }),
      toolResult: {
        metadata: {
          task_id: "task-2",
          task_type: "image_generate",
          status: "failed",
        },
      },
      fallbackPrompt: "@配图 未来感青柠实验室",
    });

    expect(preview).toMatchObject({
      taskId: "task-2",
      status: "failed",
      phase: "failed",
      statusMessage: "图片任务执行失败，请查看工具结果或任务详情。",
    });
  });

  it("图片任务完成但尚未带回数量时，应输出面向用户的完成态文案", () => {
    const preview = buildImageTaskPreviewFromToolResult({
      toolId: "tool-3",
      toolName: "Bash",
      toolArguments: JSON.stringify({
        command: 'lime media image generate --prompt "清晨广州塔"',
      }),
      toolResult: {
        metadata: {
          task_id: "task-3",
          task_type: "image_generate",
          status: "succeeded",
          prompt: "清晨广州塔",
          size: "1024x1024",
        },
      },
      fallbackPrompt: "@配图 清晨广州塔",
    });

    expect(preview).toMatchObject({
      taskId: "task-3",
      status: "complete",
      phase: "succeeded",
      statusMessage: "图片结果已生成完成，可在右侧查看与使用。",
    });
  });

  it("图片任务刚提交时，应输出用户可理解的排队态文案", () => {
    const preview = buildImageTaskPreviewFromToolResult({
      toolId: "tool-4",
      toolName: "Bash",
      toolArguments: JSON.stringify({
        command: 'lime media image generate --prompt "广州塔夜景"',
      }),
      toolResult: {
        metadata: {
          task_id: "task-4",
          task_type: "image_generate",
          status: "queued",
          prompt: "广州塔夜景",
        },
      },
      fallbackPrompt: "@配图 广州塔夜景",
    });

    expect(preview).toMatchObject({
      taskId: "task-4",
      status: "running",
      phase: "queued",
      statusMessage: "图片任务已提交，正在排队处理。",
    });
  });
});

describe("buildTaskPreviewFromToolResult video", () => {
  it("视频任务完成但尚未带回结果地址时，应输出完成态同步文案", () => {
    const preview = buildTaskPreviewFromToolResult({
      toolId: "tool-video-1",
      toolName: "Bash",
      toolArguments: JSON.stringify({
        command:
          'lime media video generate --prompt "广州塔城市宣传片" --duration 15 --aspect-ratio 16:9 --resolution 720p',
      }),
      toolResult: {
        metadata: {
          task_id: "task-video-1",
          task_type: "video_generate",
          status: "succeeded",
          prompt: "广州塔城市宣传片",
        },
      },
      fallbackPrompt: "@视频 15秒 广州塔城市宣传片，16:9，720p",
    });

    expect(preview).toMatchObject({
      kind: "video_generate",
      taskId: "task-video-1",
      status: "complete",
      phase: "succeeded",
      statusMessage: "视频已经生成完成，正在同步最终结果。",
    });
  });

  it("视频任务排队中时，应输出用户可理解的排队态文案", () => {
    const preview = buildTaskPreviewFromToolResult({
      toolId: "tool-video-2",
      toolName: "Bash",
      toolArguments: JSON.stringify({
        command:
          'lime media video generate --prompt "新品发布短视频" --duration 15 --aspect-ratio 16:9 --resolution 720p',
      }),
      toolResult: {
        metadata: {
          task_id: "task-video-2",
          task_type: "video_generate",
          status: "queued",
          prompt: "新品发布短视频",
        },
      },
      fallbackPrompt: "@视频 15秒 新品发布短视频，16:9，720p",
    });

    expect(preview).toMatchObject({
      kind: "video_generate",
      taskId: "task-video-2",
      status: "running",
      phase: "queued",
      statusMessage: "视频任务已进入排队队列，稍后会自动开始生成。",
    });
  });
});
