import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RuntimePeerMessageCards } from "./RuntimePeerMessageCards";

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

function render(text: string): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<RuntimePeerMessageCards text={text} />);
  });

  mountedRoots.push({ container, root });
  return container;
}

describe("RuntimePeerMessageCards", () => {
  it("应把计划审批请求渲染为专门卡片", () => {
    const container =
      render(`<teammate-message teammate_id="team-lead" summary="等待审批">
{"type":"plan_approval_request","from":"researcher","plan_file_path":"plans/alpha.md","plan_content":"# 计划\\n- 第一步"}
</teammate-message>`);

    expect(
      container.querySelector('[data-testid="runtime-peer-message-cards"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("计划审批请求");
    expect(container.textContent).toContain("来自 team-lead");
    expect(container.textContent).toContain("等待审批");
    expect(container.textContent).toContain("计划文件：plans/alpha.md");
    expect(container.textContent).toContain("计划");
    expect(container.textContent).not.toContain("teammate-message");
  });

  it("应把结束任务拒绝渲染为收口卡片", () => {
    const container = render(`<teammate-message teammate_id="researcher">
{"type":"shutdown_rejected","request_id":"req-2","from":"researcher","reason":"还在收尾"}
</teammate-message>`);

    expect(container.textContent).toContain("结束任务被拒绝");
    expect(container.textContent).toContain("还在收尾");
    expect(container.textContent).toContain("可在稍后再次请求结束");
  });

  it("应在任务分配卡片里显示 assignedBy", () => {
    const container =
      render(`<teammate-message teammate_id="worker-1" summary="等待执行">
{"type":"task_assignment","taskId":"task-7","subject":"对齐 current surface","description":"补齐 display 语义","assignedBy":"team-lead"}
</teammate-message>`);

    expect(container.textContent).toContain("任务分配");
    expect(container.textContent).toContain("来自 worker-1");
    expect(container.textContent).toContain("等待执行");
    expect(container.textContent).toContain("分配者：team-lead");
    expect(container.textContent).toContain("#task-7");
    expect(container.textContent).toContain("对齐 current surface");
  });

  it("应静默 shutdown approved 和 idle lifecycle 消息", () => {
    const approvedContainer =
      render(`<teammate-message teammate_id="researcher">
{"type":"shutdown_approved","request_id":"req-1","from":"researcher"}
</teammate-message>`);
    const mixedContainer = render(
      [
        `<teammate-message teammate_id="researcher">
{"type":"idle_notification","completedTaskId":"task-1","completedStatus":"completed","summary":"等待新任务"}
</teammate-message>`,
        `<teammate-message teammate_id="researcher">
{"type":"task_completed","taskId":"task-2","taskSubject":"收口 peer message"}
</teammate-message>`,
      ].join("\n"),
    );

    expect(
      approvedContainer.querySelector(
        '[data-testid="runtime-peer-message-cards"]',
      ),
    ).toBeNull();
    expect(approvedContainer.textContent).toBe("");
    expect(mixedContainer.textContent).toContain("任务完成");
    expect(mixedContainer.textContent).toContain("#task-2");
    expect(mixedContainer.textContent).not.toContain("等待新任务");
  });
});
