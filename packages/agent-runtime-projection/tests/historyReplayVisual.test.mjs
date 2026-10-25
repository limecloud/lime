import test from "node:test";
import assert from "node:assert/strict";

import {
  buildHistoryReplayVisualProjectionEvent,
  extractHistoryReplayVisualSnapshot,
} from "../dist/index.js";

const RENDERER_OWNER = "agent-history-replay-renderer";

function userItem(overrides = {}) {
  return {
    id: "user-1",
    turnId: "turn-1",
    type: "user_message",
    status: "completed",
    text: "[Image #1] replayed",
    textElements: [
      {
        range: [0, 10],
        placeholder: "[Image #1]",
      },
    ],
    localImagePaths: ["/tmp/replay.png"],
    remoteImageUrls: ["https://example.com/replay.png"],
    ...overrides,
  };
}

function assistantItem(overrides = {}) {
  return {
    id: "assistant-1",
    turnId: "turn-1",
    type: "agent_message",
    status: "completed",
    text: "assistant reply",
    ...overrides,
  };
}

function reasoningItem(overrides = {}) {
  return {
    id: "reasoning-1",
    turnId: "turn-1",
    type: "reasoning",
    status: "completed",
    summary: ["Summary only"],
    ...overrides,
  };
}

function mcpItem(overrides = {}) {
  return {
    id: "mcp-1",
    turnId: "turn-1",
    type: "mcp_tool_call",
    status: "in_progress",
    server: "copilot-bridge",
    tool: "copilot",
    ...overrides,
  };
}

function visualRow(item, overrides = {}) {
  return {
    itemId: item.id,
    turnId: item.turnId,
    type: item.type,
    status: item.status,
    rendererOwner: RENDERER_OWNER,
    text: item.text,
    textElements: item.textElements ?? [],
    localImagePaths: item.localImagePaths ?? [],
    remoteImageUrls: item.remoteImageUrls ?? [],
    summaryRenderCount: item.id === "reasoning-1" ? 1 : 0,
    active: item.status === "in_progress",
    ...overrides,
  };
}

function baseInput(overrides = {}) {
  const replayedItems = [
    userItem(),
    assistantItem(),
    reasoningItem(),
    mcpItem(),
  ];
  return {
    threadId: "thread-history",
    turnId: "turn-1",
    liveRendererOwner: RENDERER_OWNER,
    hydrateRendererOwner: RENDERER_OWNER,
    replayedItems,
    hydratedItems: replayedItems,
    visualRows: replayedItems.map((item) => visualRow(item)),
    ...overrides,
  };
}

test("history replay visual keeps user images, reasoning and active MCP rows isomorphic", () => {
  const event = buildHistoryReplayVisualProjectionEvent(baseInput(), {
    sessionId: "session-history",
    sequence: 441,
    timestamp: "2026-07-09T00:00:00.000Z",
  });

  assert.deepEqual(
    {
      type: event.type,
      sourceType: event.sourceType,
      sequence: event.sequence,
      sessionId: event.sessionId,
      threadId: event.threadId,
      turnId: event.turnId,
      owner: event.owner,
      scope: event.scope,
      phase: event.phase,
      surface: event.surface,
      persistence: event.persistence,
      control: event.control,
      runtimeEntity: event.runtimeEntity,
      runtimeStatus: event.runtimeStatus,
    },
    {
      type: "state.snapshot",
      sourceType: "history_replay_visual_projection",
      sequence: 441,
      sessionId: "session-history",
      threadId: "thread-history",
      turnId: "turn-1",
      owner: "ui_projection",
      scope: "thread",
      phase: "completed",
      surface: "conversation",
      persistence: "snapshot",
      control: "open_detail",
      runtimeEntity: "agent_turn",
      runtimeStatus: "completed",
    },
  );
  assert.deepEqual(event.payload.validationIssues, []);
  assert.equal(event.payload.itemIdentityStable, true);
  assert.equal(event.payload.itemOrderStable, true);
  assert.equal(event.payload.userRichContentPreserved, true);
  assert.equal(event.payload.mcpActivePreserved, true);
  assert.equal(event.payload.reasoningSummaryDeduped, true);
  assert.equal(event.payload.rendererSingleOwner, true);
  assert.equal(event.payload.pageTextOnlyRejected, true);
  assert.deepEqual(event.payload.historyReplayVisual.replayedItemIds, [
    "user-1",
    "assistant-1",
    "reasoning-1",
    "mcp-1",
  ]);
  assert.deepEqual(event.refs.artifactPaths, ["/tmp/replay.png"]);
});

test("replayed user images cannot degrade into placeholder-only page text", () => {
  const items = [userItem(), assistantItem(), reasoningItem(), mcpItem()];
  const snapshot = extractHistoryReplayVisualSnapshot(
    baseInput({
      replayedItems: items,
      hydratedItems: items,
      visualRows: [
        visualRow(items[0], {
          localImagePaths: [],
          remoteImageUrls: [],
          text: "[Image #1] replayed",
        }),
        ...items.slice(1).map((item) => visualRow(item)),
      ],
    }),
  );

  assert.equal(snapshot.userRichContentPreserved, false);
  assert.deepEqual(
    snapshot.validationIssues
      .filter((entry) =>
        ["user_image_refs_lost", "legacy_image_placeholder_only"].includes(
          entry.code,
        ),
      )
      .map((entry) => entry.code),
    ["user_image_refs_lost", "legacy_image_placeholder_only"],
  );
});

test("replayed in-progress MCP calls stay active instead of completed history", () => {
  const items = [userItem(), assistantItem(), reasoningItem(), mcpItem()];
  const snapshot = extractHistoryReplayVisualSnapshot(
    baseInput({
      replayedItems: items,
      hydratedItems: [...items.slice(0, 3), mcpItem({ status: "completed" })],
      visualRows: [
        ...items.slice(0, 3).map((item) => visualRow(item)),
        visualRow(mcpItem({ status: "completed" }), {
          active: false,
        }),
      ],
    }),
  );

  assert.equal(snapshot.mcpActivePreserved, false);
  assert(
    snapshot.validationIssues.some(
      (entry) => entry.code === "mcp_in_progress_not_active",
    ),
  );
  assert(
    snapshot.validationIssues.some(
      (entry) => entry.code === "mcp_active_rendered_as_completed_history",
    ),
  );
});

test("live reasoning summary completion must not render a duplicate replay row", () => {
  const items = [userItem(), assistantItem(), reasoningItem(), mcpItem()];
  const snapshot = extractHistoryReplayVisualSnapshot(
    baseInput({
      replayedItems: items,
      hydratedItems: items,
      visualRows: items.map((item) =>
        item.id === "reasoning-1"
          ? visualRow(item, { summaryRenderCount: 2 })
          : visualRow(item),
      ),
    }),
  );

  assert.equal(snapshot.reasoningSummaryDeduped, false);
  assert(
    snapshot.validationIssues.some(
      (entry) => entry.code === "reasoning_summary_duplicated",
    ),
  );
});

test("live and hydrate renderers cannot split or rely on pageText-only oracle", () => {
  const items = [userItem(), assistantItem(), reasoningItem(), mcpItem()];
  const snapshot = extractHistoryReplayVisualSnapshot(
    baseInput({
      liveRendererOwner: "live-history-renderer",
      hydrateRendererOwner: "hydrate-history-renderer",
      replayedItems: items,
      hydratedItems: items,
      pageTextOracle: "Summary only",
      visualRows: items.map((item) =>
        visualRow(item, {
          rendererOwner:
            item.id === "assistant-1"
              ? "hydrate-history-renderer"
              : "live-history-renderer",
          pageTextOnly: item.id === "assistant-1",
        }),
      ),
    }),
  );

  assert.equal(snapshot.rendererSingleOwner, false);
  assert.equal(snapshot.pageTextOnlyRejected, false);
  assert(
    snapshot.validationIssues.some(
      (entry) => entry.code === "live_hydrate_renderer_split",
    ),
  );
  assert(
    snapshot.validationIssues.some(
      (entry) => entry.code === "page_text_only_oracle",
    ),
  );
});
