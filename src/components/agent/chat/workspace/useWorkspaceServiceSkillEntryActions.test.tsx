import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatToolPreferences } from "../utils/chatToolPreferences";
import type { TeamDefinition } from "../utils/teamDefinitions";
import type { ServiceSkillHomeItem } from "../service-skills/types";
import { useWorkspaceServiceSkillEntryActions } from "./useWorkspaceServiceSkillEntryActions";

const mockCreateAutomationJob = vi.fn();
const mockCreateServiceSkillRun = vi.fn();
const mockGetServiceSkillRun = vi.fn();
const mockIsTerminalServiceSkillRunStatus = vi.fn();
const mockCreateContent = vi.fn();
const mockListProjects = vi.fn();
const mockRecordServiceSkillAutomationLink = vi.fn();
const mockSiteGetAdapterLaunchReadiness = vi.fn();
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
const mockToastInfo = vi.fn();
const mockToastLoading = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
    info: (...args: unknown[]) => mockToastInfo(...args),
    loading: (...args: unknown[]) => mockToastLoading(...args),
  },
}));

vi.mock("@/lib/api/automation", () => ({
  createAutomationJob: (request: unknown) => mockCreateAutomationJob(request),
}));

vi.mock("@/lib/api/serviceSkillRuns", () => ({
  createServiceSkillRun: (...args: unknown[]) => mockCreateServiceSkillRun(...args),
  getServiceSkillRun: (...args: unknown[]) => mockGetServiceSkillRun(...args),
  isTerminalServiceSkillRunStatus: (status: unknown) =>
    mockIsTerminalServiceSkillRunStatus(status),
}));

vi.mock("@/lib/api/project", () => ({
  createContent: (request: unknown) => mockCreateContent(request),
  listProjects: () => mockListProjects(),
  getDefaultContentTypeForProject: (projectType: string) => {
    switch (projectType) {
      case "social-media":
        return "post";
      case "video":
        return "episode";
      case "knowledge":
      case "general":
      default:
        return "document";
    }
  },
}));

vi.mock("@/lib/webview-api", () => ({
  siteGetAdapterLaunchReadiness: (...args: unknown[]) =>
    mockSiteGetAdapterLaunchReadiness(...args),
}));

vi.mock("../service-skills/automationLinkStorage", () => ({
  recordServiceSkillAutomationLink: (input: unknown) =>
    mockRecordServiceSkillAutomationLink(input),
}));

type HookProps = Parameters<typeof useWorkspaceServiceSkillEntryActions>[0];

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];
const DEFAULT_CHAT_TOOL_PREFERENCES: ChatToolPreferences = {
  webSearch: false,
  thinking: false,
  task: false,
  subagent: false,
};
const DEFAULT_SELECTED_TEAM: TeamDefinition = {
  id: "team-research-duo",
  source: "builtin",
  label: "研究双人组",
  description: "负责检索和整理结果。",
  roles: [
    {
      id: "researcher",
      label: "研究员",
      summary: "负责检索线索。",
      skillIds: ["web-search"],
    },
    {
      id: "analyst",
      label: "分析员",
      summary: "负责整理结论。",
      roleKey: "analyst",
    },
  ],
};

function createProject(id = "project-1") {
  return {
    id,
    name: "项目一",
    workspaceType: "general",
    rootPath: "",
    isDefault: false,
    createdAt: 1,
    updatedAt: 1,
    isFavorite: false,
    isArchived: false,
    tags: [],
  };
}

function createBrowserServiceSkill(): ServiceSkillHomeItem {
  return {
    id: "github-repo-radar",
    title: "GitHub 仓库线索检索",
    summary:
      "复用你当前浏览器里的 GitHub 登录态，直接检索主题仓库并沉淀成结构化线索。",
    category: "情报研究",
    outputHint: "仓库列表 + 关键线索",
    source: "cloud_catalog",
    runnerType: "instant",
    defaultExecutorBinding: "browser_assist",
    executionLocation: "client_default",
    defaultArtifactKind: "analysis",
    themeTarget: "knowledge",
    version: "seed-v1",
    readinessRequirements: {
      requiresBrowser: true,
      requiresProject: true,
    },
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
      suggestedTitleTemplate: "GitHub 仓库线索 · {{repository_query}}",
    },
    slotSchema: [
      {
        key: "repository_query",
        label: "检索主题",
        type: "text",
        required: true,
        placeholder: "例如 browser assist mcp",
      },
    ],
    badge: "云目录",
    recentUsedAt: null,
    isRecent: false,
    runnerLabel: "浏览器站点执行",
    runnerTone: "emerald",
    runnerDescription:
      "直接进入浏览器工作台，复用真实登录态执行站点脚本并沉淀结果。",
    actionLabel: "启动采集",
    automationStatus: null,
  };
}

function createScheduledServiceSkill(): ServiceSkillHomeItem {
  return {
    id: "daily-trend-briefing",
    title: "每日趋势摘要",
    summary: "围绕指定平台与关键词输出趋势摘要。",
    category: "社媒运营",
    outputHint: "趋势摘要 + 调度建议",
    source: "cloud_catalog",
    runnerType: "scheduled",
    defaultExecutorBinding: "automation_job",
    executionLocation: "client_default",
    defaultArtifactKind: "analysis",
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
    runnerDescription: "可直接创建本地定时任务，并回流到任务中心与工作区。",
    actionLabel: "创建任务",
    automationStatus: null,
  };
}

function createCloudServiceSkill(): ServiceSkillHomeItem {
  return {
    id: "cloud-video-dubbing",
    title: "云端视频配音",
    summary: "把视频文案与素材提交到云端，生成一版可继续加工的配音结果。",
    category: "视频创作",
    outputHint: "配音文案 + 结果摘要",
    source: "cloud_catalog",
    runnerType: "instant",
    defaultExecutorBinding: "cloud_scene",
    executionLocation: "cloud_required",
    defaultArtifactKind: "brief",
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
    runnerLabel: "云端托管执行",
    runnerTone: "slate",
    runnerDescription: "提交到 OEM 云端执行，结果由服务端异步返回。",
    actionLabel: "提交云端",
    automationStatus: null,
  };
}

function renderHook(props?: Partial<HookProps>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  let latestValue: ReturnType<
    typeof useWorkspaceServiceSkillEntryActions
  > | null = null;

  const defaultProps: HookProps = {
    activeTheme: "general",
    creationMode: "guided",
    projectId: "project-1",
    contentId: "content-current",
    input: "请结合当前上下文继续",
    chatToolPreferences: DEFAULT_CHAT_TOOL_PREFERENCES,
    onNavigate: vi.fn(),
    recordServiceSkillUsage: vi.fn(),
  };

  function Probe(currentProps: HookProps) {
    latestValue = useWorkspaceServiceSkillEntryActions(currentProps);
    return null;
  }

  const render = async (nextProps?: Partial<HookProps>) => {
    await act(async () => {
      root.render(<Probe {...defaultProps} {...props} {...nextProps} />);
      await Promise.resolve();
    });
  };

  mountedRoots.push({ root, container });

  return {
    render,
    getValue: () => {
      if (!latestValue) {
        throw new Error("hook 尚未初始化");
      }
      return latestValue;
    },
  };
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mockSiteGetAdapterLaunchReadiness.mockResolvedValue({
    status: "ready",
    adapter: "github/search",
    domain: "github.com",
    profile_key: "attached-github",
    target_id: "tab-github",
    message: "已检测到 github.com 的真实浏览器页面，Claw 可以直接复用当前会话执行。",
  });
  mockCreateAutomationJob.mockResolvedValue({
    id: "automation-job-1",
    name: "每日趋势摘要｜定时执行",
  });
  mockCreateServiceSkillRun.mockReset();
  mockGetServiceSkillRun.mockReset();
  mockIsTerminalServiceSkillRunStatus.mockReset();
  mockIsTerminalServiceSkillRunStatus.mockImplementation((status: string) =>
    ["success", "failed", "canceled", "timeout"].includes(status),
  );
  mockCreateContent.mockResolvedValue({
    id: "content-created-by-service-skill",
  });
  mockListProjects.mockResolvedValue([createProject()]);
  mockRecordServiceSkillAutomationLink.mockReset();
  mockToastSuccess.mockReset();
  mockToastError.mockReset();
  mockToastInfo.mockReset();
  mockToastLoading.mockReset();
  mockToastLoading.mockImplementation(() => "toast-loading");
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

describe("useWorkspaceServiceSkillEntryActions", () => {
  it("站点型技能主按钮应进入 Claw 工作区并复用当前主稿", async () => {
    const onNavigate = vi.fn();
    const recordServiceSkillUsage = vi.fn();
    const { render, getValue } = renderHook({
      onNavigate,
      recordServiceSkillUsage,
    });
    await render();

    await act(async () => {
      await getValue().handleServiceSkillLaunch(createBrowserServiceSkill(), {
        repository_query: "browser assist mcp",
      });
    });

    expect(mockCreateContent).not.toHaveBeenCalled();
    expect(onNavigate).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        projectId: "project-1",
        contentId: "content-current",
        theme: "general",
        lockTheme: true,
        initialRequestMetadata: undefined,
        initialCreationMode: "guided",
        newChatAt: expect.any(Number),
        autoRunInitialPromptOnMount: true,
        initialUserPrompt: "你帮我在 GitHub 找一下和“browser assist mcp”相关的项目。",
        initialAutoSendRequestMetadata: {
          harness: {
            browser_requirement: "required",
            browser_requirement_reason: expect.stringContaining(
              "真实浏览器页面",
            ),
            browser_assist: {
              enabled: true,
              profile_key: "attached-github",
              preferred_backend: "lime_extension_bridge",
              auto_launch: false,
              stream_mode: "both",
            },
            service_skill_launch: expect.objectContaining({
              adapter_name: "github/search",
              skill_title: "GitHub 仓库线索检索",
              content_id: "content-current",
              project_id: "project-1",
              save_mode: "current_content",
              args: {
                query: "browser assist mcp",
                limit: 10,
              },
              launch_readiness: expect.objectContaining({
                status: "ready",
                profile_key: "attached-github",
                target_id: "tab-github",
              }),
            }),
          },
        },
      }),
    );
    const firstSiteSkillLaunchPayload = onNavigate.mock.calls.find(
      ([route]) => route === "agent",
    )?.[1];
    expect(firstSiteSkillLaunchPayload?.initialUserPrompt).not.toContain(
      "[站点技能启动上下文]",
    );
    expect(firstSiteSkillLaunchPayload?.initialUserPrompt).not.toContain(
      "adapter_name",
    );
    expect(firstSiteSkillLaunchPayload?.initialAutoSendRequestMetadata).not.toHaveProperty(
      "artifact",
    );
    expect(recordServiceSkillUsage).toHaveBeenCalledWith({
      skillId: "github-repo-radar",
      runnerType: "instant",
    });
  });

  it("站点型技能进入工作区时应把当前 Team 注入自动发送 metadata", async () => {
    const onNavigate = vi.fn();
    const { render, getValue } = renderHook({
      onNavigate,
      recordServiceSkillUsage: vi.fn(),
      preferredTeamPresetId: "research-duo",
      selectedTeam: DEFAULT_SELECTED_TEAM,
      selectedTeamLabel: "研究双人组",
      selectedTeamSummary: "研究员负责检索，分析员负责整理。",
    });
    await render();

    await act(async () => {
      await getValue().handleServiceSkillLaunch(createBrowserServiceSkill(), {
        repository_query: "browser assist mcp",
      });
    });

    expect(onNavigate).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        initialAutoSendRequestMetadata: {
          harness: expect.objectContaining({
            service_skill_launch: expect.objectContaining({
              adapter_name: "github/search",
            }),
            preferred_team_preset_id: "research-duo",
            selected_team_id: "team-research-duo",
            selected_team_source: "builtin",
            selected_team_label: "研究双人组",
            selected_team_description: "负责检索和整理结果。",
            selected_team_summary: "研究员负责检索，分析员负责整理。",
            selected_team_roles: [
              expect.objectContaining({
                id: "researcher",
                label: "研究员",
              }),
              expect.objectContaining({
                id: "analyst",
                label: "分析员",
                role_key: "analyst",
              }),
            ],
          }),
        },
      }),
    );
  });

  it("站点型技能次级动作才应跳到浏览器工作台", async () => {
    const onNavigate = vi.fn();
    const recordServiceSkillUsage = vi.fn();
    const { render, getValue } = renderHook({
      onNavigate,
      recordServiceSkillUsage,
    });
    await render();

    await act(async () => {
      await getValue().handleServiceSkillBrowserRuntimeLaunch(
        createBrowserServiceSkill(),
        {
          repository_query: "browser assist mcp",
        },
      );
    });

    expect(onNavigate).toHaveBeenCalledWith("browser-runtime", {
      projectId: "project-1",
      contentId: "content-current",
      initialProfileKey: "attached-github",
      initialTargetId: "tab-github",
      initialAdapterName: "github/search",
      initialArgs: {
        query: "browser assist mcp",
        limit: 10,
      },
      initialAutoRun: true,
      initialRequireAttachedSession: true,
      initialSaveTitle: undefined,
    });
    expect(recordServiceSkillUsage).toHaveBeenCalledWith({
      skillId: "github-repo-radar",
      runnerType: "instant",
    });
  });

  it("站点型技能缺少附着会话时应留在入口层并提示先准备浏览器", async () => {
    const onNavigate = vi.fn();
    const { render, getValue } = renderHook({
      onNavigate,
      recordServiceSkillUsage: vi.fn(),
    });
    mockSiteGetAdapterLaunchReadiness.mockResolvedValueOnce({
      status: "requires_browser_runtime",
      adapter: "github/search",
      domain: "github.com",
      message: "当前没有检测到已附着到真实浏览器的 github.com 页面。",
      report_hint: "请先去浏览器工作台连接真实浏览器。",
    });
    await render();

    await act(async () => {
      await getValue().handleServiceSkillLaunch(createBrowserServiceSkill(), {
        repository_query: "browser assist mcp",
      });
    });

    expect(onNavigate).not.toHaveBeenCalledWith(
      "agent",
      expect.anything(),
    );
    expect(mockToastInfo).toHaveBeenCalledWith(
      expect.stringContaining("请先去浏览器工作台连接真实浏览器"),
    );
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("cloud_required 服务型技能成功后应回流本地工作区", async () => {
    const onNavigate = vi.fn();
    const recordServiceSkillUsage = vi.fn();
    mockCreateServiceSkillRun.mockResolvedValue({
      id: "service-skill-run-cloud-1",
      status: "success",
      outputSummary: "云端结果已生成",
      outputText: "# 云端视频配音\n\n第一版成稿",
      finishedAt: "2026-03-26T01:02:03.000Z",
    });

    const { render, getValue } = renderHook({
      activeTheme: "video",
      onNavigate,
      recordServiceSkillUsage,
    });
    await render();

    await act(async () => {
      await getValue().handleServiceSkillLaunch(createCloudServiceSkill(), {
        reference_video: "https://example.com/cloud-video",
      });
    });

    expect(mockCreateServiceSkillRun).toHaveBeenCalledWith(
      "cloud-video-dubbing",
      expect.stringContaining("[技能任务] 云端视频配音"),
    );
    expect(mockCreateServiceSkillRun).toHaveBeenCalledWith(
      "cloud-video-dubbing",
      expect.stringContaining("- 参考视频链接/素材: https://example.com/cloud-video"),
    );
    expect(mockCreateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: "project-1",
        title: "云端视频配音",
        content_type: "episode",
        body: "# 云端视频配音\n\n第一版成稿",
        metadata: expect.objectContaining({
          source: "service_skill",
          serviceSkill: expect.objectContaining({
            id: "cloud-video-dubbing",
            executionLocation: "cloud_required",
            themeTarget: "video",
          }),
          cloudRun: expect.objectContaining({
            id: "service-skill-run-cloud-1",
            status: "success",
            outputSummary: "云端结果已生成",
            finishedAt: "2026-03-26T01:02:03.000Z",
          }),
        }),
      }),
    );
    expect(onNavigate).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        projectId: "project-1",
        contentId: "content-created-by-service-skill",
        theme: "video",
        initialCreationMode: "guided",
        initialRequestMetadata: {
          artifact: {
            artifact_mode: "draft",
            artifact_kind: "brief",
            workbench_surface: "right_panel",
          },
        },
      }),
    );
    expect(recordServiceSkillUsage).toHaveBeenCalledWith({
      skillId: "cloud-video-dubbing",
      runnerType: "instant",
    });
    expect(mockToastLoading).toHaveBeenCalledWith(
      "正在提交 云端视频配音 到云端...",
    );
    expect(mockToastSuccess).toHaveBeenCalledWith(
      "云端视频配音 云端运行完成：云端结果已生成，正在回流本地工作区。",
      {
        id: "toast-loading",
      },
    );
  });

  it("普通技能进入工作区时应在保留 seed metadata 的同时注入当前 Team", async () => {
    const onNavigate = vi.fn();
    const { render, getValue } = renderHook({
      onNavigate,
      recordServiceSkillUsage: vi.fn(),
      preferredTeamPresetId: "research-duo",
      selectedTeam: DEFAULT_SELECTED_TEAM,
      selectedTeamLabel: "研究双人组",
      selectedTeamSummary: "研究员负责检索，分析员负责整理。",
    });
    await render();

    await act(async () => {
      await getValue().handleServiceSkillLaunch(createScheduledServiceSkill(), {
        platform: "x",
        industry_keywords: "AI Agent",
        schedule_time: "每天 09:00",
      });
    });

    expect(onNavigate).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        theme: "social-media",
        initialRequestMetadata: {
          artifact: {
            artifact_mode: "draft",
            artifact_kind: "analysis",
            workbench_surface: "right_panel",
          },
          harness: expect.objectContaining({
            preferred_team_preset_id: "research-duo",
            selected_team_id: "team-research-duo",
            selected_team_source: "builtin",
            selected_team_label: "研究双人组",
            selected_team_description: "负责检索和整理结果。",
            selected_team_summary: "研究员负责检索，分析员负责整理。",
            selected_team_roles: [
              expect.objectContaining({
                id: "researcher",
                label: "研究员",
              }),
              expect.objectContaining({
                id: "analyst",
                label: "分析员",
                role_key: "analyst",
              }),
            ],
          }),
        },
      }),
    );
  });

  it("本地自动化型技能在已有 contentId 时应复用当前主稿创建任务并进入工作区", async () => {
    const onNavigate = vi.fn();
    const recordServiceSkillUsage = vi.fn();
    const { render, getValue } = renderHook({
      onNavigate,
      recordServiceSkillUsage,
    });
    await render();

    await act(async () => {
      await getValue().handleServiceSkillAutomationSetup(
        createScheduledServiceSkill(),
        {
          platform: "x",
          industry_keywords: "AI Agent，创作者工具",
          schedule_time: "每天 09:00",
        },
      );
    });

    expect(getValue().automationDialogOpen).toBe(true);

    await act(async () => {
      await getValue().handleAutomationDialogSubmit({
        mode: "create",
        request: {
          name: "每日趋势摘要｜定时执行",
          description: "围绕指定平台与关键词输出趋势摘要。",
          workspace_id: "project-1",
          execution_mode: "skill",
          schedule: {
            kind: "cron",
            expr: "00 09 * * *",
            tz: "Asia/Shanghai",
          },
          payload: {
            kind: "agent_turn",
            prompt: "自动化 prompt",
            system_prompt: "",
            web_search: false,
          },
          delivery: {
            mode: "none",
            best_effort: true,
            output_schema: "text",
            output_format: "text",
          },
        },
      });
    });

    expect(mockCreateContent).not.toHaveBeenCalled();
    expect(mockCreateAutomationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: "project-1",
        execution_mode: "skill",
        payload: expect.objectContaining({
          kind: "agent_turn",
          content_id: "content-current",
          request_metadata: expect.objectContaining({
            service_skill: expect.objectContaining({
              id: "daily-trend-briefing",
              title: "每日趋势摘要",
              runner_type: "scheduled",
              slot_values: [
                {
                  key: "platform",
                  label: "监测平台",
                  value: "X / Twitter",
                },
                {
                  key: "industry_keywords",
                  label: "行业关键词",
                  value: "AI Agent，创作者工具",
                },
                {
                  key: "schedule_time",
                  label: "推送时间",
                  value: "每天 09:00",
                },
              ],
              slot_summary: [
                "监测平台: X / Twitter",
                "行业关键词: AI Agent，创作者工具",
                "推送时间: 每天 09:00",
              ],
              user_input: "请结合当前上下文继续",
            }),
            harness: expect.objectContaining({
              theme: "social-media",
              session_mode: "theme_workbench",
              content_id: "content-current",
            }),
          }),
        }),
      }),
    );
    expect(mockRecordServiceSkillAutomationLink).toHaveBeenCalledWith({
      skillId: "daily-trend-briefing",
      jobId: "automation-job-1",
      jobName: "每日趋势摘要｜定时执行",
    });
    expect(recordServiceSkillUsage).toHaveBeenCalledWith({
      skillId: "daily-trend-briefing",
      runnerType: "scheduled",
    });
    expect(onNavigate).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        projectId: "project-1",
        contentId: "content-current",
        theme: "social-media",
        initialCreationMode: "guided",
        initialUserPrompt: expect.stringContaining("[技能任务] 每日趋势摘要"),
        autoRunInitialPromptOnMount: true,
      }),
    );
  });
});
