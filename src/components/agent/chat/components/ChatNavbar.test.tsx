import React, { useState } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatNavbar } from "./ChatNavbar";

vi.mock("@/components/projects/ProjectSelector", () => ({
  ProjectSelector: () => <div data-testid="project-selector" />,
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
  it("有 Harness 信号时应渲染顶栏切换按钮", () => {
    const onToggleHarnessPanel = vi.fn();
    const container = renderChatNavbar({
      showHarnessToggle: true,
      harnessPanelVisible: false,
      harnessPendingCount: 2,
      onToggleHarnessPanel,
    });

    const button = container.querySelector(
      'button[aria-label="展开 Harness 面板"]',
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
      'button[aria-label="展开 Harness 面板"]',
    ) as HTMLButtonElement | null;

    expect(container.querySelector('[data-testid="harness-panel"]')).toBeNull();

    act(() => {
      expandButton?.click();
    });

    expect(
      container.querySelector('[data-testid="harness-panel"]'),
    ).not.toBeNull();

    const collapseButton = container.querySelector(
      'button[aria-label="收起 Harness 面板"]',
    ) as HTMLButtonElement | null;

    act(() => {
      collapseButton?.click();
    });

    expect(container.querySelector('[data-testid="harness-panel"]')).toBeNull();
  });
});
