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

  it("通用对话应支持从顶栏打开浏览器协助", () => {
    const onOpenBrowserAssist = vi.fn();
    const container = renderChatNavbar({
      showBrowserAssistEntry: true,
      onOpenBrowserAssist,
    });

    const button = container.querySelector(
      'button[aria-label="在右侧画布打开浏览器协助"]',
    ) as HTMLButtonElement | null;

    expect(button).not.toBeNull();
    expect(button?.textContent).toContain("浏览器协助");

    act(() => {
      button?.click();
    });

    expect(onOpenBrowserAssist).toHaveBeenCalledTimes(1);
  });

  it("应支持显示浏览器协助状态文案", () => {
    const container = renderChatNavbar({
      showBrowserAssistEntry: true,
      browserAssistLabel: "等待登录",
    });

    const button = container.querySelector(
      'button[aria-label="在右侧画布打开浏览器协助"]',
    ) as HTMLButtonElement | null;

    expect(button?.textContent).toContain("等待登录");
  });

  it("浏览器待继续时顶栏按钮应显示恢复态语义", () => {
    const container = renderChatNavbar({
      showBrowserAssistEntry: true,
      browserAssistAttentionLevel: "warning",
      browserAssistLabel: "等待登录",
    });

    const button = container.querySelector(
      'button[aria-label="恢复浏览器协助"]',
    ) as HTMLButtonElement | null;

    expect(button).not.toBeNull();
    expect(button?.textContent).toContain("等待登录");
    expect(button?.className).toContain("border-amber-300");
    expect(button?.className).toContain("text-amber-800");
  });

  it("浏览器启动中时顶栏按钮应显示启动态语义", () => {
    const container = renderChatNavbar({
      showBrowserAssistEntry: true,
      browserAssistAttentionLevel: "info",
      browserAssistLoading: true,
    });

    const button = container.querySelector(
      'button[aria-label="查看浏览器启动状态"]',
    ) as HTMLButtonElement | null;

    expect(button).not.toBeNull();
    expect(button?.disabled).toBe(true);
    expect(button?.textContent).toContain("启动中...");
    expect(button?.className).toContain("border-sky-300");
    expect(button?.className).toContain("text-sky-800");
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
