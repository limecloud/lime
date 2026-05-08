import { Suspense, useEffect } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentPageParams, Page, PageParams } from "@/types/page";
import { AppPageContent } from "./AppPageContent";

const latestAgentChatProps = vi.hoisted(
  () =>
    ({
      value: null as Record<string, unknown> | null,
    }) as { value: Record<string, unknown> | null },
);
const agentChatLifecycle = vi.hoisted(
  () =>
    ({
      mounts: 0,
      unmounts: 0,
    }) as { mounts: number; unmounts: number },
);
const latestSkillsWorkspaceProps = vi.hoisted(
  () =>
    ({
      value: null as Record<string, unknown> | null,
    }) as { value: Record<string, unknown> | null },
);
const latestMemoryPageProps = vi.hoisted(
  () =>
    ({
      value: null as Record<string, unknown> | null,
    }) as { value: Record<string, unknown> | null },
);
const latestKnowledgePageProps = vi.hoisted(
  () =>
    ({
      value: null as Record<string, unknown> | null,
    }) as { value: Record<string, unknown> | null },
);
const latestSceneAppsPageProps = vi.hoisted(
  () =>
    ({
      value: null as Record<string, unknown> | null,
    }) as { value: Record<string, unknown> | null },
);
const sceneAppsLifecycle = vi.hoisted(
  () =>
    ({
      mounts: 0,
      unmounts: 0,
    }) as { mounts: number; unmounts: number },
);

vi.mock("./agent/chat", () => ({
  AgentChatPage: (props: Record<string, unknown>) => {
    latestAgentChatProps.value = props;

    useEffect(() => {
      agentChatLifecycle.mounts += 1;

      return () => {
        agentChatLifecycle.unmounts += 1;
      };
    }, []);

    return <div data-testid="agent-chat-page" />;
  },
}));

vi.mock("./channels/ImConfigPage", () => ({
  ImConfigPage: () => <div data-testid="im-config-page" />,
}));

vi.mock("./settings-v2", () => ({
  SettingsPageV2: () => <div data-testid="settings-page" />,
}));

vi.mock("./skills", () => ({
  SkillsWorkspacePage: (props: Record<string, unknown>) => {
    latestSkillsWorkspaceProps.value = props;
    return <div data-testid="skills-workspace-page" />;
  },
}));

vi.mock("./memory", () => ({
  MemoryPage: (props: Record<string, unknown>) => {
    latestMemoryPageProps.value = props;
    return <div data-testid="memory-page" />;
  },
}));

vi.mock("@/features/knowledge", () => ({
  KnowledgePage: (props: Record<string, unknown>) => {
    latestKnowledgePageProps.value = props;
    return <div data-testid="knowledge-page" />;
  },
}));

vi.mock("./sceneapps", () => ({
  SceneAppsPage: (props: Record<string, unknown>) => {
    latestSceneAppsPageProps.value = props;

    useEffect(() => {
      sceneAppsLifecycle.mounts += 1;

      return () => {
        sceneAppsLifecycle.unmounts += 1;
      };
    }, []);

    return <div data-testid="sceneapps-page" />;
  },
}));

interface MountedContent {
  container: HTMLDivElement;
  root: Root;
}

const mountedContents: MountedContent[] = [];

interface RenderContentOptions {
  currentPage: Page;
  pageParams?: PageParams;
  requestedPage?: Page;
  requestedPageParams?: PageParams;
  navigationRequestId?: number;
}

function renderContentWithNavigationState(options: RenderContentOptions) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const renderWithProps = (nextOptions: RenderContentOptions) => {
    act(() => {
      root.render(
        <Suspense fallback={<div data-testid="page-loading" />}>
          <AppPageContent
            currentPage={nextOptions.currentPage}
            pageParams={nextOptions.pageParams ?? {}}
            requestedPage={nextOptions.requestedPage}
            requestedPageParams={nextOptions.requestedPageParams}
            navigationRequestId={nextOptions.navigationRequestId}
            onNavigate={vi.fn() as (page: Page) => void}
            onAgentHasMessagesChange={vi.fn()}
          />
        </Suspense>,
      );
    });
  };

  renderWithProps(options);

  mountedContents.push({ container, root });
  return {
    container,
    rerender(nextOptions: RenderContentOptions) {
      renderWithProps(nextOptions);
    },
  };
}

function renderContent(currentPage: Page, pageParams: PageParams = {}) {
  const rendered = renderContentWithNavigationState({
    currentPage,
    pageParams,
  });

  return {
    container: rendered.container,
    rerender(nextCurrentPage: Page, nextPageParams: PageParams = {}) {
      rendered.rerender({
        currentPage: nextCurrentPage,
        pageParams: nextPageParams,
      });
    },
  };
}

async function flushEffects(times = 6) {
  await act(async () => {
    for (let index = 0; index < times; index += 1) {
      await Promise.resolve();
    }
  });
}

describe("AppPageContent", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    latestAgentChatProps.value = null;
    agentChatLifecycle.mounts = 0;
    agentChatLifecycle.unmounts = 0;
    latestSkillsWorkspaceProps.value = null;
    latestMemoryPageProps.value = null;
    latestKnowledgePageProps.value = null;
    latestSceneAppsPageProps.value = null;
    sceneAppsLifecycle.mounts = 0;
    sceneAppsLifecycle.unmounts = 0;
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
  });

  it("agent 页面应把 initialSiteSkillLaunch 透传给 AgentChatPage", async () => {
    const pageParams: AgentPageParams = {
      agentEntry: "claw",
      projectId: "project-1",
      contentId: "content-1",
      theme: "general",
      newChatAt: 1234567890,
      initialSiteSkillLaunch: {
        adapterName: "linux-do/categories",
        args: {
          limit: 10,
        },
        autoRun: true,
        profileKey: "attached-linux-do",
        targetId: "tab-linux-do",
        requireAttachedSession: true,
        saveTitle: "Linux.do 分类扫描",
        skillTitle: "Linux.do 分类扫描",
      },
    };

    renderContent("agent", pageParams);
    await flushEffects();

    expect(latestAgentChatProps.value).toMatchObject({
      projectId: "project-1",
      contentId: "content-1",
      agentEntry: "claw",
      theme: "general",
      newChatAt: 1234567890,
      initialSiteSkillLaunch: {
        adapterName: "linux-do/categories",
        args: {
          limit: 10,
        },
        autoRun: true,
        profileKey: "attached-linux-do",
        targetId: "tab-linux-do",
        requireAttachedSession: true,
        saveTitle: "Linux.do 分类扫描",
        skillTitle: "Linux.do 分类扫描",
      },
    });
  });

  it("agent 页面应把 initialProjectFileOpenTarget 透传给 AgentChatPage", async () => {
    const pageParams: AgentPageParams = {
      agentEntry: "claw",
      projectId: "project-2",
      contentId: "content-2",
      theme: "general",
      initialProjectFileOpenTarget: {
        relativePath: "exports/x-article/google-cloud/index.md",
        requestKey: 20260408,
      },
    };

    renderContent("agent", pageParams);
    await flushEffects();

    expect(latestAgentChatProps.value).toMatchObject({
      projectId: "project-2",
      contentId: "content-2",
      initialProjectFileOpenTarget: {
        relativePath: "exports/x-article/google-cloud/index.md",
        requestKey: 20260408,
      },
    });
  });

  it("agent 页面应把 initialSessionId 透传给 AgentChatPage", async () => {
    const pageParams: AgentPageParams = {
      agentEntry: "claw",
      initialSessionId: "session-sceneapp-1",
      entryBannerMessage: "已恢复 SceneApp 对应会话。",
    };

    renderContent("agent", pageParams);
    await flushEffects();

    expect(latestAgentChatProps.value).toMatchObject({
      agentEntry: "claw",
      initialSessionId: "session-sceneapp-1",
      entryBannerMessage: "已恢复 SceneApp 对应会话。",
    });
  });

  it("agent 页面应把 initialPendingServiceSkillLaunch 透传给 AgentChatPage", async () => {
    const pageParams: AgentPageParams = {
      agentEntry: "new-task",
      projectId: "project-3",
      theme: "general",
      initialPendingServiceSkillLaunch: {
        skillId: "service-skill-1",
        requestKey: 20260409,
        initialSlotValues: {
          article_source: "参考摘要",
          target_duration: "90 秒",
        },
        prefillHint: "已根据最近一次创作自动预填。",
      },
    };

    renderContent("agent", pageParams);
    await flushEffects();

    expect(latestAgentChatProps.value).toMatchObject({
      projectId: "project-3",
      agentEntry: "new-task",
      initialPendingServiceSkillLaunch: {
        skillId: "service-skill-1",
        requestKey: 20260409,
        initialSlotValues: {
          article_source: "参考摘要",
          target_duration: "90 秒",
        },
        prefillHint: "已根据最近一次创作自动预填。",
      },
    });
  });

  it("agent 页面应把 initialInputCapability 透传给 AgentChatPage", async () => {
    const pageParams: AgentPageParams = {
      agentEntry: "new-task",
      projectId: "project-3",
      theme: "general",
      initialInputCapability: {
        capabilityRoute: {
          kind: "installed_skill",
          skillKey: "local:writer",
          skillName: "写作助手",
        },
        requestKey: 20260418,
      },
    };

    renderContent("agent", pageParams);
    await flushEffects();

    expect(latestAgentChatProps.value).toMatchObject({
      projectId: "project-3",
      agentEntry: "new-task",
      initialInputCapability: {
        capabilityRoute: {
          kind: "installed_skill",
          skillKey: "local:writer",
          skillName: "写作助手",
        },
        requestKey: 20260418,
      },
    });
  });

  it("agent 页面切换 initialInputCapability 时应重建 AgentChatPage 实例", async () => {
    const rendered = renderContentWithNavigationState({
      currentPage: "agent",
      pageParams: {
        agentEntry: "new-task",
        projectId: "project-3",
        theme: "general",
        initialInputCapability: {
          capabilityRoute: {
            kind: "installed_skill",
            skillKey: "local:writer",
            skillName: "写作助手",
          },
          requestKey: 20260418,
        },
      } satisfies AgentPageParams,
    });
    await flushEffects();

    expect(agentChatLifecycle.mounts).toBe(1);
    expect(agentChatLifecycle.unmounts).toBe(0);

    rendered.rerender({
      currentPage: "agent",
      pageParams: {
        agentEntry: "new-task",
        projectId: "project-3",
        theme: "general",
        initialInputCapability: {
          capabilityRoute: {
            kind: "installed_skill",
            skillKey: "local:analyst",
            skillName: "分析助手",
          },
          requestKey: 20260419,
        },
      } satisfies AgentPageParams,
    });
    await flushEffects();

    expect(agentChatLifecycle.mounts).toBe(2);
    expect(agentChatLifecycle.unmounts).toBe(1);
  });

  it("agent 页面切换 Knowledge 协同资料时应重建 AgentChatPage 实例", async () => {
    const rendered = renderContentWithNavigationState({
      currentPage: "agent",
      pageParams: {
        agentEntry: "claw",
        projectId: "project-knowledge",
        initialKnowledgePackSelection: {
          enabled: true,
          packName: "content-calendar",
          workingDir: "/tmp/lime-project",
          label: "内容运营资料",
          status: "ready",
          companionPacks: [
            {
              name: "founder-persona",
              activation: "implicit",
            },
          ],
        },
      } satisfies AgentPageParams,
    });
    await flushEffects();

    expect(agentChatLifecycle.mounts).toBe(1);
    expect(agentChatLifecycle.unmounts).toBe(0);

    rendered.rerender({
      currentPage: "agent",
      pageParams: {
        agentEntry: "claw",
        projectId: "project-knowledge",
        initialKnowledgePackSelection: {
          enabled: true,
          packName: "content-calendar",
          workingDir: "/tmp/lime-project",
          label: "内容运营资料",
          status: "ready",
          companionPacks: [
            {
              name: "founder-persona",
              activation: "implicit",
            },
            {
              name: "campaign-plan",
              activation: "explicit",
            },
          ],
        },
      } satisfies AgentPageParams,
    });
    await flushEffects();

    expect(agentChatLifecycle.mounts).toBe(2);
    expect(agentChatLifecycle.unmounts).toBe(1);
    expect(latestAgentChatProps.value).toMatchObject({
      initialKnowledgePackSelection: {
        companionPacks: [
          {
            name: "founder-persona",
            activation: "implicit",
          },
          {
            name: "campaign-plan",
            activation: "explicit",
          },
        ],
      },
    });
  });

  it("agent 页面切换结果模板 initialInputCapability 时也应重建 AgentChatPage 实例", async () => {
    const rendered = renderContentWithNavigationState({
      currentPage: "agent",
      pageParams: {
        agentEntry: "new-task",
        projectId: "project-3",
        theme: "general",
        initialInputCapability: {
          capabilityRoute: {
            kind: "curated_task",
            taskId: "daily-trend-briefing",
            taskTitle: "每日趋势摘要",
            prompt:
              "请先给我做一版每日趋势摘要：围绕当前主题梳理最近值得关注的趋势、热点内容方向、代表案例、用户正在关心的问题，以及最值得立即开工的 3 个选题。",
          },
          requestKey: 20260418,
        },
      } satisfies AgentPageParams,
    });
    await flushEffects();

    expect(agentChatLifecycle.mounts).toBe(1);
    expect(agentChatLifecycle.unmounts).toBe(0);

    rendered.rerender({
      currentPage: "agent",
      pageParams: {
        agentEntry: "new-task",
        projectId: "project-3",
        theme: "general",
        initialInputCapability: {
          capabilityRoute: {
            kind: "curated_task",
            taskId: "social-post-starter",
            taskTitle: "内容主稿生成",
            prompt:
              "请先帮我起草一版内容首稿：明确目标受众、标题方向、正文结构、核心观点和可继续扩写的角度，并给我一版适合继续打磨的正文。",
          },
          requestKey: 20260419,
        },
      } satisfies AgentPageParams,
    });
    await flushEffects();

    expect(agentChatLifecycle.mounts).toBe(2);
    expect(agentChatLifecycle.unmounts).toBe(1);
  });

  it("agent 页面应把做法执行摘要与自动发送 metadata 透传给 AgentChatPage", async () => {
    const pageParams: AgentPageParams = {
      agentEntry: "claw",
      projectId: "project-sceneapp",
      theme: "general",
      initialSceneAppExecutionSummary: {
        sceneappId: "story-video-suite",
        title: "短视频编排",
        summary: "把线框图、脚本与配乐压成同一条结果链。",
        businessLabel: "内容闭环",
        typeLabel: "多模态组合",
        executionChainLabel: "做法 -> 生成 -> Project Pack",
        deliveryContractLabel: "Project Pack",
        planningStatusLabel: "已就绪",
        planningSummary: "当前可直接进入生成。",
        activeLayers: [{ key: "skill", label: "Skill" }],
        referenceCount: 1,
        referenceItems: [
          {
            key: "ref-1",
            label: "品牌 KV",
            sourceLabel: "灵感库",
            contentTypeLabel: "图片",
            selected: true,
          },
        ],
        tasteSummary: "偏好克制的科技蓝。",
        feedbackSummary: "最近反馈要求减少文案堆叠。",
        projectPackPlan: {
          packKindLabel: "短视频项目包",
          completionStrategyLabel: "按必含部件判断整包完成度",
          viewerLabel: "结果包查看器",
          primaryPart: "任务简报",
          requiredParts: [{ key: "brief", label: "任务简报" }],
          notes: ["完整度将按 1 个必含部件判断。"],
        },
        scorecardProfileRef: "story-video-scorecard",
        scorecardMetricKeys: [
          { key: "delivery_readiness", label: "交付就绪度" },
        ],
        scorecardFailureSignals: [
          { key: "publish_stalled", label: "发布卡点" },
        ],
        notes: ["已装配 1 条参考素材。"],
      },
      initialAutoSendRequestMetadata: {
        harness: {
          service_scene_launch: {
            kind: "local_service_skill",
            service_scene_run: {
              scene_key: "story-video-suite",
            },
          },
        },
      },
    };

    renderContent("agent", pageParams);
    await flushEffects();

    expect(latestAgentChatProps.value).toMatchObject({
      projectId: "project-sceneapp",
      initialSceneAppExecutionSummary: expect.objectContaining({
        sceneappId: "story-video-suite",
        title: "短视频编排",
      }),
      initialAutoSendRequestMetadata: {
        harness: {
          service_scene_launch: {
            kind: "local_service_skill",
            service_scene_run: {
              scene_key: "story-video-suite",
            },
          },
        },
      },
    });
  });

  it("channels 页面应渲染 IM 配置页", async () => {
    const { container } = renderContent("channels");
    await flushEffects();

    expect(
      container.querySelector('[data-testid="im-config-page"]'),
    ).not.toBeNull();
  });

  it("settings 页面应渲染设置页入口", async () => {
    const { container } = renderContent("settings");
    await flushEffects();

    expect(
      container.querySelector('[data-testid="settings-page"]'),
    ).not.toBeNull();
  });

  it("skills 页面应把技能草稿参数透传给 SkillsWorkspacePage", async () => {
    renderContent("skills", {
      initialScaffoldDraft: {
        target: "project",
        directory: "saved-skill-demo",
        name: "结果沉淀技能",
        description: "沉淀自一次成功结果",
      },
      initialScaffoldRequestKey: 20260408,
    });
    await flushEffects();

    expect(latestSkillsWorkspaceProps.value).toMatchObject({
      pageParams: {
        initialScaffoldDraft: {
          target: "project",
          directory: "saved-skill-demo",
          name: "结果沉淀技能",
          description: "沉淀自一次成功结果",
        },
        initialScaffoldRequestKey: 20260408,
      },
    });
  });

  it("memory 页面应把记忆页挂进可滚动容器", async () => {
    const { container } = renderContent("memory", {
      section: "home",
    });
    await flushEffects();

    const memoryPage = container.querySelector('[data-testid="memory-page"]');

    expect(memoryPage).not.toBeNull();
    expect(latestMemoryPageProps.value).toMatchObject({
      pageParams: {
        section: "home",
      },
    });
    expect(memoryPage?.parentElement?.className).toContain("overflow-auto");
    expect(memoryPage?.parentElement?.className).toContain("min-h-0");
    expect(memoryPage?.parentElement?.className).toContain("flex-1");
  });

  it("knowledge 页面应把工作区参数透传给 KnowledgePage", async () => {
    const { container } = renderContent("knowledge", {
      workingDir: "/tmp/project-knowledge",
      selectedPackName: "brand-product-demo",
    });
    await flushEffects();

    expect(
      container.querySelector('[data-testid="knowledge-page"]'),
    ).not.toBeNull();
    expect(latestKnowledgePageProps.value).toMatchObject({
      pageParams: {
        workingDir: "/tmp/project-knowledge",
        selectedPackName: "brand-product-demo",
      },
    });
  });

  it("sceneapps 页面应把目录页参数透传给 SceneAppsPage", async () => {
    const { container } = renderContent("sceneapps", {
      sceneappId: "story-video-suite",
      runId: "story-video-suite-run-1",
      projectId: "project-sceneapp",
      prefillIntent: "生成一个短视频方案",
      search: "短视频",
    });
    await flushEffects();

    expect(
      container.querySelector('[data-testid="sceneapps-page"]'),
    ).not.toBeNull();
    expect(latestSceneAppsPageProps.value).toMatchObject({
      isActive: true,
      pageParams: {
        sceneappId: "story-video-suite",
        runId: "story-video-suite-run-1",
        projectId: "project-sceneapp",
        prefillIntent: "生成一个短视频方案",
        search: "短视频",
      },
    });
  });

  it("sceneapps 页面在持续流程往返后不应重新挂载", async () => {
    const { rerender } = renderContent("sceneapps", {
      sceneappId: "story-video-suite",
      runId: "story-video-suite-run-1",
      projectId: "project-sceneapp",
      search: "短视频",
    });
    await flushEffects();

    const mountsAfterInitialRender = sceneAppsLifecycle.mounts;

    expect(mountsAfterInitialRender).toBeGreaterThan(0);
    expect(sceneAppsLifecycle.unmounts).toBe(0);
    expect(latestSceneAppsPageProps.value).toMatchObject({
      pageParams: {
        sceneappId: "story-video-suite",
        runId: "story-video-suite-run-1",
        projectId: "project-sceneapp",
        search: "短视频",
      },
    });

    rerender("automation", {
      selectedJobId: "automation-job-1",
      workspaceTab: "tasks",
    });
    await flushEffects();

    expect(sceneAppsLifecycle.mounts).toBe(mountsAfterInitialRender);
    expect(sceneAppsLifecycle.unmounts).toBe(0);
    expect(latestSceneAppsPageProps.value).toMatchObject({
      pageParams: {
        sceneappId: "story-video-suite",
        runId: "story-video-suite-run-1",
        projectId: "project-sceneapp",
        search: "短视频",
      },
    });

    rerender("sceneapps", {
      sceneappId: "story-video-suite",
      runId: "story-video-suite-run-2",
      projectId: "project-sceneapp",
      search: "复盘",
    });
    await flushEffects();

    expect(sceneAppsLifecycle.mounts).toBe(mountsAfterInitialRender);
    expect(sceneAppsLifecycle.unmounts).toBe(0);
    expect(latestSceneAppsPageProps.value).toMatchObject({
      isActive: true,
      pageParams: {
        sceneappId: "story-video-suite",
        runId: "story-video-suite-run-2",
        projectId: "project-sceneapp",
        search: "复盘",
      },
    });
  });

  it("requested 页面已切回 sceneapps 时应优先渲染最新请求目标", async () => {
    const { container } = renderContentWithNavigationState({
      currentPage: "automation",
      pageParams: {
        selectedJobId: "automation-job-1",
        workspaceTab: "tasks",
      },
      requestedPage: "sceneapps",
      requestedPageParams: {
        sceneappId: "story-video-suite",
        runId: "story-video-suite-run-2",
        projectId: "project-sceneapp",
        search: "复盘",
      },
      navigationRequestId: 9,
    });
    await flushEffects();

    expect(
      container.querySelector('[data-testid="sceneapps-page"]'),
    ).not.toBeNull();
    expect(latestSceneAppsPageProps.value).toMatchObject({
      isActive: true,
      isNavigationTargetOwner: true,
      navigationRequestId: 9,
      pageParams: {
        sceneappId: "story-video-suite",
        runId: "story-video-suite-run-2",
        projectId: "project-sceneapp",
        search: "复盘",
      },
    });
  });
});
