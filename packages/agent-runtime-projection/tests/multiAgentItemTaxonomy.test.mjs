import test from "node:test";
import assert from "node:assert/strict";

import { extractMultiAgentItemTaxonomySnapshot } from "../dist/index.js";

const EXPECTED_TOOLS = [
  "spawn_agent",
  "send_message",
  "followup_task",
  "wait_agent",
  "interrupt_agent",
  "list_agents",
];

function item(toolName, status, overrides = {}) {
  return {
    type: "collabToolCall",
    itemId: `${toolName}-item`,
    toolName,
    status,
    parentThreadId: "thread-root",
    turnId: "turn-root",
    receiverThreadIds: toolName === "list_agents" ? [] : ["thread-worker"],
    childThreadId: toolName === "spawn_agent" ? "thread-worker" : undefined,
    taskName: toolName === "spawn_agent" ? "researcher" : undefined,
    message: `${toolName} message`,
    ...overrides,
  };
}

function surface(
  surfaceName,
  itemIds = EXPECTED_TOOLS.map((tool) => `${tool}-item`),
) {
  return {
    surface: surfaceName,
    itemIds,
  };
}

function baseInput(overrides = {}) {
  return {
    threadId: "thread-root",
    expectedTools: EXPECTED_TOOLS,
    expectedStatuses: ["running", "completed", "interrupted"],
    taxonomyItems: [
      item("spawn_agent", "completed"),
      item("send_message", "running"),
      item("followup_task", "completed"),
      item("wait_agent", "completed"),
      item("interrupt_agent", "interrupted"),
      item("list_agents", "completed"),
    ],
    surfaceBindings: [
      surface("team_transcript"),
      surface("worker_card", ["spawn_agent-item", "wait_agent-item"]),
      surface("review_lane", ["interrupt_agent-item"]),
    ],
    legacyTextSummaries: [],
    orphanAgentHistories: [],
    ...overrides,
  };
}

test("multi-agent item taxonomy covers current v2 team tools as structured items", () => {
  const snapshot = extractMultiAgentItemTaxonomySnapshot(baseInput());

  assert.deepEqual(snapshot.validationIssues, []);
  assert.equal(snapshot.toolsCovered, true);
  assert.equal(snapshot.statusesCovered, true);
  assert.equal(snapshot.parentThreadBound, true);
  assert.equal(snapshot.surfacesBoundToItems, true);
  assert.deepEqual(
    snapshot.items.map((entry) => [entry.toolName, entry.status]),
    [
      ["spawn_agent", "completed"],
      ["send_message", "running"],
      ["followup_task", "completed"],
      ["wait_agent", "completed"],
      ["interrupt_agent", "aborted"],
      ["list_agents", "completed"],
    ],
  );
});

test("multi-agent taxonomy does not promote v1 tool names into v2 coverage", () => {
  const snapshot = extractMultiAgentItemTaxonomySnapshot(
    baseInput({
      taxonomyItems: [
        item("send_input", "running"),
        item("resume_agent", "completed"),
        item("wait", "completed"),
        item("close_agent", "interrupted"),
      ],
      surfaceBindings: [
        surface("team_transcript", [
          "send_input-item",
          "resume_agent-item",
          "wait-item",
          "close_agent-item",
        ]),
      ],
    }),
  );

  assert.deepEqual(
    snapshot.items.map((entry) => entry.toolName),
    [undefined, undefined, undefined, undefined],
  );
  assert.equal(snapshot.toolsCovered, false);
  assert.equal(snapshot.statusesCovered, true);
  assert.deepEqual(
    snapshot.validationIssues
      .map((entry) => entry.code)
      .filter(
        (code) =>
          code === "legacy_tool_name" || code === "expected_tool_missing",
      ),
    [
      "legacy_tool_name",
      "legacy_tool_name",
      "legacy_tool_name",
      "legacy_tool_name",
      "expected_tool_missing",
    ],
  );
});

test("multi-agent taxonomy rejects legacy tools and missing lineage", () => {
  const snapshot = extractMultiAgentItemTaxonomySnapshot(
    baseInput({
      taxonomyItems: [
        item("SubAgentTask", "running", {
          itemId: undefined,
          turnId: undefined,
          parentThreadId: undefined,
        }),
      ],
      surfaceBindings: [],
    }),
  );

  assert.equal(snapshot.itemIdsStable, false);
  assert.equal(snapshot.turnIdsStable, false);
  assert.equal(snapshot.parentThreadBound, false);
  assert.deepEqual(
    snapshot.validationIssues.map((entry) => entry.code),
    [
      "legacy_tool_name",
      "missing_item_id",
      "missing_turn_id",
      "missing_parent_thread_id",
      "expected_tool_missing",
      "expected_status_missing",
      "surface_item_binding_missing",
    ],
  );
});

test("multi-agent taxonomy requires spawn child lineage", () => {
  const snapshot = extractMultiAgentItemTaxonomySnapshot(
    baseInput({
      taxonomyItems: [
        item("spawn_agent", "completed", {
          childThreadId: undefined,
          receiverThreadIds: [],
        }),
        item("send_message", "running"),
        item("followup_task", "completed"),
        item("wait_agent", "completed"),
        item("interrupt_agent", "interrupted"),
        item("list_agents", "completed"),
      ],
    }),
  );

  assert.equal(snapshot.childLineageStable, false);
  assert(
    snapshot.validationIssues.some(
      (entry) => entry.code === "missing_child_thread_id",
    ),
  );
});

test("multi-agent taxonomy rejects text summaries and orphan agent histories", () => {
  const snapshot = extractMultiAgentItemTaxonomySnapshot(
    baseInput({
      legacyTextSummaries: [
        {
          text: "Researcher is running",
        },
      ],
      orphanAgentHistories: [
        {
          agentId: "researcher",
          childSessionId: "session-worker",
        },
      ],
    }),
  );

  assert.equal(snapshot.legacyTextSummaryClean, false);
  assert.equal(snapshot.orphanAgentHistoryClean, false);
  assert.deepEqual(
    snapshot.validationIssues
      .map((entry) => entry.code)
      .filter((code) => code.includes("summary") || code.includes("orphan")),
    ["text_summary_timeline_leak", "orphan_agent_history"],
  );
});

test("multi-agent taxonomy requires GUI surfaces to bind item ids", () => {
  const snapshot = extractMultiAgentItemTaxonomySnapshot(
    baseInput({
      surfaceBindings: [
        surface("team_transcript", ["spawn_agent-item"]),
        surface("worker_card", ["missing-item"]),
      ],
    }),
  );

  assert.equal(snapshot.surfacesBoundToItems, false);
  assert(
    snapshot.validationIssues.some(
      (entry) => entry.code === "surface_item_binding_missing",
    ),
  );
});
