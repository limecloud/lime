import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutomationJobDialog } from "./AutomationJobDialog";

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

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
                name: "每日摘要",
                description: "生成一份结构化中文摘要",
                enabled: true,
                workspace_id: "workspace-default",
                execution_mode: "intelligent",
                schedule: { kind: "every", every_secs: 600 },
                payload: {
                  kind: "agent_turn",
                  prompt: "请输出今日摘要",
                  system_prompt: null,
                  web_search: false,
                  content_id: null,
                  approval_policy: "never",
                  sandbox_policy: "danger-full-access",
                  request_metadata: null,
                },
                delivery: {
                  mode: "announce",
                  channel: "local_file",
                  target: "/tmp/lime/agent-output.json",
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

describe("AutomationJobDialog", () => {
  it("应把弹窗长说明收进 tip 并显示轻量摘要头部", async () => {
    await renderDialog({
      onSubmit: vi.fn().mockResolvedValue(undefined),
      mode: "create",
    });

    expect(getBodyText()).toContain("新建持续流程");
    expect(getBodyText()).toContain("配置流程名称、节奏、启动提示和输出去向。");
    expect(getBodyText()).toContain("开始方式：Agent 对话");
    expect(getBodyText()).not.toContain(
      "用这条持续流程承接 Agent 对话里已经跑顺的做法，统一管理节奏、归属位置、输出去向和运行历史。",
    );

    const headerTip = await hoverTip("持续流程弹窗说明");
    expect(getBodyText()).toContain(
      "用这条持续流程承接 Agent 对话里已经跑顺的做法，统一管理节奏、归属位置、输出去向和运行历史。",
    );
    await leaveTip(headerTip);
  });

  it("编辑 agent_turn 任务时应保留 content_id，并把权限收口到正式策略", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    await renderDialog({
      onSubmit,
      jobOverride: {
        payload: {
          kind: "agent_turn",
          prompt: "生成趋势摘要",
          system_prompt: "请保持简洁",
          web_search: false,
          content_id: "content-1",
          approval_policy: "on-request",
          sandbox_policy: "read-only",
          request_metadata: {
            artifact: {
              artifact_mode: "draft",
              artifact_kind: "analysis",
            },
            harness: {
              theme: "general",
              session_mode: "general_workbench",
              content_id: "content-1",
              access_mode: "full-access",
            },
            accessMode: "current",
          },
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
        payload: {
          kind: "agent_turn",
          prompt: "生成趋势摘要",
          system_prompt: "请保持简洁",
          web_search: false,
          content_id: "content-1",
          approval_policy: "on-request",
          sandbox_policy: "read-only",
          request_metadata: {
            artifact: {
              artifact_mode: "draft",
              artifact_kind: "analysis",
            },
            harness: {
              theme: "general",
              session_mode: "general_workbench",
              content_id: "content-1",
            },
          },
        },
      }),
    });
  }, 10_000);

  it("编辑旧浏览器任务时应展示下线提示并禁用保存", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    await renderDialog({
      onSubmit,
      jobOverride: {
        name: "浏览器巡检",
        description: "旧浏览器自动化任务",
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
      },
    });

    const submitButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("该类型不可保存"),
    ) as HTMLButtonElement | undefined;

    expect(submitButton).toBeDefined();
    expect(submitButton?.disabled).toBe(true);
    expect(document.body.textContent).toContain("浏览器自动化已下线");
    expect(document.body.textContent).toContain("系统不会再自动启动 Chrome");
    expect(document.body.textContent).toContain("历史配置快照");
    expect(onSubmit).not.toHaveBeenCalled();
  }, 10_000);

  it("编辑 Google Sheets 输出任务时应保留 channel 与目标串", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    await renderDialog({
      onSubmit,
      jobOverride: {
        payload: {
          kind: "agent_turn",
          prompt: "整理结构化结果",
          system_prompt: null,
          web_search: false,
          content_id: null,
          request_metadata: null,
        },
        delivery: {
          mode: "announce",
          channel: "google_sheets",
          target:
            "spreadsheet_id=sheet-1;sheet=巡检结果;credentials_file=C:/lime/service-account.json;include_header=true",
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
            "spreadsheet_id=sheet-1;sheet=巡检结果;credentials_file=C:/lime/service-account.json;include_header=true",
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
      document.querySelector(
        "[data-testid='automation-job-dialog-scroll-area']",
      ),
    ).not.toBeNull();

    const submitButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("创建持续流程"),
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
