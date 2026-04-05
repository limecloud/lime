import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspacePendingA2UIDialog } from "./WorkspacePendingA2UIDialog";

const mockA2UITaskCard = vi.fn((_props?: unknown) => (
  <div data-testid="workspace-a2ui-card" />
));
const mockSubmissionNotice = vi.fn(
  (props?: { notice?: { title?: string; summary?: string } }) => (
    <div data-testid="workspace-a2ui-notice">
      {props?.notice?.title}:{props?.notice?.summary}
    </div>
  ),
);
const mockUseStickyA2UIForm = vi.fn();
const mockUseA2UISubmissionNotice = vi.fn();

vi.mock("../components/A2UITaskCard", () => ({
  A2UITaskCard: (props?: unknown) => mockA2UITaskCard(props),
}));

vi.mock("./A2UISubmissionNotice", () => ({
  A2UISubmissionNotice: (props?: {
    notice?: { title?: string; summary?: string };
  }) => mockSubmissionNotice(props),
}));

vi.mock("./useStickyA2UIForm", () => ({
  useStickyA2UIForm: (props: unknown) => mockUseStickyA2UIForm(props),
}));

vi.mock("./useA2UISubmissionNotice", () => ({
  useA2UISubmissionNotice: (props: unknown) =>
    mockUseA2UISubmissionNotice(props),
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
  mockUseStickyA2UIForm.mockReturnValue({
    visibleForm: null,
    isStale: false,
  });
  mockUseA2UISubmissionNotice.mockReturnValue({
    visibleNotice: null,
    isVisible: false,
  });
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

function renderDialog(
  props?: Partial<React.ComponentProps<typeof WorkspacePendingA2UIDialog>>,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <WorkspacePendingA2UIDialog
        pendingA2UIForm={null}
        onA2UISubmit={vi.fn()}
        a2uiSubmissionNotice={null}
        {...props}
      />,
    );
  });

  mountedRoots.push({ container, root });
  return container;
}

describe("WorkspacePendingA2UIDialog", () => {
  it("有待处理表单时应在聊天区底部渲染内置 A2UI 卡片", () => {
    mockUseStickyA2UIForm.mockReturnValue({
      visibleForm: {
        id: "form-1",
        root: "root",
        components: [],
        submitAction: {
          label: "继续处理",
          action: { name: "submit" },
        },
      },
      isStale: true,
    });

    const container = renderDialog({
      pendingA2UIForm: {
        id: "form-1",
        root: "root",
        components: [],
        submitAction: {
          label: "继续处理",
          action: { name: "submit" },
        },
      },
    });

    expect(
      container.querySelector('[data-testid="workspace-pending-a2ui-dialog"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="workspace-a2ui-card"]'),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[data-testid="workspace-pending-a2ui-scroll-area"]',
      )?.className,
    ).toContain("overflow-y-auto");
    expect(mockA2UITaskCard).toHaveBeenCalledWith(
      expect.objectContaining({
        compact: true,
        surface: "embedded",
        submitDisabled: true,
        statusLabel: "同步中",
      }),
    );
  });

  it("只有提交完成提示时也应保留聊天区内联反馈", () => {
    mockUseA2UISubmissionNotice.mockReturnValue({
      visibleNotice: {
        title: "补充信息已确认",
        summary: "已继续处理。",
      },
      isVisible: true,
    });

    const container = renderDialog({
      a2uiSubmissionNotice: {
        title: "补充信息已确认",
        summary: "已继续处理。",
      },
    });

    expect(
      container.querySelector('[data-testid="workspace-pending-a2ui-dialog"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="workspace-a2ui-notice"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("补充信息已确认:已继续处理。");
  });
});
