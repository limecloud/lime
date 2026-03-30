import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceSkillHomeItem } from "../service-skills/types";
import { useWorkspaceSendActions } from "./useWorkspaceSendActions";
import type { TeamWorkspaceRuntimeFormationState } from "../teamWorkspaceRuntime";

const mockPreheatBrowserAssistInBackground = vi.hoisted(() => vi.fn());

vi.mock("../utils/browserAssistPreheat", () => ({
  preheatBrowserAssistInBackground: mockPreheatBrowserAssistInBackground,
}));

type HookProps = Parameters<typeof useWorkspaceSendActions>[0];

interface HookHarness {
  getValue: () => ReturnType<typeof useWorkspaceSendActions>;
  unmount: () => void;
}

const mockSendMessage = vi.fn<HookProps["sendMessage"]>(async () => undefined);
const mockPrepareRuntimeTeamBeforeSend = vi.fn<
  HookProps["prepareRuntimeTeamBeforeSend"]
>(async () => null);
const mockFinalizeAfterSendSuccess = vi.fn();
const mockRollbackAfterSendFailure = vi.fn();
const mockSetInput = vi.fn();
const mockSetMentionedCharacters = vi.fn();
const mockSetChatToolPreferences = vi.fn();
const mockSetRuntimeTeamDispatchPreview = vi.fn();
const mockEnsureBrowserAssistCanvas = vi.fn(async () => true);
const mockHandleAutoLaunchMatchedSiteSkill = vi.fn(async () => undefined);
const mockHandleImageWorkbenchCommand = vi.fn(async () => false);

function createGithubSiteSkill(): ServiceSkillHomeItem {
  return {
    id: "github-repo-radar",
    title: "GitHub 仓库线索检索",
    summary: "复用 GitHub 登录态检索项目。",
    category: "情报研究",
    outputHint: "仓库列表 + 关键线索",
    source: "cloud_catalog",
    runnerType: "instant",
    defaultExecutorBinding: "browser_assist",
    executionLocation: "client_default",
    version: "seed-v1",
    badge: "云目录",
    recentUsedAt: null,
    isRecent: false,
    runnerLabel: "浏览器站点执行",
    runnerTone: "emerald",
    runnerDescription: "直接复用浏览器登录态执行。",
    actionLabel: "启动采集",
    automationStatus: null,
    slotSchema: [
      {
        key: "repository_query",
        label: "检索主题",
        type: "text",
        required: true,
        placeholder: "例如 AI Agent",
      },
    ],
    siteCapabilityBinding: {
      adapterName: "github/search",
      autoRun: true,
      requireAttachedSession: true,
      saveMode: "current_content",
      slotArgMap: {
        repository_query: "query",
      },
      fixedArgs: {
        limit: 10,
      },
    },
  };
}

function createPreparedRuntimeTeamState(): TeamWorkspaceRuntimeFormationState {
  return {
    requestId: "runtime-team-preview-1",
    status: "formed",
    label: "研究协作组",
    summary: "按调研、分析、汇总三段推进",
    members: [
      {
        id: "researcher",
        label: "研究员",
        summary: "负责收集资料",
        skillIds: [],
        status: "planned",
        latestSnippet: null,
      },
    ],
    blueprint: {
      label: "研究协作组",
      summary: "按调研、分析、汇总三段推进",
      roles: [
        {
          id: "researcher",
          label: "研究员",
          summary: "负责收集资料",
          skillIds: [],
        },
      ],
    },
    errorMessage: null,
    updatedAt: 1_710_000_000_000,
  };
}

function mountHook(initialProps?: Partial<HookProps>): HookHarness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  let hookValue: ReturnType<typeof useWorkspaceSendActions> | null = null;
  const props: HookProps = {
    input: "继续处理当前话题",
    setInput: mockSetInput,
    mentionedCharacters: [],
    setMentionedCharacters: mockSetMentionedCharacters,
    chatToolPreferences: {
      webSearch: false,
      thinking: false,
      task: false,
      subagent: false,
    },
    setChatToolPreferences: mockSetChatToolPreferences,
    serviceSkills: [],
    activeTheme: "general",
    mappedTheme: "general",
    isThemeWorkbench: false,
    contextWorkspace: {
      enabled: false,
      activeContextPrompt: "",
      prepareActiveContextPrompt: async () => "",
    },
    runtimeStyleMessagePrompt: "",
    projectId: "project-1",
    executionStrategy: "react",
    accessMode: "current",
    preferredTeamPresetId: null,
    selectedTeam: null,
    selectedTeamLabel: "",
    selectedTeamSummary: "",
    currentGateKey: "default_gate",
    themeWorkbenchActiveQueueTitle: undefined,
    contentId: null,
    workspaceRequestMetadataBase: undefined,
    messagesCount: 0,
    sendMessage: mockSendMessage,
    resolveSendBoundary: (({ sourceText }) => ({
      sourceText,
      browserRequirementMatch: null,
      shouldConsumePendingThemeWorkbenchInitialPrompt: false,
      shouldDismissThemeWorkbenchEntryPrompt: false,
    })) as HookProps["resolveSendBoundary"],
    maybeStartBrowserTaskPreflight: (() =>
      false) as HookProps["maybeStartBrowserTaskPreflight"],
    finalizeAfterSendSuccess:
      mockFinalizeAfterSendSuccess as HookProps["finalizeAfterSendSuccess"],
    rollbackAfterSendFailure:
      mockRollbackAfterSendFailure as HookProps["rollbackAfterSendFailure"],
    prepareRuntimeTeamBeforeSend:
      mockPrepareRuntimeTeamBeforeSend as HookProps["prepareRuntimeTeamBeforeSend"],
    setRuntimeTeamDispatchPreview:
      mockSetRuntimeTeamDispatchPreview as HookProps["setRuntimeTeamDispatchPreview"],
    ensureBrowserAssistCanvas:
      mockEnsureBrowserAssistCanvas as HookProps["ensureBrowserAssistCanvas"],
    handleAutoLaunchMatchedSiteSkill:
      mockHandleAutoLaunchMatchedSiteSkill as HookProps["handleAutoLaunchMatchedSiteSkill"],
    handleImageWorkbenchCommand:
      mockHandleImageWorkbenchCommand as HookProps["handleImageWorkbenchCommand"],
    ...initialProps,
  };

  function TestComponent() {
    hookValue = useWorkspaceSendActions(props);
    return null;
  }

  act(() => {
    root.render(<TestComponent />);
  });

  return {
    getValue: () => {
      if (!hookValue) {
        throw new Error("hook 尚未初始化");
      }
      return hookValue;
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("useWorkspaceSendActions", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;

    vi.clearAllMocks();
  });

  it("普通发送不应把当前工作区模型当成 modelOverride", async () => {
    const harness = mountHook();
    const autoContinue = {
      enabled: true,
      fast_mode_enabled: false,
      continuation_length: 3,
      sensitivity: 0.4,
    };

    try {
      await act(async () => {
        const started = await harness
          .getValue()
          .handleSend(
            [],
            false,
            false,
            "继续处理当前话题",
            "react",
            autoContinue,
          );
        expect(started).toBe(true);
      });

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      const args = mockSendMessage.mock.calls[0] as Parameters<
        HookProps["sendMessage"]
      >;
      expect(args?.[6]).toBeUndefined();
      expect(args?.[7]).toEqual(autoContinue);
      expect(args?.[8]).toMatchObject({
        requestMetadata: {
          harness: expect.objectContaining({
            theme: "general",
            session_mode: "default",
          }),
        },
      });
    } finally {
      harness.unmount();
    }
  });

  it("发送前如果准备出本地 team，应写入短生命周期 dispatch preview", async () => {
    mockPrepareRuntimeTeamBeforeSend.mockResolvedValueOnce(
      createPreparedRuntimeTeamState(),
    );
    const harness = mountHook({
      input: "请拆解这个复杂需求，并安排多人协作推进",
      chatToolPreferences: {
        webSearch: false,
        thinking: false,
        task: false,
        subagent: true,
      },
      messagesCount: 3,
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockSetRuntimeTeamDispatchPreview).toHaveBeenNthCalledWith(
        1,
        null,
      );
      expect(mockSetRuntimeTeamDispatchPreview).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          key: "runtime-team-preview-1",
          prompt: "请拆解这个复杂需求，并安排多人协作推进",
          baseMessageCount: 3,
          status: "formed",
          formationState: expect.objectContaining({
            requestId: "runtime-team-preview-1",
            label: "研究协作组",
          }),
        }),
      );
    } finally {
      harness.unmount();
    }
  });

  it("普通自然句命中站点 service skill 时应直接走自动启动链", async () => {
    const harness = mountHook({
      input: "请帮我使用 GitHub 查一下 AI Agent 项目",
      serviceSkills: [createGithubSiteSkill()],
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockHandleAutoLaunchMatchedSiteSkill).toHaveBeenCalledTimes(1);
      expect(mockHandleAutoLaunchMatchedSiteSkill).toHaveBeenCalledWith(
        expect.objectContaining({
          skill: expect.objectContaining({
            id: "github-repo-radar",
          }),
          slotValues: {
            repository_query: "AI Agent",
          },
          launchUserInput: undefined,
        }),
      );
      expect(mockSendMessage).not.toHaveBeenCalled();
    } finally {
      harness.unmount();
    }
  });

  it("已有活动上下文快照时不应等待正文加载后才发送", async () => {
    const slowPrepareActiveContextPrompt = vi
      .fn()
      .mockImplementation(
        () =>
          new Promise<string>((resolve) => {
            setTimeout(() => resolve("[生效上下文]\n1. [素材] 品牌手册"), 50);
          }),
      );
    const harness = mountHook({
      contextWorkspace: {
        enabled: true,
        activeContextPrompt: "[生效上下文]\n1. [素材] 品牌手册",
        prepareActiveContextPrompt: slowPrepareActiveContextPrompt,
      },
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      const args = mockSendMessage.mock.calls[0] as Parameters<
        HookProps["sendMessage"]
      >;
      expect(args?.[0]).toContain("[生效上下文]\n1. [素材] 品牌手册");
      expect(slowPrepareActiveContextPrompt).toHaveBeenCalledTimes(1);
    } finally {
      harness.unmount();
    }
  });

  it("应保留 workspace 级 request metadata，并与 harness 元数据合并", async () => {
    const harness = mountHook({
      isThemeWorkbench: true,
      mappedTheme: "social-media",
      contentId: "content-service-skill-1",
      workspaceRequestMetadataBase: {
        artifact: {
          artifact_mode: "draft",
          artifact_kind: "analysis",
        },
      },
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      const args = mockSendMessage.mock.calls[0] as Parameters<
        HookProps["sendMessage"]
      >;
      expect(args?.[8]).toMatchObject({
        requestMetadata: {
          artifact: {
            artifact_mode: "draft",
            artifact_kind: "analysis",
          },
          harness: expect.objectContaining({
            theme: "social-media",
            session_mode: "theme_workbench",
            content_id: "content-service-skill-1",
          }),
        },
      });
    } finally {
      harness.unmount();
    }
  });

  it("应把 accessMode 写入 harness request metadata", async () => {
    const harness = mountHook({
      accessMode: "full-access",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      const args = mockSendMessage.mock.calls[0] as Parameters<
        HookProps["sendMessage"]
      >;
      expect(args?.[8]).toMatchObject({
        requestMetadata: {
          harness: expect.objectContaining({
            access_mode: "full-access",
          }),
        },
      });
    } finally {
      harness.unmount();
    }
  });
});
