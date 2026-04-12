import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmptyState } from "./EmptyState";
import type { Character } from "@/lib/api/memory";
import type { Skill } from "@/lib/api/skills";
import type { ServiceSkillHomeItem } from "../service-skills/types";
import { recordSlashEntryUsage } from "../skill-selection/slashEntryUsage";
import { recordEntryRecommendedSolutionUsage } from "../utils/entryRecommendedSolutions";

const { mockGetConfig, mockProjectSelector } = vi.hoisted(() => ({
  mockGetConfig: vi.fn(async () => ({})),
  mockProjectSelector: vi.fn(),
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

vi.mock("@/components/projects/ProjectSelector", () => ({
  ProjectSelector: (props: {
    value: string | null;
    placeholder?: string;
    onChange?: (projectId: string) => void;
  }) => {
    mockProjectSelector(props);
    return (
      <div data-testid="project-selector-stub">
        {props.value ?? props.placeholder ?? "选择项目"}
      </div>
    );
  },
}));

vi.mock("./ChatModelSelector", () => ({
  ChatModelSelector: () => <div data-testid="chat-model-selector" />,
}));

vi.mock("../utils/contextualRecommendations", () => ({
  buildRecommendationPrompt: vi.fn((fullPrompt: string) => fullPrompt),
  getContextualRecommendations: vi.fn(() => []),
}));

vi.mock("../skill-selection/CharacterMention", () => ({
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

vi.mock("../skill-selection/SkillSelector", () => ({
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

function createSceneBoundServiceSkill(): ServiceSkillHomeItem {
  return {
    id: "project-insight-flow",
    title: "项目线索整理",
    summary: "围绕当前项目整理线索、结论和下一步动作。",
    category: "研究与方案",
    outputHint: "线索清单 + 下一步建议",
    source: "cloud_catalog",
    runnerType: "instant",
    defaultExecutorBinding: "cloud_scene",
    executionLocation: "cloud_required",
    version: "seed-v1",
    badge: "云目录",
    recentUsedAt: null,
    isRecent: false,
    runnerLabel: "云端场景执行",
    runnerTone: "emerald",
    runnerDescription: "围绕当前项目持续整理线索和结果。",
    actionLabel: "继续整理",
    automationStatus: null,
    slotSchema: [],
    sceneBinding: {
      sceneKey: "project-insight-flow",
      commandPrefix: "/project-insight-flow",
      title: "项目线索整理",
      summary: "围绕当前项目整理线索和下一步动作。",
    },
  };
}

describe("EmptyState", () => {
  it("首页应以 slogan 作为主视觉并保留创作语义", async () => {
    const container = renderEmptyState({
      activeTheme: "general",
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain("创作");
    expect(container.textContent).toContain("青柠一下，灵感即来");
    expect(container.textContent).toContain("说一句目标，剩下的交给 Lime。");
    expect(container.textContent).toContain(
      "文案、图片、视频、搜索和网页任务，会围绕同一个目标持续推进。",
    );
    expect(container.textContent).toContain(
      "跑通过的方法会沉淀成常用做法、偏好和项目上下文，下次不用重新开始。",
    );
    expect(container.textContent).not.toContain("新建任务");
  });

  it("通用首页应展示收口后的结果模板条", async () => {
    const container = renderEmptyState({
      activeTheme: "general",
      onLaunchBrowserAssist: vi.fn(),
      onSelectServiceSkill: vi.fn(),
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain("结果模板");
    expect(container.textContent).toContain("继续上次做法");
    expect(container.textContent).toContain(
      "先选你想拿到什么结果，具体由 Lime 在当前任务里分发对应能力。",
    );
    expect(container.textContent).toContain(
      "最近跑通过的结果模板和常用做法会留在这里，下一次不用重新开始。",
    );
    expect(container.textContent).toContain(
      "你最近跑通过的结果模板和方法，会出现在这里。",
    );
    expect(container.textContent).toContain("网页研究简报");
    expect(container.textContent).toContain("内容主稿生成");
    expect(container.textContent).toContain("演示提纲草案");
    expect(container.textContent).toContain("网页登录与采集");
    expect(container.textContent).toContain("复制轮播帖");
    expect(container.textContent).toContain("复制视频脚本");
    expect(container.textContent).not.toContain("前端概念方案");
    expect(container.textContent).not.toContain("多代理拆任务");
    expect(container.textContent).not.toContain("文章转 Slide 视频提纲");
    expect(container.textContent).not.toContain("云端视频配音");
    expect(container.textContent).not.toContain("视频配音成其他语言");
    expect(container.textContent).not.toContain("每日趋势摘要");
    expect(container.textContent).not.toContain("账号增长跟踪");
    expect(container.textContent).not.toContain("从这里开始");
    expect(container.textContent).not.toContain("快速启动");
    expect(container.textContent).not.toContain("生成配图");
    expect(container.textContent).not.toContain("浏览器任务起步");
    expect(container.textContent).not.toContain("Team 冒烟测试");
    expect(container.textContent).not.toContain("推荐方案");

    const recommendationTitles = Array.from(
      container.querySelectorAll(
        '[data-testid^="entry-recommended-"], [data-testid^="entry-service-skill-"]',
      ),
    ).map((element) => element.textContent?.trim());

    expect(recommendationTitles).toEqual([
      "网页研究简报",
      "内容主稿生成",
      "演示提纲草案",
      "网页登录与采集",
      "复制轮播帖",
      "复制视频脚本",
    ]);
    expect(
      container.querySelector('[data-testid^="entry-continuation-"]'),
    ).toBeNull();
  });

  it("有最近记录时应展示继续上次做法入口，并允许直接继续模板与方法", async () => {
    recordEntryRecommendedSolutionUsage("social-post-starter");
    const onSelectServiceSkill = vi.fn<(skill: ServiceSkillHomeItem) => void>();
    const setInput = vi.fn<(value: string) => void>();
    const recentMethod: ServiceSkillHomeItem = {
      ...createSceneBoundServiceSkill(),
      id: "content-iteration-flow",
      title: "内容迭代整理",
      recentUsedAt: 1_000,
      isRecent: true,
    };

    const container = renderEmptyState({
      activeTheme: "general",
      setInput,
      onSelectServiceSkill,
      serviceSkills: [recentMethod],
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain("继续上次做法");
    expect(container.textContent).toContain(
      "最近跑通过的结果模板和常用做法会留在这里，这次可以直接续上。",
    );

    const continuationItems = Array.from(
      container.querySelectorAll('[data-testid^="entry-continuation-"]'),
    ).map((element) => element.getAttribute("data-testid"));

    expect(continuationItems).toEqual([
      "entry-continuation-solution-social-post-starter",
      "entry-continuation-method-content-iteration-flow",
    ]);

    const recentTemplateButton = container.querySelector(
      '[data-testid="entry-continuation-solution-social-post-starter"]',
    ) as HTMLButtonElement | null;
    expect(recentTemplateButton).toBeTruthy();

    act(() => {
      recentTemplateButton?.click();
    });

    expect(setInput).toHaveBeenCalledWith(
      "请先帮我起草一版内容首稿：明确目标受众、标题方向、正文结构和可继续扩写的角度。",
    );

    const recentMethodButton = container.querySelector(
      '[data-testid="entry-continuation-method-content-iteration-flow"]',
    ) as HTMLButtonElement | null;
    expect(recentMethodButton).toBeTruthy();

    act(() => {
      recentMethodButton?.click();
    });

    expect(onSelectServiceSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "content-iteration-flow",
        title: "内容迭代整理",
      }),
    );
  });

  it("scene 最近使用记录也应把对应做法带回首页继续层", async () => {
    recordSlashEntryUsage({
      kind: "scene",
      entryId: "project-insight-flow",
      usedAt: 1_800_000_000_000,
      replayText: "继续帮我整理这个项目的关键信息和后续动作",
    });
    const onSelectServiceSkill = vi.fn<(skill: ServiceSkillHomeItem) => void>();
    const container = renderEmptyState({
      activeTheme: "general",
      serviceSkills: [createSceneBoundServiceSkill()],
      onSelectServiceSkill,
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain("继续上次做法");
    const sceneContinuationButton = container.querySelector(
      '[data-testid="entry-continuation-method-project-insight-flow"]',
    ) as HTMLButtonElement | null;
    expect(sceneContinuationButton).toBeTruthy();

    act(() => {
      sceneContinuationButton?.click();
    });

    expect(onSelectServiceSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "project-insight-flow",
        title: "项目线索整理",
      }),
    );
  });

  it("传入项目切换能力时应继续保留项目选择器入口", async () => {
    const container = renderEmptyState({
      activeTheme: "general",
      projectId: "project-brand",
      onProjectChange: vi.fn(),
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="project-selector-stub"]'),
    ).toBeTruthy();
    expect(container.textContent).not.toContain("当前项目");
    expect(
      container.querySelector('[data-testid^="entry-project-continuation-"]'),
    ).toBeNull();
  });

  it("通用首页应继续渲染 4 个带视觉预览的支撑能力入口", async () => {
    const container = renderEmptyState({
      activeTheme: "general",
      onLaunchBrowserAssist: vi.fn(),
    });

    await act(async () => {
      await Promise.resolve();
    });

    const expectedLabels = ["我的方法", "持续流程", "多代理", "浏览器接入"];
    const expectedAlts = [
      "方法能力卡占位图",
      "持续流程能力卡占位图",
      "多代理协作能力卡占位图",
      "浏览器接入能力卡占位图",
    ];

    for (const label of expectedLabels) {
      expect(container.textContent).toContain(label);
    }

    expect(container.textContent).toContain("重复任务可持续复用");
    expect(container.textContent).toContain("复杂任务可拆分并行推进");
    expect(container.textContent).toContain("网页登录与网页执行");

    for (const alt of expectedAlts) {
      const image = container.querySelector(`img[alt="${alt}"]`);
      expect(image).toBeTruthy();
      expect(image?.getAttribute("src")).toBeTruthy();
    }

    expect(container.textContent).not.toContain("连接浏览器");
  });

  it("点击浏览器能力卡图片应触发浏览器接入", async () => {
    const onLaunchBrowserAssist = vi.fn();
    const container = renderEmptyState({
      activeTheme: "general",
      onLaunchBrowserAssist,
    });

    await act(async () => {
      await Promise.resolve();
    });

    const mediaButton = container.querySelector(
      'button[aria-label="连接浏览器"]',
    ) as HTMLButtonElement | null;
    expect(mediaButton).toBeTruthy();

    act(() => {
      mediaButton?.click();
    });

    expect(onLaunchBrowserAssist).toHaveBeenCalledTimes(1);
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
      '[data-testid="entry-recommended-web-research-brief"]',
    ) as HTMLDivElement | null;
    expect(card).toBeTruthy();

    act(() => {
      card?.click();
    });

    expect(onWebSearchEnabledChange).toHaveBeenCalledWith(true);
    expect(setInput).toHaveBeenCalledWith(
      "请围绕这个主题先给我做一版网页研究简报：明确研究目标、关键信息来源、核心发现、风险点，以及接下来最值得继续追踪的问题。",
    );
  });

  it("点击内容主稿生成应直接写入起始动作，不再切换旧主题", async () => {
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
      '[data-testid="entry-recommended-social-post-starter"]',
    ) as HTMLDivElement | null;
    expect(card).toBeTruthy();

    act(() => {
      card?.click();
    });

    expect(onThemeChange).not.toHaveBeenCalled();
    expect(setInput).toHaveBeenCalledWith(
      "请先帮我起草一版内容首稿：明确目标受众、标题方向、正文结构和可继续扩写的角度。",
    );
  });

  it("点击网页登录与采集应触发浏览器接入并写入起始动作", async () => {
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
      '[data-testid="entry-recommended-browser-assist-task"]',
    ) as HTMLDivElement | null;
    expect(card).toBeTruthy();

    act(() => {
      card?.click();
    });

    expect(onLaunchBrowserAssist).toHaveBeenCalledTimes(1);
    expect(setInput).toHaveBeenCalledWith(
      "请协助我完成一个浏览器任务：先明确目标网页、目标动作、约束条件和预期结果，并在当前对话里继续执行。",
    );
  });

  it("指定 service skill 即使未从运行时目录注入，也应从 seeded 目录拼接到首页精选区尾部", async () => {
    const onSelectServiceSkill = vi.fn<(skill: ServiceSkillHomeItem) => void>();
    const container = renderEmptyState({
      activeTheme: "general",
      serviceSkills: [createGithubSearchServiceSkill()],
      onSelectServiceSkill,
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain("复制视频脚本");
    expect(container.textContent).not.toContain("GitHub 仓库线索检索");

    const card = container.querySelector(
      '[data-testid="entry-service-skill-short-video-script-replication"]',
    ) as HTMLButtonElement | null;
    expect(card).toBeTruthy();

    act(() => {
      card?.click();
    });

    expect(onSelectServiceSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "short-video-script-replication",
        title: "复制视频脚本",
      }),
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
        category: "内容运营",
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

  it("首页方法卡应复用统一的做法数量文案", async () => {
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

    expect(container.textContent).toContain("2 套做法可直接复用");
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

  it("点击高级设置中的地球按钮应切换联网搜索开关", async () => {
    const onWebSearchEnabledChange = vi.fn<(enabled: boolean) => void>();
    const container = renderEmptyState({
      activeTheme: "general",
      webSearchEnabled: false,
      onWebSearchEnabledChange,
    });
    await act(async () => {
      await Promise.resolve();
    });

    const advancedToggle = container.querySelector(
      '[data-testid="empty-state-advanced-toggle"]',
    ) as HTMLButtonElement | null;
    expect(advancedToggle).toBeTruthy();
    const globeToggle = container.querySelector(
      'button[title="联网搜索已关闭"]',
    ) as HTMLButtonElement | null;
    expect(globeToggle).toBeNull();

    act(() => {
      advancedToggle?.click();
    });

    const expandedGlobeToggle = container.querySelector(
      'button[title="联网搜索已关闭"]',
    ) as HTMLButtonElement | null;
    expect(expandedGlobeToggle).toBeTruthy();

    act(() => {
      expandedGlobeToggle?.click();
    });

    expect(onWebSearchEnabledChange).toHaveBeenCalledWith(true);
  });

  it("通用主题默认只保留最小主路径，展开高级设置后才显示进阶控制", async () => {
    const onThinkingEnabledChange = vi.fn<(enabled: boolean) => void>();
    const onWebSearchEnabledChange = vi.fn<(enabled: boolean) => void>();
    const onSubagentEnabledChange = vi.fn<(enabled: boolean) => void>();
    const setExecutionStrategy =
      vi.fn<(strategy: "react" | "code_orchestrated" | "auto") => void>();
    const setAccessMode =
      vi.fn<(mode: "read-only" | "current" | "full-access") => void>();
    const container = renderEmptyState({
      activeTheme: "general",
      thinkingEnabled: false,
      onThinkingEnabledChange,
      webSearchEnabled: false,
      onWebSearchEnabledChange,
      subagentEnabled: false,
      onSubagentEnabledChange,
      executionStrategy: "react",
      setExecutionStrategy,
      accessMode: "current",
      setAccessMode,
    });
    await act(async () => {
      await Promise.resolve();
    });

    const attachButton = container.querySelector(
      'button[title="添加图片"]',
    ) as HTMLButtonElement | null;
    expect(attachButton).toBeTruthy();

    const advancedToggle = container.querySelector(
      '[data-testid="empty-state-advanced-toggle"]',
    ) as HTMLButtonElement | null;
    expect(advancedToggle).toBeTruthy();

    expect(
      container.querySelector('button[title="深度思考已关闭"]'),
    ).toBeNull();
    expect(
      container.querySelector('button[title="联网搜索已关闭"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="inputbar-plan-toggle"]'),
    ).toBeNull();
    expect(
      container.querySelector('button[title="多代理偏好已关闭"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="inputbar-access-mode-select"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="chat-model-selector"]'),
    ).toBeNull();
    expect(container.textContent).not.toContain("通用任务上下文");

    act(() => {
      advancedToggle?.click();
    });

    const thinkingButton = container.querySelector(
      'button[title="深度思考已关闭"]',
    ) as HTMLButtonElement | null;
    expect(thinkingButton).toBeTruthy();
    const globeButton = container.querySelector(
      'button[title="联网搜索已关闭"]',
    ) as HTMLButtonElement | null;
    expect(globeButton).toBeTruthy();
    const planButton = container.querySelector(
      '[data-testid="inputbar-plan-toggle"]',
    ) as HTMLButtonElement | null;
    expect(planButton).toBeTruthy();
    const subagentButton = container.querySelector(
      'button[title="多代理偏好已关闭"]',
    ) as HTMLButtonElement | null;
    expect(subagentButton).toBeTruthy();
    const accessModeSelect = container.querySelector(
      '[data-testid="inputbar-access-mode-select"]',
    ) as HTMLSelectElement | null;
    expect(accessModeSelect).toBeTruthy();
    expect(
      container.querySelector('[data-testid="chat-model-selector"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("通用任务上下文");

    act(() => {
      thinkingButton?.click();
    });
    act(() => {
      globeButton?.click();
    });
    act(() => {
      planButton?.click();
    });
    act(() => {
      subagentButton?.click();
    });
    act(() => {
      accessModeSelect!.value = "full-access";
      accessModeSelect?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onThinkingEnabledChange).toHaveBeenCalledWith(true);
    expect(onWebSearchEnabledChange).toHaveBeenCalledWith(true);
    expect(setExecutionStrategy).toHaveBeenCalledWith("code_orchestrated");
    expect(onSubagentEnabledChange).toHaveBeenCalledWith(true);
    expect(setAccessMode).toHaveBeenCalledWith("full-access");
  });

  it("通用首页发送时不应自动注入任何历史默认 skill", async () => {
    const onSend =
      vi.fn<
        (
          value: string,
          executionStrategy?: "react" | "code_orchestrated" | "auto",
          images?: unknown[],
        ) => void
      >();
    const container = renderEmptyState({
      input: "请输出一篇新品发布文案",
      activeTheme: "general",
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
      "请输出一篇新品发布文案",
      "react",
      undefined,
    );
  });

  it("即使存在历史配置字段，通用首页也不再自动注入默认 skill", async () => {
    mockGetConfig.mockImplementation(async () => ({
      chat_appearance: {},
    }));

    const onSend =
      vi.fn<
        (
          value: string,
          executionStrategy?: "react" | "code_orchestrated" | "auto",
          images?: unknown[],
        ) => void
      >();
    const container = renderEmptyState({
      input: "请输出一篇用户访谈纪要",
      activeTheme: "general",
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
      "请输出一篇用户访谈纪要",
      "react",
      undefined,
    );
  });

  it("手动选择 skill 后发送时仍应优先使用手动 skill", async () => {
    const onSend =
      vi.fn<
        (
          value: string,
          executionStrategy?: "react" | "code_orchestrated" | "auto",
          images?: unknown[],
        ) => void
      >();
    const skill: Skill = {
      key: "custom-writing-skill",
      name: "custom-writing-skill",
      description: "desc",
      directory: "custom-writing-skill",
      installed: true,
      sourceKind: "builtin",
    };

    const container = renderEmptyState({
      input: "请输出一篇品牌故事",
      activeTheme: "general",
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
      "/custom-writing-skill 请输出一篇品牌故事",
      "react",
      undefined,
    );
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

    const launchButton = container.querySelector(
      'button[aria-label="连接浏览器"]',
    ) as HTMLButtonElement | null;
    expect(launchButton).toBeTruthy();

    act(() => {
      launchButton?.click();
    });

    expect(onLaunchBrowserAssist).toHaveBeenCalledTimes(1);
  });
});
