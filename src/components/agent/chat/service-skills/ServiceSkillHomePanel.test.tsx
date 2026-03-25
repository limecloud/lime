import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceSkillHomePanel } from "./ServiceSkillHomePanel";
import type { ServiceSkillHomeItem } from "./types";

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
    if (!mounted) break;
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  vi.clearAllMocks();
});

function renderPanel(
  props: React.ComponentProps<typeof ServiceSkillHomePanel>,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<ServiceSkillHomePanel {...props} />);
  });

  mountedRoots.push({ root, container });
  return container;
}

describe("ServiceSkillHomePanel", () => {
  it("应渲染服务型技能信息并透传选择回调", () => {
    const skills: ServiceSkillHomeItem[] = [
      {
        id: "short-video-script-replication",
        title: "复制短视频脚本",
        summary: "围绕参考视频的结构和节奏，输出一版可继续加工的脚本。",
        category: "视频创作",
        outputHint: "脚本大纲 + 镜头节奏",
        source: "cloud_catalog",
        runnerType: "instant",
        defaultExecutorBinding: "agent_turn",
        executionLocation: "client_default",
        slotSchema: [],
        version: "seed-v1",
        badge: "云目录",
        recentUsedAt: null,
        isRecent: false,
        runnerLabel: "本地即时执行",
        runnerTone: "emerald",
        runnerDescription: "客户端起步版可直接进入工作区执行。",
        actionLabel: "填写参数",
        automationStatus: {
          jobId: "automation-job-1",
          jobName: "复制短视频脚本｜定时执行",
          statusLabel: "成功",
          tone: "emerald",
          detail: "下次 03/24 09:00",
        },
      },
    ];
    const onSelect = vi.fn();
    const onOpenAutomationJob = vi.fn();

    const container = renderPanel({
      skills,
      catalogMeta: {
        tenantId: "tenant-demo",
        version: "tenant-2026-03-24",
        syncedAt: "2026-03-24T12:00:00.000Z",
        itemCount: 1,
        sourceLabel: "租户云目录",
        isSeeded: false,
      },
      onSelect,
      onOpenAutomationJob,
    });

    expect(container.textContent).toContain("服务型技能");
    expect(container.textContent).toContain("租户云目录");
    expect(container.textContent).toContain("tenant-demo");
    expect(container.textContent).toContain("tenant-2026-03-24");
    expect(container.textContent).toContain("1 项");
    expect(container.textContent).toContain("同步于");
    expect(container.textContent).toContain("复制短视频脚本");
    expect(container.textContent).toContain("产出：脚本大纲 + 镜头节奏");
    expect(container.textContent).toContain("本地任务 · 成功");
    expect(container.textContent).toContain("下次 03/24 09:00");
    expect(container.textContent).toContain("本地即时执行");
    expect(container.textContent).toContain("填写参数");

    const button = container.querySelector(
      '[data-testid="service-skill-short-video-script-replication"]',
    ) as HTMLButtonElement | null;

    expect(button).toBeTruthy();

    act(() => {
      button?.click();
    });

    expect(onSelect).toHaveBeenCalledWith(skills[0]);

    const statusButton = container.querySelector(
      '[data-testid="service-skill-short-video-script-replication-secondary-status"]',
    ) as HTMLButtonElement | null;

    expect(statusButton).toBeTruthy();

    act(() => {
      statusButton?.click();
    });

    expect(onOpenAutomationJob).toHaveBeenCalledWith(skills[0]);
  });
});
