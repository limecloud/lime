import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TeamWorkspaceTeamOverviewChrome } from "./TeamWorkspaceTeamOverviewChrome";

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    className,
    onClick,
    type = "button",
    ...props
  }: {
    children: ReactNode;
    className?: string;
    onClick?: () => void;
    type?: "button" | "submit" | "reset";
    [key: string]: unknown;
  }) => (
    <button type={type} className={className} onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

const mountedRoots: Array<{
  root: ReturnType<typeof createRoot>;
  container: HTMLDivElement;
}> = [];

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
      continue;
    }

    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  vi.clearAllMocks();
});

function renderChrome(
  props?: Partial<ComponentProps<typeof TeamWorkspaceTeamOverviewChrome>>,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const defaultProps: ComponentProps<typeof TeamWorkspaceTeamOverviewChrome> =
    {
      boardChromeDisplay: {
        boardHeadline: "任务进行中 · 1 项处理中 / 1 项稍后开始",
        boardHint: "这里只展示当前有哪些任务在处理、状态如何，以及最近更新到了哪里。",
        compactBoardHeadline: "任务进行中 · 1 项处理中 / 1 项稍后开始",
        compactToolbarChips: [
          { key: "focus", text: "当前焦点 研究员", tone: "summary" },
          { key: "status", text: "处理中", tone: "status", status: "running" },
          { key: "updated-at", text: "更新于 刚刚", tone: "muted" },
          { key: "current", text: "当前任务", tone: "muted" },
          { key: "waitable", text: "2 项处理中", tone: "muted" },
        ],
        statusSummaryBadges: [],
      },
      canCloseCompletedTeamSessions: true,
      canWaitAnyActiveTeamSession: true,
      completedCount: 1,
      embedded: true,
      formatUpdatedAt: () => "刚刚",
      memberCanvasSubtitle:
        "2 项任务已接入，当前焦点会优先落在正在处理的任务上。",
      memberCanvasTitle: "任务视图",
      onAutoArrangeCanvas: vi.fn(),
      onCloseCompletedTeamSessions: vi.fn(),
      onFitCanvasView: vi.fn(),
      onSelectTeamOperationEntry: vi.fn(),
      onWaitAnyActiveTeamSessions: vi.fn(),
      onZoomIn: vi.fn(),
      onZoomOut: vi.fn(),
      pendingTeamAction: null,
      resolveStatusMeta: () => ({
        badgeClassName: "border border-sky-200 bg-sky-50 text-sky-700",
      }),
      selectedSession: {
        name: "研究员",
        isCurrent: true,
        updatedAt: 1710000000,
      },
      teamOperationEntries: [],
      useCompactCanvasChrome: true,
      waitableCount: 2,
    };

  act(() => {
    root.render(
      <TeamWorkspaceTeamOverviewChrome {...defaultProps} {...props} />,
    );
  });

  mountedRoots.push({ root, container });
  return container;
}

describe("TeamWorkspaceTeamOverviewChrome", () => {
  it("紧凑态应把当前焦点放进独立摘要块，并把操作放在下一行", () => {
    const container = renderChrome();

    const summary = container.querySelector(
      '[data-testid="team-workspace-compact-summary"]',
    ) as HTMLElement | null;
    const toolbar = container.querySelector(
      '[data-testid="team-workspace-canvas-toolbar"]',
    ) as HTMLElement | null;
    const controls = container.querySelector(
      '[data-testid="team-workspace-compact-controls"]',
    ) as HTMLElement | null;

    expect(summary?.textContent).toContain("任务视图");
    expect(summary?.textContent).toContain("研究员");
    expect(summary?.textContent).toContain("当前焦点");
    expect(summary?.textContent).toContain(
      "当前焦点会优先落在正在处理的任务上。",
    );
    expect(summary?.textContent).toContain("更新于 刚刚");
    expect(summary?.textContent).toContain("当前任务");

    expect(toolbar?.textContent).toContain("处理中");
    expect(toolbar?.textContent).toContain("2 项处理中");
    expect(toolbar?.textContent).not.toContain("当前焦点 研究员");

    expect(controls?.textContent).toContain("任务处理");
    expect(controls?.textContent).toContain("视图");
    expect(controls?.textContent).toContain("等待任一任务结果");
    expect(controls?.textContent).toContain("收起已完成任务");
    expect(controls?.textContent).toContain("聚焦任务");
    expect(controls?.textContent).toContain("整理布局");
    expect(controls?.textContent).not.toContain("缩小");
    expect(controls?.textContent).not.toContain("放大");
  });

  it("紧凑态存在任务进展时，应优先把进展列表放在次级操作之前", () => {
    const container = renderChrome({
      teamOperationEntries: [
        {
          id: "wait-1",
          title: "收到结果",
          detail: "刚才等到 执行器 返回了新结果，当前状态为已完成。",
          badgeClassName: "border border-emerald-200 bg-emerald-50 text-emerald-700",
          updatedAt: 1710000000,
          targetSessionId: "child-1",
        },
      ],
    });

    const operations = container.querySelector(
      '[data-testid="team-workspace-team-operations"]',
    ) as HTMLElement | null;
    const controls = container.querySelector(
      '[data-testid="team-workspace-compact-controls"]',
    ) as HTMLElement | null;

    expect(operations?.textContent).toContain("任务进展");
    expect(operations?.textContent).toContain("最近 1 条");
    expect(operations?.textContent).toContain("收到结果");
    expect(controls?.textContent).toContain("任务处理");
    expect(controls?.textContent).toContain("视图");
    const operationsOrder =
      operations && controls
        ? operations.compareDocumentPosition(controls) &
          Node.DOCUMENT_POSITION_FOLLOWING
        : 0;
    expect(
      operationsOrder,
    ).toBeTruthy();
  });
});
