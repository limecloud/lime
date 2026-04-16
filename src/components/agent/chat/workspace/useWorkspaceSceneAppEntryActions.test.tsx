import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatToolPreferences } from "../utils/chatToolPreferences";
import { useWorkspaceSceneAppEntryActions } from "./useWorkspaceSceneAppEntryActions";
import type { SceneAppCatalog, SceneAppPlanResult } from "@/lib/sceneapp";

type SceneAppPlanResultOverrides = {
  descriptor?: Partial<SceneAppPlanResult["descriptor"]>;
  readiness?: Partial<SceneAppPlanResult["readiness"]>;
  plan?: Partial<Omit<SceneAppPlanResult["plan"], "adapterPlan">> & {
    adapterPlan?: Partial<SceneAppPlanResult["plan"]["adapterPlan"]>;
  };
};

const mockListSceneAppCatalog = vi.fn();
const mockPlanSceneAppLaunch = vi.fn();
const mockCreateAutomationJob = vi.fn();
const mockListProjects = vi.fn();
const mockGetOrCreateDefaultProject = vi.fn();
const mockReadStoredSceneAppCatalog = vi.fn();
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

vi.mock("@/lib/api/sceneapp", () => ({
  listSceneAppCatalog: () => mockListSceneAppCatalog(),
  planSceneAppLaunch: (intent: unknown) => mockPlanSceneAppLaunch(intent),
}));

vi.mock("@/lib/api/automation", () => ({
  createAutomationJob: (request: unknown) => mockCreateAutomationJob(request),
}));

vi.mock("@/lib/api/project", () => ({
  listProjects: () => mockListProjects(),
  getOrCreateDefaultProject: () => mockGetOrCreateDefaultProject(),
}));

vi.mock("@/lib/sceneapp", async () => {
  const actual = await vi.importActual<typeof import("@/lib/sceneapp")>(
    "@/lib/sceneapp",
  );
  return {
    ...actual,
    readStoredSceneAppCatalog: () => mockReadStoredSceneAppCatalog(),
  };
});

type HookProps = Parameters<typeof useWorkspaceSceneAppEntryActions>[0];

const mountedRoots: Array<{ container: HTMLDivElement; root: Root }> = [];
const DEFAULT_CHAT_TOOL_PREFERENCES: ChatToolPreferences = {
  webSearch: false,
  thinking: false,
  task: false,
  subagent: false,
};

function createSceneAppCatalog(): SceneAppCatalog {
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
          "workspace_storage",
          "cloud_runtime",
        ],
        deliveryContract: "artifact_bundle",
        outputHint: "短视频结果包",
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
        id: "x-article-export",
        title: "网页导出",
        summary: "在浏览器上下文中抓取网页并沉淀为资料包。",
        category: "Scene Apps",
        sceneappType: "browser_grounded",
        patternPrimary: "pipeline",
        patternStack: ["pipeline", "tool_wrapper", "generator"],
        capabilityRefs: ["browser_assist"],
        infraProfile: [
          "browser_connector",
          "workspace_storage",
          "artifact_bundle",
        ],
        deliveryContract: "project_pack",
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
            message: "需要真实浏览器上下文。",
          },
          {
            kind: "project",
            message: "需要项目目录来保存资料包。",
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
    ],
  };
}

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

function createPlanResult(
  overrides: SceneAppPlanResultOverrides = {},
): SceneAppPlanResult {
  const planOverrides = overrides.plan ?? {};
  const adapterPlanOverrides = planOverrides.adapterPlan ?? {};

  return {
    descriptor: {
      id: "story-video-suite",
      title: "短视频编排",
      summary: "SceneApp 测试样板。",
      category: "Scene Apps",
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
      sceneappId: planOverrides.sceneappId ?? "story-video-suite",
      executorKind: planOverrides.executorKind ?? "cloud_scene",
      bindingFamily: planOverrides.bindingFamily ?? "cloud_scene",
      stepPlan: planOverrides.stepPlan ?? [],
      adapterPlan: {
        adapterKind: adapterPlanOverrides.adapterKind ?? "cloud_scene",
        runtimeAction:
          adapterPlanOverrides.runtimeAction ?? "launch_cloud_scene",
        targetRef:
          adapterPlanOverrides.targetRef ?? "sceneapp-service-story-video",
        targetLabel: adapterPlanOverrides.targetLabel ?? "短视频编排",
        requestMetadata: adapterPlanOverrides.requestMetadata ?? {
          sceneapp: {
            id: "story-video-suite",
            title: "短视频编排",
          },
        },
        launchPayload: adapterPlanOverrides.launchPayload ?? {
          sceneapp_id: "story-video-suite",
          workspace_id: "project-1",
          project_id: "project-1",
          content_id: "content-1",
          user_input: "做一条新品发布短视频",
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

function renderHook(props?: Partial<HookProps>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let latestValue: ReturnType<typeof useWorkspaceSceneAppEntryActions> | null =
    null;

  const defaultProps: HookProps = {
    activeTheme: "general",
    creationMode: "guided",
    projectId: "project-1",
    input: "",
    selectedText: "",
    defaultToolPreferences: DEFAULT_CHAT_TOOL_PREFERENCES,
    onNavigate: vi.fn(),
  };

  function Probe(currentProps: HookProps) {
    latestValue = useWorkspaceSceneAppEntryActions(currentProps);
    return null;
  }

  const render = async (nextProps?: Partial<HookProps>) => {
    await act(async () => {
      root.render(<Probe {...defaultProps} {...props} {...nextProps} />);
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  mountedRoots.push({ container, root });

  return {
    render,
    getValue: () => {
      if (!latestValue) {
        throw new Error("hook 尚未初始化");
      }
      return latestValue;
    },
    getDefaultProps: () => ({ ...defaultProps, ...props }),
  };
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mockListSceneAppCatalog.mockResolvedValue(createSceneAppCatalog());
  mockReadStoredSceneAppCatalog.mockReturnValue(null);
  mockListProjects.mockResolvedValue([createProject()]);
  mockGetOrCreateDefaultProject.mockResolvedValue(createProject());
  mockCreateAutomationJob.mockResolvedValue({
    id: "job-1",
    name: "每日趋势摘要 自动化",
  });
});

afterEach(() => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) break;
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  vi.clearAllMocks();
});

describe("useWorkspaceSceneAppEntryActions", () => {
  it("应按业务入口构建 featured SceneApp 卡片，并在出现 URL 时显示网页导出", async () => {
    const harness = renderHook({
      input: "给我一条新品发布短视频方案",
    });
    await harness.render();

    expect(harness.getValue().featuredSceneApps.map((item) => item.id)).toEqual([
      "story-video-suite",
      "daily-trend-briefing",
    ]);

    await harness.render({
      input: "请整理这篇文章 https://example.com/agent-trends",
    });

    expect(harness.getValue().featuredSceneApps.map((item) => item.id)).toEqual([
      "story-video-suite",
      "x-article-export",
      "daily-trend-briefing",
    ]);
  });

  it("应把可在当前会话继续的 SceneApp 翻译成 agent 导航动作", async () => {
    const onNavigate = vi.fn();
    mockPlanSceneAppLaunch.mockResolvedValueOnce(
      createPlanResult({
        descriptor: {
          id: "story-video-suite",
          title: "短视频编排",
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
              sceneapp: {
                id: "story-video-suite",
              },
            },
            launchPayload: {
              sceneapp_id: "story-video-suite",
              workspace_id: "project-1",
              project_id: "project-1",
              content_id: "content-video-1",
              user_input: "做一条新品发布短视频",
            },
            notes: [],
          },
        },
      }),
    );

    const harness = renderHook({
      input: "做一条新品发布短视频",
      onNavigate,
    });
    await harness.render();

    await act(async () => {
      await harness.getValue().handleLaunchSceneApp("story-video-suite");
    });

    expect(mockPlanSceneAppLaunch).toHaveBeenCalledWith(
      expect.objectContaining({
        sceneappId: "story-video-suite",
        projectId: "project-1",
        workspaceId: "project-1",
        userInput: "做一条新品发布短视频",
      }),
    );
    expect(onNavigate).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        projectId: "project-1",
        contentId: "content-video-1",
        initialUserPrompt: "做一条新品发布短视频",
        autoRunInitialPromptOnMount: true,
      }),
    );
  });

  it("应为 durable SceneApp 打开标准自动化表单，并保留 SceneApp metadata", async () => {
    mockPlanSceneAppLaunch.mockResolvedValueOnce(
      createPlanResult({
        descriptor: {
          id: "daily-trend-briefing",
          title: "每日趋势摘要",
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
                title: "每日趋势摘要",
              },
              harness: {
                sceneapp_runtime_action: "create_automation_job",
              },
            },
            launchPayload: {
              sceneapp_id: "daily-trend-briefing",
              name: "每日趋势摘要 自动化",
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
                workspace_id: "project-1",
                project_id: "project-1",
                user_input: "关注 AI Agent 产品趋势",
                slots: {},
              },
            },
            notes: [],
          },
        },
      }),
    );

    const harness = renderHook({
      input: "关注 AI Agent 产品趋势",
    });
    await harness.render();

    await act(async () => {
      await harness.getValue().handleLaunchSceneApp("daily-trend-briefing");
    });

    expect(harness.getValue().automationDialogOpen).toBe(true);
    expect(harness.getValue().automationDialogInitialValues).toEqual(
      expect.objectContaining({
        name: "每日趋势摘要 自动化",
        workspace_id: "project-1",
      }),
    );

    await act(async () => {
      await harness.getValue().handleAutomationDialogSubmit({
        mode: "create",
        request: {
          name: "每日趋势摘要 自动化",
          description: "每天跟踪 AI Agent 方向",
          enabled: true,
          workspace_id: "project-1",
          execution_mode: "intelligent",
          schedule: {
            kind: "every",
            every_secs: 1800,
          },
          payload: {
            kind: "agent_turn",
            prompt: "请持续跟踪 AI Agent 产品和云厂商动作。",
            system_prompt: null,
            web_search: true,
            request_metadata: {
              custom: true,
            },
          },
          delivery: {
            mode: "none",
            channel: null,
            target: null,
            best_effort: true,
            output_schema: "text",
            output_format: "text",
          },
          timeout_secs: null,
          max_retries: 3,
        },
      });
    });

    expect(mockCreateAutomationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          kind: "agent_turn",
          prompt: "请持续跟踪 AI Agent 产品和云厂商动作。",
          request_metadata: expect.objectContaining({
            custom: true,
            sceneapp: expect.objectContaining({
              id: "daily-trend-briefing",
            }),
          }),
        }),
      }),
    );
    expect(harness.getValue().automationDialogOpen).toBe(false);
    expect(mockToastSuccess).toHaveBeenCalledWith(
      "SceneApp 自动化已创建：每日趋势摘要 自动化",
    );
  });
});
