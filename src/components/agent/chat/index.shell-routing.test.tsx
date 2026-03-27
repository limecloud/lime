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

vi.mock("./AgentChatHomeShell", () => ({
  AgentChatHomeShell: ({
    onEnterWorkspace,
  }: {
    onEnterWorkspace: (payload: Record<string, unknown>) => void;
  }) => (
    <div data-testid="home-shell">
      <button
        type="button"
        data-testid="enter-workspace"
        onClick={() =>
          onEnterWorkspace({
            projectId: "project-shell",
            theme: "general",
            autoRunInitialPromptOnMount: true,
            newChatAt: 123,
          })
        }
      >
        进入工作区
      </button>
    </div>
  ),
}));

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

describe("AgentChatPage 首页壳路由", () => {
  it("标准 new-task 空白入口应渲染首页壳，而不是旧工作区空页", async () => {
    const container = renderPage({
      agentEntry: "new-task",
      projectId: "project-standard",
      showChatPanel: false,
    });

    await flushEffects();

    expect(
      container.querySelector('[data-testid="home-shell"]'),
    ).not.toBeNull();
    expect(container.querySelector('[data-testid="workspace"]')).toBeNull();
  });

  it("immersiveHome 模式同样应渲染首页壳", async () => {
    const container = renderPage({
      agentEntry: "new-task",
      immersiveHome: true,
      showChatPanel: false,
    });

    await flushEffects();

    expect(
      container.querySelector('[data-testid="home-shell"]'),
    ).not.toBeNull();
    expect(container.querySelector('[data-testid="workspace"]')).toBeNull();
  });

  it("从首页壳进入工作区后应按 claw 语义渲染", async () => {
    renderPage({
      agentEntry: "new-task",
      initialUserPrompt: "预热工作区模块",
      showChatPanel: false,
    });
    await flushEffects();
    latestWorkspaceProps.value = null;

    const container = renderPage({
      agentEntry: "new-task",
      immersiveHome: true,
      showChatPanel: false,
    });

    await flushEffects();

    const enterButton = container.querySelector(
      '[data-testid="enter-workspace"]',
    ) as HTMLButtonElement | null;

    expect(enterButton).toBeTruthy();

    act(() => {
      enterButton?.click();
    });

    await flushEffects();
    await act(
      async () =>
        await new Promise((resolve) => {
          window.setTimeout(resolve, 220);
        }),
    );
    await flushEffects();

    const workspace = container.querySelector(
      '[data-testid="workspace"]',
    ) as HTMLDivElement | null;

    expect(container.querySelector('[data-testid="home-shell"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="claw-empty-state"]'),
    ).toBeNull();
    expect(workspace).not.toBeNull();
    expect(workspace?.dataset.agentEntry).toBe("claw");
    expect(workspace?.dataset.showChatPanel).toBe("true");
    expect(latestWorkspaceProps.value).toMatchObject({
      projectId: "project-shell",
      theme: "general",
      autoRunInitialPromptOnMount: true,
      newChatAt: 123,
      agentEntry: "claw",
      showChatPanel: true,
    });
  });

  it("new-task 携带首条上下文时应直接按 claw 语义渲染", async () => {
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
  });
});
