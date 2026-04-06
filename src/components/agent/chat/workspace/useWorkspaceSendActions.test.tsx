import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamMemorySnapshot } from "@/lib/teamMemorySync";
import type { ServiceSkillHomeItem } from "../service-skills/types";
import { useWorkspaceSendActions } from "./useWorkspaceSendActions";
import type { TeamWorkspaceRuntimeFormationState } from "../teamWorkspaceRuntime";

const mockPreheatBrowserAssistInBackground = vi.hoisted(() => vi.fn());
const mockGetSkillCatalog = vi.hoisted(() => vi.fn());
const mockListSkillCatalogSceneEntries = vi.hoisted(() => vi.fn());
const mockResolveOemCloudRuntimeContext = vi.hoisted(() => vi.fn());

vi.mock("../utils/browserAssistPreheat", () => ({
  preheatBrowserAssistInBackground: mockPreheatBrowserAssistInBackground,
}));

vi.mock("@/lib/api/skillCatalog", () => ({
  getSkillCatalog: () => mockGetSkillCatalog(),
  listSkillCatalogSceneEntries: (catalog: unknown) =>
    mockListSkillCatalogSceneEntries(catalog),
}));

vi.mock("@/lib/api/oemCloudRuntime", () => ({
  resolveOemCloudRuntimeContext: () => mockResolveOemCloudRuntimeContext(),
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
const mockEnsureSessionForCommandMetadata = vi.fn<
  NonNullable<HookProps["ensureSessionForCommandMetadata"]>
>(async () => null);
const mockResolveImageWorkbenchSkillRequest = vi.fn<
  HookProps["resolveImageWorkbenchSkillRequest"]
>(() => null);

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

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

function createCloudSceneSkill(): ServiceSkillHomeItem {
  return {
    id: "cloud-video-dubbing",
    skillKey: "campaign-launch",
    title: "云端视频配音",
    summary: "把视频文案与素材提交到云端，生成一版可继续加工的配音结果。",
    category: "视频创作",
    outputHint: "配音文案 + 结果摘要",
    source: "cloud_catalog",
    runnerType: "instant",
    defaultExecutorBinding: "cloud_scene",
    executionLocation: "cloud_required",
    version: "seed-v1",
    badge: "云目录",
    recentUsedAt: null,
    isRecent: false,
    runnerLabel: "云端托管执行",
    runnerTone: "slate",
    runnerDescription: "提交到 OEM 云端执行，结果由服务端异步返回。",
    actionLabel: "提交云端",
    automationStatus: null,
    slotSchema: [
      {
        key: "reference_video",
        label: "参考视频链接/素材",
        type: "url",
        required: true,
        placeholder: "输入视频链接",
      },
    ],
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

function createTeamMemoryShadowSnapshot(): TeamMemorySnapshot {
  return {
    repoScope: "/tmp/project-1",
    entries: {
      "team.selection": {
        key: "team.selection",
        content: "Team：前端联调团队",
        updatedAt: 1,
      },
      "team.subagents": {
        key: "team.subagents",
        content: "子代理：\n- 分析 [running] 负责定位问题",
        updatedAt: 2,
      },
    },
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
      shouldConsumePendingGeneralWorkbenchInitialPrompt: false,
      shouldDismissGeneralWorkbenchEntryPrompt: false,
    })) as HookProps["resolveSendBoundary"],
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
    ensureSessionForCommandMetadata:
      mockEnsureSessionForCommandMetadata as HookProps["ensureSessionForCommandMetadata"],
    resolveImageWorkbenchSkillRequest:
      mockResolveImageWorkbenchSkillRequest as HookProps["resolveImageWorkbenchSkillRequest"],
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
    mockResolveImageWorkbenchSkillRequest.mockReturnValue(null);
    mockEnsureSessionForCommandMetadata.mockResolvedValue(null);
    mockGetSkillCatalog.mockResolvedValue({ entries: [] });
    mockListSkillCatalogSceneEntries.mockReturnValue([]);
    mockResolveOemCloudRuntimeContext.mockReturnValue(null);
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

  it("发送准备阶段应立即暴露 submission preview，并在真实提交接管后清理", async () => {
    const deferredSend = createDeferred<void>();
    mockSendMessage.mockImplementationOnce(async () => deferredSend.promise);
    const harness = mountHook({
      input: "帮我找一下今天的新闻",
    });

    let sendPromise: Promise<boolean> | null = null;

    try {
      await act(async () => {
        sendPromise = harness.getValue().handleSend();
        await Promise.resolve();
      });

      expect(harness.getValue().submissionPreview).toMatchObject({
        prompt: "帮我找一下今天的新闻",
        runtimeStatus: expect.objectContaining({
          title: "正在启动处理流程",
        }),
      });

      await act(async () => {
        deferredSend.resolve();
        await sendPromise;
      });

      expect(harness.getValue().submissionPreview).toBeNull();
    } finally {
      harness.unmount();
    }
  });

  it("准备活动上下文较慢时，也应先展示 submission preview", async () => {
    const deferredContext = createDeferred<string>();
    const deferredSend = createDeferred<void>();
    mockSendMessage.mockImplementationOnce(async () => deferredSend.promise);
    const harness = mountHook({
      input: "帮我整理一下今天的重要新闻",
      contextWorkspace: {
        enabled: true,
        activeContextPrompt: "",
        prepareActiveContextPrompt: async () => deferredContext.promise,
      },
    });

    let sendPromise: Promise<boolean> | null = null;

    try {
      await act(async () => {
        sendPromise = harness.getValue().handleSend();
        await Promise.resolve();
      });

      expect(harness.getValue().submissionPreview).toMatchObject({
        prompt: "帮我整理一下今天的重要新闻",
        runtimeStatus: expect.objectContaining({
          title: "正在启动处理流程",
        }),
      });

      await act(async () => {
        deferredContext.resolve("[上下文]\n今天关注科技与国际新闻。");
        await Promise.resolve();
      });

      await act(async () => {
        deferredSend.resolve();
        await sendPromise;
      });

      expect(harness.getValue().submissionPreview).toBeNull();
    } finally {
      harness.unmount();
    }
  });

  it("首页首轮普通发送在等待上下文时应并行预热会话", async () => {
    const deferredContext = createDeferred<string>();
    const deferredSession = createDeferred<string | null>();
    const deferredSend = createDeferred<void>();
    mockEnsureSessionForCommandMetadata.mockImplementationOnce(
      async () => deferredSession.promise,
    );
    mockSendMessage.mockImplementationOnce(async () => deferredSend.promise);
    const harness = mountHook({
      input: "帮我整理一下今天的重要新闻",
      messagesCount: 0,
      contextWorkspace: {
        enabled: true,
        activeContextPrompt: "",
        prepareActiveContextPrompt: async () => deferredContext.promise,
      },
    });

    let sendPromise: Promise<boolean> | null = null;

    try {
      await act(async () => {
        sendPromise = harness.getValue().handleSend();
        await Promise.resolve();
      });

      expect(mockEnsureSessionForCommandMetadata).toHaveBeenCalledTimes(1);
      expect(mockSendMessage).not.toHaveBeenCalled();

      await act(async () => {
        deferredContext.resolve("[上下文]\n今天关注科技与国际新闻。");
        await Promise.resolve();
      });

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(
        mockEnsureSessionForCommandMetadata.mock.invocationCallOrder[0],
      ).toBeLessThan(mockSendMessage.mock.invocationCallOrder[0] ?? Infinity);

      await act(async () => {
        deferredSession.resolve("session-prewarmed");
        deferredSend.resolve();
        await sendPromise;
      });
    } finally {
      harness.unmount();
    }
  });

  it("发送准备阶段不应重复递交同一条首页消息", async () => {
    const deferredContext = createDeferred<string>();
    const deferredSend = createDeferred<void>();
    mockSendMessage.mockImplementationOnce(async () => deferredSend.promise);
    const harness = mountHook({
      input: "帮我生成一版首页插图方案",
      contextWorkspace: {
        enabled: true,
        activeContextPrompt: "",
        prepareActiveContextPrompt: async () => deferredContext.promise,
      },
    });

    let firstSendPromise: Promise<boolean> | null = null;
    let secondSendPromise: Promise<boolean> | null = null;

    try {
      await act(async () => {
        firstSendPromise = harness.getValue().handleSend();
        secondSendPromise = harness.getValue().handleSend();
        await Promise.resolve();
      });

      expect(harness.getValue().isPreparingSend).toBe(true);
      expect(await secondSendPromise).toBe(false);
      expect(mockSendMessage).not.toHaveBeenCalled();

      await act(async () => {
        deferredContext.resolve("");
        await Promise.resolve();
      });

      expect(mockSendMessage).toHaveBeenCalledTimes(1);

      await act(async () => {
        deferredSend.resolve();
        expect(await firstSendPromise).toBe(true);
      });

      expect(harness.getValue().isPreparingSend).toBe(false);
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

  it("纯文本 @配图 应保留原始消息，并通过 image_skill_launch metadata 交给 Agent", async () => {
    mockResolveImageWorkbenchSkillRequest.mockReturnValueOnce({
      images: [],
      requestContext: {
        kind: "image_task",
        image_task: {
          mode: "generate",
          prompt: "一张春日咖啡馆插画",
          count: 2,
          aspect_ratio: "16:9",
        },
      },
    });
    const harness = mountHook({
      input: "@配图 生成 一张春日咖啡馆插画，16:9，出 2 张",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockResolveImageWorkbenchSkillRequest).toHaveBeenCalledTimes(1);
      expect(mockResolveImageWorkbenchSkillRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          rawText: "@配图 生成 一张春日咖啡馆插画，16:9，出 2 张",
          parsedCommand: expect.objectContaining({
            trigger: "@配图",
            mode: "generate",
            prompt: "一张春日咖啡馆插画",
            aspectRatio: "16:9",
            count: 2,
          }),
          images: [],
          sessionIdOverride: undefined,
        }),
      );
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[0]).toBe(
        "@配图 生成 一张春日咖啡馆插画，16:9，出 2 张",
      );
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            allow_model_skills: true,
            image_skill_launch: {
              skill_name: "image_generate",
              kind: "image_task",
            },
          },
        },
      });
    } finally {
      harness.unmount();
    }
  });

  it("@配图 首次发送时应先绑定真实 session_id 到 image_task", async () => {
    mockEnsureSessionForCommandMetadata.mockResolvedValue("session-image-1");
    mockResolveImageWorkbenchSkillRequest.mockReturnValueOnce({
      images: [],
      requestContext: {
        kind: "image_task",
        image_task: {
          mode: "generate",
          prompt: "一张春日咖啡馆插画",
          session_id: "session-image-1",
        },
      },
    });
    const harness = mountHook({
      input: "@配图 生成 一张春日咖啡馆插画",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockEnsureSessionForCommandMetadata).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            image_skill_launch: {
              image_task: {
                session_id: "session-image-1",
              },
            },
          },
        },
      });
    } finally {
      harness.unmount();
    }
  });

  it("@配图 首次发送建会话较慢时，也应先展示 submission preview", async () => {
    const deferredSession = createDeferred<string | null>();
    const deferredSend = createDeferred<void>();
    mockEnsureSessionForCommandMetadata.mockImplementationOnce(
      async () => deferredSession.promise,
    );
    mockResolveImageWorkbenchSkillRequest.mockReturnValueOnce({
      images: [],
      requestContext: {
        kind: "image_task",
        image_task: {
          mode: "generate",
          prompt: "一张春日咖啡馆插画",
          session_id: "__local_image_workbench__:draft",
        },
      },
    });
    mockSendMessage.mockImplementationOnce(async () => deferredSend.promise);
    const harness = mountHook({
      input: "@配图 生成 一张春日咖啡馆插画",
    });

    let sendPromise: Promise<boolean> | null = null;

    try {
      await act(async () => {
        sendPromise = harness.getValue().handleSend();
        await Promise.resolve();
      });

      expect(harness.getValue().submissionPreview).toMatchObject({
        prompt: "@配图 生成 一张春日咖啡馆插画",
        runtimeStatus: expect.objectContaining({
          title: "正在启动处理流程",
        }),
      });
      expect(mockSendMessage).not.toHaveBeenCalled();

      await act(async () => {
        deferredSession.resolve("session-image-1");
        await Promise.resolve();
      });

      expect(mockEnsureSessionForCommandMetadata).toHaveBeenCalledTimes(1);
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            image_skill_launch: {
              image_task: {
                session_id: "session-image-1",
              },
            },
          },
        },
      });

      await act(async () => {
        deferredSend.resolve();
        await sendPromise;
      });

      expect(harness.getValue().submissionPreview).toBeNull();
    } finally {
      harness.unmount();
    }
  });

  it("@封面 应保留原始消息，并通过 cover_skill_launch metadata 交给 Agent 调度技能", async () => {
    const harness = mountHook({
      input:
        "@封面 小红书 标题: 春日咖啡快闪 风格: 清新插画, 1:1 春日咖啡市集封面",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockResolveImageWorkbenchSkillRequest).not.toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[0]).toBe(
        "@封面 小红书 标题: 春日咖啡快闪 风格: 清新插画, 1:1 春日咖啡市集封面",
      );
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            allow_model_skills: true,
            cover_skill_launch: {
              skill_name: "cover_generate",
              kind: "cover_task",
              cover_task: {
                prompt: "春日咖啡市集封面",
                title: "春日咖啡快闪",
                platform: "小红书",
                size: "1:1",
                style: "清新插画",
                entry_source: "at_cover_command",
              },
            },
          },
        },
      });
    } finally {
      harness.unmount();
    }
  });

  it("@封面 首次发送时应先绑定真实 session_id 到 cover_task", async () => {
    mockEnsureSessionForCommandMetadata.mockResolvedValue("session-cover-1");
    const harness = mountHook({
      input:
        "@封面 小红书 标题: 春日咖啡快闪 风格: 清新插画, 1:1 春日咖啡市集封面",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockEnsureSessionForCommandMetadata).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            cover_skill_launch: {
              cover_task: {
                session_id: "session-cover-1",
              },
            },
          },
        },
      });
    } finally {
      harness.unmount();
    }
  });

  it("带引用图的图片命令也应先交给 Agent，而不是直建任务", async () => {
    mockResolveImageWorkbenchSkillRequest.mockReturnValueOnce({
      images: [],
      requestContext: {
        kind: "image_task",
        image_task: {
          mode: "edit",
          prompt: "去掉角标，保留主体",
          target_output_ref_id: "img-2",
        },
      },
    });
    const harness = mountHook({
      input: "@配图 编辑 #img-2 去掉角标，保留主体",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockResolveImageWorkbenchSkillRequest).toHaveBeenCalledTimes(1);
      expect(mockResolveImageWorkbenchSkillRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          rawText: "@配图 编辑 #img-2 去掉角标，保留主体",
          parsedCommand: expect.objectContaining({
            trigger: "@配图",
            mode: "edit",
            targetRef: "img-2",
          }),
          images: [],
        }),
      );
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
    } finally {
      harness.unmount();
    }
  });

  it("@修图 应保留原始消息，并通过 image_skill_launch metadata 交给 Agent", async () => {
    mockResolveImageWorkbenchSkillRequest.mockReturnValueOnce({
      images: [],
      requestContext: {
        kind: "image_task",
        image_task: {
          mode: "edit",
          prompt: "去掉角标，保留主体",
          target_output_ref_id: "img-2",
        },
      },
    });
    const harness = mountHook({
      input: "@修图 #img-2 去掉角标，保留主体",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockResolveImageWorkbenchSkillRequest).toHaveBeenCalledTimes(1);
      expect(mockResolveImageWorkbenchSkillRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          rawText: "@修图 #img-2 去掉角标，保留主体",
          parsedCommand: expect.objectContaining({
            trigger: "@修图",
            mode: "edit",
            targetRef: "img-2",
          }),
          images: [],
        }),
      );
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
    } finally {
      harness.unmount();
    }
  });

  it("@重绘 应保留原始消息，并通过 image_skill_launch metadata 交给 Agent", async () => {
    mockResolveImageWorkbenchSkillRequest.mockReturnValueOnce({
      images: [],
      requestContext: {
        kind: "image_task",
        image_task: {
          mode: "variation",
          prompt: "更偏插画风，保留主视觉",
          target_output_ref_id: "img-2",
        },
      },
    });
    const harness = mountHook({
      input: "@重绘 #img-2 更偏插画风，保留主视觉",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockResolveImageWorkbenchSkillRequest).toHaveBeenCalledTimes(1);
      expect(mockResolveImageWorkbenchSkillRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          rawText: "@重绘 #img-2 更偏插画风，保留主视觉",
          parsedCommand: expect.objectContaining({
            trigger: "@重绘",
            mode: "variation",
            targetRef: "img-2",
          }),
          images: [],
        }),
      );
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
    } finally {
      harness.unmount();
    }
  });

  it("/image 仍应保留原始消息，并通过 image_skill_launch metadata 交给 Agent", async () => {
    mockResolveImageWorkbenchSkillRequest.mockReturnValueOnce({
      images: [],
      requestContext: {
        kind: "image_task",
        image_task: {
          mode: "generate",
          prompt: "春日咖啡馆插画",
        },
      },
    });
    const harness = mountHook({
      input: "/image 春日咖啡馆插画，16:9，出 2 张",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockResolveImageWorkbenchSkillRequest).toHaveBeenCalledTimes(1);
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[0]).toBe(
        "/image 春日咖啡馆插画，16:9，出 2 张",
      );
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            allow_model_skills: true,
            image_skill_launch: {
              skill_name: "image_generate",
              kind: "image_task",
            },
          },
        },
      });
    } finally {
      harness.unmount();
    }
  });

  it("预绑定 image_skill_launch metadata 时不应重新解析图片命令", async () => {
    const harness = mountHook({
      input: "@配图 生成 一张春日咖啡馆插画",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend(
          [],
          false,
          false,
          "@配图 生成 一张春日咖啡馆插画",
          undefined,
          undefined,
          {
            requestMetadata: {
              harness: {
                allow_model_skills: true,
                image_skill_launch: {
                  skill_name: "image_generate",
                  kind: "image_task",
                  image_task: {
                    prompt: "一张春日咖啡馆插画",
                  },
                },
              },
            },
          },
        );
        expect(started).toBe(true);
      });

      expect(mockResolveImageWorkbenchSkillRequest).not.toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            image_skill_launch: {
              skill_name: "image_generate",
            },
          },
        },
      });
    } finally {
      harness.unmount();
    }
  });

  it("@视频 应保留原始消息，并通过 video_skill_launch metadata 交给 Agent 调度技能", async () => {
    const harness = mountHook({
      input: "@视频 15秒 新品发布短视频，16:9，720p",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockResolveImageWorkbenchSkillRequest).not.toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[0]).toBe(
        "@视频 15秒 新品发布短视频，16:9，720p",
      );
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            allow_model_skills: true,
            video_skill_launch: {
              skill_name: "video_generate",
              kind: "video_task",
              video_task: {
                prompt: "新品发布短视频",
                duration: 15,
                aspect_ratio: "16:9",
                resolution: "720p",
                entry_source: "at_video_command",
              },
            },
          },
        },
      });
    } finally {
      harness.unmount();
    }
  });

  it("@视频 首次发送时应先绑定真实 session_id 到 video_task", async () => {
    mockEnsureSessionForCommandMetadata.mockResolvedValue("session-video-1");
    const harness = mountHook({
      input: "@视频 15秒 新品发布短视频，16:9，720p",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockEnsureSessionForCommandMetadata).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            video_skill_launch: {
              video_task: {
                session_id: "session-video-1",
              },
            },
          },
        },
      });
    } finally {
      harness.unmount();
    }
  });

  it("@播报 应保留原始消息，并通过 broadcast_skill_launch metadata 交给 Agent 调度技能", async () => {
    const harness = mountHook({
      input:
        "@播报 标题: 创始人周报 听众: AI 创业者 语气: 口语化 时长: 5分钟 把下面文章整理成播报文本",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockResolveImageWorkbenchSkillRequest).not.toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[0]).toBe(
        "@播报 标题: 创始人周报 听众: AI 创业者 语气: 口语化 时长: 5分钟 把下面文章整理成播报文本",
      );
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            allow_model_skills: true,
            broadcast_skill_launch: {
              skill_name: "broadcast_generate",
              kind: "broadcast_task",
              broadcast_task: {
                prompt: "把下面文章整理成播报文本",
                content: "把下面文章整理成播报文本",
                title: "创始人周报",
                audience: "AI 创业者",
                tone: "口语化",
                duration_hint_minutes: 5,
                entry_source: "at_broadcast_command",
              },
            },
          },
        },
      });
    } finally {
      harness.unmount();
    }
  });

  it("@播报 首次发送时应先绑定真实 session_id 到 broadcast_task", async () => {
    mockEnsureSessionForCommandMetadata.mockResolvedValue("session-broadcast-1");
    const harness = mountHook({
      input:
        "@播报 标题: 创始人周报 听众: AI 创业者 语气: 口语化 时长: 5分钟 把下面文章整理成播报文本",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockEnsureSessionForCommandMetadata).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            broadcast_skill_launch: {
              broadcast_task: {
                session_id: "session-broadcast-1",
              },
            },
          },
        },
      });
    } finally {
      harness.unmount();
    }
  });

  it("@素材 应保留原始消息，并通过 resource_search_skill_launch metadata 交给 Agent 调度技能", async () => {
    const harness = mountHook({
      input: "@素材 类型:图片 关键词:咖啡馆木桌背景 用途:公众号头图 数量:8",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockResolveImageWorkbenchSkillRequest).not.toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[0]).toBe(
        "@素材 类型:图片 关键词:咖啡馆木桌背景 用途:公众号头图 数量:8",
      );
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            allow_model_skills: true,
            resource_search_skill_launch: {
              skill_name: "modal_resource_search",
              kind: "resource_search_task",
              resource_search_task: {
                prompt: "咖啡馆木桌背景 公众号头图",
                resource_type: "image",
                query: "咖啡馆木桌背景",
                usage: "公众号头图",
                count: 8,
                entry_source: "at_resource_search_command",
              },
            },
          },
        },
      });
    } finally {
      harness.unmount();
    }
  });

  it("@素材 首次发送时应先绑定真实 session_id 到 resource_search_task", async () => {
    mockEnsureSessionForCommandMetadata.mockResolvedValue("session-resource-1");
    const harness = mountHook({
      input: "@素材 类型:图片 关键词:咖啡馆木桌背景 用途:公众号头图 数量:8",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockEnsureSessionForCommandMetadata).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            resource_search_skill_launch: {
              resource_search_task: {
                session_id: "session-resource-1",
              },
            },
          },
        },
      });
    } finally {
      harness.unmount();
    }
  });

  it("@搜索 应保留原始消息，并通过 research_skill_launch metadata 交给 Agent 调度技能", async () => {
    const harness = mountHook({
      input:
        "@搜索 关键词:AI Agent 融资 站点:36Kr 时间:近30天 深度:深度 重点:融资额与产品发布 输出:要点",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockResolveImageWorkbenchSkillRequest).not.toHaveBeenCalled();
      expect(mockEnsureSessionForCommandMetadata).not.toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[0]).toBe(
        "@搜索 关键词:AI Agent 融资 站点:36Kr 时间:近30天 深度:深度 重点:融资额与产品发布 输出:要点",
      );
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            allow_model_skills: true,
            research_skill_launch: {
              skill_name: "research",
              kind: "research_request",
              research_request: {
                prompt: "AI Agent 融资 36Kr 近30天 融资额与产品发布",
                query: "AI Agent 融资",
                site: "36Kr",
                time_range: "近30天",
                depth: "deep",
                focus: "融资额与产品发布",
                output_format: "要点",
                entry_source: "at_search_command",
              },
            },
          },
        },
      });
    } finally {
      harness.unmount();
    }
  });

  it("@深搜 应保留原始消息，并通过 deep_search_skill_launch metadata 交给 Agent 调度 research 技能", async () => {
    const harness = mountHook({
      input:
        "@深搜 关键词:AI Agent 融资 站点:36Kr 时间:近30天 重点:融资额与产品发布 输出:对比表",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockResolveImageWorkbenchSkillRequest).not.toHaveBeenCalled();
      expect(mockEnsureSessionForCommandMetadata).not.toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[0]).toBe(
        "@深搜 关键词:AI Agent 融资 站点:36Kr 时间:近30天 重点:融资额与产品发布 输出:对比表",
      );
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            allow_model_skills: true,
            deep_search_skill_launch: {
              skill_name: "research",
              kind: "deep_search_request",
              deep_search_request: {
                prompt: "AI Agent 融资 36Kr 近30天 融资额与产品发布",
                query: "AI Agent 融资",
                site: "36Kr",
                time_range: "近30天",
                depth: "deep",
                focus: "融资额与产品发布",
                output_format: "对比表",
                entry_source: "at_deep_search_command",
              },
            },
          },
        },
      });
    } finally {
      harness.unmount();
    }
  });

  it("@研报 应保留原始消息，并通过 report_skill_launch metadata 交给 Agent 调度 report_generate 技能", async () => {
    const harness = mountHook({
      input:
        "@研报 关键词:AI Agent 融资 站点:36Kr 时间:近30天 重点:融资额与代表产品 输出:投资人研报",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockResolveImageWorkbenchSkillRequest).not.toHaveBeenCalled();
      expect(mockEnsureSessionForCommandMetadata).not.toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[0]).toBe(
        "@研报 关键词:AI Agent 融资 站点:36Kr 时间:近30天 重点:融资额与代表产品 输出:投资人研报",
      );
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            allow_model_skills: true,
            report_skill_launch: {
              skill_name: "report_generate",
              kind: "report_request",
              report_request: {
                prompt: "AI Agent 融资 36Kr 近30天 融资额与代表产品 投资人研报",
                query: "AI Agent 融资",
                site: "36Kr",
                time_range: "近30天",
                depth: "deep",
                focus: "融资额与代表产品",
                output_format: "投资人研报",
                entry_source: "at_report_command",
              },
            },
          },
        },
      });
    } finally {
      harness.unmount();
    }
  });

  it("@站点搜索 应保留原始消息，并通过 site_search_skill_launch metadata 交给 Agent 调度技能", async () => {
    const harness = mountHook({
      input: "@站点搜索 站点:GitHub 关键词:openai agents sdk issue 数量:8",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockResolveImageWorkbenchSkillRequest).not.toHaveBeenCalled();
      expect(mockEnsureSessionForCommandMetadata).not.toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[0]).toBe(
        "@站点搜索 站点:GitHub 关键词:openai agents sdk issue 数量:8",
      );
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            allow_model_skills: true,
            site_search_skill_launch: {
              skill_name: "site_search",
              kind: "site_search_request",
              site_search_request: {
                prompt: "openai agents sdk issue",
                site: "GitHub",
                query: "openai agents sdk issue",
                limit: 8,
                entry_source: "at_site_search_command",
              },
            },
          },
        },
      });
    } finally {
      harness.unmount();
    }
  });

  it("@读PDF 应保留原始消息，并通过 pdf_read_skill_launch metadata 交给 Agent 调度技能", async () => {
    const harness = mountHook({
      input: '@读PDF "/tmp/agent-report.pdf" 提炼三点结论 输出:投资人摘要',
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[0]).toBe(
        '@读PDF "/tmp/agent-report.pdf" 提炼三点结论 输出:投资人摘要',
      );
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            allow_model_skills: true,
            pdf_read_skill_launch: {
              skill_name: "pdf_read",
              kind: "pdf_read_request",
              pdf_read_request: {
                prompt: "提炼三点结论",
                source_path: "/tmp/agent-report.pdf",
                output_format: "投资人摘要",
                entry_source: "at_pdf_read_command",
              },
            },
          },
        },
      });
    } finally {
      harness.unmount();
    }
  });

  it("@总结 应保留原始消息，并通过 summary_skill_launch metadata 交给 Agent 调度技能", async () => {
    const harness = mountHook({
      input:
        "@总结 内容:这是一篇关于 AI Agent 融资的长文 重点:融资额与发布时间 长度:简短 风格:投资人简报 输出:三点要点",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockResolveImageWorkbenchSkillRequest).not.toHaveBeenCalled();
      expect(mockEnsureSessionForCommandMetadata).not.toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[0]).toBe(
        "@总结 内容:这是一篇关于 AI Agent 融资的长文 重点:融资额与发布时间 长度:简短 风格:投资人简报 输出:三点要点",
      );
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            allow_model_skills: true,
            summary_skill_launch: {
              skill_name: "summary",
              kind: "summary_request",
              summary_request: {
                prompt:
                  "这是一篇关于 AI Agent 融资的长文 融资额与发布时间 short 投资人简报",
                content: "这是一篇关于 AI Agent 融资的长文",
                focus: "融资额与发布时间",
                length: "short",
                style: "投资人简报",
                output_format: "三点要点",
                entry_source: "at_summary_command",
              },
            },
          },
        },
      });
    } finally {
      harness.unmount();
    }
  });

  it("@翻译 应保留原始消息，并通过 translation_skill_launch metadata 交给 Agent 调度技能", async () => {
    const harness = mountHook({
      input:
        "@翻译 内容:hello world 原语言:英语 目标语言:中文 风格:产品文案 输出:只输出译文",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockResolveImageWorkbenchSkillRequest).not.toHaveBeenCalled();
      expect(mockEnsureSessionForCommandMetadata).not.toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[0]).toBe(
        "@翻译 内容:hello world 原语言:英语 目标语言:中文 风格:产品文案 输出:只输出译文",
      );
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            allow_model_skills: true,
            translation_skill_launch: {
              skill_name: "translation",
              kind: "translation_request",
              translation_request: {
                prompt: "hello world 从英语 译为中文 产品文案 只输出译文",
                content: "hello world",
                source_language: "英语",
                target_language: "中文",
                style: "产品文案",
                output_format: "只输出译文",
                entry_source: "at_translation_command",
              },
            },
          },
        },
      });
    } finally {
      harness.unmount();
    }
  });

  it("@分析 应保留原始消息，并通过 analysis_skill_launch metadata 交给 Agent 调度技能", async () => {
    const harness = mountHook({
      input:
        "@分析 内容:OpenAI 发布新模型 重点:商业影响 风格:投资备忘 输出:三点判断",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockResolveImageWorkbenchSkillRequest).not.toHaveBeenCalled();
      expect(mockEnsureSessionForCommandMetadata).not.toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[0]).toBe(
        "@分析 内容:OpenAI 发布新模型 重点:商业影响 风格:投资备忘 输出:三点判断",
      );
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            allow_model_skills: true,
            analysis_skill_launch: {
              skill_name: "analysis",
              kind: "analysis_request",
              analysis_request: {
                prompt: "OpenAI 发布新模型 围绕商业影响 投资备忘 三点判断",
                content: "OpenAI 发布新模型",
                focus: "商业影响",
                style: "投资备忘",
                output_format: "三点判断",
                entry_source: "at_analysis_command",
              },
            },
          },
        },
      });
    } finally {
      harness.unmount();
    }
  });

  it("@转写 应保留原始消息，并通过 transcription_skill_launch metadata 交给 Agent 调度技能", async () => {
    const harness = mountHook({
      input:
        "@转写 https://example.com/interview.mp4 生成逐字稿 导出 srt 带时间戳 区分说话人",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockResolveImageWorkbenchSkillRequest).not.toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[0]).toBe(
        "@转写 https://example.com/interview.mp4 生成逐字稿 导出 srt 带时间戳 区分说话人",
      );
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            allow_model_skills: true,
            transcription_skill_launch: {
              skill_name: "transcription_generate",
              kind: "transcription_task",
              transcription_task: {
                prompt: "逐字稿",
                source_url: "https://example.com/interview.mp4",
                output_format: "srt",
                timestamps: true,
                speaker_labels: true,
                entry_source: "at_transcription_command",
              },
            },
          },
        },
      });
    } finally {
      harness.unmount();
    }
  });

  it("@转写 首次发送时应先绑定真实 session_id 到 transcription_task", async () => {
    mockEnsureSessionForCommandMetadata.mockResolvedValue(
      "session-transcription-1",
    );
    const harness = mountHook({
      input:
        "@转写 https://example.com/interview.mp4 生成逐字稿 导出 srt 带时间戳 区分说话人",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockEnsureSessionForCommandMetadata).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            transcription_skill_launch: {
              transcription_task: {
                session_id: "session-transcription-1",
              },
            },
          },
        },
      });
    } finally {
      harness.unmount();
    }
  });

  it("@链接解析 应保留原始消息，并通过 url_parse_skill_launch metadata 交给 Agent 调度技能", async () => {
    const harness = mountHook({
      input:
        "@链接解析 https://example.com/agent 提取要点 并整理成投资人可读摘要",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockResolveImageWorkbenchSkillRequest).not.toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[0]).toBe(
        "@链接解析 https://example.com/agent 提取要点 并整理成投资人可读摘要",
      );
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            allow_model_skills: true,
            url_parse_skill_launch: {
              skill_name: "url_parse",
              kind: "url_parse_task",
              url_parse_task: {
                url: "https://example.com/agent",
                extract_goal: "key_points",
                prompt: "并整理成投资人可读摘要",
                entry_source: "at_url_parse_command",
              },
            },
          },
        },
      });
    } finally {
      harness.unmount();
    }
  });

  it("@链接解析 首次发送时应先绑定真实 session_id 到 url_parse_task", async () => {
    mockEnsureSessionForCommandMetadata.mockResolvedValue("session-url-parse-1");
    const harness = mountHook({
      input: "@链接解析 https://example.com/agent 提取要点 并整理成投资人可读摘要",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockEnsureSessionForCommandMetadata).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            url_parse_skill_launch: {
              url_parse_task: {
                session_id: "session-url-parse-1",
              },
            },
          },
        },
      });
    } finally {
      harness.unmount();
    }
  });

  it("@排版 应保留原始消息，并通过 typesetting_skill_launch metadata 交给 Agent 调度技能", async () => {
    const harness = mountHook({
      input: "@排版 平台:小红书 帮我把下面文案整理成短句节奏",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockResolveImageWorkbenchSkillRequest).not.toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[0]).toBe(
        "@排版 平台:小红书 帮我把下面文案整理成短句节奏",
      );
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            allow_model_skills: true,
            typesetting_skill_launch: {
              skill_name: "typesetting",
              kind: "typesetting_task",
              typesetting_task: {
                prompt: "帮我把下面文案整理成短句节奏",
                content: "平台:小红书 帮我把下面文案整理成短句节奏",
                target_platform: "小红书",
                entry_source: "at_typesetting_command",
              },
            },
          },
        },
      });
    } finally {
      harness.unmount();
    }
  });

  it("@排版 首次发送时应先绑定真实 session_id 到 typesetting_task", async () => {
    mockEnsureSessionForCommandMetadata.mockResolvedValue("session-typesetting-1");
    const harness = mountHook({
      input: "@排版 平台:公众号 帮我整理成更适合阅读的段落节奏",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockEnsureSessionForCommandMetadata).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            typesetting_skill_launch: {
              typesetting_task: {
                session_id: "session-typesetting-1",
              },
            },
          },
        },
      });
    } finally {
      harness.unmount();
    }
  });

  it("/scene-key 命中运行时场景时应注入统一 scene launch metadata 后继续走 Agent 发送主线", async () => {
    mockGetSkillCatalog.mockResolvedValueOnce({
      entries: [
        {
          id: "scene:campaign-launch",
        },
      ],
    });
    mockListSkillCatalogSceneEntries.mockReturnValueOnce([
      {
        id: "scene:campaign-launch",
        kind: "scene",
        title: "活动启动场景",
        summary: "围绕活动目标生成启动方案。",
        sceneKey: "campaign-launch",
        commandPrefix: "/campaign-launch",
        linkedSkillId: "cloud-video-dubbing",
        executionKind: "cloud_scene",
      },
    ]);
    mockResolveOemCloudRuntimeContext.mockReturnValueOnce({
      baseUrl: "https://user.150404.xyz",
      controlPlaneBaseUrl: "https://user.150404.xyz/api",
      sceneBaseUrl: "https://user.150404.xyz/scene-api",
      gatewayBaseUrl: "https://user.150404.xyz/gateway-api",
      tenantId: "tenant-demo",
      sessionToken: "session-token-demo",
      hubProviderName: null,
      loginPath: "/login",
      desktopClientId: "desktop-client",
      desktopOauthRedirectUrl: "lime://oauth/callback",
      desktopOauthNextPath: "/welcome",
    });
    const harness = mountHook({
      input: "/campaign-launch 帮我做一版新品活动启动方案",
      serviceSkills: [createCloudSceneSkill()],
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[0]).toBe(
        "/campaign-launch 帮我做一版新品活动启动方案",
      );
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            service_scene_launch: {
              kind: "cloud_scene",
              service_scene_run: expect.objectContaining({
                scene_key: "campaign-launch",
                skill_id: "cloud-video-dubbing",
                skill_title: "云端视频配音",
                user_input: "帮我做一版新品活动启动方案",
                project_id: "project-1",
                oem_runtime: expect.objectContaining({
                  scene_base_url: "https://user.150404.xyz/scene-api",
                  tenant_id: "tenant-demo",
                }),
              }),
            },
          },
        },
      });
      expect(mockHandleAutoLaunchMatchedSiteSkill).not.toHaveBeenCalled();
    } finally {
      harness.unmount();
    }
  });

  it("已携带 service_skill_launch metadata 时不应再被前端二次命中站点技能或浏览器预热", async () => {
    const harness = mountHook({
      input: "请帮我使用 GitHub 查一下 AI Agent 项目",
      serviceSkills: [createGithubSiteSkill()],
      browserAssistProfileKey: "attached-github",
      browserAssistPreferredBackend: "lime_extension_bridge",
      browserAssistAutoLaunch: false,
      resolveSendBoundary: (({ sourceText }) => ({
        sourceText,
        browserRequirementMatch: {
          requirement: "required",
          reason: "当前任务需要真实浏览器页面",
          launchUrl: "https://github.com",
          platformLabel: "GitHub",
        },
        shouldConsumePendingGeneralWorkbenchInitialPrompt: false,
        shouldDismissGeneralWorkbenchEntryPrompt: false,
      })) as HookProps["resolveSendBoundary"],
    });

    try {
      await act(async () => {
        const started = await harness
          .getValue()
          .handleSend([], false, false, undefined, undefined, undefined, {
            requestMetadata: {
              harness: {
                service_skill_launch: {
                  adapter_name: "github/search",
                  args: {
                    query: "AI Agent",
                  },
                },
                browser_assist: {
                  enabled: true,
                  profile_key: "attached-github",
                  preferred_backend: "lime_extension_bridge",
                  auto_launch: false,
                },
              },
            },
          });
        expect(started).toBe(true);
      });

      expect(mockHandleAutoLaunchMatchedSiteSkill).not.toHaveBeenCalled();
      expect(mockPreheatBrowserAssistInBackground).not.toHaveBeenCalled();
      expect(mockEnsureBrowserAssistCanvas).not.toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      const args = mockSendMessage.mock.calls[0] as Parameters<
        HookProps["sendMessage"]
      >;
      expect(args?.[0]).toBe("请帮我使用 GitHub 查一下 AI Agent 项目");
      expect(args?.[8]).toMatchObject({
        requestMetadata: {
          harness: expect.objectContaining({
            service_skill_launch: expect.objectContaining({
              adapter_name: "github/search",
            }),
            browser_assist: expect.objectContaining({
              profile_key: "attached-github",
              preferred_backend: "lime_extension_bridge",
              auto_launch: false,
            }),
          }),
        },
      });
    } finally {
      harness.unmount();
    }
  });

  it("已有活动上下文快照时不应等待正文加载后才发送", async () => {
    const slowPrepareActiveContextPrompt = vi.fn().mockImplementation(
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
      mappedTheme: "general",
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
            theme: "general",
            session_mode: "general_workbench",
            content_id: "content-service-skill-1",
          }),
        },
      });
    } finally {
      harness.unmount();
    }
  });

  it("当前 selectedTeam 还未 hydrate 时应保留 base request metadata 里的 Team 字段", async () => {
    const harness = mountHook({
      workspaceRequestMetadataBase: {
        harness: {
          selected_team_id: "home-shell-custom-team",
          selected_team_source: "custom",
          selected_team_label: "首页协作团队",
          selected_team_description: "负责首页入口阶段的调研、执行与验证。",
          selected_team_summary: "研究负责调研与线索整理。",
          selected_team_roles: [
            {
              id: "researcher",
              label: "研究",
              summary: "负责调研与线索整理。",
            },
          ],
        },
      },
      selectedTeam: null,
      selectedTeamLabel: "",
      selectedTeamSummary: "",
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
            selected_team_id: "home-shell-custom-team",
            selected_team_source: "custom",
            selected_team_label: "首页协作团队",
            selected_team_summary: "研究负责调研与线索整理。",
          }),
        },
      });
    } finally {
      harness.unmount();
    }
  });

  it("应把 repo-scoped team memory shadow 写入 request metadata", async () => {
    const harness = mountHook({
      teamMemoryShadowSnapshot: createTeamMemoryShadowSnapshot(),
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
          harness: {
            team_memory_shadow: {
              repo_scope: "/tmp/project-1",
              entries: [
                {
                  key: "team.selection",
                  content: "Team：前端联调团队",
                  updated_at: 1,
                },
                {
                  key: "team.subagents",
                  content: "子代理：\n- 分析 [running] 负责定位问题",
                  updated_at: 2,
                },
              ],
            },
          },
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
