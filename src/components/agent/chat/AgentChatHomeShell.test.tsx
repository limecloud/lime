import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfiguredProvider } from "@/hooks/useConfiguredProviders";
import type { EnhancedModelMetadata } from "@/lib/types/modelRegistry";
import { AgentChatHomeShell } from "./AgentChatHomeShell";
import { SettingsTabs } from "@/types/settings";

const {
  mockBuildClawAgentParams,
  mockCreateAutomationJob,
  mockHomeShellExecutionStrategy,
  mockHomeShellModel,
  mockHomeShellProviderType,
  mockListProjects,
  mockSetExecutionStrategy,
  mockSetModel,
  mockSetProviderType,
  mockLoadConfiguredProviders,
  mockLoadProviderModels,
  mockFilterModelsByTheme,
  mockSaveChatToolPreferences,
  mockPrepareClawSolution,
  mockUseClawSolutions,
  mockRecordClawSolutionUsage,
  mockClawSolutions,
  mockUseServiceSkills,
  mockRecordServiceSkillUsage,
  mockServiceSkills,
} = vi.hoisted(() => {
  const mockClawSolutions = [
    {
      id: "social-post-starter",
      title: "社媒主稿生成",
      summary: "进入社媒专项工作台并生成一版首稿。",
      outputHint: "社媒首稿 + 平台结构",
      recommendedCapabilities: ["模型", "社媒主题"],
      readiness: "ready",
      readinessMessage: "可直接开始",
      badge: "社媒方案",
      recentUsedAt: null,
      isRecent: false,
      readinessLabel: "可直接开始",
      readinessTone: "emerald",
    },
    {
      id: "team-breakdown",
      title: "多代理拆任务",
      summary: "默认启用多代理偏好，按 team runtime 方式展开任务。",
      outputHint: "任务拆解 + 分工执行",
      recommendedCapabilities: ["模型", "多代理"],
      readiness: "ready",
      readinessMessage: "可直接开始，进入后会启用多代理偏好",
      reasonCode: "team_recommended",
      badge: "多代理",
      recentUsedAt: null,
      isRecent: false,
      readinessLabel: "可直接开始",
      readinessTone: "emerald",
    },
  ];

  const mockServiceSkills = [
    {
      id: "short-video-script-replication",
      title: "复制短视频脚本",
      summary: "围绕参考视频的结构和节奏，输出一版可继续加工的脚本。",
      category: "视频创作",
      outputHint: "脚本大纲 + 镜头节奏",
      source: "cloud_catalog",
      runnerType: "instant",
      defaultExecutorBinding: "agent_turn",
      executionLocation: "client_default",
      themeTarget: "video",
      version: "seed-v1",
      slotSchema: [
        {
          key: "reference_video",
          label: "参考视频链接/素材",
          type: "url",
          required: true,
          placeholder: "输入视频链接",
        },
      ],
      badge: "云目录",
      recentUsedAt: null,
      isRecent: false,
      runnerLabel: "本地即时执行",
      runnerTone: "emerald",
      runnerDescription: "客户端起步版可直接进入工作区执行。",
      actionLabel: "填写参数",
    },
    {
      id: "daily-trend-briefing",
      title: "每日趋势摘要",
      summary: "围绕指定平台与关键词输出趋势摘要。",
      category: "社媒运营",
      outputHint: "趋势摘要 + 调度建议",
      source: "cloud_catalog",
      runnerType: "scheduled",
      defaultExecutorBinding: "automation_job",
      executionLocation: "client_default",
      themeTarget: "social-media",
      version: "seed-v1",
      slotSchema: [
        {
          key: "platform",
          label: "监测平台",
          type: "platform",
          required: true,
          placeholder: "选择平台",
          defaultValue: "x",
          options: [{ value: "x", label: "X / Twitter" }],
        },
        {
          key: "industry_keywords",
          label: "行业关键词",
          type: "textarea",
          required: true,
          placeholder: "输入关键词",
        },
        {
          key: "schedule_time",
          label: "推送时间",
          type: "schedule_time",
          required: false,
          placeholder: "例如 每天 09:00",
          defaultValue: "每天 09:00",
        },
      ],
      badge: "云目录",
      recentUsedAt: null,
      isRecent: false,
      runnerLabel: "本地计划任务",
      runnerTone: "sky",
      runnerDescription: "当前先进入工作区生成首版任务方案，后续再接本地自动化。",
      actionLabel: "先做方案",
    },
  ];

  const mockRecordClawSolutionUsage = vi.fn();
  const mockRecordServiceSkillUsage = vi.fn();

  return {
    mockBuildClawAgentParams: vi.fn((overrides?: Record<string, unknown>) => ({
      agentEntry: "claw",
      ...(overrides || {}),
    })),
    mockCreateAutomationJob: vi.fn(async (request: Record<string, unknown>) => ({
      id: "automation-job-1",
      ...request,
    })),
    mockHomeShellProviderType: { current: "mock-provider" },
    mockHomeShellModel: { current: "mock-model" },
    mockHomeShellExecutionStrategy: { current: "react" },
    mockListProjects: vi.fn(async () => [
      {
        id: "project-1",
        name: "项目一",
        workspaceType: "general",
        rootPath: "/tmp/project-1",
        isDefault: false,
        createdAt: 0,
        updatedAt: 0,
        isFavorite: false,
        isArchived: false,
        tags: [],
      },
    ]),
    mockSetProviderType: vi.fn(),
    mockSetModel: vi.fn(),
    mockSetExecutionStrategy: vi.fn(),
    mockLoadConfiguredProviders: vi.fn(
      async (): Promise<ConfiguredProvider[]> => [],
    ),
    mockLoadProviderModels: vi.fn(
      async (): Promise<EnhancedModelMetadata[]> => [],
    ),
    mockFilterModelsByTheme: vi.fn(
      (_theme: string | undefined, models: unknown[]) => ({
        models,
        usedFallback: false,
        filteredOutCount: 0,
        policyName: "mock",
      }),
    ),
    mockSaveChatToolPreferences: vi.fn(),
    mockPrepareClawSolution: vi.fn(),
    mockUseClawSolutions: vi.fn(() => ({
      solutions: mockClawSolutions,
      isLoading: false,
      error: null,
      refresh: vi.fn(),
      recordUsage: mockRecordClawSolutionUsage,
    })),
    mockRecordClawSolutionUsage,
    mockClawSolutions,
    mockUseServiceSkills: vi.fn(() => ({
      skills: mockServiceSkills,
      isLoading: false,
      error: null,
      refresh: vi.fn(),
      recordUsage: mockRecordServiceSkillUsage,
    })),
    mockRecordServiceSkillUsage,
    mockServiceSkills,
  };
});

vi.mock("./components/EmptyState", () => ({
  EmptyState: ({
    onSend,
    onRecommendationClick,
    supportingSlotOverride,
  }: {
    onSend: (
      value: string,
      executionStrategy?: unknown,
      images?: Array<{ data: string; mediaType: string }>,
    ) => void;
    onRecommendationClick?: (shortLabel: string, fullPrompt: string) => void;
    supportingSlotOverride?: React.ReactNode;
  }) => (
    <>
      <button
        type="button"
        data-testid="home-shell-send"
        onClick={() => onSend("整理成 notebook 工作方式", undefined, [])}
      >
        发送
      </button>
      <button
        type="button"
        data-testid="home-shell-team-recommendation"
        onClick={() =>
          onRecommendationClick?.(
            "Team 冒烟测试",
            "请按 team runtime 方式做一次冒烟测试：主线程先拆成两个子任务，再创建 explorer 与 executor 两个子代理并行处理；至少等待一个子代理完成，必要时继续 send_input，最后回到主线程输出 team workspace 总结。",
          )
        }
      >
        Team 推荐
      </button>
      {supportingSlotOverride}
    </>
  ),
}));

vi.mock("@/lib/api/memory", () => ({
  getProjectMemory: vi.fn(async () => ({
    characters: [],
  })),
}));

vi.mock("@/lib/api/skills", () => ({
  skillsApi: {
    getLocal: vi.fn(async () => []),
    getAll: vi.fn(async () => []),
  },
}));

vi.mock("./hooks/agentChatStorage", () => ({
  DEFAULT_AGENT_MODEL: "mock-model",
  DEFAULT_AGENT_PROVIDER: "mock-provider",
  GLOBAL_MODEL_PREF_KEY: "global-model",
  GLOBAL_PROVIDER_PREF_KEY: "global-provider",
  getAgentPreferenceKeys: vi.fn(() => ({
    providerKey: "provider-key",
    modelKey: "model-key",
  })),
  loadPersisted: vi.fn((_key: string, fallback: unknown) => fallback),
  loadPersistedString: vi.fn(() => ""),
  resolveWorkspaceAgentPreferences: vi.fn(() => ({
    providerType: "mock-provider",
    model: "mock-model",
  })),
  savePersisted: vi.fn(),
}));

vi.mock("./hooks/agentChatCoreUtils", () => ({
  normalizeExecutionStrategy: vi.fn((value: string) => value || "react"),
}));

vi.mock("./hooks/useHomeShellAgentPreferences", () => ({
  useHomeShellAgentPreferences: vi.fn(() => ({
    providerType: mockHomeShellProviderType.current,
    setProviderType: mockSetProviderType,
    model: mockHomeShellModel.current,
    setModel: mockSetModel,
    executionStrategy: mockHomeShellExecutionStrategy.current,
    setExecutionStrategy: mockSetExecutionStrategy,
  })),
}));

vi.mock("./utils/chatToolPreferences", () => ({
  loadChatToolPreferences: vi.fn(() => ({
    webSearch: false,
    thinking: false,
    task: false,
    subagent: false,
  })),
  saveChatToolPreferences: mockSaveChatToolPreferences,
}));

vi.mock("@/lib/workspace/navigation", () => ({
  buildClawAgentParams: mockBuildClawAgentParams,
}));

vi.mock("@/lib/api/clawSolutions", () => ({
  prepareClawSolution: mockPrepareClawSolution,
}));

vi.mock("@/lib/api/automation", () => ({
  createAutomationJob: mockCreateAutomationJob,
}));

vi.mock("@/lib/api/project", () => ({
  listProjects: mockListProjects,
}));

vi.mock("@/hooks/useConfiguredProviders", () => ({
  loadConfiguredProviders: mockLoadConfiguredProviders,
}));

vi.mock("@/hooks/useProviderModels", () => ({
  loadProviderModels: mockLoadProviderModels,
}));

vi.mock("./utils/modelThemePolicy", () => ({
  filterModelsByTheme: mockFilterModelsByTheme,
}));

vi.mock("./claw-solutions/useClawSolutions", () => ({
  useClawSolutions: mockUseClawSolutions,
}));

vi.mock("./claw-solutions/ClawHomeSolutionsPanel", () => ({
  ClawHomeSolutionsPanel: ({
    solutions,
    onSelect,
  }: {
    solutions: Array<{ id: string; title: string }>;
    onSelect: (solution: { id: string; title: string }) => void;
  }) => (
    <>
      {solutions.map((solution) => (
        <button
          key={solution.id}
          type="button"
          data-testid={`home-shell-solution-${solution.id}`}
          onClick={() => onSelect(solution)}
        >
          {solution.title}
        </button>
      ))}
    </>
  ),
}));

vi.mock("./service-skills/useServiceSkills", () => ({
  useServiceSkills: mockUseServiceSkills,
}));

vi.mock("./service-skills/ServiceSkillHomePanel", () => ({
  ServiceSkillHomePanel: ({
    skills,
    onSelect,
  }: {
    skills: Array<{ id: string; title: string }>;
    onSelect: (skill: { id: string; title: string }) => void;
  }) => (
    <>
      {skills.map((skill) => (
        <button
          key={skill.id}
          type="button"
          data-testid={`home-shell-service-skill-${skill.id}`}
          onClick={() => onSelect(skill)}
        >
          {skill.title}
        </button>
      ))}
    </>
  ),
}));

vi.mock("./service-skills/ServiceSkillLaunchDialog", () => ({
  ServiceSkillLaunchDialog: ({
    skill,
    open,
    onLaunch,
    onCreateAutomation,
  }: {
    skill: { id: string; title: string; runnerType?: string } | null;
    open: boolean;
    onLaunch: (
      skill: { id: string; title: string; runnerType?: string },
      slotValues: Record<string, string>,
    ) => void;
    onCreateAutomation?: (
      skill: { id: string; title: string; runnerType?: string },
      slotValues: Record<string, string>,
    ) => void;
  }) =>
    open && skill ? (
      <>
        <button
          type="button"
          data-testid="home-shell-service-skill-launch"
          onClick={() =>
            onLaunch(
              skill,
              skill.id === "daily-trend-briefing"
                ? {
                    platform: "x",
                    industry_keywords: "AI Agent，创作者工具",
                    schedule_time: "每天 09:00",
                  }
                : {
                    reference_video: "https://example.com/video",
                  },
            )
          }
        >
          启动服务型技能
        </button>
        {skill.runnerType === "scheduled" && onCreateAutomation ? (
          <button
            type="button"
            data-testid="home-shell-service-skill-create-automation"
            onClick={() =>
              onCreateAutomation(skill, {
                platform: "x",
                industry_keywords: "AI Agent，创作者工具",
                schedule_time: "每天 09:00",
              })
            }
          >
            创建自动化任务
          </button>
        ) : null}
      </>
    ) : null,
}));

vi.mock("@/components/settings-v2/system/automation/AutomationJobDialog", () => ({
  AutomationJobDialog: ({
    open,
    mode,
    initialValues,
    onSubmit,
  }: {
    open: boolean;
    mode: "create" | "edit";
    initialValues?: Record<string, unknown> | null;
    onSubmit: (payload: {
      mode: "create";
      request: Record<string, unknown>;
    }) => Promise<void>;
  }) =>
    open ? (
      <div data-testid="home-shell-automation-dialog">
        <span data-testid="home-shell-automation-dialog-mode">{mode}</span>
        <span data-testid="home-shell-automation-dialog-schedule">
          {typeof initialValues?.schedule_kind === "string"
            ? initialValues.schedule_kind
            : "-"}
        </span>
        <span data-testid="home-shell-automation-dialog-name">
          {typeof initialValues?.name === "string" ? initialValues.name : "-"}
        </span>
        <button
          type="button"
          data-testid="home-shell-automation-submit"
          onClick={() =>
            void onSubmit({
              mode: "create",
              request: {
                name:
                  typeof initialValues?.name === "string"
                    ? initialValues.name
                    : "自动化任务",
                description:
                  typeof initialValues?.description === "string"
                    ? initialValues.description
                    : null,
                workspace_id:
                  typeof initialValues?.workspace_id === "string"
                    ? initialValues.workspace_id
                    : "project-1",
                execution_mode:
                  typeof initialValues?.execution_mode === "string"
                    ? initialValues.execution_mode
                    : "skill",
                schedule:
                  initialValues?.schedule_kind === "cron"
                    ? {
                        kind: "cron",
                        expr:
                          typeof initialValues?.cron_expr === "string"
                            ? initialValues.cron_expr
                            : "0 9 * * *",
                        tz:
                          typeof initialValues?.cron_tz === "string"
                            ? initialValues.cron_tz
                            : "Asia/Shanghai",
                      }
                    : {
                        kind: "every",
                        every_secs: Number(initialValues?.every_secs ?? 86400),
                      },
                payload: {
                  kind: "agent_turn",
                  prompt:
                    typeof initialValues?.prompt === "string"
                      ? initialValues.prompt
                      : "",
                  system_prompt:
                    typeof initialValues?.system_prompt === "string"
                      ? initialValues.system_prompt
                      : null,
                  web_search:
                    typeof initialValues?.web_search === "boolean"
                      ? initialValues.web_search
                      : false,
                },
                delivery: {
                  mode: "none",
                  channel: null,
                  target: null,
                  best_effort: true,
                  output_schema: "text",
                  output_format: "text",
                },
                max_retries: Number(initialValues?.max_retries ?? 2),
              },
            })
          }
        >
          提交自动化
        </button>
      </div>
    ) : null,
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mockHomeShellProviderType.current = "mock-provider";
  mockHomeShellModel.current = "mock-model";
  mockHomeShellExecutionStrategy.current = "react";
  mockUseClawSolutions.mockImplementation(() => ({
    solutions: mockClawSolutions,
    isLoading: false,
    error: null,
    refresh: vi.fn(),
    recordUsage: mockRecordClawSolutionUsage,
  }));
  mockUseServiceSkills.mockImplementation(() => ({
    skills: mockServiceSkills,
    isLoading: false,
    error: null,
    refresh: vi.fn(),
    recordUsage: mockRecordServiceSkillUsage,
  }));
  mockLoadConfiguredProviders.mockResolvedValue([]);
  mockLoadProviderModels.mockResolvedValue([]);
  mockListProjects.mockResolvedValue([
    {
      id: "project-1",
      name: "项目一",
      workspaceType: "general",
      rootPath: "/tmp/project-1",
      isDefault: false,
      createdAt: 0,
      updatedAt: 0,
      isFavorite: false,
      isArchived: false,
      tags: [],
    },
  ]);
  mockFilterModelsByTheme.mockImplementation(
    (_theme: string | undefined, models: unknown[]) => ({
      models,
      usedFallback: false,
      filteredOutCount: 0,
      policyName: "mock",
    }),
  );
});

afterEach(() => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) {
      break;
    }
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  vi.clearAllMocks();
});

function renderShell(
  props: Partial<React.ComponentProps<typeof AgentChatHomeShell>> = {},
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const defaultProps: React.ComponentProps<typeof AgentChatHomeShell> = {
    onNavigate: vi.fn(),
    projectId: "project-1",
    theme: "general",
    lockTheme: false,
    onEnterWorkspace: vi.fn(),
  };

  act(() => {
    root.render(<AgentChatHomeShell {...defaultProps} {...props} />);
  });

  mountedRoots.push({ root, container });
  return {
    container,
    props: {
      ...defaultProps,
      ...props,
    },
  };
}

async function flushEffects(times = 4) {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("AgentChatHomeShell", () => {
  it("发送首条消息时应直接导航到 claw 工作区", async () => {
    const onNavigate = vi.fn();
    const onEnterWorkspace = vi.fn();
    const { container } = renderShell({
      onNavigate,
      onEnterWorkspace,
    });

    await flushEffects();

    const sendButton = container.querySelector(
      '[data-testid="home-shell-send"]',
    ) as HTMLButtonElement | null;

    expect(sendButton).toBeTruthy();

    act(() => {
      sendButton?.click();
    });

    await flushEffects();

    expect(mockBuildClawAgentParams).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        theme: "general",
        initialCreationMode: "guided",
        initialUserPrompt: "整理成 notebook 工作方式",
        initialUserImages: [],
        openBrowserAssistOnMount: undefined,
        newChatAt: expect.any(Number),
      }),
    );
    expect(onNavigate).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        agentEntry: "claw",
        projectId: "project-1",
        initialUserPrompt: "整理成 notebook 工作方式",
        newChatAt: expect.any(Number),
      }),
    );
    expect(onEnterWorkspace).not.toHaveBeenCalled();
  });

  it("点击 team 推荐时应开启多代理偏好并直接进入工作区", async () => {
    const onEnterWorkspace = vi.fn();
    const { container } = renderShell({
      onNavigate: undefined,
      onEnterWorkspace,
    });

    await flushEffects();

    const teamRecommendationButton = container.querySelector(
      '[data-testid="home-shell-team-recommendation"]',
    ) as HTMLButtonElement | null;

    expect(teamRecommendationButton).toBeTruthy();

    act(() => {
      teamRecommendationButton?.click();
    });

    await flushEffects();

    expect(mockSaveChatToolPreferences).toHaveBeenLastCalledWith(
      expect.objectContaining({
        webSearch: false,
        thinking: false,
        task: false,
        subagent: true,
      }),
      "general",
    );
    expect(onEnterWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        theme: "general",
        initialCreationMode: "guided",
        initialUserPrompt:
          "请按 team runtime 方式做一次冒烟测试：主线程先拆成两个子任务，再创建 explorer 与 executor 两个子代理并行处理；至少等待一个子代理完成，必要时继续 send_input，最后回到主线程输出 team workspace 总结。",
        newChatAt: expect.any(Number),
      }),
    );
  });

  it("点击社媒方案时应切换到 social-media 工作区", async () => {
    const onNavigate = vi.fn();
    mockLoadConfiguredProviders.mockResolvedValueOnce([
      {
        key: "custom-social-provider",
        label: "Custom Social Provider",
        registryId: "custom-social-provider",
        fallbackRegistryId: "openai",
        type: "openai",
      },
    ]);
    mockLoadProviderModels.mockResolvedValueOnce([
      {
        id: "social-model-1",
        display_name: "Social Model 1",
        provider_id: "custom-social-provider",
        provider_name: "Custom Social Provider",
        family: null,
        tier: "pro",
        capabilities: {
          vision: false,
          tools: true,
          streaming: true,
          json_mode: true,
          function_calling: true,
          reasoning: false,
        },
        pricing: null,
        limits: {
          context_length: null,
          max_output_tokens: null,
          requests_per_minute: null,
          tokens_per_minute: null,
        },
        status: "active",
        release_date: null,
        is_latest: true,
        description: "social",
        source: "custom",
        created_at: 0,
        updated_at: 0,
      },
    ]);
    mockPrepareClawSolution.mockResolvedValueOnce({
      solutionId: "social-post-starter",
      actionType: "navigate_theme",
      prompt: "请先帮我起草一版社媒内容首稿",
      themeTarget: "social-media",
      shouldLaunchBrowserAssist: false,
      shouldEnableTeamMode: false,
      readiness: "ready",
      readinessMessage: "可直接开始",
    });

    const { container } = renderShell({
      onNavigate,
    });

    await flushEffects();

    const socialSolutionButton = container.querySelector(
      '[data-testid="home-shell-solution-social-post-starter"]',
    ) as HTMLButtonElement | null;

    expect(socialSolutionButton).toBeTruthy();

    act(() => {
      socialSolutionButton?.click();
    });

    await flushEffects();

    expect(mockSetProviderType).toHaveBeenCalledWith("custom-social-provider");
    expect(mockSetModel).toHaveBeenCalledWith("social-model-1");
    expect(mockPrepareClawSolution).toHaveBeenCalledWith(
      "social-post-starter",
      {
        projectId: "project-1",
        userInput: undefined,
      },
    );
    expect(mockBuildClawAgentParams).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        theme: "social-media",
        initialUserPrompt: "请先帮我起草一版社媒内容首稿",
      }),
    );
    expect(onNavigate).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        agentEntry: "claw",
        theme: "social-media",
        initialUserPrompt: "请先帮我起草一版社媒内容首稿",
      }),
    );
    expect(mockSetProviderType.mock.invocationCallOrder[0]).toBeLessThan(
      onNavigate.mock.invocationCallOrder[0],
    );
    expect(mockSetModel.mock.invocationCallOrder[0]).toBeLessThan(
      onNavigate.mock.invocationCallOrder[0],
    );
    expect(mockRecordClawSolutionUsage).toHaveBeenCalledWith({
      solutionId: "social-post-starter",
      actionType: "navigate_theme",
      themeTarget: "social-media",
    });
  });

  it("当前 provider 已可用时应保留 custom provider id 并仅切换模型", async () => {
    const onNavigate = vi.fn();
    mockHomeShellProviderType.current = "custom-social-provider";
    mockHomeShellModel.current = "legacy-model";
    mockLoadConfiguredProviders.mockResolvedValueOnce([
      {
        key: "custom-social-provider",
        label: "Custom Social Provider",
        registryId: "custom-social-provider",
        fallbackRegistryId: "openai",
        type: "openai",
      },
      {
        key: "other-provider",
        label: "Other Provider",
        registryId: "other-provider",
        type: "openai",
      },
    ]);
    mockLoadProviderModels.mockResolvedValueOnce([
      {
        id: "custom-social-model",
        display_name: "Custom Social Model",
        provider_id: "custom-social-provider",
        provider_name: "Custom Social Provider",
        family: null,
        tier: "pro",
        capabilities: {
          vision: false,
          tools: true,
          streaming: true,
          json_mode: true,
          function_calling: true,
          reasoning: false,
        },
        pricing: null,
        limits: {
          context_length: null,
          max_output_tokens: null,
          requests_per_minute: null,
          tokens_per_minute: null,
        },
        status: "active",
        release_date: null,
        is_latest: true,
        description: "custom-social-model",
        source: "custom",
        created_at: 0,
        updated_at: 0,
      },
    ]);
    mockPrepareClawSolution.mockResolvedValueOnce({
      solutionId: "social-post-starter",
      actionType: "navigate_theme",
      prompt: "请先帮我起草一版社媒内容首稿",
      themeTarget: "social-media",
      shouldLaunchBrowserAssist: false,
      shouldEnableTeamMode: false,
      readiness: "ready",
      readinessMessage: "可直接开始",
    });

    const { container } = renderShell({
      onNavigate,
    });

    await flushEffects();

    const socialSolutionButton = container.querySelector(
      '[data-testid="home-shell-solution-social-post-starter"]',
    ) as HTMLButtonElement | null;

    expect(socialSolutionButton).toBeTruthy();

    act(() => {
      socialSolutionButton?.click();
    });

    await flushEffects();

    expect(mockSetProviderType).not.toHaveBeenCalled();
    expect(mockSetModel).toHaveBeenCalledWith("custom-social-model");
    expect(mockLoadProviderModels).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "custom-social-provider",
      }),
    );
    expect(onNavigate).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        theme: "social-media",
      }),
    );
  });

  it("点击多代理方案时应开启多代理偏好并进入工作区", async () => {
    const onEnterWorkspace = vi.fn();
    mockPrepareClawSolution.mockResolvedValueOnce({
      solutionId: "team-breakdown",
      actionType: "enable_team_mode",
      prompt: "请把这个任务按多代理方式拆解",
      shouldLaunchBrowserAssist: false,
      shouldEnableTeamMode: true,
      readiness: "ready",
      readinessMessage: "可直接开始，进入后会启用多代理偏好",
    });

    const { container } = renderShell({
      onNavigate: undefined,
      onEnterWorkspace,
    });

    await flushEffects();

    const teamSolutionButton = container.querySelector(
      '[data-testid="home-shell-solution-team-breakdown"]',
    ) as HTMLButtonElement | null;

    expect(teamSolutionButton).toBeTruthy();

    act(() => {
      teamSolutionButton?.click();
    });

    await flushEffects();

    expect(mockSaveChatToolPreferences).toHaveBeenLastCalledWith(
      expect.objectContaining({
        webSearch: false,
        thinking: false,
        task: false,
        subagent: true,
      }),
      "general",
    );
    expect(onEnterWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        theme: "general",
        initialCreationMode: "guided",
        initialUserPrompt: "请把这个任务按多代理方式拆解",
      }),
    );
    expect(mockRecordClawSolutionUsage).toHaveBeenCalledWith({
      solutionId: "team-breakdown",
      actionType: "enable_team_mode",
      themeTarget: null,
    });
  });

  it("点击服务型技能后应完成补参并进入对应工作区", async () => {
    const onEnterWorkspace = vi.fn();
    const { container } = renderShell({
      onNavigate: undefined,
      onEnterWorkspace,
    });

    await flushEffects();

    const serviceSkillButton = container.querySelector(
      '[data-testid="home-shell-service-skill-short-video-script-replication"]',
    ) as HTMLButtonElement | null;

    expect(serviceSkillButton).toBeTruthy();

    act(() => {
      serviceSkillButton?.click();
    });

    await flushEffects();

    const launchButton = container.querySelector(
      '[data-testid="home-shell-service-skill-launch"]',
    ) as HTMLButtonElement | null;

    expect(launchButton).toBeTruthy();

    act(() => {
      launchButton?.click();
    });

    await flushEffects();

    expect(onEnterWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        theme: "video",
        initialCreationMode: "guided",
        initialUserPrompt: expect.stringContaining(
          "[服务型技能] 复制短视频脚本",
        ),
      }),
    );
    expect(onEnterWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        initialUserPrompt: expect.stringContaining(
          "- 参考视频链接/素材: https://example.com/video",
        ),
      }),
    );
    expect(mockRecordServiceSkillUsage).toHaveBeenCalledWith({
      skillId: "short-video-script-replication",
      runnerType: "instant",
    });
  });

  it("点击定时服务型技能创建任务后应先建本地 automation 再进入工作区", async () => {
    const onEnterWorkspace = vi.fn();
    const { container } = renderShell({
      onNavigate: undefined,
      onEnterWorkspace,
    });

    await flushEffects();

    const serviceSkillButton = container.querySelector(
      '[data-testid="home-shell-service-skill-daily-trend-briefing"]',
    ) as HTMLButtonElement | null;

    expect(serviceSkillButton).toBeTruthy();

    act(() => {
      serviceSkillButton?.click();
    });

    await flushEffects();

    const createAutomationButton = container.querySelector(
      '[data-testid="home-shell-service-skill-create-automation"]',
    ) as HTMLButtonElement | null;

    expect(createAutomationButton).toBeTruthy();

    act(() => {
      createAutomationButton?.click();
    });

    await flushEffects();

    const automationDialog = container.querySelector(
      '[data-testid="home-shell-automation-dialog"]',
    ) as HTMLDivElement | null;
    const automationSubmitButton = container.querySelector(
      '[data-testid="home-shell-automation-submit"]',
    ) as HTMLButtonElement | null;

    expect(automationDialog).toBeTruthy();
    expect(container.textContent).toContain("create");
    expect(container.textContent).toContain("cron");
    expect(container.textContent).toContain("每日趋势摘要");
    expect(automationSubmitButton).toBeTruthy();

    act(() => {
      automationSubmitButton?.click();
    });

    await flushEffects();

    expect(mockCreateAutomationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: "project-1",
        execution_mode: "skill",
        schedule: {
          kind: "cron",
          expr: "00 09 * * *",
          tz: expect.any(String),
        },
        payload: expect.objectContaining({
          kind: "agent_turn",
          prompt: expect.stringContaining("[服务型技能] 每日趋势摘要"),
        }),
      }),
    );
    expect(onEnterWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        theme: "social-media",
        initialCreationMode: "guided",
        initialUserPrompt: expect.stringContaining("[服务型技能] 每日趋势摘要"),
      }),
    );
    expect(mockRecordServiceSkillUsage).toHaveBeenCalledWith({
      skillId: "daily-trend-briefing",
      runnerType: "scheduled",
    });
  });

  it("方案未就绪且缺少模型时应直接跳到供应商设置", async () => {
    const onNavigate = vi.fn();
    const onEnterWorkspace = vi.fn();
    mockPrepareClawSolution.mockResolvedValueOnce({
      solutionId: "social-post-starter",
      actionType: "navigate_theme",
      prompt: "请先帮我起草一版社媒内容首稿",
      themeTarget: "social-media",
      shouldLaunchBrowserAssist: false,
      shouldEnableTeamMode: false,
      readiness: "needs_setup",
      readinessMessage: "请先配置至少一个可用模型",
      reasonCode: "missing_model",
    });

    const { container } = renderShell({
      onNavigate,
      onEnterWorkspace,
    });

    await flushEffects();

    const socialSolutionButton = container.querySelector(
      '[data-testid="home-shell-solution-social-post-starter"]',
    ) as HTMLButtonElement | null;

    expect(socialSolutionButton).toBeTruthy();

    act(() => {
      socialSolutionButton?.click();
    });

    await flushEffects();

    expect(onNavigate).toHaveBeenCalledWith("settings", {
      tab: SettingsTabs.Providers,
    });
    expect(onEnterWorkspace).not.toHaveBeenCalled();
    expect(mockRecordClawSolutionUsage).not.toHaveBeenCalled();
  });
});
