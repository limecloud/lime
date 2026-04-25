import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AutomationHealthPanel } from "./AutomationHealthPanel";

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
});

async function renderPanel() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });
  await act(async () => {
    root.render(
      <AutomationHealthPanel
        status={{
          running: true,
          last_polled_at: "2026-03-16T00:00:00Z",
          next_poll_at: "2026-03-16T00:05:00Z",
          last_job_count: 1,
          total_executions: 8,
          active_job_id: null,
          active_job_name: null,
        }}
        health={{
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
              updated_at: "2026-03-16T00:00:05Z",
            },
          ],
          generated_at: "2026-03-16T00:00:05Z",
        }}
      />,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
  return container;
}

describe("AutomationHealthPanel", () => {
  it("风险提醒应展示人工处理原因", async () => {
    const container = await renderPanel();

    expect(container.textContent).toContain("风险提醒");
    expect(container.textContent).toContain("等待人工处理");
    expect(container.textContent).toContain("等待你确认是否继续执行");
  });
});
