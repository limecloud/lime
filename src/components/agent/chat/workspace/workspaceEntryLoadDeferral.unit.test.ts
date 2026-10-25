import { describe, expect, it } from "vitest";
import {
  BLANK_HOME_DEFERRED_LOAD_MS,
  RECENT_CONVERSATIONS_IDLE_DEFERRED_LOAD_MS,
  SESSION_ENTRY_AUXILIARY_DEFERRED_LOAD_MS,
  SESSION_ENTRY_RUNTIME_WARMUP_DEFERRED_LOAD_MS,
} from "./agentChatWorkspaceHelpers";
import { resolveWorkspaceEntryLoadDeferral } from "./workspaceEntryLoadDeferral";

type Input = Parameters<typeof resolveWorkspaceEntryLoadDeferral>[0];

function resolve(overrides: Partial<Input> = {}) {
  return resolveWorkspaceEntryLoadDeferral({
    agentEntry: "conversation",
    contentId: undefined,
    normalizedEntryTheme: "general",
    normalizedInitialSessionId: null,
    ...overrides,
  });
}

describe("resolveWorkspaceEntryLoadDeferral", () => {
  it("new-task general 空白首页应延迟辅助加载并启用浏览器首页 chrome", () => {
    const state = resolve({
      agentEntry: "new-task",
    });

    expect(state).toMatchObject({
      shouldPreserveEntryThemeOnHome: true,
      shouldPreserveBlankHomeSurface: true,
      shouldUseBrowserWorkspaceHomeChrome: true,
      shouldDeferWorkspaceAuxiliaryLoads: true,
      shouldDeferInitialTopicsLoad: true,
      shouldDeferInitialRuntimeWarmup: true,
      deferredWorkspaceAuxiliaryLoadMs: BLANK_HOME_DEFERRED_LOAD_MS,
      deferredInitialTopicsLoadMs: RECENT_CONVERSATIONS_IDLE_DEFERRED_LOAD_MS,
      deferredInitialRuntimeWarmupMs: BLANK_HOME_DEFERRED_LOAD_MS,
    });
  });

  it("standalone initialSessionId 应优先恢复会话并使用 session entry 延迟", () => {
    const state = resolve({
      normalizedInitialSessionId: "session-1",
    });

    expect(state.shouldPrioritizeInitialSessionEntry).toBe(true);
    expect(state.shouldPrioritizeInitialPromptEntry).toBe(false);
    expect(state.deferredWorkspaceAuxiliaryLoadMs).toBe(
      SESSION_ENTRY_AUXILIARY_DEFERRED_LOAD_MS,
    );
    expect(state.deferredInitialRuntimeWarmupMs).toBe(
      SESSION_ENTRY_RUNTIME_WARMUP_DEFERRED_LOAD_MS,
    );
  });

  it("claw general 纯文本首发应优先发送输入并延迟辅助加载", () => {
    const state = resolve({
      initialUserPrompt: "继续整理这篇文章",
    });

    expect(state.shouldPrioritizeInitialSessionEntry).toBe(false);
    expect(state.shouldPrioritizeInitialPromptEntry).toBe(true);
    expect(state.shouldDeferWorkspaceAuxiliaryLoads).toBe(true);
    expect(state.deferredInitialTopicsLoadMs).toBe(
      RECENT_CONVERSATIONS_IDLE_DEFERRED_LOAD_MS,
    );
  });

  it("图片、技能、输入能力或文件直达不应误判为纯文本首发", () => {
    expect(
      resolve({
        initialUserPrompt: "分析图片",
        initialUserImages: [{ data: "image-data", mediaType: "image/png" }],
      }).shouldPrioritizeInitialPromptEntry,
    ).toBe(false);
    expect(
      resolve({
        initialUserPrompt: "执行技能",
        initialPendingServiceSkillLaunch: { skillId: "writer" },
      }).shouldPrioritizeInitialPromptEntry,
    ).toBe(false);
    expect(
      resolve({
        initialUserPrompt: "打开能力",
        initialInputCapability: {
          skill: {
            key: "writer",
            name: "写作助手",
            directory: "writer",
            localDirectoryPath: "/skills/" + "writer",
            installed: true,
            sourceKind: "other" as const,
            description: "",
          },
        },
      }).shouldPrioritizeInitialPromptEntry,
    ).toBe(false);
    expect(
      resolve({
        initialUserPrompt: "打开文件",
        initialProjectFileOpenTarget: { relativePath: "reports/index.md" },
      }).shouldPrioritizeInitialPromptEntry,
    ).toBe(false);
  });
});
