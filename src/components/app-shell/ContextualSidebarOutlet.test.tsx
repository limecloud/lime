import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { ContextualSidebarOutlet } from "./ContextualSidebarOutlet";
import { useContextualSidebar } from "./useContextualSidebar";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function Page({ page, label }: { page: string; label: string }) {
  const mounted = useContextualSidebar(page, (
    <div data-testid="page-sidebar-content">{label}</div>
  ));
  return (
    <div data-testid="page-main">
      {mounted ? "slot" : "inline"}
    </div>
  );
}

describe("ContextualSidebarOutlet", () => {
  it("页面侧栏节点在 AppSidebar 槽位渲染，页面退回无侧栏主区", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      act(() =>
        root.render(
          <>
            <div data-testid="app-sidebar">
              <ContextualSidebarOutlet page="scheduled-tasks" />
            </div>
            <Page page="scheduled-tasks" label="scheduled" />
          </>,
        ),
      );

      expect(
        host.querySelector('[data-testid="page-sidebar-content"]')
          ?.textContent,
      ).toBe("scheduled");
      expect(
        host.querySelector('[data-testid="app-sidebar"]')
          ?.textContent,
      ).toContain("scheduled");
      expect(host.querySelector('[data-testid="page-main"]')?.textContent).toBe(
        "slot",
      );
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  });

  it("页面卸载后清空槽位，其他页面不会被旧节点占据", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      act(() =>
        root.render(
          <>
            <div data-testid="app-sidebar">
              <ContextualSidebarOutlet page="scheduled-tasks" />
            </div>
            <Page page="scheduled-tasks" label="first" />
          </>,
        ),
      );
      expect(host.textContent).toContain("first");

      act(() =>
        root.render(
          <>
            <div data-testid="app-sidebar">
              <ContextualSidebarOutlet page="scheduled-tasks" />
            </div>
            <Page page="plugins" label="second" />
          </>,
        ),
      );
      const sidebar = host.querySelector('[data-testid="app-sidebar"]');
      expect(sidebar?.textContent).toBe("");
      expect(host.textContent).not.toContain("first");
      expect(host.textContent).not.toContain("second");
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  });
});
