import { describe, expect, it, vi } from "vitest";
import type { MediaTaskArtifactOutput } from "@/lib/api/mediaTasks";
import {
  applyLayeredDesignImageTaskOutput,
  createGeneratedDesignAssetFromImageTaskOutput,
  createLayeredDesignImageTaskArtifacts,
  createLayeredDesignImageTaskRequest,
  listPendingLayeredDesignImageTasks,
  recordLayeredDesignImageTaskSubmissions,
  refreshLayeredDesignImageTaskResults,
} from "./imageTasks";
import { createLayeredDesignAssetGenerationPlan } from "./generation";
import { createLayeredDesignSeedDocument } from "./planner";

const CREATED_AT = "2026-05-05T00:00:00.000Z";

function createDocument() {
  return createLayeredDesignSeedDocument({
    prompt: "@海报 复古唱片店开业活动",
    id: "record-store-opening",
    title: "复古唱片店开业活动",
    createdAt: CREATED_AT,
  });
}

function createTaskOutput(taskId: string): MediaTaskArtifactOutput {
  return {
    success: true,
    task_id: taskId,
    task_type: "image_generate",
    task_family: "image",
    status: "succeeded",
    normalized_status: "succeeded",
    path: `.lime/tasks/image_generate/${taskId}.json`,
    absolute_path: `/workspace/.lime/tasks/image_generate/${taskId}.json`,
    artifact_path: `.lime/tasks/image_generate/${taskId}.json`,
    absolute_artifact_path: `/workspace/.lime/tasks/image_generate/${taskId}.json`,
    reused_existing: false,
    record: {
      task_id: taskId,
      task_type: "image_generate",
      task_family: "image",
      payload: {
        prompt: "生成背景层",
        provider_id: "openai",
        model: "gpt-image-2",
      },
      status: "succeeded",
      normalized_status: "succeeded",
      created_at: "2026-05-05T01:00:00.000Z",
      result: {
        images: [
          {
            url: "data:image/png;base64,ZmFrZS1pbWFnZQ==",
            revised_prompt: "复古唱片店背景层",
          },
        ],
      },
    },
  };
}

function createPendingTaskOutput(taskId: string): MediaTaskArtifactOutput {
  const output = createTaskOutput(taskId);

  return {
    ...output,
    status: "pending_submit",
    normalized_status: "pending",
    record: {
      ...output.record,
      status: "pending_submit",
      normalized_status: "pending",
      result: undefined,
    },
  };
}

describe("layered-design image task adapter", () => {
  it("应把图层生成请求映射到现有图片任务 API，而不是旧 poster 协议", () => {
    const document = createDocument();
    const [request] = createLayeredDesignAssetGenerationPlan(document);

    const taskRequest = createLayeredDesignImageTaskRequest(document, request, {
      projectRootPath: "/workspace",
      providerId: "openai",
      model: "gpt-image-2",
      sessionId: "session-1",
      threadId: "thread-1",
      turnId: "turn-1",
      projectId: "project-1",
    });

    expect(taskRequest).toMatchObject({
      projectRootPath: "/workspace",
      title: "复古唱片店开业活动 · 背景",
      mode: "generate",
      size: "1088x1440",
      aspectRatio: "34:45",
      usage: "layered_design_asset",
      providerId: "openai",
      model: "gpt-image-2",
      contentId: "record-store-opening",
      entrySource: "layered_design_canvas",
      modalityContractKey: "image_generation",
      modality: "image",
      requiredCapabilities: ["image_generation"],
      routingSlot: "image_generation_model",
      requestedTarget: "generate",
      slotId: "background-image",
      anchorHint: "layered-design:record-store-opening:background-image",
      targetOutputId: "record-store-opening-asset-background",
      targetOutputRefId:
        "record-store-opening:background-image:record-store-opening-asset-background",
      runtimeContract: {
        contract_key: "image_generation",
        layered_design: {
          document_id: "record-store-opening",
          layer_id: "background-image",
          asset_id: "record-store-opening-asset-background",
          model_family: "openai-gpt-image-2",
          provider_id: "openai",
          size_policy: "flexible_pixels",
          requested_size: {
            width: 1080,
            height: 1440,
          },
          task_size: {
            width: 1088,
            height: 1440,
          },
          size_adjusted: true,
          capabilities: {
            native_transparency: false,
            image_edit: true,
            mask: false,
            reference_images: true,
          },
          alpha: {
            requested: false,
            strategy: "none",
            postprocessRequired: false,
          },
        },
      },
    });
    expect(taskRequest.layoutHint).toContain("alphaStrategy=none");
    expect(taskRequest.layoutHint).toContain("taskSize=1088x1440");
    expect(JSON.stringify(taskRequest)).not.toContain("poster_generate");
    expect(JSON.stringify(taskRequest)).not.toContain("canvas:poster");
  });

  it("应批量提交现有 image task artifact，并保留每层请求对应关系", async () => {
    const document = createDocument();
    const requests = createLayeredDesignAssetGenerationPlan(document).slice(
      0,
      2,
    );
    const createTaskArtifact = vi
      .fn()
      .mockResolvedValueOnce(createTaskOutput("task-layer-1"))
      .mockResolvedValueOnce(createTaskOutput("task-layer-2"));

    const submissions = await createLayeredDesignImageTaskArtifacts({
      document,
      projectRootPath: "/workspace",
      requests,
      createTaskArtifact,
    });

    expect(createTaskArtifact).toHaveBeenCalledTimes(2);
    expect(submissions.map((item) => item.output.task_id)).toEqual([
      "task-layer-1",
      "task-layer-2",
    ]);
    expect(submissions[0].generationRequest.layerId).toBe("background-image");
    expect(submissions[1].generationRequest.layerId).toBe("subject-image");
  });

  it("应从成功的图片任务输出创建 GeneratedDesignAsset", () => {
    const document = createDocument();
    const [request] = createLayeredDesignAssetGenerationPlan(document);

    const asset = createGeneratedDesignAssetFromImageTaskOutput(
      request,
      createTaskOutput("task-background"),
    );

    expect(asset).toMatchObject({
      id: "record-store-opening-asset-background-generated-task-background",
      kind: "background",
      src: "data:image/png;base64,ZmFrZS1pbWFnZQ==",
      width: 1080,
      height: 1440,
      hasAlpha: false,
      provider: "openai",
      modelId: "gpt-image-2",
      prompt: "复古唱片店背景层",
      params: {
        source: "image_generation_task",
        taskId: "task-background",
        documentId: "record-store-opening",
        layerId: "background-image",
        originalAssetId: "record-store-opening-asset-background",
      },
    });
  });

  it("应把图片任务输出写回目标图层，并保持文字层可编辑", () => {
    const document = createDocument();
    const [request] = createLayeredDesignAssetGenerationPlan(document);

    const updated = applyLayeredDesignImageTaskOutput(
      document,
      request,
      createTaskOutput("task-background"),
    );

    expect(updated).not.toBeNull();
    expect(
      updated?.layers.find((layer) => layer.id === "background-image"),
    ).toMatchObject({
      type: "image",
      assetId: "record-store-opening-asset-background-generated-task-background",
      source: "generated",
    });
    expect(updated?.layers.find((layer) => layer.id === "headline-text"))
      .toMatchObject({
        type: "text",
        text: "复古唱片店开业活动",
      });
  });

  it("应记录可恢复的图片任务引用，供后续刷新写回", () => {
    const document = createDocument();
    const [generationRequest] = createLayeredDesignAssetGenerationPlan(
      document,
    );
    const taskRequest = createLayeredDesignImageTaskRequest(
      document,
      generationRequest,
      { projectRootPath: "/workspace" },
    );

    const updated = recordLayeredDesignImageTaskSubmissions(
      document,
      [
        {
          generationRequest,
          taskRequest,
          output: createPendingTaskOutput("task-background"),
        },
      ],
      { recordedAt: "2026-05-05T02:00:00.000Z" },
    );

    expect(updated.editHistory.at(-1)).toMatchObject({
      type: "asset_generation_requested",
      layerId: "background-image",
      nextAssetId: "record-store-opening-asset-background",
      taskId: "task-background",
      taskPath: ".lime/tasks/image_generate/task-background.json",
      taskStatus: "pending",
    });
  });

  it("应从 editHistory 恢复未写回的图片任务，并在资产替换后停止刷新旧任务", () => {
    const document = createDocument();
    const [generationRequest] = createLayeredDesignAssetGenerationPlan(
      document,
    );
    const taskRequest = createLayeredDesignImageTaskRequest(
      document,
      generationRequest,
      { projectRootPath: "/workspace" },
    );
    const submitted = recordLayeredDesignImageTaskSubmissions(document, [
      {
        generationRequest,
        taskRequest,
        output: createPendingTaskOutput("task-background"),
      },
    ]);

    expect(listPendingLayeredDesignImageTasks(submitted)).toMatchObject([
      {
        recordId: expect.stringContaining("asset-generation-requested-"),
        layerId: "background-image",
        assetId: "record-store-opening-asset-background",
        taskId: "task-background",
        taskRef: ".lime/tasks/image_generate/task-background.json",
      },
    ]);

    const applied = applyLayeredDesignImageTaskOutput(
      submitted,
      generationRequest,
      createTaskOutput("task-background"),
    );

    expect(applied).not.toBeNull();
    expect(listPendingLayeredDesignImageTasks(applied ?? submitted)).toEqual(
      [],
    );
  });

  it("应通过 get_media_task_artifact 刷新任务，并把成功结果写回目标图层", async () => {
    const document = createDocument();
    const [generationRequest] = createLayeredDesignAssetGenerationPlan(
      document,
    );
    const taskRequest = createLayeredDesignImageTaskRequest(
      document,
      generationRequest,
      { projectRootPath: "/workspace" },
    );
    const submitted = recordLayeredDesignImageTaskSubmissions(document, [
      {
        generationRequest,
        taskRequest,
        output: createPendingTaskOutput("task-background"),
      },
    ]);
    const getTaskArtifact = vi
      .fn()
      .mockResolvedValue(createTaskOutput("task-background"));

    const result = await refreshLayeredDesignImageTaskResults({
      document: submitted,
      projectRootPath: "/workspace",
      getTaskArtifact,
    });

    expect(getTaskArtifact).toHaveBeenCalledWith({
      projectRootPath: "/workspace",
      taskRef: ".lime/tasks/image_generate/task-background.json",
    });
    expect(result).toMatchObject({
      refreshedCount: 1,
      appliedCount: 1,
      pendingCount: 0,
      failedCount: 0,
    });
    expect(
      result.document.layers.find((layer) => layer.id === "background-image"),
    ).toMatchObject({
      type: "image",
      assetId: "record-store-opening-asset-background-generated-task-background",
      source: "generated",
    });
  });
});
