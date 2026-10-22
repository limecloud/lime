import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RightSurfaceBrowserPanel } from "./RightSurfaceBrowserPanel";
import type { BrowserTabHistoricalProjection } from "@/lib/api/browserTab";

vi.mock("./BrowserWorkspace", () => ({
  BrowserWorkspace: ({
    initialUrl,
    runtimeSessionId,
    threadId,
    onNavigate,
    active = true,
  }: {
    initialUrl?: string | null;
    runtimeSessionId?: string | null;
    threadId: string;
    onNavigate?: (url: string, title?: string | null) => void;
    active?: boolean;
  }) => (
    <button
      type="button"
      data-testid="mock-browser-workspace"
      data-initial-url={initialUrl ?? ""}
      data-runtime-session-id={runtimeSessionId ?? ""}
      data-thread-id={threadId}
      data-active={active}
      onClick={() => onNavigate?.("https://example.com/", "Example")}
    >
      browser panel
    </button>
  ),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("RightSurfaceBrowserPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("应在右侧 surface 内渲染内嵌浏览器 panel", () => {
    act(() => {
      root.render(
        <RightSurfaceBrowserPanel
          initialUrl="https://example.com"
          runtimeSessionId="session-1"
          controlMode="human_takeover"
          lifecycleState="human_controlling"
          threadId="thread-1"
        />,
      );
    });

    const panel = container.querySelector(
      '[data-testid="right-surface-browser-panel"]',
    );
    expect(panel).toBeTruthy();
    expect(panel?.getAttribute("data-browser-session-id")).toBe("");
    expect(panel?.getAttribute("data-browser-control-mode")).toBe(
      "human_takeover",
    );
    expect(panel?.getAttribute("data-browser-control-owner")).toBe("human");
    expect(panel?.getAttribute("data-browser-human-takeover")).toBe("true");
    expect(panel?.getAttribute("data-browser-lifecycle-state")).toBe(
      "human_controlling",
    );
    expect(panel?.getAttribute("data-browser-thread-id")).toBe("thread-1");
    expect(
      container.querySelector('[data-testid="right-surface-browser-panel"]'),
    ).toBeTruthy();
    expect(
      container
        .querySelector('[data-testid="mock-browser-workspace"]')
        ?.getAttribute("data-initial-url"),
    ).toBe("https://example.com");
    expect(
      container
        .querySelector('[data-testid="mock-browser-workspace"]')
        ?.getAttribute("data-runtime-session-id"),
    ).toBe("session-1");
    expect(
      container.querySelector(
        '[data-testid="right-surface-browser-control-overlay"]',
      )?.textContent,
    ).toContain("agentChat.rightSurface.browserControl.human.label");
  });

  it("收起和恢复时保留同一 workspace，并把原生 view 可见性委托给 active", () => {
    act(() => {
      root.render(<RightSurfaceBrowserPanel threadId="thread-1" />);
    });
    const workspace = container.querySelector(
      '[data-testid="mock-browser-workspace"]',
    );
    expect(workspace?.getAttribute("data-active")).toBe("true");
    act(() => {
      root.render(
        <RightSurfaceBrowserPanel active={false} threadId="thread-1" />,
      );
    });

    expect(
      container.querySelector('[data-testid="mock-browser-workspace"]'),
    ).toBe(workspace);
    expect(workspace?.getAttribute("data-active")).toBe("false");
    act(() => {
      root.render(<RightSurfaceBrowserPanel threadId="thread-1" />);
    });
    expect(
      container.querySelector('[data-testid="mock-browser-workspace"]'),
    ).toBe(workspace);
    expect(workspace?.getAttribute("data-active")).toBe("true");
  });

  it("Agent 控制常态只暴露 flags，不渲染接管 overlay", () => {
    act(() => {
      root.render(
        <RightSurfaceBrowserPanel
          runtimeSessionId="session-2"
          controlMode="agent"
          lifecycleState="live"
          threadId="thread-2"
        />,
      );
    });

    const panel = container.querySelector(
      '[data-testid="right-surface-browser-panel"]',
    );
    expect(panel?.getAttribute("data-browser-control-owner")).toBe("agent");
    expect(panel?.getAttribute("data-browser-human-takeover")).toBe("false");
    expect(
      container.querySelector(
        '[data-testid="right-surface-browser-control-overlay"]',
      ),
    ).toBeNull();
  });

  it("历史只读投影仅在激活后确认展示，不等待原生挂载", () => {
    const projection: BrowserTabHistoricalProjection = {
      browserSessionId: "browser-session-1",
      tabId: "browser-tab-1",
      threadId: "thread-1",
      url: "https://example.com/history",
      title: "History",
      pageRevision: 3,
      mark: "handoff",
      origin: "agent",
      selected: true,
      snapshotId: "snapshot-3",
      replayedAt: "2026-08-23T00:00:00.000Z",
      readOnly: true,
    };
    const onLaunchApplied = vi.fn();
    const render = (active: boolean) =>
      act(() => {
        root.render(
          <RightSurfaceBrowserPanel
            threadId="thread-1"
            active={active}
            historicalProjection={projection}
            launchRequestId="historical-request"
            onLaunchApplied={onLaunchApplied}
          />,
        );
      });
    render(false);
    expect(onLaunchApplied).not.toHaveBeenCalled();
    render(true);
    expect(onLaunchApplied).toHaveBeenCalledExactlyOnceWith(
      "historical-request",
    );
    expect(
      container.querySelector('[data-testid="browser-workspace-historical"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="mock-browser-workspace"]'),
    ).toBeNull();
  });
});
