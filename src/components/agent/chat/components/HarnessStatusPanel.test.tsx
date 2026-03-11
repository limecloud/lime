import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HarnessStatusPanel } from "./HarnessStatusPanel";
import type { HarnessSessionState } from "../utils/harnessState";

const { mockToast } = vi.hoisted(() => ({
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: mockToast,
}));

interface RenderResult {
  container: HTMLDivElement;
  root: Root;
}

const mountedRoots: RenderResult[] = [];
let originalClipboard: Clipboard | undefined;

function createHarnessState(
  overrides: Partial<HarnessSessionState> = {},
): HarnessSessionState {
  return {
    pendingApprovals: [],
    latestContextTrace: [],
    plan: {
      phase: "idle",
      items: [],
    },
    activity: {
      planning: 0,
      filesystem: 1,
      execution: 0,
      web: 0,
      skills: 0,
      delegation: 0,
    },
    delegatedTasks: [],
    outputSignals: [],
    recentFileEvents: [],
    hasSignals: true,
    ...overrides,
  };
}

function renderPanel(
  overrides: Partial<ComponentProps<typeof HarnessStatusPanel>> = {},
): RenderResult {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <HarnessStatusPanel
        harnessState={createHarnessState()}
        subAgentRuntime={{
          isRunning: false,
          progress: null,
          events: [],
          result: null,
          error: null,
        }}
        environment={{
          skillsCount: 2,
          skillNames: ["read_file", "write_todos"],
          memorySignals: ["风格"],
          contextItemsCount: 2,
          activeContextCount: 1,
          contextItemNames: ["需求.md"],
          contextEnabled: true,
        }}
        {...overrides}
      />,
    );
  });

  const rendered = { container, root };
  mountedRoots.push(rendered);
  return rendered;
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  originalClipboard = navigator.clipboard;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  });
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
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: originalClipboard,
  });
  vi.clearAllMocks();
});

describe("HarnessStatusPanel", () => {
  it("摘要卡和快速导航应支持跳转到对应区块", () => {
    const scrollIntoViewMock = vi.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

    renderPanel({
      harnessState: createHarnessState({
        pendingApprovals: [
          {
            requestId: "approval-1",
            actionType: "tool_confirmation",
            prompt: "确认写入",
          },
        ],
        recentFileEvents: [
          {
            id: "event-nav-1",
            toolCallId: "tool-nav-1",
            path: "/tmp/workspace/nav.md",
            displayName: "nav.md",
            kind: "document",
            action: "write",
            sourceToolName: "Write",
            timestamp: new Date("2026-03-11T12:00:00.000Z"),
            preview: "导航预览",
            clickable: true,
          },
        ],
      }),
    });

    const summaryJumpButton = document.body.querySelector(
      'button[aria-label="跳转到待审批"]',
    ) as HTMLButtonElement | null;

    act(() => {
      summaryJumpButton?.click();
    });

    expect(scrollIntoViewMock).toHaveBeenCalled();

    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  });

  it("应渲染最近文件活动区块", () => {
    renderPanel({
      harnessState: createHarnessState({
        recentFileEvents: [
          {
            id: "event-1",
            toolCallId: "tool-1",
            path: "/tmp/workspace/draft.md",
            displayName: "draft.md",
            kind: "document",
            action: "write",
            sourceToolName: "Write",
            timestamp: new Date("2026-03-11T12:00:00.000Z"),
            preview: "# 草稿\n这是预览",
            clickable: true,
          },
        ],
      }),
    });

    expect(document.body.textContent).toContain("最近文件活动");
    expect(document.body.textContent).toContain("draft.md");
    expect(document.body.textContent).toContain("写入");
    expect(document.body.textContent).toContain("这是预览");
  });

  it("点击文件活动后应加载并展示预览内容", async () => {
    const onLoadFilePreview = vi.fn().mockResolvedValue({
      path: "/tmp/workspace/draft.md",
      content: "# 标题\n正文内容",
      isBinary: false,
      size: 18,
      error: null,
    });
    const onOpenFile = vi.fn();

    renderPanel({
      harnessState: createHarnessState({
        recentFileEvents: [
          {
            id: "event-2",
            toolCallId: "tool-2",
            path: "/tmp/workspace/draft.md",
            displayName: "draft.md",
            kind: "document",
            action: "read",
            sourceToolName: "Read",
            timestamp: new Date("2026-03-11T12:01:00.000Z"),
            preview: "摘要预览",
            clickable: true,
          },
        ],
      }),
      onLoadFilePreview,
      onOpenFile,
    });

    const trigger = document.body.querySelector(
      'button[aria-label="查看文件活动：draft.md"]',
    ) as HTMLButtonElement | null;

    await act(async () => {
      trigger?.click();
      await Promise.resolve();
    });

    expect(onLoadFilePreview).toHaveBeenCalledWith("/tmp/workspace/draft.md");
    expect(document.body.textContent).toContain("# 标题");
    expect(document.body.textContent).toContain("正文内容");

    const openInChatButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("在会话中打开"));

    act(() => {
      openInChatButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(onOpenFile).toHaveBeenCalledWith(
      "/tmp/workspace/draft.md",
      "# 标题\n正文内容",
    );
  });

  it("应支持按类型筛选最近文件活动", () => {
    renderPanel({
      harnessState: createHarnessState({
        recentFileEvents: [
          {
            id: "event-filter-doc",
            toolCallId: "tool-filter-doc",
            path: "/tmp/workspace/spec.md",
            displayName: "spec.md",
            kind: "document",
            action: "write",
            sourceToolName: "Write",
            timestamp: new Date("2026-03-11T12:10:00.000Z"),
            preview: "需求说明",
            clickable: true,
          },
          {
            id: "event-filter-code",
            toolCallId: "tool-filter-code",
            path: "/tmp/workspace/app.ts",
            displayName: "app.ts",
            kind: "code",
            action: "edit",
            sourceToolName: "Edit",
            timestamp: new Date("2026-03-11T12:11:00.000Z"),
            preview: "const app = true;",
            clickable: true,
          },
          {
            id: "event-filter-log",
            toolCallId: "tool-filter-log",
            path: "/tmp/workspace/run.log",
            displayName: "run.log",
            kind: "log",
            action: "persist",
            sourceToolName: "Execute",
            timestamp: new Date("2026-03-11T12:12:00.000Z"),
            preview: "执行完成",
            clickable: true,
          },
        ],
      }),
    });

    const codeFilterButton = document.body.querySelector(
      'button[aria-label="文件活动筛选：代码"]',
    ) as HTMLButtonElement | null;

    act(() => {
      codeFilterButton?.click();
    });

    const fileSection = document.body.querySelector(
      '[data-harness-section="files"]',
    ) as HTMLElement | null;

    expect(fileSection?.textContent).toContain("app.ts");
    expect(fileSection?.textContent).not.toContain("spec.md");
    expect(fileSection?.textContent).not.toContain("run.log");
    expect(fileSection?.textContent).toContain("1 / 3 条");
  });

  it("应支持按文件聚合最近文件活动", () => {
    renderPanel({
      harnessState: createHarnessState({
        recentFileEvents: [
          {
            id: "event-group-1",
            toolCallId: "tool-group-1",
            path: "/tmp/workspace/draft.md",
            displayName: "draft.md",
            kind: "document",
            action: "write",
            sourceToolName: "Write",
            timestamp: new Date("2026-03-11T12:20:00.000Z"),
            preview: "第一版",
            clickable: true,
          },
          {
            id: "event-group-2",
            toolCallId: "tool-group-2",
            path: "/tmp/workspace/draft.md",
            displayName: "draft.md",
            kind: "document",
            action: "edit",
            sourceToolName: "Edit",
            timestamp: new Date("2026-03-11T12:21:00.000Z"),
            preview: "第二版",
            clickable: true,
          },
          {
            id: "event-group-3",
            toolCallId: "tool-group-3",
            path: "/tmp/workspace/notes.md",
            displayName: "notes.md",
            kind: "document",
            action: "read",
            sourceToolName: "Read",
            timestamp: new Date("2026-03-11T12:22:00.000Z"),
            preview: "笔记",
            clickable: true,
          },
        ],
      }),
    });

    const groupedViewButton = document.body.querySelector(
      'button[aria-label="文件视图：按文件"]',
    ) as HTMLButtonElement | null;

    act(() => {
      groupedViewButton?.click();
    });

    const fileSection = document.body.querySelector(
      '[data-harness-section="files"]',
    ) as HTMLElement | null;
    const groupedCards = document.body.querySelectorAll(
      'button[aria-label^="查看聚合文件活动："]',
    );

    expect(groupedCards).toHaveLength(2);
    expect(fileSection?.textContent).toContain("2 个文件 / 3 条");
    expect(fileSection?.textContent).toContain("draft.md");
    expect(fileSection?.textContent).toContain("2 次活动");
    expect(fileSection?.textContent).toContain("写入 1");
    expect(fileSection?.textContent).toContain("编辑 1");
  });

  it("应支持按类型筛选工具输出", () => {
    renderPanel({
      harnessState: createHarnessState({
        outputSignals: [
          {
            id: "signal-path",
            toolCallId: "tool-path",
            toolName: "read_file",
            title: "读取结果",
            summary: "返回了输出文件",
            outputFile: "/tmp/workspace/output.txt",
          },
          {
            id: "signal-offload",
            toolCallId: "tool-offload",
            toolName: "write_file",
            title: "大结果转存",
            summary: "内容已转存",
            offloadFile: "/tmp/workspace/offload/result.md",
            offloaded: true,
          },
          {
            id: "signal-summary",
            toolCallId: "tool-summary",
            toolName: "execute",
            title: "执行摘要",
            summary: "仅保留摘要",
            preview: "最后 10 行输出",
          },
          {
            id: "signal-truncated",
            toolCallId: "tool-truncated",
            toolName: "execute",
            title: "截断输出",
            summary: "输出过长已截断",
            truncated: true,
          },
        ],
      }),
    });

    const summaryFilterButton = document.body.querySelector(
      'button[aria-label="工具输出筛选：仅摘要"]',
    ) as HTMLButtonElement | null;

    act(() => {
      summaryFilterButton?.click();
    });

    const outputSection = document.body.querySelector(
      '[data-harness-section="outputs"]',
    ) as HTMLElement | null;

    expect(outputSection?.textContent).toContain("执行摘要");
    expect(outputSection?.textContent).not.toContain("读取结果");
    expect(outputSection?.textContent).not.toContain("大结果转存");
    expect(outputSection?.textContent).not.toContain("截断输出");
    expect(outputSection?.textContent).toContain("1 / 4 条");
  });

  it("预览弹窗应支持复制路径和系统文件操作", async () => {
    const onLoadFilePreview = vi.fn().mockResolvedValue({
      path: "/tmp/workspace/draft.md",
      content: "# 标题\n正文内容",
      isBinary: false,
      size: 18,
      error: null,
    });
    const onRevealPath = vi.fn().mockResolvedValue(undefined);
    const onOpenPath = vi.fn().mockResolvedValue(undefined);

    renderPanel({
      harnessState: createHarnessState({
        recentFileEvents: [
          {
            id: "event-3",
            toolCallId: "tool-3",
            path: "/tmp/workspace/draft.md",
            displayName: "draft.md",
            kind: "document",
            action: "read",
            sourceToolName: "Read",
            timestamp: new Date("2026-03-11T12:02:00.000Z"),
            preview: "摘要预览",
            clickable: true,
          },
        ],
      }),
      onLoadFilePreview,
      onRevealPath,
      onOpenPath,
    });

    const trigger = document.body.querySelector(
      'button[aria-label="查看文件活动：draft.md"]',
    ) as HTMLButtonElement | null;

    await act(async () => {
      trigger?.click();
      await Promise.resolve();
    });

    const copyPathButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("复制路径"));
    const revealButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("定位文件"),
    );
    const openPathButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("系统打开"));

    await act(async () => {
      copyPathButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      revealButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      openPathButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "/tmp/workspace/draft.md",
    );
    expect(onRevealPath).toHaveBeenCalledWith("/tmp/workspace/draft.md");
    expect(onOpenPath).toHaveBeenCalledWith("/tmp/workspace/draft.md");
  });
});
