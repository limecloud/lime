import { act } from "react";
import type { ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { changeLimeLocale } from "@/i18n/createI18n";
import { FileChangesSummaryCard } from "./FileChangesSummaryCard";
import type { FileChangesAggregate } from "../utils/fileChangeSummary";

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function createAggregate(): FileChangesAggregate {
  return {
    fileCount: 1,
    totalAdded: 2,
    totalRemoved: 1,
    files: [
      {
        path: "/workspace/projects/Demo/.lime/qc/code-runtime-fixture/src/greeting.ts",
        kind: "update",
        linesAdded: 2,
        linesRemoved: 1,
        truncated: false,
        source: "backend",
        status: "completed",
        diff: [
          {
            kind: "context",
            value: "export function greeting() {",
          },
          {
            kind: "remove",
            value: "  return 'Hello from initial fixture';",
          },
          {
            kind: "add",
            value: "  return 'Hello Lime Runtime';",
          },
          {
            kind: "add",
            value: "export const runtimeVerified = true;",
          },
        ],
      },
    ],
  };
}

function createLargeAggregate(): FileChangesAggregate {
  const files = Array.from({ length: 11 }, (_, index) => ({
    ...createAggregate().files[0]!,
    path: `scripts/harness/file-${index + 1}.mjs`,
    linesAdded: index + 1,
    linesRemoved: index,
  }));
  return {
    fileCount: files.length,
    totalAdded: files.reduce((total, file) => total + file.linesAdded, 0),
    totalRemoved: files.reduce((total, file) => total + file.linesRemoved, 0),
    files,
  };
}

function renderCard(props?: {
  aggregate?: FileChangesAggregate;
  onFileClick?: (path: string, content: string) => void;
  onOpenFile?: NonNullable<
    ComponentProps<typeof FileChangesSummaryCard>["onOpenFile"]
  >;
  onUndo?: () => Promise<{ restoredCount?: number } | void> | void;
}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <FileChangesSummaryCard
        aggregate={props?.aggregate ?? createAggregate()}
        onFileClick={props?.onFileClick}
        onOpenFile={props?.onOpenFile}
        onUndo={props?.onUndo}
      />,
    );
  });

  mountedRoots.push({ root, container });
  return { container };
}

beforeEach(async () => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  await changeLimeLocale("zh-CN");
});

afterEach(async () => {
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
  await changeLimeLocale("en-US");
});

describe("FileChangesSummaryCard", () => {
  it("多文件变更应按 Codex App 默认只显示前三项，并可展开和收起", () => {
    const { container } = renderCard({ aggregate: createLargeAggregate() });

    expect(container.textContent).toContain("已编辑 11 个文件");
    expect(container.textContent).toContain("再显示 8 个文件");
    expect(
      container.querySelectorAll(
        '[data-testid="file-changes-summary-file-row"]',
      ),
    ).toHaveLength(3);

    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="file-changes-summary-toggle"]',
    );
    act(() => {
      toggle?.click();
    });

    expect(container.textContent).toContain("收起");
    expect(
      container.querySelectorAll(
        '[data-testid="file-changes-summary-file-row"]',
      ),
    ).toHaveLength(11);
  });

  it("应使用真实 i18n 生成工作台变更审阅内容，且左卡隐藏绝对路径前缀", () => {
    const calls: Array<[string, string]> = [];
    const { container } = renderCard({
      onFileClick: (path, content) => {
        calls.push([path, content]);
      },
    });

    expect(container.textContent).toContain("已编辑 1 个文件");
    expect(container.textContent).toContain(
      ".lime/qc/code-runtime-fixture/src/greeting.ts",
    );
    expect(container.textContent).not.toContain("/workspace/projects/Demo");

    const reviewButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("查看变更"),
    );
    act(() => {
      reviewButton?.click();
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toContain(
      "/.lime/qc/code-runtime-fixture/src/greeting.ts",
    );
    expect(calls[0]?.[1]).toContain("变更审阅");
    expect(calls[0]?.[1]).toContain("状态：修改");
    expect(calls[0]?.[1]).toContain("+2 行");
    expect(calls[0]?.[1]).toContain("-1 行");
    expect(calls[0]?.[1]).toContain("+  return 'Hello Lime Runtime';");
    expect(calls[0]?.[1]).not.toContain("agentChat.toolCall.diffReview");
  });

  it("Move 变更应同时展示源路径和目标路径", () => {
    const aggregate = createAggregate();
    aggregate.files[0] = {
      ...aggregate.files[0]!,
      path: "src/source.ts",
      movePath: "src/destination.ts",
      fileStatus: "declined",
    };
    const { container } = renderCard({ aggregate });
    const row = container.querySelector(
      '[data-testid="file-changes-summary-file-row"]',
    );

    expect(row?.textContent).toContain("src/source.ts -> src/destination.ts");
    expect(row?.getAttribute("title")).toBe(
      "src/source.ts -> src/destination.ts",
    );
    expect(row?.getAttribute("data-file-status")).toBe("declined");
    expect(
      container
        .querySelector('[data-testid="file-changes-summary-card"]')
        ?.getAttribute("data-file-status"),
    ).toBe("declined");
  });

  it("传入 onOpenFile 时应显示打开文件入口且不生成 diff 审阅内容", () => {
    const onOpenFile = vi.fn();
    const onFileClick = vi.fn();
    const { container } = renderCard({ onFileClick, onOpenFile });

    expect(container.textContent).toContain("打开文件");
    expect(container.textContent).not.toContain("查看变更");

    const openButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("打开文件"),
    );
    act(() => {
      openButton?.click();
    });

    expect(onOpenFile).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.stringContaining("greeting.ts"),
      }),
    );
    expect(onFileClick).not.toHaveBeenCalled();
  });

  it("撤销应先确认，再调用真实恢复回调并展示成功状态", async () => {
    const onUndo = vi.fn().mockResolvedValue({ restoredCount: 1 });
    const { container } = renderCard({ onUndo });

    const undoButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("撤销"),
    ) as HTMLButtonElement | undefined;
    expect(undoButton?.disabled).toBe(false);

    act(() => {
      undoButton?.click();
    });

    expect(
      container.querySelector(
        '[data-testid="file-changes-summary-undo-confirmation"]',
      ),
    ).not.toBeNull();
    expect(onUndo).not.toHaveBeenCalled();

    const confirmButton = container.querySelector(
      '[data-testid="file-changes-summary-undo-confirm"]',
    ) as HTMLButtonElement | null;
    await act(async () => {
      confirmButton?.click();
    });

    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("已撤销 1 个文件改动");
  });

  it("撤销失败时应把结构化错误码翻译成用户可读文案", async () => {
    const onUndo = vi.fn().mockRejectedValue({
      code: "noMatchingCheckpoints",
    });
    const { container } = renderCard({ onUndo });

    const undoButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("撤销"),
    ) as HTMLButtonElement | undefined;
    act(() => {
      undoButton?.click();
    });

    const confirmButton = container.querySelector(
      '[data-testid="file-changes-summary-undo-confirm"]',
    ) as HTMLButtonElement | null;
    await act(async () => {
      confirmButton?.click();
    });

    expect(container.textContent).toContain("没有找到匹配的文件快照。");
    expect(container.textContent).not.toContain("noMatchingCheckpoints");
  });
});
