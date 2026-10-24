import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import type { MediaTaskModalityRuntimeContractIndex } from "./agentRuntime/mediaTaskTypes";
import {
  cancelMediaTaskArtifact,
  createVideoGenerationTaskArtifact,
  getMediaTaskArtifact,
  listMediaTaskArtifacts,
} from "./mediaTasks";
import { videoGenerationApi } from "./videoGeneration";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

vi.mock("./mediaTasks", () => ({
  createVideoGenerationTaskArtifact: vi.fn(),
  getMediaTaskArtifact: vi.fn(),
  listMediaTaskArtifacts: vi.fn(),
  cancelMediaTaskArtifact: vi.fn(),
}));

const EMPTY_MODALITY_RUNTIME_CONTRACT_INDEX: MediaTaskModalityRuntimeContractIndex =
  {
    snapshot_count: 0,
    contract_keys: [],
    execution_profile_keys: [],
    executor_adapter_keys: [],
    limecore_policy_refs: [],
    limecore_policy_snapshot_count: 0,
    limecore_policy_snapshot_statuses: [],
    limecore_policy_decisions: [],
    blocked_count: 0,
    routing_outcomes: [],
    model_registry_assessment_count: 0,
    audio_output_count: 0,
    audio_output_statuses: [],
    audio_output_error_codes: [],
    transcript_count: 0,
    transcript_statuses: [],
    transcript_error_codes: [],
    snapshots: [],
  };

function buildVideoTask(overrides: Record<string, unknown> = {}) {
  const taskId =
    typeof overrides.task_id === "string" ? overrides.task_id : "task-video-1";
  return {
    success: true,
    task_id: taskId,
    task_type: "video_generate",
    task_family: "video",
    status:
      typeof overrides.status === "string"
        ? overrides.status
        : "pending_submit",
    normalized_status:
      typeof overrides.normalized_status === "string"
        ? overrides.normalized_status
        : "pending",
    path: `.lime/tasks/video_generate/${taskId}.json`,
    absolute_path: `/workspace/.lime/tasks/video_generate/${taskId}.json`,
    artifact_path: `.lime/tasks/video_generate/${taskId}.json`,
    absolute_artifact_path: `/workspace/.lime/tasks/video_generate/${taskId}.json`,
    reused_existing: false,
    record: {
      task_id: taskId,
      task_type: "video_generate",
      task_family: "video",
      payload: {
        prompt: "城市夜景",
        provider_id: "doubao",
        model: "seedance-1-5-pro",
        project_id: "project-1",
      },
      status: "pending_submit",
      normalized_status: "pending",
      created_at: "2026-06-09T10:00:00Z",
      updated_at: "2026-06-09T10:01:00Z",
    },
    ...overrides,
  };
}

describe("videoGeneration API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("创建视频生成任务应走 App Server mediaTaskArtifact/video/create current helper", async () => {
    vi.mocked(createVideoGenerationTaskArtifact).mockResolvedValueOnce(
      buildVideoTask(),
    );

    await expect(
      videoGenerationApi.createTask({
        projectId: "project-1",
        projectRootPath: "/workspace",
        providerId: "doubao",
        model: "seedance-1-5-pro",
        prompt: "城市夜景",
        imageUrl: "data:image/png;base64,reference",
        endImageUrl: "https://example.com/end-frame.png",
        aspectRatio: "16:9",
        duration: 5,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: "task-video-1",
        projectId: "project-1",
        providerId: "doubao",
        model: "seedance-1-5-pro",
        prompt: "城市夜景",
        status: "pending",
      }),
    );

    expect(createVideoGenerationTaskArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        projectRootPath: "/workspace",
        projectId: "project-1",
        prompt: "城市夜景",
        imageUrl: "data:image/png;base64,reference",
        endImageUrl: "https://example.com/end-frame.png",
        providerId: "doubao",
        model: "seedance-1-5-pro",
        modalityContractKey: "video_generation",
        modality: "video",
        requiredCapabilities: ["video_generation"],
        routingSlot: "video_generation_model",
      }),
    );
    expect(safeInvoke).not.toHaveBeenCalled();
  });

  it("查询、列表和取消视频任务应复用 App Server media task artifact current helper", async () => {
    vi.mocked(getMediaTaskArtifact).mockResolvedValueOnce(
      buildVideoTask({ task_id: "task-video-2", normalized_status: "running" }),
    );
    vi.mocked(listMediaTaskArtifacts).mockResolvedValueOnce({
      success: true,
      workspace_root: "/workspace",
      artifact_root: "/workspace/.lime/tasks",
      filters: {
        task_family: "video",
        task_type: "video_generate",
        modality_contract_key: "video_generation",
        limit: 12,
      },
      total: 1,
      modality_runtime_contracts: EMPTY_MODALITY_RUNTIME_CONTRACT_INDEX,
      tasks: [buildVideoTask({ task_id: "task-video-2" })],
    });
    vi.mocked(cancelMediaTaskArtifact).mockResolvedValueOnce(
      buildVideoTask({
        task_id: "task-video-2",
        status: "cancelled",
        normalized_status: "cancelled",
      }),
    );

    await expect(
      videoGenerationApi.getTask("task-video-2", {
        refreshStatus: false,
        projectRootPath: "/workspace",
      }),
    ).resolves.toEqual(
      expect.objectContaining({ id: "task-video-2", status: "processing" }),
    );
    await expect(
      videoGenerationApi.listTasks("project-1", {
        limit: 12,
        projectRootPath: "/workspace",
      }),
    ).resolves.toHaveLength(1);
    await expect(
      videoGenerationApi.cancelTask("task-video-2", {
        projectRootPath: "/workspace",
      }),
    ).resolves.toEqual(
      expect.objectContaining({ id: "task-video-2", status: "cancelled" }),
    );

    expect(getMediaTaskArtifact).toHaveBeenCalledWith({
      projectRootPath: "/workspace",
      taskRef: "task-video-2",
    });
    expect(listMediaTaskArtifacts).toHaveBeenCalledWith({
      projectRootPath: "/workspace",
      taskFamily: "video",
      taskType: "video_generate",
      modalityContractKey: "video_generation",
      limit: 12,
    });
    expect(cancelMediaTaskArtifact).toHaveBeenCalledWith({
      projectRootPath: "/workspace",
      taskRef: "task-video-2",
    });
    expect(safeInvoke).not.toHaveBeenCalled();
  });

  it("缺少 projectRootPath 时应 fail closed，不能把 projectId 当路径", async () => {
    await expect(
      videoGenerationApi.createTask({
        projectId: "project-1",
        providerId: "doubao",
        model: "seedance-1-5-pro",
        prompt: "城市夜景",
      }),
    ).rejects.toThrow("缺少视频任务 projectRootPath");

    expect(createVideoGenerationTaskArtifact).not.toHaveBeenCalled();
    expect(safeInvoke).not.toHaveBeenCalled();
  });
});
