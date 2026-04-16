import { Suspense } from "react";
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
const latestSceneAppsPageProps = vi.hoisted(
  () =>
    ({
      value: null as Record<string, unknown> | null,
    }) as { value: Record<string, unknown> | null },
);

vi.mock("./agent/chat", () => ({
  AgentChatPage: (props: Record<string, unknown>) => {
    latestAgentChatProps.value = props;
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

vi.mock("./sceneapps", () => ({
  SceneAppsPage: (props: Record<string, unknown>) => {
    latestSceneAppsPageProps.value = props;
    return <div data-testid="sceneapps-page" />;
  },
}));

interface MountedContent {
  container: HTMLDivElement;
  root: Root;
}

const mountedContents: MountedContent[] = [];

function renderContent(currentPage: Page, pageParams: PageParams = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <Suspense fallback={<div data-testid="page-loading" />}>
        <AppPageContent
          currentPage={currentPage}
          pageParams={pageParams}
          onNavigate={vi.fn() as (page: Page) => void}
          onAgentHasMessagesChange={vi.fn()}
        />
      </Suspense>,
    );
  });

  mountedContents.push({ container, root });
  return container;
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
    latestSkillsWorkspaceProps.value = null;
    latestMemoryPageProps.value = null;
    latestSceneAppsPageProps.value = null;
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

  it("channels 页面应渲染 IM 配置页", async () => {
    const container = renderContent("channels");
    await flushEffects();

    expect(
      container.querySelector('[data-testid="im-config-page"]'),
    ).not.toBeNull();
  });

  it("settings 页面应渲染设置页入口", async () => {
    const container = renderContent("settings");
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
    const container = renderContent("memory", {
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

  it("sceneapps 页面应把目录页参数透传给 SceneAppsPage", async () => {
    const container = renderContent("sceneapps", {
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
      pageParams: {
        sceneappId: "story-video-suite",
        runId: "story-video-suite-run-1",
        projectId: "project-sceneapp",
        prefillIntent: "生成一个短视频方案",
        search: "短视频",
      },
    });
  });
});
