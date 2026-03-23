import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentIncidentPanel } from "./AgentIncidentPanel";
import type { ThreadReliabilityIncidentDisplay } from "../utils/threadReliabilityView";

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
});

function renderPanel(incidents: ThreadReliabilityIncidentDisplay[]) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<AgentIncidentPanel incidents={incidents} />);
  });

  mountedRoots.push({ container, root });
  return container;
}

describe("AgentIncidentPanel", () => {
  it("无 active incident 时应展示空态", () => {
    const container = renderPanel([]);

    expect(
      container.querySelector('[data-testid="agent-incident-panel-empty"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("当前未发现活跃 incident");
  });

  it("存在 active incident 时应展示标题、说明与状态", () => {
    const container = renderPanel([
      {
        id: "incident-1",
        incidentType: "approval_timeout",
        title: "审批等待超过阈值",
        detail: "当前线程等待工具确认时间过长",
        statusLabel: "进行中",
        severityLabel: "高",
        tone: "failed",
      },
      {
        id: "incident-2",
        incidentType: "waiting_user_input",
        title: "线程正在等待人工处理",
        detail: "等待你确认是否继续发布",
        statusLabel: "进行中",
        severityLabel: "中",
        tone: "waiting",
      },
    ]);

    expect(
      container.querySelector('[data-testid="agent-incident-panel"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("审批等待超过阈值");
    expect(container.textContent).toContain("当前线程等待工具确认时间过长");
    expect(container.textContent).toContain("高优先级");
    expect(container.textContent).toContain("线程正在等待人工处理");
    expect(container.textContent).toContain("等待你确认是否继续发布");
  });
});
