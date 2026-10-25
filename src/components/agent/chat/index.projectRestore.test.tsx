import { describe, expect, it, vi } from "vitest";
import {
  createMockAgentChatUnifiedState,
  createProject,
  flushEffects,
  getHookCallOrderForWorkspace,
  getIndexTestMocks,
  installMockAgentChatUnifiedState,
  mountPage,
  observedWorkspaceIds,
  renderPage,
  sharedSendMessageMock,
  sharedSwitchTopicMock,
} from "./index.testFixtures";

const {
  mockEnsureWorkspaceReady,
  mockGetDefaultProject,
  mockGetOrCreateDefaultProject,
  mockGetProject,
  mockToast,
} = getIndexTestMocks();

describe("LocalConversationPage 话题切换项目恢复", { timeout: 60_000 }, () => {
  it("应先切换到话题绑定项目，再执行话题切换", async () => {
    localStorage.setItem(
      "agent_session_workspace_topic-a",
      JSON.stringify("project-topic"),
    );

    const mounted = mountPage({ agentEntry: "conversation" });
    await flushEffects(60);

    mounted.rerender({ initialSessionId: "topic-a" });
    await flushEffects(60);

    expect(sharedSwitchTopicMock).toHaveBeenCalledWith(
      "topic-a",
      expect.objectContaining({ allowDetachedSession: true }),
    );

    const workspaceHookOrder = getHookCallOrderForWorkspace("project-topic");
    const switchTopicOrder =
      sharedSwitchTopicMock.mock.invocationCallOrder[0];
    expect(workspaceHookOrder).toBeLessThan(switchTopicOrder);
    expect(observedWorkspaceIds).toContain("project-topic");
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it("外部锁定项目与话题绑定冲突时应阻止切换且不弹出全局 tip", async () => {
    localStorage.setItem(
      "agent_session_workspace_topic-a",
      JSON.stringify("topic-project"),
    );

    const mounted = mountPage({
      agentEntry: "conversation",
      projectId: "locked-project",
    });
    await flushEffects(60);

    mounted.rerender({ initialSessionId: "topic-a" });
    await flushEffects(60);

    expect(sharedSwitchTopicMock).not.toHaveBeenCalled();
    expect(mockToast.error).not.toHaveBeenCalled();
    expect(mockGetOrCreateDefaultProject).not.toHaveBeenCalled();
  });

  it("无可用项目时不应自动创建默认项目，但允许 detached 话题切换", async () => {
    mockGetProject.mockImplementation(async (projectId: string) => {
      if (projectId === "default-new") {
        return createProject("default-new");
      }
      return null;
    });
    mockGetDefaultProject.mockResolvedValue(null);
    mockGetOrCreateDefaultProject.mockResolvedValue(
      createProject("default-new"),
    );

    const mounted = mountPage({ agentEntry: "conversation" });
    await flushEffects(60);

    mounted.rerender({ initialSessionId: "topic-a" });
    await flushEffects(60);

    expect(mockGetOrCreateDefaultProject).not.toHaveBeenCalled();
    expect(mockToast.info).not.toHaveBeenCalledWith(
      "未找到可用项目，已自动创建默认项目",
    );
    expect(sharedSwitchTopicMock).toHaveBeenCalledWith(
      "topic-a",
      expect.objectContaining({ allowDetachedSession: true }),
    );
    expect(observedWorkspaceIds[observedWorkspaceIds.length - 1]).toBe(
      "",
    );
  });

  it("默认工作区别名没有最近项目时应保持未选择项目", async () => {
    mockGetOrCreateDefaultProject.mockResolvedValue(
      createProject("project-default-real"),
    );
    mockEnsureWorkspaceReady.mockResolvedValue({
      workspaceId: "project-default-real",
      rootPath: "/tmp/project-default-real",
      existed: true,
      created: false,
      repaired: false,
      relocated: false,
      previousRootPath: null,
      warning: null,
    });

    renderPage({ agentEntry: "conversation", projectId: "default" });
    await flushEffects(60);

    expect(mockGetOrCreateDefaultProject).not.toHaveBeenCalled();
    expect(mockEnsureWorkspaceReady).not.toHaveBeenCalledWith(
      "project-default-real",
    );
    expect(observedWorkspaceIds).not.toContain("default");
    expect(observedWorkspaceIds[observedWorkspaceIds.length - 1]).toBe(
      "",
    );
  });

  it("legacy workspace-default 入口应优先恢复最近项目，而不是继续走默认工作区", async () => {
    localStorage.setItem(
      "agent_last_project_id",
      JSON.stringify("project-remembered"),
    );
    mockEnsureWorkspaceReady.mockResolvedValue({
      workspaceId: "project-remembered",
      rootPath: "/tmp/project-remembered",
      existed: true,
      created: false,
      repaired: false,
      relocated: false,
      previousRootPath: null,
      warning: null,
    });

    renderPage({ agentEntry: "conversation", projectId: "workspace-default" });
    await flushEffects(60);

    expect(mockGetOrCreateDefaultProject).not.toHaveBeenCalled();
    expect(mockEnsureWorkspaceReady).toHaveBeenCalledWith("project-remembered");
    expect(observedWorkspaceIds[observedWorkspaceIds.length - 1]).toBe(
      "project-remembered",
    );
  });

  it("新建对话时不应读取 stale 最近项目或创建默认项目", async () => {
    localStorage.setItem(
      "agent_last_project_id",
      JSON.stringify("workspace-1"),
    );
    mockGetProject.mockImplementation(async (projectId: string) => {
      if (projectId === "workspace-1") {
        return null;
      }
      return createProject(projectId);
    });
    mockGetOrCreateDefaultProject.mockResolvedValue(
      createProject("project-default-real"),
    );
    mockEnsureWorkspaceReady.mockResolvedValue({
      workspaceId: "project-default-real",
      rootPath: "/tmp/project-default-real",
      existed: true,
      created: false,
      repaired: false,
      relocated: false,
      previousRootPath: null,
      warning: null,
    });

    renderPage({
      agentEntry: "new-task",
      showChatPanel: false,
      newChatAt: 1234567890,
    });
    await flushEffects(60);

    expect(mockGetProject).not.toHaveBeenCalledWith("workspace-1");
    expect(mockGetOrCreateDefaultProject).not.toHaveBeenCalled();
    expect(observedWorkspaceIds).not.toContain("workspace-1");
    expect(observedWorkspaceIds[observedWorkspaceIds.length - 1]).toBe(
      "",
    );
  });

  it("临时 workspace 路径缺失时不应自动创建默认工作区或重发", async () => {
    localStorage.setItem("agent_last_project_id", JSON.stringify("temp-ws"));
    mockGetProject.mockImplementation(async (projectId: string) => {
      if (projectId === "temp-ws") {
        return {
          ...createProject("temp-ws"),
          workspaceType: "temporary",
          rootPath: "/var/folders/lime-knowledge-product-e2e-stale",
        };
      }
      return createProject(projectId);
    });
    mockGetOrCreateDefaultProject.mockResolvedValue(
      createProject("project-default-real"),
    );
    mockEnsureWorkspaceReady.mockResolvedValue({
      workspaceId: "project-default-real",
      rootPath: "/tmp/project-default-real",
      existed: true,
      created: false,
      repaired: false,
      relocated: false,
      previousRootPath: null,
      warning: null,
    });
    installMockAgentChatUnifiedState(
      createMockAgentChatUnifiedState({
        workspacePathMissing: {
          content: "只回答一个字：好",
          images: [],
        },
        dismissWorkspacePathError: vi.fn(),
      }),
    );

    renderPage({ agentEntry: "conversation" });
    await flushEffects(60);

    expect(mockGetOrCreateDefaultProject).not.toHaveBeenCalled();
    expect(mockEnsureWorkspaceReady).not.toHaveBeenCalledWith(
      "project-default-real",
    );
    expect(observedWorkspaceIds).toContain("temp-ws");
    expect(observedWorkspaceIds[observedWorkspaceIds.length - 1]).toBe(
      "temp-ws",
    );
    expect(sharedSendMessageMock).not.toHaveBeenCalled();
  });

  it("收到首页新会话请求时应清空当前工作区上下文", async () => {
    localStorage.setItem(
      "agent_last_project_id",
      JSON.stringify("project-manual"),
    );

    const mounted = mountPage({ agentEntry: "conversation" });
    await flushEffects(60);

    expect(observedWorkspaceIds[observedWorkspaceIds.length - 1]).toBe(
      "project-manual",
    );

    mounted.rerender({ newChatAt: 2233445566 });

    await flushEffects(60);
    expect(observedWorkspaceIds).toContain("");
    expect(observedWorkspaceIds[observedWorkspaceIds.length - 1]).toBe(
      "",
    );
  });
});
