import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockExecutionRunList, mockExecutionRunGet } = vi.hoisted(() => ({
  mockExecutionRunList: vi.fn(),
  mockExecutionRunGet: vi.fn(),
}));

vi.mock("@/lib/api/executionRun", () => ({
  executionRunList: mockExecutionRunList,
  executionRunGet: mockExecutionRunGet,
}));

import { ExecutionTrackerSettings } from ".";

interface Mounted {
  container: HTMLDivElement;
  root: Root;
}

const mounted: Mounted[] = [];

const MOCK_RUNS = [
  {
    id: "run-1",
    source: "chat",
    source_ref: "chat:message-1",
    session_id: "session-alpha",
    status: "running",
    started_at: "2026-03-16T08:00:00.000Z",
    finished_at: null,
    duration_ms: 820,
    error_code: null,
    error_message: null,
    metadata: JSON.stringify({ step: "prepare" }),
    created_at: "2026-03-16T08:00:00.000Z",
    updated_at: "2026-03-16T08:00:01.000Z",
  },
  {
    id: "run-2",
    source: "automation",
    source_ref: "workflow:publish",
    session_id: "session-beta",
    status: "error",
    started_at: "2026-03-16T07:45:00.000Z",
    finished_at: "2026-03-16T07:46:00.000Z",
    duration_ms: 60000,
    error_code: "TIMEOUT",
    error_message: "执行超时",
    metadata: JSON.stringify({ step: "publish" }),
    created_at: "2026-03-16T07:45:00.000Z",
    updated_at: "2026-03-16T07:46:00.000Z",
  },
];

function renderComponent() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<ExecutionTrackerSettings />);
  });

  mounted.push({ container, root });
  return container;
}

async function flushEffects() {
  await act(async () => {
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

function findButton(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find((item) =>
    item.textContent?.includes(text),
  );

  if (!button) {
    throw new Error(`未找到按钮: ${text}`);
  }

  return button as HTMLButtonElement;
}

async function clickButton(button: HTMLButtonElement) {
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushEffects();
  });
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  vi.clearAllMocks();

  mockExecutionRunList.mockResolvedValue(MOCK_RUNS);
  mockExecutionRunGet.mockResolvedValue({
    ...MOCK_RUNS[0],
    metadata: JSON.stringify({ step: "prepare", detail: "loaded" }),
  });
});

afterEach(() => {
  while (mounted.length > 0) {
    const target = mounted.pop();
    if (!target) {
      break;
    }

    act(() => {
      target.root.unmount();
    });
    target.container.remove();
  }

  vi.clearAllMocks();
});

describe("ExecutionTrackerSettings", () => {
  it("应渲染新的执行轨迹工作台与主要分区", async () => {
    const container = renderComponent();
    await flushEffects();

    const text = container.textContent ?? "";
    expect(mockExecutionRunList).toHaveBeenCalledWith(50, 0);
    expect(text).toContain("EXECUTION TRACKER");
    expect(text).toContain("轨迹列表");
    expect(text).toContain("筛选与同步");
    expect(text).toContain("查看约定");
    expect(text).toContain("session-alpha");
    expect(text).toContain("workflow:publish");
  });

  it("应把执行轨迹补充说明收进 tips", async () => {
    renderComponent();
    await flushEffects();

    expect(getBodyText()).not.toContain(
      "这里优先解决“刚刚发生了什么”这个问题。你可以统一看状态、会话 ID、来源引用和错误信息，再决定是否继续下钻到单条详情。",
    );
    expect(getBodyText()).not.toContain(
      "打开后会按固定周期静默同步，便于持续观察近期执行状态。",
    );

    const heroTip = await hoverTip("执行轨迹工作台说明");
    expect(getBodyText()).toContain(
      "这里优先解决“刚刚发生了什么”这个问题。你可以统一看状态、会话 ID、来源引用和错误信息，再决定是否继续下钻到单条详情。",
    );
    await leaveTip(heroTip);

    const autoRefreshTip = await hoverTip("自动刷新说明");
    expect(getBodyText()).toContain(
      "打开后会按固定周期静默同步，便于持续观察近期执行状态。",
    );
    await leaveTip(autoRefreshTip);
  });

  it("点击详情后应加载并展示执行详情", async () => {
    const container = renderComponent();
    await flushEffects();

    await clickButton(findButton(container, "详情"));

    expect(mockExecutionRunGet).toHaveBeenCalledWith("run-1");
    const bodyText = document.body.textContent ?? "";
    expect(bodyText).toContain("执行详情");
    expect(bodyText).toContain("run_id: run-1");
    expect(bodyText).toContain("session-alpha");
    expect(bodyText).toContain("loaded");
  });
});
