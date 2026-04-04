import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmptyState } from "./EmptyState";
import type { Character } from "@/lib/api/memory";
import type { Skill } from "@/lib/api/skills";
import type { ServiceSkillHomeItem } from "../service-skills/types";
import { composeEntryPrompt } from "../utils/entryPromptComposer";

const { mockGetConfig } = vi.hoisted(() => ({
  mockGetConfig: vi.fn(async () => ({})),
}));

const mockCharacterMention =
  vi.fn<
    (props: {
      characters?: Character[];
      skills?: Skill[];
      serviceSkills?: ServiceSkillHomeItem[];
      onSelectSkill?: (skill: Skill) => void;
      onSelectServiceSkill?: (skill: ServiceSkillHomeItem) => void;
      value: string;
      onChange: (value: string) => void;
    }) => React.ReactNode
  >();

vi.mock("@/lib/api/appConfig", () => ({
  getConfig: mockGetConfig,
}));

vi.mock("./ChatModelSelector", () => ({
  ChatModelSelector: () => <div data-testid="chat-model-selector" />,
}));

vi.mock("../utils/entryPromptComposer", () => ({
  composeEntryPrompt: vi.fn(() => ""),
  createDefaultEntrySlotValues: vi.fn(() => ({})),
  formatEntryTaskPreview: vi.fn(() => ""),
  getEntryTaskTemplate: vi.fn(() => ({
    slots: [],
    description: "",
    label: "",
  })),
  SOCIAL_MEDIA_ENTRY_TASKS: [],
  validateEntryTaskSlots: vi.fn(() => ({ valid: true, missing: [] })),
}));

vi.mock("../utils/contextualRecommendations", () => ({
  buildRecommendationPrompt: vi.fn((fullPrompt: string) => fullPrompt),
  getContextualRecommendations: vi.fn(() => []),
}));

vi.mock("./Inputbar/components/CharacterMention", () => ({
  CharacterMention: (props: {
    characters?: Character[];
    skills?: Skill[];
    serviceSkills?: ServiceSkillHomeItem[];
    onSelectSkill?: (skill: Skill) => void;
    onSelectServiceSkill?: (skill: ServiceSkillHomeItem) => void;
    value: string;
    onChange: (value: string) => void;
  }) => {
    mockCharacterMention(props);
    return <div data-testid="character-mention-stub" />;
  },
}));

vi.mock("./Inputbar/components/SkillSelector", () => ({
  SkillSelector: () => <div data-testid="skill-selector-stub" />,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    ...rest
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    [key: string]: unknown;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: ({
    value,
    onChange,
    placeholder,
  }: {
    value?: string;
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
    placeholder?: string;
  }) => <input value={value} onChange={onChange} placeholder={placeholder} />,
}));

vi.mock("@/components/ui/textarea", () => {
  const Textarea = React.forwardRef<
    HTMLTextAreaElement,
    React.TextareaHTMLAttributes<HTMLTextAreaElement>
  >((props, ref) => <textarea ref={ref} {...props} />);
  return { Textarea };
});

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectItem: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
  SelectValue: () => null,
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mockGetConfig.mockImplementation(async () => ({}));
  window.localStorage.clear();
});

afterEach(() => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) break;
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  window.localStorage.clear();
  vi.clearAllMocks();
});

function renderEmptyState(
  props?: Partial<React.ComponentProps<typeof EmptyState>>,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const defaultProps: React.ComponentProps<typeof EmptyState> = {
    input: "",
    setInput: vi.fn(),
    onSend: vi.fn(),
    providerType: "openai",
    setProviderType: vi.fn(),
    model: "gpt-4.1",
    setModel: vi.fn(),
  };

  act(() => {
    root.render(<EmptyState {...defaultProps} {...props} />);
  });

  mountedRoots.push({ root, container });
  return container;
}

function createGithubSearchServiceSkill(): ServiceSkillHomeItem {
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

describe("EmptyState", () => {
  it("新建任务首页不应再显示旧 Claw 首页品牌文案", async () => {
    const container = renderEmptyState({
      activeTheme: "general",
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain("新建任务");
    expect(container.textContent).toContain("开始一个新任务");
    expect(container.textContent).not.toContain("青柠一下，灵感即来");
    expect(container.textContent).not.toContain("CLAW WORKSPACE");
  });

  it("通用首页应展示推荐方案并替换旧快速启动内容", async () => {
    const container = renderEmptyState({
      activeTheme: "general",
      onLaunchBrowserAssist: vi.fn(),
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain("推荐方案");
    expect(container.textContent).toContain("浏览器协助办事");
    expect(container.textContent).toContain("网页研究简报");
    expect(container.textContent).toContain("社媒主稿生成");
    expect(container.textContent).toContain("前端概念方案");
    expect(container.textContent).toContain("演示提纲草案");
    expect(container.textContent).toContain("多代理拆任务");
    expect(container.textContent).not.toContain("生成配图");
    expect(container.textContent).not.toContain("Team 冒烟测试");
  });

  it("点击网页研究简报应开启联网搜索并记录最近使用", async () => {
    const setInput = vi.fn<(value: string) => void>();
    const onWebSearchEnabledChange = vi.fn<(enabled: boolean) => void>();
    const container = renderEmptyState({
      activeTheme: "general",
      setInput,
      onWebSearchEnabledChange,
    });

    await act(async () => {
      await Promise.resolve();
    });

    const card = container.querySelector(
      '[data-testid="home-recommended-web-research-brief"]',
    ) as HTMLDivElement | null;
    expect(card).toBeTruthy();

    act(() => {
      card?.click();
    });

    expect(onWebSearchEnabledChange).toHaveBeenCalledWith(true);
    expect(setInput).toHaveBeenCalledWith(
      "请围绕这个主题先给我做一版网页研究简报：明确研究目标、关键信息来源、核心发现、风险点，以及接下来最值得继续追踪的问题。",
    );
    expect(container.textContent).toContain("最近使用");
  });

  it("点击社媒主稿生成应切换到社媒主题并写入起始动作", async () => {
    const setInput = vi.fn<(value: string) => void>();
    const onThemeChange = vi.fn<(theme: string) => void>();
    const container = renderEmptyState({
      activeTheme: "general",
      setInput,
      onThemeChange,
    });

    await act(async () => {
      await Promise.resolve();
    });

    const card = container.querySelector(
      '[data-testid="home-recommended-social-post-starter"]',
    ) as HTMLDivElement | null;
    expect(card).toBeTruthy();

    act(() => {
      card?.click();
    });

    expect(onThemeChange).toHaveBeenCalledWith("social-media");
    expect(setInput).toHaveBeenCalledWith(
      "请先帮我起草一版社媒内容首稿：明确目标受众、平台语境、标题方向、正文结构和可继续扩写的角度。",
    );
  });

  it("点击浏览器协助办事应打开浏览器工作台并写入起始动作", async () => {
    const setInput = vi.fn<(value: string) => void>();
    const onLaunchBrowserAssist = vi.fn();
    const container = renderEmptyState({
      activeTheme: "general",
      setInput,
      onLaunchBrowserAssist,
    });

    await act(async () => {
      await Promise.resolve();
    });

    const card = container.querySelector(
      '[data-testid="home-recommended-browser-assist-task"]',
    ) as HTMLDivElement | null;
    expect(card).toBeTruthy();

    act(() => {
      card?.click();
    });

    expect(onLaunchBrowserAssist).toHaveBeenCalledTimes(1);
    expect(setInput).toHaveBeenCalledWith(
      "请协助我完成一个浏览器任务：先明确目标网页、目标动作、约束条件和预期结果，再进入执行。",
    );
  });

  it("点击多代理拆任务应开启多代理偏好并写入起始动作", async () => {
    const setInput = vi.fn<(value: string) => void>();
    const onSubagentEnabledChange = vi.fn<(enabled: boolean) => void>();
    const container = renderEmptyState({
      activeTheme: "general",
      setInput,
      onSubagentEnabledChange,
      subagentEnabled: false,
    });

    await act(async () => {
      await Promise.resolve();
    });

    const card = container.querySelector(
      '[data-testid="home-recommended-team-breakdown"]',
    ) as HTMLDivElement | null;
    expect(card).toBeTruthy();

    act(() => {
      card?.click();
    });

    expect(onSubagentEnabledChange).toHaveBeenCalledWith(true);
    expect(setInput).toHaveBeenCalledWith(
      "请把这个任务按多代理方式拆解：先定义目标和约束，再拆成并行子任务，明确每个子代理的职责、产出和回收方式。",
    );
  });

  it("应挂载 CharacterMention，并透传角色与技能", async () => {
    const characters: Character[] = [
      {
        id: "char-1",
        project_id: "project-1",
        name: "角色A",
        aliases: [],
        relationships: [],
        is_main: true,
        order: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];
    const skills: Skill[] = [
      {
        key: "skill-1",
        name: "技能A",
        description: "desc",
        directory: "skill-a",
        installed: true,
        sourceKind: "builtin",
      },
    ];
    const setInput = vi.fn<(value: string) => void>();

    const container = renderEmptyState({
      input: "@",
      setInput,
      characters,
      skills,
    });
    await act(async () => {
      await Promise.resolve();
    });

    const mention = container.querySelector(
      '[data-testid="character-mention-stub"]',
    );
    expect(mention).toBeTruthy();
    expect(mockCharacterMention.mock.calls.length).toBeGreaterThan(0);
    const latestCall =
      mockCharacterMention.mock.calls[
        mockCharacterMention.mock.calls.length - 1
      ][0];
    expect(latestCall.characters).toEqual(characters);
    expect(latestCall.skills).toEqual(skills);

    act(() => {
      latestCall.onChange("@技能A");
    });
    expect(setInput).toHaveBeenCalledWith("@技能A");
  });

  it("应把服务型技能与选择回调透传给 CharacterMention", async () => {
    const serviceSkills: ServiceSkillHomeItem[] = [
      {
        id: "daily-trend-briefing",
        title: "每日趋势摘要",
        summary: "围绕指定平台与关键词输出趋势摘要。",
        entryHint: "把平台和关键词给我，我先整理一份趋势报告。",
        aliases: ["趋势报告"],
        category: "社媒运营",
        outputHint: "趋势摘要 + 调度建议",
        source: "cloud_catalog",
        runnerType: "scheduled",
        defaultExecutorBinding: "automation_job",
        executionLocation: "client_default",
        slotSchema: [],
        surfaceScopes: ["home", "mention", "workspace"],
        promptTemplateKey: "trend_briefing",
        version: "seed-v1",
        badge: "云目录",
        recentUsedAt: null,
        isRecent: false,
        runnerLabel: "本地计划任务",
        runnerTone: "sky",
        runnerDescription:
          "当前先进入工作区生成首版任务方案，后续再接本地自动化。",
        actionLabel: "先做方案",
        automationStatus: null,
      },
    ];
    const onSelectServiceSkill = vi.fn<(skill: ServiceSkillHomeItem) => void>();

    renderEmptyState({
      input: "@",
      serviceSkills,
      onSelectServiceSkill,
    });
    await act(async () => {
      await Promise.resolve();
    });

    const latestCall =
      mockCharacterMention.mock.calls[
        mockCharacterMention.mock.calls.length - 1
      ][0];
    expect(latestCall.serviceSkills).toEqual(serviceSkills);
    expect(typeof latestCall.onSelectServiceSkill).toBe("function");

    act(() => {
      latestCall.onSelectServiceSkill?.(serviceSkills[0]!);
    });

    expect(onSelectServiceSkill).toHaveBeenCalledWith(serviceSkills[0]!);
  });

  it("选择技能后发送应自动附加 skill 前缀，且发送后清除激活技能", async () => {
    const onSend =
      vi.fn<
        (
          value: string,
          executionStrategy?: "react" | "code_orchestrated" | "auto",
          images?: unknown[],
        ) => void
      >();
    const skill: Skill = {
      key: "canvas-design",
      name: "canvas-design",
      description: "desc",
      directory: "canvas-design",
      installed: true,
      sourceKind: "builtin",
    };

    const container = renderEmptyState({
      input: "帮我设计封面",
      onSend,
      skills: [skill],
    });
    await act(async () => {
      await Promise.resolve();
    });

    const latestCall =
      mockCharacterMention.mock.calls[
        mockCharacterMention.mock.calls.length - 1
      ][0];
    expect(typeof latestCall.onSelectSkill).toBe("function");

    act(() => {
      latestCall.onSelectSkill?.(skill);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain("已挂载 canvas-design");

    const sendButton = container.querySelector(
      'button[aria-label="发送"]',
    ) as HTMLButtonElement | null;
    expect(sendButton).toBeTruthy();

    act(() => {
      sendButton?.click();
    });
    expect(onSend).toHaveBeenCalledWith(
      "/canvas-design 帮我设计封面",
      "react",
      undefined,
    );

    act(() => {
      sendButton?.click();
    });
    expect(onSend).toHaveBeenCalledWith("帮我设计封面", "react", undefined);
  });

  it("首页技能卡应复用统一的技能数量文案", async () => {
    const container = renderEmptyState({
      skills: [
        {
          key: "writer",
          name: "写作助手",
          description: "desc",
          directory: "writer",
          installed: true,
          sourceKind: "builtin",
        },
      ],
      serviceSkills: [
        {
          id: "trend-briefing",
          title: "趋势情报",
          summary: "输出趋势摘要",
          category: "研究",
          outputHint: "摘要",
          source: "cloud_catalog",
          runnerType: "instant",
          defaultExecutorBinding: "browser_assist",
          executionLocation: "client_default",
          slotSchema: [],
          version: "seed-v1",
          badge: "云目录",
          recentUsedAt: null,
          isRecent: false,
          runnerLabel: "浏览器执行",
          runnerTone: "emerald",
          runnerDescription: "复用登录态完成情报任务。",
          actionLabel: "开始执行",
          automationStatus: null,
        },
      ],
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain("2 项技能可挂载");
  });

  it("通用对话且存在站点型 service skill 时，应展示自然句占位示例", async () => {
    const container = renderEmptyState({
      serviceSkills: [createGithubSearchServiceSkill()],
    });

    await act(async () => {
      await Promise.resolve();
    });

    const textarea = container.querySelector("textarea");
    expect(textarea?.getAttribute("placeholder")).toContain(
      "帮我用 GitHub 查一下 AI Agent 项目",
    );
  });

  it("点击地球按钮应切换联网搜索开关", async () => {
    const onWebSearchEnabledChange = vi.fn<(enabled: boolean) => void>();
    const container = renderEmptyState({
      webSearchEnabled: false,
      onWebSearchEnabledChange,
    });
    await act(async () => {
      await Promise.resolve();
    });

    const globeToggle = container.querySelector(
      'button[title="联网搜索已关闭"]',
    ) as HTMLButtonElement | null;
    expect(globeToggle).toBeTruthy();

    act(() => {
      globeToggle?.click();
    });

    expect(onWebSearchEnabledChange).toHaveBeenCalledWith(true);
  });

  it("社媒主题发送时应默认走 social_post_with_cover skill", async () => {
    const onSend =
      vi.fn<
        (
          value: string,
          executionStrategy?: "react" | "code_orchestrated" | "auto",
          images?: unknown[],
        ) => void
      >();
    vi.mocked(composeEntryPrompt).mockReturnValue("请输出一篇新品社媒文案");

    const container = renderEmptyState({
      activeTheme: "social-media",
      onSend,
    });
    await act(async () => {
      await Promise.resolve();
    });

    const sendButton = container.querySelector(
      'button[aria-label="发送"]',
    ) as HTMLButtonElement | null;
    expect(sendButton).toBeTruthy();

    act(() => {
      sendButton?.click();
    });

    expect(onSend).toHaveBeenCalledWith(
      "/social_post_with_cover 请输出一篇新品社媒文案",
      "react",
      undefined,
    );
  });

  it("即使存在历史配置字段，社媒主题仍应自动注入默认 skill", async () => {
    mockGetConfig.mockImplementation(async () => ({
      chat_appearance: {},
    }));
    vi.mocked(composeEntryPrompt).mockReturnValue("请输出一篇用户访谈纪要");

    const onSend =
      vi.fn<
        (
          value: string,
          executionStrategy?: "react" | "code_orchestrated" | "auto",
          images?: unknown[],
        ) => void
      >();
    const container = renderEmptyState({
      activeTheme: "social-media",
      onSend,
    });
    await act(async () => {
      await Promise.resolve();
    });

    const sendButton = container.querySelector(
      'button[aria-label="发送"]',
    ) as HTMLButtonElement | null;
    expect(sendButton).toBeTruthy();

    act(() => {
      sendButton?.click();
    });

    expect(onSend).toHaveBeenCalledWith(
      "/social_post_with_cover 请输出一篇用户访谈纪要",
      "react",
      undefined,
    );
  });

  it("社媒主题手动选择 skill 时应优先使用手动 skill", async () => {
    const onSend =
      vi.fn<
        (
          value: string,
          executionStrategy?: "react" | "code_orchestrated" | "auto",
          images?: unknown[],
        ) => void
      >();
    vi.mocked(composeEntryPrompt).mockReturnValue("请输出一篇品牌故事");
    const skill: Skill = {
      key: "custom-social-skill",
      name: "custom-social-skill",
      description: "desc",
      directory: "custom-social-skill",
      installed: true,
      sourceKind: "builtin",
    };

    const container = renderEmptyState({
      activeTheme: "social-media",
      onSend,
      skills: [skill],
    });
    await act(async () => {
      await Promise.resolve();
    });

    const latestCall =
      mockCharacterMention.mock.calls[
        mockCharacterMention.mock.calls.length - 1
      ][0];
    act(() => {
      latestCall.onSelectSkill?.(skill);
    });

    const sendButton = container.querySelector(
      'button[aria-label="发送"]',
    ) as HTMLButtonElement | null;
    expect(sendButton).toBeTruthy();

    act(() => {
      sendButton?.click();
    });

    expect(onSend).toHaveBeenCalledWith(
      "/custom-social-skill 请输出一篇品牌故事",
      "react",
      undefined,
    );
  });

  it("通用主题工具栏应包含附件、思考、Plan 与多代理开关", async () => {
    const onThinkingEnabledChange = vi.fn<(enabled: boolean) => void>();
    const onSubagentEnabledChange = vi.fn<(enabled: boolean) => void>();
    const setExecutionStrategy = vi.fn<
      (strategy: "react" | "code_orchestrated" | "auto") => void
    >();
    const container = renderEmptyState({
      activeTheme: "general",
      thinkingEnabled: false,
      onThinkingEnabledChange,
      subagentEnabled: false,
      onSubagentEnabledChange,
      executionStrategy: "react",
      setExecutionStrategy,
    });
    await act(async () => {
      await Promise.resolve();
    });

    const attachButton = container.querySelector(
      'button[title="添加图片"]',
    ) as HTMLButtonElement | null;
    expect(attachButton).toBeTruthy();

    const thinkingButton = container.querySelector(
      'button[title="深度思考已关闭"]',
    ) as HTMLButtonElement | null;
    expect(thinkingButton).toBeTruthy();
    const planButton = container.querySelector(
      '[data-testid="inputbar-plan-toggle"]',
    ) as HTMLButtonElement | null;
    expect(planButton).toBeTruthy();
    const subagentButton = container.querySelector(
      'button[title="多代理偏好已关闭"]',
    ) as HTMLButtonElement | null;
    expect(subagentButton).toBeTruthy();

    act(() => {
      thinkingButton?.click();
    });
    act(() => {
      planButton?.click();
    });
    act(() => {
      subagentButton?.click();
    });

    expect(onThinkingEnabledChange).toHaveBeenCalledWith(true);
    expect(setExecutionStrategy).toHaveBeenCalledWith("code_orchestrated");
    expect(onSubagentEnabledChange).toHaveBeenCalledWith(true);
  });

  it("通用主题应提供浏览器协助入口并触发启动回调", async () => {
    const onLaunchBrowserAssist = vi.fn();
    const container = renderEmptyState({
      activeTheme: "general",
      onLaunchBrowserAssist,
    });
    await act(async () => {
      await Promise.resolve();
    });

    const launchButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("打开浏览器工作台"),
    );
    expect(launchButton).toBeTruthy();

    act(() => {
      launchButton?.click();
    });

    expect(onLaunchBrowserAssist).toHaveBeenCalledTimes(1);
  });

  it("应允许外部覆盖 supportingSlot", async () => {
    const container = renderEmptyState({
      supportingSlotOverride: (
        <div data-testid="custom-supporting-slot">自定义入口层</div>
      ),
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="custom-supporting-slot"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("自定义入口层");
  });
});
