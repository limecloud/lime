import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Skill } from "@/lib/api/skills";
import type { ServiceSkillHomeItem } from "@/components/agent/chat/service-skills/types";
import { SkillsWorkspacePage } from "./SkillsWorkspacePage";

const mockRefreshServiceSkills = vi.fn();
const mockRecordUsage = vi.fn();
const mockRefreshLocalSkills = vi.fn();

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
        slotSchema: [],
        version: "2026-03-29",
        badge: "云目录",
        recentUsedAt: Date.now(),
        isRecent: true,
        runnerLabel: "本地即时执行",
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
        runnerLabel: "站点登录态采集",
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
        summary: "不依赖站点登录态的业务技能。",
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

vi.mock("@/components/agent/chat/service-skills/ServiceSkillLaunchDialog", () => ({
  ServiceSkillLaunchDialog: ({
    skill,
    open,
  }: {
    skill: ServiceSkillHomeItem | null;
    open: boolean;
  }) =>
    open ? (
      <div data-testid="service-skill-launch-dialog">{skill?.title}</div>
    ) : null,
}));

vi.mock("./SkillsPage", () => ({
  SkillsPage: () => (
    <div data-testid="advanced-skills-page">advanced skills page</div>
  ),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    open,
    children,
  }: {
    open: boolean;
    children: ReactNode;
  }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

interface RenderResult {
  container: HTMLDivElement;
  root: Root;
}

const mountedRoots: RenderResult[] = [];

function renderPage() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onNavigate = vi.fn<(page: string, params?: unknown) => void>();

  act(() => {
    root.render(<SkillsWorkspacePage onNavigate={onNavigate} />);
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

  it("应默认渲染技能组而不是平铺技能卡", () => {
    const { container } = renderPage();

    expect(container.textContent).toContain("技能");
    expect(container.textContent).toContain("GitHub");
    expect(container.textContent).not.toContain("GitHub 仓库检索围绕关键词采集");
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

  it("切到我的技能后应展示本地已安装技能，并可打开导入与维护", () => {
    const { container } = renderPage();

    const installedTab = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("我的技能"),
    );
    expect(installedTab).toBeTruthy();

    act(() => {
      installedTab?.click();
    });

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
});
