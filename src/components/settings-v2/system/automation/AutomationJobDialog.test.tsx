import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutomationJobDialog } from "./AutomationJobDialog";

const {
  mockListBrowserProfiles,
  mockListBrowserEnvironmentPresets,
} = vi.hoisted(() => ({
  mockListBrowserProfiles: vi.fn(),
  mockListBrowserEnvironmentPresets: vi.fn(),
}));

vi.mock("@/features/browser-runtime/api", () => ({
  browserRuntimeApi: {
    listBrowserProfiles: mockListBrowserProfiles,
    listBrowserEnvironmentPresets: mockListBrowserEnvironmentPresets,
  },
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  mockListBrowserProfiles.mockResolvedValue([
    {
      id: "profile-1",
      profile_key: "shop_us",
      name: "美区店铺资料",
      description: "主账号",
      site_scope: "seller.example.com",
      launch_url: "https://seller.example.com",
      profile_dir: "/tmp/proxycast/chrome_profiles/shop_us",
      created_at: "2026-03-15T00:00:00Z",
      updated_at: "2026-03-15T00:00:00Z",
      last_used_at: null,
      archived_at: null,
    },
  ]);
  mockListBrowserEnvironmentPresets.mockResolvedValue([
    {
      id: "preset-1",
      name: "美区桌面",
      description: "住宅代理 + 桌面环境",
      proxy_server: null,
      timezone_id: "America/Los_Angeles",
      locale: "en-US",
      accept_language: "en-US,en;q=0.9",
      geolocation_lat: null,
      geolocation_lng: null,
      geolocation_accuracy_m: null,
      user_agent: null,
      platform: null,
      viewport_width: 1440,
      viewport_height: 900,
      device_scale_factor: 2,
      created_at: "2026-03-15T00:00:00Z",
      updated_at: "2026-03-15T00:00:00Z",
      last_used_at: null,
      archived_at: null,
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

async function renderDialog(props: {
  onSubmit: ReturnType<typeof vi.fn>;
  mode?: "create" | "edit";
  initialValues?: Record<string, unknown>;
  jobOverride?: Record<string, unknown>;
}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });
  await act(async () => {
    root.render(
      <AutomationJobDialog
        open
        mode={props.mode ?? "edit"}
        job={
          (props.mode ?? "edit") === "edit"
            ? {
                id: "job-1",
                name: "店铺后台巡检",
                description: "启动浏览器检查后台状态",
                enabled: true,
                workspace_id: "workspace-default",
                execution_mode: "intelligent",
                schedule: { kind: "every", every_secs: 600 },
                payload: {
                  kind: "browser_session",
                  profile_id: "profile-1",
                  profile_key: "shop_us",
                  url: "https://seller.example.com/dashboard",
                  environment_preset_id: "preset-1",
                  target_id: "target-1",
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
                next_run_at: null,
                last_status: null,
                last_error: null,
                last_run_at: null,
                last_finished_at: null,
                running_started_at: null,
                consecutive_failures: 0,
                last_retry_count: 0,
                auto_disabled_until: null,
                created_at: "2026-03-15T00:00:00Z",
                updated_at: "2026-03-15T00:00:00Z",
                ...(props.jobOverride ?? {}),
              }
            : null
        }
        workspaces={[
          {
            id: "workspace-default",
            name: "默认工作区",
          } as any,
        ]}
        initialValues={props.initialValues as any}
        saving={false}
        onOpenChange={vi.fn()}
        onSubmit={props.onSubmit}
      />,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
  return container;
}

describe("AutomationJobDialog", () => {
  it("编辑浏览器任务时应保持 browser_session payload 提交", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    await renderDialog({ onSubmit });

    const submitButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("保存修改"),
    ) as HTMLButtonElement | undefined;

    expect(submitButton).toBeDefined();

    await act(async () => {
      submitButton?.click();
      await Promise.resolve();
    });

    expect(onSubmit).toHaveBeenCalledWith({
      mode: "edit",
      id: "job-1",
      request: expect.objectContaining({
        payload: expect.objectContaining({
          kind: "browser_session",
          profile_id: "profile-1",
          profile_key: "shop_us",
          url: "https://seller.example.com/dashboard",
          environment_preset_id: "preset-1",
          target_id: "target-1",
          open_window: false,
          stream_mode: "events",
        }),
        delivery: expect.objectContaining({
          mode: "announce",
          channel: "local_file",
          target: "/tmp/proxycast/browser-output.json",
          best_effort: false,
          output_schema: "json",
          output_format: "json",
        }),
      }),
    });
  }, 10_000);

  it("编辑 Google Sheets 输出任务时应保留 channel 与目标串", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    await renderDialog({
      onSubmit,
      jobOverride: {
        delivery: {
          mode: "announce",
          channel: "google_sheets",
          target:
            "spreadsheet_id=sheet-1;sheet=巡检结果;credentials_file=C:/proxycast/service-account.json;include_header=true",
          best_effort: true,
          output_schema: "table",
          output_format: "json",
        },
      },
    });

    const submitButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("保存修改"),
    ) as HTMLButtonElement | undefined;

    await act(async () => {
      submitButton?.click();
      await Promise.resolve();
    });

    expect(onSubmit).toHaveBeenCalledWith({
      mode: "edit",
      id: "job-1",
      request: expect.objectContaining({
        delivery: expect.objectContaining({
          mode: "announce",
          channel: "google_sheets",
          target:
            "spreadsheet_id=sheet-1;sheet=巡检结果;credentials_file=C:/proxycast/service-account.json;include_header=true",
          best_effort: true,
          output_schema: "table",
          output_format: "json",
        }),
      }),
    });
  }, 10_000);

  it("创建任务时应应用模板预填值", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    await renderDialog({
      onSubmit,
      mode: "create",
      initialValues: {
        name: "每日摘要",
        description: "按固定时间生成一份中文摘要",
        payload_kind: "agent_turn",
        schedule_kind: "cron",
        cron_expr: "0 9 * * *",
        cron_tz: "Asia/Shanghai",
        prompt:
          "请总结最近一个周期内的关键进展、异常和待办，输出一份简洁的中文摘要。",
        delivery_mode: "none",
      },
    });

    expect(
      document.querySelector("[data-testid='automation-job-dialog-scroll-area']"),
    ).not.toBeNull();

    const submitButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("创建任务"),
    ) as HTMLButtonElement | undefined;

    await act(async () => {
      submitButton?.click();
      await Promise.resolve();
    });

    expect(onSubmit).toHaveBeenCalledWith({
      mode: "create",
      request: expect.objectContaining({
        name: "每日摘要",
        description: "按固定时间生成一份中文摘要",
        schedule: {
          kind: "cron",
          expr: "0 9 * * *",
          tz: "Asia/Shanghai",
        },
        payload: expect.objectContaining({
          kind: "agent_turn",
          prompt:
            "请总结最近一个周期内的关键进展、异常和待办，输出一份简洁的中文摘要。",
        }),
      }),
    });
  }, 10_000);
});
