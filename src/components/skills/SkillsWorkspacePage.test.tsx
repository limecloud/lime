import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Skill } from "@/lib/api/skills";
import type { UnifiedMemory } from "@/lib/api/unifiedMemory";
import type {
  ServiceSkillGroup,
  ServiceSkillHomeItem,
} from "@/components/agent/chat/service-skills/types";
import { recordServiceSkillUsage } from "@/components/agent/chat/service-skills/storage";
import {
  recordCuratedTaskRecommendationSignalFromMemory,
  recordCuratedTaskRecommendationSignalFromReviewDecision,
} from "@/components/agent/chat/utils/curatedTaskRecommendationSignals";
import {
  listSlashEntryUsage,
  recordSlashEntryUsage,
} from "@/components/agent/chat/skill-selection/slashEntryUsage";
import { recordCuratedTaskTemplateUsage } from "@/components/agent/chat/utils/curatedTaskTemplates";
import type { SkillsPageParams } from "@/types/page";
import { SkillsWorkspacePage } from "./SkillsWorkspacePage";

const mockRefreshServiceSkills = vi.fn();
const mockRecordUsage = vi.fn();
const mockRefreshLocalSkills = vi.fn();
const mockAdvancedSkillsPage = vi.fn();
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();

function createDefaultLocalSkills(): Skill[] {
  return [
    {
      key: "local:writer",
      name: "写作助手",
      description: "本地补充技能",
      directory: "writer",
      installed: true,
      sourceKind: "other",
      catalogSource: "user",
      metadata: {
        lime_when_to_use: "当你需要复用本地写作方法时使用。",
        lime_argument_hint: "主题、受众与语气要求",
      },
    },
  ] as Skill[];
}

function createDefaultServiceSkills(): ServiceSkillHomeItem[] {
  return [
    {
      id: "service-skill-1",
      title: "深度研究",
      summary: "综合多来源信息并给出归纳后的结论。",
      category: "调研",
      outputHint: "研究摘要",
      source: "cloud_catalog",
      runnerType: "instant",
      defaultExecutorBinding: "agent_turn",
      executionLocation: "client_default",
      slotSchema: [
        {
          key: "article_source",
          label: "文章链接/正文",
          type: "textarea",
          required: false,
          placeholder: "输入文章链接、正文，或文章摘要",
        },
        {
          key: "target_duration",
          label: "目标时长",
          type: "text",
          required: false,
          defaultValue: "60-90 秒",
          placeholder: "例如 60-90 秒",
        },
      ],
      version: "2026-03-29",
      badge: "云目录",
      recentUsedAt: 1_812_345_678_000,
      isRecent: true,
      runnerLabel: "立即开始",
      runnerTone: "emerald",
      runnerDescription: "会先给出这一轮结果，接着就能继续改。",
      actionLabel: "开始这一步",
      automationStatus: null,
      groupKey: "general",
    },
    {
      id: "service-skill-2",
      title: "品牌文案改写",
      summary: "围绕已有素材整理一版可直接继续创作的文案。",
      category: "创作",
      outputHint: "改写文案",
      source: "cloud_catalog",
      runnerType: "instant",
      defaultExecutorBinding: "agent_turn",
      executionLocation: "client_default",
      slotSchema: [],
      version: "2026-03-29",
      badge: "云目录",
      recentUsedAt: null,
      isRecent: false,
      runnerLabel: "立即开始",
      runnerTone: "emerald",
      runnerDescription: "会先给出这一轮结果，接着就能继续改。",
      actionLabel: "开始这一步",
      automationStatus: null,
      groupKey: "general",
    },
    {
      id: "site-skill:github/search",
      title: "GitHub 仓库检索",
      summary: "围绕关键词采集 GitHub 仓库搜索结果。",
      category: "GitHub",
      outputHint: "仓库列表",
      source: "cloud_catalog",
      runnerType: "instant",
      defaultExecutorBinding: "browser_assist",
      executionLocation: "client_default",
      slotSchema: [
        {
          key: "repository_query",
          label: "检索主题",
          type: "text",
          required: true,
          placeholder: "例如 browser assist mcp",
        },
      ],
      version: "2026-03-29",
      badge: "云目录",
      recentUsedAt: null,
      isRecent: false,
      runnerLabel: "接着浏览器继续",
      runnerTone: "emerald",
      runnerDescription:
        "会接着当前浏览器里已经打开的页面把这一步做完，并把结果带回生成。",
      actionLabel: "补齐这一步",
      automationStatus: null,
      groupKey: "github",
      siteCapabilityBinding: {
        adapterName: "github/search",
        autoRun: true,
        slotArgMap: {
          repository_query: "query",
        },
      },
    },
  ];
}

function createDefaultSkillGroups(): ServiceSkillGroup[] {
  return [
    {
      key: "github",
      title: "GitHub",
      summary: "围绕仓库与 Issue 的只读研究技能。",
      sort: 10,
      itemCount: 1,
    },
    {
      key: "general",
      title: "通用技能",
      summary: "不依赖站点登录态的创作技能。",
      sort: 90,
      itemCount: 2,
    },
  ];
}

let mockServiceSkills = createDefaultServiceSkills();
let mockSkillGroups = createDefaultSkillGroups();
let mockLocalSkills = createDefaultLocalSkills();
const mockListUnifiedMemories = vi.hoisted(() =>
  vi.fn<() => Promise<UnifiedMemory[]>>(async () => []),
);

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
    info: vi.fn(),
    loading: vi.fn(() => "toast-id"),
  },
}));

vi.mock("@/components/agent/chat/service-skills/useServiceSkills", () => ({
  useServiceSkills: () => ({
    skills: mockServiceSkills,
    groups: mockSkillGroups,
    catalogMeta: {
      tenantId: "tenant-demo",
      version: "catalog-v2",
      syncedAt: "2026-03-29T08:00:00Z",
      itemCount: mockServiceSkills.length,
      groupCount: mockSkillGroups.length,
      sourceLabel: "租户技能目录",
      isSeeded: false,
    },
    isLoading: false,
    error: null,
    refresh: mockRefreshServiceSkills,
    recordUsage: mockRecordUsage,
  }),
}));

vi.mock("@/hooks/useSkills", () => ({
  useSkills: () => ({
    skills: mockLocalSkills,
    repos: [],
    loading: false,
    remoteLoading: false,
    error: null,
    refresh: mockRefreshLocalSkills,
    install: vi.fn(),
    uninstall: vi.fn(),
    addRepo: vi.fn(),
    removeRepo: vi.fn(),
  }),
}));

vi.mock("@/lib/api/unifiedMemory", () => ({
  listUnifiedMemories: mockListUnifiedMemories,
}));

vi.mock("./SkillsPage", () => ({
  SkillsPage: (props: Record<string, unknown>) => {
    mockAdvancedSkillsPage(props);
    return <div data-testid="advanced-skills-page">advanced skills page</div>;
  },
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogFooter: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

interface RenderResult {
  container: HTMLDivElement;
  root: Root;
}

const mountedRoots: RenderResult[] = [];

function renderPage(pageParams?: SkillsPageParams) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onNavigate = vi.fn<(page: string, params?: unknown) => void>();

  act(() => {
    root.render(
      <SkillsWorkspacePage onNavigate={onNavigate} pageParams={pageParams} />,
    );
  });

  const rendered = { container, root };
  mountedRoots.push(rendered);
  return {
    container,
    onNavigate,
  };
}

function getBodyText() {
  return document.body.textContent ?? "";
}

function getLatestNavigationPayload(onNavigate: ReturnType<typeof vi.fn>) {
  return onNavigate.mock.calls.at(-1)?.[1] as
    | Record<string, unknown>
    | undefined;
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

async function hoverTip(ariaLabel: string) {
  const trigger = document.body.querySelector(
    `button[aria-label='${ariaLabel}']`,
  );
  expect(trigger).toBeInstanceOf(HTMLButtonElement);

  await act(async () => {
    trigger?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await Promise.resolve();
  });

  return trigger as HTMLButtonElement;
}

async function leaveTip(trigger: HTMLButtonElement | null) {
  await act(async () => {
    trigger?.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    await Promise.resolve();
  });
}

describe("SkillsWorkspacePage", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;

    mockServiceSkills = createDefaultServiceSkills();
    mockSkillGroups = createDefaultSkillGroups();
    mockLocalSkills = createDefaultLocalSkills();
    mockRefreshServiceSkills.mockReset();
    mockRefreshServiceSkills.mockResolvedValue(undefined);
    mockRecordUsage.mockReset();
    mockRefreshLocalSkills.mockReset();
    mockRefreshLocalSkills.mockResolvedValue(undefined);
    mockAdvancedSkillsPage.mockReset();
    mockToastSuccess.mockReset();
    mockToastError.mockReset();
    mockListUnifiedMemories.mockResolvedValue([]);
    window.localStorage.clear();
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

  it("应默认渲染轻量方向入口，并把右侧桥接区收成继续上次做法与已经沉淀的方法", () => {
    const { container } = renderPage();

    expect(container.textContent).toContain("我的方法");
    expect(container.textContent).toContain("先拿结果");
    expect(container.textContent).toContain(
      "先拿一个结果起手；后面常用做法和自己沉淀的方法都在这里续上。",
    );
    expect(container.textContent).toContain("搜做法");
    expect(container.textContent).toContain("换个方向");
    expect(container.textContent).toContain("查看全部做法");
    expect(container.textContent).toContain("继续上次做法");
    expect(container.textContent).toContain("已经沉淀的方法");
    expect(container.textContent).toContain("上面没命中时，再换个方向。");
    expect(container.textContent).toContain(
      "优先接着已经跑过的方法，通常比重新挑一条更省重来成本。",
    );
    expect(container.textContent).toContain(
      "上面没命中时，再从这里接着自己的方法往下走。",
    );
    expect(container.textContent).toContain("每日趋势摘要");
    expect(container.textContent).toContain("脚本转口播/字幕稿");
    expect(container.textContent).toContain("复盘这个账号/项目");
    expect(container.textContent).toContain("你先给");
    expect(container.textContent).toContain("会拿到");
    expect(container.textContent).toContain("这一步先拿");
    expect(container.textContent).toContain("接着可做");
    expect(container.textContent).toContain(
      "这一组里可以先从「GitHub 仓库检索」开始。",
    );
    expect(container.textContent).toContain(
      "这一组里可以先从「品牌文案改写」开始。",
    );
    expect(container.textContent).toContain("进去看看");
    expect(container.textContent).toContain("主题或赛道、希望关注的平台/地域");
    expect(container.textContent).toContain("趋势摘要、3 个优先选题");
    expect(container.textContent).toContain(
      "趋势摘要会先写回当前内容，方便继续展开选题和主稿。",
    );
    expect(container.textContent).toContain(
      "接着可做：继续展开其中一个选题、生成首条内容主稿",
    );
    expect(container.textContent).not.toContain(
      "这里放跑通过的做法；不确定时先回首页拿结果。",
    );
    expect(container.textContent).not.toContain(
      "这里更像方法库：当你已经知道要找哪类做法时，再进入 Agent 对话补参和执行。",
    );
    expect(container.textContent).not.toContain("项目内整理");
    expect(container.textContent).not.toContain("租户技能目录");
    expect(container.textContent).not.toContain("本地 Seeded 目录");
    expect(container.textContent).toContain("GitHub");
    expect(container.textContent).toContain("写作助手");
    expect(container.textContent).toContain("你来给：当前无必填信息");
    expect(container.textContent).toContain("会拿到：研究摘要");
    expect(container.textContent).toContain(
      "结果会回到生成，方便接着改。",
    );
    expect(container.textContent).toContain("当你需要复用本地写作方法时使用。");
    expect(container.textContent).toContain("主题、受众与语气要求");
    expect(container.textContent).toContain("回到生成后会继续按这套方法往下做。");
    expect(container.textContent).toContain(
      "回到生成后会继续按这套方法往下做，跑顺后的结果也会再沉淀回来。",
    );
    expect(container.textContent).toContain("继续这套方法");
    expect(container.textContent).not.toContain("方法入口：/local:writer");
    expect(container.textContent).not.toContain("已安装");
    expect(container.textContent).not.toContain(
      "GitHub 仓库检索围绕关键词采集",
    );

    const bodyText = container.textContent ?? "";
    expect(bodyText.indexOf("先拿结果")).toBeLessThan(
      bodyText.indexOf("继续上次做法"),
    );
    expect(bodyText.indexOf("继续上次做法")).toBeLessThan(
      bodyText.indexOf("已经沉淀的方法"),
    );
  });

  it("查看全部做法应带着当前搜索进入 sceneapps 目录", () => {
    const { container, onNavigate } = renderPage();

    const searchInput = container.querySelector(
      'input[placeholder="搜索想拿的结果、这一步或做法名"]',
    ) as HTMLInputElement | null;
    act(() => {
      updateFieldValue(searchInput, "GitHub");
    });

    const openDirectoryButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("查看全部做法"));
    expect(openDirectoryButton).toBeTruthy();

    act(() => {
      openDirectoryButton?.click();
    });

    expect(onNavigate).toHaveBeenCalledWith("sceneapps", {
      view: "catalog",
      search: "GitHub",
    });
  });

  it("应在我的方法首屏显式展示创作场景迁移入口", () => {
    const { container } = renderPage();

    expect(container.querySelector(".lime-workbench-theme-scope")).toBeTruthy();

    const banner = container.querySelector(
      '[data-testid="skills-workspace-sceneapps-migration-banner"]',
    ) as HTMLDivElement | null;

    expect(banner).toBeTruthy();
    expect(banner?.className).toContain("var(--lime-info-soft)");
    expect(banner?.textContent).toContain("完整做法都在这里");
    expect(banner?.textContent).toContain("查看全部做法");
  });

  it("最近保存到灵感库的成果信号应影响技能页的结果模板推荐", () => {
    recordCuratedTaskRecommendationSignalFromMemory(
      {
        id: "memory-review-1",
        session_id: "session-review-1",
        memory_type: "project",
        category: "experience",
        title: "账号复盘结论",
        summary: "最近两次反馈都提示封面信息过密，需要继续复盘增长数据并优化结构。",
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

    const { container } = renderPage({
      creationProjectId: "project-review",
    });

    expect(container.textContent).toContain("复盘这个账号/项目");
    expect(container.textContent).toContain("围绕最近成果");
  });

  it("最近人工判断信号应在方法页先拿结果区域显影判断横幅", async () => {
    recordCuratedTaskRecommendationSignalFromReviewDecision(
      {
        session_id: "session-review-needs-evidence",
        decision_status: "needs_more_evidence",
        decision_summary: "这轮结果还缺证据，需要回到账号表现和爆款样本继续补证据。",
        chosen_fix_strategy: "先补账号数据复盘，再拆一轮高表现内容做对照。",
        risk_level: "medium",
        risk_tags: ["证据不足", "需要复盘"],
        followup_actions: ["补账号数据复盘", "拆解一条高表现内容"],
      },
      {
        projectId: "project-review",
        sceneTitle: "短视频编排",
      },
    );

    const { container } = renderPage({
      creationProjectId: "project-review",
    });

    await act(async () => {
      await Promise.resolve();
    });

    const banner = container.querySelector(
      '[data-testid="skills-workspace-review-feedback-banner"]',
    );

    expect(banner?.textContent).toContain("最近判断已更新");
    expect(banner?.textContent).toContain("短视频编排 · 补证据");
    expect(banner?.textContent).toContain("这轮结果还缺证据");
    expect(banner?.textContent).toContain(
      "这轮判断更建议优先回到「复盘这个账号/项目」或「拆解一条爆款内容」",
    );
    expect(banner?.textContent).toContain(
      "更适合继续：复盘这个账号/项目 / 拆解一条爆款内容",
    );

    const bannerAction = container.querySelector(
      '[data-testid="skills-workspace-review-feedback-banner-action"]',
    ) as HTMLButtonElement | null;
    expect(bannerAction?.textContent).toContain("继续去「复盘这个账号/项目」");

    await act(async () => {
      bannerAction?.click();
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("开始这一步前，我先确认几件事。");
    expect(document.body.textContent).toContain("复盘这个账号/项目");
  });

  it("我的方法页的 launcher 在当前模板不是复盘首选时，应可直接切到推荐模板", async () => {
    recordCuratedTaskRecommendationSignalFromReviewDecision(
      {
        session_id: "session-review-switch-launcher",
        decision_status: "needs_more_evidence",
        decision_summary: "这轮结果还缺证据，需要回到账号表现和爆款样本继续补证据。",
        chosen_fix_strategy: "先补账号数据复盘，再拆一轮高表现内容做对照。",
        risk_level: "medium",
        risk_tags: ["证据不足", "需要复盘"],
        followup_actions: ["补账号数据复盘", "拆解一条高表现内容"],
      },
      {
        projectId: "project-review",
        sceneTitle: "短视频编排",
      },
    );

    const { container } = renderPage({
      creationProjectId: "project-review",
    });

    const launchButton = Array.from(container.querySelectorAll("button")).find(
      (button) =>
        button.textContent?.includes("进入生成") &&
        button.closest("article")?.textContent?.includes("每日趋势摘要"),
    );
    expect(launchButton).toBeTruthy();

    act(() => {
      launchButton?.click();
    });

    const actionButton = document.body.querySelector(
      '[data-testid="curated-task-launcher-review-feedback-banner-action"]',
    ) as HTMLButtonElement | null;
    expect(actionButton?.textContent).toContain("改用「复盘这个账号/项目」");

    await act(async () => {
      actionButton?.click();
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("复盘这个账号/项目");
    expect(document.body.textContent).toContain(
      "已按最近判断切到更适合的结果模板",
    );
  });

  it("复盘模板卡片应显式带出当前结果基线的经营摘要", async () => {
    recordCuratedTaskTemplateUsage({
      templateId: "account-project-review",
      usedAt: 1_812_345_680_000,
      launchInputValues: {
        project_goal: "AI 内容周报",
      },
      referenceEntries: [
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
                "这轮运行已产出项目结果 当前卡点：复核阻塞 当前判断：先补复核与修复 经营动作：优先准备结果对齐包，再决定是否继续放大。 更适合去向：结果对齐",
            },
          },
        },
      ],
    });

    const { container } = renderPage({
      creationProjectId: "project-review",
    });

    expect(container.textContent).toContain("当前结果基线：AI 内容周报");
    expect(container.textContent).toContain("当前判断：先补复核与修复");
    expect(container.textContent).toContain("当前卡点：复核阻塞");
    expect(container.textContent).toContain("更适合去向：结果对齐");
  });

  it("下游结果模板卡片也应显式带出当前结果基线的经营摘要", async () => {
    recordCuratedTaskTemplateUsage({
      templateId: "daily-trend-briefing",
      usedAt: 1_812_345_680_000,
      launchInputValues: {
        theme_target: "AI 内容周报",
        platform_region: "X + TikTok（北美）",
      },
      referenceEntries: [
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
                "这轮运行已产出项目结果 当前卡点：复核阻塞 当前判断：先补复核与修复 经营动作：优先准备结果对齐包，再决定是否继续放大。 更适合去向：结果对齐",
            },
          },
        },
      ],
    });

    const { container } = renderPage({
      creationProjectId: "project-review",
    });

    expect(container.textContent).toContain("每日趋势摘要");
    expect(container.textContent).toContain("当前结果基线：AI 内容周报");
    expect(container.textContent).toContain("当前判断：先补复核与修复");
    expect(container.textContent).toContain("当前卡点：复核阻塞");
    expect(container.textContent).toContain("更适合去向：结果对齐");
  });

  it("应在方法页显影最近一次的结果模板、常用做法和本地方法输入摘要", async () => {
    recordCuratedTaskTemplateUsage({
      templateId: "daily-trend-briefing",
      usedAt: 1_800_000_000_000,
      launchInputValues: {
        theme_target: "AI 内容创作",
        platform_region: "X + TikTok（北美）",
      },
      referenceEntries: [
        {
          id: "memory-reference-1",
          title: "品牌定位卡",
          summary: "偏实验感、偏高频更新的内容品牌方向。",
          category: "identity",
          categoryLabel: "风格",
          tags: ["品牌", "风格"],
        },
      ],
    });
    recordServiceSkillUsage({
      skillId: "service-skill-1",
      runnerType: "instant",
      usedAt: 1_800_000_000_100,
      slotValues: {
        article_source: "https://example.com/article",
        target_duration: "90 秒",
      },
      launchUserInput: "保留对团队协作方式的强调",
    });
    recordSlashEntryUsage({
      kind: "skill",
      entryId: "local:writer",
      usedAt: 1_800_000_000_200,
      replayText: "继续优化这套写作方法",
    });

    const { container } = renderPage();

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain(
      "上次填写：主题或赛道=AI 内容创作；希望关注的平台/地域=X + TikTok（北美）",
    );
    expect(container.textContent).toContain("参考：品牌定位卡");
    expect(container.textContent).toContain(
      "上次填写：文章链接/正文=https://example.com/article；目标时长=90 秒",
    );
    expect(container.textContent).toContain(
      "上次补充：保留对团队协作方式的强调",
    );
    expect(container.textContent).toContain("上次目标：继续优化这套写作方法");
  });

  it("页面打开后新增本地方法 recent usage 时应即时刷新已经沉淀的方法", async () => {
    const { container } = renderPage();

    expect(container.textContent).not.toContain("上次目标：继续优化这套写作方法");

    await act(async () => {
      recordSlashEntryUsage({
        kind: "skill",
        entryId: "local:writer",
        usedAt: 1_800_000_000_300,
        replayText: "继续优化这套写作方法",
      });
      await Promise.resolve();
    });

    expect(container.textContent).toContain("上次目标：继续优化这套写作方法");
  });

  it("推荐技能组卡片不应重复展示已进入继续上次做法的技能", () => {
    const { container } = renderPage();

    const generalCard = Array.from(container.querySelectorAll("article")).find(
      (article) => article.textContent?.includes("通用技能"),
    );

    expect(generalCard).toBeTruthy();
    expect(container.textContent).toContain("深度研究");
    expect(generalCard?.textContent).toContain("品牌文案改写");
    expect(generalCard?.textContent).not.toContain("深度研究");
  });

  it("应把主入口说明和搜索说明收进 tips", async () => {
    renderPage();

    expect(getBodyText()).not.toContain(
      "先从结果起手，顺手的做法和自己沉淀下来的方法都在这里续上；点开后直接把这一步接下去。",
    );
    expect(getBodyText()).not.toContain(
      "先从这轮想拿的结果方向找起；没命中时，再接着你自己顺手的方法。",
    );

    const entryTip = await hoverTip("方法主入口说明");
    expect(getBodyText()).toContain(
      "先从结果起手，顺手的做法和自己沉淀下来的方法都在这里续上；点开后直接把这一步接下去。",
    );
    await leaveTip(entryTip);

    const searchTip = await hoverTip("做法搜索说明");
    expect(getBodyText()).toContain(
      "先从这轮想拿的结果方向找起；没命中时，再接着你自己顺手的方法。",
    );
    await leaveTip(searchTip);
  });

  it("点击技能组后应进入组内技能列表并跳转到 Agent 对话承接", () => {
    const { container, onNavigate } = renderPage();

    const groupButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("进去看看"),
    );
    expect(groupButton).toBeTruthy();

    act(() => {
      groupButton?.click();
    });

    expect(container.textContent).toContain("GitHub 仓库检索");
    expect(container.textContent).toContain("你先给：检索主题");
    expect(container.textContent).toContain("会拿到：仓库列表");
    expect(container.textContent).toContain(
      "接下来：会接着当前浏览器里已经打开的页面把这一步做完，并把结果带回生成。",
    );
    expect(container.textContent).toContain(
      "结果会先回到当前内容里，方便接着往下改。",
    );

    const launchButton = Array.from(container.querySelectorAll("button")).find(
      (button) =>
        button.textContent?.includes("补齐这一步") &&
        button.closest("article")?.textContent?.includes("GitHub 仓库检索"),
    );
    expect(launchButton).toBeTruthy();

    act(() => {
      launchButton?.click();
    });

    expect(onNavigate).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        agentEntry: "new-task",
        theme: "general",
        initialPendingServiceSkillLaunch: expect.objectContaining({
          skillId: "site-skill:github/search",
          requestKey: expect.any(Number),
        }),
      }),
    );
    expect(mockRecordUsage).not.toHaveBeenCalled();
  });

  it("点击结果模板时，应先补齐最小启动输入，再把 curated task 接回生成并继承当前项目", async () => {
    const { container, onNavigate } = renderPage({
      creationProjectId: "project-review",
    });

    const launchButton = Array.from(container.querySelectorAll("button")).find(
      (button) =>
        button.textContent?.includes("进入生成") &&
        button
          .closest("article")
          ?.textContent?.includes("每日趋势摘要"),
    );
    expect(launchButton).toBeTruthy();

    act(() => {
      launchButton?.click();
    });

    expect(container.textContent).toContain("开始这一步前，我先确认几件事。");
    expect(onNavigate).not.toHaveBeenCalled();

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

    const confirmButton =
      (document.body.querySelector(
        '[data-testid="curated-task-launcher-confirm"]',
      ) as HTMLButtonElement | null) ??
      Array.from(document.body.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("开始生成"),
      );
    expect(confirmButton).toBeTruthy();
    expect((confirmButton as HTMLButtonElement).disabled).toBe(false);

    await act(async () => {
      confirmButton?.click();
      await Promise.resolve();
    });

    expect(onNavigate).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        projectId: "project-review",
        agentEntry: "new-task",
        theme: "general",
        initialInputCapability: expect.objectContaining({
          capabilityRoute: expect.objectContaining({
            kind: "curated_task",
            taskId: "daily-trend-briefing",
            taskTitle: "每日趋势摘要",
            prompt: expect.stringContaining("主题或赛道：AI 内容创作"),
            launchInputValues: {
              theme_target: "AI 内容创作",
              platform_region: "X 与 TikTok 北美区",
            },
          }),
          requestKey: expect.any(Number),
        }),
        entryBannerMessage:
          "已带着结果模板“每日趋势摘要”的启动信息回到生成，接着把这轮做下去就行。",
      }),
    );
    expect(
      (
        getLatestNavigationPayload(onNavigate)?.initialInputCapability as
          | { capabilityRoute?: { prompt?: string } }
          | undefined
      )?.capabilityRoute?.prompt,
    ).toContain("希望关注的平台/地域：X 与 TikTok 北美区");
  });

  it("结果模板带上灵感引用进入生成时，应同时透传 route 与 request metadata", async () => {
    mockListUnifiedMemories.mockResolvedValue([
      {
        id: "memory-1",
        session_id: "session-1",
        memory_type: "project",
        category: "context",
        title: "品牌风格样本",
        content: "保留轻盈、专业、对比清晰的表达方式。",
        summary: "轻盈但专业的品牌语气参考。",
        tags: ["品牌", "语气"],
        metadata: {
          confidence: 0.92,
          importance: 8,
          access_count: 3,
          last_accessed_at: 1_712_345_678_000,
          source: "manual",
          embedding: null,
        },
        created_at: 1_712_345_670_000,
        updated_at: 1_712_345_678_000,
        archived: false,
      },
    ]);

    const { container, onNavigate } = renderPage();

    const launchButton = Array.from(container.querySelectorAll("button")).find(
      (button) =>
        button.textContent?.includes("进入生成") &&
        button
          .closest("article")
          ?.textContent?.includes("每日趋势摘要"),
    );
    expect(launchButton).toBeTruthy();

    act(() => {
      launchButton?.click();
    });

    const themeInput = document.body.querySelector(
      "#curated-task-daily-trend-briefing-theme_target",
    ) as HTMLInputElement | null;
    const platformInput = document.body.querySelector(
      "#curated-task-daily-trend-briefing-platform_region",
    ) as HTMLInputElement | null;

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      updateFieldValue(themeInput, "AI 内容创作");
      updateFieldValue(platformInput, "X 与 TikTok 北美区");
      await Promise.resolve();
    });

    const referenceButton = document.body.querySelector(
      '[data-testid="curated-task-reference-option-memory-1"]',
    ) as HTMLButtonElement | null;
    expect(referenceButton).toBeTruthy();

    await act(async () => {
      referenceButton?.click();
      await Promise.resolve();
    });

    const confirmButton =
      (document.body.querySelector(
        '[data-testid="curated-task-launcher-confirm"]',
      ) as HTMLButtonElement | null) ??
      Array.from(document.body.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("开始生成"),
      );
    expect(confirmButton).toBeTruthy();

    await act(async () => {
      confirmButton?.click();
      await Promise.resolve();
    });

    const payload = getLatestNavigationPayload(onNavigate);
    expect(payload).toMatchObject({
      initialInputCapability: {
        capabilityRoute: {
          kind: "curated_task",
          taskId: "daily-trend-briefing",
          launchInputValues: {
            theme_target: "AI 内容创作",
            platform_region: "X 与 TikTok 北美区",
          },
          referenceMemoryIds: ["memory-1"],
          referenceEntries: [
            expect.objectContaining({
              id: "memory-1",
              title: "品牌风格样本",
              category: "context",
            }),
          ],
        },
      },
      initialRequestMetadata: {
        harness: {
          curated_task: {
            task_id: "daily-trend-briefing",
            reference_memory_ids: ["memory-1"],
          },
          creation_replay: expect.objectContaining({
            kind: "memory_entry",
            data: expect.objectContaining({
              title: "品牌风格样本",
              category: "context",
            }),
          }),
        },
      },
    });
  });

  it("做法组只剩最近使用时，打开后仍应回退展示该技能", () => {
    mockServiceSkills = [
      {
        ...createDefaultServiceSkills()[0],
        id: "site-skill:zhihu/qa",
        title: "知乎问答拆解",
        summary: "围绕知乎问答拆出观点结构与可复用表达。",
        category: "知乎",
        groupKey: "zhihu",
      },
    ];
    mockSkillGroups = [
      {
        key: "zhihu",
        title: "知乎",
        summary: "围绕问答拆解与创作的技能组。",
        sort: 10,
        itemCount: 1,
      },
    ];

    const { container } = renderPage();

    const zhihuCard = Array.from(container.querySelectorAll("article")).find(
      (article) => article.textContent?.includes("知乎"),
    );
    expect(zhihuCard?.textContent).toContain("先带着这次目标进去继续收窄。");

    const openButton = Array.from(
      zhihuCard?.querySelectorAll("button") ?? [],
    ).find((button) => button.textContent?.includes("进去看看"));
    expect(openButton).toBeTruthy();

    act(() => {
      openButton?.click();
    });

    expect(container.textContent).toContain("知乎问答拆解");
    expect(container.textContent).toContain("开始这一步");
  });

  it("技能页带着技能草稿时，应把预填参数交给 Agent 对话里的 A2UI", () => {
    const { container, onNavigate } = renderPage({
      initialScaffoldDraft: {
        name: "AI Agent 行业拆解",
        description: "参考原文做一版 90 秒总结，结论更聚焦团队协作。",
        sourceExcerpt: "参考 https://example.com/report 并保留关键结论。",
      },
      initialScaffoldRequestKey: 20260412,
    });

    const launchButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("深度研究"),
    );
    expect(launchButton).toBeTruthy();

    act(() => {
      launchButton?.click();
    });

    expect(onNavigate).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        initialPendingServiceSkillLaunch: {
          skillId: "service-skill-1",
          requestKey: expect.any(Number),
          initialSlotValues: {
            article_source:
              "参考线索：参考 https://example.com/report 并保留关键结论。\n改写目标：参考原文做一版 90 秒总结，结论更聚焦团队协作。\n来源标题：AI Agent 行业拆解",
            target_duration: "90 秒",
          },
          prefillHint:
            "已根据当前技能草稿自动预填 文章链接/正文、目标时长，可继续修改后执行。",
        },
      }),
    );
    expect(mockRecordUsage).not.toHaveBeenCalled();
  });

  it("技能页独立选择服务技能时，应复用最近一次成功参数并交给 Agent", () => {
    recordServiceSkillUsage({
      skillId: "service-skill-1",
      runnerType: "instant",
      slotValues: {
        article_source: "上次沉淀的文章摘要",
        target_duration: "120 秒",
      },
      launchUserInput: "保留更强的团队协作视角",
    });

    const { container, onNavigate } = renderPage();

    const launchButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("深度研究"),
    );
    expect(launchButton).toBeTruthy();

    act(() => {
      launchButton?.click();
    });

    expect(onNavigate).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        initialPendingServiceSkillLaunch: {
          skillId: "service-skill-1",
          requestKey: expect.any(Number),
          initialSlotValues: {
            article_source: "上次沉淀的文章摘要",
            target_duration: "120 秒",
          },
          launchUserInput: "保留更强的团队协作视角",
          prefillHint:
            "已根据你上次成功执行 深度研究 时的参数自动预填，可继续修改后执行。",
        },
      }),
    );
    expect(mockRecordUsage).not.toHaveBeenCalled();
  });

  it("技能页选择普通技能后，应把 pending skill 和当前项目一起交给 Agent 对话处理", async () => {
    const { container, onNavigate } = renderPage({
      creationProjectId: "project-demo",
    });

    const launchButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("深度研究"),
    );
    expect(launchButton).toBeTruthy();

    await act(async () => {
      launchButton?.click();
    });

    const payload = getLatestNavigationPayload(onNavigate);
    expect(payload).toEqual(
      expect.objectContaining({
        projectId: "project-demo",
        agentEntry: "new-task",
        initialPendingServiceSkillLaunch: expect.objectContaining({
          skillId: "service-skill-1",
        }),
      }),
    );
    expect(mockRecordUsage).not.toHaveBeenCalled();
  });

  it("技能页选择站点技能后，应交由 Agent 对话继续承接而不是本页直接启动", async () => {
    const { container, onNavigate } = renderPage();

    const groupButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("进去看看"),
    );
    expect(groupButton).toBeTruthy();

    act(() => {
      groupButton?.click();
    });

    expect(container.textContent).toContain("正在看这一组");
    expect(container.textContent).toContain(
      "先从 GitHub 里最接近的一条开始；不对再换方向。",
    );
    expect(container.textContent).toContain("围绕仓库与 Issue 的只读研究技能。");
    expect(container.textContent).toContain("换个方向");

    const launchButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("补齐这一步"),
    );
    expect(launchButton).toBeTruthy();

    await act(async () => {
      launchButton?.click();
    });

    const payload = getLatestNavigationPayload(onNavigate);
    expect(payload).toEqual(
      expect.objectContaining({
        agentEntry: "new-task",
        initialPendingServiceSkillLaunch: expect.objectContaining({
          skillId: "site-skill:github/search",
        }),
      }),
    );
    expect(mockRecordUsage).not.toHaveBeenCalled();
  });

  it("点击刷新做法应同时刷新云端与本地方法", async () => {
    const { container } = renderPage();

    const refreshButton = container.querySelector(
      '[data-testid="skills-workspace-refresh-button"]',
    ) as HTMLButtonElement | null;
    expect(refreshButton).toBeTruthy();

    await act(async () => {
      refreshButton?.click();
      await Promise.resolve();
    });

    expect(mockRefreshServiceSkills).toHaveBeenCalledTimes(1);
    expect(mockRefreshLocalSkills).toHaveBeenCalledTimes(1);
  });

  it("点击已经沉淀的方法中的已安装技能时，应带着初始输入能力和当前项目进入生成", () => {
    const { container, onNavigate } = renderPage({
      creationProjectId: "project-review",
    });

    const launchButton = Array.from(container.querySelectorAll("button")).find(
      (button) =>
        button.textContent?.includes("继续这套方法") &&
        button.closest("article")?.textContent?.includes("写作助手"),
    );
    expect(launchButton).toBeTruthy();

    act(() => {
      launchButton?.click();
    });

    expect(onNavigate).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        projectId: "project-review",
        agentEntry: "new-task",
        theme: "general",
        entryBannerMessage:
          "已带着方法“写作助手”回到生成，接着把这轮做下去就行。",
        initialInputCapability: {
          capabilityRoute: {
            kind: "installed_skill",
            skillKey: "local:writer",
            skillName: "写作助手",
          },
          requestKey: expect.any(Number),
        },
      }),
    );
  });

  it("已经沉淀的方法卡片若已有上次目标，进入生成时应一并恢复这条目标", () => {
    recordSlashEntryUsage({
      kind: "skill",
      entryId: "local:writer",
      usedAt: 1_800_000_000_400,
      replayText: "继续优化这套写作方法",
    });

    const { container, onNavigate } = renderPage();

    const launchButton = Array.from(container.querySelectorAll("button")).find(
      (button) =>
        button.textContent?.includes("继续这套方法") &&
        button.closest("article")?.textContent?.includes("写作助手"),
    );
    expect(launchButton).toBeTruthy();

    act(() => {
      launchButton?.click();
    });

    expect(onNavigate).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        agentEntry: "new-task",
        theme: "general",
        initialUserPrompt: "继续优化这套写作方法",
        entryBannerMessage:
          "已带着方法“写作助手”和上次目标回到生成，接着把这轮做下去就行。",
        initialInputCapability: {
          capabilityRoute: {
            kind: "installed_skill",
            skillKey: "local:writer",
            skillName: "写作助手",
          },
          requestKey: expect.any(Number),
        },
      }),
    );
  });

  it("应默认展示本地已安装技能，并可打开调整入口", () => {
    const { container } = renderPage();

    expect(container.textContent).toContain("写作助手");
    expect(container.textContent).toContain("当你需要复用本地写作方法时使用。");
    expect(container.textContent).toContain("你来给：主题、受众与语气要求");
    expect(container.textContent).toContain("会拿到：带着该方法进入生成");
    expect(container.textContent).toContain("回到生成后会继续按这套方法往下做。");
    expect(container.textContent).toContain("继续这套方法");

    const manageButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("调整"),
    );
    expect(manageButton).toBeTruthy();

    act(() => {
      manageButton?.click();
    });

    expect(container.textContent).toContain("advanced skills page");
  });

  it("带着技能草稿进入时应自动打开调整弹窗，并透传预填参数", () => {
    const { container } = renderPage({
      initialScaffoldDraft: {
        target: "project",
        directory: "saved-skill-demo",
        name: "结果沉淀技能",
        description: "沉淀自一次成功结果",
        sourceExcerpt: "一段结果摘要",
      },
      initialScaffoldRequestKey: 20260408,
    });

    expect(document.body.textContent).toContain("advanced skills page");
    expect(mockAdvancedSkillsPage).toHaveBeenCalledWith(
      expect.objectContaining({
        hideHeader: true,
        initialScaffoldDraft: expect.objectContaining({
          directory: "saved-skill-demo",
          name: "结果沉淀技能",
        }),
        initialScaffoldRequestKey: 20260408,
        onBringScaffoldToCreation: expect.any(Function),
        onScaffoldCreated: expect.any(Function),
      }),
    );
    expect(
      container.querySelector(
        '[data-testid="skills-workspace-active-scaffold-banner"]',
      )?.textContent,
    ).toContain("这次续用");
    expect(container.textContent).toContain("结果沉淀技能");
    expect(container.textContent).toContain("这次沿用：沉淀自一次成功结果");
    expect(container.textContent).toContain("继续补完");
    expect(container.textContent).toContain("回到生成");
    expect(container.textContent).toContain(
      "上次目标：一段结果摘要",
    );
    expect(container.textContent).not.toContain(
      "这套做法草稿已经从当前结果带到方法页",
    );
    expect(container.textContent).not.toContain("当前草稿");
    expect(container.textContent).not.toContain("项目内整理");
  });

  it("技能草稿创建成功后应回到已经沉淀的方法并提供轻量续接", async () => {
    const { container, onNavigate } = renderPage({
      initialScaffoldDraft: {
        target: "project",
        directory: "saved-skill-demo",
        name: "结果沉淀技能",
        description: "沉淀自一次成功结果",
        sourceExcerpt: "一段结果摘要",
      },
      initialScaffoldRequestKey: 20260410,
    });

    mockRefreshLocalSkills.mockImplementation(async () => {
      mockLocalSkills = [
        {
          key: "local:saved-skill-demo",
          name: "结果沉淀技能",
          description: "沉淀自一次成功结果",
          directory: "saved-skill-demo",
          installed: true,
          sourceKind: "other",
          catalogSource: "project",
          metadata: {
            lime_when_to_use: "当你需要继续复用这套结果做法时使用。",
            lime_argument_hint: "目标、参考和复盘约束",
          },
        },
        ...createDefaultLocalSkills(),
      ];
    });

    const latestProps = mockAdvancedSkillsPage.mock.lastCall?.[0] as
      | {
          onScaffoldCreated?: (skill: Skill) => Promise<void> | void;
        }
      | undefined;

    await act(async () => {
      await latestProps?.onScaffoldCreated?.({
        key: "local:saved-skill-demo",
        name: "结果沉淀技能",
        description: "沉淀自一次成功结果",
        directory: "saved-skill-demo",
        installed: true,
        sourceKind: "other",
        catalogSource: "project",
        metadata: {
          lime_when_to_use: "当你需要继续复用这套结果做法时使用。",
          lime_argument_hint: "目标、参考和复盘约束",
        },
      });
    });

    expect(mockRefreshLocalSkills).toHaveBeenCalledTimes(1);
    expect(mockToastSuccess).toHaveBeenCalledWith("已创建“结果沉淀技能”并收进我的方法");
    expect(container.textContent).toContain("结果沉淀技能");
    expect(container.textContent).toContain("刚沉淀");
    expect(container.textContent).toContain("已经收回这里，后面可以直接继续。");
    expect(container.textContent).toContain("继续生成");
    expect(container.textContent).not.toContain("刚沉淀成功");
    expect(container.textContent).not.toContain(
      "这套做法刚从当前结果沉淀下来，已经回到你的方法库，可以直接带去生成继续跑下一轮。",
    );
    expect(container.textContent).not.toContain(
      "这套做法已经从当前结果回到你的方法库；如果准备直接跑下一轮，现在可以带着它回到生成继续推进。",
    );
    expect(container.textContent).toContain("上次目标：一段结果摘要");
    expect(listSlashEntryUsage()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "skill",
          entryId: "local:saved-skill-demo",
          replayText: "一段结果摘要",
        }),
      ]),
    );
    expect(document.body.textContent).not.toContain("advanced skills page");

    const manageButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("调整"),
    );
    expect(manageButton).toBeTruthy();

    act(() => {
      manageButton?.click();
    });

    const reopenedProps = mockAdvancedSkillsPage.mock.lastCall?.[0] as
      | {
      initialScaffoldDraft?: Record<string, unknown> | null;
      initialScaffoldRequestKey?: number | null;
    }
      | undefined;

    expect(reopenedProps?.initialScaffoldDraft).toBeNull();
    expect(reopenedProps?.initialScaffoldRequestKey).toBeNull();

    const continueButton = container.querySelector(
      '[data-testid="skills-workspace-highlighted-skill-continue"]',
    );
    expect(continueButton).toBeTruthy();

    act(() => {
      continueButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onNavigate).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        agentEntry: "new-task",
        theme: "general",
        initialUserPrompt: "一段结果摘要",
        entryBannerMessage:
          "已带着方法“结果沉淀技能”和上次目标回到生成，接着把这轮做下去就行。",
        initialInputCapability: {
          capabilityRoute: {
            kind: "installed_skill",
            skillKey: "local:saved-skill-demo",
            skillName: "结果沉淀技能",
          },
          requestKey: expect.any(Number),
        },
      }),
    );
  });

  it("技能草稿应支持从调整弹窗带回创作输入", () => {
    const { onNavigate } = renderPage({
      creationProjectId: "project-demo",
      initialScaffoldDraft: {
        target: "project",
        directory: "saved-skill-demo",
        name: "结果沉淀技能",
        description: "沉淀自一次成功结果",
        whenToUse: ["当你需要继续复用这类结果时使用。"],
        inputs: ["目标与主题：一段结果摘要"],
        outputs: ["交付一份可直接复用的完整结果。"],
        steps: ["先确认目标，再沿用结构。"],
        fallbackStrategy: ["信息不足时先补问。"],
        sourceExcerpt: "一段结果摘要",
        sourceMessageId: "msg-1",
      },
      initialScaffoldRequestKey: 20260409,
    });

    const latestProps = mockAdvancedSkillsPage.mock.lastCall?.[0] as
      | {
          onBringScaffoldToCreation?: (draft: Record<string, unknown>) => void;
        }
      | undefined;

    act(() => {
      latestProps?.onBringScaffoldToCreation?.({
        name: "结果沉淀技能",
        description: "沉淀自一次成功结果",
        whenToUse: ["当你需要继续复用这类结果时使用。"],
        inputs: ["目标与主题：一段结果摘要"],
        outputs: ["交付一份可直接复用的完整结果。"],
        steps: ["先确认目标，再沿用结构。"],
        fallbackStrategy: ["信息不足时先补问。"],
        sourceExcerpt: "一段结果摘要",
      });
    });

    expect(onNavigate).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        projectId: "project-demo",
        agentEntry: "new-task",
        initialUserPrompt: expect.stringContaining("技能名称：结果沉淀技能"),
        entryBannerMessage:
          "已从技能草稿“结果沉淀技能”带回创作输入，可继续改写后发送。",
        initialRequestMetadata: {
          harness: {
            creation_replay: expect.objectContaining({
              kind: "skill_scaffold",
              source: expect.objectContaining({
                page: "skills",
                project_id: "project-demo",
              }),
              data: expect.objectContaining({
                name: "结果沉淀技能",
                inputs: ["目标与主题：一段结果摘要"],
                steps: ["先确认目标，再沿用结构。"],
              }),
            }),
          },
        },
      }),
    );
    expect(
      (onNavigate.mock.calls[0]?.[1] as { initialUserPrompt?: string } | undefined)
        ?.initialUserPrompt,
    ).toContain("执行步骤：");
  });

  it("技能草稿 strip 应支持直接回到生成继续写", () => {
    const { container, onNavigate } = renderPage({
      creationProjectId: "project-demo",
      initialScaffoldDraft: {
        target: "project",
        directory: "saved-skill-demo",
        name: "结果沉淀技能",
        description: "沉淀自一次成功结果",
        whenToUse: ["当你需要继续复用这类结果时使用。"],
        inputs: ["目标与主题：一段结果摘要"],
        outputs: ["交付一份可直接复用的完整结果。"],
        steps: ["先确认目标，再沿用结构。"],
        fallbackStrategy: ["信息不足时先补问。"],
        sourceExcerpt: "一段结果摘要",
        sourceMessageId: "msg-1",
      },
      initialScaffoldRequestKey: 20260411,
    });

    const bringBackButton = container.querySelector(
      '[data-testid="skills-workspace-bring-scaffold-to-agent"]',
    );
    expect(bringBackButton).toBeTruthy();

    act(() => {
      bringBackButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onNavigate).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        projectId: "project-demo",
        agentEntry: "new-task",
        initialUserPrompt: expect.stringContaining("技能名称：结果沉淀技能"),
        entryBannerMessage:
          "已从技能草稿“结果沉淀技能”带回创作输入，可继续改写后发送。",
        initialRequestMetadata: {
          harness: {
            creation_replay: expect.objectContaining({
              kind: "skill_scaffold",
              source: expect.objectContaining({
                page: "skills",
                project_id: "project-demo",
              }),
              data: expect.objectContaining({
                name: "结果沉淀技能",
              }),
            }),
          },
        },
      }),
    );
  });
});
