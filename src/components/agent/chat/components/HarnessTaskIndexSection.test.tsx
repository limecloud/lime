import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentRuntimeEvidenceTaskIndex } from "@/lib/api/agentRuntime";
import { HarnessTaskIndexSection } from "./HarnessTaskIndexSection";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

interface RenderResult {
  container: HTMLDivElement;
  root: Root;
}

const mountedRoots: RenderResult[] = [];

function createTaskIndex(): AgentRuntimeEvidenceTaskIndex {
  return {
    snapshot_count: 2,
    thread_ids: ["thread-evidence-1", "thread-evidence-2"],
    turn_ids: ["turn-evidence-1", "turn-evidence-2"],
    content_ids: ["content-browser-1", "content-search-1"],
    entry_keys: ["at_browser_agent_command", "at_search_command"],
    modalities: ["browser", "web_research"],
    skill_ids: ["browser_assist", "research"],
    model_ids: ["gpt-5.2-browser", "gpt-5.2"],
    executor_kinds: ["browser_action", "search_query"],
    executor_binding_keys: ["lime_browser_mcp", "web_search"],
    cost_states: ["estimated", "metered"],
    limit_states: ["within_limit", "quota_low"],
    estimated_cost_classes: ["low", "medium"],
    limit_event_kinds: ["quota_low"],
    quota_low_count: 1,
    items: [
      {
        artifact_path:
          "runtime_timeline/browser-tool-1/mcp__lime-browser__navigate",
        contract_key: "browser_control",
        thread_id: "thread-evidence-1",
        turn_id: "turn-evidence-1",
        content_id: "content-browser-1",
        entry_key: "at_browser_agent_command",
        modality: "browser",
        skill_id: "browser_assist",
        model_id: "gpt-5.2-browser",
        executor_kind: "browser_action",
        executor_binding_key: "lime_browser_mcp",
        cost_state: "estimated",
        limit_state: "within_limit",
        estimated_cost_class: "low",
        limit_event_kind: "within_limit",
        quota_low: false,
      },
      {
        artifact_path: "runtime_timeline/search-tool-1/search_query",
        contract_key: "web_research",
        thread_id: "thread-evidence-2",
        turn_id: "turn-evidence-2",
        content_id: "content-search-1",
        entry_key: "at_search_command",
        modality: "web_research",
        skill_id: "research",
        model_id: "gpt-5.2",
        executor_kind: "search_query",
        executor_binding_key: "web_search",
        cost_state: "metered",
        limit_state: "quota_low",
        estimated_cost_class: "medium",
        limit_event_kind: "quota_low",
        quota_low: true,
      },
    ],
  };
}

function renderSection(index: AgentRuntimeEvidenceTaskIndex): RenderResult {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<HarnessTaskIndexSection index={index} />);
  });

  const rendered = { container, root };
  mountedRoots.push(rendered);
  return rendered;
}

function setInputValue(input: HTMLSelectElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value",
  );
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function findSelectByLabel(labelText: string): HTMLSelectElement | null {
  return (
    Array.from(document.body.querySelectorAll("label"))
      .find((label) => label.textContent?.includes(labelText))
      ?.querySelector("select") ?? null
  );
}

afterEach(() => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) {
      continue;
    }
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
});

describe("HarnessTaskIndexSection", () => {
  it("应展示 taskIndex 摘要与任务中心过滤列表", () => {
    renderSection(createTaskIndex());

    expect(document.body.textContent).toContain("多模态任务索引");
    expect(document.body.textContent).toContain("任务中心过滤列表");
    expect(document.body.textContent).toContain("2 / 2");
    expect(document.body.textContent).toContain("thread-evidence-1");
    expect(document.body.textContent).toContain("content-browser-1");
    expect(document.body.textContent).toContain("lime_browser_mcp");
    expect(document.body.textContent).toContain(
      "runtime_timeline/browser-tool-1",
    );
  });

  it("应按入口过滤 taskIndex rows 并支持清空过滤", async () => {
    renderSection(createTaskIndex());

    const entryFilterSelect = findSelectByLabel("入口");
    expect(entryFilterSelect).not.toBeNull();

    await act(async () => {
      if (entryFilterSelect) {
        setInputValue(entryFilterSelect, "at_search_command");
      }
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("1 / 2");
    expect(document.body.textContent).toContain("content-search-1");
    expect(document.body.textContent).not.toContain(
      "runtime_timeline/browser-tool-1",
    );
    expect(document.body.textContent).toContain("清空过滤");

    const clearButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.trim() === "清空过滤");

    await act(async () => {
      clearButton?.click();
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("2 / 2");
    expect(document.body.textContent).toContain("content-browser-1");
    expect(document.body.textContent).toContain("content-search-1");
  });
});
