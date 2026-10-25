import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildConversationParams,
  buildHomeAgentParams,
} from "@/lib/workspace/navigation";
import { useAppNavigation } from "./useAppNavigation";
import { SettingsTabs } from "@/types/settings";

const NAVIGATION_RESTORE_STORAGE_KEY = "lime.appNavigation.restore.v1";

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
    window.sessionStorage.clear();
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
    window.sessionStorage.clear();
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

  async function remountProbe() {
    await act(async () => {
      root.unmount();
    });
    latestNavigation = null;
    readyCallCount = 0;
    root = createRoot(container);
    await renderProbe();
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

  it("未保存导航只提交最后目标，清理旧报告不影响另一个草稿", async () => {
    await renderProbe();
    let unregisterOld = () => {};
    let unregisterCurrent = () => {};
    await act(async () => {
      latestNavigation!.handleNavigate("settings", {
        tab: SettingsTabs.Memory,
      });
      unregisterOld = latestNavigation!.navigationGuard.register({
        dirty: true,
        saving: false,
      });
      unregisterCurrent = latestNavigation!.navigationGuard.register({
        dirty: true,
        saving: false,
      });
    });
    const requestId = latestNavigation!.navigationRequestId;
    await act(async () => {
      unregisterOld();
      latestNavigation!.handleNavigate("settings", {
        tab: SettingsTabs.Memory,
      });
    });
    expect(latestNavigation!.navigationGuard.pendingNavigation).toBe(false);
    await act(async () => {
      latestNavigation!.returnFromSettings();
      latestNavigation!.handleNavigate("resources");
    });
    expect(latestNavigation!.navigationRequestId).toBe(requestId);
    expect(latestNavigation!.navigationGuard.pendingNavigation).toBe(true);
    await act(async () =>
      latestNavigation!.navigationGuard.discardPendingNavigation(),
    );
    expect(latestNavigation!.currentPage).toBe("resources");
    expect(latestNavigation!.navigationRequestId).toBe(requestId + 1);
    await act(async () => {
      unregisterCurrent();
      latestNavigation!.navigationGuard.discardPendingNavigation();
    });
    expect(latestNavigation!.navigationRequestId).toBe(requestId + 1);
  });

  it.each([
    { dirty: true, saving: false },
    { dirty: false, saving: true },
  ])("tryNavigate 同步读取现有守卫且拒绝时不排队：%j", async (guard) => {
    await renderProbe();
    await act(async () =>
      latestNavigation!.handleNavigate("settings", {
        tab: SettingsTabs.Browser,
      }),
    );
    const requestId = latestNavigation!.navigationRequestId;
    let accepted: boolean | undefined;
    let unregister = () => {};
    await act(async () => {
      unregister = latestNavigation!.navigationGuard.register(guard);
      // 注册与尝试发生在同次调用栈，不能读取上一帧的 dirty/saving 快照。
      accepted = latestNavigation!.tryNavigate("agent", {
        initialSessionId: "history-session",
      });
    });
    expect(accepted).toBe(false);
    expect(latestNavigation!.currentPage).toBe("settings");
    expect(latestNavigation!.navigationRequestId).toBe(requestId);
    expect(latestNavigation!.navigationGuard.pendingNavigation).toBe(false);
    await act(async () => {
      unregister();
      accepted = latestNavigation!.tryNavigate("agent", {
        initialSessionId: "history-session",
      });
    });
    expect(accepted).toBe(true);
    expect(latestNavigation!.currentPage).toBe("agent");
    expect(latestNavigation!.pageParams).toEqual({
      initialSessionId: "history-session",
    });
    expect(latestNavigation!.navigationRequestId).toBe(requestId + 1);
  });

  it("tryNavigate 被拒绝时保留既有待确认目标，不覆盖原导航用户意图", async () => {
    await renderProbe();
    await act(async () =>
      latestNavigation!.handleNavigate("settings", {
        tab: SettingsTabs.Browser,
      }),
    );
    let unregister = () => {};
    await act(async () => {
      unregister = latestNavigation!.navigationGuard.register({
        dirty: true,
        saving: false,
      });
      latestNavigation!.handleNavigate("skills", {
        initialSearchQuery: "retained",
      });
    });
    let accepted: boolean | undefined;
    await act(async () => {
      accepted = latestNavigation!.tryNavigate("agent", {
        initialSessionId: "history-session",
      });
    });
    expect(accepted).toBe(false);
    expect(latestNavigation!.navigationGuard.pendingNavigation).toBe(true);
    await act(async () => {
      unregister();
      latestNavigation!.navigationGuard.discardPendingNavigation();
    });
    expect(latestNavigation!.currentPage).toBe("skills");
    expect(latestNavigation!.pageParams).toEqual({
      initialSearchQuery: "retained",
    });
  });

  it("tryNavigate 接受设置目标时沿用现有返回会话，不引入第二套返回路由", async () => {
    await renderProbe();
    const params = buildConversationParams({
      initialSessionId: "original",
      projectId: "workspace",
    });
    await act(async () => latestNavigation!.handleNavigate("agent", params));
    let accepted: boolean | undefined;
    await act(async () => {
      accepted = latestNavigation!.tryNavigate("settings", {
        tab: SettingsTabs.Browser,
      });
    });
    expect(accepted).toBe(true);
    expect(latestNavigation!.currentPage).toBe("settings");
    await act(async () => latestNavigation!.returnFromSettings());
    expect(latestNavigation!.currentPage).toBe("agent");
    expect(latestNavigation!.pageParams).toEqual(params);
  });

  it("取消 pending 返回后保留原会话来处，不重放首发 intent", async () => {
    await renderProbe();
    await act(async () =>
      latestNavigation!.handleNavigate(
        "agent",
        buildConversationParams({
          initialSessionId: "session-original",
          projectId: "workspace-original",
          initialUserPrompt: "one shot",
        }),
      ),
    );
    await act(async () =>
      latestNavigation!.handleNavigate("settings", {
        tab: SettingsTabs.Memory,
      }),
    );
    let unregister = () => {};
    await act(async () => {
      unregister = latestNavigation!.navigationGuard.register({
        dirty: true,
        saving: false,
      });
    });
    await act(async () => latestNavigation!.returnFromSettings());
    await act(async () =>
      latestNavigation!.navigationGuard.clearPendingNavigation(),
    );
    expect(latestNavigation!.currentPage).toBe("settings");
    await act(async () => latestNavigation!.returnFromSettings());
    await act(async () =>
      latestNavigation!.navigationGuard.discardPendingNavigation(),
    );
    expect(latestNavigation!.pageParams).toMatchObject({
      initialSessionId: "session-original",
      projectId: "workspace-original",
    });
    expect(latestNavigation!.pageParams).not.toHaveProperty(
      "initialUserPrompt",
    );
    await act(async () => unregister());
  });

  it("agent 跳转应直接保留现役参数", async () => {
    await renderProbe();

    await act(async () => {
      latestNavigation?.handleNavigate(
        "agent",
        buildConversationParams({
          projectId: "project-2",
          initialUserPrompt: "继续整理当前项目",
        }),
      );
    });

    expect(latestNavigation?.currentPage).toBe("agent");
    expect(latestNavigation?.pageParams).toEqual({
      projectId: "project-2",
      initialUserPrompt: "继续整理当前项目",
      agentEntry: "conversation",
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

  it("agent 历史会话跳转应写入可恢复的最小页面状态", async () => {
    await renderProbe();

    await act(async () => {
      latestNavigation?.handleNavigate(
        "agent",
        buildConversationParams({
          projectId: "project-history",
          initialSessionId: "session-history",
          initialUserPrompt: "这条 prompt 不应被 reload 恢复",
        }),
      );
    });
    await flushEffects();

    expect(
      JSON.parse(
        window.sessionStorage.getItem(NAVIGATION_RESTORE_STORAGE_KEY) ?? "{}",
      ),
    ).toEqual({
      page: "agent",
      params: {
        agentEntry: "conversation",
        immersiveHome: false,
        initialSessionId: "session-history",
        lockTheme: false,
        projectId: "project-history",
        theme: "general",
      },
    });

    await remountProbe();

    expect(latestNavigation?.currentPage).toBe("agent");
    expect(latestNavigation?.pageParams).toEqual({
      agentEntry: "conversation",
      immersiveHome: false,
      initialSessionId: "session-history",
      lockTheme: false,
      projectId: "project-history",
      theme: "general",
    });
  });

  it("agent 新建首页跳转不应写入 reload 恢复状态", async () => {
    await renderProbe();

    await act(async () => {
      latestNavigation?.handleNavigate(
        "agent",
        buildConversationParams({ initialSessionId: "session-history" }),
      );
    });
    await flushEffects();
    expect(
      window.sessionStorage.getItem(NAVIGATION_RESTORE_STORAGE_KEY),
    ).not.toBe(null);

    await act(async () => {
      latestNavigation?.handleNavigate("agent", buildHomeAgentParams());
    });
    await flushEffects();

    expect(window.sessionStorage.getItem(NAVIGATION_RESTORE_STORAGE_KEY)).toBe(
      null,
    );
  });

  it("非法恢复状态应回退新建任务主链并清理存储", async () => {
    window.sessionStorage.setItem(
      NAVIGATION_RESTORE_STORAGE_KEY,
      JSON.stringify({
        page: "skills",
        params: { appId: "content-factory-app" },
      }),
    );

    await renderProbe();

    expect(latestNavigation?.currentPage).toBe("agent");
    expect(latestNavigation?.pageParams).toMatchObject({
      agentEntry: "new-task",
      immersiveHome: false,
    });
    expect(window.sessionStorage.getItem(NAVIGATION_RESTORE_STORAGE_KEY)).toBe(
      null,
    );
  });

  it("同页同参数重复跳转时不应再次更新导航状态", async () => {
    await renderProbe();

    await act(async () => {
      latestNavigation?.handleNavigate("plugins", { query: "fixture" });
    });
    await flushEffects();

    const readyCallsAfterFirstNavigation = readyCallCount;

    await act(async () => {
      latestNavigation?.handleNavigate("plugins", { query: "fixture" });
    });
    await flushEffects();

    expect(readyCallCount).toBe(readyCallsAfterFirstNavigation);
    expect(latestNavigation?.currentPage).toBe("plugins");
    expect(latestNavigation?.pageParams).toEqual({
      query: "fixture",
    });
  });

  it("同页同语义参数即使字段顺序不同也不应再次更新导航状态", async () => {
    await renderProbe();

    await act(async () => {
      latestNavigation?.handleNavigate("agent", {
        agentEntry: "conversation",
        projectId: "project-stable",
        theme: "general",
        initialRequestMetadata: {
          harness: {
            beta: 2,
            alpha: 1,
          },
        },
      });
    });
    await flushEffects();

    const readyCallsAfterFirstNavigation = readyCallCount;
    const requestIdAfterFirstNavigation = latestNavigation?.navigationRequestId;

    await act(async () => {
      latestNavigation?.handleNavigate("agent", {
        initialRequestMetadata: {
          harness: {
            alpha: 1,
            beta: 2,
          },
        },
        theme: "general",
        projectId: "project-stable",
        agentEntry: "conversation",
      });
    });
    await flushEffects();

    expect(readyCallCount).toBe(readyCallsAfterFirstNavigation);
    expect(latestNavigation?.navigationRequestId).toBe(
      requestIdAfterFirstNavigation,
    );
    expect(latestNavigation?.currentPage).toBe("agent");
    expect(latestNavigation?.pageParams).toMatchObject({
      agentEntry: "conversation",
      projectId: "project-stable",
      theme: "general",
      initialRequestMetadata: {
        harness: {
          beta: 2,
          alpha: 1,
        },
      },
    });
  });

  it("同一轮连续导航时应以最后一次请求为准", async () => {
    await renderProbe();

    await act(async () => {
      latestNavigation?.handleNavigate("scheduled-tasks");
      latestNavigation?.handleNavigate("plugins", { query: "fixture" });
    });
    await flushEffects();

    expect(latestNavigation?.currentPage).toBe("plugins");
    expect(latestNavigation?.requestedPage).toBe("plugins");
    expect(latestNavigation?.pageParams).toEqual({
      query: "fixture",
    });
    expect(latestNavigation?.requestedPageParams).toEqual({
      query: "fixture",
    });
    expect(latestNavigation?.navigationRequestId).toBe(2);
    expect(latestNavigation?.isNavigating).toBe(false);
  });

  it("首页首发后按实际可见会话和工作区返回，切章不覆盖来处或重放一次性输入", async () => {
    await renderProbe();
    const navigate = latestNavigation!.handleNavigate;
    const back = latestNavigation!.returnFromSettings;
    await act(async () => {
      latestNavigation!.startNewConversation({
        projectId: "old-workspace",
        freshDraft: true,
      });
    });
    await act(async () => {
      latestNavigation!.reportAgentLocation({
        sessionId: " materialized-thread ",
        workspaceId: " actual-workspace ",
      });
    });
    await act(async () => {
      navigate("settings", { tab: SettingsTabs.Providers });
    });
    const returnLocation = latestNavigation!.settingsReturnLocation;
    expect(returnLocation).toEqual({
      sessionId: "materialized-thread",
      workspaceId: "actual-workspace",
    });
    expect(latestNavigation!.agentLocation).toBeNull();
    await act(async () => {
      navigate("settings", { tab: SettingsTabs.Appearance });
    });
    expect(latestNavigation!.settingsReturnLocation).toBe(returnLocation);
    await act(async () => {
      back();
    });
    expect(latestNavigation!.pageParams).toEqual(
      buildConversationParams({
        initialSessionId: "materialized-thread",
        projectId: "actual-workspace",
        contentId: undefined,
      }),
    );
    expect(latestNavigation!.handleNavigate).toBe(navigate);
    expect(latestNavigation!.returnFromSettings).toBe(back);
    expect(latestNavigation!.settingsReturnLocation).toBeNull();
    const persisted = JSON.parse(
      window.sessionStorage.getItem(NAVIGATION_RESTORE_STORAGE_KEY)!,
    );
    expect(persisted.params.initialSessionId).toBe("materialized-thread");
    expect(persisted.params.newConversationRequest).toBeUndefined();
  });

  it("已有会话未发布位置时使用最小恢复参数，丢弃发送、附件、技能与新建意图", async () => {
    await renderProbe();
    await act(async () => {
      latestNavigation!.handleNavigate(
        "agent",
        buildConversationParams({
          projectId: "workspace",
          initialSessionId: "thread",
          contentId: "content",
          initialUserPrompt: "must-not-replay",
          initialUserImages: [{ data: "image", mediaType: "image/png" }],
          initialSiteSkillLaunch: { adapterName: "must-not-run" },
          newConversationRequest: {
            id: 1,
            workspaceId: "workspace",
            freshDraft: true,
          },
        }),
      );
    });
    await act(async () => {
      latestNavigation!.handleNavigate("settings");
    });
    expect(latestNavigation!.settingsReturnLocation).toEqual({
      sessionId: "thread",
      workspaceId: "workspace",
    });
    await act(async () => {
      latestNavigation!.handleNavigate("settings", { tab: SettingsTabs.About });
    });
    await act(async () => {
      latestNavigation!.returnFromSettings();
    });
    expect(latestNavigation!.pageParams).toEqual(
      buildConversationParams({
        initialSessionId: "thread",
        projectId: "workspace",
        contentId: "content",
      }),
    );
  });

  it("快速导航后的旧位置回调和设置期间的迟到回调不能夺取返回目标", async () => {
    await renderProbe();
    const stale = latestNavigation!.reportAgentLocation;
    await act(async () => {
      latestNavigation!.handleNavigate(
        "agent",
        buildConversationParams({
          initialSessionId: "new-thread",
          projectId: "new-workspace",
        }),
      );
    });
    await act(async () => {
      latestNavigation!.reportAgentLocation({
        sessionId: "new-thread",
        workspaceId: "visible-workspace",
      });
      stale({ sessionId: "old-thread", workspaceId: "old-workspace" });
    });
    const departing = latestNavigation!.reportAgentLocation;
    await act(async () => {
      latestNavigation!.handleNavigate("settings", {
        tab: SettingsTabs.Memory,
      });
      departing({ sessionId: "late-thread", workspaceId: "late-workspace" });
    });
    expect(latestNavigation!.settingsReturnLocation).toEqual({
      sessionId: "new-thread",
      workspaceId: "visible-workspace",
    });
    await act(async () => {
      latestNavigation!.returnFromSettings();
    });
    expect(latestNavigation!.pageParams).toMatchObject({
      initialSessionId: "new-thread",
      projectId: "visible-workspace",
    });
  });

  it("同批未提交导航不替换实际来处，重复报告也不触发重渲染", async () => {
    await renderProbe();
    const location = {
      sessionId: "visible-thread",
      workspaceId: "visible-workspace",
    };
    await act(async () => {
      latestNavigation!.reportAgentLocation(location);
    });
    const calls = readyCallCount;
    await act(async () => {
      latestNavigation!.reportAgentLocation({ ...location });
    });
    expect(readyCallCount).toBe(calls);
    await act(async () => {
      latestNavigation!.handleNavigate("plugins", { query: "not-yet-visible" });
      latestNavigation!.handleNavigate("settings");
    });
    await act(async () => {
      latestNavigation!.returnFromSettings();
    });
    expect(latestNavigation!.pageParams).toMatchObject({
      initialSessionId: "visible-thread",
      projectId: "visible-workspace",
    });
  });

  it("无会话来处返回首页，下一次从其它页面进入设置更新来处", async () => {
    await renderProbe();
    await act(async () => {
      latestNavigation!.handleNavigate("settings", { tab: SettingsTabs.About });
    });
    expect(latestNavigation!.settingsReturnLocation).toBeNull();
    await act(async () => {
      latestNavigation!.returnFromSettings();
    });
    expect(latestNavigation!.pageParams).toMatchObject({
      agentEntry: "new-task",
    });
    expect(latestNavigation!.pageParams).not.toHaveProperty("initialSessionId");
    await act(async () => {
      latestNavigation!.handleNavigate("plugins", {
        query: "retained",
        currentProjectId: "project",
      });
    });
    await act(async () => {
      latestNavigation!.handleNavigate("settings");
    });
    expect(latestNavigation!.settingsReturnLocation).toBeNull();
    await act(async () => {
      latestNavigation!.returnFromSettings();
    });
    expect(latestNavigation!.currentPage).toBe("plugins");
    expect(latestNavigation!.pageParams).toEqual({
      query: "retained",
      currentProjectId: "project",
    });
  });

  it("设置尚未真正离开时的连续导航保留来处，首页实际空工作区不回退旧项目", async () => {
    await renderProbe();
    await act(async () => {
      latestNavigation!.handleNavigate(
        "agent",
        buildHomeAgentParams({ projectId: "stale-project" }),
      );
    });
    await act(async () => {
      latestNavigation!.reportAgentLocation({
        sessionId: null,
        workspaceId: null,
      });
    });
    await act(async () => {
      latestNavigation!.handleNavigate("settings");
    });
    await act(async () => {
      latestNavigation!.handleNavigate("plugins");
      latestNavigation!.handleNavigate("settings", { tab: SettingsTabs.About });
    });
    await act(async () => {
      latestNavigation!.returnFromSettings();
    });
    expect(latestNavigation!.currentPage).toBe("agent");
    expect(latestNavigation!.pageParams).toMatchObject({
      agentEntry: "new-task",
    });
    expect(
      (latestNavigation!.pageParams as { projectId?: string }).projectId,
    ).toBeUndefined();
  });
});
