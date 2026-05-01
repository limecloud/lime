import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import {
  cancelMediaTaskArtifact,
  completeAudioGenerationTaskArtifact,
  createAudioGenerationTaskArtifact,
  createImageGenerationTaskArtifact,
  getMediaTaskArtifact,
  listMediaTaskArtifacts,
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
        titleGenerationResult: {
          title: "未来感青柠实验室",
          sessionId: "session-title-1",
          usedFallback: false,
        },
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
          titleGenerationResult: {
            title: "未来感青柠实验室",
            sessionId: "session-title-1",
            usedFallback: false,
          },
          mode: "generate",
          count: 1,
        },
      },
    );
  });

  it("应通过统一网关创建音频任务 artifact", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce({
      success: true,
      task_id: "task-audio-1",
      task_type: "audio_generate",
      task_family: "audio",
      status: "pending_submit",
      normalized_status: "pending",
      path: ".lime/tasks/audio_generate/task-audio-1.json",
      absolute_path: "/workspace/.lime/tasks/audio_generate/task-audio-1.json",
      artifact_path: ".lime/tasks/audio_generate/task-audio-1.json",
      absolute_artifact_path:
        "/workspace/.lime/tasks/audio_generate/task-audio-1.json",
      reused_existing: false,
      record: {
        task_id: "task-audio-1",
        task_type: "audio_generate",
        task_family: "audio",
        payload: {
          source_text: "请生成温暖旁白",
          modality_contract_key: "voice_generation",
          audio_output: {
            kind: "audio_output",
            status: "pending",
            mime_type: "audio/mpeg",
          },
        },
        status: "pending_submit",
        normalized_status: "pending",
        created_at: "2026-04-04T12:00:00Z",
      },
    });

    await expect(
      createAudioGenerationTaskArtifact({
        projectRootPath: "/workspace",
        sourceText: "请生成温暖旁白",
        voice: "warm_narrator",
        entrySource: "at_voice_command",
        modalityContractKey: "voice_generation",
        modality: "audio",
        requiredCapabilities: ["text_generation", "voice_generation"],
        routingSlot: "voice_generation_model",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        task_id: "task-audio-1",
        task_type: "audio_generate",
      }),
    );

    expect(vi.mocked(safeInvoke)).toHaveBeenCalledWith(
      "create_audio_generation_task_artifact",
      {
        request: {
          projectRootPath: "/workspace",
          sourceText: "请生成温暖旁白",
          voice: "warm_narrator",
          entrySource: "at_voice_command",
          modalityContractKey: "voice_generation",
          modality: "audio",
          requiredCapabilities: ["text_generation", "voice_generation"],
          routingSlot: "voice_generation_model",
        },
      },
    );
  });

  it("应通过统一网关完成音频任务并回写 audio_output", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce({
      success: true,
      task_id: "task-audio-2",
      task_type: "audio_generate",
      task_family: "audio",
      status: "succeeded",
      normalized_status: "succeeded",
      path: ".lime/tasks/audio_generate/task-audio-2.json",
      absolute_path: "/workspace/.lime/tasks/audio_generate/task-audio-2.json",
      artifact_path: ".lime/tasks/audio_generate/task-audio-2.json",
      absolute_artifact_path:
        "/workspace/.lime/tasks/audio_generate/task-audio-2.json",
      reused_existing: false,
      record: {
        task_id: "task-audio-2",
        task_type: "audio_generate",
        task_family: "audio",
        payload: {
          source_text: "请生成温暖旁白",
          modality_contract_key: "voice_generation",
          audio_path: ".lime/runtime/audio/task-audio-2.mp3",
          audio_output: {
            kind: "audio_output",
            status: "completed",
            audio_path: ".lime/runtime/audio/task-audio-2.mp3",
            mime_type: "audio/mpeg",
            duration_ms: 2400,
          },
        },
        status: "succeeded",
        normalized_status: "succeeded",
        created_at: "2026-04-04T12:00:00Z",
        result: {
          kind: "audio_generation_result",
          status: "completed",
          audio_path: ".lime/runtime/audio/task-audio-2.mp3",
        },
      },
    });

    await expect(
      completeAudioGenerationTaskArtifact({
        projectRootPath: "/workspace",
        taskRef: "task-audio-2",
        audioPath: ".lime/runtime/audio/task-audio-2.mp3",
        mimeType: "audio/mpeg",
        durationMs: 2400,
        providerId: "limecore",
        model: "voice-pro",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        task_id: "task-audio-2",
        normalized_status: "succeeded",
      }),
    );

    expect(vi.mocked(safeInvoke)).toHaveBeenCalledWith(
      "complete_audio_generation_task_artifact",
      {
        request: {
          projectRootPath: "/workspace",
          taskRef: "task-audio-2",
          audioPath: ".lime/runtime/audio/task-audio-2.mp3",
          mimeType: "audio/mpeg",
          durationMs: 2400,
          providerId: "limecore",
          model: "voice-pro",
        },
      },
    );
  });

  it("应通过统一网关读取、列出和取消媒体任务 artifact", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce({
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
      })
      .mockResolvedValueOnce({
        success: true,
        workspace_root: "/workspace",
        artifact_root: "/workspace/.lime/tasks",
        filters: {
          status: "pending",
          task_family: "image",
          task_type: "image_generate",
          modality_contract_key: "image_generation",
          routing_outcome: "accepted",
          limit: 10,
        },
        total: 1,
        modality_runtime_contracts: {
          snapshot_count: 1,
          contract_keys: ["image_generation"],
          execution_profile_keys: ["image_generation_profile"],
          executor_adapter_keys: ["skill:image_generate"],
          limecore_policy_refs: [
            "model_catalog",
            "provider_offer",
            "tenant_feature_flags",
          ],
          limecore_policy_snapshot_count: 1,
          limecore_policy_snapshot_statuses: [
            { status: "local_defaults_evaluated", count: 1 },
          ],
          limecore_policy_decisions: ["allow"],
          limecore_policy_decision_sources: ["local_default_policy"],
          limecore_policy_evaluation_statuses: [
            { status: "input_gap", count: 1 },
          ],
          limecore_policy_evaluation_decisions: ["ask"],
          limecore_policy_evaluation_decision_sources: [
            "policy_input_evaluator",
          ],
          limecore_policy_evaluation_blocking_refs: [],
          limecore_policy_evaluation_ask_refs: [
            "model_catalog",
            "provider_offer",
            "tenant_feature_flags",
          ],
          limecore_policy_evaluation_pending_refs: [
            "model_catalog",
            "provider_offer",
            "tenant_feature_flags",
          ],
          limecore_policy_unresolved_refs: [
            "model_catalog",
            "provider_offer",
            "tenant_feature_flags",
          ],
          limecore_policy_missing_inputs: [
            "model_catalog",
            "provider_offer",
            "tenant_feature_flags",
          ],
          limecore_policy_pending_hit_refs: [
            "model_catalog",
            "provider_offer",
            "tenant_feature_flags",
          ],
          limecore_policy_value_hit_count: 0,
          blocked_count: 0,
          routing_outcomes: [{ outcome: "accepted", count: 1 }],
          model_registry_assessment_count: 0,
          snapshots: [
            {
              task_id: "task-image-2",
              task_type: "image_generate",
              normalized_status: "pending",
              contract_key: "image_generation",
              routing_slot: "image_generation_model",
              provider_id: null,
              model: null,
              execution_profile_key: "image_generation_profile",
              executor_adapter_key: "skill:image_generate",
              executor_kind: "skill",
              executor_binding_key: "image_generate",
              limecore_policy_refs: [
                "model_catalog",
                "provider_offer",
                "tenant_feature_flags",
              ],
              limecore_policy_snapshot_status: "local_defaults_evaluated",
              limecore_policy_decision: "allow",
              limecore_policy_decision_source: "local_default_policy",
              limecore_policy_decision_scope: "local_defaults_only",
              limecore_policy_decision_reason:
                "declared_policy_refs_with_no_local_deny_rule",
              limecore_policy_evaluation_status: "input_gap",
              limecore_policy_evaluation_decision: "ask",
              limecore_policy_evaluation_decision_source:
                "policy_input_evaluator",
              limecore_policy_evaluation_decision_scope:
                "pending_policy_inputs",
              limecore_policy_evaluation_decision_reason:
                "declared_policy_refs_missing_inputs",
              limecore_policy_evaluation_blocking_refs: [],
              limecore_policy_evaluation_ask_refs: [
                "model_catalog",
                "provider_offer",
                "tenant_feature_flags",
              ],
              limecore_policy_evaluation_pending_refs: [
                "model_catalog",
                "provider_offer",
                "tenant_feature_flags",
              ],
              limecore_policy_unresolved_refs: [
                "model_catalog",
                "provider_offer",
                "tenant_feature_flags",
              ],
              limecore_policy_missing_inputs: [
                "model_catalog",
                "provider_offer",
                "tenant_feature_flags",
              ],
              limecore_policy_pending_hit_refs: [
                "model_catalog",
                "provider_offer",
                "tenant_feature_flags",
              ],
              limecore_policy_value_hits: [],
              limecore_policy_value_hit_count: 0,
              routing_event: "model_routing_decision",
              routing_outcome: "accepted",
              failure_code: null,
              model_capability_assessment_source: null,
              model_supports_image_generation: null,
            },
          ],
        },
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
        status: "cancelled",
        normalized_status: "cancelled",
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
        modalityContractKey: "image_generation",
        routingOutcome: "accepted",
        limit: 10,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        total: 1,
        modality_runtime_contracts: expect.objectContaining({
          snapshot_count: 1,
          limecore_policy_refs: [
            "model_catalog",
            "provider_offer",
            "tenant_feature_flags",
          ],
          limecore_policy_evaluation_statuses: [
            { status: "input_gap", count: 1 },
          ],
          limecore_policy_evaluation_pending_refs: [
            "model_catalog",
            "provider_offer",
            "tenant_feature_flags",
          ],
        }),
      }),
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
          modalityContractKey: "image_generation",
          routingOutcome: "accepted",
          limit: 10,
        },
      },
    );
    expect(vi.mocked(safeInvoke)).toHaveBeenNthCalledWith(
      3,
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
