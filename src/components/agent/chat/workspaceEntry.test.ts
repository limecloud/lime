import { describe, expect, it } from "vitest";
import type { ChatToolPreferences } from "./utils/chatToolPreferences";
import { resolveWorkspaceEntry } from "./workspaceEntry";

const defaultToolPreferences: ChatToolPreferences = {
  webSearch: false,
  thinking: false,
  task: false,
  subagent: false,
};

describe("workspaceEntry", () => {
  it("缺少项目且不是浏览器协助时应拒绝进入", () => {
    expect(
      resolveWorkspaceEntry({
        projectId: null,
        activeTheme: "general",
        creationMode: "guided",
        defaultToolPreferences,
        payload: {
          prompt: "帮我整理方案",
        },
        now: () => 123,
      }),
    ).toEqual({
      ok: false,
      reason: "missing_project",
    });
  });

  it("没有 prompt 和图片时应拒绝空进入", () => {
    expect(
      resolveWorkspaceEntry({
        projectId: "project-1",
        activeTheme: "general",
        creationMode: "guided",
        defaultToolPreferences,
        payload: {},
        now: () => 123,
      }),
    ).toEqual({
      ok: false,
      reason: "empty_payload",
    });
  });

  it("仅携带 contentId 时也应允许进入已有交付物工作区", () => {
    expect(
      resolveWorkspaceEntry({
        projectId: "project-1",
        activeTheme: "general",
        creationMode: "guided",
        defaultToolPreferences,
        payload: {
          contentId: "content-1",
          themeOverride: "general",
        },
        now: () => 234,
      }),
    ).toEqual({
      ok: true,
      toolPreferences: defaultToolPreferences,
      targetTheme: "general",
      nextNewChatAt: 234,
      navigationParams: {
        agentEntry: "claw",
        immersiveHome: false,
        projectId: "project-1",
        contentId: "content-1",
        theme: "general",
        initialCreationMode: "guided",
        initialUserPrompt: undefined,
        initialUserImages: undefined,
        openBrowserAssistOnMount: undefined,
        newChatAt: 234,
        lockTheme: false,
      },
      workspaceBootstrap: {
        projectId: "project-1",
        contentId: "content-1",
        initialUserPrompt: undefined,
        initialUserImages: undefined,
        theme: "general",
        lockTheme: false,
        initialCreationMode: "guided",
        openBrowserAssistOnMount: undefined,
        newChatAt: 234,
      },
    });
  });

  it("应生成导航参数与工作区 bootstrap", () => {
    expect(
      resolveWorkspaceEntry({
        projectId: "project-1",
        activeTheme: "general",
        creationMode: "guided",
        defaultToolPreferences,
        payload: {
          prompt: "请起草一版首稿",
          contentId: "content-1",
          initialRequestMetadata: {
            artifact: {
              artifact_mode: "draft",
            },
          },
          autoRunInitialPromptOnMount: true,
          themeOverride: "general",
        },
        now: () => 456,
      }),
    ).toEqual({
      ok: true,
      toolPreferences: defaultToolPreferences,
      targetTheme: "general",
      nextNewChatAt: 456,
      navigationParams: {
        agentEntry: "claw",
        immersiveHome: false,
        projectId: "project-1",
        contentId: "content-1",
        theme: "general",
        initialCreationMode: "guided",
        initialUserPrompt: "请起草一版首稿",
        initialUserImages: undefined,
        initialRequestMetadata: {
          artifact: {
            artifact_mode: "draft",
          },
        },
        autoRunInitialPromptOnMount: true,
        openBrowserAssistOnMount: undefined,
        newChatAt: 456,
        lockTheme: false,
      },
      workspaceBootstrap: {
        projectId: "project-1",
        contentId: "content-1",
        initialUserPrompt: "请起草一版首稿",
        initialUserImages: undefined,
        initialRequestMetadata: {
          artifact: {
            artifact_mode: "draft",
          },
        },
        autoRunInitialPromptOnMount: true,
        theme: "general",
        lockTheme: false,
        initialCreationMode: "guided",
        openBrowserAssistOnMount: undefined,
        newChatAt: 456,
      },
    });
  });

  it("应透传创作场景执行摘要与自动发送 metadata", () => {
    expect(
      resolveWorkspaceEntry({
        projectId: "project-1",
        activeTheme: "general",
        creationMode: "guided",
        defaultToolPreferences,
        payload: {
          prompt: "请继续完成短视频项目包",
          initialSceneAppExecutionSummary: {
            sceneappId: "story-video-suite",
            title: "短视频编排",
            summary: "把线框图、脚本与配乐压成同一条结果链。",
            businessLabel: "内容闭环",
            typeLabel: "多模态组合",
            executionChainLabel: "创作场景 -> 生成 -> Project Pack",
            deliveryContractLabel: "Project Pack",
            planningStatusLabel: "已就绪",
            planningSummary: "当前可直接进入生成。",
            activeLayers: [{ key: "skill", label: "Skill" }],
            referenceCount: 1,
            referenceItems: [
              {
                key: "ref-1",
                label: "品牌 KV",
                sourceLabel: "灵感库",
                contentTypeLabel: "图片",
                selected: true,
              },
            ],
            tasteSummary: "偏好克制的科技蓝。",
            feedbackSummary: "最近反馈要求减少文案堆叠。",
            projectPackPlan: {
              packKindLabel: "短视频项目包",
              completionStrategyLabel: "按必含部件判断整包完成度",
              viewerLabel: "结果包查看器",
              primaryPart: "任务简报",
              requiredParts: [{ key: "brief", label: "任务简报" }],
              notes: ["完整度将按 1 个必含部件判断。"],
            },
            scorecardProfileRef: "story-video-scorecard",
            scorecardMetricKeys: [
              { key: "delivery_readiness", label: "交付就绪度" },
            ],
            scorecardFailureSignals: [
              { key: "publish_stalled", label: "发布卡点" },
            ],
            notes: ["已装配 1 条参考素材。"],
          },
          initialAutoSendRequestMetadata: {
            harness: {
              service_scene_launch: {
                kind: "cloud_scene",
              },
            },
          },
          autoRunInitialPromptOnMount: true,
        },
        now: () => 567,
      }),
    ).toEqual({
      ok: true,
      toolPreferences: defaultToolPreferences,
      targetTheme: "general",
      nextNewChatAt: 567,
      navigationParams: expect.objectContaining({
        projectId: "project-1",
        theme: "general",
        initialUserPrompt: "请继续完成短视频项目包",
        initialSceneAppExecutionSummary: expect.objectContaining({
          sceneappId: "story-video-suite",
          title: "短视频编排",
        }),
        initialAutoSendRequestMetadata: {
          harness: {
            service_scene_launch: {
              kind: "cloud_scene",
            },
          },
        },
        autoRunInitialPromptOnMount: true,
        newChatAt: 567,
      }),
      workspaceBootstrap: expect.objectContaining({
        projectId: "project-1",
        initialUserPrompt: "请继续完成短视频项目包",
        initialSceneAppExecutionSummary: expect.objectContaining({
          sceneappId: "story-video-suite",
          title: "短视频编排",
        }),
        initialAutoSendRequestMetadata: {
          harness: {
            service_scene_launch: {
              kind: "cloud_scene",
            },
          },
        },
        autoRunInitialPromptOnMount: true,
        newChatAt: 567,
      }),
    });
  });

  it("浏览器协助入口允许无项目直接进入", () => {
    expect(
      resolveWorkspaceEntry({
        projectId: null,
        activeTheme: "general",
        creationMode: "guided",
        defaultToolPreferences,
        payload: {
          prompt: "",
          openBrowserAssistOnMount: true,
        },
        now: () => 789,
      }),
    ).toEqual({
      ok: true,
      toolPreferences: defaultToolPreferences,
      targetTheme: "general",
      nextNewChatAt: 789,
      navigationParams: {
        agentEntry: "claw",
        immersiveHome: false,
        projectId: undefined,
        theme: "general",
        initialCreationMode: "guided",
        initialUserPrompt: "",
        initialUserImages: undefined,
        openBrowserAssistOnMount: true,
        newChatAt: 789,
        lockTheme: false,
      },
      workspaceBootstrap: {
        projectId: undefined,
        initialUserPrompt: "",
        initialUserImages: undefined,
        theme: "general",
        lockTheme: false,
        initialCreationMode: "guided",
        openBrowserAssistOnMount: true,
        newChatAt: 789,
      },
    });
  });

  it("站点技能初始载荷允许无 prompt 直接进入 Claw 工作区", () => {
    expect(
      resolveWorkspaceEntry({
        projectId: "project-1",
        activeTheme: "general",
        creationMode: "guided",
        defaultToolPreferences,
        payload: {
          themeOverride: "general",
          initialSiteSkillLaunch: {
            adapterName: "github/search",
            args: {
              query: "browser assist mcp",
            },
            autoRun: true,
            requireAttachedSession: true,
          },
        },
        now: () => 987,
      }),
    ).toEqual({
      ok: true,
      toolPreferences: defaultToolPreferences,
      targetTheme: "general",
      nextNewChatAt: 987,
      navigationParams: {
        agentEntry: "claw",
        immersiveHome: false,
        projectId: "project-1",
        theme: "general",
        initialCreationMode: "guided",
        initialUserPrompt: undefined,
        initialUserImages: undefined,
        openBrowserAssistOnMount: undefined,
        initialSiteSkillLaunch: {
          adapterName: "github/search",
          args: {
            query: "browser assist mcp",
          },
          autoRun: true,
          requireAttachedSession: true,
        },
        newChatAt: 987,
        lockTheme: true,
      },
      workspaceBootstrap: {
        projectId: "project-1",
        initialUserPrompt: undefined,
        initialUserImages: undefined,
        theme: "general",
        lockTheme: true,
        initialCreationMode: "guided",
        openBrowserAssistOnMount: undefined,
        initialSiteSkillLaunch: {
          adapterName: "github/search",
          args: {
            query: "browser assist mcp",
          },
          autoRun: true,
          requireAttachedSession: true,
        },
        newChatAt: 987,
      },
    });
  });

  it("服务技能挂起入口允许无 prompt 直接进入 Claw 工作区", () => {
    expect(
      resolveWorkspaceEntry({
        projectId: "project-1",
        activeTheme: "general",
        creationMode: "guided",
        defaultToolPreferences,
        payload: {
          initialPendingServiceSkillLaunch: {
            skillId: "sceneapp-service-analysis",
            skillKey: "project-analysis",
            initialSlotValues: {
              focus: "架构",
            },
            launchUserInput: "请分析当前项目结构",
          },
        },
        now: () => 654,
      }),
    ).toEqual({
      ok: true,
      toolPreferences: defaultToolPreferences,
      targetTheme: "general",
      nextNewChatAt: 654,
      navigationParams: {
        agentEntry: "claw",
        immersiveHome: false,
        projectId: "project-1",
        theme: "general",
        initialCreationMode: "guided",
        initialUserPrompt: undefined,
        initialUserImages: undefined,
        openBrowserAssistOnMount: undefined,
        initialPendingServiceSkillLaunch: {
          skillId: "sceneapp-service-analysis",
          skillKey: "project-analysis",
          requestKey: 654,
          initialSlotValues: {
            focus: "架构",
          },
          launchUserInput: "请分析当前项目结构",
        },
        newChatAt: 654,
        lockTheme: false,
      },
      workspaceBootstrap: {
        projectId: "project-1",
        initialUserPrompt: undefined,
        initialUserImages: undefined,
        theme: "general",
        lockTheme: false,
        initialCreationMode: "guided",
        openBrowserAssistOnMount: undefined,
        initialPendingServiceSkillLaunch: {
          skillId: "sceneapp-service-analysis",
          skillKey: "project-analysis",
          requestKey: 654,
          initialSlotValues: {
            focus: "架构",
          },
          launchUserInput: "请分析当前项目结构",
        },
        newChatAt: 654,
      },
    });
  });

  it("站点技能 metadata 启动时也应自动锁定 general 主题", () => {
    expect(
      resolveWorkspaceEntry({
        projectId: "project-document-1",
        activeTheme: "general",
        creationMode: "guided",
        defaultToolPreferences,
        payload: {
          prompt: "你帮我在 GitHub 找一下和“AI Agent”相关的项目。",
          contentId: "content-site-skill-1",
          themeOverride: "general",
          autoRunInitialPromptOnMount: true,
          initialAutoSendRequestMetadata: {
            harness: {
              service_skill_launch: {
                kind: "site_adapter",
                adapter_name: "github/search",
                args: {
                  query: "AI Agent",
                },
              },
            },
          },
        },
        now: () => 111,
      }),
    ).toEqual({
      ok: true,
      toolPreferences: defaultToolPreferences,
      targetTheme: "general",
      nextNewChatAt: 111,
      navigationParams: {
        agentEntry: "claw",
        immersiveHome: false,
        projectId: "project-document-1",
        contentId: "content-site-skill-1",
        theme: "general",
        lockTheme: true,
        initialCreationMode: "guided",
        initialUserPrompt: "你帮我在 GitHub 找一下和“AI Agent”相关的项目。",
        initialUserImages: undefined,
        initialAutoSendRequestMetadata: {
          harness: {
            service_skill_launch: {
              kind: "site_adapter",
              adapter_name: "github/search",
              args: {
                query: "AI Agent",
              },
            },
          },
        },
        autoRunInitialPromptOnMount: true,
        openBrowserAssistOnMount: undefined,
        newChatAt: 111,
      },
      workspaceBootstrap: {
        projectId: "project-document-1",
        contentId: "content-site-skill-1",
        initialUserPrompt: "你帮我在 GitHub 找一下和“AI Agent”相关的项目。",
        initialUserImages: undefined,
        initialAutoSendRequestMetadata: {
          harness: {
            service_skill_launch: {
              kind: "site_adapter",
              adapter_name: "github/search",
              args: {
                query: "AI Agent",
              },
            },
          },
        },
        autoRunInitialPromptOnMount: true,
        theme: "general",
        lockTheme: true,
        initialCreationMode: "guided",
        openBrowserAssistOnMount: undefined,
        newChatAt: 111,
      },
    });
  });

  it("应透传初始项目文件打开目标，供导出结果自动落到真实文件预览", () => {
    expect(
      resolveWorkspaceEntry({
        projectId: "project-3",
        activeTheme: "general",
        creationMode: "guided",
        defaultToolPreferences,
        payload: {
          contentId: "content-3",
          initialProjectFileOpenTarget: {
            relativePath: "exports/social-article/google-cloud/index.md",
            requestKey: 20260408,
          },
        },
        now: () => 654,
      }),
    ).toEqual({
      ok: true,
      toolPreferences: defaultToolPreferences,
      targetTheme: "general",
      nextNewChatAt: 654,
      navigationParams: {
        agentEntry: "claw",
        immersiveHome: false,
        projectId: "project-3",
        contentId: "content-3",
        theme: "general",
        initialCreationMode: "guided",
        initialUserPrompt: undefined,
        initialUserImages: undefined,
        openBrowserAssistOnMount: undefined,
        initialProjectFileOpenTarget: {
          relativePath: "exports/social-article/google-cloud/index.md",
          requestKey: 20260408,
        },
        newChatAt: 654,
        lockTheme: false,
      },
      workspaceBootstrap: {
        projectId: "project-3",
        contentId: "content-3",
        initialUserPrompt: undefined,
        initialUserImages: undefined,
        theme: "general",
        lockTheme: false,
        initialCreationMode: "guided",
        openBrowserAssistOnMount: undefined,
        initialProjectFileOpenTarget: {
          relativePath: "exports/social-article/google-cloud/index.md",
          requestKey: 20260408,
        },
        newChatAt: 654,
      },
    });
  });
});
