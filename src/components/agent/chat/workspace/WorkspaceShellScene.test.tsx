import React, { type ComponentProps } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceShellScene } from "./WorkspaceShellScene";

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function renderShell(
  overrides: Partial<ComponentProps<typeof WorkspaceShellScene>> = {},
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const defaultProps: ComponentProps<typeof WorkspaceShellScene> = {
    compactChrome: false,
    isThemeWorkbench: true,
    generalWorkbenchSidebarNode: <div data-testid="theme-sidebar" />,
    showChatPanel: true,
    showSidebar: true,
    showGeneralWorkbenchLeftExpandButton: false,
    onExpandGeneralWorkbenchSidebar: vi.fn(),
    mainAreaNode: <div data-testid="workspace-main">main</div>,
    currentTopicId: null,
    topics: [],
    onNewChat: vi.fn(),
    onSwitchTopic: vi.fn(),
    onResumeTask: vi.fn(),
    onDeleteTopic: vi.fn(),
    onRenameTopic: vi.fn(),
    currentMessages: [],
    isSending: false,
    pendingActionCount: 0,
    queuedTurnCount: 0,
    workspaceError: false,
    childSubagentSessions: [],
    subagentParentContext: null,
    onOpenSubagentSession: vi.fn(),
    onReturnToParentSession: vi.fn(),
  };

  act(() => {
    root.render(<WorkspaceShellScene {...defaultProps} {...overrides} />);
  });

  mountedRoots.push({ root, container });
  return container;
}

beforeEach(() => {
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
  vi.clearAllMocks();
});

describe("WorkspaceShellScene", () => {
  it("对话页、画布和工作台主壳应共享工作台主题作用域", () => {
    const container = renderShell();

    const shell = container.querySelector(
      '[data-testid="workspace-shell-scene"]',
    ) as HTMLElement | null;

    expect(shell?.className).toContain("lime-workbench-theme-scope");
    expect(
      shell?.querySelector('[data-testid="workspace-main"]'),
    ).not.toBeNull();
  });
});
