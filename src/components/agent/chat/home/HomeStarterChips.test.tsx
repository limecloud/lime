import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeStarterChips } from "./HomeStarterChips";
import type { HomeStarterChip } from "./homeSurfaceTypes";

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

function renderChips(chips: HomeStarterChip[], onSelect = vi.fn()) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  act(() => {
    root.render(<HomeStarterChips chips={chips} onSelect={onSelect} />);
  });

  return { container, onSelect };
}

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

describe("HomeStarterChips", () => {
  it("渲染轻量起手入口并把选择交给上层", () => {
    const chips: HomeStarterChip[] = [
      {
        id: "starter-draft",
        label: "写第一版",
        launchKind: "curated_task_launcher",
        targetItemId: "social-post-starter",
        testId: "entry-recommended-social-post-starter",
      },
      {
        id: "starter-manager",
        label: "⚙",
        launchKind: "open_manager",
        testId: "home-skill-manager-trigger",
      },
    ];
    const { container, onSelect } = renderChips(chips);

    const draft = container.querySelector(
      '[data-testid="entry-recommended-social-post-starter"]',
    ) as HTMLButtonElement | null;
    const manager = container.querySelector(
      '[data-testid="home-skill-manager-trigger"]',
    ) as HTMLButtonElement | null;

    expect(draft?.textContent).toBe("写第一版");
    expect(manager?.getAttribute("aria-label")).toBe("管理做法");

    act(() => {
      draft?.click();
    });

    expect(onSelect).toHaveBeenCalledWith(chips[0]);
  });
});
