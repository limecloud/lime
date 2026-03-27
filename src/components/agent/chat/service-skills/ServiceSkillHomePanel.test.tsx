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
      {
        id: "local-growth-playbook",
        title: "本地增长打法模版",
        summary: "项目级的离线补充服务技能。",
        category: "本地打法",
        outputHint: "增长打法草案",
        source: "local_custom",
        runnerType: "managed",
        defaultExecutorBinding: "automation_job",
        executionLocation: "client_default",
        slotSchema: [],
        version: "local-v1",
        badge: "本地技能",
        recentUsedAt: null,
        isRecent: false,
        runnerLabel: "本地持续跟踪",
        runnerTone: "amber",
        runnerDescription: "可直接创建本地持续跟踪任务，并回流到任务中心与工作区。",
        actionLabel: "创建跟踪",
        automationStatus: null,
      },
      {
        id: "cloud-video-dubbing",
        title: "云端视频配音",
        summary: "提交到 OEM 云端执行，并在成功后回流本地工作区。",
        category: "视频创作",
        outputHint: "配音文案 + 云端结果摘要",
        source: "cloud_catalog",
        runnerType: "instant",
        defaultExecutorBinding: "cloud_scene",
        executionLocation: "cloud_required",
        slotSchema: [],
        version: "cloud-v1",
        badge: "云目录",
        recentUsedAt: null,
        isRecent: false,
        runnerLabel: "云端托管执行",
        runnerTone: "slate",
        runnerDescription: "提交到 OEM 云端执行，结果由服务端异步返回。",
        actionLabel: "提交云端",
        automationStatus: null,
        cloudStatus: {
          runId: "cloud-run-1",
          statusLabel: "成功",
          tone: "emerald",
          detail: "云端结果已生成",
          updatedAt: 1,
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
        itemCount: 2,
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
    expect(container.textContent).toContain("云目录 2 项");
    expect(container.textContent).toContain("本地补充 1 项");
    expect(container.textContent).toContain("同步于");
    expect(container.textContent).toContain("复制短视频脚本");
    expect(container.textContent).toContain("产出：脚本大纲 + 镜头节奏");
    expect(container.textContent).toContain("本地任务 · 成功");
    expect(container.textContent).toContain("下次 03/24 09:00");
    expect(container.textContent).toContain("本地即时执行");
    expect(container.textContent).toContain("填写参数");
    expect(container.textContent).toContain("云端视频配音");
    expect(container.textContent).toContain("云端状态 · 成功");
    expect(container.textContent).toContain("云端结果已生成");
    expect(container.textContent).toContain("本地技能 / 自定义技能");
    expect(container.textContent).toContain("本地增长打法模版");
    expect(container.textContent).toContain("本地持续跟踪");
    expect(container.textContent).toContain("创建跟踪");

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

    const localButton = container.querySelector(
      '[data-testid="service-skill-local-growth-playbook"]',
    ) as HTMLButtonElement | null;

    expect(localButton).toBeTruthy();

    act(() => {
      localButton?.click();
    });

    expect(onSelect).toHaveBeenLastCalledWith(skills[1]);

    const cloudStatusButton = container.querySelector(
      '[data-testid="service-skill-cloud-video-dubbing-secondary-status"]',
    ) as HTMLButtonElement | null;

    expect(cloudStatusButton).toBeNull();
  });
});
