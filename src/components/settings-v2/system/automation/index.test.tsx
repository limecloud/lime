import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutomationSettings } from ".";

const {
  mockGetAutomationSchedulerConfig,
  mockGetAutomationStatus,
  mockGetAutomationJobs,
  mockGetAutomationHealth,
  mockGetAutomationRunHistory,
  mockListProjects,
  mockAutomationJobDialog,
} = vi.hoisted(() => ({
  mockGetAutomationSchedulerConfig: vi.fn(),
  mockGetAutomationStatus: vi.fn(),
  mockGetAutomationJobs: vi.fn(),
  mockGetAutomationHealth: vi.fn(),
  mockGetAutomationRunHistory: vi.fn(),
  mockListProjects: vi.fn(),
  mockAutomationJobDialog: vi.fn(),
}));

vi.mock("@/lib/api/automation", () => ({
  getAutomationSchedulerConfig: mockGetAutomationSchedulerConfig,
  getAutomationStatus: mockGetAutomationStatus,
  getAutomationJobs: mockGetAutomationJobs,
  getAutomationHealth: mockGetAutomationHealth,
  getAutomationRunHistory: mockGetAutomationRunHistory,
  createAutomationJob: vi.fn(),
  updateAutomationJob: vi.fn(),
  deleteAutomationJob: vi.fn(),
  runAutomationJobNow: vi.fn(),
  updateAutomationSchedulerConfig: vi.fn(),
}));

vi.mock("@/lib/api/project", () => ({
  listProjects: mockListProjects,
}));

vi.mock("./AutomationHealthPanel", () => ({
  AutomationHealthPanel: () => <div data-testid="automation-health-panel" />,
}));

vi.mock("./AutomationJobDialog", () => ({
  AutomationJobDialog: (props: {
    open: boolean;
    mode: "create" | "edit";
    initialValues?: Record<string, unknown> | null;
  }) => {
    mockAutomationJobDialog(props);
    const payloadKind =
      props.initialValues &&
      typeof props.initialValues.payload_kind === "string"
        ? props.initialValues.payload_kind
        : "-";
    const scheduleKind =
      props.initialValues &&
      typeof props.initialValues.schedule_kind === "string"
        ? props.initialValues.schedule_kind
        : "-";
    return props.open ? (
      <div data-testid="automation-job-dialog">
        {props.mode}:{payloadKind}:{scheduleKind}
      </div>
    ) : null;
  },
}));

vi.mock("@/components/execution/LatestRunStatusBadge", () => ({
  LatestRunStatusBadge: () => <div data-testid="latest-run-status-badge" />,
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  mockGetAutomationSchedulerConfig.mockResolvedValue({
    enabled: true,
    poll_interval_secs: 30,
    enable_history: true,
  });
  mockGetAutomationStatus.mockResolvedValue({
    running: true,
    last_polled_at: "2026-03-16T00:00:00Z",
    next_poll_at: "2026-03-16T00:00:30Z",
    last_job_count: 1,
    total_executions: 1,
    active_job_id: null,
    active_job_name: null,
  });
  mockGetAutomationJobs.mockResolvedValue([
    {
      id: "job-browser-1",
      name: "浏览器巡检",
      description: "启动浏览器并等待人工检查",
      enabled: true,
      workspace_id: "workspace-default",
      execution_mode: "intelligent",
      schedule: { kind: "every", every_secs: 900 },
      payload: {
        kind: "browser_session",
        profile_id: "profile-1",
        profile_key: "shop_us",
        url: "https://seller.example.com/dashboard",
        environment_preset_id: "preset-1",
        target_id: null,
        open_window: false,
        stream_mode: "events",
      },
      delivery: {
        mode: "announce",
        channel: "local_file",
        target: "/tmp/lime/browser-output.json",
        best_effort: false,
        output_schema: "json",
        output_format: "json",
      },
      timeout_secs: 120,
      max_retries: 2,
      next_run_at: "2026-03-16T00:15:00Z",
      last_status: "waiting_for_human",
      last_error: null,
      last_run_at: "2026-03-16T00:00:00Z",
      last_finished_at: null,
      running_started_at: "2026-03-16T00:00:00Z",
      consecutive_failures: 0,
      last_retry_count: 0,
      auto_disabled_until: null,
      last_delivery: {
        success: false,
        message: "写入本地文件失败: permission denied",
        channel: "local_file",
        target: "/tmp/lime/browser-output.json",
        output_kind: "json",
        output_schema: "json",
        output_format: "json",
        output_preview: '{\n  "session_id": "mock-cdp-session-shop_us"\n}',
        delivery_attempt_id: "dlv-run-browser-1",
        run_id: "run-browser-1",
        execution_retry_count: 0,
        delivery_attempts: 2,
        attempted_at: "2026-03-16T00:00:08Z",
      },
      created_at: "2026-03-16T00:00:00Z",
      updated_at: "2026-03-16T00:00:00Z",
    },
  ]);
  mockGetAutomationHealth.mockResolvedValue({
    total_jobs: 1,
    enabled_jobs: 1,
    pending_jobs: 0,
    running_jobs: 0,
    failed_jobs: 0,
    cooldown_jobs: 0,
    stale_running_jobs: 0,
    failed_last_24h: 0,
    failure_trend_24h: [],
    alerts: [],
    risky_jobs: [
      {
        job_id: "job-browser-1",
        name: "浏览器巡检",
        status: "waiting_for_human",
        consecutive_failures: 0,
        retry_count: 0,
        detail_message: "等待你确认是否继续执行",
        auto_disabled_until: null,
        updated_at: "2026-03-16T00:00:10Z",
      },
    ],
    generated_at: "2026-03-16T00:00:00Z",
  });
  mockGetAutomationRunHistory.mockResolvedValue([
    {
      id: "run-browser-1",
      source: "automation",
      source_ref: "job-browser-1",
      session_id: "mock-cdp-session-shop_us",
      status: "running",
      started_at: "2026-03-16T00:00:00Z",
      finished_at: null,
      duration_ms: null,
      error_code: null,
      error_message: null,
      metadata: JSON.stringify({
        payload_kind: "browser_session",
        profile_key: "shop_us",
        session_id: "mock-cdp-session-shop_us",
        browser_lifecycle_state: "waiting_for_human",
        human_reason: "等待你确认是否继续执行",
        delivery: {
          success: false,
          message: "写入本地文件失败: permission denied",
          channel: "local_file",
          target: "/tmp/lime/browser-output.json",
          output_kind: "json",
          output_schema: "json",
          output_format: "json",
          output_preview: '{\n  "session_id": "mock-cdp-session-shop_us"\n}',
          delivery_attempt_id: "dlv-run-browser-1",
          run_id: "run-browser-1",
          execution_retry_count: 0,
          delivery_attempts: 2,
          attempted_at: "2026-03-16T00:00:08Z",
        },
      }),
      created_at: "2026-03-16T00:00:00Z",
      updated_at: "2026-03-16T00:00:10Z",
    },
  ]);
  mockListProjects.mockResolvedValue([
    {
      id: "workspace-default",
      name: "默认工作区",
    },
  ]);
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
  vi.clearAllMocks();
});

async function renderSettings(
  props: Partial<React.ComponentProps<typeof AutomationSettings>> = {},
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });
  await act(async () => {
    root.render(<AutomationSettings {...props} />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
  return container;
}

async function openJobDetails(container: HTMLDivElement, jobId: string) {
  const button = container.querySelector(
    `[data-testid='automation-job-open-details-${jobId}']`,
  ) as HTMLButtonElement | null;

  expect(button).not.toBeNull();

  await act(async () => {
    button?.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function getBodyText() {
  return document.body.textContent ?? "";
}

async function hoverTip(ariaLabel: string) {
  const trigger = document.body.querySelector(
    `button[aria-label='${ariaLabel}']`,
  );
  expect(trigger).toBeInstanceOf(HTMLButtonElement);

  await act(async () => {
    trigger?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await Promise.resolve();
  });

  return trigger as HTMLButtonElement;
}

async function leaveTip(trigger: HTMLButtonElement | null) {
  await act(async () => {
    trigger?.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    await Promise.resolve();
  });
}

describe("AutomationSettings", () => {
  it("应把工作台说明和任务入口说明收进 tips", async () => {
    await renderSettings();

    expect(getBodyText()).not.toContain(
      "统一管理 Agent 自动化任务的创建、运行历史和调度器配置。",
    );
    expect(getBodyText()).not.toContain(
      "默认页只保留 Agent 对话任务相关动作。",
    );

    const heroTip = await hoverTip("自动化工作台说明");
    expect(getBodyText()).toContain(
      "统一管理 Agent 自动化任务的创建、运行历史和调度器配置。",
    );
    await leaveTip(heroTip);

    const taskTip = await hoverTip("任务入口说明");
    expect(getBodyText()).toContain("默认页只保留 Agent 对话任务相关动作。");
    await leaveTip(taskTip);
  });

  it("遗留浏览器任务应展示下线提示并移除接管面板", async () => {
    const container = await renderSettings();
    await openJobDetails(container, "job-browser-1");
    const documentText = document.body.textContent ?? "";

    expect(documentText).toContain("任务详情与历史");
    expect(documentText).toContain("浏览器自动化已下线");
    expect(documentText).toContain("系统不会再自动启动 Chrome");
    expect(documentText).toContain("等待人工处理");
    expect(documentText).toContain("已下线");
    expect(documentText).toContain("等待你确认是否继续执行");
    expect(documentText).toContain("输出契约");
    expect(documentText).toContain("最近一次投递结果");
    expect(documentText).toContain("投递失败");
    expect(documentText).toContain("写入本地文件失败: permission denied");
    expect(documentText).toContain("投递失败记为任务失败");
    expect(documentText).toContain("投递键: dlv-run-browser-1");
    expect(documentText).toContain("执行重试: 0 / 投递尝试: 2");
    expect(documentText).not.toContain("浏览器实时接管");
  }, 10_000);

  it("应展示 Google Sheets 作为输出目标标签", async () => {
    mockGetAutomationJobs.mockResolvedValueOnce([
      {
        id: "job-browser-2",
        name: "Google Sheets 巡检输出",
        description: "把结构化结果追加到表格",
        enabled: true,
        workspace_id: "workspace-default",
        execution_mode: "intelligent",
        schedule: { kind: "every", every_secs: 900 },
        payload: {
          kind: "browser_session",
          profile_id: "profile-1",
          profile_key: "shop_us",
          url: "https://seller.example.com/dashboard",
          environment_preset_id: "preset-1",
          target_id: null,
          open_window: false,
          stream_mode: "events",
        },
        delivery: {
          mode: "announce",
          channel: "google_sheets",
          target:
            "spreadsheet_id=sheet-1;sheet=巡检结果;credentials_file=C:/lime/service-account.json",
          best_effort: true,
          output_schema: "table",
          output_format: "json",
        },
        timeout_secs: 120,
        max_retries: 2,
        next_run_at: "2026-03-16T00:15:00Z",
        last_status: "success",
        last_error: null,
        last_run_at: "2026-03-16T00:00:00Z",
        last_finished_at: "2026-03-16T00:00:08Z",
        running_started_at: null,
        consecutive_failures: 0,
        last_retry_count: 0,
        auto_disabled_until: null,
        last_delivery: {
          success: true,
          message: "Google Sheets 已追加 2 行",
          channel: "google_sheets",
          target:
            "spreadsheet_id=sheet-1;sheet=巡检结果;credentials_file=C:/lime/service-account.json",
          output_kind: "table",
          output_schema: "table",
          output_format: "json",
          output_preview: '{"rows":[["https://example.com","ok"]]}',
          delivery_attempt_id: "dlv-run-browser-2",
          run_id: "run-browser-2",
          execution_retry_count: 1,
          delivery_attempts: 1,
          attempted_at: "2026-03-16T00:00:08Z",
        },
        created_at: "2026-03-16T00:00:00Z",
        updated_at: "2026-03-16T00:00:00Z",
      },
    ]);

    const container = await renderSettings();
    await openJobDetails(container, "job-browser-2");
    const documentText = document.body.textContent ?? "";

    expect(documentText).toContain("Google Sheets");
    expect(documentText).toContain("Google Sheets 已追加 2 行");
  }, 10_000);

  it("settings 模式应只保留调度器设置入口", async () => {
    const container = await renderSettings({
      mode: "settings",
      onOpenWorkspace: vi.fn(),
    });

    expect(container.textContent).toContain("自动化设置");
    expect(container.textContent).toContain("打开任务工作台");
    expect(container.textContent).not.toContain("任务详情与历史");
    expect(container.textContent).not.toContain("新建任务");
    expect(container.textContent).toContain("启用调度器");
    expect(container.querySelector("table")).toBeNull();
    expect(
      container.querySelector("[data-testid='automation-health-panel']"),
    ).toBeNull();
    expect(mockGetAutomationRunHistory).not.toHaveBeenCalled();
  });

  it("workspace 模式应显示任务工作台并隐藏调度器编辑", async () => {
    const container = await renderSettings({
      mode: "workspace",
      onOpenSettings: vi.fn(),
    });

    expect(container.textContent).toContain("自动化");
    expect(container.textContent).toContain("任务入口");
    expect(container.textContent).toContain("任务列表");
    expect(container.textContent).not.toContain("任务详情与历史");
    expect(container.textContent).toContain("自动化设置");
    expect(container.textContent).toContain("新建任务");
    expect(container.textContent).toContain("任务");
    expect(container.textContent).toContain("概览");
    expect(container.textContent).not.toContain("保存调度器");
    expect(container.textContent).not.toContain("启用调度器");
    expect(
      container.querySelector(
        "[data-testid='automation-job-open-details-job-browser-1']",
      ),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid='automation-health-panel']"),
    ).toBeNull();
    expect(mockGetAutomationRunHistory).not.toHaveBeenCalled();
  });

  it("workspace 模式点击详情按钮后应打开任务详情弹窗", async () => {
    const container = await renderSettings({
      mode: "workspace",
    });

    await openJobDetails(container, "job-browser-1");

    expect(
      document.body.querySelector(
        "[data-testid='automation-job-details-dialog']",
      ),
    ).not.toBeNull();
    expect(document.body.textContent).toContain("任务详情与历史");
    expect(document.body.textContent).toContain("浏览器巡检");
    expect(mockGetAutomationRunHistory).toHaveBeenLastCalledWith(
      "job-browser-1",
      15,
    );
  });

  it("workspace 模式切换到概览 tab 后才显示统计与健康面板", async () => {
    const container = await renderSettings({
      mode: "workspace",
    });

    const overviewTab = container.querySelector(
      "[data-testid='automation-tab-overview']",
    ) as HTMLButtonElement | null;

    expect(overviewTab).not.toBeNull();
    expect(
      container.querySelector("[data-testid='automation-health-panel']"),
    ).toBeNull();

    await act(async () => {
      overviewTab?.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("运行概览");
    expect(
      container.querySelector("[data-testid='automation-health-panel']"),
    ).not.toBeNull();
  });

  it("workspace 模式点击模板后应打开 Agent 任务预填弹窗", async () => {
    const container = await renderSettings({
      mode: "workspace",
    });

    const templateButton = container.querySelector(
      "[data-testid='automation-template-daily-brief']",
    ) as HTMLButtonElement | null;

    expect(templateButton).not.toBeNull();

    await act(async () => {
      templateButton?.click();
      await Promise.resolve();
    });

    expect(
      container.querySelector("[data-testid='automation-job-dialog']")
        ?.textContent,
    ).toBe("create:agent_turn:cron");
  });

  it("workspace 模式应支持从页面参数直接落到概览 tab", async () => {
    const container = await renderSettings({
      mode: "workspace",
      initialWorkspaceTab: "overview",
    });

    expect(container.textContent).toContain("运行概览");
    expect(
      container.querySelector("[data-testid='automation-health-panel']"),
    ).not.toBeNull();
  });

  it("workspace 模式应支持按页面参数预选任务", async () => {
    mockGetAutomationJobs.mockResolvedValueOnce([
      {
        id: "job-browser-1",
        name: "浏览器巡检",
        description: "启动浏览器并等待人工检查",
        enabled: true,
        workspace_id: "workspace-default",
        execution_mode: "intelligent",
        schedule: { kind: "every", every_secs: 900 },
        payload: {
          kind: "browser_session",
          profile_id: "profile-1",
          profile_key: "shop_us",
          url: "https://seller.example.com/dashboard",
          environment_preset_id: "preset-1",
          target_id: null,
          open_window: false,
          stream_mode: "events",
        },
        delivery: {
          mode: "announce",
          channel: "local_file",
          target: "/tmp/lime/browser-output.json",
          best_effort: false,
          output_schema: "json",
          output_format: "json",
        },
        timeout_secs: 120,
        max_retries: 2,
        next_run_at: "2026-03-16T00:15:00Z",
        last_status: "waiting_for_human",
        last_error: null,
        last_run_at: "2026-03-16T00:00:00Z",
        last_finished_at: null,
        running_started_at: "2026-03-16T00:00:00Z",
        consecutive_failures: 0,
        last_retry_count: 0,
        auto_disabled_until: null,
        last_delivery: null,
        created_at: "2026-03-16T00:00:00Z",
        updated_at: "2026-03-16T00:00:00Z",
      },
      {
        id: "job-agent-2",
        name: "日报摘要",
        description: "生成日报",
        enabled: true,
        workspace_id: "workspace-default",
        execution_mode: "skill",
        schedule: { kind: "cron", expr: "0 9 * * *", tz: "Asia/Shanghai" },
        payload: {
          kind: "agent_turn",
          prompt: "请输出日报摘要",
          system_prompt: null,
          web_search: false,
        },
        delivery: {
          mode: "none",
          channel: null,
          target: null,
          best_effort: true,
          output_schema: "text",
          output_format: "text",
        },
        timeout_secs: 120,
        max_retries: 2,
        next_run_at: "2026-03-16T09:00:00Z",
        last_status: "success",
        last_error: null,
        last_run_at: "2026-03-16T08:59:00Z",
        last_finished_at: "2026-03-16T09:00:10Z",
        running_started_at: null,
        consecutive_failures: 0,
        last_retry_count: 0,
        auto_disabled_until: null,
        last_delivery: null,
        created_at: "2026-03-16T00:00:00Z",
        updated_at: "2026-03-16T00:00:00Z",
      },
    ]);

    await renderSettings({
      mode: "workspace",
      initialSelectedJobId: "job-agent-2",
    });

    expect(mockGetAutomationRunHistory).toHaveBeenLastCalledWith(
      "job-agent-2",
      15,
    );
  });

  it("服务型技能自动化任务应展示参数摘要与主稿绑定", async () => {
    mockGetAutomationJobs.mockResolvedValueOnce([
      {
        id: "job-service-skill-1",
        name: "每日趋势摘要｜定时执行",
        description: "围绕指定平台与关键词输出趋势摘要。",
        enabled: true,
        workspace_id: "workspace-default",
        execution_mode: "skill",
        schedule: { kind: "cron", expr: "0 9 * * *", tz: "Asia/Shanghai" },
        payload: {
          kind: "agent_turn",
          prompt: "[技能任务] 每日趋势摘要",
          system_prompt: null,
          web_search: false,
          content_id: "content-service-skill-1",
          request_metadata: {
            service_skill: {
              id: "daily-trend-briefing",
              title: "每日趋势摘要",
              runner_type: "scheduled",
              execution_location: "client_default",
              source: "cloud_catalog",
              slot_values: [
                {
                  key: "platform",
                  label: "监测平台",
                  value: "X / Twitter",
                },
                {
                  key: "industry_keywords",
                  label: "行业关键词",
                  value: "AI Agent，创作者工具",
                },
              ],
              user_input: "重点关注新增热点与异常波动。",
            },
            harness: {
              theme: "general",
              content_id: "content-service-skill-1",
            },
          },
        },
        delivery: {
          mode: "none",
          channel: null,
          target: null,
          best_effort: true,
          output_schema: "text",
          output_format: "text",
        },
        timeout_secs: 120,
        max_retries: 2,
        next_run_at: "2026-03-16T09:00:00Z",
        last_status: "error",
        last_error: "模型返回空结果",
        last_run_at: "2026-03-16T08:59:00Z",
        last_finished_at: "2026-03-16T09:00:10Z",
        running_started_at: null,
        consecutive_failures: 1,
        last_retry_count: 0,
        auto_disabled_until: null,
        last_delivery: null,
        created_at: "2026-03-16T00:00:00Z",
        updated_at: "2026-03-16T00:00:00Z",
      },
    ]);
    mockGetAutomationRunHistory.mockResolvedValueOnce([
      {
        id: "run-service-skill-1",
        source: "automation",
        source_ref: "job-service-skill-1",
        session_id: "session-service-skill-1",
        status: "error",
        started_at: "2026-03-16T08:59:00Z",
        finished_at: "2026-03-16T09:00:10Z",
        duration_ms: 70_000,
        error_code: "empty_result",
        error_message: "模型返回空结果",
        metadata: JSON.stringify({
          service_skill: {
            id: "daily-trend-briefing",
            title: "每日趋势摘要",
            runner_type: "scheduled",
            execution_location: "client_default",
            source: "cloud_catalog",
            slot_values: [
              {
                key: "platform",
                label: "监测平台",
                value: "小红书",
              },
              {
                key: "industry_keywords",
                label: "行业关键词",
                value: "AI 短视频",
              },
            ],
            user_input: "优先记录增速最快的话题。",
          },
          content_id: "content-service-skill-run-1",
          harness: {
            theme: "general",
          },
        }),
        created_at: "2026-03-16T08:59:00Z",
        updated_at: "2026-03-16T09:00:10Z",
      },
    ]);

    const container = await renderSettings({
      mode: "workspace",
      initialSelectedJobId: "job-service-skill-1",
    });
    const serviceSkillSummary = container.querySelector(
      "[data-testid='automation-job-service-skill-summary-job-service-skill-1']",
    );
    const runWindow = container.querySelector(
      "[data-testid='automation-job-run-window-job-service-skill-1']",
    );
    const runServiceSkillSummary = document.body.querySelector(
      "[data-testid='automation-run-service-skill-summary-run-service-skill-1']",
    );
    const dialog = document.body.querySelector(
      "[data-testid='automation-job-details-dialog']",
    );
    const dialogText = document.body.textContent ?? "";

    expect(serviceSkillSummary?.textContent).toContain("技能任务");
    expect(serviceSkillSummary?.textContent).toContain("定时任务");
    expect(serviceSkillSummary?.textContent).toContain("客户端执行");
    expect(serviceSkillSummary?.textContent).toContain("云目录");
    expect(serviceSkillSummary?.textContent).toContain("技能项: 每日趋势摘要");
    expect(serviceSkillSummary?.textContent).toContain(
      "参数摘要: 监测平台: X / Twitter · 行业关键词: AI Agent，创作者工具",
    );
    expect(runWindow?.textContent).toContain("下次:");
    expect(runWindow?.textContent).toContain("最近:");
    expect(runServiceSkillSummary?.textContent).toContain("技能任务运行上下文");
    expect(runServiceSkillSummary?.textContent).toContain("定时任务");
    expect(runServiceSkillSummary?.textContent).toContain("客户端执行");
    expect(runServiceSkillSummary?.textContent).toContain(
      "技能项: 每日趋势摘要",
    );
    expect(runServiceSkillSummary?.textContent).toContain(
      "参数摘要: 监测平台: 小红书 · 行业关键词: AI 短视频",
    );
    expect(runServiceSkillSummary?.textContent).toContain(
      "补充要求: 优先记录增速最快的话题。",
    );
    expect(dialog).not.toBeNull();
    expect(dialogText).toContain("技能任务上下文");
    expect(dialogText).toContain("每日趋势摘要");
    expect(dialogText).toContain("定时任务");
    expect(dialogText).toContain("客户端执行");
    expect(dialogText).toContain("云目录");
    expect(dialogText).toContain("工作主题: general");
    expect(dialogText).toContain("主稿绑定: content-service-skill-1");
    expect(dialogText).toContain("参数摘要");
    expect(dialogText).toContain("监测平台: X / Twitter");
    expect(dialogText).toContain("行业关键词: AI Agent，创作者工具");
    expect(dialogText).toContain("补充要求");
    expect(dialogText).toContain("重点关注新增热点与异常波动。");
    expect(dialogText).toContain("失败原因");
    expect(dialogText).toContain("模型返回空结果");
  });
});
