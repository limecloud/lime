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
        initialCreationMode: "guided",
        openBrowserAssistOnMount: true,
        newChatAt: 789,
      },
    });
  });
});
