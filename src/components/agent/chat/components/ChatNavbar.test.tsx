import React, { useState } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatNavbar } from "./ChatNavbar";

const { mockProjectSelector } = vi.hoisted(() => ({
  mockProjectSelector: vi.fn(),
}));

vi.mock("@/components/projects/ProjectSelector", () => ({
  ProjectSelector: (props: Record<string, unknown>) => {
    mockProjectSelector(props);
    return <div data-testid="project-selector" />;
  },
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    ...rest
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    [key: string]: unknown;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
  ),
}));

interface MountedHarness {
  container: HTMLDivElement;
  root: Root;
}

const mountedRoots: MountedHarness[] = [];

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
    if (!mounted) break;
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  vi.clearAllMocks();
});

function mount(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(node);
  });

  mountedRoots.push({ container, root });
  return container;
}

function renderChatNavbar(
  props?: Partial<React.ComponentProps<typeof ChatNavbar>>,
) {
  const defaultProps: React.ComponentProps<typeof ChatNavbar> = {
    isRunning: false,
    onToggleHistory: vi.fn(),
    onToggleFullscreen: vi.fn(),
  };

  return mount(<ChatNavbar {...defaultProps} {...props} />);
}

describe("ChatNavbar", () => {
  it("返回按钮应指向新建任务输入页", () => {
    const onBackHome = vi.fn();
    const container = renderChatNavbar({
      onBackHome,
    });

    const button = container.querySelector(
      'button[aria-label="返回新建任务"]',
    ) as HTMLButtonElement | null;

    expect(button).not.toBeNull();

    act(() => {
      button?.click();
    });

    expect(onBackHome).toHaveBeenCalledTimes(1);
  });

  it("有 Harness 信号时应渲染顶栏切换按钮", () => {
    const onToggleHarnessPanel = vi.fn();
    const container = renderChatNavbar({
      showHarnessToggle: true,
      harnessPanelVisible: false,
      harnessPendingCount: 2,
      onToggleHarnessPanel,
    });

    const button = container.querySelector(
      'button[aria-label="展开Harness"]',
    ) as HTMLButtonElement | null;

    expect(button).not.toBeNull();
    expect(button?.textContent).toContain("Harness");
    expect(button?.textContent).toContain("2");

    act(() => {
      button?.click();
    });

    expect(onToggleHarnessPanel).toHaveBeenCalledTimes(1);
  });

  it("工作区紧凑顶栏应保留执行入口但隐藏项目选择器", () => {
    const container = renderChatNavbar({
      chrome: "workspace-compact",
      showHistoryToggle: true,
      showHarnessToggle: true,
    });

    expect(container.querySelector('[aria-label="切换历史"]')).not.toBeNull();
    expect(
      container.querySelector('[aria-label="展开Harness"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="project-selector"]'),
    ).toBeNull();
  });

  it("任务中心折叠顶栏应隐藏左侧重导航，但保留右侧项目与工具入口", () => {
    const container = renderChatNavbar({
      collapseChrome: true,
      onBackHome: vi.fn(),
      onBackToResources: vi.fn(),
      onBackToProjectManagement: vi.fn(),
      onToggleSettings: vi.fn(),
      showHistoryToggle: true,
      showCanvasToggle: true,
      projectId: "project-1",
      workspaceType: "general",
      showContextCompactionAction: true,
    });

    expect(
      container.querySelector('button[aria-label="返回新建任务"]'),
    ).toBeNull();
    expect(container.textContent).not.toContain("返回资源");
    expect(container.textContent).not.toContain("项目管理");
    expect(container.querySelector('[aria-label="切换历史"]')).toBeNull();
    expect(container.querySelector('[aria-label="展开画布"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="project-selector"]'),
    ).not.toBeNull();
    expect(container.querySelector('[aria-label="打开设置"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="压缩上下文"]')).not.toBeNull();
  });

  it("任务中心顶栏应渲染第一层 workspace tab bar", () => {
    const onBackToProjectManagement = vi.fn();
    const container = renderChatNavbar({
      contextVariant: "task-center",
      projectId: "project-1",
      workspaceType: "general",
      onBackToProjectManagement,
      onToggleSettings: vi.fn(),
    });

    expect(
      container.querySelector('[data-testid="task-center-workspace-bar"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="project-selector"]'),
    ).not.toBeNull();
    expect(mockProjectSelector).toHaveBeenCalledWith(
      expect.objectContaining({
        chrome: "workspace-tab",
        open: false,
        passiveTrigger: true,
      }),
    );
    expect(
      container.querySelector('[data-testid="task-center-workspace-menu-trigger"]'),
    ).not.toBeNull();
    expect(container.querySelector('[aria-label="打开设置"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="切换历史"]')).toBeNull();

    act(() => {
      (
        container.querySelector(
          'button[aria-label="展开工作区菜单"]',
        ) as HTMLButtonElement | null
      )?.click();
    });

    expect(onBackToProjectManagement).not.toHaveBeenCalled();
    expect(mockProjectSelector).toHaveBeenLastCalledWith(
      expect.objectContaining({
        chrome: "workspace-tab",
        open: true,
        passiveTrigger: true,
      }),
    );
  });

  it("任务中心顶栏应保留 Harness 状态入口", () => {
    const container = renderChatNavbar({
      contextVariant: "task-center",
      showHarnessToggle: true,
      harnessPendingCount: 3,
    });

    const button = container.querySelector(
      'button[aria-label="展开Harness"]',
    ) as HTMLButtonElement | null;

    expect(button).not.toBeNull();
    expect(button?.textContent).toContain("Harness");
    expect(button?.textContent).toContain("3");
  });

  it("点击顶栏按钮后应切换 Harness 面板显隐", () => {
    function HarnessToggleHarness() {
      const [visible, setVisible] = useState(false);

      return (
        <>
          <ChatNavbar
            isRunning={false}
            onToggleHistory={() => {}}
            onToggleFullscreen={() => {}}
            showHarnessToggle
            harnessPanelVisible={visible}
            onToggleHarnessPanel={() => setVisible((current) => !current)}
          />
          {visible ? (
            <div data-testid="harness-panel">Harness Panel</div>
          ) : null}
        </>
      );
    }

    const container = mount(<HarnessToggleHarness />);
    const expandButton = container.querySelector(
      'button[aria-label="展开Harness"]',
    ) as HTMLButtonElement | null;

    expect(container.querySelector('[data-testid="harness-panel"]')).toBeNull();

    act(() => {
      expandButton?.click();
    });

    expect(
      container.querySelector('[data-testid="harness-panel"]'),
    ).not.toBeNull();

    const collapseButton = container.querySelector(
      'button[aria-label="收起Harness"]',
    ) as HTMLButtonElement | null;

    act(() => {
      collapseButton?.click();
    });

    expect(container.querySelector('[data-testid="harness-panel"]')).toBeNull();
  });

  it("Harness 告警态应使用强调样式", () => {
    const container = renderChatNavbar({
      showHarnessToggle: true,
      harnessAttentionLevel: "warning",
      harnessToggleLabel: "执行提醒",
    });

    const button = container.querySelector(
      'button[aria-label="展开执行提醒"]',
    ) as HTMLButtonElement | null;

    expect(button).not.toBeNull();
    expect(button?.className).toContain("border-amber-300");
    expect(button?.className).toContain("text-amber-800");
  });

  it("压缩上下文运行中时应禁用顶栏操作", () => {
    const container = renderChatNavbar({
      showContextCompactionAction: true,
      contextCompactionRunning: true,
    });

    const button = container.querySelector(
      'button[aria-label="压缩上下文"]',
    ) as HTMLButtonElement | null;

    expect(button).not.toBeNull();
    expect(button?.disabled).toBe(true);
    expect(button?.textContent).toContain("压缩中...");
  });

  it("通用对话项目选择器应启用管理能力", () => {
    renderChatNavbar({
      workspaceType: "general",
      projectId: "project-1",
    });

    expect(mockProjectSelector).toHaveBeenCalled();
    const lastCall = mockProjectSelector.mock.calls.at(-1)?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(lastCall?.enableManagement).toBe(true);
    expect(lastCall?.density).toBe("compact");
    expect(lastCall?.chrome).toBe("embedded");
  });

  it("应支持从右上角工具组打开设置", () => {
    const onToggleSettings = vi.fn();
    const container = renderChatNavbar({
      onToggleSettings,
    });

    const button = container.querySelector(
      'button[aria-label="打开设置"]',
    ) as HTMLButtonElement | null;

    expect(button).not.toBeNull();

    act(() => {
      button?.click();
    });

    expect(onToggleSettings).toHaveBeenCalledTimes(1);
  });

  it("应支持在顶栏展开和折叠画布", () => {
    const onToggleCanvas = vi.fn();
    const container = renderChatNavbar({
      showCanvasToggle: true,
      isCanvasOpen: false,
      onToggleCanvas,
    });

    const expandButton = container.querySelector(
      'button[aria-label="展开画布"]',
    ) as HTMLButtonElement | null;

    expect(expandButton).not.toBeNull();

    act(() => {
      expandButton?.click();
    });

    expect(onToggleCanvas).toHaveBeenCalledTimes(1);
  });
});
