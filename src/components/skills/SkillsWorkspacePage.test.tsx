import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Skill } from "@/lib/api/skills";
import type { ServiceSkillHomeItem } from "@/components/agent/chat/service-skills/types";
import type { SkillsPageParams } from "@/types/page";
import { SkillsWorkspacePage } from "./SkillsWorkspacePage";

const mockRefreshServiceSkills = vi.fn();
const mockRecordUsage = vi.fn();
const mockRefreshLocalSkills = vi.fn();
const mockAdvancedSkillsPage = vi.fn();
const mockServiceSkillLaunchDialog = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(() => "toast-id"),
  },
}));

vi.mock("@/components/agent/chat/service-skills/useServiceSkills", () => ({
  useServiceSkills: () => ({
    skills: [
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
        recentUsedAt: Date.now(),
        isRecent: true,
        runnerLabel: "立即开始",
        runnerTone: "emerald",
        runnerDescription: "会直接在当前工作区生成首版结果。",
        actionLabel: "填写参数",
        automationStatus: null,
        cloudStatus: null,
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
        slotSchema: [],
        version: "2026-03-29",
        badge: "云目录",
        recentUsedAt: null,
        isRecent: false,
        runnerLabel: "浏览器采集",
        runnerTone: "emerald",
        runnerDescription: "会复用当前浏览器里的真实登录态执行站点任务。",
        actionLabel: "开始执行",
        automationStatus: null,
        cloudStatus: null,
        groupKey: "github",
        siteCapabilityBinding: {
          adapterName: "github/search",
          autoRun: true,
        },
      },
    ] as ServiceSkillHomeItem[],
    groups: [
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
        itemCount: 1,
      },
    ],
    catalogMeta: {
      tenantId: "tenant-demo",
      version: "catalog-v2",
      syncedAt: "2026-03-29T08:00:00Z",
      itemCount: 2,
      groupCount: 2,
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
    skills: [
      {
        key: "local:writer",
        name: "写作助手",
        description: "本地补充技能",
        directory: "writer",
        installed: true,
        sourceKind: "other",
        catalogSource: "user",
      },
    ] as Skill[],
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

vi.mock(
  "@/components/agent/chat/service-skills/ServiceSkillLaunchDialog",
  () => ({
    ServiceSkillLaunchDialog: (
      props: {
        skill: ServiceSkillHomeItem | null;
        open: boolean;
        initialSlotValues?: Record<string, string>;
        prefillHint?: string;
      },
    ) => {
      mockServiceSkillLaunchDialog(props);
      return props.open ? (
        <div data-testid="service-skill-launch-dialog">{props.skill?.title}</div>
      ) : null;
    },
  }),
);

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

    mockRefreshServiceSkills.mockReset();
    mockRefreshServiceSkills.mockResolvedValue(undefined);
    mockRecordUsage.mockReset();
    mockRefreshLocalSkills.mockReset();
    mockRefreshLocalSkills.mockResolvedValue(undefined);
    mockAdvancedSkillsPage.mockReset();
    mockServiceSkillLaunchDialog.mockReset();
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

  it("应默认渲染推荐技能组并同时展示最近使用和我的技能入口", () => {
    const { container } = renderPage();

    expect(container.textContent).toContain("技能");
    expect(container.textContent).toContain("推荐技能组");
    expect(container.textContent).toContain("最近使用");
    expect(container.textContent).toContain("我的技能");
    expect(container.textContent).toContain(
      "先从一个现成技能开始，不必先理解目录结构。",
    );
    expect(container.textContent).toContain("GitHub");
    expect(container.textContent).toContain("写作助手");
    expect(container.textContent).not.toContain(
      "GitHub 仓库检索围绕关键词采集",
    );
  });

  it("应把主入口说明和搜索说明收进 tips", async () => {
    renderPage();

    expect(getBodyText()).not.toContain(
      "技能中心现在先展示技能组，再进入具体技能项。",
    );
    expect(getBodyText()).not.toContain(
      "先从能直接开工的技能组找起；本地导入、仓库维护和远程安装统一收进导入与维护。",
    );

    const entryTip = await hoverTip("技能主入口说明");
    expect(getBodyText()).toContain(
      "技能中心现在先展示技能组，再进入具体技能项。",
    );
    await leaveTip(entryTip);

    const searchTip = await hoverTip("技能搜索说明");
    expect(getBodyText()).toContain(
      "先从能直接开工的技能组找起；本地导入、仓库维护和远程安装统一收进导入与维护。",
    );
    await leaveTip(searchTip);
  });

  it("点击技能组后应进入组内技能列表并可打开启动对话框", () => {
    const { container } = renderPage();

    const groupButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("打开技能组"),
    );
    expect(groupButton).toBeTruthy();

    act(() => {
      groupButton?.click();
    });

    expect(container.textContent).toContain("GitHub 仓库检索");

    const launchButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("开始执行"),
    );
    expect(launchButton).toBeTruthy();

    act(() => {
      launchButton?.click();
    });

    const dialog = container.querySelector(
      '[data-testid="service-skill-launch-dialog"]',
    );
    expect(dialog?.textContent).toContain("GitHub 仓库检索");
  });

  it("技能页带着技能草稿时，启动弹窗应复用草稿里的预填参数", () => {
    const { container } = renderPage({
      initialScaffoldDraft: {
        name: "AI Agent 行业拆解",
        description: "参考原文做一版 90 秒总结，结论更聚焦团队协作。",
        sourceExcerpt: "参考 https://example.com/report 并保留关键结论。",
      },
      initialScaffoldRequestKey: 20260412,
    });

    const launchButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("填写参数"),
    );
    expect(launchButton).toBeTruthy();

    act(() => {
      launchButton?.click();
    });

    const latestProps = mockServiceSkillLaunchDialog.mock.lastCall?.[0] as
      | {
          initialSlotValues?: Record<string, string>;
          prefillHint?: string;
        }
      | undefined;

    expect(latestProps?.initialSlotValues).toEqual({
      article_source:
        "参考线索：参考 https://example.com/report 并保留关键结论。\n改写目标：参考原文做一版 90 秒总结，结论更聚焦团队协作。\n来源标题：AI Agent 行业拆解",
      target_duration: "90 秒",
    });
    expect(latestProps?.prefillHint).toBe(
      "已根据当前技能草稿自动预填 文章链接/正文、目标时长，可继续修改后执行。",
    );
  });

  it("点击刷新目录应同时刷新技能目录与本地技能", async () => {
    const { container } = renderPage();

    const refreshButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("刷新目录"),
    );
    expect(refreshButton).toBeTruthy();

    await act(async () => {
      refreshButton?.click();
      await Promise.resolve();
    });

    expect(mockRefreshServiceSkills).toHaveBeenCalledTimes(1);
    expect(mockRefreshLocalSkills).toHaveBeenCalledTimes(1);
  });

  it("应默认展示本地已安装技能，并可打开导入与维护", () => {
    const { container } = renderPage();

    expect(container.textContent).toContain("写作助手");

    const manageButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("导入与维护"),
    );
    expect(manageButton).toBeTruthy();

    act(() => {
      manageButton?.click();
    });

    expect(container.textContent).toContain("advanced skills page");
  });

  it("带着技能草稿进入时应自动打开导入与维护，并透传预填参数", () => {
    renderPage({
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
      }),
    );
  });

  it("技能草稿应支持从导入与维护弹窗带回创作输入", () => {
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
});
