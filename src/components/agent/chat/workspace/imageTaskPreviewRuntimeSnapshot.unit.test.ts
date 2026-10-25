import { describe, expect, it } from "vitest";
import type { MediaTaskArtifactOutput } from "@/lib/api/agentRuntime/mediaTaskTypes";
import type { ImageWorkbenchOutput } from "./imageWorkbenchHelpers";
import {
  buildImageTaskSnapshotFromArtifactOutput,
  buildParsedImageTaskSnapshot,
  buildPendingImageTaskSnapshot,
  buildPreviewImageUrls,
  normalizeTaskStatus,
} from "./imageTaskPreviewRuntimeSnapshot";

function createOutput(url: string, index: number): ImageWorkbenchOutput {
  return {
    id: `output-${index}`,
    taskId: "task-preview",
    hookImageId: `hook-${index}`,
    refId: `img-${index}`,
    url,
    prompt: `预览图 ${index}`,
    createdAt: index,
    applyTarget: null,
  };
}

function createArtifact(
  overrides: Partial<MediaTaskArtifactOutput>,
): MediaTaskArtifactOutput {
  return {
    success: true,
    task_id: "task-artifact",
    task_type: "image_generate",
    task_family: "media",
    status: "running",
    normalized_status: "running",
    current_attempt_id: null,
    path: ".lime/media/task-artifact.json",
    absolute_path: "/workspace/.lime/media/task-artifact.json",
    artifact_path: ".lime/artifacts/task-artifact.json",
    absolute_artifact_path: "/workspace/.lime/artifacts/task-artifact.json",
    reused_existing: false,
    record: null as unknown as MediaTaskArtifactOutput["record"],
    ...overrides,
  };
}

describe("imageTaskPreviewRuntimeSnapshot", () => {
  it("应规范化任务状态，并为消息预览去重限制图片 URL", () => {
    expect(normalizeTaskStatus("pending_submit")).toBe("pending");
    expect(normalizeTaskStatus("processing")).toBe("running");
    expect(normalizeTaskStatus("SUCCESS")).toBe("succeeded");
    expect(normalizeTaskStatus("canceled")).toBe("cancelled");
    expect(normalizeTaskStatus("unknown")).toBe("pending");

    const outputs = Array.from({ length: 12 }, (_, index) =>
      createOutput(
        index === 3
          ? "https://cdn.example.com/2.png"
          : `https://cdn.example.com/${index}.png`,
        index,
      ),
    );

    expect(buildPreviewImageUrls(outputs)).toEqual([
      "https://cdn.example.com/0.png",
      "https://cdn.example.com/1.png",
      "https://cdn.example.com/2.png",
      "https://cdn.example.com/4.png",
      "https://cdn.example.com/5.png",
      "https://cdn.example.com/6.png",
      "https://cdn.example.com/7.png",
      "https://cdn.example.com/8.png",
      "https://cdn.example.com/9.png",
    ]);
  });

  it("应为 pending 图片任务投影 provider、model、分镜 slots 和恢复路径", () => {
    const snapshot = buildPendingImageTaskSnapshot({
      taskId: "task-pending",
      taskType: "image_generate",
      status: "pending_submit",
      payload: {
        prompt: "城市夜景分镜",
        count: 2,
        provider_id: "openai",
        model: "gpt-image-2",
        presentation: {
          assistant_intro: "我先按城市夜景分镜整理两张画面，保留全景和细节。",
        },
        layout_hint: "storyboard_3x3",
        storyboard_slots: [
          {
            slot_id: "hero",
            slot_index: 1,
            slot_label: "首图",
            prompt: "霓虹城市全景",
          },
          {
            slot_id: "detail",
            slot_index: 2,
            slot_label: "细节",
            revised_prompt: "街角咖啡店灯牌",
          },
        ],
      },
      projectId: "project-1",
      contentId: "content-1",
      taskFilePath: "/workspace/.lime/media/task-pending.json",
      artifactPath: ".lime/artifacts/task-pending.json",
      canvasState: null,
    });

    expect(snapshot.terminal).toBe(false);
    expect(snapshot.task).toMatchObject({
      id: "task-pending",
      status: "queued",
      expectedCount: 2,
      layoutHint: "storyboard_3x3",
      taskFilePath: "/workspace/.lime/media/task-pending.json",
      artifactPath: ".lime/artifacts/task-pending.json",
    });
    expect(snapshot.task.storyboardSlots).toEqual([
      {
        slotId: "hero",
        slotIndex: 1,
        label: "首图",
        prompt: "霓虹城市全景",
        shotType: null,
        status: null,
      },
      {
        slotId: "detail",
        slotIndex: 2,
        label: "细节",
        prompt: "街角咖啡店灯牌",
        shotType: null,
        status: null,
      },
    ]);
    expect(snapshot.message.imageWorkbenchPreview).toMatchObject({
      taskId: "task-pending",
      status: "running",
      prompt: "城市夜景分镜",
      expectedImageCount: 2,
      imageCount: 2,
      providerName: "openai",
      modelName: "gpt-image-2",
      projectId: "project-1",
      contentId: "content-1",
      phase: "pending_submit",
    });
    expect(snapshot.message.content).toBe(
      "我先按城市夜景分镜整理两张画面，保留全景和细节。",
    );
    expect(snapshot.task.assistantIntro).toBe(
      "我先按城市夜景分镜整理两张画面，保留全景和细节。",
    );
  });

  it("应从 completed task record 投影多图输出、runtime contract 和工作台任务", () => {
    const snapshot = buildParsedImageTaskSnapshot({
      taskId: "task-complete",
      taskType: "image_generate",
      projectId: "project-1",
      contentId: "content-1",
      taskFilePath: ".lime/media/task-complete.json",
      artifactPath: ".lime/artifacts/task-complete.json",
      canvasState: null,
      taskRecord: {
        status: "completed",
        normalized_status: "success",
        current_attempt_id: "attempt-1",
        created_at: "2026-07-02T08:00:00.000Z",
        payload: {
          prompt: "春日咖啡馆插画",
          raw_text: "@配图 春日咖啡馆插画",
          turn_id: "turn-complete",
          count: 2,
          size: "1024x1024",
          provider_id: "openai",
          model: "gpt-image-2",
          presentation: {
            assistant_intro:
              "我先按春日咖啡馆插画整理构图，保留窗边和细节两张。",
            styleLevels: {
              runningStatus: { styleLevel: "L1" },
              assistantIntro: { styleLevel: "L2" },
              completionCaption: { styleLevel: "L2" },
              mediaArtifact: { styleLevel: "L3" },
            },
            generationBriefBoundary: {
              formalArtifactVoiceSource: "generation_brief_only",

            },

          },
          modality_contract_key: "image_generation",
          routing_slot: "primary-image",
          model_capability_assessment: {
            provider_id: "openai",
            model_id: "gpt-image-2",
            source: "model-registry",
            supports_image_generation: true,
          },
          limecore_policy_snapshot: {
            status: "evaluated",
            decision: "allow",
          },
          storyboard_slots: [
            {
              slot_id: "hero",
              slot_index: 1,
              slot_label: "首图",
              prompt: "窗边咖啡馆全景",
            },
          ],
        },
        progress: {
          phase: "succeeded",
          preview_slots: [
            {
              slot_id: "detail",
              slot_index: 2,
              slot_label: "细节",
              revised_prompt: "咖啡杯与手写笔记",
              status: "complete",
            },
          ],
        },
        result: {
          images: [
            {
              url: "https://cdn.example.com/hero.png",
              prompt: "首图成片",
              provider: "openai",
              model: "gpt-image-2",
              size: "1024x1024",
              slot_id: "hero",
              slot_index: 1,
              slot_label: "首图",
              slot_prompt: "窗边咖啡馆全景",
            },
            {
              url: "https://cdn.example.com/detail.png",
              prompt: "细节成片",
              slot_id: "detail",
              slot_index: 2,
              slot_label: "细节",
              slot_prompt: "咖啡杯与手写笔记",
            },
          ],
        },
        attempts: [
          {
            attempt_id: "attempt-1",
            provider: "openai",
            model: "gpt-image-2",
            result_snapshot: {
              image_url: "https://cdn.example.com/detail.png",
            },
          },
        ],
      },
    });

    expect(snapshot).not.toBeNull();
    expect(snapshot?.terminal).toBe(true);
    expect(snapshot?.message.content).toBe(
      "我先按春日咖啡馆插画整理构图，保留窗边和细节两张。",
    );
    expect(snapshot?.task.assistantIntro).toBe(
      "我先按春日咖啡馆插画整理构图，保留窗边和细节两张。",
    );
    expect(snapshot?.message.runtimeTurnId).toBe("turn-complete");
    expect(snapshot?.updatedAt).toBe(Date.parse("2026-07-02T08:00:00.000Z"));
    expect(snapshot?.outputs.map((output) => output.url)).toEqual([
      "https://cdn.example.com/hero.png",
      "https://cdn.example.com/detail.png",
    ]);
    expect(snapshot?.outputs.map((output) => output.slotId)).toEqual([
      "hero",
      "detail",
    ]);
    expect(snapshot?.task).toMatchObject({
      id: "task-complete",
      status: "complete",
      expectedCount: 2,
      outputIds: ["task-complete:output:1", "task-complete:output:2"],
      taskFilePath: ".lime/media/task-complete.json",
      artifactPath: ".lime/artifacts/task-complete.json",
    });
    expect(snapshot?.task.storyboardSlots).toEqual([
      {
        slotId: "hero",
        slotIndex: 1,
        label: "首图",
        prompt: "窗边咖啡馆全景",
        shotType: null,
        status: "complete",
      },
      {
        slotId: "detail",
        slotIndex: 2,
        label: "细节",
        prompt: "咖啡杯与手写笔记",
        shotType: null,
        status: "complete",
      },
    ]);
    expect(snapshot?.message.imageWorkbenchPreview).toMatchObject({
      taskId: "task-complete",
      status: "complete",
      imageUrl: "https://cdn.example.com/hero.png",
      previewImages: [
        "https://cdn.example.com/hero.png",
        "https://cdn.example.com/detail.png",
      ],
      imageCount: 2,
      expectedImageCount: 2,
      providerName: "openai",
      modelName: "gpt-image-2",
      size: "1024x1024",
      phase: "succeeded",
      attemptCount: 1,
      runtimeContract: {
        contractKey: "image_generation",
        routingSlot: "primary-image",
        providerId: "openai",
        model: "gpt-image-2",
        routingOutcome: "accepted",
        modelCapabilityAssessmentSource: "model-registry",
        modelSupportsImageGeneration: true,
        limecorePolicyDecision: "allow",
      },

    });
    expect(snapshot?.task).not.toHaveProperty("soulMetadata");
  });

  it("应将 succeeded 或 partial 但无输出的图片任务继续视为 running", () => {
    for (const normalizedStatus of ["success", "partial"] as const) {
      const snapshot = buildParsedImageTaskSnapshot({
        taskId: `task-${normalizedStatus}-no-output`,
        taskType: "image_generate",
        projectId: "project-1",
        contentId: "content-1",
        taskFilePath: ".lime/media/task-no-output.json",
        artifactPath: ".lime/artifacts/task-no-output.json",
        canvasState: null,
        taskRecord: {
          status: "completed",
          normalized_status: normalizedStatus,
          created_at: "2026-07-02T10:00:00.000Z",
          payload: {
            prompt: "从花城汇看广州塔的春天照片",
            presentation: {
              assistant_intro:
                "好啊，用 Nanobanana Pro 给你生成一张从花城汇看广州塔的春天照片，先获取下工具参数，马上生成",
              completion_caption: "搞定，从花城汇看广州塔的春日景象。",
            },
          },
          progress: {
            phase: "succeeded",
            message: "图片生成完成。",
          },
        },
      });

      expect(snapshot).not.toBeNull();
      expect(snapshot?.terminal).toBe(false);
      expect(snapshot?.task.status).toBe("running");
      expect(snapshot?.task.caption).toBeNull();
      expect(snapshot?.message.content).toContain(
        "好啊，用 Nanobanana Pro 给你生成一张从花城汇看广州塔的春天照片",
      );
      expect(snapshot?.message.imageWorkbenchPreview).toMatchObject({
        taskId: `task-${normalizedStatus}-no-output`,
        status: "running",
        phase: "running",
        imageUrl: null,
        imageCount: 1,
        caption: null,
      });
    }
  });

  it("应从 artifact output 复用 record，并在无 record 时回退 pending snapshot", () => {
    const recordSnapshot = buildImageTaskSnapshotFromArtifactOutput({
      artifact: createArtifact({
        task_id: "task-record",
        status: "completed",
        normalized_status: "success",
        record: {
          task_id: "task-record",
          task_type: "image_generate",
          task_family: "image",
          status: "completed",
          normalized_status: "success",
          created_at: "2026-07-02T09:00:00.000Z",
          payload: {
            prompt: "落库图片",
          },
          result: {
            image_url: "https://cdn.example.com/record.png",
          },
        },
      }),
      projectId: "project-1",
      contentId: "content-1",
      canvasState: null,
    });

    expect(recordSnapshot?.message.imageWorkbenchPreview).toMatchObject({
      taskId: "task-record",
      status: "complete",
      imageUrl: "https://cdn.example.com/record.png",
      taskFilePath: "/workspace/.lime/media/task-artifact.json",
      artifactPath: ".lime/artifacts/task-artifact.json",
    });

    const pendingSnapshot = buildImageTaskSnapshotFromArtifactOutput({
      artifact: createArtifact({
        task_id: "task-pending-artifact",
        status: "running",
        normalized_status: "running",
      }),
      canvasState: null,
    });

    expect(pendingSnapshot?.terminal).toBe(false);
    expect(pendingSnapshot?.message.imageWorkbenchPreview).toMatchObject({
      taskId: "task-pending-artifact",
      status: "running",
      taskFilePath: "/workspace/.lime/media/task-artifact.json",
      artifactPath: ".lime/artifacts/task-artifact.json",
    });
  });

  it("应从图片 task payload 恢复 ImageCommandRunSnapshot", () => {
    const snapshot = buildImageTaskSnapshotFromArtifactOutput({
      artifact: createArtifact({
        task_id: "task-workflow",
        status: "running",
        normalized_status: "running",
        record: {
          task_id: "task-workflow",
          task_type: "image_generate",
          task_family: "image",
          status: "running",
          normalized_status: "running",
          created_at: "2026-07-02T09:00:00.000Z",
          payload: {
            prompt: "生成两张青柠主图",
            count: 2,
            image_command_run: {
              run_id: "image-command-run-turn-1",
              workflow_key: "image_command_workflow",
              session_id: "session-1",
              thread_id: "thread-1",
              turn_id: "turn-1",
              title: "青柠主图",
              summary: "生成两张青柠主图",
              requested_count: 2,
              status: "queued",
              steps: [
                {
                  id: "intent",
                  title: "解析图片需求",
                  status: "succeeded",
                },
                {
                  id: "generate",
                  title: "生成图片",
                  status: "running",
                },
              ],
              branches: [
                {
                  branch_id: "image-command-run-turn-1:branch:white-bg",
                  title: "白底主图",
                  prompt: "白底青柠主图",
                  status: "queued",
                  slot_id: "white-bg",
                },
                {
                  branch_id: "image-command-run-turn-1:branch:gray-bg",
                  title: "浅灰主图",
                  prompt: "浅灰背景青柠主图",
                  status: "queued",
                  slot_id: "gray-bg",
                },
              ],
              next_actions: [
                {
                  type: "open_workbench",
                },
              ],
            },
          },
        },
      }),
      projectId: "project-1",
      contentId: "content-1",
      canvasState: null,
    });

    expect(snapshot?.message.imageWorkbenchPreview?.workflowRun).toMatchObject({
      runId: "image-command-run-turn-1",
      workflowKey: "image_command_workflow",
      requestedCount: 2,
      status: "queued",
      steps: [
        {
          id: "intent",
          status: "succeeded",
        },
        {
          id: "generate",
          status: "running",
        },
      ],
      branches: [
        {
          branchId: "image-command-run-turn-1:branch:white-bg",
          title: "白底主图",
          prompt: "白底青柠主图",
          slotId: "white-bg",
        },
        {
          branchId: "image-command-run-turn-1:branch:gray-bg",
          title: "浅灰主图",
        },
      ],
      nextActions: [
        {
          type: "open_workbench",
        },
      ],
    });
  });
});
