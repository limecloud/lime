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

vi.mock("./agent/chat", () => ({
  AgentChatPage: (props: Record<string, unknown>) => {
    latestAgentChatProps.value = props;
    return <div data-testid="agent-chat-page" />;
  },
}));

vi.mock("./channels/ImConfigPage", () => ({
  ImConfigPage: () => <div data-testid="im-config-page" />,
}));

vi.mock("./workspace/video/VideoPage", () => ({
  VideoPage: () => <div data-testid="video-page" />,
}));

vi.mock("./settings-v2", () => ({
  SettingsPageV2: () => <div data-testid="settings-page" />,
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

  it("channels 页面应渲染 IM 配置页", async () => {
    const container = renderContent("channels");
    await flushEffects();

    expect(container.querySelector('[data-testid="im-config-page"]')).not.toBeNull();
  });

  it("video 页面应渲染现役视频工作台入口", async () => {
    const container = renderContent("video");
    await flushEffects();

    expect(container.querySelector('[data-testid="video-page"]')).not.toBeNull();
  });

  it("settings 页面应渲染设置页入口", async () => {
    const container = renderContent("settings");
    await flushEffects();

    expect(container.querySelector('[data-testid="settings-page"]')).not.toBeNull();
  });
});
