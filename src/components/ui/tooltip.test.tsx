import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip";

interface MountedTooltip {
  container: HTMLDivElement;
  root: Root;
}

const mountedTooltips: MountedTooltip[] = [];

function mountTooltip(): MountedTooltip["container"] {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button">触发</button>
          </TooltipTrigger>
          <TooltipContent side="right">展开导航栏</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
  });

  mountedTooltips.push({ container, root });
  return container;
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("Tooltip", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });

  afterEach(() => {
    while (mountedTooltips.length > 0) {
      const mounted = mountedTooltips.pop();
      if (!mounted) {
        continue;
      }
      act(() => {
        mounted.root.unmount();
      });
      mounted.container.remove();
    }
    vi.unstubAllGlobals();
  });

  it("应通过 portal 渲染 tooltip 内容，避免被局部容器裁切", async () => {
    const container = mountTooltip();
    const trigger = container.querySelector("button");
    expect(trigger).not.toBeNull();
    await flushEffects();

    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      await Promise.resolve();
    });

    expect(document.body.querySelector('[role="tooltip"]')).not.toBeNull();
    expect(container.textContent).not.toContain("展开导航栏");
    expect(document.body.textContent).toContain("展开导航栏");

    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
      await Promise.resolve();
    });

    expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
    expect(document.body.textContent).not.toContain("展开导航栏");
  });
});
