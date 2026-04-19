import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorDisplay, type ErrorInfo } from "./ErrorDisplay";

interface MountedRoot {
  container: HTMLDivElement;
  root: Root;
}

const mountedRoots: MountedRoot[] = [];

function renderErrorDisplay(errors: ErrorInfo[]) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <ErrorDisplay errors={errors} onDismiss={vi.fn()} onRetry={vi.fn()} />,
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

describe("ErrorDisplay", () => {
  it("错误通知应保持浅色主题按钮和表面", () => {
    const container = renderErrorDisplay([
      {
        id: "error-1",
        message: "检测失败，请稍后重试",
        type: "general",
      },
    ]);

    const notice = container.querySelector(".rounded-lg.border");
    expect(notice).toBeTruthy();
    expect(notice?.className).toContain("bg-slate-50");
    expect(notice?.className).not.toContain("dark:bg-slate-950/30");

    const buttons = container.querySelectorAll("button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.className).toContain("bg-white");
    expect(buttons[0]?.className).not.toContain("dark:bg-slate-900/70");
  });
});
