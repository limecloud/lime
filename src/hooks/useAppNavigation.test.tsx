import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildClawAgentParams } from "@/lib/workspace/navigation";
import { useAppNavigation } from "./useAppNavigation";

interface ProbeProps {
  onReady: (value: ReturnType<typeof useAppNavigation>) => void;
}

function HookProbe({ onReady }: ProbeProps) {
  const navigation = useAppNavigation();

  useEffect(() => {
    onReady(navigation);
  }, [navigation, onReady]);

  return null;
}

describe("useAppNavigation", () => {
  let container: HTMLDivElement;
  let root: Root;
  let latestNavigation: ReturnType<typeof useAppNavigation> | null;
  let readyCallCount: number;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;

    window.localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    latestNavigation = null;
    readyCallCount = 0;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    window.localStorage.clear();
  });

  async function flushEffects() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function renderProbe() {
    await act(async () => {
      root.render(
        <HookProbe
          onReady={(value) => {
            latestNavigation = value;
            readyCallCount += 1;
          }}
        />,
      );
    });
    await flushEffects();
  }

  it("初始化时应落在新建任务主链", async () => {
    await renderProbe();

    expect(latestNavigation?.currentPage).toBe("agent");
    expect(latestNavigation?.requestedPage).toBe("agent");
    expect(latestNavigation?.navigationRequestId).toBe(0);
    expect(latestNavigation?.isNavigating).toBe(false);
    expect(latestNavigation?.pageParams).toMatchObject({
      agentEntry: "new-task",
      immersiveHome: false,
      theme: "general",
      lockTheme: false,
    });
  });

  it("agent 跳转应直接保留现役参数", async () => {
    await renderProbe();

    await act(async () => {
      latestNavigation?.handleNavigate(
        "agent",
        buildClawAgentParams({
          projectId: "project-2",
          initialUserPrompt: "继续整理当前项目",
        }),
      );
    });

    expect(latestNavigation?.currentPage).toBe("agent");
    expect(latestNavigation?.pageParams).toEqual({
      projectId: "project-2",
      initialUserPrompt: "继续整理当前项目",
      agentEntry: "claw",
      immersiveHome: false,
      theme: "general",
      lockTheme: false,
    });
  });

  it("skills 跳转应直接进入技能主页面", async () => {
    await renderProbe();

    await act(async () => {
      latestNavigation?.handleNavigate("skills");
    });

    expect(latestNavigation?.currentPage).toBe("skills");
    expect(latestNavigation?.requestedPage).toBe("skills");
    expect(latestNavigation?.navigationRequestId).toBe(1);
    expect(latestNavigation?.pageParams).toEqual({});
  });

  it("sceneapps 跳转应保留目录页参数", async () => {
    await renderProbe();

    await act(async () => {
      latestNavigation?.handleNavigate("sceneapps", {
        sceneappId: "story-video-suite",
        projectId: "project-sceneapps",
      });
    });

    expect(latestNavigation?.currentPage).toBe("sceneapps");
    expect(latestNavigation?.pageParams).toEqual({
      sceneappId: "story-video-suite",
      projectId: "project-sceneapps",
    });
  });

  it("同页同参数重复跳转时不应再次更新导航状态", async () => {
    await renderProbe();

    await act(async () => {
      latestNavigation?.handleNavigate("sceneapps", {
        sceneappId: "story-video-suite",
        projectId: "project-sceneapps",
      });
    });
    await flushEffects();

    const readyCallsAfterFirstNavigation = readyCallCount;

    await act(async () => {
      latestNavigation?.handleNavigate("sceneapps", {
        sceneappId: "story-video-suite",
        projectId: "project-sceneapps",
      });
    });
    await flushEffects();

    expect(readyCallCount).toBe(readyCallsAfterFirstNavigation);
    expect(latestNavigation?.currentPage).toBe("sceneapps");
    expect(latestNavigation?.pageParams).toEqual({
      sceneappId: "story-video-suite",
      projectId: "project-sceneapps",
    });
  });

  it("同一轮连续导航时应以最后一次请求为准", async () => {
    await renderProbe();

    await act(async () => {
      latestNavigation?.handleNavigate("automation");
      latestNavigation?.handleNavigate("sceneapps", {
        sceneappId: "story-video-suite",
        projectId: "project-sceneapps",
        runId: "scene-run-2",
      });
    });
    await flushEffects();

    expect(latestNavigation?.currentPage).toBe("sceneapps");
    expect(latestNavigation?.requestedPage).toBe("sceneapps");
    expect(latestNavigation?.pageParams).toEqual({
      sceneappId: "story-video-suite",
      projectId: "project-sceneapps",
      runId: "scene-run-2",
    });
    expect(latestNavigation?.requestedPageParams).toEqual({
      sceneappId: "story-video-suite",
      projectId: "project-sceneapps",
      runId: "scene-run-2",
    });
    expect(latestNavigation?.navigationRequestId).toBe(2);
    expect(latestNavigation?.isNavigating).toBe(false);
  });
});
