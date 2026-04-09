import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type AgentChatPageModule = typeof import("./index");
type AgentChatPageProps = React.ComponentProps<
  AgentChatPageModule["AgentChatPage"]
>;

const latestWorkspaceProps = vi.hoisted(
  () =>
    ({
      value: null as Record<string, unknown> | null,
    }) as { value: Record<string, unknown> | null },
);

vi.mock("./AgentChatWorkspace", () => ({
  AgentChatWorkspace: (props: Record<string, unknown>) => {
    latestWorkspaceProps.value = props;
    return (
      <div
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
let AgentChatPage: AgentChatPageModule["AgentChatPage"];
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

beforeEach(async () => {
  vi.resetModules();
  ({ AgentChatPage } = await import("./index"));
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

function renderPage(props: Partial<AgentChatPageProps> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<AgentChatPage {...props} />);
  });

  mountedRoots.push({ root, container });
  return container;
}

async function flushEffects(times = 8) {
  await act(async () => {
    for (let index = 0; index < times; index += 1) {
      await Promise.resolve();
    }
  });
}

describe("AgentChatPage 工作区路由", () => {
  it("标准 new-task 空白入口应保留当前首页语义", async () => {
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
  });

  it("immersiveHome 模式同样应保留当前首页语义", async () => {
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
    expect(workspace?.dataset.agentEntry).toBe("claw");
    expect(workspace?.dataset.showChatPanel).toBe("true");
    expect(latestWorkspaceProps.value).toMatchObject({
      initialUserPrompt: "请直接开始处理这个任务",
      agentEntry: "claw",
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
    expect(workspace?.dataset.agentEntry).toBe("claw");
    expect(workspace?.dataset.showChatPanel).toBe("true");
    expect(latestWorkspaceProps.value).toMatchObject({
      initialProjectFileOpenTarget: {
        relativePath: "exports/social-article/google-cloud/index.md",
        requestKey: 20260408,
      },
      agentEntry: "claw",
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
    expect(workspace?.dataset.agentEntry).toBe("claw");
    expect(workspace?.dataset.showChatPanel).toBe("true");
    expect(latestWorkspaceProps.value).toMatchObject({
      initialPendingServiceSkillLaunch: {
        skillId: "service-skill-1",
        requestKey: 20260409,
      },
      agentEntry: "claw",
      showChatPanel: true,
    });
  });
});
