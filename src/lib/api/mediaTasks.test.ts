import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import {
  cancelMediaTaskArtifact,
  createImageGenerationTaskArtifact,
  getMediaTaskArtifact,
  listMediaTaskArtifacts,
  retryMediaTaskArtifact,
} from "./mediaTasks";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("mediaTasks API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应通过统一网关创建图片任务 artifact", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce({
      success: true,
      task_id: "task-image-1",
      task_type: "image_generate",
      task_family: "image",
      status: "pending_submit",
      normalized_status: "pending",
      path: ".lime/tasks/image_generate/task-image-1.json",
      absolute_path: "/workspace/.lime/tasks/image_generate/task-image-1.json",
      artifact_path: ".lime/tasks/image_generate/task-image-1.json",
      absolute_artifact_path:
        "/workspace/.lime/tasks/image_generate/task-image-1.json",
      reused_existing: false,
      record: {
        task_id: "task-image-1",
        task_type: "image_generate",
        task_family: "image",
        payload: {
          prompt: "未来感青柠实验室",
        },
        status: "pending_submit",
        normalized_status: "pending",
        created_at: "2026-04-04T12:00:00Z",
      },
    });

    await expect(
      createImageGenerationTaskArtifact({
        projectRootPath: "/workspace",
        prompt: "未来感青柠实验室",
        mode: "generate",
        count: 1,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        task_id: "task-image-1",
        task_type: "image_generate",
      }),
    );

    expect(vi.mocked(safeInvoke)).toHaveBeenCalledWith(
      "create_image_generation_task_artifact",
      {
        request: {
          projectRootPath: "/workspace",
          prompt: "未来感青柠实验室",
          mode: "generate",
          count: 1,
        },
      },
    );
  });

  it("应通过统一网关读取、列出、重试和取消媒体任务 artifact", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce({
        success: true,
        task_id: "task-image-2",
        task_type: "image_generate",
        task_family: "image",
        status: "pending_submit",
        normalized_status: "pending",
        path: ".lime/tasks/image_generate/task-image-2.json",
        absolute_path: "/workspace/.lime/tasks/image_generate/task-image-2.json",
        artifact_path: ".lime/tasks/image_generate/task-image-2.json",
        absolute_artifact_path:
          "/workspace/.lime/tasks/image_generate/task-image-2.json",
        reused_existing: false,
        record: {
          task_id: "task-image-2",
          task_type: "image_generate",
          task_family: "image",
          payload: {
            prompt: "读取任务",
          },
          status: "pending_submit",
          normalized_status: "pending",
          created_at: "2026-04-04T12:10:00Z",
        },
      })
      .mockResolvedValueOnce({
        success: true,
        workspace_root: "/workspace",
        artifact_root: "/workspace/.lime/tasks",
        filters: {
          status: "pending",
          task_family: "image",
          task_type: "image_generate",
          limit: 10,
        },
        total: 1,
        tasks: [
          {
            success: true,
            task_id: "task-image-2",
            task_type: "image_generate",
            task_family: "image",
            status: "pending_submit",
            normalized_status: "pending",
            path: ".lime/tasks/image_generate/task-image-2.json",
            absolute_path:
              "/workspace/.lime/tasks/image_generate/task-image-2.json",
            artifact_path: ".lime/tasks/image_generate/task-image-2.json",
            absolute_artifact_path:
              "/workspace/.lime/tasks/image_generate/task-image-2.json",
            reused_existing: false,
            record: {
              task_id: "task-image-2",
              task_type: "image_generate",
              task_family: "image",
              payload: {
                prompt: "读取任务",
              },
              status: "pending_submit",
              normalized_status: "pending",
              created_at: "2026-04-04T12:10:00Z",
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        success: true,
        task_id: "task-image-2",
        task_type: "image_generate",
        task_family: "image",
        status: "pending_submit",
        normalized_status: "pending",
        current_attempt_id: "attempt-2",
        path: ".lime/tasks/image_generate/task-image-2.json",
        absolute_path: "/workspace/.lime/tasks/image_generate/task-image-2.json",
        artifact_path: ".lime/tasks/image_generate/task-image-2.json",
        absolute_artifact_path:
          "/workspace/.lime/tasks/image_generate/task-image-2.json",
        reused_existing: false,
        record: {
          task_id: "task-image-2",
          task_type: "image_generate",
          task_family: "image",
          payload: {
            prompt: "读取任务",
          },
          status: "pending_submit",
          normalized_status: "pending",
          created_at: "2026-04-04T12:10:00Z",
          retry_count: 1,
        },
      })
      .mockResolvedValueOnce({
        success: true,
        task_id: "task-image-2",
        task_type: "image_generate",
        task_family: "image",
        status: "cancelled",
        normalized_status: "cancelled",
        path: ".lime/tasks/image_generate/task-image-2.json",
        absolute_path: "/workspace/.lime/tasks/image_generate/task-image-2.json",
        artifact_path: ".lime/tasks/image_generate/task-image-2.json",
        absolute_artifact_path:
          "/workspace/.lime/tasks/image_generate/task-image-2.json",
        reused_existing: false,
        record: {
          task_id: "task-image-2",
          task_type: "image_generate",
          task_family: "image",
          payload: {
            prompt: "读取任务",
          },
          status: "cancelled",
          normalized_status: "cancelled",
          created_at: "2026-04-04T12:10:00Z",
        },
      });

    await expect(
      getMediaTaskArtifact({
        projectRootPath: "/workspace",
        taskRef: "task-image-2",
      }),
    ).resolves.toEqual(expect.objectContaining({ task_id: "task-image-2" }));

    await expect(
      listMediaTaskArtifacts({
        projectRootPath: "/workspace",
        status: "pending",
        taskFamily: "image",
        taskType: "image_generate",
        limit: 10,
      }),
    ).resolves.toEqual(expect.objectContaining({ total: 1 }));

    await expect(
      retryMediaTaskArtifact({
        projectRootPath: "/workspace",
        taskRef: "task-image-2",
      }),
    ).resolves.toEqual(
      expect.objectContaining({ current_attempt_id: "attempt-2" }),
    );

    await expect(
      cancelMediaTaskArtifact({
        projectRootPath: "/workspace",
        taskRef: "task-image-2",
      }),
    ).resolves.toEqual(
      expect.objectContaining({ normalized_status: "cancelled" }),
    );

    expect(vi.mocked(safeInvoke)).toHaveBeenNthCalledWith(
      1,
      "get_media_task_artifact",
      {
        request: {
          projectRootPath: "/workspace",
          taskRef: "task-image-2",
        },
      },
    );
    expect(vi.mocked(safeInvoke)).toHaveBeenNthCalledWith(
      2,
      "list_media_task_artifacts",
      {
        request: {
          projectRootPath: "/workspace",
          status: "pending",
          taskFamily: "image",
          taskType: "image_generate",
          limit: 10,
        },
      },
    );
    expect(vi.mocked(safeInvoke)).toHaveBeenNthCalledWith(
      3,
      "retry_media_task_artifact",
      {
        request: {
          projectRootPath: "/workspace",
          taskRef: "task-image-2",
        },
      },
    );
    expect(vi.mocked(safeInvoke)).toHaveBeenNthCalledWith(
      4,
      "cancel_media_task_artifact",
      {
        request: {
          projectRootPath: "/workspace",
          taskRef: "task-image-2",
        },
      },
    );
  });
});
