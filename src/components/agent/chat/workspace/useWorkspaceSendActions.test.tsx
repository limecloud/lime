import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamMemorySnapshot } from "@/lib/teamMemorySync";
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
const mockResolveImageWorkbenchSkillRequest = vi.fn(() => null);

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

  it("纯文本 @配图 应保留原始消息，并通过 image_skill_launch metadata 交给 Agent 调度技能", async () => {
    mockResolveImageWorkbenchSkillRequest.mockReturnValueOnce({
      images: [],
      requestContext: {
        kind: "image_task",
        image_task: {
          mode: "generate",
          prompt: "一张春日咖啡馆插画",
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

  it("带引用图的图片命令应保留原始消息，并把结构化 image_skill_launch metadata 交给 Agent", async () => {
    mockResolveImageWorkbenchSkillRequest.mockReturnValueOnce({
      images: [],
      requestContext: {
        kind: "image_task",
        image_task: {
          mode: "edit",
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
      expect(mockSendMessage.mock.calls[0]?.[0]).toBe(
        "@配图 编辑 #img-2 去掉角标，保留主体",
      );
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            allow_model_skills: true,
            image_skill_launch: {
              skill_name: "image_generate",
              kind: "image_task",
              image_task: {
                mode: "edit",
              },
            },
          },
        },
      });
    } finally {
      harness.unmount();
    }
  });

  it("@修图 应接入当前图片 skillRequest 主链", async () => {
    mockResolveImageWorkbenchSkillRequest.mockReturnValueOnce({
      images: [],
      requestContext: {
        kind: "image_task",
        image_task: {
          mode: "edit",
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
      expect(mockSendMessage.mock.calls[0]?.[0]).toBe(
        "@修图 #img-2 去掉角标，保留主体",
      );
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            allow_model_skills: true,
            image_skill_launch: {
              skill_name: "image_generate",
              kind: "image_task",
              image_task: {
                mode: "edit",
                target_output_ref_id: "img-2",
              },
            },
          },
        },
      });
    } finally {
      harness.unmount();
    }
  });

  it("@重绘 应接入当前图片 skillRequest 主链", async () => {
    mockResolveImageWorkbenchSkillRequest.mockReturnValueOnce({
      images: [],
      requestContext: {
        kind: "image_task",
        image_task: {
          mode: "variation",
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
      expect(mockSendMessage.mock.calls[0]?.[0]).toBe(
        "@重绘 #img-2 更偏插画风，保留主视觉",
      );
      expect(mockSendMessage.mock.calls[0]?.[8]).toMatchObject({
        requestMetadata: {
          harness: {
            allow_model_skills: true,
            image_skill_launch: {
              skill_name: "image_generate",
              kind: "image_task",
              image_task: {
                mode: "variation",
                target_output_ref_id: "img-2",
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

  it("已携带 service_skill_launch metadata 时不应再被前端二次命中站点技能或浏览器前置引导", async () => {
    const mockMaybeStartBrowserTaskPreflight = vi.fn(() => false);
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
        shouldConsumePendingThemeWorkbenchInitialPrompt: false,
        shouldDismissThemeWorkbenchEntryPrompt: false,
      })) as HookProps["resolveSendBoundary"],
      maybeStartBrowserTaskPreflight:
        mockMaybeStartBrowserTaskPreflight as HookProps["maybeStartBrowserTaskPreflight"],
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
      expect(mockMaybeStartBrowserTaskPreflight).not.toHaveBeenCalled();
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
            session_mode: "theme_workbench",
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
