import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import {
  createSceneAppAutomationJob,
  getSceneAppDescriptor,
  getSceneAppRunSummary,
  getSceneAppScorecard,
  listSceneAppCatalog,
  listSceneAppRuns,
  planSceneAppLaunch,
  saveSceneAppContextBaseline,
  prepareSceneAppRunGovernanceArtifact,
  prepareSceneAppRunGovernanceArtifacts,
} from "./sceneapp";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("sceneapp API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应通过统一命令获取 SceneApp 目录", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce({
      version: "2026-04-15",
      generatedAt: "2026-04-15T00:00:00.000Z",
      items: [],
    });

    await expect(listSceneAppCatalog()).resolves.toEqual(
      expect.objectContaining({
        version: "2026-04-15",
      }),
    );
    expect(vi.mocked(safeInvoke)).toHaveBeenCalledWith("sceneapp_list_catalog");
  });

  it("应透传场景详情与运行前规划命令", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce({
        id: "story-video-suite",
        title: "短视频编排",
      })
      .mockResolvedValueOnce({
        descriptor: {
          id: "story-video-suite",
          title: "短视频编排",
        },
        contextOverlay: {
          compilerPlan: {
            activeLayers: ["skill", "memory", "tool"],
            memoryRefs: ["workspace:workspace-default"],
            toolRefs: ["workspace_storage"],
            referenceCount: 0,
            notes: ["已装配 1 条 memory 引用。"],
          },
          snapshot: {
            workspaceId: "workspace-default",
            projectId: null,
            skillRefs: ["story-video-suite"],
            memoryRefs: ["workspace:workspace-default"],
            toolRefs: ["workspace_storage"],
            referenceItems: [],
            tasteProfile: null,
          },
        },
        projectPackPlan: {
          packKind: "project_pack",
          primaryPart: "brief",
          requiredParts: ["brief", "video_draft"],
          viewerKind: "artifact_bundle",
          completionStrategy: "required_parts_complete",
          notes: ["完整度将按 2 个必含部件判断。"],
        },
        readiness: {
          ready: false,
          unmetRequirements: [{ kind: "project" }],
        },
        plan: {
          sceneappId: "story-video-suite",
          executorKind: "cloud_scene",
          bindingFamily: "cloud_scene",
          stepPlan: [],
          adapterPlan: {
            adapterKind: "cloud_scene",
            runtimeAction: "launch_cloud_scene",
            targetRef: "sceneapp-service-story-video",
            targetLabel: "短视频编排",
            requestMetadata: {},
            launchPayload: {},
            notes: [],
          },
          storageStrategy: "workspace_bundle",
          artifactContract: "artifact_bundle",
          governanceHooks: [],
          warnings: [],
        },
      })
      .mockResolvedValueOnce({
        descriptor: {
          id: "story-video-suite",
          title: "短视频编排",
        },
        contextOverlay: {
          compilerPlan: {
            activeLayers: ["skill", "memory", "tool"],
            memoryRefs: ["workspace:workspace-default"],
            toolRefs: ["workspace_storage"],
            referenceCount: 1,
            notes: ["当前场景基线已写入项目级 Context Snapshot，后续 planning 会优先复用。"],
          },
          snapshot: {
            workspaceId: "workspace-default",
            projectId: "project-demo",
            skillRefs: ["story-video-suite"],
            memoryRefs: ["workspace:workspace-default"],
            toolRefs: ["workspace_storage"],
            referenceItems: [
              {
                id: "ref-1",
                label: "用户输入",
                sourceKind: "user_input",
                contentType: "text",
                selected: true,
                usageCount: 1,
                lastUsedAt: "2026-04-17T00:00:00.000Z",
              },
            ],
            tasteProfile: null,
          },
        },
        projectPackPlan: {
          packKind: "project_pack",
          primaryPart: "brief",
          requiredParts: ["brief", "video_draft"],
          viewerKind: "artifact_bundle",
          completionStrategy: "required_parts_complete",
          notes: ["完整度将按 2 个必含部件判断。"],
        },
        readiness: {
          ready: false,
          unmetRequirements: [{ kind: "project" }],
        },
        plan: {
          sceneappId: "story-video-suite",
          executorKind: "cloud_scene",
          bindingFamily: "cloud_scene",
          stepPlan: [],
          adapterPlan: {
            adapterKind: "cloud_scene",
            runtimeAction: "launch_cloud_scene",
            targetRef: "sceneapp-service-story-video",
            targetLabel: "短视频编排",
            requestMetadata: {},
            launchPayload: {},
            notes: [],
          },
          storageStrategy: "workspace_bundle",
          artifactContract: "artifact_bundle",
          governanceHooks: [],
          warnings: [],
        },
      });

    await expect(getSceneAppDescriptor("story-video-suite")).resolves.toEqual(
      expect.objectContaining({
        id: "story-video-suite",
      }),
    );
    await expect(
      planSceneAppLaunch({
        sceneappId: "story-video-suite",
        userInput: "生成一个 30 秒产品短视频",
        referenceMemoryIds: ["memory-1"],
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        descriptor: expect.objectContaining({
          id: "story-video-suite",
        }),
        plan: expect.objectContaining({
          adapterPlan: expect.objectContaining({
            runtimeAction: "launch_cloud_scene",
          }),
        }),
        projectPackPlan: expect.objectContaining({
          completionStrategy: "required_parts_complete",
        }),
      }),
    );
    await expect(
      saveSceneAppContextBaseline({
        sceneappId: "story-video-suite",
        projectId: "project-demo",
        userInput: "生成一个 30 秒产品短视频",
        referenceMemoryIds: ["memory-1"],
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        contextOverlay: expect.objectContaining({
          snapshot: expect.objectContaining({
            referenceItems: expect.arrayContaining([
              expect.objectContaining({
                usageCount: 1,
              }),
            ]),
          }),
        }),
      }),
    );

    expect(vi.mocked(safeInvoke)).toHaveBeenNthCalledWith(
      1,
      "sceneapp_get_descriptor",
      { id: "story-video-suite" },
    );
    expect(vi.mocked(safeInvoke)).toHaveBeenNthCalledWith(
      2,
      "sceneapp_plan_launch",
      {
        intent: {
          sceneappId: "story-video-suite",
          userInput: "生成一个 30 秒产品短视频",
          referenceMemoryIds: ["memory-1"],
        },
      },
    );
    expect(vi.mocked(safeInvoke)).toHaveBeenNthCalledWith(
      3,
      "sceneapp_save_context_baseline",
      {
        intent: {
          sceneappId: "story-video-suite",
          projectId: "project-demo",
          userInput: "生成一个 30 秒产品短视频",
          referenceMemoryIds: ["memory-1"],
        },
      },
    );
  });

  it("应以 SceneApp 语义创建自动化任务", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce({
      sceneappId: "daily-trend-briefing",
      jobId: "automation-job-sceneapp-1",
      jobName: "每日趋势摘要 自动化",
      enabled: true,
      workspaceId: "workspace-default",
      nextRunAt: "2026-04-15T01:00:00.000Z",
      runNowResult: {
        job_count: 1,
        success_count: 1,
        failed_count: 0,
        timeout_count: 0,
      },
    });

    await expect(
      createSceneAppAutomationJob({
        launchIntent: {
          sceneappId: "daily-trend-briefing",
          workspaceId: "workspace-default",
          userInput: "关注 AI Agent 产品趋势",
        },
        runNow: true,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        sceneappId: "daily-trend-briefing",
        jobId: "automation-job-sceneapp-1",
      }),
    );

    expect(vi.mocked(safeInvoke)).toHaveBeenCalledWith(
      "sceneapp_create_automation_job",
      {
        intent: {
          launchIntent: {
            sceneappId: "daily-trend-briefing",
            workspaceId: "workspace-default",
            userInput: "关注 AI Agent 产品趋势",
          },
          runNow: true,
        },
      },
    );
  });

  it("应透传 SceneApp 运行摘要、治理准备与 scorecard 命令", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        runId: "run-1",
        sceneappId: "story-video-suite",
        status: "success",
      })
      .mockResolvedValueOnce({
        sceneappId: "story-video-suite",
        updatedAt: "2026-04-15T00:00:00.000Z",
        summary: "适合继续优化的多模态组合场景。",
        metrics: [],
        recommendedAction: "optimize",
      });

    await expect(listSceneAppRuns("story-video-suite")).resolves.toEqual([]);
    await expect(getSceneAppRunSummary("run-1")).resolves.toBeNull();
    await expect(
      prepareSceneAppRunGovernanceArtifact("run-1", "evidence_summary"),
    ).resolves.toEqual(
      expect.objectContaining({
        runId: "run-1",
        sceneappId: "story-video-suite",
      }),
    );
    await expect(getSceneAppScorecard("story-video-suite")).resolves.toEqual(
      expect.objectContaining({
        sceneappId: "story-video-suite",
        recommendedAction: "optimize",
      }),
    );

    expect(vi.mocked(safeInvoke)).toHaveBeenNthCalledWith(
      1,
      "sceneapp_list_runs",
      { sceneappId: "story-video-suite" },
    );
    expect(vi.mocked(safeInvoke)).toHaveBeenNthCalledWith(
      2,
      "sceneapp_get_run_summary",
      { runId: "run-1" },
    );
    expect(vi.mocked(safeInvoke)).toHaveBeenNthCalledWith(
      3,
      "sceneapp_prepare_run_governance_artifact",
      { runId: "run-1", kind: "evidence_summary" },
    );
    expect(vi.mocked(safeInvoke)).toHaveBeenNthCalledWith(
      4,
      "sceneapp_get_scorecard",
      { sceneappId: "story-video-suite" },
    );
  });

  it("应支持通过统一网关批量补齐治理制品", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce({
        runId: "run-1",
        sceneappId: "story-video-suite",
        status: "success",
      })
      .mockResolvedValueOnce({
        runId: "run-1",
        sceneappId: "story-video-suite",
        status: "success",
      });

    await expect(
      prepareSceneAppRunGovernanceArtifacts("run-1", [
        "evidence_summary",
        "review_decision_markdown",
        "evidence_summary",
      ]),
    ).resolves.toEqual(
      expect.objectContaining({
        runId: "run-1",
        sceneappId: "story-video-suite",
      }),
    );

    expect(vi.mocked(safeInvoke)).toHaveBeenNthCalledWith(
      1,
      "sceneapp_prepare_run_governance_artifact",
      { runId: "run-1", kind: "evidence_summary" },
    );
    expect(vi.mocked(safeInvoke)).toHaveBeenNthCalledWith(
      2,
      "sceneapp_prepare_run_governance_artifact",
      { runId: "run-1", kind: "review_decision_markdown" },
    );
    expect(vi.mocked(safeInvoke)).toHaveBeenCalledTimes(2);
  });
});
