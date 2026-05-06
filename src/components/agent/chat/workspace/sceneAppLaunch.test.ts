import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  executeSceneAppLaunchAction,
  resolveSceneAppLaunchAction,
} from "./sceneAppLaunch";
import type { SceneAppPlanResult } from "@/lib/sceneapp";
import type { ChatToolPreferences } from "../utils/chatToolPreferences";

type SceneAppPlanResultOverrides = {
  descriptor?: Partial<SceneAppPlanResult["descriptor"]>;
  readiness?: Partial<SceneAppPlanResult["readiness"]>;
  plan?: Partial<Omit<SceneAppPlanResult["plan"], "adapterPlan">> & {
    adapterPlan?: Partial<SceneAppPlanResult["plan"]["adapterPlan"]>;
  };
};

const mockCreateSceneAppAutomationJob = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/sceneapp", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/api/sceneapp")>(
      "@/lib/api/sceneapp",
    );
  return {
    ...actual,
    createSceneAppAutomationJob: mockCreateSceneAppAutomationJob,
  };
});

const defaultToolPreferences: ChatToolPreferences = {
  webSearch: false,
  thinking: false,
  task: false,
  subagent: false,
};

function createPlanResult(
  overrides: SceneAppPlanResultOverrides = {},
): SceneAppPlanResult {
  const planOverrides = overrides.plan ?? {};
  const adapterPlanOverrides = planOverrides.adapterPlan ?? {};

  return {
    descriptor: {
      id: "sceneapp-demo",
      title: "SceneApp Demo",
      summary: "SceneApp 执行桥接测试样板。",
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
        requestMetadata: adapterPlanOverrides.requestMetadata ?? {
          harness: {
            sceneapp_runtime_action: "submit_agent_turn",
          },
        },
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

describe("sceneAppLaunch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应把 workspace 类型 SceneApp 翻译成 agent 导航动作", () => {
    const result = createPlanResult({
      descriptor: {
        id: "story-video-suite",
        title: "短视频编排",
      },
      plan: {
        sceneappId: "story-video-suite",
        executorKind: "agent_turn",
        bindingFamily: "agent_turn",
        adapterPlan: {
          adapterKind: "agent_turn",
          runtimeAction: "open_service_scene_session",
          targetRef: "sceneapp-service-story-video",
          targetLabel: "短视频编排",
          requestMetadata: {
            harness: {
              service_scene_launch: {
                kind: "local_service_skill",
              },
            },
          },
          launchPayload: {
            sceneapp_id: "story-video-suite",
            workspace_id: "workspace-video",
            project_id: "project-video",
            content_id: "content-video-1",
            user_input: "生成一版产品短视频",
          },
          notes: [],
        },
      },
    });

    const resolved = resolveSceneAppLaunchAction({
      planResult: result,
      projectId: "project-current",
      activeTheme: "general",
      creationMode: "guided",
      defaultToolPreferences,
      now: () => 123,
    });

    expect(resolved).toEqual(
      expect.objectContaining({
        ok: true,
        kind: "navigate_agent",
        executionDraft: expect.objectContaining({
          kind: "workspace_entry",
          runtimeAction: "open_service_scene_session",
        }),
        resolvedEntry: expect.objectContaining({
          navigationParams: expect.objectContaining({
            projectId: "project-video",
            contentId: "content-video-1",
            initialUserPrompt: "生成一版产品短视频",
            autoRunInitialPromptOnMount: true,
          }),
        }),
      }),
    );
  });

  it("缺少项目时应返回结构化拒绝原因", () => {
    const result = createPlanResult({
      descriptor: {
        id: "native-scene",
        title: "本地分析场景",
      },
      plan: {
        sceneappId: "native-scene",
        executorKind: "native_skill",
        bindingFamily: "native_skill",
        adapterPlan: {
          adapterKind: "native_skill",
          runtimeAction: "launch_native_skill",
          targetRef: "native-scene",
          targetLabel: "本地分析场景",
          requestMetadata: {},
          launchPayload: {
            sceneapp_id: "native-scene",
            message: "请分析这个项目",
          },
          notes: [],
        },
      },
    });

    const resolved = resolveSceneAppLaunchAction({
      planResult: result,
      projectId: null,
      activeTheme: "general",
      creationMode: "guided",
      defaultToolPreferences,
      now: () => 234,
    });

    expect(resolved).toEqual({
      ok: false,
      kind: "workspace_entry",
      executionDraft: expect.objectContaining({
        kind: "workspace_entry",
        runtimeAction: "launch_native_skill",
      }),
      reason: "missing_project",
      message: "Skill「本地分析场景」需要项目工作区，请先选择项目后再启动。",
    });
  });

  it("native_skill 类型 SceneApp 应导航到服务技能入口而不是普通 prompt", () => {
    const result = createPlanResult({
      descriptor: {
        id: "project-analysis-copilot",
        title: "项目分析 Copilot",
      },
      plan: {
        sceneappId: "project-analysis-copilot",
        executorKind: "native_skill",
        bindingFamily: "native_skill",
        adapterPlan: {
          adapterKind: "native_skill",
          runtimeAction: "launch_native_skill",
          targetRef: "sceneapp-service-analysis",
          targetLabel: "项目分析 Copilot",
          requestMetadata: {
            sceneapp: {
              id: "project-analysis-copilot",
            },
            harness: {
              sceneapp_runtime_action: "launch_native_skill",
              sceneapp_native_skill_launch: {
                skill_id: "sceneapp-service-analysis",
                skill_key: "project-analysis",
                project_id: "project-analysis",
                workspace_id: "workspace-analysis",
                user_input: "请分析当前项目结构",
                slots: {
                  focus: "架构",
                },
              },
            },
          },
          launchPayload: {
            sceneapp_id: "project-analysis-copilot",
            service_skill_id: "sceneapp-service-analysis",
            project_id: "project-analysis",
            workspace_id: "workspace-analysis",
            user_input: "请分析当前项目结构",
            slots: {
              focus: "架构",
            },
          },
          notes: [],
        },
      },
    });

    const resolved = resolveSceneAppLaunchAction({
      planResult: result,
      projectId: "project-current",
      activeTheme: "general",
      creationMode: "guided",
      defaultToolPreferences,
      now: () => 345,
    });

    expect(resolved).toEqual(
      expect.objectContaining({
        ok: true,
        kind: "navigate_agent",
        resolvedEntry: expect.objectContaining({
          navigationParams: expect.objectContaining({
            projectId: "project-analysis",
            initialPendingServiceSkillLaunch: expect.objectContaining({
              skillId: "sceneapp-service-analysis",
              skillKey: "project-analysis",
              requestKey: 345,
              initialSlotValues: {
                focus: "架构",
              },
              launchUserInput: "请分析当前项目结构",
            }),
          }),
        }),
      }),
    );
  });

  it("执行 workspace 类型 SceneApp 时应调用导航", async () => {
    const onNavigate = vi.fn();
    const result = createPlanResult({
      descriptor: {
        id: "browser-scene",
        title: "网页采集场景",
      },
      plan: {
        sceneappId: "browser-scene",
        executorKind: "browser_assist",
        bindingFamily: "browser_assist",
        adapterPlan: {
          adapterKind: "browser_assist",
          runtimeAction: "launch_browser_assist",
          targetRef: "x/article-export",
          targetLabel: "网页采集场景",
          requestMetadata: {
            harness: {
              service_skill_launch: {
                adapter_name: "x/article-export",
              },
            },
          },
          launchPayload: {
            sceneapp_id: "browser-scene",
            project_id: "project-browser",
            args: {
              url: "https://x.com/openai/article/123",
            },
          },
          notes: [],
        },
      },
    });

    const executed = await executeSceneAppLaunchAction({
      planResult: result,
      projectId: "project-current",
      activeTheme: "general",
      creationMode: "guided",
      defaultToolPreferences,
      onNavigate,
      now: () => 345,
    });

    expect(executed).toEqual(
      expect.objectContaining({
        ok: true,
        kind: "navigate_agent",
      }),
    );
    expect(onNavigate).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        projectId: "project-browser",
        openBrowserAssistOnMount: true,
        lockTheme: true,
      }),
    );
  });

  it("执行 automation 类型 SceneApp 时应优先打开标准自动化表单", async () => {
    const onOpenAutomationDialog = vi.fn();
    const result = createPlanResult({
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
            },
          },
          launchPayload: {
            sceneapp_id: "daily-trend-briefing",
            name: "每日趋势摘要 自动化",
            execution_mode: "intelligent",
            schedule: {
              kind: "every",
              every_secs: 3600,
            },
            launch_intent: {
              sceneapp_id: "daily-trend-briefing",
              workspace_id: "workspace-trend",
              project_id: "project-trend",
              user_input: "关注 AI Agent 行业变化",
            },
          },
          notes: [],
        },
      },
    });

    const executed = await executeSceneAppLaunchAction({
      planResult: result,
      projectId: "project-current",
      activeTheme: "general",
      creationMode: "guided",
      defaultToolPreferences,
      onOpenAutomationDialog,
      now: () => 456,
    });

    expect(executed).toEqual(
      expect.objectContaining({
        ok: true,
        kind: "open_automation_dialog",
      }),
    );
    expect(onOpenAutomationDialog).toHaveBeenCalledWith({
      initialValues: expect.objectContaining({
        workspace_id: "workspace-trend",
        schedule_kind: "every",
      }),
      automationIntent: expect.objectContaining({
        name: "每日趋势摘要 自动化",
        launchIntent: expect.objectContaining({
          sceneappId: "daily-trend-briefing",
        }),
      }),
      executionDraft: expect.objectContaining({
        kind: "automation_job",
      }),
    });
    expect(mockCreateSceneAppAutomationJob).not.toHaveBeenCalled();
  });

  it("执行 automation 类型 SceneApp 且未提供表单回调时应直接创建任务", async () => {
    mockCreateSceneAppAutomationJob.mockResolvedValueOnce({
      sceneappId: "daily-trend-briefing",
      jobId: "sceneapp-job-1",
      jobName: "每日趋势摘要 自动化",
      enabled: true,
      workspaceId: "workspace-trend",
      nextRunAt: null,
      runNowResult: null,
    });

    const result = createPlanResult({
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
          requestMetadata: {},
          launchPayload: {
            sceneapp_id: "daily-trend-briefing",
            launch_intent: {
              sceneapp_id: "daily-trend-briefing",
              workspace_id: "workspace-trend",
              user_input: "关注 AI Agent 行业变化",
            },
          },
          notes: [],
        },
      },
    });

    const executed = await executeSceneAppLaunchAction({
      planResult: result,
      projectId: "project-current",
      activeTheme: "general",
      creationMode: "guided",
      defaultToolPreferences,
      now: () => 567,
    });

    expect(mockCreateSceneAppAutomationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        launchIntent: expect.objectContaining({
          sceneappId: "daily-trend-briefing",
          workspaceId: "workspace-trend",
        }),
      }),
    );
    expect(executed).toEqual(
      expect.objectContaining({
        ok: true,
        kind: "automation_job_created",
        result: expect.objectContaining({
          jobId: "sceneapp-job-1",
        }),
      }),
    );
  });

  it("workspace 类型 SceneApp 缺少导航回调时应返回结构化错误", async () => {
    const result = createPlanResult({
      descriptor: {
        id: "story-video-suite",
        title: "短视频编排",
      },
      plan: {
        sceneappId: "story-video-suite",
        executorKind: "agent_turn",
        bindingFamily: "agent_turn",
        adapterPlan: {
          adapterKind: "agent_turn",
          runtimeAction: "open_service_scene_session",
          targetRef: "sceneapp-service-story-video",
          targetLabel: "短视频编排",
          requestMetadata: {},
          launchPayload: {
            sceneapp_id: "story-video-suite",
            project_id: "project-video",
            message: "生成一版产品短视频",
          },
          notes: [],
        },
      },
    });

    const executed = await executeSceneAppLaunchAction({
      planResult: result,
      projectId: "project-current",
      activeTheme: "general",
      creationMode: "guided",
      defaultToolPreferences,
      now: () => 678,
    });

    expect(executed).toEqual({
      ok: false,
      kind: "workspace_entry",
      executionDraft: expect.objectContaining({
        kind: "workspace_entry",
        runtimeAction: "open_service_scene_session",
      }),
      reason: "missing_navigate",
      message: "当前入口暂不支持切换到 Skills 工作区，请从桌面主界面重试。",
    });
  });
});
