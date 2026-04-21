import { describe, expect, it } from "vitest";
import { buildSceneAppExecutionDraft } from "./launch";
import type { SceneAppPlanResult } from "./types";

type SceneAppPlanResultOverrides = {
  descriptor?: Partial<SceneAppPlanResult["descriptor"]>;
  readiness?: Partial<SceneAppPlanResult["readiness"]>;
  contextOverlay?: Partial<NonNullable<SceneAppPlanResult["contextOverlay"]>>;
  projectPackPlan?: Partial<NonNullable<SceneAppPlanResult["projectPackPlan"]>>;
  plan?: Partial<Omit<SceneAppPlanResult["plan"], "adapterPlan">> & {
    adapterPlan?: Partial<SceneAppPlanResult["plan"]["adapterPlan"]>;
  };
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
      summary: "用于验证 SceneApp runtime facade 的测试场景。",
      category: "测试",
      sceneappType: "hybrid",
      patternPrimary: "pipeline",
      patternStack: ["pipeline"],
      capabilityRefs: ["sceneapp"],
      infraProfile: ["workspace_storage"],
      deliveryContract: "artifact_bundle",
      outputHint: "验证结果",
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
    contextOverlay: {
      compilerPlan: {
        activeLayers: ["skill", "memory", "tool"],
        memoryRefs: ["workspace:workspace-demo"],
        toolRefs: ["workspace_storage"],
        referenceCount: 0,
        notes: ["已装配 1 条 memory 引用。"],
        ...(overrides.contextOverlay?.compilerPlan ?? {}),
      },
      snapshot: {
        workspaceId: "workspace-demo",
        projectId: "project-demo",
        skillRefs: ["sceneapp-demo"],
        memoryRefs: ["workspace:workspace-demo"],
        toolRefs: ["workspace_storage"],
        referenceItems: [],
        tasteProfile: null,
        ...(overrides.contextOverlay?.snapshot ?? {}),
      },
    },
    projectPackPlan: {
      packKind: "artifact_bundle",
      primaryPart: "brief",
      requiredParts: ["brief", "review_note"],
      viewerKind: "artifact_bundle",
      completionStrategy: "required_parts_complete",
      notes: ["完整度将按 2 个必含部件判断。"],
      ...(overrides.projectPackPlan ?? {}),
    },
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
        notes: adapterPlanOverrides.notes ?? [
          "SceneApp runtime facade 测试样板。",
        ],
        linkedServiceSkillId: adapterPlanOverrides.linkedServiceSkillId,
        linkedSceneKey: adapterPlanOverrides.linkedSceneKey,
        preferredProfileKey: adapterPlanOverrides.preferredProfileKey,
      } as SceneAppPlanResult["plan"]["adapterPlan"],
      storageStrategy: planOverrides.storageStrategy ?? "workspace_bundle",
      artifactContract: planOverrides.artifactContract ?? "artifact_bundle",
      governanceHooks: planOverrides.governanceHooks ?? ["evidence_pack"],
      warnings: planOverrides.warnings ?? [],
    } as SceneAppPlanResult["plan"],
  };
}

describe("sceneapp launch facade", () => {
  it("应把 service_scene adapter plan 翻译成 workspace launch draft", () => {
    const result = createPlanResult({
      descriptor: {
        id: "story-video-suite",
        title: "短视频编排",
        summary: "把线框图、配乐和剧本串成短视频草稿。",
        sceneappType: "hybrid",
        entryBindings: [
          {
            kind: "scene",
            bindingFamily: "agent_turn",
            sceneKey: "story-video-suite",
          },
        ],
        linkedServiceSkillId: "sceneapp-service-story-video",
        linkedSceneKey: "story-video-suite",
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
                service_scene_run: {
                  sceneapp_id: "story-video-suite",
                  scene_key: "story-video-suite",
                  skill_id: "sceneapp-service-story-video",
                  project_id: "project-video",
                  content_id: "content-video-1",
                  user_input: "把产品卖点做成 30 秒短视频",
                },
              },
            },
          },
          launchPayload: {
            sceneapp_id: "story-video-suite",
            scene_key: "story-video-suite",
            service_skill_id: "sceneapp-service-story-video",
            project_id: "project-video",
            workspace_id: "workspace-video",
            user_input: "把产品卖点做成 30 秒短视频",
            slots: {
              duration: "30s",
            },
          },
          notes: ["当前做法规划会收敛到 Agent 工作区主链，并由客户端继续执行。"],
        },
      },
    });

    const draft = buildSceneAppExecutionDraft(result);

    expect(draft).toEqual(
      expect.objectContaining({
        kind: "workspace_entry",
        runtimeAction: "open_service_scene_session",
        adapterKind: "agent_turn",
        targetRef: "sceneapp-service-story-video",
        workspaceId: "workspace-video",
        workspaceEntry: expect.objectContaining({
          prompt: "把产品卖点做成 30 秒短视频",
          projectId: "project-video",
          contentId: "content-video-1",
          autoRunInitialPromptOnMount: true,
          initialSceneAppExecutionSummary: expect.objectContaining({
            sceneappId: "story-video-suite",
            title: "短视频编排",
            deliveryContractLabel: expect.any(String),
          }),
          initialAutoSendRequestMetadata: expect.objectContaining({
            harness: expect.objectContaining({
              service_scene_launch: expect.objectContaining({
                kind: "local_service_skill",
              }),
            }),
          }),
        }),
      }),
    );
    expect(draft.notes).toContain("已装配 1 条 memory 引用。");
    expect(draft.notes).toContain("完整度将按 2 个必含部件判断。");
    expect(draft.notes).toContain(
      "当前做法规划会收敛到 Agent 工作区主链，并由客户端继续执行。",
    );
  });

  it("legacy launch_cloud_scene 也应正规化成当前 service_scene 动作", () => {
    const result = createPlanResult({
      plan: {
        adapterPlan: {
          adapterKind: "cloud_scene",
          runtimeAction: "launch_cloud_scene",
          targetRef: "sceneapp-service-story-video",
          targetLabel: "短视频编排",
        },
      },
    });

    const draft = buildSceneAppExecutionDraft(result);

    expect(draft).toEqual(
      expect.objectContaining({
        kind: "workspace_entry",
        runtimeAction: "open_service_scene_session",
      }),
    );
  });

  it("应把 browser_assist adapter plan 翻译成浏览器工作区启动草稿", () => {
    const result = createPlanResult({
      descriptor: {
        id: "x-article-export",
        title: "X 文章转存",
        summary: "复用登录态导出 X 长文。",
        sceneappType: "browser_grounded",
        entryBindings: [
          {
            kind: "scene",
            bindingFamily: "browser_assist",
            sceneKey: "x-article-export",
          },
        ],
        linkedServiceSkillId: "sceneapp-service-article-export",
        linkedSceneKey: "x-article-export",
      },
      plan: {
        sceneappId: "x-article-export",
        executorKind: "browser_assist",
        bindingFamily: "browser_assist",
        adapterPlan: {
          adapterKind: "browser_assist",
          runtimeAction: "launch_browser_assist",
          targetRef: "x/article-export",
          targetLabel: "X 文章转存",
          requestMetadata: {
            harness: {
              browser_assist: {
                enabled: true,
                profile_key: "general_browser_assist",
                preferred_backend: "lime_extension_bridge",
              },
              service_skill_launch: {
                kind: "site_adapter",
                adapter_name: "x/article-export",
                project_id: "project-export",
                args: {
                  url: "https://x.com/openai/article/123",
                  target_language: "中文",
                },
              },
            },
          },
          launchPayload: {
            sceneapp_id: "x-article-export",
            adapter_name: "x/article-export",
            profile_key: "general_browser_assist",
            project_id: "project-export",
            args: {
              url: "https://x.com/openai/article/123",
              target_language: "中文",
            },
          },
          notes: ["当前做法规划先映射到 browser_assist 主链。"],
        },
      },
    });

    const draft = buildSceneAppExecutionDraft(result);

    expect(draft).toEqual(
      expect.objectContaining({
        kind: "workspace_entry",
        runtimeAction: "launch_browser_assist",
        adapterKind: "browser_assist",
        workspaceEntry: expect.objectContaining({
          projectId: "project-export",
          autoRunInitialPromptOnMount: true,
          openBrowserAssistOnMount: true,
          themeOverride: "general",
          lockTheme: true,
          prompt:
            "请执行做法「X 文章转存」。目标链接：https://x.com/openai/article/123；目标语言：中文。",
          initialAutoSendRequestMetadata: expect.objectContaining({
            harness: expect.objectContaining({
              service_skill_launch: expect.objectContaining({
                adapter_name: "x/article-export",
              }),
            }),
          }),
        }),
      }),
    );
  });

  it("应把 native_skill adapter plan 翻译成服务技能入口草稿", () => {
    const result = createPlanResult({
      descriptor: {
        id: "project-analysis-copilot",
        title: "项目分析 Copilot",
        summary: "围绕项目目录执行本机分析技能。",
        sceneappType: "local_instant",
        entryBindings: [
          {
            kind: "service_skill",
            bindingFamily: "native_skill",
          },
        ],
        linkedServiceSkillId: "sceneapp-service-analysis",
        linkedSceneKey: "project-analysis",
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
                  depth: "高",
                },
              },
            },
          },
          launchPayload: {
            sceneapp_id: "project-analysis-copilot",
            service_skill_id: "sceneapp-service-analysis",
            skill_key: "project-analysis",
            project_id: "project-analysis",
            workspace_id: "workspace-analysis",
            user_input: "请分析当前项目结构",
            slots: {
              focus: "架构",
              depth: "高",
            },
          },
          notes: ["当前做法规划先映射到 native_skill 主链。"],
        },
      },
    });

    const draft = buildSceneAppExecutionDraft(result);

    expect(draft).toEqual(
      expect.objectContaining({
        kind: "workspace_entry",
        runtimeAction: "launch_native_skill",
        adapterKind: "native_skill",
        workspaceId: "workspace-analysis",
        workspaceEntry: expect.objectContaining({
          projectId: "project-analysis",
          initialSceneAppExecutionSummary: expect.objectContaining({
            sceneappId: "project-analysis-copilot",
            title: "项目分析 Copilot",
            deliveryContractLabel: expect.any(String),
          }),
          initialRequestMetadata: expect.objectContaining({
            harness: expect.objectContaining({
              sceneapp_native_skill_launch: expect.objectContaining({
                skill_id: "sceneapp-service-analysis",
              }),
            }),
          }),
          initialPendingServiceSkillLaunch: expect.objectContaining({
            skillId: "sceneapp-service-analysis",
            skillKey: "project-analysis",
            initialSlotValues: {
              focus: "架构",
              depth: "高",
            },
            launchUserInput: "请分析当前项目结构",
          }),
        }),
      }),
    );
  });

  it("应把 automation_job adapter plan 翻译成统一自动化草稿", () => {
    const result = createPlanResult({
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
              project_id: "project-trend",
              workspace_id: "workspace-trend",
              user_input: "关注 AI Agent 产品与云厂商动作",
              reference_memory_ids: ["memory-trend-1"],
            },
          },
          notes: ["当前做法规划先映射到 automation_job 主链。"],
        },
        warnings: ["当前做法仍有未满足的启动前置条件。"],
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
    });

    const draft = buildSceneAppExecutionDraft(result);

    expect(draft).toEqual(
      expect.objectContaining({
        kind: "automation_job",
        runtimeAction: "create_automation_job",
        sceneappId: "daily-trend-briefing",
        automationIntent: expect.objectContaining({
          name: "每日趋势摘要 自动化",
          executionMode: "intelligent",
          launchIntent: expect.objectContaining({
            sceneappId: "daily-trend-briefing",
            projectId: "project-trend",
            workspaceId: "workspace-trend",
            userInput: "关注 AI Agent 产品与云厂商动作",
            referenceMemoryIds: ["memory-trend-1"],
          }),
        }),
        automationRequest: expect.objectContaining({
          workspace_id: "workspace-trend",
          payload: expect.objectContaining({
            kind: "agent_turn",
            prompt:
              "SceneApp: 每日趋势摘要\n用户目标：关注 AI Agent 产品与云厂商动作",
            approval_policy: "never",
            sandbox_policy: "danger-full-access",
            request_metadata: expect.objectContaining({
              sceneapp: expect.objectContaining({
                id: "daily-trend-briefing",
              }),
            }),
          }),
        }),
        automationDialogInitialValues: expect.objectContaining({
          workspace_id: "workspace-trend",
          schedule_kind: "every",
          every_secs: "3600",
          payload_kind: "agent_turn",
          execution_mode: "intelligent",
          agent_access_mode: "full-access",
          prompt:
            "SceneApp: 每日趋势摘要\n用户目标：关注 AI Agent 产品与云厂商动作",
        }),
      }),
    );
    expect(draft.notes).toContain("当前做法仍有未满足的启动前置条件。");
  });
});
