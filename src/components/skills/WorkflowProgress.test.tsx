import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkflowProgress } from "./WorkflowProgress";

interface MountedRoot {
  container: HTMLDivElement;
  root: Root;
}

const mountedRoots: MountedRoot[] = [];

function renderWorkflow() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <WorkflowProgress
        steps={[
          { id: "step-1", name: "准备输入", dependencies: [] },
          { id: "step-2", name: "执行生成", dependencies: ["step-1"] },
        ]}
        currentStepId="step-2"
        completedSteps={[
          {
            step_id: "step-1",
            step_name: "准备输入",
            success: true,
            output: "ok",
          },
        ]}
        error="执行失败，请稍后重试"
      />,
    );
  });

  mountedRoots.push({ container, root });
  return container;
}

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

describe("WorkflowProgress", () => {
  it("运行中步骤和全局错误应保持浅色主题表面", () => {
    const container = renderWorkflow();
    const runningStep = Array.from(container.querySelectorAll("div")).find(
      (element) =>
        element.textContent?.includes("执行生成") &&
        element.className.includes("bg-emerald-50"),
    );
    const errorBanner = Array.from(container.querySelectorAll("div")).find(
      (element) =>
        element.textContent?.includes("执行失败，请稍后重试") &&
        element.className.includes("bg-red-50"),
    );

    expect(runningStep).toBeTruthy();
    expect(errorBanner).toBeTruthy();
    expect(runningStep?.className).toContain("bg-emerald-50");
    expect(runningStep?.className).not.toContain("dark:bg-emerald-950/30");
    expect(errorBanner?.className).toContain("bg-red-50");
    expect(errorBanner?.className).not.toContain("dark:bg-red-950/30");
  });
});
