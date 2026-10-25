import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExpertPlazaPage } from "./ExpertPlazaPage";
import { changeLimeLocale } from "@/i18n/createI18n";
import {
  expertAnalyticsStorageKeys,
  getSeededExpertCatalog,
  saveCachedExpertCatalog,
  upsertExpertAgentInstance,
} from "@/features/experts";

interface MountedContent {
  container: HTMLDivElement;
  root: Root;
}

const mountedContents: MountedContent[] = [];
const EXPERT_CATALOG_CACHE_STORAGE_KEY = "lime:expert-catalog-cache:v1";

function renderPage(onNavigate = vi.fn(), currentProjectId?: string | null) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <ExpertPlazaPage
        onNavigate={onNavigate}
        currentProjectId={currentProjectId}
      />,
    );
  });

  mountedContents.push({ container, root });
  return { container, onNavigate };
}

async function flushEffects(times = 4) {
  await act(async () => {
    for (let index = 0; index < times; index += 1) {
      await Promise.resolve();
    }
  });
}

function readQueuedExpertEvents() {
  return JSON.parse(
    window.localStorage.getItem(expertAnalyticsStorageKeys.queue) || "[]",
  ) as Array<{ expertId: string; eventName: string; metadata?: unknown }>;
}

function cacheCloudExpertCatalog() {
  const catalog = getSeededExpertCatalog();
  saveCachedExpertCatalog({
    ...catalog,
    tenantId: "tenant-0001",
    version: "tenant-0001:test",
    items: catalog.items.map((item, index) => ({
      ...item,
      source: "cloud_catalog" as const,
      release: {
        ...item.release,
        releaseId: `expert-release-${String(index + 1).padStart(4, "0")}`,
      },
    })),
  });
  window.__LIME_OEM_CLOUD__ = {
    enabled: true,
    baseUrl: "https://lime.example.com",
    tenantId: "tenant-0001",
  };
}

function cacheEmptyExpertCatalog() {
  const catalog = getSeededExpertCatalog();
  window.localStorage.setItem(
    EXPERT_CATALOG_CACHE_STORAGE_KEY,
    JSON.stringify({
      ...catalog,
      tenantId: "tenant-empty",
      version: "tenant-empty:test",
      items: [],
    }),
  );
}

describe("ExpertPlazaPage", () => {
  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    await changeLimeLocale("zh-CN");
    window.localStorage.clear();
  });

  afterEach(() => {
    while (mountedContents.length > 0) {
      const mounted = mountedContents.pop();
      if (!mounted) {
        continue;
      }
      act(() => {
        mounted.root.unmount();
      });
      mounted.container.remove();
    }
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    delete window.__LIME_OEM_CLOUD__;
  });

  it("应渲染 seeded 专家广场卡片与榜单", async () => {
    const { container } = renderPage();
    await flushEffects();

    expect(
      container.querySelector('[data-testid="expert-plaza-page"]'),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[data-testid="expert-card-marketing-strategist"]',
      ),
    ).not.toBeNull();
    expect(container.textContent).toContain("营销策略专家");
    expect(container.textContent).toContain("热门精选");
  });

  it("空缓存目录不应覆盖 seeded 专家广场", async () => {
    cacheEmptyExpertCatalog();

    const { container } = renderPage();
    await flushEffects();

    expect(
      container.querySelector(
        '[data-testid="expert-card-marketing-strategist"]',
      ),
    ).not.toBeNull();
    expect(container.textContent).toContain("营销策略专家");
    expect(container.textContent).not.toContain("没有找到匹配的专家");
  });

  it("点击开始对话应进入 Agent 并携带专家 request metadata", async () => {
    const onNavigate = vi.fn();
    const { container } = renderPage(onNavigate, "project-current");
    await flushEffects();

    const startButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="expert-start-marketing-strategist"]',
    );
    expect(startButton).not.toBeNull();

    act(() => {
      startButton?.click();
    });

    expect(onNavigate).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        agentEntry: "conversation",
        projectId: "project-current",
        initialSessionName: "营销策略专家",
        initialUserPrompt:
          expect.stringContaining("请以「营销策略专家」专家身份工作"),
        autoRunInitialPromptOnMount: true,
        newChatAt: expect.any(Number),
        expertAgentLaunch: expect.objectContaining({
          tenantId: "local-seeded",
          projectId: "project-current",
          expertId: "marketing-strategist",
          releaseId: "rel-marketing-strategist-20260515",
          launchMode: "new_thread",
          agentInstanceKey:
            "local-seeded:project-current:marketing-strategist:rel-marketing-strategist-20260515",
        }),
        initialRequestMetadata: {
          expert: expect.objectContaining({
            expertId: "marketing-strategist",
            personaRef: "expert-persona:marketing-strategist@1.0.0",
          }),
          harness: {
            expert: expect.objectContaining({
              expert_id: "marketing-strategist",
              persona_ref: "expert-persona:marketing-strategist@1.0.0",
            }),
          },
        },
        initialAutoSendRequestMetadata: {
          expert: expect.objectContaining({
            expertId: "marketing-strategist",
          }),
          harness: {
            expert: expect.objectContaining({
              expert_id: "marketing-strategist",
            }),
          },
        },
      }),
    );
    const [, params] = onNavigate.mock.calls[0] || [];
    expect(params).not.toHaveProperty("entryBannerMessage");
  });

  it("真实资料整理专家卡片应使用普通 Skill 启动当前项目新对话", async () => {
    const { container, onNavigate } = renderPage(vi.fn(), "project-current");
    await flushEffects();
    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="expert-start-knowledge-organizer"]',
    );
    expect(button).not.toBeNull();
    act(() => button!.click());

    expect(onNavigate).toHaveBeenCalledTimes(1);
    const [page, params] = onNavigate.mock.calls[0];
    expect(page).toBe("agent");
    expect(params).toMatchObject({
      agentEntry: "conversation",
      projectId: "project-current",
      autoRunInitialPromptOnMount: true,
      expertAgentLaunch: {
        expertId: "knowledge-organizer",
        launchMode: "new_thread",
      },
      initialRequestMetadata: {
        expert: { skillRefs: ["service-skill:personal-ip-knowledge-builder"] },
        harness: {
          expert: {
            skill_refs: ["service-skill:personal-ip-knowledge-builder"],
          },
        },
      },
    });
    expect(params.initialAutoSendRequestMetadata).toEqual(
      params.initialRequestMetadata,
    );
    expect(params.initialUserPrompt).toContain(
      "service-skill:personal-ip-knowledge-builder",
    );
    expect(params).not.toHaveProperty("initialKnowledgePackSelection");
    expect(JSON.stringify(params)).not.toMatch(
      /knowledgePack\/|knowledgeContext\/|knowledgeContextRun\//,
    );
  });

  it("再次点击已有专家配置时也应新建当前项目 Thread", async () => {
    upsertExpertAgentInstance({
      tenantId: "local-seeded",
      projectId: "project-current",
      expertId: "marketing-strategist",
      releaseId: "rel-marketing-strategist-20260515",
      skillRefsOverride: ["service-skill:daily-trend-briefing", "skill:docx"],
      now: 1,
    });
    const onNavigate = vi.fn();
    const { container } = renderPage(onNavigate, "project-current");
    await flushEffects();

    const startButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="expert-start-marketing-strategist"]',
    );
    expect(startButton?.textContent).toContain("开始对话");

    act(() => {
      startButton?.click();
    });

    expect(onNavigate).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        projectId: "project-current",
        initialUserPrompt:
          expect.stringContaining("请以「营销策略专家」专家身份工作"),
        autoRunInitialPromptOnMount: true,
        newChatAt: expect.any(Number),
        expertAgentLaunch: expect.objectContaining({
          projectId: "project-current",
          launchMode: "new_thread",
          skillRefsOverride: [
            "service-skill:daily-trend-briefing",
            "skill:docx",
          ],
        }),
        initialRequestMetadata: expect.objectContaining({
          expert: expect.objectContaining({
            skillRefs: ["service-skill:daily-trend-briefing", "skill:docx"],
          }),
        }),
      }),
    );
    const [, params] = onNavigate.mock.calls[0] || [];
    expect(params).not.toHaveProperty("initialSessionId");
    expect(
      (params as { expertAgentLaunch?: unknown }).expertAgentLaunch,
    ).not.toHaveProperty("latestSessionId");
    expect(params).not.toHaveProperty("entryBannerMessage");
  });

  it("没有项目作用域时启动专家不应写入 default 项目", async () => {
    const onNavigate = vi.fn();
    const { container } = renderPage(onNavigate);
    await flushEffects();

    const startButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="expert-start-marketing-strategist"]',
    );

    act(() => {
      startButton?.click();
    });

    const [, params] = onNavigate.mock.calls[0] || [];
    expect(params).not.toHaveProperty("projectId");
    expect(
      (params as { expertAgentLaunch?: unknown }).expertAgentLaunch,
    ).not.toHaveProperty("projectId");
  });

  it("点击添加应把专家写入本地 overlay", async () => {
    cacheCloudExpertCatalog();
    const { container } = renderPage();
    await flushEffects();

    const addButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="expert-add-data-analyst"]',
    );
    expect(addButton).not.toBeNull();

    act(() => {
      addButton?.click();
    });

    const raw = window.localStorage.getItem("lime:expert-install-overlay:v1");
    expect(raw).toContain("data-analyst");
    expect(readQueuedExpertEvents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          expertId: "data-analyst",
          eventName: "expert_installed",
        }),
      ]),
    );
  });

  it("打开详情应记录非内容型运营事件", async () => {
    cacheCloudExpertCatalog();
    const { container } = renderPage();
    await flushEffects();

    const expertCardHead = container.querySelector<HTMLButtonElement>(
      '[data-testid="expert-card-marketing-strategist"] button',
    );
    expect(expertCardHead).not.toBeNull();

    act(() => {
      expertCardHead?.click();
    });

    expect(readQueuedExpertEvents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          expertId: "marketing-strategist",
          eventName: "expert_detail_opened",
        }),
      ]),
    );
  });

  it("详情操作区应只保留当前项目新 Thread 入口", async () => {
    const onNavigate = vi.fn();
    const { container } = renderPage(onNavigate);
    await flushEffects();

    const expertCardHead = container.querySelector<HTMLButtonElement>(
      '[data-testid="expert-card-code-literature"] button',
    );
    expect(expertCardHead).not.toBeNull();

    act(() => {
      expertCardHead?.click();
    });

    const detailActions = container.querySelector(
      '[data-testid="expert-detail-actions-code-literature"]',
    );
    expect(detailActions?.textContent).toContain("开始对话");
    expect(detailActions?.textContent).not.toContain("新对话");

    const startButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="expert-detail-start-code-literature"]',
    );
    expect(startButton).not.toBeNull();

    act(() => {
      startButton?.click();
    });

    expect(onNavigate).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        initialSessionName: "代码文学家",
        autoRunInitialPromptOnMount: true,
        newChatAt: expect.any(Number),
        expertAgentLaunch: expect.objectContaining({
          expertId: "code-literature",
          releaseId: "rel-code-literature-20260515",
          launchMode: "new_thread",
        }),
      }),
    );
  });
});
