import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentThreadMemoryPrefetchPreview } from "./AgentThreadMemoryPrefetchPreview";

interface MountedHarness {
  container: HTMLDivElement;
  root: Root;
}

const mountedRoots: MountedHarness[] = [];

function renderPreview(
  props: React.ComponentProps<typeof AgentThreadMemoryPrefetchPreview>,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<AgentThreadMemoryPrefetchPreview {...props} />);
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
    if (!mounted) break;
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
});

describe("AgentThreadMemoryPrefetchPreview", () => {
  it("ready 状态应使用 emerald 主色并展示记忆命中预演", () => {
    const container = renderPreview({
      status: "ready",
      error: null,
      result: {
        session_id: "session-preview-1",
        rules_source_paths: ["/workspace/AGENTS.md"],
        working_memory_excerpt: "补上本轮风险摘要。",
        durable_memories: [],
        team_memory_entries: [],
        latest_compaction: null,
        prompt: "【运行时记忆召回】补上本轮风险摘要。",
      },
    });

    const panel = container.querySelector(
      '[data-testid="agent-thread-reliability-memory-prefetch"]',
    );
    expect(panel).not.toBeNull();
    expect(panel?.className).toContain("border-emerald-200");
    expect(panel?.textContent).toContain("记忆命中预演");
    expect(panel?.textContent).toContain("规则 1");
    expect(panel?.textContent).toContain("会话 已命中");
    const promptBlock = container.querySelector("pre");
    expect(promptBlock?.className).toContain("border-sky-100");
    expect(promptBlock?.className).not.toContain("bg-slate-950");
    expect(promptBlock?.textContent).toContain("【运行时记忆召回】");
  });

  it("error 状态应保留 amber 提醒色", () => {
    const container = renderPreview({
      status: "error",
      error: "记忆预取暂不可用",
      result: null,
    });

    const panel = container.querySelector(
      '[data-testid="agent-thread-reliability-memory-prefetch"]',
    );
    expect(panel).not.toBeNull();
    expect(panel?.className).toContain("border-amber-200");
    expect(panel?.textContent).toContain("暂不可用");
    expect(panel?.textContent).toContain("记忆预取暂不可用");
  });
});
