import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GeneralWorkbenchSidebar } from "./GeneralWorkbenchSidebar";
import {
  recordCuratedTaskRecommendationSignal,
  recordCuratedTaskRecommendationSignalFromReviewDecision,
} from "../utils/curatedTaskRecommendationSignals";

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];
const mockWriteClipboardText = vi.fn();
const {
  mockRevealSessionFileInFinder,
  mockOpenSessionFileWithDefaultApp,
  mockToastError,
  mockToastSuccess,
  mockOpenDialog,
} = vi.hoisted(() => ({
  mockRevealSessionFileInFinder: vi.fn(),
  mockOpenSessionFileWithDefaultApp: vi.fn(),
  mockToastError: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockOpenDialog: vi.fn(),
}));

vi.mock("@/lib/api/session-files", () => ({
  revealFileInFinder: mockRevealSessionFileInFinder,
  openFileWithDefaultApp: mockOpenSessionFileWithDefaultApp,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: mockOpenDialog,
}));

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("sonner", () => ({
  toast: {
    error: mockToastError,
    success: mockToastSuccess,
  },
}));

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  if (!HTMLElement.prototype.scrollIntoView) {
    HTMLElement.prototype.scrollIntoView = () => {};
  }

  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: mockWriteClipboardText,
    },
  });
  mockWriteClipboardText.mockResolvedValue(undefined);
  mockRevealSessionFileInFinder.mockResolvedValue(undefined);
  mockOpenSessionFileWithDefaultApp.mockResolvedValue(undefined);
  mockOpenDialog.mockResolvedValue(null);
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
  window.localStorage.clear();
});

function renderSidebar(
  props?: Partial<React.ComponentProps<typeof GeneralWorkbenchSidebar>>,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const defaultProps: React.ComponentProps<typeof GeneralWorkbenchSidebar> = {
    onNewTopic: vi.fn(),
    onSwitchTopic: vi.fn(),
    onDeleteTopic: vi.fn(),
    branchItems: [
      {
        id: "topic-a",
        title: "话题 A",
        status: "in_progress",
        isCurrent: true,
      },
    ],
    onSetBranchStatus: vi.fn(),
    workflowSteps: [
      { id: "brief", title: "明确需求", status: "completed" },
      { id: "create", title: "创作内容", status: "active" },
    ],
    contextSearchQuery: "品牌",
    onContextSearchQueryChange: vi.fn(),
    contextSearchMode: "web",
    onContextSearchModeChange: vi.fn(),
    contextSearchLoading: false,
    contextSearchError: null,
    onSubmitContextSearch: vi.fn(),
    contextItems: [
      {
        id: "search:web:brand",
        name: "品牌话题观察",
        source: "search",
        searchMode: "web",
        query: "品牌 2026",
        previewText: "品牌讨论聚焦产品定位、渠道节奏与转化质量。",
        citations: [{ title: "官方博客", url: "https://example.com/blog" }],
        active: true,
      },
    ],
    onToggleContextActive: vi.fn(),
    contextBudget: {
      activeCount: 1,
      activeCountLimit: 12,
      estimatedTokens: 600,
      tokenLimit: 32000,
    },
    activityLogs: [
      {
        id: "log-1",
        name: "content_post_with_cover",
        status: "completed",
        timeLabel: "10:30",
        applyTarget: "封面/插图",
        contextIds: ["material:1"],
        gateKey: "write_mode",
        runId: "run-abcdef123456",
        source: "skill",
        sourceRef: "content_post_with_cover",
      },
    ],
    skillDetailMap: {
      content_post_with_cover: {
        name: "content_post_with_cover",
        display_name: "社媒主稿与封面",
        description: "生成内容主稿，并补齐封面素材。",
        execution_mode: "prompt",
        has_workflow: true,
        workflow_steps: [
          {
            id: "outline",
            name: "提炼内容主线",
            dependencies: [],
          },
          {
            id: "cover",
            name: "生成封面提示词",
            dependencies: ["outline"],
          },
        ],
        allowed_tools: ["read_file", "generate_image"],
        when_to_use: "适合需要主稿与封面同时产出的社媒场景。",
        markdown_content: "",
      },
    },
    onViewRunDetail: vi.fn(),
    activeRunDetail: null,
    activeRunDetailLoading: false,
  };

  act(() => {
    root.render(<GeneralWorkbenchSidebar {...defaultProps} {...props} />);
  });

  mountedRoots.push({ root, container });
  return { container, props: { ...defaultProps, ...props } };
}

describe("GeneralWorkbenchSidebar", () => {
  it("当前进展面板应突出当前任务并按状态优先级排序", () => {
    const { container } = renderSidebar({
      workflowSteps: [
        { id: "done", title: "完成提纲", status: "completed" },
        { id: "pending", title: "等待补充案例", status: "pending" },
        { id: "active", title: "撰写主稿", status: "active" },
        { id: "error", title: "封面生成失败", status: "error" },
      ],
    });

    const workflowTab = container.querySelector(
      'button[aria-label="打开当前进展"]',
    ) as HTMLButtonElement | null;
    expect(workflowTab).toBeTruthy();
    expect(workflowTab?.textContent).toContain("进展");
    if (workflowTab) {
      act(() => {
        workflowTab.click();
      });
    }

    expect(container.textContent).toContain("生成工作台");
    expect(container.textContent).toContain("聚焦当前结果、下一步与可继续的版本。");
    expect(container.textContent).toContain("当前进展");
    expect(container.textContent).toContain("当前焦点");
    expect(container.textContent).toContain("撰写主稿");
    expect(container.textContent).toContain("后续任务");
    expect(container.textContent).toContain("已完成 1/4");
    expect(container.textContent).toContain("已完成 1 项");
    expect(container.textContent).toContain("结果去向");
    expect(container.textContent).toContain("产出记录 / 执行经过");
    expect(container.textContent).toContain("继续上次做法");
    expect(container.textContent).toMatch(/可继续稿件|可继续版本/);

    const stepNodes = Array.from(
      container.querySelectorAll('[data-testid="workflow-sidebar-step"]'),
    );
    const taskSection = container.querySelector(
      '[data-testid="workflow-sidebar-task-section"]',
    ) as HTMLElement | null;
    const branchSection = container.querySelector(
      '[data-testid="workflow-sidebar-branch-section"]',
    ) as HTMLElement | null;

    expect(stepNodes).toHaveLength(2);
    expect(stepNodes.map((node) => node.getAttribute("data-status"))).toEqual([
      "error",
      "pending",
    ]);
    expect(taskSection).toBeTruthy();
    expect(branchSection).toBeTruthy();
    expect(taskSection?.textContent).toContain("当前焦点");
    expect(taskSection?.textContent).toContain("后续任务");
    expect(
      taskSection?.querySelector(
        '[data-testid="workflow-sidebar-result-destination-hint"]',
      ),
    ).toBeTruthy();
    const taskSectionOrder =
      taskSection && branchSection
        ? taskSection.compareDocumentPosition(branchSection) &
          Node.DOCUMENT_POSITION_FOLLOWING
        : 0;
    expect(
      taskSectionOrder,
    ).toBeTruthy();
  });

  it("传入折叠回调时应显示折叠按钮并可触发", () => {
    const onRequestCollapse = vi.fn();
    const { container } = renderSidebar({ onRequestCollapse });

    const collapseButton = container.querySelector(
      'button[aria-label="折叠上下文侧栏"]',
    ) as HTMLButtonElement | null;
    expect(collapseButton).toBeTruthy();
    if (collapseButton) {
      act(() => {
        collapseButton.click();
      });
    }
    expect(onRequestCollapse).toHaveBeenCalledTimes(1);
  });

  it("点击添加上下文应打开添加弹窗", () => {
    const { container } = renderSidebar();

    const addContextButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("添加上下文"));
    expect(addContextButton).toBeTruthy();
    if (addContextButton) {
      act(() => {
        addContextButton.click();
      });
    }

    expect(container.textContent).toContain("添加新上下文");
    expect(container.textContent).toContain("上传文件");
    expect(container.textContent).toContain("网站链接");
    expect(container.textContent).toContain("输入文本");
  });

  it("输入文本上下文后确认应触发回调", async () => {
    const onAddTextContext = vi.fn().mockResolvedValue(undefined);
    const { container } = renderSidebar({ onAddTextContext });

    const addContextButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("添加上下文"));
    expect(addContextButton).toBeTruthy();
    if (addContextButton) {
      act(() => {
        addContextButton.click();
      });
    }

    const textButton = container.querySelector(
      'button[aria-label="输入文本上下文"]',
    ) as HTMLButtonElement | null;
    expect(textButton).toBeTruthy();
    if (textButton) {
      act(() => {
        textButton.click();
      });
    }

    const textarea = container.querySelector(
      'textarea[placeholder="在此粘贴或输入文本..."]',
    ) as HTMLTextAreaElement | null;
    expect(textarea).toBeTruthy();
    if (textarea) {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      act(() => {
        setter?.call(textarea, "这是一段用于测试的上下文内容");
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }

    const confirmButton = container.querySelector(
      'button[aria-label="确认添加文本上下文"]',
    ) as HTMLButtonElement | null;
    await act(async () => {
      await Promise.resolve();
    });
    if (confirmButton) {
      await act(async () => {
        confirmButton.click();
        await Promise.resolve();
      });
    }

    expect(onAddTextContext).toHaveBeenCalledTimes(1);
    expect(onAddTextContext).toHaveBeenCalledWith({
      content: "这是一段用于测试的上下文内容",
    });
  });

  it("应展示新的双 tab 与紧凑上下文列表结构", () => {
    const { container } = renderSidebar();
    const shell = container.querySelector(
      '[data-testid="general-workbench-sidebar"]',
    ) as HTMLElement | null;
    const header = container.querySelector(
      '[data-testid="general-workbench-sidebar-header"]',
    ) as HTMLElement | null;
    const tabs = container.querySelector(
      '[data-testid="general-workbench-sidebar-tabs"]',
    ) as HTMLElement | null;

    expect(container.textContent).toContain("上下文管理");
    expect(
      container.querySelector('button[aria-label="打开上下文管理"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('button[aria-label="打开当前进展"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('button[aria-label="打开执行日志"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("搜索上下文");
    expect(container.textContent).toContain("上下文列表");
    expect(container.textContent).not.toContain("上下文概览");
    expect(container.textContent).not.toContain("项目资料");
    expect(shell?.className).toContain("bg-slate-50");
    expect(shell?.className).not.toContain("linear-gradient");
    expect(header?.className).toContain("bg-white");
    expect(header?.className).not.toContain("backdrop-blur");
    expect(tabs?.className).toContain("bg-slate-100");
  });

  it("应展示新的搜索上下文输入区", () => {
    const { container } = renderSidebar();
    expect(container.textContent).toContain("添加上下文");

    const searchInput = container.querySelector(
      'input[placeholder="搜索网络添加新上下文"]',
    ) as HTMLInputElement | null;
    expect(searchInput).toBeTruthy();
    expect(searchInput?.value).toBe("品牌");
  });

  it("日志存在更多历史时应显示加载按钮并可触发", () => {
    const onLoadMoreHistory = vi.fn();
    const { container } = renderSidebar({
      historyHasMore: true,
      onLoadMoreHistory,
    });

    const logTabButton = container.querySelector(
      'button[aria-label="打开执行日志"]',
    ) as HTMLButtonElement | null;
    expect(logTabButton).toBeTruthy();
    if (logTabButton) {
      act(() => {
        logTabButton.click();
      });
    }

    const loadMoreButton = container.querySelector(
      'button[aria-label="加载更早历史日志"]',
    ) as HTMLButtonElement | null;
    expect(loadMoreButton).toBeTruthy();
    if (loadMoreButton) {
      act(() => {
        loadMoreButton.click();
      });
    }

    expect(onLoadMoreHistory).toHaveBeenCalledTimes(1);
  });

  it("执行日志应展示技能显示名与技能描述", () => {
    const { container } = renderSidebar();

    const logTabButton = container.querySelector(
      'button[aria-label="打开执行日志"]',
    ) as HTMLButtonElement | null;
    expect(logTabButton).toBeTruthy();
    if (logTabButton) {
      act(() => {
        logTabButton.click();
      });
    }

    expect(container.textContent).toContain("技能：社媒主稿与封面");
    expect(container.textContent).toContain("生成内容主稿，并补齐封面素材。");
    expect(container.textContent).toContain(
      "技能标识：content_post_with_cover",
    );
  });

  it("执行日志应支持展开技能详情", () => {
    const { container } = renderSidebar();

    const logTabButton = container.querySelector(
      'button[aria-label="打开执行日志"]',
    ) as HTMLButtonElement | null;
    expect(logTabButton).toBeTruthy();
    if (logTabButton) {
      act(() => {
        logTabButton.click();
      });
    }

    const detailButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("查看技能详情"),
    );
    expect(detailButton).toBeTruthy();
    if (detailButton) {
      act(() => {
        detailButton.click();
      });
    }

    expect(container.textContent).toContain("工作流步骤");
    expect(container.textContent).toContain("1. 提炼内容主线");
    expect(container.textContent).toContain("2. 生成封面提示词");
    expect(container.textContent).toContain("允许工具");
    expect(container.textContent).toContain("查看文件");
    expect(container.textContent).toContain("图片生成");
    expect(container.textContent).toContain("适用场景");
    expect(container.textContent).toContain(
      "适合需要主稿与封面同时产出的社媒场景。",
    );
  });

  it("执行日志应支持展开工具详情", () => {
    const { container } = renderSidebar({
      messages: [
        {
          id: "assistant-tool-detail",
          role: "assistant",
          content: "",
          timestamp: new Date("2026-03-12T10:35:00.000Z"),
          toolCalls: [
            {
              id: "tool-detail-1",
              name: "read_file",
              arguments: JSON.stringify({ path: "/tmp/a.txt", limit: 50 }),
              status: "failed",
              result: {
                success: false,
                output: "",
                error: "文件不存在",
              },
              startTime: new Date("2026-03-12T10:35:00.000Z"),
            },
          ],
        },
      ],
    });

    const logTabButton = container.querySelector(
      'button[aria-label="打开执行日志"]',
    ) as HTMLButtonElement | null;
    expect(logTabButton).toBeTruthy();
    if (logTabButton) {
      act(() => {
        logTabButton.click();
      });
    }

    const detailButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("查看工具详情"),
    );
    expect(detailButton).toBeTruthy();
    if (detailButton) {
      act(() => {
        detailButton.click();
      });
    }

    expect(container.textContent).toContain("请求参数");
    expect(container.textContent).toContain('"path": "/tmp/a.txt"');
    expect(container.textContent).toContain('"limit": 50');
    expect(container.textContent).toContain("错误信息");
    expect(container.textContent).toContain("文件不存在");
  });

  it("执行日志应支持清空全部记录", () => {
    const { container } = renderSidebar();

    const logTabButton = container.querySelector(
      'button[aria-label="打开执行日志"]',
    ) as HTMLButtonElement | null;
    expect(logTabButton).toBeTruthy();
    if (logTabButton) {
      act(() => {
        logTabButton.click();
      });
    }

    const clearButton = container.querySelector(
      'button[aria-label="清空全部日志"]',
    ) as HTMLButtonElement | null;
    expect(clearButton).toBeTruthy();
    if (clearButton) {
      act(() => {
        clearButton.click();
      });
    }

    expect(container.textContent).toContain("日志已清空，等待新的运行记录");
    expect(container.textContent).not.toContain("执行技能 社媒主稿与封面");
  });

  it("执行日志应支持按失败项筛选", () => {
    const { container } = renderSidebar({
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          content: "",
          timestamp: new Date("2026-03-12T10:32:00.000Z"),
          toolCalls: [
            {
              id: "tool-1",
              name: "read_file",
              arguments: JSON.stringify({ path: "/tmp/a.txt" }),
              status: "failed",
              result: {
                success: false,
                output: "",
                error: "文件不存在",
              },
              startTime: new Date("2026-03-12T10:32:00.000Z"),
            },
          ],
        },
      ],
    });

    const logTabButton = container.querySelector(
      'button[aria-label="打开执行日志"]',
    ) as HTMLButtonElement | null;
    expect(logTabButton).toBeTruthy();
    if (logTabButton) {
      act(() => {
        logTabButton.click();
      });
    }

    const failedFilterButton = container.querySelector(
      'button[aria-label="筛选执行日志-失败"]',
    ) as HTMLButtonElement | null;
    expect(failedFilterButton).toBeTruthy();
    if (failedFilterButton) {
      act(() => {
        failedFilterButton.click();
      });
    }

    expect(container.textContent).toContain("查看文件");
    expect(container.textContent).toContain("文件不存在");
    expect(container.textContent).not.toContain("执行技能 社媒主稿与封面");
  });

  it("执行日志应复用工具展示语义而不是使用旧标签映射", () => {
    const { container } = renderSidebar({
      activityLogs: [],
      skillDetailMap: {},
      messages: [
        {
          id: "assistant-tool-labels",
          role: "assistant",
          content: "",
          timestamp: new Date("2026-03-12T10:40:00.000Z"),
          toolCalls: [
            {
              id: "tool-browser-1",
              name: "mcp__lime-browser__browser_navigate",
              arguments: JSON.stringify({ url: "https://example.com/docs" }),
              status: "completed",
              result: {
                success: true,
                output: "ok",
              },
              startTime: new Date("2026-03-12T10:40:00.000Z"),
            },
            {
              id: "tool-task-output-1",
              name: "TaskOutput",
              arguments: JSON.stringify({ task_id: "video-task-1" }),
              status: "completed",
              result: {
                success: true,
                output: "done",
              },
              startTime: new Date("2026-03-12T10:40:01.000Z"),
            },
            {
              id: "tool-input-1",
              name: "AskUserQuestion",
              arguments: JSON.stringify({ question: "需要继续吗？" }),
              status: "running",
              startTime: new Date("2026-03-12T10:40:02.000Z"),
            },
          ],
        },
      ],
    });

    const logTabButton = container.querySelector(
      'button[aria-label="打开执行日志"]',
    ) as HTMLButtonElement | null;
    expect(logTabButton).toBeTruthy();
    if (logTabButton) {
      act(() => {
        logTabButton.click();
      });
    }

    expect(container.textContent).toContain("页面打开");
    expect(container.textContent).toContain("查看任务结果");
    expect(container.textContent).toContain("用户确认");
    expect(container.textContent).not.toContain("网络检索");
    expect(container.textContent).not.toContain("执行命令");
  });

  it("应支持触发上下文搜索与切换来源", () => {
    const onSubmitContextSearch = vi.fn();
    const onContextSearchModeChange = vi.fn();
    const { container } = renderSidebar({
      onSubmitContextSearch,
      onContextSearchModeChange,
    });

    const submitButton = container.querySelector(
      'button[aria-label="提交上下文搜索"]',
    ) as HTMLButtonElement | null;
    expect(submitButton).toBeTruthy();
    if (submitButton) {
      act(() => {
        submitButton.click();
      });
    }
    expect(onSubmitContextSearch).toHaveBeenCalledTimes(1);

    const triggerButton = container.querySelector(
      'button[aria-label="选择上下文搜索来源"]',
    ) as HTMLButtonElement | null;
    expect(triggerButton).toBeTruthy();
    if (triggerButton) {
      act(() => {
        triggerButton.click();
      });
    }

    const socialMenuText = Array.from(container.querySelectorAll("span")).find(
      (node) => node.textContent === "社交媒体",
    );
    const socialMenuItem = socialMenuText?.closest("div");
    expect(socialMenuItem).toBeTruthy();
    if (socialMenuItem) {
      act(() => {
        socialMenuItem.click();
      });
    }

    expect(onContextSearchModeChange).toHaveBeenCalledWith("social");
  });

  it("应按标题列表展示搜索结果，并支持进入详情查看来源", () => {
    const { container } = renderSidebar();

    expect(container.textContent).toContain("上下文列表");
    expect(container.textContent).toContain("品牌话题观察");
    expect(container.textContent).not.toContain("检索词：品牌 2026");
    expect(container.textContent).not.toContain("品牌讨论聚焦产品定位");
    expect((container.textContent?.match(/品牌话题观察/g) || []).length).toBe(
      1,
    );

    const openButton = container.querySelector(
      'button[aria-label="查看搜索结果 品牌话题观察"]',
    ) as HTMLButtonElement | null;
    expect(openButton).toBeTruthy();
    if (openButton) {
      act(() => {
        openButton.click();
      });
    }

    expect(container.textContent).toContain("搜索结果详情");
    expect(container.textContent).toContain("检索词：品牌 2026");
    expect(container.textContent).toContain("品牌讨论聚焦产品定位");

    const citationLink = container.querySelector(
      'a[href="https://example.com/blog"]',
    ) as HTMLAnchorElement | null;
    expect(citationLink).toBeTruthy();

    const backButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("返回列表"),
    );
    expect(backButton).toBeTruthy();
    if (backButton) {
      act(() => {
        backButton.click();
      });
    }

    expect(container.textContent).toContain("搜索结果");
    expect(container.textContent).not.toContain("检索词：品牌 2026");
  });

  it("搜索被阻塞时应展示原因并禁用提交", () => {
    const { container } = renderSidebar({
      contextSearchQuery: "品牌",
      contextSearchBlockedReason: "请先选择可用模型后再搜索",
    });

    expect(container.textContent).toContain("请先选择可用模型后再搜索");
    const submitButton = container.querySelector(
      'button[aria-label="提交上下文搜索"]',
    ) as HTMLButtonElement | null;
    expect(submitButton?.disabled).toBe(true);
  });

  it("应支持分支状态操作", () => {
    const onSetBranchStatus = vi.fn();
    const { container } = renderSidebar({
      branchMode: "topic",
      onSetBranchStatus,
    });

    const workflowTab = container.querySelector(
      'button[aria-label="打开当前进展"]',
    ) as HTMLButtonElement | null;
    if (workflowTab) {
      act(() => {
        workflowTab.click();
      });
    }

    expect(container.querySelector("button[aria-label='切换可继续记录']")).toBeTruthy();
    expect(container.querySelector("button[aria-label='删除分支']")).toBeNull();
    expect(container.textContent).toContain("当前焦点落在");

    const branchToggle = container.querySelector(
      "button[aria-label='切换可继续记录']",
    ) as HTMLButtonElement | null;
    if (branchToggle) {
      act(() => {
        branchToggle.click();
      });
    }

    const mergeButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "收进主稿",
    );
    expect(mergeButton).toBeTruthy();
    if (mergeButton) {
      act(() => {
        mergeButton.click();
      });
    }
    expect(onSetBranchStatus).toHaveBeenCalledWith("topic-a", "merged");
  });

  it("版本模式应展示可继续版本语义", () => {
    const onSetBranchStatus = vi.fn();
    const { container } = renderSidebar({
      branchMode: "version",
      onSetBranchStatus,
    });

    const workflowTab = container.querySelector(
      'button[aria-label="打开当前进展"]',
    ) as HTMLButtonElement | null;
    if (workflowTab) {
      act(() => {
        workflowTab.click();
      });
    }

    expect(container.textContent).toContain("可继续版本");
    expect(container.textContent).toContain("留一版");
    expect(container.textContent).toContain("当前焦点落在");

    const branchToggle = container.querySelector(
      "button[aria-label='切换可继续记录']",
    ) as HTMLButtonElement | null;
    if (branchToggle) {
      act(() => {
        branchToggle.click();
      });
    }

    const setMainButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "设为主稿",
    );
    expect(setMainButton).toBeTruthy();
    if (setMainButton) {
      act(() => {
        setMainButton.click();
      });
    }
    expect(onSetBranchStatus).toHaveBeenCalledWith("topic-a", "merged");
    expect(container.querySelector("button[aria-label='删除分支']")).toBeNull();
  });

  it("活动日志应展示后端闸门与运行标识", () => {
    const { container } = renderSidebar();
    const workflowTab = container.querySelector(
      'button[aria-label="打开当前进展"]',
    ) as HTMLButtonElement | null;
    if (workflowTab) {
      act(() => {
        workflowTab.click();
      });
    }

    expect(container.textContent).toContain("最近一组：content_post_with_cover");

    const activityToggle = container.querySelector(
      "button[aria-label='切换执行经过']",
    ) as HTMLButtonElement | null;
    if (activityToggle) {
      act(() => {
        activityToggle.click();
      });
    }

    expect(container.textContent).toContain("执行经过");
    expect(container.textContent).toContain("写作闸门");
    expect(container.textContent).toContain("技能");
    expect(container.textContent).toContain("查看运行 run-abcd…");
  });

  it("活动日志应按运行维度分组展示步骤", () => {
    const { container } = renderSidebar({
      activityLogs: [
        {
          id: "log-run-1",
          name: "research_topic",
          status: "completed",
          timeLabel: "10:20",
          applyTarget: "主稿内容",
          contextIds: ["material:1"],
          runId: "rungrp01",
          gateKey: "topic_select",
          source: "skill",
          artifactPaths: ["content-posts/research.md"],
          inputSummary: '{"topic":"AI"}',
          outputSummary: "已完成选题调研",
        },
        {
          id: "log-run-2",
          name: "write_file",
          status: "completed",
          timeLabel: "10:21",
          applyTarget: "主稿内容",
          contextIds: ["material:1", "content:2"],
          runId: "rungrp01",
          gateKey: "write_mode",
          source: "tool",
        },
      ],
    });

    const workflowTab = container.querySelector(
      'button[aria-label="打开当前进展"]',
    ) as HTMLButtonElement | null;
    if (workflowTab) {
      act(() => {
        workflowTab.click();
      });
    }
    expect(container.textContent).toContain("最近一组：research_topic");

    const activityToggle = container.querySelector(
      "button[aria-label='切换执行经过']",
    ) as HTMLButtonElement | null;
    if (activityToggle) {
      act(() => {
        activityToggle.click();
      });
    }

    expect(container.textContent).toContain("research_topic");
    expect(container.textContent).toContain("write_file");
    expect(container.textContent).toContain("技能");
    expect(container.textContent).toContain("content-posts/research.md");
    expect(container.textContent).toContain('{"topic":"AI"}');
    expect(container.textContent).toContain("已完成选题调研");
    expect(
      container.querySelector(
        'button[aria-label="定位活动产物路径-content-posts/research.md"]',
      ),
    ).toBeNull();
    const runButtons = Array.from(container.querySelectorAll("button")).filter(
      (button) => button.textContent === "查看运行 rungrp01",
    );
    expect(runButtons.length).toBe(1);
  });

  it("点击运行标识应触发详情回调", () => {
    const onViewRunDetail = vi.fn();
    const { container } = renderSidebar({ onViewRunDetail });
    const workflowTab = container.querySelector(
      'button[aria-label="打开当前进展"]',
    ) as HTMLButtonElement | null;
    if (workflowTab) {
      act(() => {
        workflowTab.click();
      });
    }

    const activityToggle = container.querySelector(
      "button[aria-label='切换执行经过']",
    ) as HTMLButtonElement | null;
    if (activityToggle) {
      act(() => {
        activityToggle.click();
      });
    }

    const runButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("查看运行 run-abcd…"),
    );
    expect(runButton).toBeTruthy();
    if (runButton) {
      act(() => {
        runButton.click();
      });
    }

    expect(onViewRunDetail).toHaveBeenCalledWith("run-abcdef123456");
  });

  it("有选中运行详情时应展示详情卡片", () => {
    const { container } = renderSidebar({
      activeRunDetail: {
        id: "run-detail-1",
        source: "skill",
        source_ref: "content_post_with_cover",
        session_id: "session-1",
        status: "running",
        started_at: "2026-03-06T01:02:03Z",
        finished_at: null,
        duration_ms: null,
        error_code: null,
        error_message: null,
        metadata: JSON.stringify({ gate_key: "write_mode" }),
        created_at: "2026-03-06T01:02:03Z",
        updated_at: "2026-03-06T01:02:04Z",
      },
    });

    const workflowTab = container.querySelector(
      'button[aria-label="打开当前进展"]',
    ) as HTMLButtonElement | null;
    if (workflowTab) {
      act(() => {
        workflowTab.click();
      });
    }

    const activityToggle = container.querySelector(
      "button[aria-label='切换执行经过']",
    ) as HTMLButtonElement | null;
    if (activityToggle) {
      act(() => {
        activityToggle.click();
      });
    }

    expect(container.textContent).toContain("当前查看运行");
    expect(container.textContent).toContain("运行ID：run-detail-1");
    expect(container.textContent).toContain("处理中");
  });

  it("运行 metadata 带着 curated task 时，应在当前进展里展示建议下一步", () => {
    const { container } = renderSidebar({
      activeRunDetail: {
        id: "run-curated-task-1",
        source: "skill",
        source_ref: "daily-trend-briefing",
        session_id: "session-curated-task",
        status: "success",
        started_at: "2026-03-06T01:12:03Z",
        finished_at: "2026-03-06T01:12:10Z",
        duration_ms: 7000,
        error_code: null,
        error_message: null,
        metadata: JSON.stringify({
          harness: {
            curated_task: {
              task_id: "daily-trend-briefing",
              task_title: "每日趋势摘要",
            },
          },
        }),
        created_at: "2026-03-06T01:12:03Z",
        updated_at: "2026-03-06T01:12:10Z",
      },
    });

    const workflowTab = container.querySelector(
      'button[aria-label="打开当前进展"]',
    ) as HTMLButtonElement | null;
    if (workflowTab) {
      act(() => {
        workflowTab.click();
      });
    }

    expect(container.textContent).toContain("建议下一步");
    expect(container.textContent).toContain("每日趋势摘要");
    expect(container.textContent).toContain("继续展开其中一个选题");
    expect(container.textContent).toContain("生成首条内容主稿");

    const followUpHint = container.querySelector(
      '[data-testid="workflow-sidebar-follow-up-hint"]',
    ) as HTMLElement | null;
    expect(followUpHint).toBeTruthy();
    expect(followUpHint?.textContent).toContain("每日趋势摘要");
  });

  it("复盘结果带着 sceneapp 基线时，应在当前进展里显影当前结果基线", () => {
    const { container } = renderSidebar({
      activeRunDetail: {
        id: "run-sceneapp-baseline-workflow",
        source: "skill",
        source_ref: "account-project-review",
        session_id: "session-sceneapp-baseline-workflow",
        status: "success",
        started_at: "2026-03-06T01:12:03Z",
        finished_at: "2026-03-06T01:12:10Z",
        duration_ms: 7000,
        error_code: null,
        error_message: null,
        metadata: JSON.stringify({
          harness: {
            curated_task: {
              task_id: "account-project-review",
              task_title: "复盘这个账号/项目",
              reference_entries: [
                {
                  id: "sceneapp:ai-weekly:run:1",
                  source_kind: "sceneapp_execution_summary",
                  title: "AI 内容周报",
                  summary: "已有一轮可继续放量的结果。",
                  category: "experience",
                  tags: ["复盘", "增长"],
                  task_prefill_by_task_id: {
                    "account-project-review": {
                      project_goal: "AI 内容周报",
                      existing_results:
                        "当前判断：适合继续放量 经营动作：保留品牌联名方向 更适合去向：内容主稿生成 / 渠道改写",
                    },
                  },
                },
              ],
            },
          },
        }),
        created_at: "2026-03-06T01:12:03Z",
        updated_at: "2026-03-06T01:12:10Z",
      },
    });

    const workflowTab = container.querySelector(
      'button[aria-label="打开当前进展"]',
    ) as HTMLButtonElement | null;
    if (workflowTab) {
      act(() => {
        workflowTab.click();
      });
    }

    const baselineCard = container.querySelector(
      '[data-testid="workflow-sidebar-sceneapp-baseline-card"]',
    ) as HTMLElement | null;
    expect(baselineCard).toBeTruthy();
    expect(baselineCard?.textContent).toContain("当前结果基线");
    expect(baselineCard?.textContent).toContain("AI 内容周报");
    expect(baselineCard?.textContent).toContain("当前判断：适合继续放量");
    expect(baselineCard?.textContent).toContain(
      "经营动作：保留品牌联名方向",
    );
    expect(baselineCard?.textContent).toContain(
      "更适合去向：内容主稿生成 / 渠道改写",
    );
  });

  it("切到下游结果模板后，当前进展仍应显影 sceneapp 基线", () => {
    const { container } = renderSidebar({
      activeRunDetail: {
        id: "run-sceneapp-baseline-follow-up",
        source: "skill",
        source_ref: "daily-trend-briefing",
        session_id: "session-sceneapp-baseline-follow-up",
        status: "success",
        started_at: "2026-03-06T01:12:03Z",
        finished_at: "2026-03-06T01:12:10Z",
        duration_ms: 7000,
        error_code: null,
        error_message: null,
        metadata: JSON.stringify({
          harness: {
            curated_task: {
              task_id: "daily-trend-briefing",
              task_title: "每日趋势摘要",
              reference_entries: [
                {
                  id: "sceneapp:ai-weekly:run:1",
                  source_kind: "sceneapp_execution_summary",
                  title: "AI 内容周报",
                  summary: "已有一轮可继续放量的结果。",
                  category: "experience",
                  tags: ["复盘", "增长"],
                  task_prefill_by_task_id: {
                    "account-project-review": {
                      project_goal: "AI 内容周报",
                      existing_results:
                        "当前判断：适合继续放量 经营动作：保留品牌联名方向 更适合去向：内容主稿生成 / 渠道改写",
                    },
                  },
                },
              ],
            },
          },
        }),
        created_at: "2026-03-06T01:12:03Z",
        updated_at: "2026-03-06T01:12:10Z",
      },
    });

    const workflowTab = container.querySelector(
      'button[aria-label="打开当前进展"]',
    ) as HTMLButtonElement | null;
    if (workflowTab) {
      act(() => {
        workflowTab.click();
      });
    }

    const baselineCard = container.querySelector(
      '[data-testid="workflow-sidebar-sceneapp-baseline-card"]',
    ) as HTMLElement | null;
    expect(baselineCard).toBeTruthy();
    expect(baselineCard?.textContent).toContain("当前结果基线");
    expect(baselineCard?.textContent).toContain("AI 内容周报");
    expect(baselineCard?.textContent).toContain("当前判断：适合继续放量");
    expect(baselineCard?.textContent).toContain(
      "经营动作：保留品牌联名方向",
    );
  });

  it("命中最近复盘偏好模板时，应在当前进展里显影复盘建议", () => {
    recordCuratedTaskRecommendationSignalFromReviewDecision(
      {
        session_id: "session-review-workflow",
        decision_status: "needs_more_evidence",
        decision_summary: "这轮结果还缺证据，需要回到账号复盘和高表现样本继续补证据。",
        chosen_fix_strategy: "先补账号数据复盘，再拆一轮高表现内容做对照。",
        risk_level: "medium",
        risk_tags: ["证据不足", "需要复盘"],
        followup_actions: ["补账号数据复盘", "拆解高表现内容"],
      },
      {
        projectId: "project-review-workflow",
        sceneTitle: "短视频编排",
      },
    );

    const { container } = renderSidebar({
      projectId: "project-review-workflow",
      activeRunDetail: {
        id: "run-review-feedback-workflow",
        source: "skill",
        source_ref: "account-project-review",
        session_id: "session-review-workflow",
        status: "success",
        started_at: "2026-03-06T01:12:03Z",
        finished_at: "2026-03-06T01:12:10Z",
        duration_ms: 7000,
        error_code: null,
        error_message: null,
        metadata: JSON.stringify({
          harness: {
            curated_task: {
              task_id: "account-project-review",
              task_title: "复盘这个账号/项目",
            },
          },
        }),
        created_at: "2026-03-06T01:12:03Z",
        updated_at: "2026-03-06T01:12:10Z",
      },
    });

    const workflowTab = container.querySelector(
      'button[aria-label="打开当前进展"]',
    ) as HTMLButtonElement | null;
    if (workflowTab) {
      act(() => {
        workflowTab.click();
      });
    }

    const reviewBanner = container.querySelector(
      '[data-testid="workflow-sidebar-review-feedback-banner"]',
    ) as HTMLElement | null;
    expect(reviewBanner).toBeTruthy();
    expect(reviewBanner?.textContent).toContain("围绕最近复盘");
    expect(reviewBanner?.textContent).toContain(
      "最近复盘已更新：短视频编排 · 补证据",
    );
    expect(reviewBanner?.textContent).toContain("这轮结果还缺证据");
    expect(reviewBanner?.textContent).toContain("围绕「复盘这个账号/项目」继续推进");
  });

  it("复盘结果带着 sceneapp 基线时，应在当前查看运行里继续显影当前结果基线", () => {
    const { container } = renderSidebar({
      activeRunDetail: {
        id: "run-sceneapp-baseline-run-detail",
        source: "skill",
        source_ref: "account-project-review",
        session_id: "session-sceneapp-baseline-run-detail",
        status: "success",
        started_at: "2026-03-06T01:12:03Z",
        finished_at: "2026-03-06T01:12:10Z",
        duration_ms: 7000,
        error_code: null,
        error_message: null,
        metadata: JSON.stringify({
          harness: {
            curated_task: {
              task_id: "account-project-review",
              task_title: "复盘这个账号/项目",
              reference_entries: [
                {
                  id: "sceneapp:ai-weekly:run:2",
                  source_kind: "sceneapp_execution_summary",
                  title: "AI 内容周报",
                  summary: "已有一轮可继续放量的结果。",
                  category: "experience",
                  tags: ["复盘", "增长"],
                  task_prefill_by_task_id: {
                    "account-project-review": {
                      project_goal: "AI 内容周报",
                      existing_results:
                        "当前判断：适合继续放量 经营动作：保留品牌联名方向 更适合去向：内容主稿生成 / 渠道改写",
                    },
                  },
                },
              ],
            },
          },
        }),
        created_at: "2026-03-06T01:12:03Z",
        updated_at: "2026-03-06T01:12:10Z",
      },
    });

    const workflowTab = container.querySelector(
      'button[aria-label="打开当前进展"]',
    ) as HTMLButtonElement | null;
    if (workflowTab) {
      act(() => {
        workflowTab.click();
      });
    }

    const activityToggle = container.querySelector(
      "button[aria-label='切换执行经过']",
    ) as HTMLButtonElement | null;
    if (activityToggle) {
      act(() => {
        activityToggle.click();
      });
    }

    const baselineCard = container.querySelector(
      '[data-testid="workflow-run-detail-sceneapp-baseline-card"]',
    ) as HTMLElement | null;
    expect(baselineCard).toBeTruthy();
    expect(baselineCard?.textContent).toContain("当前结果基线");
    expect(baselineCard?.textContent).toContain("AI 内容周报");
    expect(baselineCard?.textContent).toContain("当前判断：适合继续放量");
    expect(baselineCard?.textContent).toContain(
      "经营动作：保留品牌联名方向",
    );
    expect(baselineCard?.textContent).toContain(
      "更适合去向：内容主稿生成 / 渠道改写",
    );
  });

  it("命中最近复盘偏好模板时，应在当前查看运行里继续显影复盘建议", () => {
    recordCuratedTaskRecommendationSignalFromReviewDecision(
      {
        session_id: "session-review-run-detail",
        decision_status: "needs_more_evidence",
        decision_summary: "这轮结果还缺证据，需要回到账号复盘和高表现样本继续补证据。",
        chosen_fix_strategy: "先补账号数据复盘，再拆一轮高表现内容做对照。",
        risk_level: "medium",
        risk_tags: ["证据不足", "需要复盘"],
        followup_actions: ["补账号数据复盘", "拆解高表现内容"],
      },
      {
        projectId: "project-review-run-detail",
        sceneTitle: "短视频编排",
      },
    );

    const { container } = renderSidebar({
      projectId: "project-review-run-detail",
      activeRunDetail: {
        id: "run-review-run-detail",
        source: "skill",
        source_ref: "account-project-review",
        session_id: "session-review-run-detail",
        status: "success",
        started_at: "2026-03-06T01:12:03Z",
        finished_at: "2026-03-06T01:12:10Z",
        duration_ms: 7000,
        error_code: null,
        error_message: null,
        metadata: JSON.stringify({
          harness: {
            curated_task: {
              task_id: "account-project-review",
              task_title: "复盘这个账号/项目",
            },
          },
        }),
        created_at: "2026-03-06T01:12:03Z",
        updated_at: "2026-03-06T01:12:10Z",
      },
    });

    const workflowTab = container.querySelector(
      'button[aria-label="打开当前进展"]',
    ) as HTMLButtonElement | null;
    if (workflowTab) {
      act(() => {
        workflowTab.click();
      });
    }

    const activityToggle = container.querySelector(
      "button[aria-label='切换执行经过']",
    ) as HTMLButtonElement | null;
    if (activityToggle) {
      act(() => {
        activityToggle.click();
      });
    }

    const reviewBanner = container.querySelector(
      '[data-testid="workflow-run-detail-review-feedback-banner"]',
    ) as HTMLElement | null;
    expect(reviewBanner).toBeTruthy();
    expect(reviewBanner?.textContent).toContain("围绕最近复盘");
    expect(reviewBanner?.textContent).toContain(
      "最近复盘已更新：短视频编排 · 补证据",
    );
    expect(reviewBanner?.textContent).toContain("这轮结果还缺证据");
    expect(reviewBanner?.textContent).toContain("围绕「复盘这个账号/项目」继续推进");
  });

  it("点击当前进展里的复盘建议时，应把结果基线 continuation 回传给工作区", () => {
    const onApplyFollowUpAction = vi.fn();
    recordCuratedTaskRecommendationSignal({
      source: "review_feedback",
      category: "experience",
      title: "AI 内容周报 · 转成主稿",
      summary: "这轮判断已经清楚，建议直接回到内容主稿生成继续往下做。",
      tags: ["复盘", "主稿"],
      preferredTaskIds: ["social-post-starter", "account-project-review"],
      createdAt: Date.now(),
      projectId: "project-review-feedback-sidebar",
      sessionId: "session-review-feedback-sidebar",
    });

    const { container } = renderSidebar({
      projectId: "project-review-feedback-sidebar",
      onApplyFollowUpAction,
      activeRunDetail: {
        id: "run-review-feedback-sidebar",
        source: "skill",
        source_ref: "account-project-review",
        session_id: "session-review-feedback-sidebar",
        status: "success",
        started_at: "2026-03-06T01:12:03Z",
        finished_at: "2026-03-06T01:12:10Z",
        duration_ms: 7000,
        error_code: null,
        error_message: null,
        metadata: JSON.stringify({
          harness: {
            curated_task: {
              task_id: "account-project-review",
              task_title: "复盘这个账号/项目",
              reference_entries: [
                {
                  id: "sceneapp:ai-weekly:run:3",
                  source_kind: "sceneapp_execution_summary",
                  title: "AI 内容周报",
                  summary: "当前已有一轮结果，可直接进入下游主稿。",
                  category: "experience",
                  tags: ["复盘", "周报"],
                  task_prefill_by_task_id: {
                    "account-project-review": {
                      project_goal: "AI 内容周报",
                      existing_results:
                        "当前判断：适合继续放量 当前卡点：封面信息过密 经营动作：保留品牌联名方向 更适合去向：内容主稿生成",
                    },
                  },
                },
              ],
            },
          },
        }),
        created_at: "2026-03-06T01:12:03Z",
        updated_at: "2026-03-06T01:12:10Z",
      },
    });

    const workflowTab = container.querySelector(
      'button[aria-label="打开当前进展"]',
    ) as HTMLButtonElement | null;
    if (workflowTab) {
      act(() => {
        workflowTab.click();
      });
    }

    const actionButton = container.querySelector(
      '[data-testid="workflow-sidebar-review-feedback-banner-action"]',
    ) as HTMLButtonElement | null;
    expect(actionButton?.textContent).toContain("继续去「内容主稿生成」");

    if (actionButton) {
      act(() => {
        actionButton.click();
      });
    }

    expect(onApplyFollowUpAction).toHaveBeenCalledWith(
      expect.objectContaining({
        bannerMessage:
          "已切到“内容主稿生成”这条下一步，并带着当前结果继续生成。",
        capabilityRoute: expect.objectContaining({
          kind: "curated_task",
          taskId: "social-post-starter",
          taskTitle: "内容主稿生成",
          prompt: expect.stringContaining("当前结果基线：AI 内容周报"),
          referenceEntries: [
            expect.objectContaining({
              sourceKind: "sceneapp_execution_summary",
              title: "AI 内容周报",
            }),
          ],
        }),
        prompt: expect.stringContaining("继续沿这轮项目结果基线推进"),
      }),
    );
  });

  it("点击当前查看运行里的复盘建议时，也应把 continuation 回传给工作区", () => {
    const onApplyFollowUpAction = vi.fn();
    recordCuratedTaskRecommendationSignal({
      source: "review_feedback",
      category: "experience",
      title: "AI 内容周报 · 转成主稿",
      summary: "这轮判断已经清楚，建议直接回到内容主稿生成继续往下做。",
      tags: ["复盘", "主稿"],
      preferredTaskIds: ["social-post-starter", "account-project-review"],
      createdAt: Date.now(),
      projectId: "project-review-feedback-run-detail",
      sessionId: "session-review-feedback-run-detail",
    });

    const { container } = renderSidebar({
      projectId: "project-review-feedback-run-detail",
      onApplyFollowUpAction,
      activeRunDetail: {
        id: "run-review-feedback-run-detail",
        source: "skill",
        source_ref: "account-project-review",
        session_id: "session-review-feedback-run-detail",
        status: "success",
        started_at: "2026-03-06T01:12:03Z",
        finished_at: "2026-03-06T01:12:10Z",
        duration_ms: 7000,
        error_code: null,
        error_message: null,
        metadata: JSON.stringify({
          harness: {
            curated_task: {
              task_id: "account-project-review",
              task_title: "复盘这个账号/项目",
              reference_entries: [
                {
                  id: "sceneapp:ai-weekly:run:4",
                  source_kind: "sceneapp_execution_summary",
                  title: "AI 内容周报",
                  summary: "当前已有一轮结果，可直接进入下游主稿。",
                  category: "experience",
                  tags: ["复盘", "周报"],
                  task_prefill_by_task_id: {
                    "account-project-review": {
                      project_goal: "AI 内容周报",
                      existing_results:
                        "当前判断：适合继续放量 当前卡点：封面信息过密 经营动作：保留品牌联名方向 更适合去向：内容主稿生成",
                    },
                  },
                },
              ],
            },
          },
        }),
        created_at: "2026-03-06T01:12:03Z",
        updated_at: "2026-03-06T01:12:10Z",
      },
    });

    const workflowTab = container.querySelector(
      'button[aria-label="打开当前进展"]',
    ) as HTMLButtonElement | null;
    if (workflowTab) {
      act(() => {
        workflowTab.click();
      });
    }

    const activityToggle = container.querySelector(
      "button[aria-label='切换执行经过']",
    ) as HTMLButtonElement | null;
    if (activityToggle) {
      act(() => {
        activityToggle.click();
      });
    }

    const actionButton = container.querySelector(
      '[data-testid="workflow-run-detail-review-feedback-banner-action"]',
    ) as HTMLButtonElement | null;
    expect(actionButton?.textContent).toContain("继续去「内容主稿生成」");

    if (actionButton) {
      act(() => {
        actionButton.click();
      });
    }

    expect(onApplyFollowUpAction).toHaveBeenCalledWith(
      expect.objectContaining({
        bannerMessage:
          "已切到“内容主稿生成”这条下一步，并带着当前结果继续生成。",
        capabilityRoute: expect.objectContaining({
          kind: "curated_task",
          taskId: "social-post-starter",
          taskTitle: "内容主稿生成",
          prompt: expect.stringContaining("当前结果基线：AI 内容周报"),
        }),
        prompt: expect.stringContaining("继续沿这轮项目结果基线推进"),
      }),
    );
  });

  it("点击建议下一步应把 continuation prompt 回传给工作区", () => {
    const onApplyFollowUpAction = vi.fn();
    const { container } = renderSidebar({
      onApplyFollowUpAction,
      activeRunDetail: {
        id: "run-curated-task-follow-up",
        source: "skill",
        source_ref: "daily-trend-briefing",
        session_id: "session-curated-task-follow-up",
        status: "success",
        started_at: "2026-03-06T01:12:03Z",
        finished_at: "2026-03-06T01:12:10Z",
        duration_ms: 7000,
        error_code: null,
        error_message: null,
        metadata: JSON.stringify({
          harness: {
            curated_task: {
              task_id: "daily-trend-briefing",
              task_title: "每日趋势摘要",
              launch_input_values: {
                theme_target: "AI 内容创作",
                platform_region: "X 与 TikTok 北美区",
              },
              reference_entries: [
                {
                  id: "memory-1",
                  title: "品牌风格样本",
                  summary: "保留轻盈但专业的表达。",
                  category: "context",
                  tags: ["品牌", "语气"],
                },
              ],
            },
          },
        }),
        created_at: "2026-03-06T01:12:03Z",
        updated_at: "2026-03-06T01:12:10Z",
      },
    });

    const workflowTab = container.querySelector(
      'button[aria-label="打开当前进展"]',
    ) as HTMLButtonElement | null;
    if (workflowTab) {
      act(() => {
        workflowTab.click();
      });
    }

    const followUpButton = container.querySelector(
      'button[aria-label="应用建议下一步-继续展开其中一个选题"]',
    ) as HTMLButtonElement | null;
    expect(followUpButton).toBeTruthy();
    if (followUpButton) {
      act(() => {
        followUpButton.click();
      });
    }

    expect(onApplyFollowUpAction).toHaveBeenCalledWith(
      {
        prompt: "请基于「每日趋势摘要」这轮结果继续：继续展开其中一个选题",
        bannerMessage:
          "已按“继续展开其中一个选题”接着推进「每日趋势摘要」，可继续改写后发送。",
        capabilityRoute: {
          kind: "curated_task",
          taskId: "daily-trend-briefing",
          taskTitle: "每日趋势摘要",
          prompt: "请基于「每日趋势摘要」这轮结果继续：继续展开其中一个选题",
          launchInputValues: {
            theme_target: "AI 内容创作",
            platform_region: "X 与 TikTok 北美区",
          },
          referenceMemoryIds: ["memory-1"],
          referenceEntries: [
            {
              id: "memory-1",
              sourceKind: "memory",
              title: "品牌风格样本",
              summary: "保留轻盈但专业的表达。",
              category: "context",
              categoryLabel: "参考",
              tags: ["品牌", "语气"],
            },
          ],
        },
      },
    );
  });

  it("复盘结果点击建议下一步时，应切到下游结果模板而不是继续停在复盘模板", () => {
    const onApplyFollowUpAction = vi.fn();
    const { container } = renderSidebar({
      onApplyFollowUpAction,
      activeRunDetail: {
        id: "run-review-follow-up-route",
        source: "skill",
        source_ref: "account-project-review",
        session_id: "session-review-follow-up-route",
        status: "success",
        started_at: "2026-03-06T01:12:03Z",
        finished_at: "2026-03-06T01:12:10Z",
        duration_ms: 7000,
        error_code: null,
        error_message: null,
        metadata: JSON.stringify({
          harness: {
            curated_task: {
              task_id: "account-project-review",
              task_title: "复盘这个账号/项目",
              reference_entries: [
                {
                  id: "memory-review-1",
                  title: "本周账号复盘线索",
                  summary: "封面信息过密，转化动作不够聚焦。",
                  category: "experience",
                  tags: ["复盘", "增长"],
                },
              ],
            },
          },
        }),
        created_at: "2026-03-06T01:12:03Z",
        updated_at: "2026-03-06T01:12:10Z",
      },
    });

    const workflowTab = container.querySelector(
      'button[aria-label="打开当前进展"]',
    ) as HTMLButtonElement | null;
    if (workflowTab) {
      act(() => {
        workflowTab.click();
      });
    }

    const followUpButton = container.querySelector(
      'button[aria-label="应用建议下一步-生成下一轮内容方案"]',
    ) as HTMLButtonElement | null;
    expect(followUpButton).toBeTruthy();
    if (followUpButton) {
      act(() => {
        followUpButton.click();
      });
    }

    expect(onApplyFollowUpAction).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining(
          "请承接这轮复盘结论，直接生成下一轮最值得执行的内容方案。",
        ),
        bannerMessage:
          "已切到“内容主稿生成”这条下一步，并带着这轮结果继续生成。",
        capabilityRoute: expect.objectContaining({
          kind: "curated_task",
          taskId: "social-post-starter",
          taskTitle: "内容主稿生成",
          prompt: expect.stringContaining("请先帮我起草一版内容首稿"),
          referenceMemoryIds: ["memory-review-1"],
          referenceEntries: [
            {
              id: "memory-review-1",
              sourceKind: "memory",
              title: "本周账号复盘线索",
              summary: "封面信息过密，转化动作不够聚焦。",
              category: "experience",
              categoryLabel: "成果",
              tags: ["复盘", "增长"],
            },
          ],
        }),
      }),
    );
  });

  it("跨模板建议下一步应继续保留当前启动参数，并和目标模板参考预填合并", () => {
    const onApplyFollowUpAction = vi.fn();
    const { container } = renderSidebar({
      onApplyFollowUpAction,
      activeRunDetail: {
        id: "run-review-follow-up-launch-context",
        source: "skill",
        source_ref: "account-project-review",
        session_id: "session-review-follow-up-launch-context",
        status: "success",
        started_at: "2026-03-06T01:12:03Z",
        finished_at: "2026-03-06T01:12:10Z",
        duration_ms: 7000,
        error_code: null,
        error_message: null,
        metadata: JSON.stringify({
          harness: {
            curated_task: {
              task_id: "account-project-review",
              task_title: "复盘这个账号/项目",
              launch_input_values: {
                target_audience: "关注 AI 内容的品牌运营",
              },
              reference_entries: [
                {
                  id: "memory-review-2",
                  title: "本周账号复盘线索",
                  summary: "封面信息过密，转化动作不够聚焦。",
                  category: "experience",
                  tags: ["复盘", "增长"],
                  task_prefill_by_task_id: {
                    "social-post-starter": {
                      subject_or_product: "基于本周账号复盘，整理下一轮内容方向与重点动作。",
                    },
                  },
                },
              ],
            },
          },
        }),
        created_at: "2026-03-06T01:12:03Z",
        updated_at: "2026-03-06T01:12:10Z",
      },
    });

    const workflowTab = container.querySelector(
      'button[aria-label="打开当前进展"]',
    ) as HTMLButtonElement | null;
    if (workflowTab) {
      act(() => {
        workflowTab.click();
      });
    }

    const followUpButton = container.querySelector(
      'button[aria-label="应用建议下一步-生成下一轮内容方案"]',
    ) as HTMLButtonElement | null;
    expect(followUpButton).toBeTruthy();
    if (followUpButton) {
      act(() => {
        followUpButton.click();
      });
    }

    expect(onApplyFollowUpAction).toHaveBeenCalledWith(
      expect.objectContaining({
        bannerMessage:
          "已切到“内容主稿生成”这条下一步，并带着这轮结果继续生成。",
        capabilityRoute: expect.objectContaining({
          kind: "curated_task",
          taskId: "social-post-starter",
          launchInputValues: {
            subject_or_product:
              "基于本周账号复盘，整理下一轮内容方向与重点动作。",
            target_audience: "关注 AI 内容的品牌运营",
          },
          prompt: expect.stringContaining(
            "主题或产品信息：基于本周账号复盘，整理下一轮内容方向与重点动作。",
          ),
        }),
      }),
    );
  });

  it("运行详情应支持复制运行ID与原始记录", async () => {
    const { container } = renderSidebar({
      activeRunDetail: {
        id: "run-copy-1",
        source: "skill",
        source_ref: "content_post_with_cover",
        session_id: "session-copy",
        status: "success",
        started_at: "2026-03-06T01:02:03Z",
        finished_at: "2026-03-06T01:02:06Z",
        duration_ms: 3000,
        error_code: null,
        error_message: null,
        metadata: JSON.stringify({ gate_key: "write_mode", foo: "bar" }),
        created_at: "2026-03-06T01:02:03Z",
        updated_at: "2026-03-06T01:02:06Z",
      },
    });

    const workflowTab = container.querySelector(
      'button[aria-label="打开当前进展"]',
    ) as HTMLButtonElement | null;
    if (workflowTab) {
      act(() => {
        workflowTab.click();
      });
    }

    const activityToggle = container.querySelector(
      "button[aria-label='切换执行经过']",
    ) as HTMLButtonElement | null;
    if (activityToggle) {
      act(() => {
        activityToggle.click();
      });
    }

    const copyIdButton = container.querySelector(
      "button[aria-label='复制运行ID']",
    ) as HTMLButtonElement | null;
    const copyMetadataButton = container.querySelector(
      "button[aria-label='复制原始记录']",
    ) as HTMLButtonElement | null;

    expect(copyIdButton).toBeTruthy();
    expect(copyMetadataButton).toBeTruthy();

    if (copyIdButton) {
      act(() => {
        copyIdButton.click();
      });
    }

    if (copyMetadataButton) {
      act(() => {
        copyMetadataButton.click();
      });
    }

    expect(mockWriteClipboardText).toHaveBeenNthCalledWith(1, "run-copy-1");
    expect(mockWriteClipboardText).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('"gate_key": "write_mode"'),
    );
  });

  it("运行详情应展示阶段与产物路径，并支持复制产物路径", () => {
    const { container } = renderSidebar({
      activeRunDetail: {
        id: "run-artifact-1",
        source: "skill",
        source_ref: "content_post_with_cover",
        session_id: "session-artifact",
        status: "success",
        started_at: "2026-03-06T02:00:03Z",
        finished_at: "2026-03-06T02:00:08Z",
        duration_ms: 5000,
        error_code: null,
        error_message: null,
        metadata: JSON.stringify({
          workflow: "social_content_pipeline_v1",
          execution_id: "exec-artifact-1",
          version_id: "ver-artifact-1",
          stages: ["topic_select", "write_mode", "publish_confirm"],
          artifact_paths: [
            "content-posts/demo.md",
            "content-posts/demo.publish-pack.json",
          ],
        }),
        created_at: "2026-03-06T02:00:03Z",
        updated_at: "2026-03-06T02:00:08Z",
      },
    });

    const workflowTab = container.querySelector(
      'button[aria-label="打开当前进展"]',
    ) as HTMLButtonElement | null;
    if (workflowTab) {
      act(() => {
        workflowTab.click();
      });
    }

    const activityToggle = container.querySelector(
      "button[aria-label='切换执行经过']",
    ) as HTMLButtonElement | null;
    if (activityToggle) {
      act(() => {
        activityToggle.click();
      });
    }

    expect(container.textContent).toContain(
      "工作流 social_content_pipeline_v1",
    );
    expect(container.textContent).toContain(
      "选题闸门 → 写作闸门 → 发布闸门",
    );
    expect(container.textContent).toContain("content-posts/demo.md");
    expect(container.textContent).toContain(
      "content-posts/demo.publish-pack.json",
    );

    const copyArtifactButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) =>
      button
        .getAttribute("aria-label")
        ?.startsWith("复制产物路径-content-posts/demo.md"),
    );
    expect(copyArtifactButton).toBeTruthy();
    if (copyArtifactButton) {
      act(() => {
        copyArtifactButton.click();
      });
    }

    expect(mockWriteClipboardText).toHaveBeenCalledWith(
      "content-posts/demo.md",
    );

    const revealArtifactButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) =>
      button
        .getAttribute("aria-label")
        ?.startsWith("定位产物路径-content-posts/demo.md"),
    );
    expect(revealArtifactButton).toBeTruthy();
    if (revealArtifactButton) {
      act(() => {
        revealArtifactButton.click();
      });
    }
    expect(mockRevealSessionFileInFinder).toHaveBeenCalledWith(
      "session-artifact",
      "content-posts/demo.md",
    );

    const openArtifactButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) =>
      button
        .getAttribute("aria-label")
        ?.startsWith("打开产物路径-content-posts/demo.md"),
    );
    expect(openArtifactButton).toBeTruthy();
    if (openArtifactButton) {
      act(() => {
        openArtifactButton.click();
      });
    }
    expect(mockOpenSessionFileWithDefaultApp).toHaveBeenCalledWith(
      "session-artifact",
      "content-posts/demo.md",
    );
  });

  it("活动日志分组应支持直接定位与打开产物", () => {
    const { container } = renderSidebar({
      activityLogs: [
        {
          id: "log-run-artifact-1",
          name: "content_post_with_cover",
          status: "completed",
          timeLabel: "11:20",
          applyTarget: "主稿内容",
          contextIds: ["material:1"],
          sessionId: "session-group",
          artifactPaths: ["content-posts/group.md"],
          gateKey: "write_mode",
          source: "skill",
        },
      ],
    });

    const workflowTab = container.querySelector(
      'button[aria-label="打开当前进展"]',
    ) as HTMLButtonElement | null;
    if (workflowTab) {
      act(() => {
        workflowTab.click();
      });
    }

    const activityToggle = container.querySelector(
      "button[aria-label='切换执行经过']",
    ) as HTMLButtonElement | null;
    if (activityToggle) {
      act(() => {
        activityToggle.click();
      });
    }

    const revealArtifactButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) =>
      button
        .getAttribute("aria-label")
        ?.startsWith("定位活动产物路径-content-posts/group.md"),
    );
    expect(revealArtifactButton).toBeTruthy();
    if (revealArtifactButton) {
      act(() => {
        revealArtifactButton.click();
      });
    }
    expect(mockRevealSessionFileInFinder).toHaveBeenCalledWith(
      "session-group",
      "content-posts/group.md",
    );

    const openArtifactButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) =>
      button
        .getAttribute("aria-label")
        ?.startsWith("打开活动产物路径-content-posts/group.md"),
    );
    expect(openArtifactButton).toBeTruthy();
    if (openArtifactButton) {
      act(() => {
        openArtifactButton.click();
      });
    }
    expect(mockOpenSessionFileWithDefaultApp).toHaveBeenCalledWith(
      "session-group",
      "content-posts/group.md",
    );
  });

  it("任务提交面板应按任务类型分组展示并支持复制路径", () => {
    const { container } = renderSidebar({
      creationTaskEvents: [
        {
          taskId: "task-image-1",
          taskType: "image_generate",
          path: ".lime/tasks/image_generate/a.json",
          absolutePath: "/tmp/lime/.lime/tasks/image_generate/a.json",
          createdAt: Date.parse("2026-03-06T02:20:00Z"),
          timeLabel: "10:20",
        },
        {
          taskId: "task-image-2",
          taskType: "image_generate",
          path: ".lime/tasks/image_generate/b.json",
          createdAt: Date.parse("2026-03-06T02:21:00Z"),
          timeLabel: "10:21",
        },
        {
          taskId: "task-typesetting-1",
          taskType: "typesetting",
          path: ".lime/tasks/typesetting/c.json",
          createdAt: Date.parse("2026-03-06T02:22:00Z"),
          timeLabel: "10:22",
        },
      ],
    });

    const workflowTab = container.querySelector(
      'button[aria-label="打开当前进展"]',
    ) as HTMLButtonElement | null;
    if (workflowTab) {
      act(() => {
        workflowTab.click();
      });
    }

    expect(container.textContent).toContain("产出记录");
    expect(container.textContent).toContain("最近一次：排版优化");
    expect(container.textContent).toContain("共 3 条产出记录，按 2 类归档。");
    const toggleCreationTasksButton = container.querySelector(
      "button[aria-label='切换产出记录']",
    ) as HTMLButtonElement | null;
    expect(toggleCreationTasksButton).toBeTruthy();
    if (toggleCreationTasksButton) {
      act(() => {
        toggleCreationTasksButton.click();
      });
    }
    expect(container.textContent).toContain("配图生成");
    expect(container.textContent).toContain("排版优化");
    expect(container.textContent).toContain("2 条记录");

    const copyAbsolutePathButton = container.querySelector(
      'button[aria-label="复制任务文件绝对路径-task-image-1"]',
    ) as HTMLButtonElement | null;
    expect(copyAbsolutePathButton).toBeTruthy();
    if (copyAbsolutePathButton) {
      act(() => {
        copyAbsolutePathButton.click();
      });
    }

    expect(mockWriteClipboardText).toHaveBeenCalledWith(
      "/tmp/lime/.lime/tasks/image_generate/a.json",
    );
  });

  it("定位产物失败时应透传后端错误信息", async () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    mockRevealSessionFileInFinder.mockRejectedValueOnce(
      new Error("文件不存在"),
    );
    try {
      const { container } = renderSidebar({
        activeRunDetail: {
          id: "run-error-path",
          source: "skill",
          source_ref: "content_post_with_cover",
          session_id: "session-error",
          status: "success",
          started_at: "2026-03-06T02:10:03Z",
          finished_at: "2026-03-06T02:10:08Z",
          duration_ms: 5000,
          error_code: null,
          error_message: null,
          metadata: JSON.stringify({
            artifact_paths: ["content-posts/error.md"],
          }),
          created_at: "2026-03-06T02:10:03Z",
          updated_at: "2026-03-06T02:10:08Z",
        },
      });

      const workflowTab = container.querySelector(
        'button[aria-label="打开当前进展"]',
      ) as HTMLButtonElement | null;
      if (workflowTab) {
        act(() => {
          workflowTab.click();
        });
      }

      const activityToggle = container.querySelector(
        "button[aria-label='切换执行经过']",
      ) as HTMLButtonElement | null;
      if (activityToggle) {
        act(() => {
          activityToggle.click();
        });
      }

      const revealArtifactButton = Array.from(
        container.querySelectorAll("button"),
      ).find((button) =>
        button
          .getAttribute("aria-label")
          ?.startsWith("定位产物路径-content-posts/error.md"),
      );
      expect(revealArtifactButton).toBeTruthy();
      if (revealArtifactButton) {
        await act(async () => {
          revealArtifactButton.click();
          await Promise.resolve();
        });
      }

      expect(mockToastError).toHaveBeenCalledWith(
        expect.stringContaining("文件不存在"),
      );
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });
});
