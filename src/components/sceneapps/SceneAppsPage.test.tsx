import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SceneAppsPage } from "./SceneAppsPage";
import {
  recordSceneAppRecentVisit,
  type SceneAppCatalog,
  type SceneAppsPageParams,
  type SceneAppPlanResult,
} from "@/lib/sceneapp";
import type { Page, PageParams } from "@/types/page";

type SceneAppPlanResultOverrides = {
  descriptor?: Partial<SceneAppPlanResult["descriptor"]>;
  readiness?: Partial<SceneAppPlanResult["readiness"]>;
  plan?: Partial<Omit<SceneAppPlanResult["plan"], "adapterPlan">> & {
    adapterPlan?: Partial<SceneAppPlanResult["plan"]["adapterPlan"]>;
  };
};

const {
  mockListSceneAppCatalog,
  mockGetSceneAppScorecard,
  mockListSceneAppRuns,
  mockGetSceneAppRunSummary,
  mockPrepareSceneAppRunGovernanceArtifact,
  mockPrepareSceneAppRunGovernanceArtifacts,
  mockPlanSceneAppLaunch,
  mockCreateAutomationJob,
  mockListProjects,
  mockGetOrCreateDefaultProject,
  latestAutomationDialogProps,
} = vi.hoisted(() => ({
  mockListSceneAppCatalog: vi.fn(),
  mockGetSceneAppScorecard: vi.fn(),
  mockListSceneAppRuns: vi.fn(),
  mockGetSceneAppRunSummary: vi.fn(),
  mockPrepareSceneAppRunGovernanceArtifact: vi.fn(),
  mockPrepareSceneAppRunGovernanceArtifacts: vi.fn(),
  mockPlanSceneAppLaunch: vi.fn(),
  mockCreateAutomationJob: vi.fn(),
  mockListProjects: vi.fn(),
  mockGetOrCreateDefaultProject: vi.fn(),
  latestAutomationDialogProps: {
    value: null as Record<string, unknown> | null,
  },
}));

vi.mock("@/lib/api/sceneapp", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/sceneapp")>(
    "@/lib/api/sceneapp",
  );
  return {
    ...actual,
    listSceneAppCatalog: () => mockListSceneAppCatalog(),
    getSceneAppScorecard: (sceneappId: string) =>
      mockGetSceneAppScorecard(sceneappId),
    listSceneAppRuns: (sceneappId: string) =>
      mockListSceneAppRuns(sceneappId),
    getSceneAppRunSummary: (runId: string) => mockGetSceneAppRunSummary(runId),
    prepareSceneAppRunGovernanceArtifact: (runId: string, kind: string) =>
      mockPrepareSceneAppRunGovernanceArtifact(runId, kind),
    prepareSceneAppRunGovernanceArtifacts: (
      runId: string,
      kinds: string[],
    ) => mockPrepareSceneAppRunGovernanceArtifacts(runId, kinds),
    planSceneAppLaunch: (intent: unknown) => mockPlanSceneAppLaunch(intent),
  };
});

vi.mock("@/lib/api/automation", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/automation")>(
    "@/lib/api/automation",
  );
  return {
    ...actual,
    createAutomationJob: (request: unknown) => mockCreateAutomationJob(request),
  };
});

vi.mock("@/lib/api/project", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/project")>(
    "@/lib/api/project",
  );
  return {
    ...actual,
    listProjects: () => mockListProjects(),
    getOrCreateDefaultProject: () => mockGetOrCreateDefaultProject(),
  };
});

vi.mock("@/components/projects/ProjectSelector", () => ({
  ProjectSelector: (props: {
    value: string | null;
    onChange: (projectId: string) => void;
  }) => (
    <button
      type="button"
      data-testid="sceneapp-project-selector"
      onClick={() => props.onChange("project-1")}
    >
      {props.value ?? "选择项目"}
    </button>
  ),
}));

vi.mock(
  "@/components/settings-v2/system/automation/AutomationJobDialog",
  () => ({
    AutomationJobDialog: (props: Record<string, unknown>) => {
      latestAutomationDialogProps.value = props;
      return props.open ? (
        <div data-testid="sceneapp-automation-dialog">automation-dialog</div>
      ) : null;
    },
  }),
);

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function createProject(id = "project-1") {
  return {
    id,
    name: "项目一",
    workspaceType: "general",
    rootPath: "",
    isDefault: false,
    createdAt: 1,
    updatedAt: 1,
    isFavorite: false,
    isArchived: false,
    tags: [],
  };
}

function createCatalog(): SceneAppCatalog {
  return {
    version: "2026-04-15",
    generatedAt: "2026-04-15T00:00:00.000Z",
    items: [
      {
        id: "story-video-suite",
        title: "短视频编排",
        summary: "把文本、线框图、配乐和短视频草稿收口成结果链。",
        category: "Scene Apps",
        sceneappType: "hybrid",
        patternPrimary: "pipeline",
        patternStack: ["pipeline", "generator", "inversion"],
        capabilityRefs: ["cloud_scene"],
        infraProfile: [
          "composition_blueprint",
          "project_pack",
          "workspace_storage",
          "cloud_runtime",
        ],
        deliveryContract: "project_pack",
        outputHint: "短视频项目包",
        deliveryProfile: {
          artifactProfileRef: "story-video-artifacts",
          viewerKind: "artifact_bundle",
          requiredParts: [
            "brief",
            "storyboard",
            "script",
            "music_refs",
            "video_draft",
            "review_note",
          ],
          primaryPart: "brief",
        },
        compositionProfile: {
          blueprintRef: "story-video-blueprint",
          stepCount: 6,
          steps: [
            {
              id: "brief",
              order: 1,
              bindingProfileRef: "story-video-native-binding",
              bindingFamily: "native_skill",
            },
            {
              id: "storyboard",
              order: 2,
              bindingProfileRef: "story-video-native-binding",
              bindingFamily: "native_skill",
            },
            {
              id: "script",
              order: 3,
              bindingProfileRef: "story-video-native-binding",
              bindingFamily: "native_skill",
            },
            {
              id: "music_refs",
              order: 4,
              bindingProfileRef: "story-video-cloud-binding",
              bindingFamily: "cloud_scene",
            },
            {
              id: "video_draft",
              order: 5,
              bindingProfileRef: "story-video-cloud-binding",
              bindingFamily: "cloud_scene",
            },
            {
              id: "review_note",
              order: 6,
              bindingProfileRef: "story-video-native-binding",
              bindingFamily: "native_skill",
            },
          ],
        },
        scorecardProfile: {
          profileRef: "story-video-scorecard",
          metricKeys: [
            "complete_pack_rate",
            "review_pass_rate",
            "publish_conversion_rate",
          ],
          failureSignals: [
            "pack_incomplete",
            "review_blocked",
            "publish_stalled",
          ],
        },
        entryBindings: [
          {
            kind: "service_skill",
            bindingFamily: "cloud_scene",
          },
        ],
        launchRequirements: [
          {
            kind: "project",
            message: "需要项目目录承接结果。",
          },
        ],
        sourcePackageId: "lime-core-sceneapps",
        sourcePackageVersion: "2026-04-15",
      },
      {
        id: "daily-trend-briefing",
        title: "每日趋势摘要",
        summary: "把研究主题变成每天自动回流的观察任务。",
        category: "Scene Apps",
        sceneappType: "local_durable",
        patternPrimary: "pipeline",
        patternStack: ["pipeline", "reviewer"],
        capabilityRefs: ["automation_job"],
        infraProfile: ["automation_schedule", "db_store", "json_snapshot"],
        deliveryContract: "table_report",
        outputHint: "趋势摘要",
        entryBindings: [
          {
            kind: "service_skill",
            bindingFamily: "automation_job",
          },
        ],
        launchRequirements: [
          {
            kind: "project",
            message: "需要工作区保存运行历史。",
          },
          {
            kind: "automation",
            message: "需要调度能力。",
          },
        ],
        sourcePackageId: "lime-core-sceneapps",
        sourcePackageVersion: "2026-04-15",
      },
      {
        id: "x-article-export",
        title: "网页资料导出",
        summary: "把网页内容和配图导出为项目资料包。",
        category: "Scene Apps",
        sceneappType: "browser_grounded",
        patternPrimary: "pipeline",
        patternStack: ["pipeline", "tool_wrapper"],
        capabilityRefs: ["browser_assist"],
        infraProfile: [
          "browser_runtime",
          "project_resource",
          "artifact_bundle",
        ],
        deliveryContract: "artifact_bundle",
        outputHint: "网页资料包",
        entryBindings: [
          {
            kind: "service_skill",
            bindingFamily: "browser_assist",
          },
        ],
        launchRequirements: [
          {
            kind: "browser_session",
            message: "需要浏览器运行时承接站点执行上下文。",
          },
        ],
        sourcePackageId: "lime-core-sceneapps",
        sourcePackageVersion: "2026-04-15",
      },
      {
        id: "project-analysis-copilot",
        title: "项目分析 Copilot",
        summary: "围绕项目目录执行本机分析技能。",
        category: "Scene Apps",
        sceneappType: "local_instant",
        patternPrimary: "reviewer",
        patternStack: ["reviewer", "tool_wrapper"],
        capabilityRefs: ["native_skill"],
        infraProfile: ["workspace_storage", "json_snapshot"],
        deliveryContract: "project_pack",
        outputHint: "项目分析报告",
        entryBindings: [
          {
            kind: "service_skill",
            bindingFamily: "native_skill",
          },
        ],
        launchRequirements: [
          {
            kind: "project",
            message: "需要项目目录承接分析上下文。",
          },
        ],
        linkedServiceSkillId: "sceneapp-service-analysis",
        linkedSceneKey: "project-analysis",
        sourcePackageId: "lime-core-sceneapps",
        sourcePackageVersion: "2026-04-15",
      },
    ],
  };
}

function createPlanResult(
  overrides: SceneAppPlanResultOverrides = {},
): SceneAppPlanResult {
  const planOverrides = overrides.plan ?? {};
  const adapterPlanOverrides = planOverrides.adapterPlan ?? {};

  return {
    descriptor: {
      id: "sceneapp-demo",
      title: "SceneApp Demo",
      summary: "SceneApp 测试样板。",
      category: "测试",
      sceneappType: "hybrid",
      patternPrimary: "pipeline",
      patternStack: ["pipeline"],
      capabilityRefs: ["sceneapp"],
      infraProfile: ["workspace_storage"],
      deliveryContract: "artifact_bundle",
      outputHint: "测试输出",
      entryBindings: [
        {
          kind: "service_skill",
          bindingFamily: "agent_turn",
        },
      ],
      launchRequirements: [],
      sourcePackageId: "lime-core-sceneapps",
      sourcePackageVersion: "2026-04-15",
      ...(overrides.descriptor ?? {}),
    } as SceneAppPlanResult["descriptor"],
    readiness: {
      ready: true,
      unmetRequirements: [],
      ...(overrides.readiness ?? {}),
    } as SceneAppPlanResult["readiness"],
    plan: {
      sceneappId: planOverrides.sceneappId ?? "sceneapp-demo",
      executorKind: planOverrides.executorKind ?? "agent_turn",
      bindingFamily: planOverrides.bindingFamily ?? "agent_turn",
      stepPlan: planOverrides.stepPlan ?? [],
      adapterPlan: {
        adapterKind: adapterPlanOverrides.adapterKind ?? "agent_turn",
        runtimeAction:
          adapterPlanOverrides.runtimeAction ?? "submit_agent_turn",
        targetRef: adapterPlanOverrides.targetRef ?? "sceneapp-demo",
        targetLabel: adapterPlanOverrides.targetLabel ?? "SceneApp Demo",
        requestMetadata: adapterPlanOverrides.requestMetadata ?? {},
        launchPayload: adapterPlanOverrides.launchPayload ?? {
          sceneapp_id: "sceneapp-demo",
          message: "请执行 SceneApp Demo",
        },
        notes: adapterPlanOverrides.notes ?? [],
        linkedServiceSkillId: adapterPlanOverrides.linkedServiceSkillId,
        linkedSceneKey: adapterPlanOverrides.linkedSceneKey,
        preferredProfileKey: adapterPlanOverrides.preferredProfileKey,
      } as SceneAppPlanResult["plan"]["adapterPlan"],
      storageStrategy: planOverrides.storageStrategy ?? "workspace_bundle",
      artifactContract: planOverrides.artifactContract ?? "artifact_bundle",
      governanceHooks: planOverrides.governanceHooks ?? [],
      warnings: planOverrides.warnings ?? [],
    } as SceneAppPlanResult["plan"],
  };
}

function renderSceneAppsPage(
  props?: Partial<React.ComponentProps<typeof SceneAppsPage>>,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onNavigate =
    (props?.onNavigate as ((page: Page, params?: PageParams) => void) | undefined) ??
    vi.fn();

  act(() => {
    root.render(
      <SceneAppsPage
        onNavigate={onNavigate}
        pageParams={{
          sceneappId: "story-video-suite",
          projectId: "project-1",
          prefillIntent: "生成一个 30 秒短视频方案",
          ...(props?.pageParams ?? {}),
        }}
      />,
    );
  });

  mountedRoots.push({ root, container });
  return {
    container,
    onNavigate,
    rerender: (
      nextProps?: Partial<React.ComponentProps<typeof SceneAppsPage>>,
    ) => {
      act(() => {
        root.render(
          <SceneAppsPage
            onNavigate={
              (nextProps?.onNavigate as
                | ((page: Page, params?: PageParams) => void)
                | undefined) ?? onNavigate
            }
            pageParams={{
              sceneappId: "story-video-suite",
              projectId: "project-1",
              prefillIntent: "生成一个 30 秒短视频方案",
              ...(nextProps?.pageParams ?? {}),
            }}
          />,
        );
      });
    },
  };
}

function renderControlledSceneAppsPage(
  initialPageParams?: Partial<SceneAppsPageParams>,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const navigationCalls: Array<{
    page: Page;
    params?: PageParams;
  }> = [];

  function ControlledSceneAppsPage() {
    const [pageParams, setPageParams] = React.useState<SceneAppsPageParams>({
      view: "catalog",
      sceneappId: "story-video-suite",
      projectId: "project-1",
      prefillIntent: "生成一个 30 秒短视频方案",
      ...initialPageParams,
    });

    const handleNavigate = React.useCallback(
      (page: Page, params?: PageParams) => {
        navigationCalls.push({ page, params });
        if (page === "sceneapps") {
          setPageParams((params ?? {}) as SceneAppsPageParams);
        }
      },
      [],
    );

    return (
      <SceneAppsPage
        onNavigate={handleNavigate}
        pageParams={pageParams}
      />
    );
  }

  act(() => {
    root.render(<ControlledSceneAppsPage />);
  });

  mountedRoots.push({ root, container });
  return {
    container,
    navigationCalls,
  };
}

async function flushEffects(times = 6) {
  await act(async () => {
    for (let index = 0; index < times; index += 1) {
      await Promise.resolve();
    }
  });
}

async function openSceneAppsView(
  container: HTMLDivElement,
  view: "catalog" | "detail" | "governance",
) {
  const button = container.querySelector(
    `[data-testid="sceneapps-view-${view}"]`,
  ) as HTMLButtonElement | null;
  expect(button).not.toBeNull();

  act(() => {
    button?.click();
  });
  await flushEffects();
}

function setTextboxValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("SceneAppsPage", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;

    window.localStorage.clear();
    latestAutomationDialogProps.value = null;
    mockListSceneAppCatalog.mockResolvedValue(createCatalog());
    mockListProjects.mockResolvedValue([createProject()]);
    mockGetOrCreateDefaultProject.mockResolvedValue(createProject());
    mockCreateAutomationJob.mockResolvedValue({
      id: "job-sceneapp-1",
      name: "每日趋势摘要 自动化",
    });
    mockGetSceneAppScorecard.mockImplementation(async (sceneappId: string) => ({
      sceneappId,
      updatedAt: "2026-04-15T00:00:00.000Z",
      summary:
        sceneappId === "story-video-suite"
          ? "适合继续优化的多模态组合场景。"
          : "这个持续研究场景适合继续保留。",
      metrics:
        sceneappId === "story-video-suite"
          ? [
              {
                key: "complete_pack_rate",
                label: "整包交付率",
                value: 82,
                status: "good",
              },
              {
                key: "review_pass_rate",
                label: "复核通过率",
                value: 67,
                status: "watch",
              },
            ]
          : [
              {
                key: "success_rate",
                label: "执行成功率",
                value: 76,
                status: "watch",
              },
            ],
      recommendedAction:
        sceneappId === "story-video-suite" ? "optimize" : "keep",
      observedFailureSignals:
        sceneappId === "story-video-suite"
          ? ["review_blocked", "pack_incomplete"]
          : [],
      topFailureSignal:
        sceneappId === "story-video-suite" ? "review_blocked" : null,
    }));
    mockListSceneAppRuns.mockImplementation(async (sceneappId: string) =>
      sceneappId === "story-video-suite"
        ? [
            {
              runId: "story-video-suite-run-2",
              sceneappId,
              status: "running",
              source: "chat",
              sourceRef: "agent-runtime-submit-turn",
              sessionId: "session-story-video-2",
              cloudSceneRuntimeRef: {
                sceneKey: "story-video-suite",
                skillId: "sceneapp-service-story-video",
                projectId: "project-1",
                contentId: "content-story-video-2",
                workspaceId: "project-1",
                entrySource: "sceneapp_plan",
                userInput: "生成一个 30 秒短视频方案",
                slots: {
                  duration: "30 秒",
                },
              },
              startedAt: "2026-04-15T00:05:00.000Z",
              finishedAt: null,
              artifactCount: 1,
              deliveryRequiredParts: [
                "brief",
                "storyboard",
                "script",
                "music_refs",
                "video_draft",
                "review_note",
              ],
              deliveryCompletedParts: [],
              deliveryMissingParts: [],
              deliveryCompletionRate: null,
              deliveryPartCoverageKnown: false,
              failureSignal: null,
            },
            {
              runId: "story-video-suite-run-1",
              sceneappId,
              status: "success",
              source: "automation",
              sourceRef: "automation-job-story-video-1",
              startedAt: "2026-04-15T00:00:00.000Z",
              finishedAt: "2026-04-15T00:03:00.000Z",
              artifactCount: 5,
              deliveryArtifactRefs: [
                {
                  relativePath: "exports/story-video-suite/latest/brief.md",
                  absolutePath:
                    "/workspace/exports/story-video-suite/latest/brief.md",
                  partKey: "brief",
                  projectId: "project-1",
                  workspaceId: "project-1",
                  source: "runtime_evidence",
                },
                {
                  relativePath:
                    "exports/story-video-suite/latest/video_draft.mp4",
                  absolutePath:
                    "/workspace/exports/story-video-suite/latest/video_draft.mp4",
                  partKey: "video_draft",
                  projectId: "project-1",
                  workspaceId: "project-1",
                  source: "runtime_evidence",
                },
              ],
              governanceArtifactRefs: [
                {
                  kind: "evidence_summary",
                  label: "证据摘要",
                  relativePath:
                    ".lime/harness/sessions/session-story-video-1/evidence/summary.md",
                  absolutePath:
                    "/workspace/.lime/harness/sessions/session-story-video-1/evidence/summary.md",
                  projectId: "project-1",
                  workspaceId: "project-1",
                  source: "session_governance",
                },
                {
                  kind: "review_decision_markdown",
                  label: "人工复核记录",
                  relativePath:
                    ".lime/harness/sessions/session-story-video-1/review/review-decision.md",
                  absolutePath:
                    "/workspace/.lime/harness/sessions/session-story-video-1/review/review-decision.md",
                  projectId: "project-1",
                  workspaceId: "project-1",
                  source: "session_governance",
                },
                {
                  kind: "review_decision_json",
                  label: "复核 JSON",
                  relativePath:
                    ".lime/harness/sessions/session-story-video-1/review/review-decision.json",
                  absolutePath:
                    "/workspace/.lime/harness/sessions/session-story-video-1/review/review-decision.json",
                  projectId: "project-1",
                  workspaceId: "project-1",
                  source: "session_governance",
                },
              ],
              deliveryRequiredParts: [
                "brief",
                "storyboard",
                "script",
                "music_refs",
                "video_draft",
                "review_note",
              ],
              deliveryCompletedParts: [
                "brief",
                "storyboard",
                "script",
                "music_refs",
                "video_draft",
              ],
              deliveryMissingParts: ["review_note"],
              deliveryCompletionRate: 83.3,
              deliveryPartCoverageKnown: true,
              failureSignal: "review_blocked",
            },
          ]
        : sceneappId === "x-article-export"
          ? [
              {
                runId: "x-article-export-run-1",
                sceneappId,
                status: "success",
                source: "skill",
                sourceRef: "service-skill:x-article-export",
                sessionId: "agent-session-article-export-1",
                browserRuntimeRef: {
                  profileKey: "general_browser_assist",
                  sessionId: "browser-session-article-export-1",
                  targetId: "target-article-export-1",
                },
                startedAt: "2026-04-15T00:08:00.000Z",
                finishedAt: "2026-04-15T00:10:00.000Z",
                artifactCount: 2,
              },
            ]
        : sceneappId === "project-analysis-copilot"
          ? [
              {
                runId: "project-analysis-copilot-run-1",
                sceneappId,
                status: "success",
                source: "skill",
                sourceRef: "service-skill:project-analysis",
                sessionId: null,
                nativeSkillRuntimeRef: {
                  skillId: "sceneapp-service-analysis",
                  skillKey: "project-analysis",
                  projectId: "project-1",
                  workspaceId: "project-1",
                  userInput: "请分析当前项目结构",
                  slots: {
                    focus: "架构",
                    depth: "高",
                  },
                },
                startedAt: "2026-04-15T00:11:00.000Z",
                finishedAt: "2026-04-15T00:13:00.000Z",
                artifactCount: 1,
              },
            ]
        : [
            {
              runId: `${sceneappId}-run-1`,
              sceneappId,
              status: "running",
              source: "automation",
              sourceRef: `automation-job-${sceneappId}`,
              startedAt: "2026-04-15T00:00:00.000Z",
              finishedAt: null,
              artifactCount: 1,
            },
          ],
    );
    mockGetSceneAppRunSummary.mockImplementation(async (runId: string) => {
      if (runId === "story-video-suite-run-2") {
        return {
          runId,
          sceneappId: "story-video-suite",
          status: "running",
          source: "chat",
          sourceRef: "agent-runtime-submit-turn",
          sessionId: "session-story-video-2",
          cloudSceneRuntimeRef: {
            sceneKey: "story-video-suite",
            skillId: "sceneapp-service-story-video",
            projectId: "project-1",
            contentId: "content-story-video-2",
            workspaceId: "project-1",
            entrySource: "sceneapp_plan",
            userInput: "生成一个 30 秒短视频方案",
            slots: {
              duration: "30 秒",
            },
          },
          startedAt: "2026-04-15T00:05:00.000Z",
          finishedAt: null,
          artifactCount: 1,
          deliveryRequiredParts: [
            "brief",
            "storyboard",
            "script",
            "music_refs",
            "video_draft",
            "review_note",
          ],
          deliveryCompletedParts: [],
          deliveryMissingParts: [],
          deliveryCompletionRate: null,
          deliveryPartCoverageKnown: false,
          failureSignal: null,
        };
      }

      if (runId === "story-video-suite-run-1") {
        return {
          runId,
          sceneappId: "story-video-suite",
          status: "success",
          source: "automation",
          sourceRef: "automation-job-story-video-1",
          startedAt: "2026-04-15T00:00:00.000Z",
          finishedAt: "2026-04-15T00:03:00.000Z",
          artifactCount: 5,
          deliveryArtifactRefs: [
            {
              relativePath: "exports/story-video-suite/latest/brief.md",
              absolutePath:
                "/workspace/exports/story-video-suite/latest/brief.md",
              partKey: "brief",
              projectId: "project-1",
              workspaceId: "project-1",
              source: "runtime_evidence",
            },
            {
              relativePath: "exports/story-video-suite/latest/video_draft.mp4",
              absolutePath:
                "/workspace/exports/story-video-suite/latest/video_draft.mp4",
              partKey: "video_draft",
              projectId: "project-1",
              workspaceId: "project-1",
              source: "runtime_evidence",
            },
          ],
          governanceArtifactRefs: [
            {
              kind: "evidence_summary",
              label: "证据摘要",
              relativePath:
                ".lime/harness/sessions/session-story-video-1/evidence/summary.md",
              absolutePath:
                "/workspace/.lime/harness/sessions/session-story-video-1/evidence/summary.md",
              projectId: "project-1",
              workspaceId: "project-1",
              source: "session_governance",
            },
            {
              kind: "review_decision_markdown",
              label: "人工复核记录",
              relativePath:
                ".lime/harness/sessions/session-story-video-1/review/review-decision.md",
              absolutePath:
                "/workspace/.lime/harness/sessions/session-story-video-1/review/review-decision.md",
              projectId: "project-1",
              workspaceId: "project-1",
              source: "session_governance",
            },
            {
              kind: "review_decision_json",
              label: "复核 JSON",
              relativePath:
                ".lime/harness/sessions/session-story-video-1/review/review-decision.json",
              absolutePath:
                "/workspace/.lime/harness/sessions/session-story-video-1/review/review-decision.json",
              projectId: "project-1",
              workspaceId: "project-1",
              source: "session_governance",
            },
          ],
          deliveryRequiredParts: [
            "brief",
            "storyboard",
            "script",
            "music_refs",
            "video_draft",
            "review_note",
          ],
          deliveryCompletedParts: [
            "brief",
            "storyboard",
            "script",
            "music_refs",
            "video_draft",
          ],
          deliveryMissingParts: ["review_note"],
          deliveryCompletionRate: 83.3,
          deliveryPartCoverageKnown: true,
          failureSignal: "review_blocked",
          runtimeEvidenceUsed: true,
          evidenceKnownGaps: [],
          verificationFailureOutcomes: [
            "Artifact 校验存在 1 条未恢复 issues。",
          ],
          requestTelemetryAvailable: true,
          requestTelemetryMatchedCount: 2,
          artifactValidatorApplicable: true,
          artifactValidatorIssueCount: 1,
          artifactValidatorRecoveredCount: 0,
        };
      }

      if (runId === "x-article-export-run-1") {
        return {
          runId,
          sceneappId: "x-article-export",
          status: "success",
          source: "skill",
          sourceRef: "service-skill:x-article-export",
          sessionId: "agent-session-article-export-1",
          browserRuntimeRef: {
            profileKey: "general_browser_assist",
            sessionId: "browser-session-article-export-1",
            targetId: "target-article-export-1",
          },
          startedAt: "2026-04-15T00:08:00.000Z",
          finishedAt: "2026-04-15T00:10:00.000Z",
          artifactCount: 2,
          deliveryRequiredParts: ["index.md", "meta.json"],
          deliveryCompletedParts: ["index.md", "meta.json"],
          deliveryMissingParts: [],
          deliveryCompletionRate: 100,
          deliveryPartCoverageKnown: true,
          failureSignal: null,
        };
      }

      if (runId === "project-analysis-copilot-run-1") {
        return {
          runId,
          sceneappId: "project-analysis-copilot",
          status: "success",
          source: "skill",
          sourceRef: "service-skill:project-analysis",
          sessionId: null,
          nativeSkillRuntimeRef: {
            skillId: "sceneapp-service-analysis",
            skillKey: "project-analysis",
            projectId: "project-1",
            workspaceId: "project-1",
            userInput: "请分析当前项目结构",
            slots: {
              focus: "架构",
              depth: "高",
            },
          },
          startedAt: "2026-04-15T00:11:00.000Z",
          finishedAt: "2026-04-15T00:13:00.000Z",
          artifactCount: 1,
          deliveryRequiredParts: [],
          deliveryCompletedParts: [],
          deliveryMissingParts: [],
          deliveryCompletionRate: null,
          deliveryPartCoverageKnown: false,
          failureSignal: null,
        };
      }

      return {
        runId,
        sceneappId: "daily-trend-briefing",
        status: "running",
        source: "automation",
        sourceRef: "automation-job-daily-trend-briefing",
        startedAt: "2026-04-15T00:00:00.000Z",
        finishedAt: null,
        artifactCount: 1,
        deliveryRequiredParts: ["brief", "review_note"],
        deliveryCompletedParts: [],
        deliveryMissingParts: [],
        deliveryCompletionRate: null,
        deliveryPartCoverageKnown: false,
        failureSignal: null,
      };
    });
    mockPlanSceneAppLaunch.mockImplementation(
      async (intent: { sceneappId: string }) => {
        if (intent.sceneappId === "daily-trend-briefing") {
          return createPlanResult({
            descriptor: {
              id: "daily-trend-briefing",
              title: "每日趋势摘要",
              summary: "围绕指定主题持续跟踪趋势。",
              sceneappType: "local_durable",
              entryBindings: [
                {
                  kind: "workspace_card",
                  bindingFamily: "automation_job",
                },
              ],
            },
            readiness: {
              ready: false,
              unmetRequirements: [
                {
                  kind: "automation",
                  message: "需要启用自动化能力。",
                },
              ],
            },
            plan: {
              sceneappId: "daily-trend-briefing",
              executorKind: "automation_job",
              bindingFamily: "automation_job",
              adapterPlan: {
                adapterKind: "automation_job",
                runtimeAction: "create_automation_job",
                targetRef: "sceneapp-service-daily-trend",
                targetLabel: "每日趋势摘要",
                requestMetadata: {
                  sceneapp: {
                    id: "daily-trend-briefing",
                  },
                  harness: {
                    sceneapp_runtime_action: "create_automation_job",
                  },
                },
                launchPayload: {
                  sceneapp_id: "daily-trend-briefing",
                  name: "每日趋势摘要 自动化",
                  description: "自动跟踪 AI Agent 行业动态。",
                  enabled: true,
                  execution_mode: "intelligent",
                  schedule: {
                    kind: "every",
                    every_secs: 3600,
                  },
                  delivery: {
                    mode: "none",
                    channel: null,
                    target: null,
                    best_effort: true,
                    output_schema: "text",
                    output_format: "text",
                  },
                  launch_intent: {
                    sceneapp_id: "daily-trend-briefing",
                    project_id: "project-1",
                    workspace_id: "project-1",
                    user_input: "关注 AI Agent 产品与云厂商动作",
                  },
                },
                notes: [],
              },
            },
          });
        }

        return createPlanResult({
          descriptor: {
            id: "story-video-suite",
            title: "短视频编排",
            summary: "把线框图、配乐和剧本串成短视频草稿。",
            sceneappType: "hybrid",
            entryBindings: [
              {
                kind: "scene",
                bindingFamily: "cloud_scene",
                sceneKey: "story-video-suite",
              },
            ],
            linkedServiceSkillId: "sceneapp-service-story-video",
            linkedSceneKey: "story-video-suite",
          },
          plan: {
            sceneappId: "story-video-suite",
            executorKind: "cloud_scene",
            bindingFamily: "cloud_scene",
            adapterPlan: {
              adapterKind: "cloud_scene",
              runtimeAction: "launch_cloud_scene",
              targetRef: "sceneapp-service-story-video",
              targetLabel: "短视频编排",
              requestMetadata: {
                harness: {
                  service_scene_launch: {
                    kind: "cloud_scene",
                  },
                },
              },
              launchPayload: {
                sceneapp_id: "story-video-suite",
                scene_key: "story-video-suite",
                service_skill_id: "sceneapp-service-story-video",
                project_id: "project-1",
                workspace_id: "project-1",
                user_input: "生成一个 30 秒短视频方案",
              },
              notes: [],
            },
          },
        });
      },
    );
    mockPrepareSceneAppRunGovernanceArtifact.mockImplementation(
      async (runId: string) => mockGetSceneAppRunSummary(runId),
    );
    mockPrepareSceneAppRunGovernanceArtifacts.mockImplementation(
      async (runId: string, kinds: string[]) => {
        let latestSummary = null;
        for (const kind of Array.from(new Set(kinds))) {
          latestSummary = await mockPrepareSceneAppRunGovernanceArtifact(
            runId,
            kind,
          );
        }
        return latestSummary;
      },
    );
  });

  afterEach(() => {
    while (mountedRoots.length > 0) {
      const mounted = mountedRoots.pop();
      if (!mounted) {
        continue;
      }

      act(() => {
        mounted.root.unmount();
      });
      mounted.container.remove();
    }

    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("应按分页方式拆开展示 SceneApp 目录、详情与治理复盘", async () => {
    const { container } = renderSceneAppsPage();
    await flushEffects();

    expect(container.textContent).toContain("在统一 Agent 基建上装配场景应用");
    expect(container.textContent).toContain("场景目录");
    expect(container.textContent).toContain("场景详情");
    expect(container.textContent).toContain("治理复盘");
    expect(
      container.querySelector('[data-testid="sceneapp-detail-title"]')
        ?.textContent,
    ).toContain("短视频编排");
    expect(container.textContent).not.toContain("story-video-suite-run-1");

    await openSceneAppsView(container, "catalog");
    expect(
      container.querySelector('[data-testid="sceneapps-catalog-directory"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("短视频编排");
    expect(
      container.querySelector('[data-testid="sceneapp-page-card-story-video-suite"]'),
    ).not.toBeNull();

    await openSceneAppsView(container, "detail");
    expect(
      container.querySelector('[data-testid="sceneapp-detail-blueprint-ref"]')
        ?.textContent,
    ).toContain("story-video-blueprint");
    expect(
      container.querySelector('[data-testid="sceneapp-detail-artifact-ref"]')
        ?.textContent,
    ).toContain("story-video-artifacts");
    expect(
      container.querySelector('[data-testid="sceneapp-detail-delivery-parts"]')
        ?.textContent,
    ).toContain("短视频草稿");
    expect(
      container.querySelector('[data-testid="sceneapp-detail-scorecard-ref"]')
        ?.textContent,
    ).toContain("story-video-scorecard");
    expect(
      container.querySelector('[data-testid="sceneapp-scorecard-profile-ref"]')
        ?.textContent,
    ).toContain("story-video-scorecard");
    expect(
      container.querySelector('[data-testid="sceneapp-scorecard-metric-keys"]')
        ?.textContent,
    ).toContain("整包交付率");
    expect(
      container.querySelector('[data-testid="sceneapp-scorecard-delivery-parts"]')
        ?.textContent,
    ).toContain("配乐建议");
    expect(
      container.querySelector(
        '[data-testid="sceneapp-scorecard-failure-signals"]',
      )?.textContent,
    ).toContain("整包不完整");
    expect(
      container.querySelector(
        '[data-testid="sceneapp-scorecard-observed-failure-signals"]',
      )?.textContent,
    ).toContain("复核阻塞");

    await openSceneAppsView(container, "governance");
    expect(
      container.querySelector('[data-testid="sceneapp-governance-status-badge"]')
        ?.textContent,
    ).toContain("先补治理材料");
    expect(container.textContent).toContain("story-video-suite-run-1");
    expect(container.textContent).toContain("story-video-suite-run-2");
    expect(
      container.querySelector('[data-testid="sceneapp-run-detail-summary"]')
        ?.textContent,
    ).toContain("短视频编排");
    expect(container.textContent).toContain("当前主要阻塞：复核阻塞");
    expect(mockGetSceneAppRunSummary).toHaveBeenCalledWith(
      "story-video-suite-run-2",
    );
  });

  it("点击目录卡片后应直接进入对应 SceneApp 的详情分页", async () => {
    const { container, onNavigate } = renderSceneAppsPage();
    await flushEffects();
    await openSceneAppsView(container, "catalog");

    const sceneCard = container.querySelector(
      '[data-testid="sceneapp-page-card-daily-trend-briefing"]',
    ) as HTMLButtonElement | null;
    expect(sceneCard).toBeTruthy();

    act(() => {
      sceneCard?.click();
    });
    await flushEffects();

    expect(
      container.querySelector('[data-testid="sceneapp-detail-title"]')?.textContent,
    ).toContain("每日趋势摘要");
    expect(onNavigate).toHaveBeenCalledWith(
      "sceneapps",
      expect.objectContaining({
        sceneappId: "daily-trend-briefing",
        view: "detail",
      }),
    );
  });

  it("工作流导轨应支持从详情直接进入治理分页", async () => {
    const { container } = renderSceneAppsPage();
    await flushEffects();

    const governanceButton = container.querySelector(
      '[data-testid="sceneapps-open-governance"]',
    ) as HTMLButtonElement | null;
    expect(governanceButton).toBeTruthy();

    act(() => {
      governanceButton?.click();
    });
    await flushEffects();

    expect(
      container.querySelector('[data-testid="sceneapp-governance-status-badge"]')
        ?.textContent,
    ).toContain("先补治理材料");
    expect(container.textContent).toContain("story-video-suite-run-1");
  });

  it("工作流导轨在没有运行样本时应先引导回到详情启动首轮", async () => {
    mockListSceneAppRuns.mockResolvedValue([]);

    const { container } = renderSceneAppsPage({
      pageParams: {
        view: "catalog",
      },
    });
    await flushEffects();

    const governanceButton = container.querySelector(
      '[data-testid="sceneapps-open-governance"]',
    ) as HTMLButtonElement | null;
    expect(governanceButton).toBeTruthy();
    expect(governanceButton?.textContent).toContain("先去启动");

    act(() => {
      governanceButton?.click();
    });
    await flushEffects();

    expect(
      container.querySelector('[data-testid="sceneapp-detail-title"]')?.textContent,
    ).toContain("短视频编排");
  });

  it("详情分页在没有匹配场景时应支持清空筛选并回到目录", async () => {
    const { container } = renderSceneAppsPage({
      pageParams: {
        view: "detail",
        search: "完全不存在的 SceneApp",
      },
    });
    await flushEffects();

    expect(
      container.querySelector('[data-testid="sceneapps-empty-state"]')
        ?.textContent,
    ).toContain("当前筛选后还没有可进入详情的 SceneApp");

    const resetButton = container.querySelector(
      '[data-testid="sceneapps-empty-reset-filters"]',
    ) as HTMLButtonElement | null;
    expect(resetButton).toBeTruthy();

    act(() => {
      resetButton?.click();
    });
    await flushEffects();

    expect(
      container.querySelector('[data-testid="sceneapp-page-card-story-video-suite"]'),
    ).not.toBeNull();
  });

  it("治理分页在没有运行样本时应引导回到详情先启动首轮", async () => {
    mockListSceneAppRuns.mockResolvedValue([]);

    const { container } = renderSceneAppsPage({
      pageParams: {
        view: "governance",
      },
    });
    await flushEffects();

    expect(
      container.querySelector('[data-testid="sceneapps-empty-state"]')
        ?.textContent,
    ).toContain("这条 SceneApp 还没有首轮治理样本");

    const openDetailButton = container.querySelector(
      '[data-testid="sceneapps-governance-open-detail"]',
    ) as HTMLButtonElement | null;
    expect(openDetailButton).toBeTruthy();

    act(() => {
      openDetailButton?.click();
    });
    await flushEffects();

    expect(
      container.querySelector('[data-testid="sceneapp-detail-title"]')?.textContent,
    ).toContain("短视频编排");
  });

  it("切换运行记录后应刷新右侧运行详情解释", async () => {
    const { container } = renderSceneAppsPage();
    await flushEffects();
    await openSceneAppsView(container, "governance");

    const completedRunButton = container.querySelector(
      '[data-testid="sceneapp-run-item-story-video-suite-run-1"]',
    ) as HTMLButtonElement | null;
    expect(completedRunButton).toBeTruthy();

    act(() => {
      completedRunButton?.click();
    });
    await flushEffects();

    expect(
      container.querySelector('[data-testid="sceneapp-run-detail-summary"]')
        ?.textContent,
    ).toContain("已交付 5/6 个部件");
    expect(container.textContent).toContain("复核意见");
    expect(container.textContent).toContain("自动化调度");
    expect(container.textContent).toContain("结果入口：结果包查看");
    expect(
      container.querySelector(
        '[data-testid="sceneapp-run-detail-request-telemetry"]',
      )?.textContent,
    ).toContain("已关联 2 条会话级请求遥测");
    expect(
      container.querySelector(
        '[data-testid="sceneapp-run-detail-artifact-validator"]',
      )?.textContent,
    ).toContain("Artifact 校验仍有 1 条未恢复问题");
    expect(container.textContent).toContain("Artifact 校验存在 1 条未恢复 issues。");
    expect(
      container.querySelector('[data-testid="sceneapp-governance-summary"]')
        ?.textContent,
    ).toContain("复核阻塞");
    expect(container.textContent).toContain("任务中心 / 看板");
    expect(container.textContent).toContain("自动化任务中心");
    expect(mockGetSceneAppRunSummary).toHaveBeenCalledWith(
      "story-video-suite-run-1",
    );
  });

  it("还没有真实评分时也应保留基础设置包里的评分口径", async () => {
    mockGetSceneAppScorecard.mockResolvedValue(null);

    const { container } = renderSceneAppsPage();
    await flushEffects();

    expect(container.textContent).toContain("等待首批真实运行样本回流");
    expect(
      container.querySelector('[data-testid="sceneapp-scorecard-profile-ref"]')
        ?.textContent,
    ).toContain("story-video-scorecard");
    expect(
      container.querySelector('[data-testid="sceneapp-scorecard-metric-keys"]')
        ?.textContent,
    ).toContain("发布转化率");
    expect(container.textContent).toContain("当前还没有真实评分数据");
  });

  it("评分接口报错时也应保留基础设置包里的评分口径", async () => {
    mockGetSceneAppScorecard.mockRejectedValue(new Error("scorecard unavailable"));

    const { container } = renderSceneAppsPage();
    await flushEffects();

    expect(
      container.querySelector('[data-testid="sceneapp-scorecard-error-banner"]')
        ?.textContent,
    ).toContain("scorecard unavailable");
    expect(
      container.querySelector('[data-testid="sceneapp-scorecard-profile-ref"]')
        ?.textContent,
    ).toContain("story-video-scorecard");
    expect(
      container.querySelector('[data-testid="sceneapp-scorecard-metric-keys"]')
        ?.textContent,
    ).toContain("整包交付率");
    expect(container.textContent).toContain("评分服务暂时不可用");
  });

  it("目录页状态变化后应回写可恢复的 sceneapps 页面参数", async () => {
    vi.useFakeTimers();

    try {
      const { container, onNavigate } = renderSceneAppsPage();
      await flushEffects();
      await openSceneAppsView(container, "catalog");

      const searchInput = container.querySelector(
        'input[placeholder="搜索场景标题"]',
      ) as HTMLInputElement | null;

      expect(searchInput).toBeTruthy();

      act(() => {
        setTextboxValue(searchInput!, "短视频");
      });

      await openSceneAppsView(container, "governance");

      const completedRunButton = container.querySelector(
        '[data-testid="sceneapp-run-item-story-video-suite-run-1"]',
      ) as HTMLButtonElement | null;

      expect(completedRunButton).toBeTruthy();
      act(() => {
        completedRunButton?.click();
      });

      await act(async () => {
        vi.advanceTimersByTime(300);
        await Promise.resolve();
      });
      await flushEffects();

      expect(onNavigate).toHaveBeenCalledWith(
        "sceneapps",
        expect.objectContaining({
          view: "governance",
          sceneappId: "story-video-suite",
          runId: "story-video-suite-run-1",
          projectId: "project-1",
          search: "短视频",
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("同页重新导航到 sceneapps 时应把 pageParams 回灌到本地状态", async () => {
    const { container, rerender } = renderSceneAppsPage();
    await flushEffects();

    rerender({
      pageParams: {
        sceneappId: "daily-trend-briefing",
        projectId: "project-1",
        prefillIntent: "关注云厂商和 Agent 工作流变化",
        search: "趋势",
        runId: "daily-trend-briefing-run-1",
      },
    });
    await flushEffects();

    await openSceneAppsView(container, "detail");
    expect(
      container.querySelector('[data-testid="sceneapp-detail-title"]')?.textContent,
    ).toContain("每日趋势摘要");

    await openSceneAppsView(container, "catalog");
    const searchInput = container.querySelector(
      'input[placeholder="搜索场景标题"]',
    ) as HTMLInputElement | null;

    await openSceneAppsView(container, "detail");
    const launchInput = container.querySelector("textarea") as
      | HTMLTextAreaElement
      | null;

    expect(searchInput?.value).toBe("趋势");
    expect(launchInput?.value).toBe("关注云厂商和 Agent 工作流变化");
    await openSceneAppsView(container, "governance");
    expect(
      container.querySelector('[data-testid="sceneapp-run-detail-summary"]')
        ?.textContent,
    ).toContain("每日趋势摘要");
  });

  it("应展示最近访问入口，并支持一键恢复最近上下文", async () => {
    recordSceneAppRecentVisit(
      {
        sceneappId: "daily-trend-briefing",
        projectId: "project-2",
        search: "趋势",
        prefillIntent: "继续跟踪云厂商动态",
      },
      {
        visitedAt: 200,
      },
    );
    recordSceneAppRecentVisit(
      {
        sceneappId: "story-video-suite",
        projectId: "project-1",
        runId: "story-video-suite-run-1",
        prefillIntent: "继续短视频结果链",
      },
      {
        visitedAt: 300,
      },
    );

    const { container, onNavigate } = renderSceneAppsPage();
    await flushEffects();
    await openSceneAppsView(container, "catalog");

    expect(
      container.querySelector('[data-testid="sceneapp-recent-latest-title"]')
        ?.textContent,
    ).toContain("短视频编排");
    expect(container.textContent).toContain("继续最近");

    const secondaryRecentButton = container.querySelector(
      '[data-testid="sceneapp-recent-item-daily-trend-briefing:project-2"]',
    ) as HTMLButtonElement | null;
    expect(secondaryRecentButton).toBeTruthy();

    act(() => {
      secondaryRecentButton?.click();
    });

    expect(onNavigate).toHaveBeenCalledWith(
      "sceneapps",
      expect.objectContaining({
        sceneappId: "daily-trend-briefing",
        projectId: "project-2",
        search: "趋势",
        prefillIntent: "继续跟踪云厂商动态",
      }),
    );
  });

  it("受控导航壳内点击继续最近场景不应触发循环回灌", async () => {
    vi.useFakeTimers();
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      recordSceneAppRecentVisit(
        {
          sceneappId: "daily-trend-briefing",
          projectId: "project-2",
          search: "趋势",
          prefillIntent: "继续跟踪云厂商动态",
        },
        {
          visitedAt: 200,
        },
      );

      const { container, navigationCalls } = renderControlledSceneAppsPage();
      await flushEffects();
      await openSceneAppsView(container, "catalog");

      navigationCalls.splice(0, navigationCalls.length);

      const secondaryRecentButton = container.querySelector(
        '[data-testid="sceneapp-recent-item-daily-trend-briefing:project-2"]',
      ) as HTMLButtonElement | null;
      expect(secondaryRecentButton).toBeTruthy();

      act(() => {
        secondaryRecentButton?.click();
      });

      await act(async () => {
        vi.advanceTimersByTime(1200);
        await Promise.resolve();
      });
      await flushEffects(12);

      expect(
        consoleErrorSpy.mock.calls.some(([message]) =>
          String(message).includes("Maximum update depth exceeded"),
        ),
      ).toBe(false);
      expect(navigationCalls).toHaveLength(1);
      expect(navigationCalls[0]).toEqual({
        page: "sceneapps",
        params: expect.objectContaining({
          view: "detail",
          sceneappId: "daily-trend-briefing",
          projectId: "project-2",
          search: "趋势",
          prefillIntent: "继续跟踪云厂商动态",
        }),
      });
      expect(container.textContent).toContain("每日趋势摘要");
    } finally {
      consoleErrorSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("workspace_entry 类型 SceneApp 应继续导航到 agent 主链", async () => {
    const { container, onNavigate } = renderSceneAppsPage();
    await flushEffects();

    const launchButton = container.querySelector(
      '[data-testid="sceneapp-page-launch"]',
    ) as HTMLButtonElement | null;
    expect(launchButton).toBeTruthy();

    await act(async () => {
      launchButton?.click();
    });
    await flushEffects();

    expect(onNavigate).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        projectId: "project-1",
        initialUserPrompt: "生成一个 30 秒短视频方案",
        autoRunInitialPromptOnMount: true,
      }),
    );
  });

  it("automation_job 类型 SceneApp 应打开标准自动化弹窗并复用 create_automation_job", async () => {
    const { container } = renderSceneAppsPage();
    await flushEffects();
    await openSceneAppsView(container, "catalog");

    const dailyCard = container.querySelector(
      '[data-testid="sceneapp-page-card-daily-trend-briefing"]',
    ) as HTMLButtonElement | null;
    expect(dailyCard).toBeTruthy();

    act(() => {
      dailyCard?.click();
    });
    await flushEffects();

    const launchButton = container.querySelector(
      '[data-testid="sceneapp-page-launch"]',
    ) as HTMLButtonElement | null;
    expect(launchButton?.textContent).toContain("配置自动化");

    await act(async () => {
      launchButton?.click();
    });
    await flushEffects();

    expect(
      container.querySelector('[data-testid="sceneapp-automation-dialog"]'),
    ).not.toBeNull();
    expect(latestAutomationDialogProps.value).toMatchObject({
      open: true,
      mode: "create",
      initialValues: expect.objectContaining({
        workspace_id: "project-1",
      }),
    });

    const dialogProps = latestAutomationDialogProps.value as {
      onSubmit: (payload: {
        mode: "create";
        request: Record<string, unknown>;
      }) => Promise<void>;
    };

    await act(async () => {
      await dialogProps.onSubmit({
        mode: "create",
        request: {
          name: "每日趋势摘要 自动化",
          workspace_id: "project-1",
          schedule: {
            kind: "every",
            every_secs: 3600,
          },
          payload: {
            kind: "agent_turn",
            prompt: "自定义提示",
            web_search: false,
          },
          delivery: {
            mode: "none",
            channel: null,
            target: null,
            best_effort: true,
            output_schema: "text",
            output_format: "text",
          },
        },
      });
    });

    expect(mockCreateAutomationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "每日趋势摘要 自动化",
        workspace_id: "project-1",
        payload: expect.objectContaining({
          kind: "agent_turn",
          request_metadata: expect.objectContaining({
            sceneapp: expect.objectContaining({
              id: "daily-trend-briefing",
            }),
          }),
        }),
      }),
    );
  });

  it("运行详情里的自动化来源应支持跳到对应 automation job", async () => {
    const { container, onNavigate } = renderSceneAppsPage();
    await flushEffects();
    await openSceneAppsView(container, "governance");

    const successRunItem = container.querySelector(
      '[data-testid="sceneapp-run-item-story-video-suite-run-1"]',
    ) as HTMLButtonElement | null;
    expect(successRunItem).toBeTruthy();

    act(() => {
      successRunItem?.click();
    });
    await flushEffects();

    const entryActionButton = container.querySelector(
      '[data-testid="sceneapp-run-detail-entry-action"]',
    ) as HTMLButtonElement | null;
    expect(entryActionButton?.textContent).toContain("打开自动化任务");

    act(() => {
      entryActionButton?.click();
    });

    expect(onNavigate).toHaveBeenCalledWith("automation", {
      selectedJobId: "automation-job-story-video-1",
      workspaceTab: "tasks",
    });
  });

  it("运行详情里的结果入口应支持直接打开主稿文件", async () => {
    const { container, onNavigate } = renderSceneAppsPage();
    await flushEffects();
    await openSceneAppsView(container, "governance");

    const seededRunItem = container.querySelector(
      '[data-testid="sceneapp-run-item-story-video-suite-run-1"]',
    ) as HTMLButtonElement | null;
    expect(seededRunItem).toBeTruthy();

    act(() => {
      seededRunItem?.click();
    });
    await flushEffects();

    const artifactEntryButton = container.querySelector(
      '[data-testid^="sceneapp-run-detail-artifact-entry-"]',
    ) as HTMLButtonElement | null;
    expect(artifactEntryButton?.textContent).toContain("主稿");
    expect(artifactEntryButton?.textContent).toContain("任务简报");

    act(() => {
      artifactEntryButton?.click();
    });

    expect(onNavigate).toHaveBeenCalledWith("agent", {
      agentEntry: "claw",
      projectId: "project-1",
      initialProjectFileOpenTarget: {
        relativePath: "exports/story-video-suite/latest/brief.md",
        requestKey: expect.any(Number),
      },
      entryBannerMessage: "已从 SceneApp 运行复盘打开结果文件：主稿 · 任务简报。",
    });
  });

  it("运行详情里的治理入口应支持打开证据摘要", async () => {
    const { container, onNavigate } = renderSceneAppsPage();
    await flushEffects();
    await openSceneAppsView(container, "governance");

    const seededRunItem = container.querySelector(
      '[data-testid="sceneapp-run-item-story-video-suite-run-1"]',
    ) as HTMLButtonElement | null;
    expect(seededRunItem).toBeTruthy();

    act(() => {
      seededRunItem?.click();
    });
    await flushEffects();

    const governanceEntryButton = container.querySelector(
      '[data-testid^="sceneapp-run-detail-governance-entry-evidence_summary-"]',
    ) as HTMLButtonElement | null;
    expect(governanceEntryButton?.textContent).toContain("证据摘要");

    act(() => {
      governanceEntryButton?.click();
    });

    await flushEffects();

    expect(mockPrepareSceneAppRunGovernanceArtifact).toHaveBeenCalledWith(
      "story-video-suite-run-1",
      "evidence_summary",
    );

    expect(onNavigate).toHaveBeenCalledWith("agent", {
      agentEntry: "claw",
      projectId: "project-1",
      initialProjectFileOpenTarget: {
        relativePath:
          ".lime/harness/sessions/session-story-video-1/evidence/summary.md",
        requestKey: expect.any(Number),
      },
      entryBannerMessage: "已从 SceneApp 运行复盘打开治理文件：证据摘要。",
    });
  });

  it("运行详情里的治理动作应支持准备周会复盘包", async () => {
    const { container, onNavigate } = renderSceneAppsPage();
    await flushEffects();
    await openSceneAppsView(container, "governance");

    const seededRunItem = container.querySelector(
      '[data-testid="sceneapp-run-item-story-video-suite-run-1"]',
    ) as HTMLButtonElement | null;
    expect(seededRunItem).toBeTruthy();

    act(() => {
      seededRunItem?.click();
    });
    await flushEffects();

    const governanceActionButton = container.querySelector(
      '[data-testid="sceneapp-run-detail-governance-action-weekly-review-pack"]',
    ) as HTMLButtonElement | null;
    expect(governanceActionButton?.textContent).toContain("准备周会复盘包");
    expect(governanceActionButton?.textContent).toContain("打开 人工复核记录");

    act(() => {
      governanceActionButton?.click();
    });

    await flushEffects();

    expect(mockPrepareSceneAppRunGovernanceArtifacts).toHaveBeenCalledWith(
      "story-video-suite-run-1",
      ["evidence_summary", "review_decision_markdown"],
    );

    expect(onNavigate).toHaveBeenCalledWith("agent", {
      agentEntry: "claw",
      projectId: "project-1",
      initialProjectFileOpenTarget: {
        relativePath:
          ".lime/harness/sessions/session-story-video-1/review/review-decision.md",
        requestKey: expect.any(Number),
      },
      entryBannerMessage: "已从 SceneApp 运行复盘打开治理动作：人工复核记录。",
    });
  });

  it("治理看板里的推荐动作应复用同一条治理动作主链", async () => {
    const { container, onNavigate } = renderSceneAppsPage();
    await flushEffects();
    await openSceneAppsView(container, "governance");

    const seededRunItem = container.querySelector(
      '[data-testid="sceneapp-run-item-story-video-suite-run-1"]',
    ) as HTMLButtonElement | null;
    expect(seededRunItem).toBeTruthy();

    act(() => {
      seededRunItem?.click();
    });
    await flushEffects();

    const governanceActionButton = container.querySelector(
      '[data-testid="sceneapp-governance-action-structured-governance-pack"]',
    ) as HTMLButtonElement | null;
    expect(governanceActionButton?.textContent).toContain("准备结构化治理包");

    act(() => {
      governanceActionButton?.click();
    });
    await flushEffects();

    expect(mockPrepareSceneAppRunGovernanceArtifacts).toHaveBeenCalledWith(
      "story-video-suite-run-1",
      ["evidence_summary", "review_decision_markdown", "review_decision_json"],
    );
    expect(onNavigate).toHaveBeenCalledWith("agent", {
      agentEntry: "claw",
      projectId: "project-1",
      initialProjectFileOpenTarget: {
        relativePath:
          ".lime/harness/sessions/session-story-video-1/review/review-decision.json",
        requestKey: expect.any(Number),
      },
      entryBannerMessage: "已从 SceneApp 运行复盘打开治理动作：复核 JSON。",
    });
  });

  it("运行详情里的云端 Scene 应支持回到对应会话", async () => {
    const { container, onNavigate } = renderSceneAppsPage();
    await flushEffects();
    await openSceneAppsView(container, "governance");

    const runningRunItem = container.querySelector(
      '[data-testid="sceneapp-run-item-story-video-suite-run-2"]',
    ) as HTMLButtonElement | null;
    expect(runningRunItem).toBeTruthy();

    act(() => {
      runningRunItem?.click();
    });
    await flushEffects();

    const entryActionButton = container.querySelector(
      '[data-testid="sceneapp-run-detail-entry-action"]',
    ) as HTMLButtonElement | null;
    expect(entryActionButton?.textContent).toContain("回到云端 Scene 会话");

    act(() => {
      entryActionButton?.click();
    });

    expect(onNavigate).toHaveBeenCalledWith("agent", {
      agentEntry: "claw",
      initialSessionId: "session-story-video-2",
      entryBannerMessage: "已从 SceneApp 运行复盘恢复云端 Scene 会话。",
    });
  });

  it("浏览器运行引用存在时应支持打开 browser runtime", async () => {
    const { container, onNavigate } = renderSceneAppsPage({
      pageParams: {
        sceneappId: "x-article-export",
        projectId: "project-1",
      },
    });
    await flushEffects();
    await openSceneAppsView(container, "governance");

    const runItem = container.querySelector(
      '[data-testid="sceneapp-run-item-x-article-export-run-1"]',
    ) as HTMLButtonElement | null;
    expect(runItem).toBeTruthy();

    act(() => {
      runItem?.click();
    });
    await flushEffects();

    const entryActionButton = container.querySelector(
      '[data-testid="sceneapp-run-detail-entry-action"]',
    ) as HTMLButtonElement | null;
    expect(entryActionButton?.textContent).toContain("回到浏览器运行时");

    act(() => {
      entryActionButton?.click();
    });

    expect(onNavigate).toHaveBeenCalledWith("browser-runtime", {
      initialProfileKey: "general_browser_assist",
      initialSessionId: "browser-session-article-export-1",
      initialTargetId: "target-article-export-1",
    });
  });

  it("本机技能运行引用存在时应支持恢复服务技能入口", async () => {
    const { container, onNavigate } = renderSceneAppsPage({
      pageParams: {
        sceneappId: "project-analysis-copilot",
        projectId: "project-1",
      },
    });
    await flushEffects();
    await openSceneAppsView(container, "governance");

    const runItem = container.querySelector(
      '[data-testid="sceneapp-run-item-project-analysis-copilot-run-1"]',
    ) as HTMLButtonElement | null;
    expect(runItem).toBeTruthy();

    act(() => {
      runItem?.click();
    });
    await flushEffects();

    const entryActionButton = container.querySelector(
      '[data-testid="sceneapp-run-detail-entry-action"]',
    ) as HTMLButtonElement | null;
    expect(entryActionButton?.textContent).toContain("恢复本机技能");

    act(() => {
      entryActionButton?.click();
    });

    expect(onNavigate).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        agentEntry: "claw",
        projectId: "project-1",
        entryBannerMessage: "已从 SceneApp 运行复盘恢复本机技能入口。",
        initialPendingServiceSkillLaunch: expect.objectContaining({
          skillId: "sceneapp-service-analysis",
          initialSlotValues: {
            focus: "架构",
            depth: "高",
          },
          launchUserInput: "请分析当前项目结构",
        }),
      }),
    );
  });
});
