import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamMemorySnapshot } from "@/lib/teamMemorySync";
import type { ServiceSkillHomeItem } from "../service-skills/types";
import type { Message } from "../types";
import type { InitialDispatchPreviewSnapshot } from "./workspaceSendHelpers";
import {
  listMentionEntryUsage,
  recordMentionEntryUsage,
} from "../skill-selection/mentionEntryUsage";
import { listServiceSkillUsage } from "../service-skills/storage";
import { useWorkspaceSendActions } from "./useWorkspaceSendActions";
import type { TeamWorkspaceRuntimeFormationState } from "../teamWorkspaceRuntime";
import { listSlashEntryUsage } from "../skill-selection/slashEntryUsage";
import { saveSkillCatalog } from "@/lib/api/skillCatalog";

const mockPreheatBrowserAssistInBackground = vi.hoisted(() => vi.fn());
const mockGetSkillCatalog = vi.hoisted(() => vi.fn());
const mockListSkillCatalogSceneEntries = vi.hoisted(() => vi.fn());
const mockGetOrCreateDefaultProject = vi.hoisted(() => vi.fn());
const mockResolveOemCloudRuntimeContext = vi.hoisted(() => vi.fn());

vi.mock("../utils/browserAssistPreheat", () => ({
  preheatBrowserAssistInBackground: mockPreheatBrowserAssistInBackground,
}));

vi.mock("@/lib/api/skillCatalog", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/skillCatalog")>(
    "@/lib/api/skillCatalog",
  );

  return {
    ...actual,
    getSkillCatalog: () => mockGetSkillCatalog(),
    listSkillCatalogSceneEntries: (catalog: unknown) =>
      mockListSkillCatalogSceneEntries(catalog),
  };
});

vi.mock("@/lib/api/oemCloudRuntime", () => ({
  resolveOemCloudRuntimeContext: () => mockResolveOemCloudRuntimeContext(),
}));

vi.mock("@/lib/api/project", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/api/project")>(
      "@/lib/api/project",
    );

  return {
    ...actual,
    getOrCreateDefaultProject: () => mockGetOrCreateDefaultProject(),
  };
});

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
const mockEnsureBrowserAssistCanvas = vi.fn(async () => true);
const mockHandleAutoLaunchMatchedSiteSkill = vi.fn(async () => undefined);
const mockOpenRuntimeSceneGate = vi.fn(async () => undefined);
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
    title: "视频配音",
    summary: "围绕视频文案与素材整理一版可继续加工的配音稿。",
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
    runnerLabel: "立即开始",
    runnerTone: "slate",
    runnerDescription: "直接在当前工作区整理首版配音稿。",
    actionLabel: "对话内补参",
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

function createXArticleExportSkill(): ServiceSkillHomeItem {
  return {
    id: "x-article-export",
    skillKey: "x-article-export",
    title: "X 文章转存",
    summary: "复用 X 登录态把长文导出成 Markdown 和图片目录。",
    category: "站点采集",
    outputHint: "Markdown 正文 + 图片目录",
    source: "local_custom",
    runnerType: "instant",
    defaultExecutorBinding: "browser_assist",
    executionLocation: "client_default",
    version: "seed-v1",
    badge: "本地技能",
    recentUsedAt: null,
    isRecent: false,
    runnerLabel: "浏览器站点执行",
    runnerTone: "emerald",
    runnerDescription: "直接复用浏览器登录态执行。",
    actionLabel: "启动采集",
    automationStatus: null,
    slotSchema: [
      {
        key: "article_url",
        label: "X 文章链接",
        type: "url",
        required: true,
        placeholder: "https://x.com/<账号>/article/<文章ID>",
        helpText: "支持 x.com 和 twitter.com 的 Article 链接。",
      },
      {
        key: "target_language",
        label: "目标语言",
        type: "text",
        required: false,
        defaultValue: "中文",
        placeholder: "例如 中文、英文、日文",
        helpText: "仅翻译正文，代码块、链接和图片路径保持原样。",
      },
    ],
    readinessRequirements: {
      requiresBrowser: true,
      requiresProject: true,
    },
    siteCapabilityBinding: {
      adapterName: "x/article-export",
      autoRun: true,
      requireAttachedSession: true,
      saveMode: "project_resource",
      slotArgMap: {
        article_url: "url",
        target_language: "target_language",
      },
    },
    sceneBinding: {
      sceneKey: "x-article-export",
      commandPrefix: "/x文章转存",
      title: "X文章转存",
      summary: "把 X 长文导出成 Markdown。",
      aliases: ["x文章转存", "x转存"],
    },
  };
}

function createGeneralServiceSkill(
  overrides: Partial<ServiceSkillHomeItem> = {},
): ServiceSkillHomeItem {
  return {
    id: "research",
    title: "搜索",
    summary: "针对当前主题执行联网检索与轻量调研。",
    category: "通用技能",
    outputHint: "结论 + 来源",
    source: "cloud_catalog",
    runnerType: "instant",
    defaultExecutorBinding: "agent_turn",
    executionLocation: "client_default",
    version: "seed-v1",
    badge: "云目录",
    recentUsedAt: null,
    isRecent: false,
    runnerLabel: "Agent 调度",
    runnerTone: "slate",
    runnerDescription: "通过统一 Agent 发送链执行。",
    actionLabel: "立即启动",
    automationStatus: null,
    slotSchema: [],
    ...overrides,
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

function createExistingMessages(count: number): Message[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `message-${index + 1}`,
    role: index % 2 === 0 ? "user" : "assistant",
    content: `历史消息 ${index + 1}`,
    timestamp: new Date(1_710_000_000_000 + index),
  }));
}

function createBootstrapDispatchSnapshot(
  prompt = "请开始处理这个任务",
): InitialDispatchPreviewSnapshot {
  return {
    key: "bootstrap-dispatch-1",
    prompt,
    images: [],
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
    sessionId: "session-1",
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
    messages: [],
    bootstrapDispatchPreview: null,
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
    ensureBrowserAssistCanvas:
      mockEnsureBrowserAssistCanvas as HookProps["ensureBrowserAssistCanvas"],
    handleAutoLaunchMatchedSiteSkill:
      mockHandleAutoLaunchMatchedSiteSkill as HookProps["handleAutoLaunchMatchedSiteSkill"],
    openRuntimeSceneGate:
      mockOpenRuntimeSceneGate as HookProps["openRuntimeSceneGate"],
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
    window.localStorage.clear();
    mockResolveImageWorkbenchSkillRequest.mockReturnValue(null);
    mockEnsureSessionForCommandMetadata.mockResolvedValue(null);
    mockGetSkillCatalog.mockResolvedValue({ entries: [] });
    mockListSkillCatalogSceneEntries.mockReturnValue([]);
    mockGetOrCreateDefaultProject.mockResolvedValue({
      id: "project-default",
    });
    mockResolveOemCloudRuntimeContext.mockReturnValue(null);
    mockOpenRuntimeSceneGate.mockResolvedValue(undefined);
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

  it("无真实消息时应透传 bootstrap 预览消息", () => {
    const harness = mountHook({
      bootstrapDispatchPreview: createBootstrapDispatchSnapshot(),
    });

    try {
      expect(harness.getValue().displayMessages).toHaveLength(2);
      expect(harness.getValue().displayMessages[0]).toMatchObject({
        role: "user",
        content: "请开始处理这个任务",
      });
      expect(harness.getValue().displayMessages[1]).toMatchObject({
        role: "assistant",
        content: "正在开始处理任务…",
        isThinking: true,
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
      messages: createExistingMessages(3),
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(harness.getValue().teamDispatchPreviewState).toMatchObject({
        requestId: "runtime-team-preview-1",
        status: "formed",
        label: "研究协作组",
      });
      expect(harness.getValue().displayMessages).toHaveLength(5);
      expect(harness.getValue().displayMessages[3]).toMatchObject({
        role: "user",
        content: "请拆解这个复杂需求，并安排多人协作推进",
      });
      expect(harness.getValue().displayMessages[4]).toMatchObject({
        role: "assistant",
        runtimeStatus: expect.objectContaining({
          title: "任务分工已准备好",
        }),
      });
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

      expect(harness.getValue().displayMessages).toHaveLength(2);
      expect(harness.getValue().displayMessages[0]).toMatchObject({
        role: "user",
        content: "帮我找一下今天的新闻",
      });
      expect(harness.getValue().displayMessages[1]).toMatchObject({
        role: "assistant",
        runtimeStatus: expect.objectContaining({
          title: "正在启动处理流程",
        }),
      });

      await act(async () => {
        deferredSend.resolve();
        await sendPromise;
      });

      expect(harness.getValue().displayMessages).toEqual([]);
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

      expect(harness.getValue().displayMessages).toHaveLength(2);
      expect(harness.getValue().displayMessages[0]).toMatchObject({
        role: "user",
        content: "帮我整理一下今天的重要新闻",
      });
      expect(harness.getValue().displayMessages[1]).toMatchObject({
        role: "assistant",
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

      expect(harness.getValue().displayMessages).toEqual([]);
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
      expect(listMentionEntryUsage()).toEqual([
        expect.objectContaining({
          kind: "builtin_command",
          entryId: "image_generate",
          replayText: "16:9 一张春日咖啡馆插画 出 2 张",
        }),
      ]);
    } finally {
      harness.unmount();
    }
  });

  it("@海报 应保留原始消息，并复用 image_skill_launch 主链生成海报任务", async () => {
    mockResolveImageWorkbenchSkillRequest.mockReturnValueOnce({
      images: [],
      requestContext: {
        kind: "image_task",
        image_task: {
          mode: "generate",
          prompt: "适用于小红书，清新拼贴风格，海报设计，春日咖啡市集活动海报",
          count: 1,
          size: "864x1152",
          aspect_ratio: "4:5",
          entry_source: "at_poster_command",
        },
      },
    });
    const harness = mountHook({
      input: "@海报 小红书 风格: 清新拼贴 春日咖啡市集活动海报",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockResolveImageWorkbenchSkillRequest).toHaveBeenCalledTimes(1);
      expect(mockResolveImageWorkbenchSkillRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          rawText: "@海报 小红书 风格: 清新拼贴 春日咖啡市集活动海报",
          parsedCommand: expect.objectContaining({
            trigger: "@配图",
            mode: "generate",
            prompt:
              "适用于小红书，清新拼贴风格，海报设计，春日咖啡市集活动海报",
            aspectRatio: "4:5",
            size: "864x1152",
            count: 1,
          }),
          entrySource: "at_poster_command",
          images: [],
          sessionIdOverride: undefined,
        }),
      );
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[0]).toBe(
        "@海报 小红书 风格: 清新拼贴 春日咖啡市集活动海报",
      );
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            allow_model_skills: true,
            image_skill_launch: {
              skill_name: "image_generate",
              kind: "image_task",
              image_task: {
                entry_source: "at_poster_command",
                size: "864x1152",
                aspect_ratio: "4:5",
              },
            },
          },
        },
      });
      expect(listMentionEntryUsage()).toEqual([
        expect.objectContaining({
          kind: "builtin_command",
          entryId: "poster_generate",
          replayText: "平台:小红书 风格:清新拼贴 春日咖啡市集活动海报",
        }),
      ]);
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

      expect(harness.getValue().displayMessages).toHaveLength(2);
      expect(harness.getValue().displayMessages[0]).toMatchObject({
        role: "user",
        content: "@配图 生成 一张春日咖啡馆插画",
      });
      expect(harness.getValue().displayMessages[1]).toMatchObject({
        role: "assistant",
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

      expect(harness.getValue().displayMessages).toEqual([]);
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
      expect(listMentionEntryUsage()).toEqual([
        expect.objectContaining({
          kind: "builtin_command",
          entryId: "cover_generate",
          replayText:
            "平台:小红书 标题:春日咖啡快闪 风格:清新插画 1:1 春日咖啡市集封面",
        }),
      ]);
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

  it("预绑定 image_skill_launch metadata 时不应重新解析图片命令，并且仍会绑定真实 session_id", async () => {
    mockEnsureSessionForCommandMetadata.mockResolvedValue(
      "session-image-bound",
    );
    const harness = mountHook({
      input: "@配图 生成 一张春日咖啡馆插画",
    });

    try {
      await act(async () => {
        const started = await harness
          .getValue()
          .handleSend(
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
                      session_id: "__local_image_workbench__:draft",
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
      expect(mockEnsureSessionForCommandMetadata).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            image_skill_launch: {
              skill_name: "image_generate",
              image_task: {
                session_id: "session-image-bound",
              },
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
      expect(listMentionEntryUsage()).toEqual([
        expect.objectContaining({
          kind: "builtin_command",
          entryId: "video_generate",
          replayText: "15秒 16:9 720p 新品发布短视频",
        }),
      ]);
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
      expect(listMentionEntryUsage()).toEqual([
        expect.objectContaining({
          kind: "builtin_command",
          entryId: "broadcast_generate",
          replayText:
            "标题:创始人周报 听众:AI 创业者 语气:口语化 时长:5分钟 把下面文章整理成播报文本",
        }),
      ]);
    } finally {
      harness.unmount();
    }
  });

  it("@播报 首次发送时应先绑定真实 session_id 到 broadcast_task", async () => {
    mockEnsureSessionForCommandMetadata.mockResolvedValue(
      "session-broadcast-1",
    );
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
      expect(listMentionEntryUsage()).toEqual([
        expect.objectContaining({
          kind: "builtin_command",
          entryId: "modal_resource_search",
          replayText: "类型:图片 关键词:咖啡馆木桌背景 用途:公众号头图 数量:8",
        }),
      ]);
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

  it("裸 @搜索 发送时也应自动带入最近成功参数", async () => {
    recordMentionEntryUsage({
      kind: "builtin_command",
      entryId: "research",
      usedAt: 1_712_345_678_900,
      slotValues: {
        query: "AI Agent 融资",
        site: "36Kr",
        time_range: "近30天",
        depth: "deep",
        focus: "融资额与产品发布",
        output_format: "要点",
      },
    });

    const harness = mountHook({
      input: "@搜索",
      serviceSkills: [
        createGeneralServiceSkill({
          id: "research",
          title: "搜索",
        }),
      ],
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[0]).toBe(
        "@搜索 关键词:AI Agent 融资 站点:36Kr 时间:近30天 深度:深度 重点:融资额与产品发布 输出:要点",
      );
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            research_skill_launch: {
              kind: "research_request",
              research_request: {
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
      expect(listMentionEntryUsage()).toEqual([
        expect.objectContaining({
          kind: "builtin_command",
          entryId: "research",
          replayText:
            "关键词:AI Agent 融资 站点:36Kr 时间:近30天 深度:深度 重点:融资额与产品发布 输出:要点",
        }),
      ]);
    } finally {
      harness.unmount();
    }
  });

  it("部分 @搜索 输入也应补齐最近成功默认字段", async () => {
    recordMentionEntryUsage({
      kind: "builtin_command",
      entryId: "research",
      usedAt: 1_712_345_678_900,
      slotValues: {
        query: "AI Agent 融资",
        site: "36Kr",
        time_range: "近30天",
        depth: "deep",
        focus: "融资额与产品发布",
        output_format: "要点",
      },
    });

    const harness = mountHook({
      input: "@搜索 OpenAI 最新融资",
      serviceSkills: [
        createGeneralServiceSkill({
          id: "research",
          title: "搜索",
        }),
      ],
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[0]).toBe(
        "@搜索 关键词:OpenAI 最新融资 站点:36Kr 时间:近30天 深度:深度 重点:融资额与产品发布 输出:要点",
      );
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            research_skill_launch: {
              kind: "research_request",
              research_request: {
                prompt: "OpenAI 最新融资 36Kr 近30天 融资额与产品发布",
                query: "OpenAI 最新融资",
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
      expect(listMentionEntryUsage()).toEqual([
        expect.objectContaining({
          kind: "builtin_command",
          entryId: "research",
          replayText:
            "关键词:OpenAI 最新融资 站点:36Kr 时间:近30天 深度:深度 重点:融资额与产品发布 输出:要点",
        }),
      ]);
    } finally {
      harness.unmount();
    }
  });

  it("@搜索 直接输入成功后应回写对应 service skill 最近使用", async () => {
    const harness = mountHook({
      input:
        "@搜索 关键词:AI Agent 融资 站点:36Kr 时间:近30天 深度:深度 重点:融资额与产品发布 输出:要点",
      serviceSkills: [
        createGeneralServiceSkill({
          id: "research",
          title: "搜索",
        }),
      ],
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(listServiceSkillUsage()).toEqual([
        expect.objectContaining({
          skillId: "research",
          runnerType: "instant",
          launchUserInput: "AI Agent 融资 36Kr 近30天 融资额与产品发布",
          slotValues: {
            prompt: "AI Agent 融资 36Kr 近30天 融资额与产品发布",
            query: "AI Agent 融资",
            site: "36Kr",
            time_range: "近30天",
            depth: "deep",
            focus: "融资额与产品发布",
            output_format: "要点",
          },
        }),
      ]);
      expect(listMentionEntryUsage()).toEqual([
        expect.objectContaining({
          kind: "builtin_command",
          entryId: "research",
          replayText:
            "关键词:AI Agent 融资 站点:36Kr 时间:近30天 深度:深度 重点:融资额与产品发布 输出:要点",
          slotValues: {
            prompt: "AI Agent 融资 36Kr 近30天 融资额与产品发布",
            query: "AI Agent 融资",
            site: "36Kr",
            time_range: "近30天",
            depth: "deep",
            focus: "融资额与产品发布",
            output_format: "要点",
          },
        }),
      ]);
    } finally {
      harness.unmount();
    }
  });

  it("通过 active builtin command 发送时，也应回写字段化输入骨架", async () => {
    const harness = mountHook({
      input: "GitHub 最近一周 openai agents sdk issue 讨论",
      serviceSkills: [
        createGeneralServiceSkill({
          id: "research",
          title: "搜索",
        }),
      ],
    });

    try {
      await act(async () => {
        const started = await harness
          .getValue()
          .handleSend(
            undefined,
            undefined,
            undefined,
            "@搜索 GitHub 最近一周 openai agents sdk issue 讨论",
          );
        expect(started).toBe(true);
      });

      expect(listMentionEntryUsage()).toEqual([
        expect.objectContaining({
          kind: "builtin_command",
          entryId: "research",
          replayText:
            "关键词:openai agents sdk issue 讨论 站点:GitHub 时间:最近一周 深度:标准",
        }),
      ]);
    } finally {
      harness.unmount();
    }
  });

  it("通过 active installed skill route 发送时，应保留原始显示文案并回写 slash skill 最近使用", async () => {
    const harness = mountHook({
      input: "整理最近发布计划",
    });

    try {
      await act(async () => {
        const started = await harness
          .getValue()
          .handleSend(
            undefined,
            undefined,
            undefined,
            undefined,
            "react",
            undefined,
            {
              capabilityRoute: {
                kind: "installed_skill",
                skillKey: "writer",
                skillName: "写作助手",
              },
              displayContent: "整理最近发布计划",
            },
          );
        expect(started).toBe(true);
      });

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[0]).toBe("/writer 整理最近发布计划");
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        displayContent: "整理最近发布计划",
        capabilityRoute: {
          kind: "installed_skill",
          skillKey: "writer",
          skillName: "写作助手",
        },
      });
      expect(listSlashEntryUsage()).toEqual([
        expect.objectContaining({
          kind: "skill",
          entryId: "writer",
          replayText: "整理最近发布计划",
        }),
      ]);
    } finally {
      harness.unmount();
    }
  });

  it("通过 active builtin command route 发送时，应由发送链还原内部命令文本并保留原始显示文案", async () => {
    const harness = mountHook({
      input: "GitHub 最近一周 openai agents sdk issue 讨论",
      serviceSkills: [
        createGeneralServiceSkill({
          id: "research",
          title: "搜索",
        }),
      ],
    });

    try {
      await act(async () => {
        const started = await harness
          .getValue()
          .handleSend(
            undefined,
            undefined,
            undefined,
            undefined,
            "react",
            undefined,
            {
              capabilityRoute: {
                kind: "builtin_command",
                commandKey: "research",
                commandPrefix: "@搜索",
              },
              displayContent: "GitHub 最近一周 openai agents sdk issue 讨论",
            },
          );
        expect(started).toBe(true);
      });

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[0]).toBe(
        "@搜索 GitHub 最近一周 openai agents sdk issue 讨论",
      );
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        displayContent: "GitHub 最近一周 openai agents sdk issue 讨论",
        capabilityRoute: {
          kind: "builtin_command",
          commandKey: "research",
          commandPrefix: "@搜索",
        },
      });
      expect(listMentionEntryUsage()).toEqual([
        expect.objectContaining({
          kind: "builtin_command",
          entryId: "research",
          replayText:
            "关键词:openai agents sdk issue 讨论 站点:GitHub 时间:最近一周 深度:标准",
        }),
      ]);
    } finally {
      harness.unmount();
    }
  });

  it("通过 active runtime scene route 发送时，应由发送链还原 scene 命令文本并回写 scene 最近使用", async () => {
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
    const harness = mountHook({
      input: "帮我做一版新品活动启动方案",
      serviceSkills: [createCloudSceneSkill()],
    });

    try {
      await act(async () => {
        const started = await harness
          .getValue()
          .handleSend(
            undefined,
            undefined,
            undefined,
            undefined,
            "react",
            undefined,
            {
              capabilityRoute: {
                kind: "runtime_scene",
                sceneKey: "campaign-launch",
                commandPrefix: "/campaign-launch",
              },
              displayContent: "帮我做一版新品活动启动方案",
            },
          );
        expect(started).toBe(true);
      });

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[0]).toContain("[技能任务] 视频配音");
      expect(mockSendMessage.mock.calls[0]?.[0]).toContain(
        "[补充要求] 帮我做一版新品活动启动方案",
      );
      const sendOptions = mockSendMessage.mock.calls[0]?.[8];
      expect(sendOptions).toMatchObject({
        displayContent: "帮我做一版新品活动启动方案",
        capabilityRoute: {
          kind: "runtime_scene",
          sceneKey: "campaign-launch",
          commandPrefix: "/campaign-launch",
        },
      });
      expect(sendOptions?.requestMetadata).toMatchObject({
        harness: {
          service_scene_launch: {
            kind: "local_service_skill",
            service_scene_run: expect.objectContaining({
              scene_key: "campaign-launch",
              user_input: "帮我做一版新品活动启动方案",
            }),
          },
        },
      });
      expect(listSlashEntryUsage()).toEqual([
        expect.objectContaining({
          kind: "scene",
          entryId: "campaign-launch",
          replayText: "帮我做一版新品活动启动方案",
        }),
      ]);
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

  it("@深搜 成功后应回写字段化最近使用", async () => {
    const harness = mountHook({
      input: "@深搜 GitHub 最近一周 openai agents sdk issue 讨论",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(listMentionEntryUsage()).toEqual([
        expect.objectContaining({
          kind: "builtin_command",
          entryId: "deep_search",
          replayText:
            "关键词:openai agents sdk issue 讨论 站点:GitHub 时间:最近一周 深度:深度",
        }),
      ]);
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
      expect(listMentionEntryUsage()).toEqual([
        expect.objectContaining({
          kind: "builtin_command",
          entryId: "research_report",
          replayText:
            "关键词:AI Agent 融资 站点:36Kr 时间:近30天 重点:融资额与代表产品 输出:投资人研报",
        }),
      ]);
    } finally {
      harness.unmount();
    }
  });

  it("@竞品 应保留原始消息，并通过 report_skill_launch metadata 交给 Agent 调度竞品分析主链", async () => {
    const harness = mountHook({
      input: "@竞品 Claude 与 Gemini 在中国开发者市场的差异",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[0]).toBe(
        "@竞品 Claude 与 Gemini 在中国开发者市场的差异",
      );
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            allow_model_skills: true,
            report_skill_launch: {
              skill_name: "report_generate",
              kind: "report_request",
              report_request: {
                prompt: "Claude 与 Gemini 在中国开发者市场的差异",
                query: "Claude 与 Gemini 在中国开发者市场的差异",
                depth: "deep",
                focus:
                  "产品定位、目标用户、核心功能、定价模式、渠道策略、差异化优劣势",
                output_format: "竞品分析",
                entry_source: "at_competitor_command",
              },
            },
          },
        },
      });
      expect(listMentionEntryUsage()).toEqual([
        expect.objectContaining({
          kind: "builtin_command",
          entryId: "competitor_research",
          replayText:
            "关键词:Claude 与 Gemini 在中国开发者市场的差异 重点:产品定位、目标用户、核心功能、定价模式、渠道策略、差异化优劣势 输出:竞品分析",
        }),
      ]);
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
      expect(mockSendMessage.mock.calls[0]?.[2]).toBe(false);
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        toolPreferencesOverride: {
          webSearch: false,
        },
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
      expect(listMentionEntryUsage()).toEqual([
        expect.objectContaining({
          kind: "builtin_command",
          entryId: "site_search",
          replayText: "站点:GitHub 关键词:openai agents sdk issue 数量:8",
        }),
      ]);
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
      expect(listMentionEntryUsage()).toEqual([
        expect.objectContaining({
          kind: "builtin_command",
          entryId: "read_pdf",
          replayText: "文件:/tmp/agent-report.pdf 输出:投资人摘要 要求:提炼三点结论",
        }),
      ]);
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

  it("@总结 成功后应按固定字段顺序回写最近使用", async () => {
    const harness = mountHook({
      input:
        "@总结 风格:投资人简报 输出:三点要点 长度:简短 内容:这是一篇关于 AI Agent 融资的长文 重点:融资额与发布时间",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(listMentionEntryUsage()).toEqual([
        expect.objectContaining({
          kind: "builtin_command",
          entryId: "summary",
          replayText:
            "内容:这是一篇关于 AI Agent 融资的长文 重点:融资额与发布时间 长度:简短 风格:投资人简报 输出:三点要点",
        }),
      ]);
    } finally {
      harness.unmount();
    }
  });

  it("部分 @总结 输入应补齐最近成功偏好，但不复用旧内容", async () => {
    recordMentionEntryUsage({
      kind: "builtin_command",
      entryId: "summary",
      usedAt: 1_712_345_678_900,
      slotValues: {
        content: "旧内容不应复用",
        focus: "融资额与发布时间",
        length: "short",
        style: "投资人简报",
        output_format: "三点要点",
      },
    });

    const harness = mountHook({
      input: "@总结 内容:OpenAI 发布会纪要",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockSendMessage.mock.calls[0]?.[0]).toBe("@总结 内容:OpenAI 发布会纪要");
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            summary_skill_launch: {
              summary_request: {
                prompt: "OpenAI 发布会纪要",
                content: "OpenAI 发布会纪要",
                focus: "融资额与发布时间",
                length: "short",
                style: "投资人简报",
                output_format: "三点要点",
              },
            },
          },
        },
      });
      expect(listMentionEntryUsage()).toEqual([
        expect.objectContaining({
          entryId: "summary",
          replayText:
            "内容:OpenAI 发布会纪要 重点:融资额与发布时间 长度:简短 风格:投资人简报 输出:三点要点",
        }),
      ]);
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

  it("@翻译 成功后应按固定字段顺序回写最近使用", async () => {
    const harness = mountHook({
      input:
        "@翻译 风格:产品文案 输出:只输出译文 目标语言:中文 内容:hello world 原语言:英语",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(listMentionEntryUsage()).toEqual([
        expect.objectContaining({
          kind: "builtin_command",
          entryId: "translation",
          replayText:
            "内容:hello world 原语言:英语 目标语言:中文 风格:产品文案 输出:只输出译文",
        }),
      ]);
    } finally {
      harness.unmount();
    }
  });

  it("部分 @翻译 输入应补齐最近成功语言与风格偏好", async () => {
    recordMentionEntryUsage({
      kind: "builtin_command",
      entryId: "translation",
      usedAt: 1_712_345_678_900,
      slotValues: {
        content: "旧内容不应复用",
        source_language: "英语",
        target_language: "中文",
        style: "产品文案",
        output_format: "只输出译文",
      },
    });

    const harness = mountHook({
      input: "@翻译 内容:hello world",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockSendMessage.mock.calls[0]?.[0]).toBe("@翻译 内容:hello world");
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            translation_skill_launch: {
              translation_request: {
                prompt: "hello world",
                content: "hello world",
                source_language: "英语",
                target_language: "中文",
                style: "产品文案",
                output_format: "只输出译文",
              },
            },
          },
        },
      });
      expect(listMentionEntryUsage()).toEqual([
        expect.objectContaining({
          entryId: "translation",
          replayText:
            "内容:hello world 原语言:英语 目标语言:中文 风格:产品文案 输出:只输出译文",
        }),
      ]);
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
      expect(listMentionEntryUsage()).toEqual([
        expect.objectContaining({
          kind: "builtin_command",
          entryId: "analysis",
          replayText:
            "内容:OpenAI 发布新模型 重点:商业影响 风格:投资备忘 输出:三点判断",
        }),
      ]);
    } finally {
      harness.unmount();
    }
  });

  it("部分 @分析 输入应补齐最近成功的分析偏好", async () => {
    recordMentionEntryUsage({
      kind: "builtin_command",
      entryId: "analysis",
      usedAt: 1_712_345_678_900,
      slotValues: {
        content: "旧内容不应复用",
        focus: "商业影响",
        style: "投资备忘",
        output_format: "三点判断",
      },
    });

    const harness = mountHook({
      input: "@分析 内容:OpenAI 发布新模型",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockSendMessage.mock.calls[0]?.[0]).toBe(
        "@分析 内容:OpenAI 发布新模型",
      );
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            analysis_skill_launch: {
              analysis_request: {
                prompt: "OpenAI 发布新模型",
                content: "OpenAI 发布新模型",
                focus: "商业影响",
                style: "投资备忘",
                output_format: "三点判断",
              },
            },
          },
        },
      });
      expect(listMentionEntryUsage()).toEqual([
        expect.objectContaining({
          entryId: "analysis",
          replayText:
            "内容:OpenAI 发布新模型 重点:商业影响 风格:投资备忘 输出:三点判断",
        }),
      ]);
    } finally {
      harness.unmount();
    }
  });

  it("@发布合规 应保留原始消息，并通过 analysis_skill_launch metadata 交给 Agent 调度技能", async () => {
    const harness = mountHook({
      input: "@发布合规 内容:这是一篇小红书种草文案 重点:夸大宣传 输出:风险清单",
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
        "@发布合规 内容:这是一篇小红书种草文案 重点:夸大宣传 输出:风险清单",
      );
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            allow_model_skills: true,
            analysis_skill_launch: {
              skill_name: "analysis",
              kind: "analysis_request",
              analysis_request: {
                prompt: "这是一篇小红书种草文案 围绕夸大宣传 风险清单",
                content: "这是一篇小红书种草文案",
                focus: "夸大宣传",
                style: "合规审校",
                output_format: "风险清单",
                entry_source: "at_publish_compliance_command",
              },
            },
          },
        },
      });
      expect(listMentionEntryUsage()).toEqual([
        expect.objectContaining({
          kind: "builtin_command",
          entryId: "publish_compliance",
          replayText:
            "内容:这是一篇小红书种草文案 重点:夸大宣传 风格:合规审校 输出:风险清单",
        }),
      ]);
    } finally {
      harness.unmount();
    }
  });

  it("部分 @发布合规 输入应补齐最近成功的合规偏好", async () => {
    recordMentionEntryUsage({
      kind: "builtin_command",
      entryId: "publish_compliance",
      usedAt: 1_712_345_678_900,
      slotValues: {
        content: "旧内容不应复用",
        focus: "夸大宣传",
        style: "法务审校",
        output_format: "风险清单",
      },
    });

    const harness = mountHook({
      input: "@发布合规 内容:这是一篇小红书种草文案",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockSendMessage.mock.calls[0]?.[0]).toBe(
        "@发布合规 内容:这是一篇小红书种草文案",
      );
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            analysis_skill_launch: {
              analysis_request: {
                prompt: "这是一篇小红书种草文案",
                content: "这是一篇小红书种草文案",
                focus: "夸大宣传",
                style: "法务审校",
                output_format: "风险清单",
              },
            },
          },
        },
      });
      expect(listMentionEntryUsage()).toEqual([
        expect.objectContaining({
          entryId: "publish_compliance",
          replayText:
            "内容:这是一篇小红书种草文案 重点:夸大宣传 风格:法务审校 输出:风险清单",
        }),
      ]);
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
      expect(listMentionEntryUsage()).toEqual([
        expect.objectContaining({
          kind: "builtin_command",
          entryId: "transcription_generate",
          replayText:
            "https://example.com/interview.mp4 格式:srt 区分说话人 带时间戳 逐字稿",
        }),
      ]);
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

  it("@修图 直接输入成功后应归并回写 image_generate 的最近使用", async () => {
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
      serviceSkills: [
        createGeneralServiceSkill({
          id: "image_generate",
          title: "配图",
          defaultExecutorBinding: "native_skill",
        }),
      ],
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(listServiceSkillUsage()).toEqual([
        expect.objectContaining({
          skillId: "image_generate",
          runnerType: "instant",
          slotValues: {
            mode: "edit",
            prompt: "去掉角标，保留主体",
            target_output_ref_id: "img-2",
          },
        }),
      ]);
      expect(listMentionEntryUsage()).toEqual([
        expect.objectContaining({
          kind: "builtin_command",
          entryId: "image_edit",
          replayText: "#img-2 去掉角标，保留主体",
        }),
      ]);
    } finally {
      harness.unmount();
    }
  });

  it("@搜索 发送失败时不应误记最近使用", async () => {
    mockSendMessage.mockRejectedValueOnce(new Error("network down"));
    const harness = mountHook({
      input:
        "@搜索 关键词:AI Agent 融资 站点:36Kr 时间:近30天 深度:深度 重点:融资额与产品发布 输出:要点",
      serviceSkills: [
        createGeneralServiceSkill({
          id: "research",
          title: "搜索",
        }),
      ],
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(false);
      });

      expect(listServiceSkillUsage()).toEqual([]);
      expect(listMentionEntryUsage()).toEqual([]);
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
      expect(listMentionEntryUsage()).toEqual([
        expect.objectContaining({
          kind: "builtin_command",
          entryId: "url_parse",
          replayText:
            "链接:https://example.com/agent 提取:要点 要求:并整理成投资人可读摘要",
        }),
      ]);
    } finally {
      harness.unmount();
    }
  });

  it("@链接解析 首次发送时应先绑定真实 session_id 到 url_parse_task", async () => {
    mockEnsureSessionForCommandMetadata.mockResolvedValue(
      "session-url-parse-1",
    );
    const harness = mountHook({
      input:
        "@链接解析 https://example.com/agent 提取要点 并整理成投资人可读摘要",
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

  it("@抓取 应保留原始消息，并复用 url_parse task 主链提交网页正文抓取任务", async () => {
    const harness = mountHook({
      input: "@抓取 https://example.com/post 帮我抓正文并整理成素材库摘要",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[0]).toBe(
        "@抓取 https://example.com/post 帮我抓正文并整理成素材库摘要",
      );
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            allow_model_skills: true,
            url_parse_skill_launch: {
              skill_name: "url_parse",
              kind: "url_parse_task",
              url_parse_task: {
                url: "https://example.com/post",
                extract_goal: "full_text",
                prompt: "帮我抓正文并整理成素材库摘要",
                entry_source: "at_web_scrape_command",
              },
            },
          },
        },
      });
      expect(listMentionEntryUsage()).toEqual([
        expect.objectContaining({
          kind: "builtin_command",
          entryId: "web_scrape",
          replayText:
            "链接:https://example.com/post 提取:正文 要求:帮我抓正文并整理成素材库摘要",
        }),
      ]);
    } finally {
      harness.unmount();
    }
  });

  it("@网页读取 应保留原始消息，并复用 url_parse task 主链提交网页阅读任务", async () => {
    const harness = mountHook({
      input: "@网页读取 https://example.com/post 帮我读这篇文章并告诉我核心结论",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[0]).toBe(
        "@网页读取 https://example.com/post 帮我读这篇文章并告诉我核心结论",
      );
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            allow_model_skills: true,
            url_parse_skill_launch: {
              skill_name: "url_parse",
              kind: "url_parse_task",
              url_parse_task: {
                url: "https://example.com/post",
                extract_goal: "summary",
                prompt: "帮我读这篇文章并告诉我核心结论",
                entry_source: "at_webpage_read_command",
              },
            },
          },
        },
      });
      expect(listMentionEntryUsage()).toEqual([
        expect.objectContaining({
          kind: "builtin_command",
          entryId: "webpage_read",
          replayText:
            "链接:https://example.com/post 提取:摘要 要求:帮我读这篇文章并告诉我核心结论",
        }),
      ]);
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
      expect(listMentionEntryUsage()).toEqual([
        expect.objectContaining({
          kind: "builtin_command",
          entryId: "typesetting",
          replayText: "平台:小红书 要求:帮我把下面文案整理成短句节奏",
        }),
      ]);
    } finally {
      harness.unmount();
    }
  });

  it("@排版 首次发送时应先绑定真实 session_id 到 typesetting_task", async () => {
    mockEnsureSessionForCommandMetadata.mockResolvedValue(
      "session-typesetting-1",
    );
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

  it("部分 @排版 输入应补齐最近成功的平台偏好", async () => {
    recordMentionEntryUsage({
      kind: "builtin_command",
      entryId: "typesetting",
      usedAt: 1_712_345_678_900,
      slotValues: {
        target_platform: "公众号",
        prompt: "旧要求不应复用",
        content: "旧内容不应复用",
      },
    });

    const harness = mountHook({
      input: "@排版 帮我把下面文案整理成短句节奏",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockSendMessage.mock.calls[0]?.[0]).toBe(
        "@排版 帮我把下面文案整理成短句节奏",
      );
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            typesetting_skill_launch: {
              typesetting_task: {
                prompt: "帮我把下面文案整理成短句节奏",
                content: "帮我把下面文案整理成短句节奏",
                target_platform: "公众号",
              },
            },
          },
        },
      });
      expect(listMentionEntryUsage()).toEqual([
        expect.objectContaining({
          entryId: "typesetting",
          replayText: "平台:公众号 要求:帮我把下面文案整理成短句节奏",
        }),
      ]);
    } finally {
      harness.unmount();
    }
  });

  it("@网页 应保留原始消息，并通过 webpage_skill_launch metadata 交给 Agent 调度技能", async () => {
    const harness = mountHook({
      input:
        "@网页 类型:落地页 风格:未来感 技术:原生 HTML 帮我做一个 AI 代码助手官网",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockResolveImageWorkbenchSkillRequest).not.toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[0]).toBe(
        "@网页 类型:落地页 风格:未来感 技术:原生 HTML 帮我做一个 AI 代码助手官网",
      );
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            allow_model_skills: true,
            webpage_skill_launch: {
              skill_name: "webpage_generate",
              kind: "webpage_request",
              webpage_request: {
                prompt: "帮我做一个 AI 代码助手官网",
                content:
                  "类型:落地页 风格:未来感 技术:原生 HTML 帮我做一个 AI 代码助手官网",
                page_type: "landing_page",
                style: "未来感",
                tech_stack: "原生 HTML",
                entry_source: "at_webpage_command",
              },
            },
          },
        },
      });
      expect(listMentionEntryUsage()).toEqual([
        expect.objectContaining({
          kind: "builtin_command",
          entryId: "webpage_generate",
          replayText:
            "类型:落地页 风格:未来感 技术:原生 HTML 要求:帮我做一个 AI 代码助手官网",
        }),
      ]);
    } finally {
      harness.unmount();
    }
  });

  it("部分 @网页 输入应补齐最近成功的页面偏好", async () => {
    recordMentionEntryUsage({
      kind: "builtin_command",
      entryId: "webpage_generate",
      usedAt: 1_712_345_678_900,
      slotValues: {
        page_type: "landing_page",
        style: "未来感",
        tech_stack: "原生 HTML",
        prompt: "旧要求不应复用",
        content: "旧内容不应复用",
      },
    });

    const harness = mountHook({
      input: "@网页 帮我做一个 AI 代码助手官网",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockSendMessage.mock.calls[0]?.[0]).toBe(
        "@网页 帮我做一个 AI 代码助手官网",
      );
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            webpage_skill_launch: {
              webpage_request: {
                prompt: "帮我做一个 AI 代码助手官网",
                content: "帮我做一个 AI 代码助手官网",
                page_type: "landing_page",
                style: "未来感",
                tech_stack: "原生 HTML",
              },
            },
          },
        },
      });
      expect(listMentionEntryUsage()).toEqual([
        expect.objectContaining({
          entryId: "webpage_generate",
          replayText:
            "类型:落地页 风格:未来感 技术:原生 HTML 要求:帮我做一个 AI 代码助手官网",
        }),
      ]);
    } finally {
      harness.unmount();
    }
  });

  it("@PPT 应保留原始消息，并通过 presentation_skill_launch metadata 交给 Agent 调度技能", async () => {
    const harness = mountHook({
      input:
        "@PPT 类型:路演PPT 风格:极简科技 受众:投资人 页数:10 帮我做一个 AI 助手创业项目融资演示稿",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[0]).toBe(
        "@PPT 类型:路演PPT 风格:极简科技 受众:投资人 页数:10 帮我做一个 AI 助手创业项目融资演示稿",
      );
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            allow_model_skills: true,
            presentation_skill_launch: {
              skill_name: "presentation_generate",
              kind: "presentation_request",
              presentation_request: {
                prompt: "帮我做一个 AI 助手创业项目融资演示稿",
                content:
                  "类型:路演PPT 风格:极简科技 受众:投资人 页数:10 帮我做一个 AI 助手创业项目融资演示稿",
                deck_type: "pitch_deck",
                style: "极简科技",
                audience: "投资人",
                slide_count: 10,
                entry_source: "at_presentation_command",
              },
            },
          },
        },
      });
      expect(listMentionEntryUsage()).toEqual([
        expect.objectContaining({
          kind: "builtin_command",
          entryId: "presentation_generate",
          replayText:
            "类型:路演PPT 风格:极简科技 受众:投资人 页数:10 要求:帮我做一个 AI 助手创业项目融资演示稿",
        }),
      ]);
    } finally {
      harness.unmount();
    }
  });

  it("部分 @PPT 输入应补齐最近成功的演示偏好", async () => {
    recordMentionEntryUsage({
      kind: "builtin_command",
      entryId: "presentation_generate",
      usedAt: 1_712_345_678_900,
      slotValues: {
        deck_type: "pitch_deck",
        style: "极简科技",
        audience: "投资人",
        slide_count: "10",
        prompt: "旧要求不应复用",
        content: "旧内容不应复用",
      },
    });

    const harness = mountHook({
      input: "@PPT 帮我做一个 AI 助手创业项目融资演示稿",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockSendMessage.mock.calls[0]?.[0]).toBe(
        "@PPT 帮我做一个 AI 助手创业项目融资演示稿",
      );
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            presentation_skill_launch: {
              presentation_request: {
                prompt: "帮我做一个 AI 助手创业项目融资演示稿",
                content: "帮我做一个 AI 助手创业项目融资演示稿",
                deck_type: "pitch_deck",
                style: "极简科技",
                audience: "投资人",
                slide_count: 10,
              },
            },
          },
        },
      });
      expect(listMentionEntryUsage()).toEqual([
        expect.objectContaining({
          entryId: "presentation_generate",
          replayText:
            "类型:路演PPT 风格:极简科技 受众:投资人 页数:10 要求:帮我做一个 AI 助手创业项目融资演示稿",
        }),
      ]);
    } finally {
      harness.unmount();
    }
  });

  it("@表单 应保留原始消息，并通过 form_skill_launch metadata 交给 Agent 调度技能", async () => {
    const harness = mountHook({
      input:
        "@表单 类型:报名表单 风格:简洁专业 受众:活动嘉宾 字段数:8 帮我做一个 AI Workshop 报名表",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[0]).toBe(
        "@表单 类型:报名表单 风格:简洁专业 受众:活动嘉宾 字段数:8 帮我做一个 AI Workshop 报名表",
      );
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            allow_model_skills: true,
            form_skill_launch: {
              skill_name: "form_generate",
              kind: "form_request",
              form_request: {
                prompt: "帮我做一个 AI Workshop 报名表",
                content:
                  "类型:报名表单 风格:简洁专业 受众:活动嘉宾 字段数:8 帮我做一个 AI Workshop 报名表",
                form_type: "registration_form",
                style: "简洁专业",
                audience: "活动嘉宾",
                field_count: 8,
                entry_source: "at_form_command",
              },
            },
          },
        },
      });
      expect(listMentionEntryUsage()).toEqual([
        expect.objectContaining({
          kind: "builtin_command",
          entryId: "form_generate",
          replayText:
            "类型:报名表单 风格:简洁专业 受众:活动嘉宾 字段数:8 要求:帮我做一个 AI Workshop 报名表",
        }),
      ]);
    } finally {
      harness.unmount();
    }
  });

  it("部分 @表单 输入应补齐最近成功的表单偏好", async () => {
    recordMentionEntryUsage({
      kind: "builtin_command",
      entryId: "form_generate",
      usedAt: 1_712_345_678_900,
      slotValues: {
        form_type: "registration_form",
        style: "简洁专业",
        audience: "活动嘉宾",
        field_count: "8",
        prompt: "旧要求不应复用",
        content: "旧内容不应复用",
      },
    });

    const harness = mountHook({
      input: "@表单 帮我做一个 AI Workshop 报名表",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockSendMessage.mock.calls[0]?.[0]).toBe(
        "@表单 帮我做一个 AI Workshop 报名表",
      );
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            form_skill_launch: {
              form_request: {
                prompt: "帮我做一个 AI Workshop 报名表",
                content: "帮我做一个 AI Workshop 报名表",
                form_type: "registration_form",
                style: "简洁专业",
                audience: "活动嘉宾",
                field_count: 8,
              },
            },
          },
        },
      });
      expect(listMentionEntryUsage()).toEqual([
        expect.objectContaining({
          entryId: "form_generate",
          replayText:
            "类型:报名表单 风格:简洁专业 受众:活动嘉宾 字段数:8 要求:帮我做一个 AI Workshop 报名表",
        }),
      ]);
    } finally {
      harness.unmount();
    }
  });

  it("@代码 应保留原始消息，并切到 code_orchestrated + 代码团队主链", async () => {
    const harness = mountHook({
      input: "@代码 修复消息历史切换后图片卡片丢失的问题，并补一个回归测试",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[0]).toBe(
        "@代码 修复消息历史切换后图片卡片丢失的问题，并补一个回归测试",
      );
      expect(mockSendMessage.mock.calls[0]?.[5]).toBe("code_orchestrated");
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            preferred_team_preset_id: "code-triage-team",
            preferences: {
              task: true,
              subagent: true,
            },
            code_command: {
              kind: "bug_fix",
              prompt: "修复消息历史切换后图片卡片丢失的问题，并补一个回归测试",
              content: "修复消息历史切换后图片卡片丢失的问题，并补一个回归测试",
              entry_source: "at_code_command",
            },
          },
        },
      });
      expect(listMentionEntryUsage()).toEqual([
        expect.objectContaining({
          kind: "builtin_command",
          entryId: "code_runtime",
          replayText:
            "类型:修复 要求:修复消息历史切换后图片卡片丢失的问题，并补一个回归测试",
        }),
      ]);
      expect(listServiceSkillUsage()).toEqual([]);
    } finally {
      harness.unmount();
    }
  });

  it("@发布 应保留原始消息，并将 dispatch 接到现有发布工作流", async () => {
    const harness = mountHook({
      input: "@发布 平台:微信公众号后台 帮我把这篇文章整理成可直接发布的版本",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[0]).toBe(
        "/content_post_with_cover 平台:微信公众号后台 帮我把这篇文章整理成可直接发布的版本",
      );
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        displayContent:
          "@发布 平台:微信公众号后台 帮我把这篇文章整理成可直接发布的版本",
        requestMetadata: {
          harness: {
            browser_requirement: "required_with_user_step",
            browser_launch_url: "https://mp.weixin.qq.com/",
            publish_command: {
              prompt: "帮我把这篇文章整理成可直接发布的版本",
              content:
                "平台:微信公众号后台 帮我把这篇文章整理成可直接发布的版本",
              platform_type: "wechat_official_account",
              platform_label: "微信公众号后台",
              entry_source: "at_publish_command",
            },
          },
        },
      });
      expect(listMentionEntryUsage()).toEqual([
        expect.objectContaining({
          kind: "builtin_command",
          entryId: "publish_runtime",
          replayText: "平台:微信公众号后台 要求:帮我把这篇文章整理成可直接发布的版本",
        }),
      ]);
    } finally {
      harness.unmount();
    }
  });

  it("部分 @发布 输入应补齐最近成功的平台偏好，并同步触发对应发布前置要求", async () => {
    recordMentionEntryUsage({
      kind: "builtin_command",
      entryId: "publish_runtime",
      usedAt: 1_712_345_678_900,
      slotValues: {
        prompt: "旧要求不应复用",
        content: "旧内容不应复用",
        platform_type: "wechat_official_account",
        platform_label: "微信公众号后台",
      },
    });

    const harness = mountHook({
      input: "@发布 帮我把这篇文章整理成可直接发布的版本",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[0]).toBe(
        "/content_post_with_cover 平台:微信公众号后台 帮我把这篇文章整理成可直接发布的版本",
      );
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        displayContent: "@发布 帮我把这篇文章整理成可直接发布的版本",
        requestMetadata: {
          harness: {
            browser_requirement: "required_with_user_step",
            browser_launch_url: "https://mp.weixin.qq.com/",
            publish_command: {
              prompt: "帮我把这篇文章整理成可直接发布的版本",
              content: "帮我把这篇文章整理成可直接发布的版本",
              platform_type: "wechat_official_account",
              platform_label: "微信公众号后台",
              entry_source: "at_publish_command",
            },
          },
        },
      });
      expect(listMentionEntryUsage()).toEqual([
        expect.objectContaining({
          entryId: "publish_runtime",
          replayText: "平台:微信公众号后台 要求:帮我把这篇文章整理成可直接发布的版本",
        }),
      ]);
    } finally {
      harness.unmount();
    }
  });

  it("@渠道预览 应保留原始消息，并复用现有发布工作流生成预览稿", async () => {
    const harness = mountHook({
      input: "@渠道预览 平台:小红书 帮我预览这篇春日咖啡活动文案的首屏效果",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[0]).toContain(
        "/content_post_with_cover 平台:小红书",
      );
      expect(mockSendMessage.mock.calls[0]?.[0]).toContain("渠道预览稿");
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        displayContent:
          "@渠道预览 平台:小红书 帮我预览这篇春日咖啡活动文案的首屏效果",
        requestMetadata: {
          harness: {
            publish_command: {
              prompt: "帮我预览这篇春日咖啡活动文案的首屏效果",
              content: "平台:小红书 帮我预览这篇春日咖啡活动文案的首屏效果",
              platform_type: "xiaohongshu",
              platform_label: "小红书",
              intent: "preview",
              entry_source: "at_channel_preview_command",
            },
          },
        },
      });
      expect(listMentionEntryUsage()).toEqual([
        expect.objectContaining({
          kind: "builtin_command",
          entryId: "channel_preview_runtime",
          replayText: "平台:小红书 要求:帮我预览这篇春日咖啡活动文案的首屏效果",
        }),
      ]);
    } finally {
      harness.unmount();
    }
  });

  it("部分 @渠道预览 输入应补齐最近成功的平台偏好", async () => {
    recordMentionEntryUsage({
      kind: "builtin_command",
      entryId: "channel_preview_runtime",
      usedAt: 1_712_345_678_900,
      slotValues: {
        prompt: "旧要求不应复用",
        content: "旧内容不应复用",
        platform_type: "xiaohongshu",
        platform_label: "小红书",
        intent: "preview",
      },
    });

    const harness = mountHook({
      input: "@渠道预览 帮我预览这篇春日咖啡活动文案的首屏效果",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[0]).toContain(
        "/content_post_with_cover 平台:小红书",
      );
      expect(mockSendMessage.mock.calls[0]?.[0]).toContain("渠道预览稿");
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        displayContent: "@渠道预览 帮我预览这篇春日咖啡活动文案的首屏效果",
        requestMetadata: {
          harness: {
            publish_command: {
              prompt: "帮我预览这篇春日咖啡活动文案的首屏效果",
              content: "帮我预览这篇春日咖啡活动文案的首屏效果",
              platform_type: "xiaohongshu",
              platform_label: "小红书",
              intent: "preview",
              entry_source: "at_channel_preview_command",
            },
          },
        },
      });
      expect(listMentionEntryUsage()).toEqual([
        expect.objectContaining({
          entryId: "channel_preview_runtime",
          replayText: "平台:小红书 要求:帮我预览这篇春日咖啡活动文案的首屏效果",
        }),
      ]);
    } finally {
      harness.unmount();
    }
  });

  it("@上传 应保留原始消息，并复用现有发布工作流生成上传稿", async () => {
    const harness = mountHook({
      input:
        "@上传 平台:微信公众号后台 帮我把这篇春日咖啡活动文案整理成可直接上传的版本",
      serviceSkills: [
        createGeneralServiceSkill({
          id: "content_post_with_cover",
          title: "发布工作流",
        }),
      ],
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[0]).toContain(
        "/content_post_with_cover 平台:微信公众号后台",
      );
      expect(mockSendMessage.mock.calls[0]?.[0]).toContain("上传稿");
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        displayContent:
          "@上传 平台:微信公众号后台 帮我把这篇春日咖啡活动文案整理成可直接上传的版本",
        requestMetadata: {
          harness: {
            browser_requirement: "required_with_user_step",
            browser_launch_url: "https://mp.weixin.qq.com/",
            publish_command: {
              prompt: "帮我把这篇春日咖啡活动文案整理成可直接上传的版本",
              content:
                "平台:微信公众号后台 帮我把这篇春日咖啡活动文案整理成可直接上传的版本",
              platform_type: "wechat_official_account",
              platform_label: "微信公众号后台",
              intent: "upload",
              entry_source: "at_upload_command",
            },
          },
        },
      });
      expect(listMentionEntryUsage()).toEqual([
        expect.objectContaining({
          kind: "builtin_command",
          entryId: "upload_runtime",
          replayText:
            "平台:微信公众号后台 要求:帮我把这篇春日咖啡活动文案整理成可直接上传的版本",
        }),
      ]);
      expect(listServiceSkillUsage()).toEqual([
        expect.objectContaining({
          skillId: "content_post_with_cover",
          runnerType: "instant",
          launchUserInput: "帮我把这篇春日咖啡活动文案整理成可直接上传的版本",
          slotValues: {
            prompt: "帮我把这篇春日咖啡活动文案整理成可直接上传的版本",
            content:
              "平台:微信公众号后台 帮我把这篇春日咖啡活动文案整理成可直接上传的版本",
            platform_type: "wechat_official_account",
            platform_label: "微信公众号后台",
            intent: "upload",
          },
        }),
      ]);
    } finally {
      harness.unmount();
    }
  });

  it("部分 @上传 输入应补齐最近成功的平台偏好，并保留上传主链语义", async () => {
    recordMentionEntryUsage({
      kind: "builtin_command",
      entryId: "upload_runtime",
      usedAt: 1_712_345_678_900,
      slotValues: {
        prompt: "旧要求不应复用",
        content: "旧内容不应复用",
        platform_type: "wechat_official_account",
        platform_label: "微信公众号后台",
        intent: "upload",
      },
    });

    const harness = mountHook({
      input: "@上传 帮我把这篇春日咖啡活动文案整理成可直接上传的版本",
      serviceSkills: [
        createGeneralServiceSkill({
          id: "content_post_with_cover",
          title: "发布工作流",
        }),
      ],
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[0]).toContain(
        "/content_post_with_cover 平台:微信公众号后台",
      );
      expect(mockSendMessage.mock.calls[0]?.[0]).toContain("上传稿");
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        displayContent: "@上传 帮我把这篇春日咖啡活动文案整理成可直接上传的版本",
        requestMetadata: {
          harness: {
            browser_requirement: "required_with_user_step",
            browser_launch_url: "https://mp.weixin.qq.com/",
            publish_command: {
              prompt: "帮我把这篇春日咖啡活动文案整理成可直接上传的版本",
              content: "帮我把这篇春日咖啡活动文案整理成可直接上传的版本",
              platform_type: "wechat_official_account",
              platform_label: "微信公众号后台",
              intent: "upload",
              entry_source: "at_upload_command",
            },
          },
        },
      });
      expect(listMentionEntryUsage()).toEqual([
        expect.objectContaining({
          entryId: "upload_runtime",
          replayText:
            "平台:微信公众号后台 要求:帮我把这篇春日咖啡活动文案整理成可直接上传的版本",
        }),
      ]);
      expect(listServiceSkillUsage()).toEqual([
        expect.objectContaining({
          skillId: "content_post_with_cover",
          runnerType: "instant",
          slotValues: {
            prompt: "帮我把这篇春日咖啡活动文案整理成可直接上传的版本",
            content: "帮我把这篇春日咖啡活动文案整理成可直接上传的版本",
            platform_type: "wechat_official_account",
            platform_label: "微信公众号后台",
            intent: "upload",
          },
        }),
      ]);
    } finally {
      harness.unmount();
    }
  });

  it("@配音 应保留原始消息，并通过本地 service scene launch 注入配音 prompt", async () => {
    const harness = mountHook({
      input: "@配音 目标语言: 英文 风格: 科技感 给这个新品视频做一版发布配音稿",
      serviceSkills: [createCloudSceneSkill()],
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[0]).toContain("[技能任务] 视频配音");
      expect(mockSendMessage.mock.calls[0]?.[0]).toContain(
        "[补充要求] 给这个新品视频做一版发布配音稿",
      );
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        displayContent: "@配音 目标语言: 英文 风格: 科技感 给这个新品视频做一版发布配音稿",
        requestMetadata: {
          harness: {
            service_scene_launch: {
              kind: "local_service_skill",
              service_scene_run: expect.objectContaining({
                scene_key: "voice_runtime",
                command_prefix: "@配音",
                skill_id: "cloud-video-dubbing",
                skill_title: "视频配音",
                user_input: "给这个新品视频做一版发布配音稿",
                entry_source: "at_voice_command",
                project_id: "project-1",
                target_language: "英文",
                voice_style: "科技感",
              }),
            },
          },
        },
      });
      expect(listMentionEntryUsage()).toEqual([
        expect.objectContaining({
          kind: "builtin_command",
          entryId: "voice_runtime",
          replayText: "目标语言:英文 风格:科技感 给这个新品视频做一版发布配音稿",
        }),
      ]);
      expect(listServiceSkillUsage()).toEqual([
        expect.objectContaining({
          skillId: "cloud-video-dubbing",
          runnerType: "instant",
          launchUserInput: "给这个新品视频做一版发布配音稿",
          slotValues: {
            user_input: "给这个新品视频做一版发布配音稿",
            target_language: "英文",
            voice_style: "科技感",
          },
        }),
      ]);
    } finally {
      harness.unmount();
    }
  });

  it("@搜索 的 service skill usage 应优先跟随当前 command catalog 绑定，而不是 seeded 默认映射", async () => {
    const tenantResearchSkill = createGeneralServiceSkill({
      id: "tenant-research",
      skillKey: "tenant-research",
      title: "租户搜索",
    });
    saveSkillCatalog(
      {
        version: "tenant-2026-04-15",
        tenantId: "tenant-demo",
        syncedAt: "2026-04-15T12:00:00.000Z",
        groups: [
          {
            key: "general",
            title: "通用技能",
            summary: "租户下发目录",
            sort: 90,
            itemCount: 1,
          },
        ],
        items: [
          {
            ...tenantResearchSkill,
            groupKey: "general",
            execution: {
              kind: "agent_turn",
            },
          },
        ],
        entries: [
          {
            id: "command:research",
            kind: "command",
            title: "租户搜索",
            summary: "把 @搜索 绑定到租户下发的搜索技能。",
            commandKey: "research",
            triggers: [{ mode: "mention", prefix: "@搜索" }],
            binding: {
              skillId: "tenant-research",
              executionKind: "agent_turn",
            },
          },
        ],
      },
      "bootstrap_sync",
    );
    const harness = mountHook({
      input: "@搜索 query: AI Agent 聚焦 2026 年新发布",
      serviceSkills: [tenantResearchSkill],
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(listServiceSkillUsage()).toEqual([
        expect.objectContaining({
          skillId: "tenant-research",
          runnerType: "instant",
          slotValues: expect.objectContaining({
            query: "AI Agent 聚焦 2026 年新发布",
          }),
        }),
      ]);
    } finally {
      harness.unmount();
    }
  });

  it("@浏览器 应保留原始消息，并显式切到真实浏览器执行主链", async () => {
    const harness = mountHook({
      input: "@浏览器 打开 https://news.baidu.com 并提炼页面主要内容",
      chatToolPreferences: {
        webSearch: true,
        thinking: false,
        task: false,
        subagent: false,
      },
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[0]).toBe(
        "@浏览器 打开 https://news.baidu.com 并提炼页面主要内容",
      );
      expect(mockSendMessage.mock.calls[0]?.[2]).toBe(false);
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            browser_requirement: "required",
            browser_launch_url: "https://news.baidu.com",
            browser_user_step_required: false,
            browser_assist: expect.objectContaining({
              enabled: true,
              profile_key: "general_browser_assist",
            }),
          },
        },
      });
      expect(listMentionEntryUsage()).toEqual([
        expect.objectContaining({
          kind: "builtin_command",
          entryId: "browser_runtime",
          replayText: "https://news.baidu.com 并提炼页面主要内容",
        }),
      ]);
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
      expect(mockSendMessage.mock.calls[0]?.[0]).toContain("[技能任务] 视频配音");
      expect(mockSendMessage.mock.calls[0]?.[0]).toContain(
        "[补充要求] 帮我做一版新品活动启动方案",
      );
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        displayContent: "/campaign-launch 帮我做一版新品活动启动方案",
        capabilityRoute: {
          kind: "runtime_scene",
          sceneKey: "campaign-launch",
          commandPrefix: "/campaign-launch",
        },
        requestMetadata: {
          harness: {
            service_scene_launch: {
              kind: "local_service_skill",
              service_scene_run: expect.objectContaining({
                scene_key: "campaign-launch",
                skill_id: "cloud-video-dubbing",
                skill_title: "视频配音",
                user_input: "帮我做一版新品活动启动方案",
                project_id: "project-1",
              }),
            },
          },
        },
      });
      expect(listSlashEntryUsage()).toEqual([
        expect.objectContaining({
          kind: "scene",
          entryId: "campaign-launch",
          replayText: "帮我做一版新品活动启动方案",
        }),
      ]);
      expect(mockHandleAutoLaunchMatchedSiteSkill).not.toHaveBeenCalled();
    } finally {
      harness.unmount();
    }
  });

  it("site scene 应从 skill 声明推导 service_skill_launch metadata 并继续发送", async () => {
    mockGetSkillCatalog.mockResolvedValueOnce({
      entries: [
        {
          id: "scene:x-article-export",
        },
      ],
    });
    mockListSkillCatalogSceneEntries.mockReturnValueOnce([
      {
        id: "scene:x-article-export",
        kind: "scene",
        title: "X文章转存",
        summary: "把 X 长文导出成 Markdown。",
        sceneKey: "x-article-export",
        commandPrefix: "/x文章转存",
        aliases: ["x文章转存", "x转存"],
        linkedSkillId: "x-article-export",
        executionKind: "site_adapter",
      },
    ]);
    const harness = mountHook({
      input:
        "/x文章转存 https://x.com/GoogleCloudTech/article/2033953579824758855",
      serviceSkills: [createXArticleExportSkill()],
      contentId: "content-1",
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(true);
      });

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            allow_model_skills: true,
            browser_requirement: "required",
            service_skill_launch: {
              kind: "site_adapter",
              skill_id: "x-article-export",
              adapter_name: "x/article-export",
              save_mode: "project_resource",
              project_id: "project-1",
              args: {
                url: "https://x.com/GoogleCloudTech/article/2033953579824758855",
                target_language: "中文",
              },
            },
            translation_skill_launch: {
              skill_name: "translation",
              kind: "translation_request",
              translation_request: {
                target_language: "中文",
                project_id: "project-1",
                entry_source: "service_skill_site_export_followup",
              },
            },
          },
        },
      });
      expect(listSlashEntryUsage()).toEqual([
        expect.objectContaining({
          kind: "scene",
          entryId: "x-article-export",
          replayText:
            "https://x.com/GoogleCloudTech/article/2033953579824758855",
        }),
      ]);
    } finally {
      harness.unmount();
    }
  });

  it("site scene 缺少当前项目时应拦截发送并提示先选择项目", async () => {
    mockGetSkillCatalog.mockResolvedValueOnce({
      entries: [
        {
          id: "scene:x-article-export",
        },
      ],
    });
    mockListSkillCatalogSceneEntries.mockReturnValueOnce([
      {
        id: "scene:x-article-export",
        kind: "scene",
        title: "X文章转存",
        summary: "把 X 长文导出成 Markdown。",
        sceneKey: "x-article-export",
        commandPrefix: "/x文章转存",
        aliases: ["x文章转存", "x转存"],
        linkedSkillId: "x-article-export",
        executionKind: "site_adapter",
      },
    ]);
    const harness = mountHook({
      input:
        "/x文章转存 https://x.com/GoogleCloudTech/article/2033953579824758855",
      serviceSkills: [createXArticleExportSkill()],
      projectId: null,
      contentId: null,
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(false);
      });

      expect(mockGetOrCreateDefaultProject).not.toHaveBeenCalled();
      expect(mockSendMessage).not.toHaveBeenCalled();
      expect(mockOpenRuntimeSceneGate).toHaveBeenCalledTimes(1);
      expect(mockOpenRuntimeSceneGate).toHaveBeenCalledWith(
        expect.objectContaining({
          sceneKey: "x-article-export",
          fields: [
            expect.objectContaining({
              kind: "project",
              key: "project_id",
            }),
          ],
        }),
      );
    } finally {
      harness.unmount();
    }
  });

  it("site scene 缺少必填 slot 时应打开 scene gate，而不是直接发送", async () => {
    mockGetSkillCatalog.mockResolvedValueOnce({
      entries: [
        {
          id: "scene:x-article-export",
        },
      ],
    });
    mockListSkillCatalogSceneEntries.mockReturnValueOnce([
      {
        id: "scene:x-article-export",
        kind: "scene",
        title: "X文章转存",
        summary: "把 X 长文导出成 Markdown。",
        sceneKey: "x-article-export",
        commandPrefix: "/x文章转存",
        aliases: ["x文章转存", "x转存"],
        linkedSkillId: "x-article-export",
        executionKind: "site_adapter",
      },
    ]);
    const harness = mountHook({
      input: "/x文章转存",
      serviceSkills: [createXArticleExportSkill()],
      projectId: "project-1",
      contentId: null,
    });

    try {
      await act(async () => {
        const started = await harness.getValue().handleSend();
        expect(started).toBe(false);
      });

      expect(mockSendMessage).not.toHaveBeenCalled();
      expect(mockOpenRuntimeSceneGate).toHaveBeenCalledTimes(1);
      expect(mockOpenRuntimeSceneGate).toHaveBeenCalledWith(
        expect.objectContaining({
          sceneKey: "x-article-export",
          fields: [
            expect.objectContaining({
              kind: "slot",
              key: "article_url",
              label: "X 文章链接",
            }),
          ],
        }),
      );
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

  it("聊天主路径不应再把 accessMode 写入 harness request metadata", async () => {
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
      expect(args?.[8]?.requestMetadata?.harness).not.toHaveProperty(
        "access_mode",
      );
    } finally {
      harness.unmount();
    }
  });
});
