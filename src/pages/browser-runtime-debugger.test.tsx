import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserRuntimeDebuggerPage } from "./browser-runtime-debugger";

vi.mock("@/features/browser-runtime/BrowserRuntimeWorkspace", () => ({
  BrowserRuntimeWorkspace: () => (
    <div data-testid="browser-runtime-workspace">browser-runtime-workspace</div>
  ),
}));

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
  document.documentElement.style.overflow = "";
  document.documentElement.style.overflowY = "";
  document.body.style.overflow = "";
  document.body.style.overflowY = "";
  vi.clearAllMocks();
});

describe("BrowserRuntimeDebuggerPage", () => {
  it("挂载时应临时放开独立页的文档与根容器滚动", async () => {
    document.documentElement.style.overflow = "hidden";
    document.documentElement.style.overflowY = "hidden";
    document.body.style.overflow = "hidden";
    document.body.style.overflowY = "hidden";
    const container = document.createElement("div");
    container.id = "root";
    container.style.overflow = "hidden";
    container.style.height = "100vh";
    document.body.appendChild(container);

    const root = createRoot(container);
    mountedRoots.push({ root, container });

    await act(async () => {
      root.render(<BrowserRuntimeDebuggerPage />);
    });

    expect(document.documentElement.style.overflow).toBe("auto");
    expect(document.documentElement.style.overflowY).toBe("auto");
    expect(document.body.style.overflow).toBe("auto");
    expect(document.body.style.overflowY).toBe("auto");
    expect(container.style.overflow).toBe("visible");
    expect(container.style.height).toBe("auto");
    expect(container.style.minHeight).toBe("100vh");
  });

  it("卸载时应恢复原有文档与根容器配置", async () => {
    document.documentElement.style.overflow = "hidden";
    document.documentElement.style.overflowY = "hidden";
    document.body.style.overflow = "hidden";
    document.body.style.overflowY = "hidden";
    const container = document.createElement("div");
    container.id = "root";
    container.style.overflow = "hidden";
    container.style.height = "100vh";
    document.body.appendChild(container);

    const root = createRoot(container);

    await act(async () => {
      root.render(<BrowserRuntimeDebuggerPage />);
    });

    await act(async () => {
      root.unmount();
    });
    container.remove();

    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(document.documentElement.style.overflowY).toBe("hidden");
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.body.style.overflowY).toBe("hidden");
    expect(container.style.overflow).toBe("hidden");
    expect(container.style.height).toBe("100vh");
    expect(container.style.minHeight).toBe("");
  });
});
