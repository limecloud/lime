import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentThreadTimeline } from "./AgentThreadTimeline";
import type {
  ActionRequired,
  AgentThreadItem,
  AgentThreadTurn,
} from "../types";
import type { AgentRuntimeThreadReadModel } from "@/lib/api/agentRuntime";
import type { ArtifactTimelineOpenTarget } from "../utils/artifactTimelineNavigation";

const parseAIResponseMock = vi.fn();

function resolveMockToolText(toolCall: {
  name: string;
  arguments?: string;
  status?: string;
}) {
  let parsedArguments: Record<string, unknown> | null = null;
  if (toolCall.arguments) {
    try {
      parsedArguments = JSON.parse(toolCall.arguments) as Record<
        string,
        unknown
      >;
    } catch {
      parsedArguments = null;
    }
  }

  if (
    toolCall.name === "browser_navigate" &&
    typeof parsedArguments?.url === "string"
  ) {
    return `打开 ${parsedArguments.url}`;
  }

  if (
    (toolCall.name === "web_search" || toolCall.name === "search_query") &&
    typeof parsedArguments?.query === "string"
  ) {
    return `搜索 ${parsedArguments.query}`;
  }

  if (
    toolCall.name === "exec_command" &&
    typeof parsedArguments?.command === "string"
  ) {
    return `执行 ${parsedArguments.command}`;
  }

  if (
    toolCall.name === "lime_site_run" &&
    typeof parsedArguments?.adapter_name === "string"
  ) {
    return `执行 ${parsedArguments.adapter_name}`;
  }

  return toolCall.name;
}

const mockToolCallItem = vi.fn(
  ({
    toolCall,
    onOpenSavedSiteContent,
    grouped,
    groupMarker,
  }: {
    toolCall: { name: string; arguments?: string; status?: string };
    onOpenSavedSiteContent?: (target: {
      projectId: string;
      contentId: string;
      title?: string;
    }) => void;
    grouped?: boolean;
    groupMarker?: string;
  }) => (
    <div
      data-testid="tool-call-item"
      data-has-open-saved-site-content={onOpenSavedSiteContent ? "yes" : "no"}
      data-grouped={grouped ? "yes" : "no"}
      data-group-marker={groupMarker || ""}
    >
      {resolveMockToolText(toolCall)}
      {toolCall.status === "running" ? " 进行中" : ""}
    </div>
  ),
);

vi.mock("@/lib/workspace/a2ui", () => ({
  parseAIResponse: (...args: unknown[]) => parseAIResponseMock(...args),
  CHAT_A2UI_TASK_CARD_PRESET: {},
  TIMELINE_A2UI_TASK_CARD_PRESET: {},
}));

vi.mock("./MarkdownRenderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => (
    <div data-testid="markdown-renderer">{content}</div>
  ),
}));

vi.mock("./A2UITaskCard", () => ({
  A2UITaskCard: () => <div data-testid="timeline-a2ui-card" />,
  A2UITaskLoadingCard: () => <div data-testid="timeline-a2ui-loading-card" />,
}));

vi.mock("./ToolCallDisplay", () => ({
  ToolCallItem: (props: {
    toolCall: { name: string; arguments?: string; status?: string };
    onOpenSavedSiteContent?: (target: {
      projectId: string;
      contentId: string;
      title?: string;
    }) => void;
    grouped?: boolean;
    groupMarker?: string;
  }) => mockToolCallItem(props),
}));

vi.mock("./DecisionPanel", () => ({
  DecisionPanel: ({
    request,
  }: {
    request: {
      prompt?: string;
      questions?: Array<{
        header?: string;
        question?: string;
        options?: Array<{ label: string }>;
      }>;
    };
  }) => (
    <div data-testid="decision-panel">
      {request.prompt || "decision"}
      {request.questions?.map((question) => (
        <div key={question.header || question.question}>
          {question.header}
          {question.options?.map((option) => (
            <span key={option.label}>{option.label}</span>
          ))}
        </div>
      ))}
    </div>
  ),
}));

vi.mock("./AgentPlanBlock", () => ({
  AgentPlanBlock: ({ content }: { content: string }) => (
    <div data-testid="agent-plan-block">{content}</div>
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
  HTMLElement.prototype.scrollIntoView = vi.fn();
  parseAIResponseMock.mockImplementation((content: string) => ({
    parts: content.trim() ? [{ type: "text", content: content.trim() }] : [],
    hasA2UI: false,
    hasWriteFile: false,
    hasPending: false,
  }));
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

function at(second: number): string {
  return `2026-03-15T09:10:${String(second).padStart(2, "0")}Z`;
}

function createTurn(overrides?: Partial<AgentThreadTurn>): AgentThreadTurn {
  return {
    id: "turn-1",
    thread_id: "thread-1",
    prompt_text: "请检查并发布文章",
    status: "completed",
    started_at: at(0),
    completed_at: at(9),
    created_at: at(0),
    updated_at: at(9),
    ...overrides,
  };
}

function createBaseItem(
  id: string,
  sequence: number,
): Pick<
  AgentThreadItem,
  | "id"
  | "thread_id"
  | "turn_id"
  | "sequence"
  | "status"
  | "started_at"
  | "completed_at"
  | "updated_at"
> {
  const timestamp = at(sequence);
  return {
    id,
    thread_id: "thread-1",
    turn_id: "turn-1",
    sequence,
    status: "completed",
    started_at: timestamp,
    completed_at: timestamp,
    updated_at: timestamp,
  };
}

function renderTimeline(
  items: AgentThreadItem[],
  props?: {
    isCurrentTurn?: boolean;
    turn?: Partial<AgentThreadTurn>;
    threadRead?: AgentRuntimeThreadReadModel | null;
    actionRequests?: ActionRequired[];
    onOpenSavedSiteContent?: (target: {
      projectId: string;
      contentId: string;
      title?: string;
    }) => void;
    onOpenSubagentSession?: (sessionId: string) => void;
    onOpenArtifactFromTimeline?: (target: ArtifactTimelineOpenTarget) => void;
    focusedItemId?: string | null;
    focusRequestKey?: number;
    deferCompletedSingleDetails?: boolean;
    collapseInactiveDetails?: boolean;
  },
): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <AgentThreadTimeline
        turn={createTurn(props?.turn)}
        items={items}
        threadRead={props?.threadRead}
        actionRequests={props?.actionRequests}
        isCurrentTurn={props?.isCurrentTurn}
        onOpenArtifactFromTimeline={props?.onOpenArtifactFromTimeline}
        onOpenSavedSiteContent={props?.onOpenSavedSiteContent}
        onOpenSubagentSession={props?.onOpenSubagentSession}
        focusedItemId={props?.focusedItemId}
        focusRequestKey={props?.focusRequestKey}
        deferCompletedSingleDetails={props?.deferCompletedSingleDetails}
        collapseInactiveDetails={props?.collapseInactiveDetails}
      />,
    );
  });

  mountedRoots.push({ container, root });
  return container;
}

function createFileArtifactItem(
  overrides: Partial<Extract<AgentThreadItem, { type: "file_artifact" }>> = {},
): Extract<AgentThreadItem, { type: "file_artifact" }> {
  return {
    ...createBaseItem("artifact-1", 1),
    type: "file_artifact",
    path: "exports/x-article-export/google/index.md",
    source: "artifact_snapshot",
    content: JSON.stringify({
      schemaVersion: "artifact_document.v1",
      artifactId: "artifact-document:demo",
      kind: "analysis",
      title: "季度复盘",
      status: "ready",
      language: "zh-CN",
      blocks: [
        { id: "hero-1", type: "hero_summary", summary: "摘要" },
        { id: "body-1", type: "rich_text", markdown: "正文" },
      ],
      sources: [],
      metadata: {},
    }),
    metadata: {
      artifact_id: "artifact-document:demo",
      artifact_block_id: ["hero-1", "body-1"],
    },
    ...overrides,
  };
}

function createStructuredA2UIParseResult() {
  return {
    parts: [
      { type: "text" as const, content: "请先确认以下选项：" },
      {
        type: "a2ui" as const,
        content: {
          id: "form-1",
          root: "root",
          components: [],
          submitAction: {
            label: "提交",
            action: { name: "submit" },
          },
        },
      },
    ],
    hasA2UI: true,
    hasWriteFile: false,
    hasPending: false,
  };
}

describe("AgentThreadTimeline", () => {
  it("默认直接渲染内联时间线，不再显示旧摘要壳", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("summary-1", 1),
        type: "turn_summary",
        text: "已完成页面检查\n可以继续执行发布。",
      },
      {
        ...createBaseItem("browser-1", 2),
        type: "tool_call",
        tool_name: "browser_navigate",
        arguments: { url: "https://mp.weixin.qq.com" },
      },
      {
        ...createBaseItem("approval-1", 3),
        type: "approval_request",
        request_id: "req-1",
        action_type: "tool_confirmation",
        prompt: "请确认是否发布文章",
        tool_name: "browser_click",
      },
    ];

    const container = renderTimeline(items, { isCurrentTurn: true });

    expect(
      container.querySelector('[data-testid="agent-thread-flow"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="agent-thread-overview"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="agent-thread-summary-shell"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="agent-thread-details-toggle"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="agent-thread-goal"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="agent-thread-focus"]'),
    ).toBeNull();
    expect(container.textContent).toContain("已完成页面检查");
    expect(container.textContent).toContain("打开了 https://mp.weixin.qq.com");
    expect(container.textContent).toContain("请确认是否发布文章");
  });

  it("file_artifact 命中多个 block 时应提供精确跳转按钮", () => {
    const onOpenArtifactFromTimeline = vi.fn();
    const container = renderTimeline([createFileArtifactItem()], {
      onOpenArtifactFromTimeline,
    });

    const heroJumpButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("定位到 摘要"));
    expect(heroJumpButton).not.toBeUndefined();

    act(() => {
      heroJumpButton?.click();
    });

    expect(onOpenArtifactFromTimeline).toHaveBeenCalledWith(
      expect.objectContaining({
        timelineItemId: "artifact-1",
        filePath: "exports/x-article-export/google/index.md",
        blockId: "hero-1",
      }),
    );
  });

  it("多个 file_artifact 应直接渲染卡片，不再重复显示产出摘要头", () => {
    const container = renderTimeline([
      createFileArtifactItem({
        path: "workspace/index.md",
        content: "# Index\n\n主文档内容",
      }),
      createFileArtifactItem({
        ...createBaseItem("artifact-2", 2),
        path: "workspace/Agents.md",
        content: "# Agents\n\n协作说明",
      }),
    ]);

    expect(
      container.querySelector('[data-testid="agent-thread-block:1:artifact"]'),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[data-testid="agent-thread-block:1:artifact:shell"]',
      ),
    ).toBeNull();
    expect(
      container.querySelectorAll('[data-testid="timeline-file-artifact-card"]'),
    ).toHaveLength(2);
    expect(container.textContent).not.toContain("产出了 index.md");
    expect(container.textContent).not.toContain("产出了 Agents.md");
  });

  it("不应把 .lime/tasks 下的内部任务快照 JSON 渲染到时间线里", () => {
    const container = renderTimeline([
      createFileArtifactItem({
        id: "artifact-hidden-task-json",
        path: ".lime/tasks/image_generate/task-image-1.json",
        content: '{"status":"running"}',
        metadata: {},
      }),
    ]);

    expect(
      container.querySelector('[data-testid="timeline-file-artifact-card"]'),
    ).toBeNull();
    expect(container.textContent).not.toContain("task-image-1.json");
  });

  it("收到 timeline 聚焦请求时应自动展开并高亮目标项", () => {
    const container = renderTimeline(
      [
        {
          ...createBaseItem("browser-1", 1),
          type: "tool_call",
          tool_name: "browser_click",
          arguments: { selector: "#publish" },
        },
      ],
      {
        turn: {
          status: "completed",
        },
        focusedItemId: "browser-1",
        focusRequestKey: 1,
      },
    );

    const block = container.querySelector<HTMLDetailsElement>(
      '[data-testid="agent-thread-block:1:process"]',
    );
    const focusedEntry = container.querySelector<HTMLElement>(
      '[data-thread-item-id="browser-1"]',
    );

    expect(block).not.toBeNull();
    expect(focusedEntry?.className).toContain("ring-2");
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("应向时间线内的工具明细透传已保存站点内容打开回调", () => {
    const onOpenSavedSiteContent = vi.fn();
    renderTimeline(
      [
        {
          ...createBaseItem("site-tool-1", 1),
          type: "tool_call",
          tool_name: "lime_site_run",
          arguments: { adapter_name: "github/search" },
          output: "ok",
          metadata: {
            tool_family: "site",
            saved_content: {
              content_id: "content-1",
              project_id: "project-1",
              title: "GitHub 搜索结果",
            },
          },
        },
      ],
      { onOpenSavedSiteContent },
    );

    expect(mockToolCallItem).toHaveBeenCalledWith(
      expect.objectContaining({ onOpenSavedSiteContent }),
    );
  });

  it("旧历史单步工具应先只渲染摘要，展开后再物化工具明细", () => {
    const onOpenSavedSiteContent = vi.fn();
    const container = renderTimeline(
      [
        {
          ...createBaseItem("site-tool-1", 1),
          type: "tool_call",
          tool_name: "lime_site_run",
          arguments: { adapter_name: "github/search" },
          output: "ok",
          metadata: {
            tool_family: "site",
            saved_content: {
              content_id: "content-1",
              project_id: "project-1",
              title: "GitHub 搜索结果",
            },
          },
        },
      ],
      {
        deferCompletedSingleDetails: true,
        onOpenSavedSiteContent,
      },
    );

    const block = container.querySelector<HTMLDetailsElement>(
      '[data-testid="agent-thread-block:1:process"]',
    );
    const summary = block?.querySelector("summary");

    expect(block).not.toBeNull();
    expect(block?.open).toBe(false);
    expect(mockToolCallItem).not.toHaveBeenCalled();

    act(() => {
      summary?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mockToolCallItem).toHaveBeenCalledWith(
      expect.objectContaining({ onOpenSavedSiteContent }),
    );
  });

  it("审批项与技术项都应直接落在消息流中", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("approval-1", 1),
        type: "approval_request",
        request_id: "req-1",
        action_type: "tool_confirmation",
        prompt: "请确认是否继续",
        tool_name: "browser_click",
      },
      {
        ...createBaseItem("other-1", 2),
        type: "tool_call",
        tool_name: "workspace_sync",
      },
    ];

    const container = renderTimeline(items);
    const approvalGroup = container.querySelector<HTMLElement>(
      '[data-testid="agent-thread-block:1:approval"]',
    );
    const otherGroup = container.querySelector<HTMLElement>(
      '[data-testid="agent-thread-block:2:process"]',
    );

    expect(approvalGroup).not.toBeNull();
    expect(otherGroup).not.toBeNull();
    expect(container.textContent).toContain("请确认是否继续");
    expect(container.textContent).toContain("workspace_sync");
  });

  it("应按真实发生顺序渲染思考与工具块", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("browser-1", 1),
        type: "tool_call",
        tool_name: "browser_navigate",
        arguments: { url: "https://example.com" },
      },
      {
        ...createBaseItem("summary-1", 2),
        type: "turn_summary",
        text: "页面已打开",
      },
      {
        ...createBaseItem("search-1", 3),
        type: "web_search",
        action: "web_search",
        query: "封面尺寸",
      },
    ];

    const container = renderTimeline(items);
    const blockIds = Array.from(
      container.querySelectorAll<HTMLElement>(
        "[data-testid^='agent-thread-block:']",
      ),
    )
      .map((node) => node.dataset.testid)
      .filter((value): value is string => Boolean(value))
      .filter(
        (value) => !value.endsWith(":shell") && !value.endsWith(":details"),
      );

    expect(blockIds).toEqual(["agent-thread-block:1:process"]);
  });

  it("同类多工具步骤应显示批次数量并切成轻量子行", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("browser-1", 1),
        type: "tool_call",
        tool_name: "browser_navigate",
        arguments: { url: "https://example.com" },
      },
      {
        ...createBaseItem("browser-2", 2),
        type: "tool_call",
        tool_name: "browser_click",
        arguments: { selector: "#publish" },
      },
    ];

    const container = renderTimeline(items, {
      turn: {
        status: "completed",
      },
    });

    const block = container.querySelector<HTMLDetailsElement>(
      '[data-testid="agent-thread-block:1:process"]',
    );
    const summary = block?.querySelector("summary");

    expect(summary?.textContent).toContain("2 步");
    expect(summary?.textContent).toContain("2 个工具步骤");
    expect(
      container.querySelectorAll('[data-testid="tool-call-item"]'),
    ).toHaveLength(0);

    act(() => {
      summary?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const toolRows = Array.from(
      container.querySelectorAll<HTMLElement>('[data-testid="tool-call-item"]'),
    );

    expect(toolRows).toHaveLength(2);
    expect(toolRows[0]?.dataset.grouped).toBe("yes");
    expect(toolRows[0]?.dataset.groupMarker).toBe("└");
    expect(toolRows[1]?.dataset.grouped).toBe("yes");
    expect(toolRows[1]?.dataset.groupMarker).toBe("·");
  });

  it("历史非活跃过程即使残留运行中状态也应默认折叠明细", () => {
    const container = renderTimeline(
      [
        {
          ...createBaseItem("browser-1", 1),
          status: "in_progress",
          completed_at: undefined,
          type: "tool_call",
          tool_name: "browser_navigate",
          arguments: { url: "https://example.com" },
        },
        {
          ...createBaseItem("browser-2", 2),
          status: "in_progress",
          completed_at: undefined,
          type: "tool_call",
          tool_name: "browser_click",
          arguments: { selector: "#publish" },
        },
      ],
      {
        turn: {
          status: "completed",
        },
        collapseInactiveDetails: true,
      },
    );

    const block = container.querySelector<HTMLDetailsElement>(
      '[data-testid="agent-thread-block:1:process"]',
    );

    expect(block?.open).toBe(false);
    expect(block?.querySelector("summary")?.textContent).toContain("2 步");
    expect(
      container.querySelectorAll('[data-testid="tool-call-item"]'),
    ).toHaveLength(0);
  });

  it("连续执行流里有运行中步骤时，应聚合为一个高亮过程块", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("browser-1", 1),
        type: "tool_call",
        tool_name: "browser_navigate",
        arguments: { url: "https://example.com" },
      },
      {
        ...createBaseItem("search-1", 2),
        status: "in_progress",
        completed_at: undefined,
        updated_at: at(2),
        type: "web_search",
        action: "web_search",
        query: "Mac mini 最新价格",
      },
      {
        ...createBaseItem("other-1", 3),
        type: "tool_call",
        tool_name: "workspace_sync",
      },
    ];

    const container = renderTimeline(items, { isCurrentTurn: true });
    const processBlock = container.querySelector<HTMLElement>(
      '[data-testid="agent-thread-block:1:process"]',
    );

    expect(processBlock?.dataset.emphasis).toBe("active");
    expect(container.textContent).toContain("Mac mini 最新价格");
  });

  it("存在待处理请求时应显示轻量待处理提示", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("action-1", 1),
        type: "tool_call",
        tool_name: "write_file",
        arguments: { path: "publish.md" },
      },
    ];

    const container = renderTimeline(items, {
      turn: {
        status: "aborted",
      },
      actionRequests: [
        {
          requestId: "req-title",
          actionType: "ask_user",
          status: "pending",
          prompt: "请先确认文章标题。",
          questions: [{ question: "这篇文章的最终标题是什么？" }],
        },
      ],
    });

    expect(
      container.querySelector('[data-testid="agent-thread-inline-status"]')
        ?.textContent,
    ).toContain("待处理");
    expect(container.textContent).toContain("确认文章标题");
    expect(container.textContent).not.toContain("已中断");
  });

  it("运行时权限确认等待不应渲染为失败或暴露内部字段", () => {
    const internalError =
      "运行时权限声明需要真实确认，当前 turn 已在模型执行前等待用户确认：confirmationStatus=not_requested，askProfileKeys=web_search, write_artifacts。已创建真实权限确认请求；请确认后重试或恢复本轮执行。";
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("permission-request-1", 1),
        status: "in_progress",
        completed_at: undefined,
        type: "request_user_input",
        request_id: "runtime_permission_confirmation:turn-1",
        action_type: "elicitation",
        prompt:
          "当前执行需要确认运行时权限：web_search, write_artifacts。确认后才允许继续模型执行；拒绝会保持阻断。",
        questions: [
          {
            header: "运行时权限确认",
            question:
              "当前执行需要确认运行时权限：web_search, write_artifacts。确认后才允许继续模型执行；拒绝会保持阻断。",
            options: [{ label: "允许本次执行" }, { label: "拒绝" }],
          },
        ],
      },
      {
        ...createBaseItem("permission-error-1", 2),
        type: "error",
        message: internalError,
      },
    ];

    const container = renderTimeline(items, {
      turn: {
        status: "failed",
        error_message: internalError,
      },
    });

    expect(
      container.querySelector('[data-testid="agent-thread-inline-status"]')
        ?.textContent,
    ).toContain("待处理");
    expect(container.textContent).toContain("当前执行需要确认运行时权限");
    expect(container.textContent).toContain("运行时权限确认");
    expect(container.textContent).not.toContain("碰到错误");
    expect(container.textContent).not.toContain("失败");
    expect(container.textContent).not.toContain("confirmationStatus");
    expect(container.textContent).not.toContain("askProfileKeys");
  });

  it("运行时权限确认提交后仍不应重新暴露内部等待错误", () => {
    const internalError =
      "运行时权限声明需要真实确认，当前 turn 已在模型执行前等待用户确认：confirmationStatus=confirmed，askProfileKeys=web_search。已创建真实权限确认请求；请确认后重试或恢复本轮执行。";
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("permission-request-1", 1),
        type: "request_user_input",
        request_id: "runtime_permission_confirmation:turn-1",
        action_type: "elicitation",
        status: "completed",
        prompt:
          "当前执行需要确认运行时权限：web_search。确认后才允许继续模型执行；拒绝会保持阻断。",
        response: { answer: "允许本次执行" },
      },
      {
        ...createBaseItem("permission-error-1", 2),
        type: "error",
        message: internalError,
      },
    ];

    const container = renderTimeline(items, {
      turn: {
        status: "failed",
        error_message: internalError,
      },
      actionRequests: [
        {
          requestId: "runtime_permission_confirmation:turn-1",
          actionType: "elicitation",
          prompt:
            "当前执行需要确认运行时权限：web_search。确认后才允许继续模型执行；拒绝会保持阻断。",
          status: "submitted",
          submittedUserData: { answer: "允许本次执行" },
        },
      ],
    });

    expect(
      container.querySelector('[data-testid="agent-thread-inline-status"]')
        ?.textContent,
    ).toContain("已确认");
    expect(container.textContent).toContain("继续处理当前任务");
    expect(container.textContent).not.toContain("碰到错误");
    expect(container.textContent).not.toContain("失败");
    expect(container.textContent).not.toContain("confirmationStatus");
    expect(container.textContent).not.toContain("askProfileKeys");
  });

  it("普通 aborted 回合应显示已暂停提示", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("other-1", 1),
        type: "tool_call",
        tool_name: "workspace_sync",
      },
    ];

    const container = renderTimeline(items, {
      turn: {
        status: "aborted",
      },
    });

    expect(
      container.querySelector('[data-testid="agent-thread-inline-status"]')
        ?.textContent,
    ).toContain("已暂停");
    expect(container.textContent).not.toContain("已中断");
  });

  it("思考摘要中的 A2UI 代码块应切换为结构化预览", () => {
    parseAIResponseMock.mockReturnValue(createStructuredA2UIParseResult());

    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("summary-1", 1),
        status: "in_progress",
        completed_at: undefined,
        updated_at: at(1),
        type: "turn_summary",
        text: "```a2ui\n{}\n```",
      },
    ];

    const container = renderTimeline(items, {
      isCurrentTurn: true,
      turn: {
        status: "running",
      },
    });

    expect(
      container.querySelector('[data-testid="timeline-a2ui-card"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("处理中");
    expect(container.textContent).toContain("请先确认以下选项：");
    expect(container.textContent).not.toContain("```a2ui");
  });

  it("内部路由型 turn_summary 完成态应降级为中性进展提示", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("summary-1", 1),
        type: "turn_summary",
        text: "直接回答优先\n当前请求无需默认升级为搜索或任务，先直接给出结果，必要时再调用工具。",
      },
    ];

    const container = renderTimeline(items, {
      turn: {
        status: "completed",
      },
    });

    expect(container.textContent).toContain("当前进展");
    expect(container.textContent).not.toContain("直接回答优先");
    expect(container.textContent).not.toContain("已完成思考");
  });

  it("reasoning 中的 A2UI 代码块不应被跳过", () => {
    parseAIResponseMock.mockReturnValue(createStructuredA2UIParseResult());

    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("reasoning-1", 1),
        status: "in_progress",
        completed_at: undefined,
        updated_at: at(1),
        type: "reasoning",
        text: "```a2ui\n{}\n```",
      },
    ];

    const container = renderTimeline(items, {
      isCurrentTurn: true,
      turn: {
        status: "running",
      },
    });

    expect(
      container.querySelector('[data-testid="timeline-a2ui-card"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("请先确认以下选项：");
    expect(container.textContent).not.toContain("```a2ui");
  });

  it("已完成 reasoning 中的 A2UI 代码块应直接显示结构化预览", () => {
    parseAIResponseMock.mockReturnValue(createStructuredA2UIParseResult());

    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("reasoning-1", 1),
        type: "reasoning",
        text: "```a2ui\n{}\n```",
      },
    ];

    const container = renderTimeline(items, {
      turn: {
        status: "completed",
      },
    });

    expect(
      container.querySelector('[data-testid="timeline-a2ui-card"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("请先确认以下选项：");
    expect(container.textContent).not.toContain("```a2ui");
  });

  it("纯 reasoning 阶段仅在时间线中出现一次", () => {
    const reasoningText = "先核对执行链路，再立即恢复当前运行。";
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("reasoning-1", 1),
        type: "reasoning",
        text: reasoningText,
      },
    ];

    const container = renderTimeline(items, {
      isCurrentTurn: true,
      turn: {
        status: "running",
      },
    });

    expect(
      container.querySelector(
        '[data-testid="agent-thread-block:1:process:details"]',
      ),
    ).toBeNull();
    expect(container.textContent).not.toContain("思考摘要");
    expect((container.textContent?.split(reasoningText).length ?? 1) - 1).toBe(
      1,
    );
  });

  it("已完成的单条思考应默认保留完整正文", () => {
    const reasoningText =
      "先核对执行链路，再立即恢复当前运行。\n随后补齐自动续提。";
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("reasoning-1", 1),
        type: "reasoning",
        text: reasoningText,
      },
    ];

    const container = renderTimeline(items, {
      turn: {
        status: "completed",
      },
    });

    expect(
      container.querySelector(
        '[data-testid="agent-thread-block:1:process:details"]',
      ),
    ).toBeNull();
    expect(container.textContent).toContain(
      "先核对执行链路，再立即恢复当前运行。",
    );
    expect(container.textContent).toContain("随后补齐自动续提。");
  });

  it("reasoning 展开后应压平被切碎成多行的过程 prose", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("reasoning-1", 1),
        type: "reasoning",
        text: [
          "目录",
          "",
          "也",
          "",
          "不存在。",
          "",
          "可能",
          "",
          "整个",
          "",
          ".lime",
          "",
          "目录",
          "",
          "都不",
          "",
          "存在。",
        ].join("\n"),
      },
    ];

    const container = renderTimeline(items, {
      turn: {
        status: "completed",
      },
    });

    const summary = container.querySelector("summary");
    act(() => {
      summary?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const markdownBlocks = container.querySelectorAll(
      '[data-testid="markdown-renderer"]',
    );
    expect(markdownBlocks[0]?.textContent).toBe(
      "目录也不存在。可能整个 .lime 目录都不存在。",
    );
  });

  it("reasoning 缺少正文时应回退显示 summary", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("reasoning-1", 1),
        type: "reasoning",
        text: "",
        summary: ["先判断任务类型", "再决定是否联网"],
      },
    ];

    const container = renderTimeline(items, {
      turn: {
        status: "completed",
      },
    });

    expect(container.textContent).toContain("先判断任务类型");
    expect(container.textContent).toContain("再决定是否联网");
  });

  it("reasoning 同时存在 summary 与正文时应优先用 summary 做摘要", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("reasoning-1", 1),
        type: "reasoning",
        text: "这里是更完整的正文。",
        summary: ["先判断任务类型", "再决定是否联网"],
      },
    ];

    const container = renderTimeline(items, {
      turn: {
        status: "completed",
      },
    });

    expect(container.textContent).toContain("先判断任务类型");
    expect(container.textContent).toContain("再决定是否联网");
    expect(container.textContent).toContain("这里是更完整的正文。");
  });

  it("reasoning 的 summary 与正文相同时不应重复渲染", () => {
    const repeatedText = "先判断任务类型\n\n再决定是否联网";
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("reasoning-1", 1),
        type: "reasoning",
        text: repeatedText,
        summary: ["先判断任务类型", "再决定是否联网"],
      },
    ];

    const container = renderTimeline(items, {
      turn: {
        status: "completed",
      },
    });

    const summary = container.querySelector("summary");
    act(() => {
      summary?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(
      (container.textContent?.split("先判断任务类型").length ?? 1) - 1,
    ).toBe(1);
    expect(
      (container.textContent?.split("再决定是否联网").length ?? 1) - 1,
    ).toBe(1);
  });

  it("已完成的 request_user_input 应以只读 A2UI 卡片回显", () => {
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("input-1", 1),
        type: "request_user_input",
        request_id: "req-ask-1",
        action_type: "ask_user",
        prompt: "请选择执行模式",
        questions: [
          {
            question: "请选择执行模式",
            options: [{ label: "自动执行" }, { label: "确认后执行" }],
          },
        ],
        response: { answer: "自动执行" },
      },
    ];

    const container = renderTimeline(items, {
      turn: {
        status: "completed",
      },
    });

    expect(
      container.querySelector('[data-testid="timeline-a2ui-card"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="decision-panel"]'),
    ).toBeNull();
  });

  it("真实子任务 item 应支持查看子任务详情", () => {
    const onOpenSubagentSession = vi.fn();
    const items: AgentThreadItem[] = [
      {
        ...createBaseItem("subagent-1", 1),
        type: "subagent_activity",
        status: "completed",
        status_label: "completed",
        title: "Image #1",
        summary: "封面图已生成",
        role: "image_editor",
        model: "gpt-image-1",
        session_id: "child-session-1",
      },
    ];

    const container = renderTimeline(items, {
      onOpenSubagentSession,
    });

    expect(container.textContent).toContain("图片任务 1");
    expect(container.textContent).not.toContain("Image #1");
    expect(container.textContent).toContain("子任务：图片任务 1");

    const button = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((element) => element.textContent?.includes("查看子任务详情"));

    expect(button).toBeTruthy();

    act(() => {
      button?.click();
    });

    expect(onOpenSubagentSession).toHaveBeenCalledWith("child-session-1");
  });
});
