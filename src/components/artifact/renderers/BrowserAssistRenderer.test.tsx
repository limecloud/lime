import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Artifact } from "@/lib/artifact/types";
import { BrowserAssistRenderer } from "./BrowserAssistRenderer";

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function createArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: overrides.id ?? "browser-assist:general",
    type: "browser_assist",
    title: overrides.title ?? "浏览器协助",
    content: overrides.content ?? "",
    status: overrides.status ?? "complete",
    meta: {
      browserAssistScopeKey: "project:session",
      ...(overrides.meta || {}),
    },
    position: overrides.position ?? { start: 0, end: 0 },
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
    error: overrides.error,
  };
}

async function renderArtifact(artifact: Artifact) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  await act(async () => {
    root.render(<BrowserAssistRenderer artifact={artifact} />);
  });

  await act(async () => {
    await Promise.resolve();
  });

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
    if (!mounted) break;
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  vi.clearAllMocks();
});

describe("BrowserAssistRenderer", () => {
  it("pending Artifact 应展示启动提示", async () => {
    const container = await renderArtifact(
      createArtifact({
        status: "pending",
        meta: {
          profileKey: "general_browser_assist",
          url: "https://example.com",
          launchState: "launching",
        },
      }),
    );

    expect(container.textContent).toContain("正在启动浏览器协助");
    expect(container.textContent).toContain("通常需要 3–8 秒");
    expect(container.textContent).toContain("https://example.com");
  });

  it("完整会话 Artifact 也不应再在 Claw 画布内渲染浏览器工作区", async () => {
    const container = await renderArtifact(
      createArtifact({
        status: "complete",
        meta: {
          profileKey: "general_browser_assist",
          sessionId: "session-1",
          targetId: "target-1",
        },
      }),
    );

    expect(container.textContent).toContain("浏览器协助已迁移到浏览器工作台");
    expect(container.textContent).toContain("session-1");
    expect(
      container.querySelector("[data-testid=\"browser-runtime-workspace\"]"),
    ).toBeNull();
  });
});
