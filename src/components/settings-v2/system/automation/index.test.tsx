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
  mockGetChromeProfileSessions,
  mockAutomationJobDialog,
} = vi.hoisted(() => ({
  mockGetAutomationSchedulerConfig: vi.fn(),
  mockGetAutomationStatus: vi.fn(),
  mockGetAutomationJobs: vi.fn(),
  mockGetAutomationHealth: vi.fn(),
  mockGetAutomationRunHistory: vi.fn(),
  mockListProjects: vi.fn(),
  mockGetChromeProfileSessions: vi.fn(),
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

vi.mock("@/lib/webview-api", () => ({
  getChromeProfileSessions: mockGetChromeProfileSessions,
}));

vi.mock("@/features/browser-runtime", () => ({
  BrowserRuntimeDebugPanel: ({
    sessions,
    initialProfileKey,
    initialSessionId,
  }: {
    sessions: Array<{ profile_key: string }>;
    initialProfileKey?: string;
    initialSessionId?: string;
  }) => (
    <div data-testid="automation-browser-runtime-panel">
      <span data-testid="browser-runtime-session-count">{sessions.length}</span>
      <span data-testid="browser-runtime-profile-key">
        {initialProfileKey ?? "-"}
      </span>
      <span data-testid="browser-runtime-session-id">
        {initialSessionId ?? "-"}
      </span>
    </div>
  ),
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
        target: "/tmp/proxycast/browser-output.json",
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
        target: "/tmp/proxycast/browser-output.json",
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
          target: "/tmp/proxycast/browser-output.json",
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
  mockGetChromeProfileSessions.mockResolvedValue([
    {
      profile_key: "shop_us",
      browser_source: "system",
      browser_path:
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      profile_dir: "/tmp/proxycast/chrome_profiles/shop_us",
      remote_debugging_port: 13001,
      pid: 12345,
      started_at: "2026-03-16T00:00:00Z",
      last_url: "https://seller.example.com/dashboard",
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

describe("AutomationSettings", () => {
  it("浏览器任务应在详情区挂载实时接管面板", async () => {
    const container = await renderSettings();

    expect(container.textContent).toContain("浏览器实时接管");
    expect(container.textContent).toContain("等待人工处理");
    expect(container.textContent).toContain("当前阻塞: 等待你确认是否继续执行");
    expect(container.textContent).toContain("运行态说明");
    expect(container.textContent).toContain("等待你确认是否继续执行");
    expect(container.textContent).toContain("输出契约");
    expect(container.textContent).toContain("最近一次投递结果");
    expect(container.textContent).toContain("投递失败");
    expect(container.textContent).toContain(
      "写入本地文件失败: permission denied",
    );
    expect(container.textContent).toContain("投递失败记为任务失败");
    expect(container.textContent).toContain("输出投递 / 本地文件");
    expect(container.textContent).toContain("投递键: dlv-run-browser-1");
    expect(container.textContent).toContain("执行重试: 0 / 投递尝试: 2");
    expect(
      container.querySelector(
        "[data-testid='automation-browser-runtime-panel']",
      ),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid='browser-runtime-session-count']")
        ?.textContent,
    ).toBe("1");
    expect(
      container.querySelector("[data-testid='browser-runtime-profile-key']")
        ?.textContent,
    ).toBe("shop_us");
    expect(
      container.querySelector("[data-testid='browser-runtime-session-id']")
        ?.textContent,
    ).toBe("mock-cdp-session-shop_us");
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
            "spreadsheet_id=sheet-1;sheet=巡检结果;credentials_file=C:/proxycast/service-account.json",
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
            "spreadsheet_id=sheet-1;sheet=巡检结果;credentials_file=C:/proxycast/service-account.json",
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

    expect(container.textContent).toContain("Google Sheets");
    expect(container.textContent).toContain("Google Sheets 已追加 2 行");
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
    expect(mockGetChromeProfileSessions).not.toHaveBeenCalled();
  });

  it("workspace 模式应显示任务工作台并隐藏调度器编辑", async () => {
    const container = await renderSettings({
      mode: "workspace",
      onOpenSettings: vi.fn(),
    });

    expect(container.textContent).toContain("自动化");
    expect(container.textContent).toContain("任务入口");
    expect(container.textContent).toContain("任务列表");
    expect(container.textContent).toContain("任务详情与历史");
    expect(container.textContent).toContain("自动化设置");
    expect(container.textContent).toContain("新建任务");
    expect(container.textContent).toContain("任务");
    expect(container.textContent).toContain("概览");
    expect(container.textContent).not.toContain("保存调度器");
    expect(container.textContent).not.toContain("启用调度器");
    expect(
      container.querySelector("[data-testid='automation-health-panel']"),
    ).toBeNull();
    expect(mockGetAutomationRunHistory).toHaveBeenCalled();
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

  it("workspace 模式点击模板后应打开预填创建弹窗", async () => {
    const container = await renderSettings({
      mode: "workspace",
    });

    const templateButton = container.querySelector(
      "[data-testid='automation-template-browser-check']",
    ) as HTMLButtonElement | null;

    expect(templateButton).not.toBeNull();

    await act(async () => {
      templateButton?.click();
      await Promise.resolve();
    });

    expect(
      container.querySelector("[data-testid='automation-job-dialog']")
        ?.textContent,
    ).toBe("create:browser_session:every");
  });
});
