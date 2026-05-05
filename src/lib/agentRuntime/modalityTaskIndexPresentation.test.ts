import { describe, expect, it } from "vitest";

import type { AgentRuntimeEvidenceTaskIndex } from "@/lib/api/agentRuntime";
import {
  buildModalityTaskIndexFacets,
  buildModalityTaskIndexRows,
  filterModalityTaskIndexRows,
} from "./modalityTaskIndexPresentation";

function createTaskIndex(): AgentRuntimeEvidenceTaskIndex {
  return {
    snapshot_count: 2,
    thread_ids: ["thread-root"],
    turn_ids: [],
    content_ids: ["content-root"],
    entry_keys: ["@browser"],
    modalities: ["browser"],
    skill_ids: [],
    model_ids: ["claude-sonnet"],
    executor_kinds: [],
    executor_binding_keys: ["lime_browser_mcp"],
    cost_states: ["estimated"],
    limit_states: [],
    estimated_cost_classes: [],
    limit_event_kinds: ["within_limit"],
    quota_low_count: 0,
    items: [
      {
        artifact_path: ".lime/harness/browser.json",
        contract_key: "browser_replay_viewer",
        thread_id: "thread-evidence-1",
        turn_id: "turn-evidence-1",
        content_id: "content-browser-1",
        entry_key: "@browser",
        modality: "browser",
        skill_id: "browser_control",
        model_id: "claude-sonnet",
        executor_kind: "mcp",
        executor_binding_key: "lime_browser_mcp",
        cost_state: "estimated",
        limit_state: "within_limit",
        estimated_cost_class: "low",
        limit_event_kind: "within_limit",
        quota_low: false,
      },
      {
        artifact_path: ".lime/harness/research.json",
        contract_key: "web_research",
        thread_id: "thread-evidence-2",
        turn_id: "turn-evidence-2",
        content_id: "content-research-1",
        entry_key: "@搜索",
        modality: "web_research",
        skill_id: "research",
        model_id: "claude-haiku",
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

describe("modalityTaskIndexPresentation", () => {
  it("应把 Evidence taskIndex 汇总成任务中心可查询 facets", () => {
    const facets = buildModalityTaskIndexFacets(createTaskIndex());

    expect(facets.identityAnchors).toEqual([
      "thread-root",
      "thread-evidence-1",
      "thread-evidence-2",
      "turn-evidence-1",
      "turn-evidence-2",
      "content-root",
      "content-browser-1",
      "content-research-1",
      "@browser",
      "@搜索",
    ]);
    expect(facets.executorDimensions).toEqual([
      "browser",
      "web_research",
      "browser_control",
      "research",
      "claude-sonnet",
      "claude-haiku",
      "mcp",
      "search_query",
      "lime_browser_mcp",
      "web_search",
    ]);
    expect(facets.costLimitDimensions).toEqual([
      "estimated",
      "metered",
      "within_limit",
      "quota_low",
      "low",
      "medium",
    ]);
    expect(facets.quotaLowCount).toBe(1);
  });

  it("应把索引 items 转换成稳定任务行", () => {
    const rows = buildModalityTaskIndexRows(createTaskIndex());

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: "thread-evidence-1:turn-evidence-1:content-browser-1:@browser:browser_replay_viewer:.lime/harness/browser.json",
      title: "@browser",
      artifactPath: ".lime/harness/browser.json",
      threadId: "thread-evidence-1",
      contentId: "content-browser-1",
      executorKind: "mcp",
      executorBindingKey: "lime_browser_mcp",
      costState: "estimated",
      limitState: "within_limit",
    });
  });

  it("应按任务中心查询维度过滤行", () => {
    const rows = buildModalityTaskIndexRows(createTaskIndex());

    expect(
      filterModalityTaskIndexRows(rows, {
        entryKey: "@搜索",
        executorKind: "search_query",
        costState: "metered",
        limitState: "quota_low",
      }).map((row) => row.contentId),
    ).toEqual(["content-research-1"]);

    expect(
      filterModalityTaskIndexRows(rows, {
        contentId: "content-browser-1",
        executorBindingKey: "lime_browser_mcp",
      }).map((row) => row.entryKey),
    ).toEqual(["@browser"]);
  });
});
