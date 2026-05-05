import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmptyState } from "./EmptyState";
import type { Character } from "@/lib/api/memory";
import type { Skill } from "@/lib/api/skills";
import type { UnifiedMemory } from "@/lib/api/unifiedMemory";
import type { ServiceSkillHomeItem } from "../service-skills/types";
import type { SceneAppEntryCardItem } from "../sceneappEntryTypes";
import type { InputCapabilitySelection } from "../skill-selection/inputCapabilitySelection";
import { recordSlashEntryUsage } from "../skill-selection/slashEntryUsage";
import {
  buildCuratedTaskLaunchPrompt,
  findCuratedTaskTemplateById,
  recordCuratedTaskTemplateUsage,
} from "../utils/curatedTaskTemplates";
import {
  recordCuratedTaskRecommendationSignalFromMemory,
  recordCuratedTaskRecommendationSignalFromReviewDecision,
} from "../utils/curatedTaskRecommendationSignals";

const { mockGetConfig, mockProjectSelector } = vi.hoisted(() => ({
  mockGetConfig: vi.fn(async () => ({})),
  mockProjectSelector: vi.fn(),
}));

const mockGetSkillCatalog = vi.hoisted(() =>
  vi.fn(async () => ({
    version: "test",
    tenantId: "tenant-0001",
    syncedAt: "2026-04-30T00:00:00Z",
    groups: [],
    items: [],
    entries: [],
  })),
);

const {
  mockGatewayChannelStatus,
  mockGetBrowserConnectorSettings,
  mockGetChromeBridgeStatus,
} = vi.hoisted(() => ({
  mockGatewayChannelStatus: vi.fn(),
  mockGetBrowserConnectorSettings: vi.fn(),
  mockGetChromeBridgeStatus: vi.fn(),
}));

const mockListUnifiedMemories = vi.hoisted(() =>
  vi.fn<() => Promise<UnifiedMemory[]>>(async () => []),
);

const mockCharacterMention = vi.fn<
  (props: {
    characters?: Character[];
    skills?: Skill[];
    serviceSkills?: ServiceSkillHomeItem[];
    onSelectSkill?: (skill: Skill) => void;
    onSelectInputCapability?: (
      capability: InputCapabilitySelection,
      options?: { replayText?: string },
    ) => void;
    onSelectServiceSkill?: (skill: ServiceSkillHomeItem) => void;
    defaultCuratedTaskReferenceMemoryIds?: string[];
    defaultCuratedTaskReferenceEntries?: Array<{
      id: string;
      title: string;
      summary: string;
      category: string;
      categoryLabel: string;
      tags: string[];
    }>;
    value: string;
    onChange: (value: string) => void;
  }) => React.ReactNode
>();

vi.mock("@/lib/api/appConfig", () => ({
  getConfig: mockGetConfig,
}));

vi.mock("@/lib/api/channelsRuntime", () => ({
  gatewayChannelStatus: mockGatewayChannelStatus,
}));

vi.mock("@/lib/api/unifiedMemory", () => ({
  listUnifiedMemories: mockListUnifiedMemories,
}));

vi.mock("@/lib/api/skillCatalog", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/api/skillCatalog")>();
  return {
    ...actual,
    getSkillCatalog: mockGetSkillCatalog,
    listSkillCatalogSceneEntries: () => [],
    subscribeSkillCatalogChanged: () => () => undefined,
  };
});

vi.mock("@/lib/webview-api", () => ({
  getBrowserConnectorSettings: mockGetBrowserConnectorSettings,
  getChromeBridgeStatus: mockGetChromeBridgeStatus,
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
    onSelectInputCapability?: (
      capability: InputCapabilitySelection,
      options?: { replayText?: string },
    ) => void;
    onSelectServiceSkill?: (skill: ServiceSkillHomeItem) => void;
    defaultCuratedTaskReferenceMemoryIds?: string[];
    defaultCuratedTaskReferenceEntries?: Array<{
      id: string;
      title: string;
      summary: string;
      category: string;
      categoryLabel: string;
      tags: string[];
    }>;
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
    ...rest
  }: {
    value?: string;
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
    placeholder?: string;
    [key: string]: unknown;
  }) => (
    <input
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      {...rest}
    />
  ),
}));

vi.mock("@/components/ui/textarea", () => {
  const Textarea = React.forwardRef<
    HTMLTextAreaElement,
    React.TextareaHTMLAttributes<HTMLTextAreaElement>
  >((props, ref) => <textarea ref={ref} {...props} />);
  return { Textarea };
});

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

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
  mockGatewayChannelStatus.mockResolvedValue({
    status: {
      running_accounts: 0,
    },
  });
  mockGetBrowserConnectorSettings.mockResolvedValue({
    enabled: true,
    system_connectors: [
      {
        connector_type: "chrome",
        available: true,
        authorization_status: "authorized",
      },
    ],
  });
  mockGetChromeBridgeStatus.mockResolvedValue({
    observer_count: 1,
    control_count: 0,
  });
  mockListUnifiedMemories.mockResolvedValue([]);
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

function updateFieldValue(
  element: HTMLInputElement | HTMLTextAreaElement | null,
  value: string,
) {
  expect(element).toBeTruthy();
  if (!element) {
    return;
  }

  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function findLauncherConfirmButton() {
  return (
    (document.body.querySelector(
      '[data-testid="curated-task-launcher-confirm"]',
    ) as HTMLButtonElement | null) ??
    (Array.from(document.body.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("开始生成"),
    ) as HTMLButtonElement | undefined)
  );
}

async function openHomeMoreSkillsDrawer(
  container: HTMLElement,
): Promise<HTMLElement> {
  const trigger = container.querySelector(
    '[data-testid="home-more-skills-trigger"]',
  ) as HTMLButtonElement | null;
  expect(trigger).toBeTruthy();

  await act(async () => {
    trigger?.click();
    await Promise.resolve();
  });

  const drawer = container.querySelector(
    '[data-testid="home-more-skills-drawer"]',
  ) as HTMLElement | null;
  expect(drawer).toBeTruthy();
  if (!drawer) {
    throw new Error("home more skills drawer should be visible");
  }
  return drawer;
}

function queryHomeDrawerButton(
  drawer: HTMLElement,
  testId: string,
): HTMLButtonElement | null {
  return drawer.querySelector(
    `[data-testid="${testId}"]`,
  ) as HTMLButtonElement | null;
}

function expectHomeDrawerButton(
  drawer: HTMLElement,
  testId: string,
): HTMLButtonElement {
  const button = queryHomeDrawerButton(drawer, testId);
  expect(button).toBeTruthy();
  if (!button) {
    throw new Error(`expected home drawer button ${testId}`);
  }
  return button;
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
    defaultExecutorBinding: "agent_turn",
    executionLocation: "client_default",
    version: "seed-v1",
    badge: "云目录",
    recentUsedAt: null,
    isRecent: false,
    runnerLabel: "立即开始",
    runnerTone: "emerald",
    runnerDescription: "围绕当前项目继续整理线索和结果。",
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

function createSceneAppEntry(): SceneAppEntryCardItem {
  return {
    id: "story-video-suite",
    title: "短视频编排",
    summary: "把文本、线框图、配乐和短视频草稿串成结果链。",
    businessLabel: "多模态组合",
    valueStatement: "从一句主题串起脚本、线框图、配乐方向和短视频草稿。",
    deliveryLabel: "短视频结果包",
    executionLabel: "当前会话继续",
    executionTone: "sky",
    patternSummary: "步骤链 · 结果生成",
    infraSummary: "组合蓝图 · 项目沉淀 · 云端编排",
    sourceLabel: "将基于当前输入启动",
    sourcePreview: "做一条新品发布短视频",
    actionLabel: "进入生成",
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
    expect(container.textContent).toContain("说一句目标，Lime 就接着帮你做。");
    expect(container.textContent).toContain(
      "文案、图片、视频、搜索和网页任务围绕同一目标持续推进，并沉淀上下文、偏好和做法。",
    );
    expect(container.textContent).not.toContain("通用对话");
    expect(container.textContent).not.toContain("新建任务");
  });

  it("通用首页应挂载轻量起手区与下滑第二屏", async () => {
    const container = renderEmptyState({
      activeTheme: "general",
      onLaunchBrowserAssist: vi.fn(),
      onSelectServiceSkill: vi.fn(),
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="home-start-surface"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="home-starter-chips"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("引导帮助");
    expect(container.textContent).toContain("写作");
    expect(container.textContent).toContain("添加资料");
    expect(container.textContent).toContain("PPT");
    expect(container.textContent).toContain("调研报告");
    expect(container.textContent).toContain("更多做法");
    expect(
      container.querySelector('[data-testid="home-guide-cards"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="entry-home-knowledge-import"]'),
    ).toBeTruthy();
    const scrollCue = container.querySelector(
      '[data-testid="home-scroll-cue"]',
    );
    expect(scrollCue).toBeTruthy();
    expect(scrollCue?.textContent).toContain(
      "向下滑，看看 Lime 可以帮你做什么",
    );
    expect(
      container.querySelector('[data-testid="home-second-screen"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="home-skill-gallery"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("你可以从这些任务开始");
    expect(container.textContent).toContain("每日趋势摘要");
    expect(container.textContent).not.toContain("先开始这一轮");
    expect(container.textContent).not.toContain("其他起手结果");
    expect(container.textContent).not.toContain("也可以直接按做法开工");
    expect(
      container.querySelector('[data-testid^="entry-continuation-"]'),
    ).toBeNull();
  });

  it("首页添加资料入口应打开输入框资料中枢，而不是预填一段说明", async () => {
    const setInput = vi.fn();
    const onToggleKnowledgePack = vi.fn<(enabled: boolean) => void>();
    const container = renderEmptyState({
      setInput,
      knowledgePackSelection: {
        enabled: false,
        packName: "team-notes",
        workingDir: "workspace-root",
        label: "团队资料",
        status: "ready",
      },
      knowledgePackOptions: [
        {
          packName: "team-notes",
          label: "团队资料",
          status: "ready",
          defaultForWorkspace: true,
        },
      ],
      onToggleKnowledgePack,
      onSelectKnowledgePack: vi.fn(),
      onStartKnowledgeOrganize: vi.fn(),
      onManageKnowledgePacks: vi.fn(),
    });

    await act(async () => {
      await Promise.resolve();
    });

    const starter = container.querySelector(
      '[data-testid="entry-home-knowledge-import"]',
    ) as HTMLButtonElement | null;
    expect(starter?.textContent).toContain("添加资料");

    act(() => {
      starter?.click();
    });

    expect(setInput).not.toHaveBeenCalled();
    expect(
      container.querySelector('[data-testid="inputbar-knowledge-hub"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("可使用：团队资料");

    const useKnowledgeButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("使用这份资料"));

    act(() => {
      useKnowledgeButton?.click();
    });

    expect(onToggleKnowledgePack).toHaveBeenCalledWith(true);
  });

  it("点击引导帮助后进入可关闭的帮助模式，关闭后恢复默认起手入口", async () => {
    const container = renderEmptyState({
      activeTheme: "general",
      serviceSkills: [],
    });

    await act(async () => {
      await Promise.resolve();
    });

    const guideTrigger = container.querySelector(
      '[data-testid="home-guide-help-trigger"]',
    ) as HTMLButtonElement | null;
    expect(guideTrigger).toBeTruthy();

    act(() => {
      guideTrigger?.click();
    });

    expect(
      container.querySelector('[data-testid="home-guide-help-active-badge"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="home-guide-cards"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("项目资料怎么添加和使用？");
    expect(
      container.querySelector('[data-testid="home-starter-chips"]'),
    ).toBeNull();
    expect(container.querySelector("textarea")?.placeholder).toContain(
      "想了解什么？试试",
    );

    const closeGuide = container.querySelector(
      '[data-testid="home-guide-help-active-badge"] button',
    ) as HTMLButtonElement | null;

    act(() => {
      closeGuide?.click();
    });

    expect(
      container.querySelector('[data-testid="home-guide-help-active-badge"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="home-guide-cards"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="home-starter-chips"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="home-input-tab-suggestion"]'),
    ).toBeTruthy();
  });

  it("点击首屏起手任务只挂载输入区能力，不弹出启动表单", async () => {
    const container = renderEmptyState({
      activeTheme: "general",
      serviceSkills: [],
    });

    await act(async () => {
      await Promise.resolve();
    });

    const starter = container.querySelector(
      '[data-testid="entry-recommended-daily-trend-briefing"]',
    ) as HTMLButtonElement | null;
    expect(starter).toBeTruthy();

    act(() => {
      starter?.click();
    });

    expect(document.body.textContent).not.toContain(
      "开始这一步前，我先确认几件事。",
    );
    expect(
      container.querySelector('[data-testid="curated-task-badge"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("每日趋势摘要");
  });

  it("保存判断结论后不应打乱首屏固定起手入口", async () => {
    const projectId = "project-review-recommendation";
    const container = renderEmptyState({
      activeTheme: "general",
      projectId,
      onLaunchBrowserAssist: vi.fn(),
      onSelectServiceSkill: vi.fn(),
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("围绕最近判断");
    expect(
      container.querySelector('[data-testid="entry-review-feedback-banner"]'),
    ).toBeNull();
    const initialStarterItems = Array.from(
      container.querySelectorAll('[data-testid^="entry-recommended-"]'),
    ).map((element) => element.getAttribute("data-testid"));

    await act(async () => {
      recordCuratedTaskRecommendationSignalFromReviewDecision(
        {
          session_id: "session-review-needs-evidence",
          decision_status: "needs_more_evidence",
          decision_summary:
            "这轮结果还缺证据，需要回到账号表现和爆款样本继续补证据。",
          chosen_fix_strategy: "先补账号数据复盘，再拆一轮高表现内容做对照。",
          risk_level: "medium",
          risk_tags: ["证据不足", "需要复盘"],
          followup_actions: ["补账号数据复盘", "拆解一条高表现内容"],
        },
        {
          projectId,
          sceneTitle: "短视频编排",
        },
      );
      await Promise.resolve();
    });

    const starterItems = Array.from(
      container.querySelectorAll('[data-testid^="entry-recommended-"]'),
    ).map((element) => element.getAttribute("data-testid"));

    expect(starterItems).toEqual(initialStarterItems);
    expect(starterItems[0]).toBe("entry-recommended-social-post-starter");
    expect(
      container.querySelector('[data-testid="entry-review-feedback-banner"]'),
    ).toBeNull();
  });

  it("无浏览器入口且无可续接动作时，不应默认渲染补充续接条", async () => {
    const container = renderEmptyState({
      activeTheme: "general",
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="entry-supplemental-panel"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="entry-connect-browser"]'),
    ).toBeNull();
  });

  it("只有未形成直接收益的方法目录时，不应默认渲染补充续接条", async () => {
    const container = renderEmptyState({
      activeTheme: "general",
      serviceSkills: [createSceneBoundServiceSkill()],
      onSelectServiceSkill: vi.fn(),
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="entry-supplemental-panel"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="entry-connect-browser"]'),
    ).toBeNull();
  });

  it("首页快捷做法应复用 service skill 的统一合同缩略", async () => {
    const container = renderEmptyState({
      activeTheme: "general",
      serviceSkills: [
        {
          id: "daily-trend-briefing",
          title: "每日趋势摘要",
          summary: "围绕指定平台与关键词输出趋势摘要。",
          entryHint: "把平台和关键词给我，我先整理一份趋势报告。",
          category: "内容运营",
          outputHint: "趋势摘要 + 调度建议",
          source: "cloud_catalog",
          runnerType: "scheduled",
          defaultExecutorBinding: "automation_job",
          executionLocation: "client_default",
          slotSchema: [],
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
        {
          ...createSceneBoundServiceSkill(),
          id: "project-insight-flow",
          title: "项目线索整理",
          entryHint: "给我一个项目目标，我先把线索和下一步整理出来。",
          slotSchema: [
            {
              key: "project_goal",
              label: "项目目标",
              type: "text",
              required: true,
              placeholder: "例如 新品发布前的竞品和内容线索",
            },
          ],
        },
      ],
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain("每日趋势摘要");
    expect(container.textContent).not.toContain("云目录");
    expect(container.textContent).not.toContain("最近使用");

    const projectCard = container.querySelector(
      '[data-testid="home-gallery-entry-service-skill-project-insight-flow"]',
    );
    expect(projectCard?.textContent).toContain("项目线索整理");
    expect(projectCard?.textContent).toContain(
      "围绕当前项目整理线索、结论和下一步动作。",
    );
  });

  it("runtime tool surface 告警不应再透传到首页空态输入区", async () => {
    const container = renderEmptyState({
      activeTheme: "general",
      webSearchEnabled: true,
      subagentEnabled: true,
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(
      container.querySelector(
        '[data-testid="empty-state-runtime-tool-warning"]',
      ),
    ).toBeNull();
    expect(container.textContent).not.toContain("当前 runtime tool surface");
    expect(container.textContent).not.toContain("联网搜索偏好本轮可能不会生效");
    expect(container.textContent).not.toContain(
      "任务拆分偏好本轮可能不会完全生效",
    );
  });

  it("有最近记录时应在更多做法抽屉里展示最近入口，并允许继续模板与方法", async () => {
    recordCuratedTaskTemplateUsage({
      templateId: "social-post-starter",
      launchInputValues: {
        subject_or_product: "上次沉淀的主线升级",
        target_audience: "品牌内容负责人",
      },
      referenceMemoryIds: ["memory-idea-1"],
      referenceEntries: [
        {
          id: "memory-idea-1",
          title: "上次主稿参考",
          summary: "保留品牌调性与平台拆分思路",
          category: "context",
          categoryLabel: "参考",
          tags: ["品牌", "拆分"],
        },
      ],
    });
    const onSelectServiceSkill = vi.fn<(skill: ServiceSkillHomeItem) => void>();
    const setInput = vi.fn<(value: string) => void>();
    const template = findCuratedTaskTemplateById("social-post-starter");
    expect(template).toBeTruthy();
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

    const drawer = await openHomeMoreSkillsDrawer(container);
    const recentTemplateButton = expectHomeDrawerButton(
      drawer,
      "home-drawer-entry-recommended-social-post-starter",
    );

    await act(async () => {
      recentTemplateButton?.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("开始这一步前，我先确认几件事。");
    expect(setInput).not.toHaveBeenCalled();

    const subjectInput = document.body.querySelector(
      "#curated-task-social-post-starter-subject_or_product",
    ) as HTMLTextAreaElement | null;
    const audienceInput = document.body.querySelector(
      "#curated-task-social-post-starter-target_audience",
    ) as HTMLInputElement | null;

    expect(subjectInput?.value).toBe("上次沉淀的主线升级");
    expect(audienceInput?.value).toBe("品牌内容负责人");
    expect(document.body.textContent).toContain(
      "已选择 1 条参考对象，本轮会一起带入生成。",
    );

    await act(async () => {
      updateFieldValue(subjectInput, "Lime 的内容创作主链升级");
      updateFieldValue(audienceInput, "内容负责人");
      await Promise.resolve();
    });

    const confirmButton = findLauncherConfirmButton();
    expect(confirmButton).toBeTruthy();

    await act(async () => {
      confirmButton?.click();
      await Promise.resolve();
    });

    expect(setInput).toHaveBeenCalledWith(
      buildCuratedTaskLaunchPrompt({
        task: template!,
        inputValues: {
          subject_or_product: "Lime 的内容创作主链升级",
          target_audience: "内容负责人",
        },
        referenceEntries: [
          {
            id: "memory-idea-1",
            title: "上次主稿参考",
            summary: "保留品牌调性与平台拆分思路",
            category: "context",
            categoryLabel: "参考",
            tags: ["品牌", "拆分"],
          },
        ],
      }),
    );

    const recentMethodButton = expectHomeDrawerButton(
      drawer,
      "home-drawer-entry-service-skill-content-iteration-flow",
    );

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

  it("scene 最近使用记录也应把对应做法带回更多做法抽屉", async () => {
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

    const drawer = await openHomeMoreSkillsDrawer(container);
    const sceneContinuationButton = expectHomeDrawerButton(
      drawer,
      "home-drawer-entry-service-skill-project-insight-flow",
    );

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

  it("最近使用的本地已安装 skill 也应回到更多做法抽屉，并恢复上次目标", async () => {
    recordSlashEntryUsage({
      kind: "skill",
      entryId: "content-playbook",
      usedAt: 1_900_000_000_000,
      replayText: "继续优化这套内容主稿",
    });
    const setInput = vi.fn<(value: string) => void>();
    const installedSkill: Skill = {
      key: "content-playbook",
      name: "内容主稿方法",
      description: "本地补充技能",
      directory: "content-playbook",
      installed: true,
      sourceKind: "other",
      metadata: {
        lime_when_to_use: "当你需要继续复用这套内容主稿方法时使用。",
        lime_argument_hint: "主题、受众与复盘约束",
        lime_output_hint: "带着这套内容主稿方法进入生成",
      },
    };

    const container = renderEmptyState({
      activeTheme: "general",
      setInput,
      skills: [installedSkill],
    });

    await act(async () => {
      await Promise.resolve();
    });

    const drawer = await openHomeMoreSkillsDrawer(container);
    const installedSkillButton = expectHomeDrawerButton(
      drawer,
      "home-drawer-entry-installed-skill-content-playbook",
    );

    await act(async () => {
      installedSkillButton?.click();
      await Promise.resolve();
    });

    expect(setInput).toHaveBeenCalledWith("继续优化这套内容主稿");
    expect(container.textContent).not.toContain("已挂载 内容主稿方法");
  });

  it("同页内新增本地 skill 使用记录后，更多做法抽屉应即时刷新", async () => {
    const installedSkill: Skill = {
      key: "content-playbook",
      name: "内容主稿方法",
      description: "本地补充技能",
      directory: "content-playbook",
      installed: true,
      sourceKind: "other",
    };

    const container = renderEmptyState({
      activeTheme: "general",
      skills: [installedSkill],
    });

    await act(async () => {
      await Promise.resolve();
    });

    const drawer = await openHomeMoreSkillsDrawer(container);
    const installedSkillButton = expectHomeDrawerButton(
      drawer,
      "home-drawer-entry-installed-skill-content-playbook",
    );
    expect(installedSkillButton.title).toContain("本地补充技能");

    await act(async () => {
      recordSlashEntryUsage({
        kind: "skill",
        entryId: "content-playbook",
        usedAt: 1_900_000_000_100,
        replayText: "继续完善这套内容方法",
      });
      await Promise.resolve();
    });

    const updatedInstalledSkillButton = expectHomeDrawerButton(
      drawer,
      "home-drawer-entry-installed-skill-content-playbook",
    );
    expect(updatedInstalledSkillButton.title).toContain("继续完善这套内容方法");
  });

  it("首页主体不再重复展示项目选择器入口", async () => {
    const container = renderEmptyState({
      activeTheme: "general",
      projectId: "project-brand",
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="project-selector-stub"]'),
    ).toBeNull();
    expect(mockProjectSelector).not.toHaveBeenCalled();
    expect(
      container.querySelector('[data-testid="home-start-surface"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid^="entry-project-continuation-"]'),
    ).toBeNull();
  });

  it("通用首页不应把浏览器连接提前放到首屏补充入口", async () => {
    const container = renderEmptyState({
      activeTheme: "general",
      onLaunchBrowserAssist: vi.fn(),
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="home-supplemental-actions"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="entry-connect-browser"]'),
    ).toBeNull();
    expect(container.textContent).not.toContain("连接浏览器");
    expect(container.textContent).not.toContain(
      "需要网页登录时，也可以先把浏览器接上。",
    );
    expect(
      container.querySelector('[data-testid="entry-capability-toggle"]'),
    ).toBeNull();
  });

  it("通用首页不再渲染 runtime 总览层", async () => {
    const onOpenMemoryWorkbench = vi.fn();
    const onOpenChannels = vi.fn();
    const onOpenChromeRelay = vi.fn();
    const onOpenOpenClaw = vi.fn();
    const container = renderEmptyState({
      activeTheme: "general",
      runtimeToolAvailability: {
        source: "runtime_tools",
        known: true,
        agentInitialized: true,
        availableToolCount: 9,
        webSearch: true,
        subagentCore: true,
        subagentTeamTools: true,
        subagentRuntime: true,
        taskRuntime: true,
        missingSubagentCoreTools: [],
        missingSubagentTeamTools: [],
        missingTaskTools: [],
      },
      runtimeTaskCard: {
        taskId: "task-1",
        title: "当前任务",
        summary: "正在执行",
        status: "running",
        statusLabel: "进行中",
        phase: "tool_batch",
        phaseLabel: "工具批次处理中",
        detail: "正在执行工具批次",
        supportingLines: [],
        batchDescriptor: null,
        queuedTurnCount: 0,
        pendingRequestCount: 0,
        subtaskStats: null,
      },
      onOpenMemoryWorkbench,
      onOpenChannels,
      onOpenChromeRelay,
      onOpenOpenClaw,
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="empty-state-runtime-overview"]'),
    ).toBeNull();
    expect(container.textContent).not.toContain("当前能力、执行态和远程入口");
    expect(container.textContent).not.toContain("Runtime Tool Surface");
    expect(container.textContent).not.toContain("Thread Runtime");
    expect(container.textContent).not.toContain("消息渠道 + 浏览器连接器");
    expect(container.textContent).not.toContain(
      "当前回合 / 长期 / Team / 压缩",
    );
    expect(container.textContent).not.toContain("频道入口");
    expect(container.textContent).not.toContain("浏览器连接器");
    expect(container.textContent).not.toContain("OpenClaw 兼容入口");
    expect(container.textContent).not.toContain("打开记忆工作台");

    expect(onOpenChannels).not.toHaveBeenCalled();
    expect(onOpenChromeRelay).not.toHaveBeenCalled();
    expect(onOpenOpenClaw).not.toHaveBeenCalled();
    expect(onOpenMemoryWorkbench).not.toHaveBeenCalled();
  });

  it("浏览器接入不再通过首屏补充入口直接触发", async () => {
    const onLaunchBrowserAssist = vi.fn();
    const container = renderEmptyState({
      activeTheme: "general",
      onLaunchBrowserAssist,
    });

    await act(async () => {
      await Promise.resolve();
    });

    const mediaButton = container.querySelector(
      '[data-testid="entry-connect-browser"]',
    ) as HTMLButtonElement | null;
    expect(mediaButton).toBeNull();

    expect(onLaunchBrowserAssist).not.toHaveBeenCalled();
  });

  it("点击每日趋势摘要应开启联网搜索并记录最近使用", async () => {
    const setInput = vi.fn<(value: string) => void>();
    const onWebSearchEnabledChange = vi.fn<(enabled: boolean) => void>();
    const template = findCuratedTaskTemplateById("daily-trend-briefing");
    expect(template).toBeTruthy();
    const container = renderEmptyState({
      activeTheme: "general",
      setInput,
      onWebSearchEnabledChange,
    });

    await act(async () => {
      await Promise.resolve();
    });

    const card = container.querySelector(
      '[data-testid="home-gallery-entry-recommended-daily-trend-briefing"]',
    ) as HTMLDivElement | null;
    expect(card).toBeTruthy();

    act(() => {
      card?.click();
    });

    expect(container.textContent).toContain("开始这一步前，我先确认几件事。");
    expect(onWebSearchEnabledChange).not.toHaveBeenCalled();
    expect(setInput).not.toHaveBeenCalled();

    const themeInput = document.body.querySelector(
      "#curated-task-daily-trend-briefing-theme_target",
    ) as HTMLInputElement | null;
    const platformInput = document.body.querySelector(
      "#curated-task-daily-trend-briefing-platform_region",
    ) as HTMLInputElement | null;

    await act(async () => {
      updateFieldValue(themeInput, "AI 内容创作");
      updateFieldValue(platformInput, "X 与 TikTok 北美区");
      await Promise.resolve();
    });

    const confirmButton = findLauncherConfirmButton();
    expect(confirmButton).toBeTruthy();
    expect(confirmButton?.disabled).toBe(false);

    await act(async () => {
      confirmButton?.click();
      await Promise.resolve();
    });

    expect(onWebSearchEnabledChange).toHaveBeenCalledWith(true);
    expect(setInput).toHaveBeenCalledWith(
      buildCuratedTaskLaunchPrompt({
        task: template!,
        inputValues: {
          theme_target: "AI 内容创作",
          platform_region: "X 与 TikTok 北美区",
        },
      }),
    );
  });

  it("当前激活模板不是最近判断首选时，输入区 badge 应可直接切到推荐模板", async () => {
    const projectId = "project-active-badge-review-switch";
    const container = renderEmptyState({
      activeTheme: "general",
      projectId,
    });

    await act(async () => {
      await Promise.resolve();
    });

    const card = container.querySelector(
      '[data-testid="home-gallery-entry-recommended-daily-trend-briefing"]',
    ) as HTMLDivElement | null;
    expect(card).toBeTruthy();

    act(() => {
      card?.click();
    });

    const themeInput = document.body.querySelector(
      "#curated-task-daily-trend-briefing-theme_target",
    ) as HTMLInputElement | null;
    const platformInput = document.body.querySelector(
      "#curated-task-daily-trend-briefing-platform_region",
    ) as HTMLInputElement | null;

    await act(async () => {
      updateFieldValue(themeInput, "AI 内容创作");
      updateFieldValue(platformInput, "X 与 TikTok 北美区");
      await Promise.resolve();
    });

    const confirmButton = findLauncherConfirmButton();
    expect(confirmButton?.disabled).toBe(false);

    await act(async () => {
      confirmButton?.click();
      await Promise.resolve();
    });

    await act(async () => {
      recordCuratedTaskRecommendationSignalFromReviewDecision(
        {
          session_id: "session-active-badge-review-switch",
          decision_status: "needs_more_evidence",
          decision_summary:
            "这轮结果还缺证据，需要回到账号表现和爆款样本继续补证据。",
          chosen_fix_strategy: "先补账号数据复盘，再拆一轮高表现内容做对照。",
          risk_level: "medium",
          risk_tags: ["证据不足", "需要复盘"],
          followup_actions: ["补账号数据复盘", "拆解一条高表现内容"],
        },
        {
          projectId,
          sceneTitle: "短视频编排",
        },
      );
      await Promise.resolve();
    });

    const badgeAction = container.querySelector(
      '[data-testid="curated-task-badge-review-action"]',
    ) as HTMLButtonElement | null;
    expect(badgeAction?.textContent).toContain("改用「复盘这个账号/项目」");

    await act(async () => {
      badgeAction?.click();
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("复盘这个账号/项目");
    expect(document.body.textContent).toContain(
      "已按最近判断切到更适合的结果模板",
    );
  });

  it("点击内容主稿生成应直接写入起始动作，不再切换旧主题", async () => {
    const setInput = vi.fn<(value: string) => void>();
    const onThemeChange = vi.fn<(theme: string) => void>();
    const template = findCuratedTaskTemplateById("social-post-starter");
    expect(template).toBeTruthy();
    const container = renderEmptyState({
      activeTheme: "general",
      setInput,
      onThemeChange,
    });

    await act(async () => {
      await Promise.resolve();
    });

    const card = container.querySelector(
      '[data-testid="home-gallery-entry-recommended-social-post-starter"]',
    ) as HTMLDivElement | null;
    expect(card).toBeTruthy();

    act(() => {
      card?.click();
    });

    const subjectInput = document.body.querySelector(
      "#curated-task-social-post-starter-subject_or_product",
    ) as HTMLTextAreaElement | null;
    const audienceInput = document.body.querySelector(
      "#curated-task-social-post-starter-target_audience",
    ) as HTMLInputElement | null;

    await act(async () => {
      updateFieldValue(subjectInput, "Lime 的 AI 内容创作闭环升级");
      updateFieldValue(audienceInput, "内容团队负责人");
      await Promise.resolve();
    });

    const confirmButton = findLauncherConfirmButton();
    expect(confirmButton).toBeTruthy();

    await act(async () => {
      confirmButton?.click();
      await Promise.resolve();
    });

    expect(onThemeChange).not.toHaveBeenCalled();
    expect(setInput).toHaveBeenCalledWith(
      buildCuratedTaskLaunchPrompt({
        task: template!,
        inputValues: {
          subject_or_product: "Lime 的 AI 内容创作闭环升级",
          target_audience: "内容团队负责人",
        },
      }),
    );
  });

  it("点击长文转多平台发布稿应直接写入起始动作", async () => {
    const setInput = vi.fn<(value: string) => void>();
    const template = findCuratedTaskTemplateById(
      "longform-multiplatform-rewrite",
    );
    expect(template).toBeTruthy();
    const container = renderEmptyState({
      activeTheme: "general",
      setInput,
    });

    await act(async () => {
      await Promise.resolve();
    });

    const card = container.querySelector(
      '[data-testid="home-gallery-entry-recommended-longform-multiplatform-rewrite"]',
    ) as HTMLDivElement | null;
    expect(card).toBeTruthy();

    act(() => {
      card?.click();
    });

    const sourceInput = document.body.querySelector(
      "#curated-task-longform-multiplatform-rewrite-source_article",
    ) as HTMLTextAreaElement | null;
    const platformInput = document.body.querySelector(
      "#curated-task-longform-multiplatform-rewrite-target_platform",
    ) as HTMLInputElement | null;

    await act(async () => {
      updateFieldValue(sourceInput, "这是一篇关于品牌内容中台升级的长文。");
      updateFieldValue(platformInput, "X、LinkedIn");
      await Promise.resolve();
    });

    const confirmButton = findLauncherConfirmButton();
    expect(confirmButton).toBeTruthy();

    await act(async () => {
      confirmButton?.click();
      await Promise.resolve();
    });

    expect(setInput).toHaveBeenCalledWith(
      buildCuratedTaskLaunchPrompt({
        task: template!,
        inputValues: {
          source_article: "这是一篇关于品牌内容中台升级的长文。",
          target_platform: "X、LinkedIn",
        },
      }),
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
      '[data-testid="home-gallery-entry-service-skill-short-video-script-replication"]',
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
    const onSend = vi.fn();

    const container = renderEmptyState({
      input: "@",
      setInput,
      onSend,
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

    expect(setInput).not.toHaveBeenCalled();

    const sendButton = container.querySelector(
      'button[title="发送"]',
    ) as HTMLButtonElement | null;
    expect(sendButton?.disabled).toBe(false);

    act(() => {
      sendButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSend).toHaveBeenCalledWith("@技能A", "react", undefined);
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
    expect(typeof latestCall.onSelectInputCapability).toBe("function");

    act(() => {
      latestCall.onSelectInputCapability?.({
        kind: "service_skill",
        skill: serviceSkills[0]!,
      });
    });

    expect(onSelectServiceSkill).toHaveBeenCalledWith(serviceSkills[0]!);
  });

  it("首页安装技能选择应走统一 capability 回调，且发送后清除激活态", async () => {
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
    expect(typeof latestCall.onSelectInputCapability).toBe("function");

    act(() => {
      latestCall.onSelectInputCapability?.({
        kind: "installed_skill",
        skill,
      });
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain("canvas-design");
    expect(container.textContent).not.toContain("已挂载 canvas-design");

    const sendButton = container.querySelector(
      'button[aria-label="发送"]',
    ) as HTMLButtonElement | null;
    expect(sendButton).toBeTruthy();

    act(() => {
      sendButton?.click();
    });
    expect(onSend).toHaveBeenCalledWith("帮我设计封面", "react", undefined, {
      capabilityRoute: {
        kind: "installed_skill",
        skillKey: "canvas-design",
        skillName: "canvas-design",
      },
      displayContent: "帮我设计封面",
    });

    act(() => {
      sendButton?.click();
    });
    expect(onSend).toHaveBeenCalledWith("帮我设计封面", "react", undefined);
  });

  it("首页选择 builtin command 后发送应透传结构化 capability route", async () => {
    const onSend = vi.fn();
    const command = {
      key: "image-compose",
      label: "配图",
      mentionLabel: "配图",
      commandPrefix: "@配图",
      description: "输出配图方向。",
      aliases: [],
    };
    const container = renderEmptyState({
      input: "帮我整理这篇文章的配图方向",
      onSend,
    });
    await act(async () => {
      await Promise.resolve();
    });

    const latestCall =
      mockCharacterMention.mock.calls[
        mockCharacterMention.mock.calls.length - 1
      ][0];

    act(() => {
      latestCall.onSelectInputCapability?.({
        kind: "builtin_command",
        command,
      });
    });

    const sendButton = container.querySelector(
      'button[aria-label="发送"]',
    ) as HTMLButtonElement | null;
    expect(sendButton).toBeTruthy();

    act(() => {
      sendButton?.click();
    });

    expect(onSend).toHaveBeenCalledWith(
      "帮我整理这篇文章的配图方向",
      "react",
      undefined,
      {
        capabilityRoute: {
          kind: "builtin_command",
          commandKey: "image-compose",
          commandPrefix: "@配图",
        },
        displayContent: "帮我整理这篇文章的配图方向",
      },
    );
  });

  it("首页选择 @资料 兼容入口时应打开资料中枢而不是普通命令标签", async () => {
    const onToggleKnowledgePack = vi.fn<(enabled: boolean) => void>();
    const onStartKnowledgeOrganize = vi.fn();
    const command = {
      key: "knowledge_pack",
      label: "资料",
      mentionLabel: "资料",
      commandPrefix: "@资料",
      description: "查看、添加、选择或使用当前项目资料。",
      aliases: [],
    };
    const container = renderEmptyState({
      input: "按项目资料写一版介绍",
      knowledgePackSelection: {
        enabled: false,
        packName: "team-notes",
        workingDir: "workspace-root",
        label: "团队资料",
        status: "ready",
      },
      knowledgePackOptions: [
        {
          packName: "team-notes",
          label: "团队资料",
          status: "ready",
          defaultForWorkspace: true,
        },
      ],
      onToggleKnowledgePack,
      onSelectKnowledgePack: vi.fn(),
      onStartKnowledgeOrganize,
      onManageKnowledgePacks: vi.fn(),
    });
    await act(async () => {
      await Promise.resolve();
    });

    const latestCall =
      mockCharacterMention.mock.calls[
        mockCharacterMention.mock.calls.length - 1
      ][0];

    await act(async () => {
      latestCall.onSelectInputCapability?.({
        kind: "builtin_command",
        command,
      });
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="inputbar-builtin-command-badge"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="inputbar-knowledge-hub"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("可使用：团队资料");
    expect(container.textContent).toContain("使用这份资料");

    const useKnowledgeButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("使用这份资料"));

    act(() => {
      useKnowledgeButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(onToggleKnowledgePack).toHaveBeenCalledWith(true);
    expect(onStartKnowledgeOrganize).not.toHaveBeenCalled();
  });

  it("首页启用项目资料后发送应携带资料引用 metadata", async () => {
    const onSend = vi.fn();
    const container = renderEmptyState({
      input: "按项目资料写一版介绍",
      onSend,
      knowledgePackSelection: {
        enabled: true,
        packName: "team-notes",
        workingDir: "workspace-root",
        label: "团队资料",
        status: "ready",
      },
      knowledgePackOptions: [
        {
          packName: "team-notes",
          label: "团队资料",
          status: "ready",
          defaultForWorkspace: true,
        },
      ],
      onToggleKnowledgePack: vi.fn(),
      onSelectKnowledgePack: vi.fn(),
      onStartKnowledgeOrganize: vi.fn(),
      onManageKnowledgePacks: vi.fn(),
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
      "按项目资料写一版介绍",
      "react",
      undefined,
      {
        requestMetadata: {
          knowledge_pack: {
            pack_name: "team-notes",
            working_dir: "workspace-root",
            source: "inputbar",
          },
        },
      },
    );
  });

  it("首页点击结果模板后发送时，应透传 curated_task capability route", async () => {
    const template = findCuratedTaskTemplateById("daily-trend-briefing");
    expect(template).toBeTruthy();
    const prompt = buildCuratedTaskLaunchPrompt({
      task: template!,
      inputValues: {
        theme_target: "AI 内容创作",
        platform_region: "X 与 TikTok 北美区",
      },
    });
    const onSend = vi.fn();
    const setInput = vi.fn();
    const container = renderEmptyState({
      input: prompt,
      setInput,
      onSend,
    });

    await act(async () => {
      await Promise.resolve();
    });

    const templateButton = container.querySelector(
      '[data-testid="home-gallery-entry-recommended-daily-trend-briefing"]',
    ) as HTMLButtonElement | null;
    expect(templateButton).toBeTruthy();

    act(() => {
      templateButton?.click();
    });

    const themeInput = document.body.querySelector(
      "#curated-task-daily-trend-briefing-theme_target",
    ) as HTMLInputElement | null;
    const platformInput = document.body.querySelector(
      "#curated-task-daily-trend-briefing-platform_region",
    ) as HTMLInputElement | null;

    await act(async () => {
      updateFieldValue(themeInput, "AI 内容创作");
      updateFieldValue(platformInput, "X 与 TikTok 北美区");
      await Promise.resolve();
    });

    const confirmButton = findLauncherConfirmButton();
    expect(confirmButton).toBeTruthy();

    await act(async () => {
      confirmButton?.click();
      await Promise.resolve();
    });

    expect(setInput).toHaveBeenCalledWith(prompt);

    const sendButton = container.querySelector(
      'button[aria-label="发送"]',
    ) as HTMLButtonElement | null;
    expect(sendButton).toBeTruthy();

    act(() => {
      sendButton?.click();
    });

    expect(onSend).toHaveBeenCalledWith(
      prompt,
      "react",
      undefined,
      expect.objectContaining({
        capabilityRoute: {
          kind: "curated_task",
          taskId: "daily-trend-briefing",
          taskTitle: "每日趋势摘要",
          prompt,
          launchInputValues: {
            theme_target: "AI 内容创作",
            platform_region: "X 与 TikTok 北美区",
          },
        },
        displayContent: prompt,
        requestMetadata: {
          harness: {
            curated_task: expect.objectContaining({
              task_id: "daily-trend-briefing",
              launch_input_values: {
                theme_target: "AI 内容创作",
                platform_region: "X 与 TikTok 北美区",
              },
            }),
          },
        },
      }),
    );
  });

  it("首页结果模板带着灵感引用发送时，应附带引用 route 与 request metadata", async () => {
    const referenceMemory = {
      id: "memory-1",
      session_id: "session-1",
      memory_type: "project" as const,
      category: "context" as const,
      title: "品牌风格样本",
      content: "保留轻盈、专业、对比清晰的表达方式。",
      summary: "轻盈但专业的品牌语气参考。",
      tags: ["品牌", "语气"],
      metadata: {
        confidence: 0.92,
        importance: 8,
        access_count: 2,
        last_accessed_at: 1_712_345_678_000,
        source: "manual" as const,
        embedding: null,
      },
      created_at: 1_712_345_670_000,
      updated_at: 1_712_345_678_000,
      archived: false,
    };
    mockListUnifiedMemories.mockResolvedValue([referenceMemory]);

    const template = findCuratedTaskTemplateById("daily-trend-briefing");
    expect(template).toBeTruthy();
    const promptWithReference = buildCuratedTaskLaunchPrompt({
      task: template!,
      inputValues: {
        theme_target: "AI 内容创作",
        platform_region: "X 与 TikTok 北美区",
      },
      referenceEntries: [
        {
          id: "memory-1",
          title: "品牌风格样本",
          summary: "轻盈但专业的品牌语气参考。",
          category: "context",
          categoryLabel: "参考",
          tags: ["品牌", "语气"],
        },
      ],
    });
    const onSend = vi.fn();
    const setInput = vi.fn();
    const container = renderEmptyState({
      input: promptWithReference,
      setInput,
      onSend,
    });

    const templateButton = container.querySelector(
      '[data-testid="home-gallery-entry-recommended-daily-trend-briefing"]',
    ) as HTMLButtonElement | null;
    expect(templateButton).toBeTruthy();

    act(() => {
      templateButton?.click();
    });

    await act(async () => {
      await Promise.resolve();
    });

    const themeInput = document.body.querySelector(
      "#curated-task-daily-trend-briefing-theme_target",
    ) as HTMLInputElement | null;
    const platformInput = document.body.querySelector(
      "#curated-task-daily-trend-briefing-platform_region",
    ) as HTMLInputElement | null;
    const referenceButton = document.body.querySelector(
      '[data-testid="curated-task-reference-option-memory-1"]',
    ) as HTMLButtonElement | null;

    await act(async () => {
      updateFieldValue(themeInput, "AI 内容创作");
      updateFieldValue(platformInput, "X 与 TikTok 北美区");
      referenceButton?.click();
      await Promise.resolve();
    });

    const confirmButton = findLauncherConfirmButton();
    expect(confirmButton).toBeTruthy();

    await act(async () => {
      confirmButton?.click();
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
      expect.stringContaining("本轮可优先参考这些参考对象"),
      "react",
      undefined,
      expect.objectContaining({
        capabilityRoute: expect.objectContaining({
          kind: "curated_task",
          taskId: "daily-trend-briefing",
          referenceMemoryIds: ["memory-1"],
        }),
        requestMetadata: {
          harness: {
            creation_replay: expect.objectContaining({
              kind: "memory_entry",
            }),
            curated_task: expect.objectContaining({
              task_id: "daily-trend-briefing",
              reference_memory_ids: ["memory-1"],
              reference_entries: [
                expect.objectContaining({
                  id: "memory-1",
                }),
              ],
            }),
          },
        },
      }),
    );
  });

  it("首页结果模板启动时，应默认沿用当前带入的灵感引用", async () => {
    mockListUnifiedMemories.mockResolvedValue([
      {
        id: "memory-1",
        session_id: "session-1",
        memory_type: "project",
        title: "品牌风格样本",
        category: "context",
        summary: "保留轻盈但专业的表达。",
        content: "保留轻盈但专业的表达。",
        tags: ["品牌", "语气"],
        metadata: {
          confidence: 0.9,
          importance: 7,
          access_count: 1,
          last_accessed_at: null,
          source: "manual",
          embedding: null,
        },
        created_at: 1_712_345_670_000,
        updated_at: 1_712_345_678_000,
        archived: false,
      },
    ]);

    const container = renderEmptyState({
      creationReplaySurface: {
        kind: "memory_entry",
        eyebrow: "当前带入灵感",
        badgeLabel: "参考",
        title: "品牌风格样本",
        summary: "保留轻盈但专业的表达。",
        hint: "后续结果模板会默认把它一起带入。",
        defaultReferenceMemoryIds: ["memory-1"],
        defaultReferenceEntries: [
          {
            id: "memory-1",
            title: "品牌风格样本",
            summary: "保留轻盈但专业的表达。",
            category: "context",
            categoryLabel: "参考",
            tags: ["品牌", "语气"],
          },
        ],
      },
    });

    const templateButton = container.querySelector(
      '[data-testid="home-gallery-entry-recommended-daily-trend-briefing"]',
    ) as HTMLButtonElement | null;
    expect(templateButton).toBeTruthy();

    act(() => {
      templateButton?.click();
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain(
      "已选择 1 条参考对象，本轮会一起带入生成。",
    );
  });

  it("首页复盘模板启动时，应默认带入当前项目结果基线", async () => {
    const onSend = vi.fn();
    const setInput = vi.fn();
    const container = renderEmptyState({
      onSend,
      setInput,
      defaultCuratedTaskReferenceEntries: [
        {
          id: "sceneapp:content-pack:run:1",
          sourceKind: "sceneapp_execution_summary",
          title: "AI 内容周报",
          summary: "当前已有一轮运行结果，可直接作为复盘基线。",
          category: "experience",
          categoryLabel: "成果",
          tags: ["复盘", "项目结果"],
          taskPrefillByTaskId: {
            "account-project-review": {
              project_goal: "AI 内容周报",
              existing_results:
                "这轮运行已产出项目结果，但仍需补齐复核意见。 当前卡点：复核阻塞 当前判断：先补复核与修复 经营动作：优先准备结果对齐包，再决定是否继续放大。 更适合去向：结果对齐",
            },
          },
        },
      ],
    });

    const templateButton = container.querySelector(
      '[data-testid="home-gallery-entry-recommended-account-project-review"]',
    ) as HTMLButtonElement | null;
    expect(templateButton).toBeTruthy();
    expect(container.textContent).not.toContain("当前判断：先补复核与修复");
    expect(container.textContent).not.toContain("当前卡点：复核阻塞");
    expect(container.textContent).not.toContain("更适合去向：结果对齐");

    act(() => {
      templateButton?.click();
    });

    await act(async () => {
      await Promise.resolve();
    });

    const goalInput = document.body.querySelector(
      "#curated-task-account-project-review-project_goal",
    ) as HTMLInputElement | null;
    const resultsInput = document.body.querySelector(
      "#curated-task-account-project-review-existing_results",
    ) as HTMLTextAreaElement | null;

    expect(goalInput?.value).toBe("AI 内容周报");
    expect(resultsInput?.value).toContain("这轮运行已产出项目结果");

    const confirmButton = findLauncherConfirmButton();
    expect(confirmButton).toBeTruthy();
    expect(confirmButton?.disabled).toBe(false);

    await act(async () => {
      confirmButton?.click();
      await Promise.resolve();
    });

    expect(setInput).toHaveBeenCalledWith(
      expect.stringContaining("AI 内容周报"),
    );
    expect(onSend).not.toHaveBeenCalled();
  });

  it("首页下游结果模板卡片不应把项目结果基线提前摊开", async () => {
    const container = renderEmptyState({
      defaultCuratedTaskReferenceEntries: [
        {
          id: "sceneapp:content-pack:run:1",
          sourceKind: "sceneapp_execution_summary",
          title: "AI 内容周报",
          summary: "当前已有一轮运行结果，可直接作为后续生成基线。",
          category: "experience",
          categoryLabel: "成果",
          tags: ["复盘", "项目结果"],
          taskPrefillByTaskId: {
            "account-project-review": {
              project_goal: "AI 内容周报",
              existing_results:
                "这轮运行已产出项目结果，但仍需补齐复核意见。 当前卡点：复核阻塞 当前判断：先补复核与修复 经营动作：优先准备结果对齐包，再决定是否继续放大。 更适合去向：结果对齐",
            },
          },
        },
      ],
    });

    const templateButton = container.querySelector(
      '[data-testid="home-gallery-entry-recommended-daily-trend-briefing"]',
    ) as HTMLButtonElement | null;

    await act(async () => {
      await Promise.resolve();
    });

    expect(templateButton).toBeTruthy();
    expect(templateButton?.textContent).toContain("每日趋势摘要");
    expect(container.textContent).not.toContain("当前结果基线：AI 内容周报");
    expect(container.textContent).not.toContain("当前判断：先补复核与修复");
    expect(container.textContent).not.toContain("当前卡点：复核阻塞");
    expect(container.textContent).not.toContain("更适合去向：结果对齐");
  });

  it("当前带入参考灵感时，结果模板推荐应显式标记为围绕当前参考", async () => {
    const container = renderEmptyState({
      creationReplaySurface: {
        kind: "memory_entry",
        eyebrow: "当前带入灵感",
        badgeLabel: "参考",
        title: "品牌风格样本",
        summary: "保留轻盈但专业的表达。",
        hint: "后续结果模板会默认把它一起带入。",
        defaultReferenceMemoryIds: ["memory-1"],
        defaultReferenceEntries: [
          {
            id: "memory-1",
            title: "品牌风格样本",
            summary: "保留轻盈但专业的表达。",
            category: "context",
            categoryLabel: "参考",
            tags: ["品牌", "语气"],
          },
        ],
      },
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain("参考");
    expect(container.textContent).toContain("品牌风格样本");
    expect(container.textContent).toContain("内容主稿生成");
  });

  it("当前带入做法草稿时，首页应显影更明确的连续性横幅", async () => {
    const container = renderEmptyState({
      creationReplaySurface: {
        kind: "skill_scaffold",
        eyebrow: "当前带入做法草稿",
        badgeLabel: "做法草稿",
        title: "账号复盘方法",
        summary: "把结果复盘成下一轮增长方案。",
        hint: "这轮会先沿着这份做法草稿继续生成，跑顺后可回到我的方法继续整理。",
        defaultReferenceMemoryIds: [],
        defaultReferenceEntries: [],
      },
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain("做法草稿");
    expect(container.textContent).toContain("账号复盘方法");
    expect(container.textContent).not.toContain("沿着当前上下文继续");
    expect(container.textContent).not.toContain("先沿着当前做法开工");
  });

  it("最近保存到灵感库的成果信号应影响首页结果模板推荐", async () => {
    recordCuratedTaskRecommendationSignalFromMemory(
      {
        id: "memory-review-1",
        session_id: "session-review-1",
        memory_type: "project",
        category: "experience",
        title: "账号复盘结论",
        summary:
          "最近两次反馈都提示封面信息过密，需要继续复盘增长数据并优化结构。",
        content:
          "最近两次反馈都提示封面信息过密，需要继续复盘增长数据并优化结构。",
        tags: ["复盘", "反馈", "增长"],
        metadata: {
          confidence: 0.92,
          importance: 8,
          access_count: 2,
          last_accessed_at: null,
          source: "manual",
          embedding: null,
        },
        created_at: 1_712_345_670_000,
        updated_at: 1_712_345_678_000,
        archived: false,
      },
      {
        projectId: "project-review",
      },
    );

    const container = renderEmptyState({
      projectId: "project-review",
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("成果：账号复盘结论");
    expect(container.textContent).toContain("复盘这个账号/项目");
  });

  it("已激活结果模板后重新编辑启动信息时，应回填并更新输入", async () => {
    const template = findCuratedTaskTemplateById("daily-trend-briefing");
    expect(template).toBeTruthy();
    const initialInputValues = {
      theme_target: "AI 内容创作",
      platform_region: "X 与 TikTok 北美区",
    };
    const editedInputValues = {
      theme_target: "品牌内容中台",
      platform_region: "LinkedIn 与 X（海外）",
    };
    const initialPrompt = buildCuratedTaskLaunchPrompt({
      task: template!,
      inputValues: initialInputValues,
    });
    const editedPrompt = buildCuratedTaskLaunchPrompt({
      task: template!,
      inputValues: editedInputValues,
    });
    const setInput = vi.fn();
    const container = renderEmptyState({
      input: initialPrompt,
      setInput,
    });

    await act(async () => {
      await Promise.resolve();
    });

    const templateButton = container.querySelector(
      '[data-testid="home-gallery-entry-recommended-daily-trend-briefing"]',
    ) as HTMLButtonElement | null;
    expect(templateButton).toBeTruthy();

    act(() => {
      templateButton?.click();
    });

    const initialThemeInput = document.body.querySelector(
      "#curated-task-daily-trend-briefing-theme_target",
    ) as HTMLInputElement | null;
    const initialPlatformInput = document.body.querySelector(
      "#curated-task-daily-trend-briefing-platform_region",
    ) as HTMLInputElement | null;

    await act(async () => {
      updateFieldValue(initialThemeInput, initialInputValues.theme_target);
      updateFieldValue(
        initialPlatformInput,
        initialInputValues.platform_region,
      );
      await Promise.resolve();
    });

    const firstConfirmButton = findLauncherConfirmButton();
    expect(firstConfirmButton).toBeTruthy();

    await act(async () => {
      firstConfirmButton?.click();
      await Promise.resolve();
    });

    expect(setInput).toHaveBeenLastCalledWith(initialPrompt);

    const editButton = Array.from(container.querySelectorAll("button")).find(
      (button) =>
        button.getAttribute("aria-label") === "编辑 每日趋势摘要 启动信息",
    ) as HTMLButtonElement | undefined;
    expect(editButton).toBeTruthy();

    await act(async () => {
      editButton?.click();
      await Promise.resolve();
    });

    const themeInput = document.body.querySelector(
      "#curated-task-daily-trend-briefing-theme_target",
    ) as HTMLInputElement | null;
    const platformInput = document.body.querySelector(
      "#curated-task-daily-trend-briefing-platform_region",
    ) as HTMLInputElement | null;

    expect(themeInput?.value).toBe(initialInputValues.theme_target);
    expect(platformInput?.value).toBe(initialInputValues.platform_region);

    await act(async () => {
      updateFieldValue(themeInput, editedInputValues.theme_target);
      updateFieldValue(platformInput, editedInputValues.platform_region);
      await Promise.resolve();
    });

    const secondConfirmButton = findLauncherConfirmButton();
    expect(secondConfirmButton).toBeTruthy();

    await act(async () => {
      secondConfirmButton?.click();
      await Promise.resolve();
    });

    expect(setInput).toHaveBeenLastCalledWith(editedPrompt);
  });

  it("首页不再显式暴露做法数量文案", async () => {
    const container = renderEmptyState({
      activeTheme: "general",
      onLaunchBrowserAssist: vi.fn(),
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

    expect(container.textContent).not.toContain("2 套做法可直接复用");
    expect(container.textContent).not.toContain("按需挂上常用做法");
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

  it("通用对话默认展示 Ribbi 式 Tab 起手建议", async () => {
    const container = renderEmptyState({
      activeTheme: "general",
      serviceSkills: [],
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="home-input-tab-suggestion"]')
        ?.textContent,
    ).toContain("tab");
    expect(container.textContent).toContain("帮我整理一下会议纪要");
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
      container.querySelector('button[title="任务拆分偏好已关闭"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="inputbar-access-mode-select"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="chat-model-selector"]'),
    ).toBeNull();
    expect(container.textContent).not.toContain("通用任务上下文");
    expect(container.textContent).toContain("当前模型");
    expect(container.textContent).toContain("gpt-4.1");

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
      'button[title="任务拆分偏好已关闭"]',
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

  it("首页默认不再把执行模式和联网状态作为 hero 徽标暴露", async () => {
    const container = renderEmptyState({
      activeTheme: "general",
      executionStrategy: "code_orchestrated",
      webSearchEnabled: true,
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("编排模式已开启");
    expect(container.textContent).not.toContain("联网搜索已开启");
    expect(
      container.querySelector('[data-testid="home-start-surface"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("调研报告");
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

  it("首页手动选择安装技能后发送时仍应优先使用 capability route", async () => {
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
      latestCall.onSelectInputCapability?.({
        kind: "installed_skill",
        skill,
      });
    });

    const sendButton = container.querySelector(
      'button[aria-label="发送"]',
    ) as HTMLButtonElement | null;
    expect(sendButton).toBeTruthy();

    act(() => {
      sendButton?.click();
    });

    expect(onSend).toHaveBeenCalledWith(
      "请输出一篇品牌故事",
      "react",
      undefined,
      {
        capabilityRoute: {
          kind: "installed_skill",
          skillKey: "custom-writing-skill",
          skillName: "custom-writing-skill",
        },
        displayContent: "请输出一篇品牌故事",
      },
    );
  });

  it("首页先选 capability 再切到服务技能入口时，不应继续残留旧 capability route", async () => {
    const onSend = vi.fn();
    const onSelectServiceSkill = vi.fn<(skill: ServiceSkillHomeItem) => void>();
    const installedSkill: Skill = {
      key: "canvas-design",
      name: "canvas-design",
      description: "desc",
      directory: "canvas-design",
      installed: true,
      sourceKind: "builtin",
    };
    const serviceSkill = createGithubSearchServiceSkill();

    const container = renderEmptyState({
      input: "整理最近发布计划",
      onSend,
      skills: [installedSkill],
      serviceSkills: [serviceSkill],
      onSelectServiceSkill,
    });
    await act(async () => {
      await Promise.resolve();
    });

    const latestCall =
      mockCharacterMention.mock.calls[
        mockCharacterMention.mock.calls.length - 1
      ][0];

    act(() => {
      latestCall.onSelectInputCapability?.({
        kind: "installed_skill",
        skill: installedSkill,
      });
    });

    act(() => {
      latestCall.onSelectInputCapability?.({
        kind: "service_skill",
        skill: serviceSkill,
      });
    });

    expect(onSelectServiceSkill).toHaveBeenCalledWith(serviceSkill);

    const sendButton = container.querySelector(
      'button[aria-label="发送"]',
    ) as HTMLButtonElement | null;
    expect(sendButton).toBeTruthy();

    act(() => {
      sendButton?.click();
    });

    expect(onSend).toHaveBeenCalledWith("整理最近发布计划", "react", undefined);
  });

  it("通用主题不应在首屏直接展示浏览器协助入口", async () => {
    const onLaunchBrowserAssist = vi.fn();
    const container = renderEmptyState({
      activeTheme: "general",
      onLaunchBrowserAssist,
    });
    await act(async () => {
      await Promise.resolve();
    });

    const launchButton = container.querySelector(
      '[data-testid="entry-connect-browser"]',
    ) as HTMLButtonElement | null;
    expect(launchButton).toBeNull();

    expect(onLaunchBrowserAssist).not.toHaveBeenCalled();
  });

  it("通用主题应把 SceneApp 放到第二屏任务库而不是首屏补充入口", async () => {
    const onLaunchSceneApp = vi.fn();
    const container = renderEmptyState({
      activeTheme: "general",
      featuredSceneApps: [createSceneAppEntry()],
      onLaunchSceneApp,
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain("短视频编排");
    expect(
      container.querySelector('[data-testid="home-supplemental-actions"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="sceneapps-home-directory"]'),
    ).toBeNull();

    const launchButton = container.querySelector(
      '[data-testid="home-gallery-entry-sceneapp-story-video-suite"]',
    ) as HTMLButtonElement | null;
    expect(launchButton).toBeTruthy();

    act(() => {
      launchButton?.click();
    });

    expect(onLaunchSceneApp).toHaveBeenCalledWith("story-video-suite");
  });

  it("通用主题不应把 SceneApp 目录页入口提前放到首屏", async () => {
    const onOpenSceneAppsDirectory = vi.fn();
    const container = renderEmptyState({
      activeTheme: "general",
      featuredSceneApps: [createSceneAppEntry()],
      onOpenSceneAppsDirectory,
    });
    await act(async () => {
      await Promise.resolve();
    });

    const browseButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("查看全部做法"),
    );
    expect(browseButton).toBeFalsy();

    expect(onOpenSceneAppsDirectory).not.toHaveBeenCalled();
  });

  it("仅有目录入口但没有可直接收益时，不应默认渲染更多起手方式", async () => {
    const container = renderEmptyState({
      activeTheme: "general",
      onOpenSceneAppsDirectory: vi.fn(),
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("更多起手方式");
    expect(
      container.querySelector('[data-testid="sceneapps-home-directory"]'),
    ).toBeNull();
  });

  it("存在最近 SceneApp 时，即使没有推荐做法也应提供继续最近做法入口", async () => {
    const onResumeRecentSceneApp = vi.fn();
    const container = renderEmptyState({
      activeTheme: "general",
      canResumeRecentSceneApp: true,
      onResumeRecentSceneApp,
    });
    await act(async () => {
      await Promise.resolve();
    });

    const resumeButton = container.querySelector(
      '[data-testid="entry-sceneapp-resume"]',
    ) as HTMLButtonElement | null;
    expect(resumeButton).toBeTruthy();

    act(() => {
      resumeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onResumeRecentSceneApp).toHaveBeenCalledTimes(1);
  });

  it("存在最近会话时应提供继续最近会话入口", async () => {
    const onResumeRecentSession = vi.fn();
    const container = renderEmptyState({
      activeTheme: "general",
      recentSessionTitle: "品牌发布节奏整理",
      recentSessionSummary: "已整理到待确认发布标题这一步。",
      recentSessionActionLabel: "继续最近会话",
      onResumeRecentSession,
    });
    await act(async () => {
      await Promise.resolve();
    });

    const resumeButton = container.querySelector(
      '[data-testid="entry-recent-session-resume"]',
    ) as HTMLButtonElement | null;
    expect(resumeButton).toBeTruthy();
    expect(resumeButton?.textContent).toContain("继续最近会话");
    expect(resumeButton?.textContent).toContain("品牌发布节奏整理");

    act(() => {
      resumeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onResumeRecentSession).toHaveBeenCalledTimes(1);
  });
});
