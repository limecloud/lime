import { describe, expect, it } from "vitest";
import type { ChatToolPreferences } from "./utils/chatToolPreferences";
import { resolveHomeShellWorkspaceEntry } from "./homeShellEntry";

const defaultToolPreferences: ChatToolPreferences = {
  webSearch: false,
  thinking: false,
  task: false,
  subagent: false,
};

describe("homeShellEntry", () => {
  it("缺少项目且不是浏览器协助时应拒绝进入", () => {
    expect(
      resolveHomeShellWorkspaceEntry({
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
      resolveHomeShellWorkspaceEntry({
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
      resolveHomeShellWorkspaceEntry({
        projectId: "project-1",
        activeTheme: "document",
        creationMode: "guided",
        defaultToolPreferences,
        payload: {
          contentId: "content-1",
          themeOverride: "document",
        },
        now: () => 234,
      }),
    ).toEqual({
      ok: true,
      toolPreferences: defaultToolPreferences,
      targetTheme: "document",
      nextNewChatAt: 234,
      navigationParams: {
        agentEntry: "claw",
        immersiveHome: false,
        projectId: "project-1",
        contentId: "content-1",
        theme: "document",
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
        theme: "document",
        lockTheme: false,
        initialCreationMode: "guided",
        openBrowserAssistOnMount: undefined,
        newChatAt: 234,
      },
    });
  });

  it("应生成导航参数与工作区 bootstrap", () => {
    expect(
      resolveHomeShellWorkspaceEntry({
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
          themeOverride: "social-media",
        },
        now: () => 456,
      }),
    ).toEqual({
      ok: true,
      toolPreferences: defaultToolPreferences,
      targetTheme: "social-media",
      nextNewChatAt: 456,
      navigationParams: {
        agentEntry: "claw",
        immersiveHome: false,
        projectId: "project-1",
        contentId: "content-1",
        theme: "social-media",
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
        theme: "social-media",
        lockTheme: false,
        initialCreationMode: "guided",
        openBrowserAssistOnMount: undefined,
        newChatAt: 456,
      },
    });
  });

  it("浏览器协助入口允许无项目直接进入", () => {
    expect(
      resolveHomeShellWorkspaceEntry({
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
      resolveHomeShellWorkspaceEntry({
        projectId: "project-1",
        activeTheme: "knowledge",
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

  it("站点技能 metadata 启动时也应自动锁定 general 主题", () => {
    expect(
      resolveHomeShellWorkspaceEntry({
        projectId: "project-document-1",
        activeTheme: "document",
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
});
