import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRuntimeToolInventory } from "@/lib/api/agentRuntime";
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
let originalWindowOpen: typeof window.open;

function createHarnessState(
  overrides: Partial<HarnessSessionState> = {},
): HarnessSessionState {
  return {
    runtimeStatus: null,
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
    activeFileWrites: [],
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
        compatSubagentRuntime={{
          isRunning: false,
          progress: null,
          events: [],
          result: null,
          error: null,
          recentActivity: [],
          hasSignals: false,
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

function createToolInventory(): AgentRuntimeToolInventory {
  return {
    request: {
      caller: "assistant",
      surface: {
        creator: false,
        browser_assist: true,
      },
    },
    agent_initialized: true,
    warnings: ["extension 搜索工具面存在延迟加载项"],
    mcp_servers: ["lime-browser"],
    default_allowed_tools: ["tool_search", "WebSearch"],
    counts: {
      catalog_total: 3,
      catalog_current_total: 3,
      catalog_compat_total: 0,
      catalog_deprecated_total: 0,
      default_allowed_total: 2,
      registry_total: 2,
      registry_visible_total: 1,
      registry_catalog_unmapped_total: 0,
      extension_surface_total: 1,
      extension_mcp_bridge_total: 1,
      extension_runtime_total: 0,
      extension_tool_total: 1,
      extension_tool_visible_total: 1,
      mcp_server_total: 1,
      mcp_tool_total: 1,
      mcp_tool_visible_total: 1,
    },
    catalog_tools: [
      {
        name: "bash",
        profiles: ["core"],
        capabilities: ["execution"],
        lifecycle: "current",
        source: "aster_builtin",
        permission_plane: "parameter_restricted",
        workspace_default_allow: false,
        execution_warning_policy: "shell_command_risk",
        execution_warning_policy_source: "runtime",
        execution_restriction_profile: "workspace_shell_command",
        execution_restriction_profile_source: "runtime",
        execution_sandbox_profile: "workspace_command",
        execution_sandbox_profile_source: "runtime",
      },
      {
        name: "write",
        profiles: ["core"],
        capabilities: ["workspace_io"],
        lifecycle: "current",
        source: "aster_builtin",
        permission_plane: "parameter_restricted",
        workspace_default_allow: false,
        execution_warning_policy: "none",
        execution_warning_policy_source: "persisted",
        execution_restriction_profile: "workspace_path_required",
        execution_restriction_profile_source: "persisted",
        execution_sandbox_profile: "none",
        execution_sandbox_profile_source: "default",
      },
      {
        name: "tool_search",
        profiles: ["core"],
        capabilities: ["web_search"],
        lifecycle: "current",
        source: "lime_injected",
        permission_plane: "session_allowlist",
        workspace_default_allow: true,
        execution_warning_policy: "none",
        execution_warning_policy_source: "default",
        execution_restriction_profile: "none",
        execution_restriction_profile_source: "default",
        execution_sandbox_profile: "none",
        execution_sandbox_profile_source: "default",
      },
    ],
    registry_tools: [
      {
        name: "bash",
        description: "执行工作区命令",
        catalog_entry_name: "bash",
        catalog_source: "aster_builtin",
        catalog_lifecycle: "current",
        catalog_permission_plane: "parameter_restricted",
        catalog_workspace_default_allow: false,
        catalog_execution_warning_policy: "shell_command_risk",
        catalog_execution_warning_policy_source: "runtime",
        catalog_execution_restriction_profile: "workspace_shell_command",
        catalog_execution_restriction_profile_source: "runtime",
        catalog_execution_sandbox_profile: "workspace_command",
        catalog_execution_sandbox_profile_source: "runtime",
        deferred_loading: false,
        always_visible: false,
        allowed_callers: ["assistant"],
        tags: ["shell"],
        input_examples_count: 2,
        caller_allowed: true,
        visible_in_context: true,
      },
      {
        name: "tool_search",
        description: "搜索工具目录",
        catalog_entry_name: "tool_search",
        catalog_source: "lime_injected",
        catalog_lifecycle: "current",
        catalog_permission_plane: "session_allowlist",
        catalog_workspace_default_allow: true,
        catalog_execution_warning_policy: "none",
        catalog_execution_warning_policy_source: "default",
        catalog_execution_restriction_profile: "none",
        catalog_execution_restriction_profile_source: "default",
        catalog_execution_sandbox_profile: "none",
        catalog_execution_sandbox_profile_source: "default",
        deferred_loading: true,
        always_visible: true,
        allowed_callers: [],
        tags: ["search"],
        input_examples_count: 1,
        caller_allowed: false,
        visible_in_context: false,
      },
    ],
    extension_surfaces: [
      {
        extension_name: "lime-browser",
        description: "浏览器桥接工具面",
        source_kind: "mcp_bridge",
        deferred_loading: true,
        allowed_caller: "assistant",
        available_tools: ["navigate", "click"],
        always_expose_tools: ["navigate"],
        loaded_tools: ["mcp__lime-browser__navigate"],
        searchable_tools: [
          "mcp__lime-browser__navigate",
          "mcp__lime-browser__click",
        ],
      },
    ],
    extension_tools: [
      {
        name: "mcp__lime-browser__navigate",
        description: "打开网页",
        extension_name: "lime-browser",
        source_kind: "mcp_bridge",
        deferred_loading: false,
        allowed_caller: "assistant",
        status: "loaded",
        caller_allowed: true,
        visible_in_context: true,
      },
    ],
    mcp_tools: [
      {
        server_name: "lime-browser",
        name: "mcp__lime-browser__navigate",
        description: "导航到指定页面",
        deferred_loading: false,
        always_visible: true,
        allowed_callers: ["assistant"],
        tags: ["browser", "navigation"],
        input_examples_count: 1,
        caller_allowed: true,
        visible_in_context: true,
      },
    ],
  };
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
  originalWindowOpen = window.open;
  Object.defineProperty(window, "open", {
    configurable: true,
    value: vi.fn(),
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
  Object.defineProperty(window, "open", {
    configurable: true,
    value: originalWindowOpen,
  });
  vi.clearAllMocks();
});

describe("HarnessStatusPanel", () => {
  it("弹窗模式应默认展示完整内容且不渲染展开按钮", () => {
    const { container } = renderPanel({
      layout: "dialog",
    });
    const panel = container.querySelector(
      '[data-testid="harness-status-panel"]',
    ) as HTMLDivElement | null;
    const scrollArea = container.querySelector(
      '[data-testid="harness-status-panel"] > .relative.overflow-auto',
    ) as HTMLDivElement | null;

    expect(document.body.textContent).toContain("待审批");
    expect(document.body.textContent).toContain("文件活动");
    expect(document.body.textContent).toContain("计划状态");
    expect(document.body.textContent).toContain("上下文");
    expect(document.body.textContent).not.toContain("展开详情");
    expect(document.body.textContent).not.toContain("收起详情");
    expect(panel?.className).toContain("flex");
    expect(panel?.className).toContain("h-full");
    expect(panel?.children.length).toBe(2);
    expect(scrollArea?.className).toContain("flex-1");
    expect(scrollArea?.className).toContain("min-h-0");
    expect(panel?.querySelector(".sticky.top-0")).toBeNull();
  });

  it("弹窗模式应让前置概览跟随滚动区，而不是固定在顶部", () => {
    const { container } = renderPanel({
      layout: "dialog",
      leadContent: <div>通用 Agent 运行概览</div>,
    });
    const panel = container.querySelector(
      '[data-testid="harness-status-panel"]',
    ) as HTMLDivElement | null;
    const scrollArea = container.querySelector(
      '[data-testid="harness-status-panel"] > .relative.overflow-auto',
    ) as HTMLDivElement | null;

    expect(panel?.children.length).toBe(2);
    expect(scrollArea?.textContent).toContain("通用 Agent 运行概览");
  });

  it("应支持自定义标题说明与前置运行概览内容", () => {
    renderPanel({
      title: "处理工作台",
      description: "集中查看代理运行轨迹。",
      toggleLabel: "工作台详情",
      leadContent: <div>通用 Agent 运行概览</div>,
    });

    expect(document.body.textContent).toContain("处理工作台");
    expect(document.body.textContent).toContain("集中查看代理运行轨迹。");
    expect(document.body.textContent).toContain("通用 Agent 运行概览");
    expect(document.body.textContent).toContain("收起工作台详情");
  });

  it("未激活 skill 时不应渲染技能区块与导航入口", () => {
    renderPanel({
      environment: {
        skillsCount: 0,
        skillNames: [],
        memorySignals: ["风格"],
        contextItemsCount: 2,
        activeContextCount: 1,
        contextItemNames: ["需求.md"],
        contextEnabled: true,
      },
    });

    expect(document.body.textContent).not.toContain("已激活技能");
    expect(
      document.body.querySelector('button[aria-label="跳转到已激活技能"]'),
    ).toBeNull();
  });

  it("存在 runtimeStatus 时应在工作台中展示当前执行阶段", () => {
    renderPanel({
      harnessState: createHarnessState({
        runtimeStatus: {
          phase: "routing",
          title: "正在启动处理流程",
          detail: "已提交到运行时，正在等待首个执行事件。",
          checkpoints: ["会话已建立", "等待首个模型事件"],
        },
      }),
    });

    expect(document.body.textContent).toContain("当前任务");
    expect(document.body.textContent).toContain("任务进展");
    expect(document.body.textContent).toContain("正在启动处理流程");
    expect(document.body.textContent).toContain("等待首个模型事件");
  });

  it("存在线程可靠性信号时应在工作台展示可靠性入口与面板", () => {
    renderPanel({
      layout: "dialog",
      turns: [
        {
          id: "turn-reliability",
          thread_id: "thread-1",
          prompt_text: "继续发布文章",
          status: "running",
          started_at: "2026-03-24T09:00:00Z",
          created_at: "2026-03-24T09:00:00Z",
          updated_at: "2026-03-24T09:00:12Z",
        },
      ],
      currentTurnId: "turn-reliability",
      pendingActions: [
        {
          requestId: "req-reliability-1",
          actionType: "ask_user",
          prompt: "请确认是否继续发布",
          status: "pending",
        },
      ],
    });

    expect(document.body.textContent).toContain("线程可靠性");
    expect(document.body.textContent).toContain("请确认是否继续发布");
    expect(
      document.body.querySelector('button[aria-label="跳转到可靠性"]'),
    ).not.toBeNull();
  });

  it("runtimeStatus 为 failed 时应展示失败阶段与失败详情", () => {
    renderPanel({
      harnessState: createHarnessState({
        runtimeStatus: {
          phase: "failed",
          title: "当前处理失败",
          detail: "429 rate limit",
          checkpoints: ["已保留当前阶段记录"],
        },
      }),
    });

    expect(document.body.textContent).toContain("当前任务");
    expect(document.body.textContent).toContain("失败");
    expect(document.body.textContent).toContain("当前处理失败");
    expect(document.body.textContent).toContain("429 rate limit");
  });

  it("存在 selectedTeam 时应在工作台展示当前协作设置", () => {
    renderPanel({
      selectedTeamLabel: "前端联调团队",
      selectedTeamSummary: "分析、实现、验证三段式推进。",
      selectedTeamRoles: [
        {
          id: "explorer",
          label: "分析",
          summary: "负责定位问题、澄清范围。",
          profileId: "code-explorer",
          roleKey: "explorer",
          skillIds: ["repo-exploration", "source-grounding"],
        },
      ],
    });

    expect(document.body.textContent).toContain("协作设置");
    expect(document.body.textContent).toContain("当前协作设置");
    expect(document.body.textContent).toContain("前端联调团队");
    expect(document.body.textContent).toContain("分析、实现、验证三段式推进。");
    expect(document.body.textContent).toContain("模板 code-explorer");
    expect(document.body.textContent).toContain("职责 explorer");
    expect(document.body.textContent).toContain("repo-exploration");
  });

  it("存在真实 child session 时应优先展示协作会话摘要，并将旧 scheduler 降级为兼容轨迹", () => {
    renderPanel({
      childSubagentSessions: [
        {
          id: "child-1",
          name: "研究代理",
          created_at: 1_710_000_000,
          updated_at: 1_710_000_200,
          session_type: "sub_agent",
          runtime_status: "running",
          latest_turn_status: "running",
          task_summary: "并行整理竞品与证据链",
          role_hint: "explorer",
        },
        {
          id: "child-2",
          name: "实现代理",
          created_at: 1_710_000_010,
          updated_at: 1_710_000_220,
          session_type: "sub_agent",
          runtime_status: "queued",
          latest_turn_status: "queued",
          task_summary: "起草第一版落地方案",
          role_hint: "executor",
        },
      ],
      compatSubagentRuntime: {
        isRunning: true,
        progress: {
          total: 2,
          completed: 1,
          failed: 0,
          running: 1,
          pending: 0,
          skipped: 0,
          cancelled: false,
          currentTasks: ["legacy-task-1"],
          percentage: 50,
        },
        events: [{ type: "started", totalTasks: 2 }],
        result: null,
        error: null,
        recentActivity: [
          {
            id: "compat:1:started",
            summary: "开始调度 2 个子任务",
          },
        ],
        hasSignals: true,
      },
    });

    expect(document.body.textContent).toContain("协作处理中");
    expect(document.body.textContent).toContain("协作会话");
    expect(document.body.textContent).toContain("当前协作会话");
    expect(document.body.textContent).toContain("实时协作会话");
    expect(document.body.textContent).toContain("兼容模式");
    expect(document.body.textContent).toContain("旧链路");
    expect(document.body.textContent).not.toContain("兼容调度进度");
    expect(document.body.textContent).not.toContain("兼容调度轨迹");
    expect(document.body.textContent).toContain("研究代理");
    expect(document.body.textContent).toContain("实现代理");
  });

  it("仅有计划摘要兜底时也应在工作台显示已就绪计划状态", () => {
    renderPanel({
      harnessState: createHarnessState({
        plan: {
          phase: "ready",
          items: [],
          summaryText: "已决定：直接回答优先\n当前请求无需工具介入。",
        },
      }),
    });

    expect(document.body.textContent).toContain("计划状态");
    expect(document.body.textContent).toContain("已就绪");
    expect(document.body.textContent).toContain("已决定：直接回答优先");
    expect(document.body.textContent).toContain("规划状态");
  });

  it("存在 activeFileWrites 时应在工作台中展示当前文件写入", () => {
    renderPanel({
      harnessState: createHarnessState({
        activeFileWrites: [
          {
            id: "write-1",
            path: "/tmp/workspace/live.md",
            displayName: "live.md",
            phase: "streaming",
            status: "streaming",
            source: "artifact_snapshot",
            updatedAt: new Date("2026-03-13T12:00:00.000Z"),
            preview: "# 草稿\n正在写入",
            latestChunk: "正在写入",
            content: "# 草稿\n正在写入",
          },
        ],
      }),
    });

    expect(document.body.textContent).toContain("当前文件写入");
    expect(document.body.textContent).toContain("live.md");
    expect(document.body.textContent).toContain("正在写入");
    expect(document.body.textContent).toContain("快照同步");
  });

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

  it("待审批区块应通过 artifact protocol 展示嵌套参数里的路径", () => {
    renderPanel({
      harnessState: createHarnessState({
        pendingApprovals: [
          {
            requestId: "approval-path-1",
            actionType: "tool_confirmation",
            prompt: "确认写入主稿",
            toolName: "write_file",
            arguments: {
              payload: {
                filePath: "workspace/approval-draft.md",
              },
            },
          },
        ],
      }),
    });

    expect(document.body.textContent).toContain("workspace/approval-draft.md");
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

  it("搜索输出应展示结果列表并支持悬浮预览", async () => {
    renderPanel({
      harnessState: createHarnessState({
        outputSignals: [
          {
            id: "signal-search",
            toolCallId: "tool-search",
            toolName: "WebSearch",
            title: "联网检索摘要",
            summary: "3月13日国际新闻",
            content: [
              "Xinhua world news summary at 0030 GMT, March 13",
              "https://example.com/xinhua",
              "全球要闻摘要，覆盖国际局势与市场动态。",
              "",
              "Friday morning news: March 13, 2026 | WORLD - wng.org",
              "https://example.com/wng",
              "补充国际动态与区域冲突更新。",
            ].join("\n"),
          },
        ],
      }),
    });

    expect(document.body.textContent).toContain("3月13日国际新闻");
    expect(document.body.textContent).toContain(
      "Xinhua world news summary at 0030 GMT, March 13",
    );
    expect(document.body.textContent).toContain(
      "Friday morning news: March 13, 2026 | WORLD - wng.org",
    );

    const collapseButton = document.body.querySelector(
      'button[aria-label="收起搜索结果：3月13日国际新闻"]',
    ) as HTMLButtonElement | null;

    act(() => {
      collapseButton?.click();
    });

    expect(document.body.textContent).not.toContain(
      "Xinhua world news summary at 0030 GMT, March 13",
    );

    const expandButton = document.body.querySelector(
      'button[aria-label="展开搜索结果：3月13日国际新闻"]',
    ) as HTMLButtonElement | null;

    act(() => {
      expandButton?.click();
    });

    expect(document.body.textContent).toContain(
      "Xinhua world news summary at 0030 GMT, March 13",
    );

    const firstSearchResult = document.body.querySelector(
      '[aria-label="预览搜索结果：Xinhua world news summary at 0030 GMT, March 13"]',
    ) as HTMLButtonElement | null;

    await act(async () => {
      firstSearchResult?.dispatchEvent(
        new MouseEvent("mouseover", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain(
      "全球要闻摘要，覆盖国际局势与市场动态。",
    );
    expect(document.body.textContent).toContain("https://example.com/xinhua");
    expect(document.body.querySelector('[data-side="left"]')).not.toBeNull();

    await act(async () => {
      firstSearchResult?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(window.open).toHaveBeenCalledWith(
      "https://example.com/xinhua",
      "_blank",
    );
  });

  it("连续多条搜索输出应在 harness 中按搜索批次分组展示", () => {
    renderPanel({
      harnessState: createHarnessState({
        outputSignals: [
          {
            id: "signal-search-1",
            toolCallId: "tool-search-1",
            toolName: "WebSearch",
            title: "联网检索摘要",
            summary: "3月13日国际新闻",
            content: "https://example.com/1",
          },
          {
            id: "signal-search-2",
            toolCallId: "tool-search-2",
            toolName: "WebSearch",
            title: "联网检索摘要",
            summary: "March 13 2026 world headlines",
            content: "https://example.com/2",
          },
        ],
      }),
    });

    expect(document.body.textContent).toContain("已搜索 2 组查询");
    expect(document.body.textContent).toContain("3月13日国际新闻");
    expect(document.body.textContent).toContain(
      "March 13 2026 world headlines",
    );
    expect(document.body.textContent).toContain("中文日期检索");
    expect(document.body.textContent).toContain("头条检索");
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
    const revealButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("定位文件"));
    const openPathButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("系统打开"));

    await act(async () => {
      copyPathButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      revealButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      openPathButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "/tmp/workspace/draft.md",
    );
    expect(onRevealPath).toHaveBeenCalledWith("/tmp/workspace/draft.md");
    expect(onOpenPath).toHaveBeenCalledWith("/tmp/workspace/draft.md");
  });

  it("应支持直接点击文件路径并系统打开", async () => {
    const onOpenPath = vi.fn().mockResolvedValue(undefined);

    renderPanel({
      harnessState: createHarnessState({
        recentFileEvents: [
          {
            id: "event-open-path",
            toolCallId: "tool-open-path",
            path: "/tmp/workspace/direct-open.md",
            displayName: "direct-open.md",
            kind: "document",
            action: "write",
            sourceToolName: "Write",
            timestamp: new Date("2026-03-13T12:20:00.000Z"),
            preview: "直接打开路径",
            clickable: true,
          },
        ],
      }),
      onOpenPath,
    });

    const pathLink = document.body.querySelector(
      '[aria-label="系统打开路径：/tmp/workspace/direct-open.md"]',
    ) as HTMLElement | null;

    await act(async () => {
      pathLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onOpenPath).toHaveBeenCalledWith("/tmp/workspace/direct-open.md");
  });

  it("应支持直接点击工作台中的 URL 链接", async () => {
    renderPanel({
      harnessState: createHarnessState({
        latestContextTrace: [
          {
            stage: "联网检索",
            detail:
              "已获取资料：https://example.com/report ，可继续打开查看完整来源。",
          },
        ],
      }),
    });

    const urlLink = document.body.querySelector(
      '[aria-label="打开链接：https://example.com/report"]',
    ) as HTMLElement | null;

    await act(async () => {
      urlLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(window.open).toHaveBeenCalledWith(
      "https://example.com/report",
      "_blank",
    );
  });

  it("能力区中的上下文路径应支持直接系统打开", async () => {
    const onOpenPath = vi.fn().mockResolvedValue(undefined);

    renderPanel({
      environment: {
        skillsCount: 2,
        skillNames: ["read_file", "write_todos"],
        memorySignals: ["风格"],
        contextItemsCount: 2,
        activeContextCount: 1,
        contextItemNames: ["/tmp/workspace/context/brief.md"],
        contextEnabled: true,
      },
      onOpenPath,
    });

    const pathLink = document.body.querySelector(
      '[aria-label="系统打开路径：/tmp/workspace/context/brief.md"]',
    ) as HTMLElement | null;

    await act(async () => {
      pathLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onOpenPath).toHaveBeenCalledWith("/tmp/workspace/context/brief.md");
  });

  it("存在工具库存时应展示工具与权限区块及来源统计", () => {
    renderPanel({
      toolInventory: createToolInventory(),
    });

    expect(document.body.textContent).toContain("工具与权限");
    expect(document.body.textContent).toContain("工具库存");
    expect(document.body.textContent).toContain("运行时覆盖");
    expect(document.body.textContent).toContain("持久化覆盖");
    expect(document.body.textContent).toContain("默认策略");
    expect(document.body.textContent).toContain("Catalog 工具");
  });

  it("工具库存应支持按来源筛选 catalog 条目", () => {
    renderPanel({
      toolInventory: createToolInventory(),
    });

    const runtimeFilterButton = document.body.querySelector(
      'button[aria-label="工具库存筛选：运行时覆盖"]',
    ) as HTMLButtonElement | null;

    act(() => {
      runtimeFilterButton?.click();
    });

    const inventorySection = document.body.querySelector(
      '[data-harness-section="inventory"]',
    ) as HTMLElement | null;

    expect(inventorySection?.textContent).toContain("Catalog 工具");
    expect(inventorySection?.textContent).toContain("1 / 3");
    expect(inventorySection?.textContent).toContain("bash");
    expect(inventorySection?.textContent).not.toContain("write");
  });

  it("工具库存加载失败时应展示错误并支持手动刷新", () => {
    const onRefreshToolInventory = vi.fn();

    renderPanel({
      toolInventoryLoading: true,
      toolInventoryError: "读取失败",
      onRefreshToolInventory,
    });

    expect(document.body.textContent).toContain(
      "正在同步当前工具库存与权限策略",
    );
    expect(document.body.textContent).toContain("读取失败");

    const refreshButton = document.body.querySelector(
      'button[aria-label="刷新工具库存"]',
    ) as HTMLButtonElement | null;

    act(() => {
      refreshButton?.click();
    });

    expect(onRefreshToolInventory).toHaveBeenCalledTimes(1);
  });
});
