import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type LocalConversationPageModule = typeof import("./index");
type LocalConversationPageProps = React.ComponentProps<
  LocalConversationPageModule["LocalConversationPage"]
>;

const latestWorkspaceProps = vi.hoisted(
  () =>
    ({
      value: null as Record<string, unknown> | null,
    }) as { value: Record<string, unknown> | null },
);
const workspaceLifecycle = vi.hoisted(() => {
  let currentNode: HTMLDivElement | null = null;
  const state = {
    mounts: 0,
    unmounts: 0,
  };
  return {
    get mounts() {
      return state.mounts;
    },
    get unmounts() {
      return state.unmounts;
    },
    ref(node: HTMLDivElement | null) {
      if (node && node !== currentNode) {
        currentNode = node;
        state.mounts += 1;
        return;
      }
      if (!node && currentNode) {
        currentNode = null;
        state.unmounts += 1;
      }
    },
    reset() {
      currentNode = null;
      state.mounts = 0;
      state.unmounts = 0;
    },
  };
});

vi.mock("./AgentChatWorkspace", () => ({
  AgentChatWorkspace: (props: Record<string, unknown>) => {
    latestWorkspaceProps.value = props;
    return (
      <div
        ref={workspaceLifecycle.ref}
        data-testid="workspace"
        data-agent-entry={String(props.agentEntry || "")}
        data-show-chat-panel={String(Boolean(props.showChatPanel))}
      />
    );
  },
}));

vi.mock("@/lib/api/skills", () => ({
  skillsApi: {
    getAll: vi.fn(async () => []),
    getLocal: vi.fn(async () => []),
  },
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];
let LocalConversationPage: LocalConversationPageModule["LocalConversationPage"];
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

beforeEach(async () => {
  vi.resetModules();
  ({ LocalConversationPage } = await import("./index"));
  HTMLElement.prototype.scrollIntoView = vi.fn();
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
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
  latestWorkspaceProps.value = null;
  HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  vi.clearAllMocks();
});

function renderPage(props: Partial<LocalConversationPageProps> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<LocalConversationPage {...props} />);
  });

  mountedRoots.push({ root, container });
  return container;
}

function renderPageWithRoot(props: Partial<LocalConversationPageProps> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const rerender = (nextProps: Partial<LocalConversationPageProps>) => {
    act(() => {
      root.render(<LocalConversationPage {...nextProps} />);
    });
  };

  rerender(props);
  mountedRoots.push({ root, container });
  return { container, rerender };
}

async function flushEffects(times = 8) {
  await act(async () => {
    for (let index = 0; index < times; index += 1) {
      await Promise.resolve();
    }
  });
}

describe("LocalConversationPage 工作区路由", () => {
  beforeEach(() => {
    workspaceLifecycle.reset();
  });

  it("标准 new-task 空白入口应渲染完整工作区首页", async () => {
    const container = renderPage({
      agentEntry: "new-task",
      projectId: "project-standard",
      showChatPanel: false,
    });

    await flushEffects();

    const workspace = container.querySelector(
      '[data-testid="workspace"]',
    ) as HTMLDivElement | null;

    expect(workspace).not.toBeNull();
    expect(workspace?.dataset.agentEntry).toBe("new-task");
    expect(workspace?.dataset.showChatPanel).toBe("false");
    expect(latestWorkspaceProps.value).toMatchObject({
      agentEntry: "new-task",
      projectId: "project-standard",
      showChatPanel: false,
    });
  });

  it("immersiveHome 模式同样应保留完整工作区首页", async () => {
    const container = renderPage({
      agentEntry: "new-task",
      immersiveHome: true,
      showChatPanel: false,
    });

    await flushEffects();

    const workspace = container.querySelector(
      '[data-testid="workspace"]',
    ) as HTMLDivElement | null;

    expect(workspace).not.toBeNull();
    expect(workspace?.dataset.agentEntry).toBe("new-task");
    expect(workspace?.dataset.showChatPanel).toBe("false");
    expect(latestWorkspaceProps.value).toMatchObject({
      agentEntry: "new-task",
      immersiveHome: true,
      showChatPanel: false,
    });
  });

  it("new-task 携带首条上下文时应继续按当前工作区语义渲染", async () => {
    const container = renderPage({
      agentEntry: "new-task",
      projectId: "project-standard",
      showChatPanel: false,
      initialUserPrompt: "请直接开始处理这个任务",
    });

    await flushEffects();

    const workspace = container.querySelector(
      '[data-testid="workspace"]',
    ) as HTMLDivElement | null;

    expect(workspace).not.toBeNull();
    expect(workspace?.dataset.agentEntry).toBe("conversation");
    expect(workspace?.dataset.showChatPanel).toBe("true");
    expect(latestWorkspaceProps.value).toMatchObject({
      initialUserPrompt: "请直接开始处理这个任务",
      agentEntry: "conversation",
      showChatPanel: true,
    });
  });

  it("new-task 携带初始项目文件目标时也应直接进入工作区", async () => {
    const container = renderPage({
      agentEntry: "new-task",
      projectId: "project-standard",
      showChatPanel: false,
      initialProjectFileOpenTarget: {
        relativePath: "exports/social-article/google-cloud/index.md",
        requestKey: 20260408,
      },
    });

    await flushEffects();

    const workspace = container.querySelector(
      '[data-testid="workspace"]',
    ) as HTMLDivElement | null;

    expect(workspace).not.toBeNull();
    expect(workspace?.dataset.agentEntry).toBe("conversation");
    expect(workspace?.dataset.showChatPanel).toBe("true");
    expect(latestWorkspaceProps.value).toMatchObject({
      initialProjectFileOpenTarget: {
        relativePath: "exports/social-article/google-cloud/index.md",
        requestKey: 20260408,
      },
      agentEntry: "conversation",
      showChatPanel: true,
    });
  });

  it("new-task 携带待启动服务技能时也应直接进入工作区", async () => {
    const container = renderPage({
      agentEntry: "new-task",
      projectId: "project-standard",
      showChatPanel: false,
      initialPendingServiceSkillLaunch: {
        skillId: "service-skill-1",
        requestKey: 20260409,
      },
    });

    await flushEffects();

    const workspace = container.querySelector(
      '[data-testid="workspace"]',
    ) as HTMLDivElement | null;

    expect(workspace).not.toBeNull();
    expect(workspace?.dataset.agentEntry).toBe("conversation");
    expect(workspace?.dataset.showChatPanel).toBe("true");
    expect(latestWorkspaceProps.value).toMatchObject({
      initialPendingServiceSkillLaunch: {
        skillId: "service-skill-1",
        requestKey: 20260409,
      },
      agentEntry: "conversation",
      showChatPanel: true,
    });
  });

  it("new-task 携带初始输入能力时也应直接进入工作区", async () => {
    const container = renderPage({
      agentEntry: "new-task",
      projectId: "project-standard",
      showChatPanel: false,
      initialInputCapability: {
        skill: {
          key: "writer",
          name: "写作助手",
          directory: "writer",
          localDirectoryPath: "/skills/" + "writer",
          installed: true,
          sourceKind: "other" as const,
          description: "",
        },
        requestKey: 20260418,
      },
    });

    await flushEffects();

    const workspace = container.querySelector(
      '[data-testid="workspace"]',
    ) as HTMLDivElement | null;

    expect(workspace).not.toBeNull();
    expect(workspace?.dataset.agentEntry).toBe("conversation");
    expect(workspace?.dataset.showChatPanel).toBe("true");
    expect(latestWorkspaceProps.value).toMatchObject({
      initialInputCapability: {
        skill: {
          key: "writer",
          name: "写作助手",
          directory: "writer",
          localDirectoryPath: "/skills/" + "writer",
          installed: true,
          sourceKind: "other" as const,
          description: "",
        },
        requestKey: 20260418,
      },
      agentEntry: "conversation",
      showChatPanel: true,
    });
  });

  it("new-task 从首页切到直达意图时应复用同一工作区实例", async () => {
    const rendered = renderPageWithRoot({
      agentEntry: "new-task",
      projectId: "project-standard",
      showChatPanel: false,
    });
    await flushEffects();

    const firstWorkspace = rendered.container.querySelector(
      '[data-testid="workspace"]',
    ) as HTMLDivElement | null;
    expect(firstWorkspace).not.toBeNull();
    expect(firstWorkspace?.dataset.agentEntry).toBe("new-task");
    expect(firstWorkspace?.dataset.showChatPanel).toBe("false");
    expect(workspaceLifecycle.mounts).toBe(1);
    expect(workspaceLifecycle.unmounts).toBe(0);

    rendered.rerender({
      agentEntry: "new-task",
      projectId: "project-standard",
      showChatPanel: false,
      initialUserPrompt: "请直接开始处理这个任务",
    });
    await flushEffects();

    const secondWorkspace = rendered.container.querySelector(
      '[data-testid="workspace"]',
    ) as HTMLDivElement | null;
    expect(secondWorkspace).toBe(firstWorkspace);
    expect(secondWorkspace?.dataset.agentEntry).toBe("conversation");
    expect(secondWorkspace?.dataset.showChatPanel).toBe("true");
    expect(workspaceLifecycle.mounts).toBe(1);
    expect(workspaceLifecycle.unmounts).toBe(0);
    expect(latestWorkspaceProps.value).toMatchObject({
      initialUserPrompt: "请直接开始处理这个任务",
      agentEntry: "conversation",
      showChatPanel: true,
    });
  });
});
