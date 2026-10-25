import { describe, expect, it } from "vitest";

import { resolveLocalConversationPageShellViewModel } from "./agentChatPageShellViewModel";

type ShellInput = Parameters<typeof resolveLocalConversationPageShellViewModel>[0];

function resolve(input: ShellInput = {}) {
  return resolveLocalConversationPageShellViewModel(input);
}

function expectForced(input: ShellInput) {
  expect(
    resolve({ agentEntry: "new-task", showChatPanel: false, ...input }),
  ).toMatchObject({
    hasDirectWorkspaceIntent: true,
    shouldOpenConversation: true,
    effectiveAgentEntry: "conversation",
    effectiveShowChatPanel: true,
  });
}

describe("agentChatPageShellViewModel", () => {
  it("默认入口应保持 claw 工作区", () => {
    expect(resolve()).toEqual({
      hasDirectWorkspaceIntent: false,
      shouldOpenConversation: false,
      effectiveAgentEntry: "conversation",
      effectiveShowChatPanel: undefined,
    });
  });

  it("new-task 没有直达意图时应保留首页和聊天面板入参", () => {
    expect(
      resolve({
        agentEntry: "new-task",
        showChatPanel: false,
      }),
    ).toEqual({
      hasDirectWorkspaceIntent: false,
      shouldOpenConversation: false,
      effectiveAgentEntry: "new-task",
      effectiveShowChatPanel: false,
    });
  });

  it("空白文本不应触发直达工作区", () => {
    expect(
      resolve({
        agentEntry: "new-task",
        initialUserPrompt: "   ",
        initialPendingServiceSkillLaunch: {
          skillId: "   ",
        },
        initialSiteSkillLaunch: {
          adapterName: "   ",
        },
        initialProjectFileOpenTarget: {
          relativePath: "   ",
        },
      }),
    ).toMatchObject({
      hasDirectWorkspaceIntent: false,
      shouldOpenConversation: false,
      effectiveAgentEntry: "new-task",
    });
  });

  it("new-task 携带首条文本或图片时应强制进入 claw 工作区", () => {
    expectForced({
      initialUserPrompt: "请直接开始处理任务",
    });
    expectForced({
      initialSessionId: "session-from-sidebar",
    });
    expectForced({
      initialUserImages: [{ data: "image-data", mediaType: "image/png" }],
    });
  });

  it("new-task 携带技能、资料或文件直达意图时应强制进入 claw 工作区", () => {
    expectForced({
      initialSiteSkillLaunch: {
        adapterName: "browser-automation",
      },
    });
    expectForced({
      initialPendingServiceSkillLaunch: {
        skillId: "service-skill-1",
      },
    });

    expectForced({
      initialProjectFileOpenTarget: {
        relativePath: "exports/report.md",
      },
    });
  });

  it("new-task 携带输入能力时默认直达工作区，但首页偏好会保留首页", () => {
    const initialInputCapability: ShellInput["initialInputCapability"] = {
      skill: {
        key: "writer",
        name: "写作助手",
        directory: "writer",
        localDirectoryPath: "/skills/" + "writer",
        installed: true,
        sourceKind: "other" as const,
        description: "",
      },
    };

    expectForced({
      initialInputCapability,
    });

    expect(
      resolve({
        agentEntry: "new-task",
        showChatPanel: false,
        initialInputCapability,
        preferHomeForInitialInputCapability: true,
      }),
    ).toMatchObject({
      hasDirectWorkspaceIntent: false,
      shouldOpenConversation: false,
      effectiveAgentEntry: "new-task",
      effectiveShowChatPanel: false,
    });
  });

  it("new-task 打开浏览器协助时应强制进入 claw 工作区", () => {
    expectForced({
      openBrowserAssistOnMount: true,
    });
  });

  it("claw 入口即使携带直达意图也不需要强制切换", () => {
    expect(
      resolve({
        agentEntry: "conversation",
        showChatPanel: false,
        initialUserPrompt: "继续执行",
      }),
    ).toEqual({
      hasDirectWorkspaceIntent: true,
      shouldOpenConversation: false,
      effectiveAgentEntry: "conversation",
      effectiveShowChatPanel: false,
    });
  });

  it("claw 入口携带 initialSessionId 时应打开聊天面板", () => {
    expect(
      resolve({
        agentEntry: "conversation",
        showChatPanel: true,
        initialSessionId: "session-from-sidebar",
      }),
    ).toEqual({
      hasDirectWorkspaceIntent: true,
      shouldOpenConversation: false,
      effectiveAgentEntry: "conversation",
      effectiveShowChatPanel: true,
    });
  });
});
