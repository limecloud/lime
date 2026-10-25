import test from "node:test";
import assert from "node:assert/strict";

import {
  buildThreadReadPageIsomorphicProjectionEvent,
  extractThreadReadPageIsomorphicSnapshot,
} from "../dist/index.js";

function turn(id, itemIds, overrides = {}) {
  return {
    id,
    threadId: "thread-read",
    itemsView: "full",
    items: itemIds.map((itemId) => ({
      id: itemId,
      turnId: id,
    })),
    ...overrides,
  };
}

function threadReadInput(overrides = {}) {
  const turns = [
    turn("turn-1", ["item-1-user", "item-1-assistant"]),
    turn("turn-2", ["item-2-user", "item-2-assistant"]),
  ];
  return {
    threadId: "thread-read",
    liveContentParts: [
      { turnId: "turn-1", itemId: "item-1-user" },
      { turnId: "turn-1", itemId: "item-1-assistant" },
      { turnId: "turn-2", itemId: "item-2-user" },
      { turnId: "turn-2", itemId: "item-2-assistant" },
    ],
    threadRead: {
      threadId: "thread-read",
      itemsView: "full",
      turns,
    },
    turnsListPage: {
      threadId: "thread-read",
      data: turns,
    },
    resumeInitialTurnsPage: {
      threadId: "thread-read",
      data: turns,
    },
    paginationPages: [
      {
        threadId: "thread-read",
        data: [turns[0]],
      },
      {
        threadId: "thread-read",
        data: [turns[1]],
      },
    ],
    ...overrides,
  };
}

test("thread read/list/resume pages stay isomorphic for hydrate", () => {
  const event = buildThreadReadPageIsomorphicProjectionEvent(
    threadReadInput(),
    {
      sequence: 131,
      sessionId: "session-thread",
      timestamp: "2026-07-09T00:00:00.000Z",
    },
  );

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
      runtimeStatus: event.runtimeStatus,
    },
    {
      type: "context.changed",
      sourceType: "thread_read_page_isomorphic_projection",
      sequence: 131,
      sessionId: "session-thread",
      threadId: "thread-read",
      turnId: "turn-1",
      owner: "context",
      scope: "thread",
      phase: "completed",
      surface: "timeline_evidence",
      persistence: "snapshot",
      control: "open_detail",
      runtimeStatus: "completed",
    },
  );
  assert.equal(event.payload.threadScopeStable, true);
  assert.equal(event.payload.turnPageIsomorphic, true);
  assert.equal(event.payload.itemPageIsomorphic, true);
  assert.equal(event.payload.liveReadModelIsomorphic, true);
  assert.equal(event.payload.paginationStable, true);
  assert.equal(event.payload.legacyPaginatedHistoryClean, true);
  assert.deepEqual(event.payload.validationIssues, []);
});

test("thread read page detects turn order drift across turns/list and resume", () => {
  const secondFirst = [
    turn("turn-2", ["item-2-user", "item-2-assistant"]),
    turn("turn-1", ["item-1-user", "item-1-assistant"]),
  ];
  const snapshot = extractThreadReadPageIsomorphicSnapshot(
    threadReadInput({
      turnsListPage: {
        threadId: "thread-read",
        data: secondFirst,
      },
      resumeInitialTurnsPage: {
        threadId: "thread-read",
        data: secondFirst,
      },
    }),
  );

  assert.equal(snapshot.turnPageIsomorphic, false);
  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    [
      "turn_page_order_drift",
      "resume_page_order_drift",
      "item_page_order_drift",
    ],
  );
});

test("thread read page rejects live content that cannot hydrate from read model item ids", () => {
  const snapshot = extractThreadReadPageIsomorphicSnapshot(
    threadReadInput({
      liveContentParts: [
        { turnId: "turn-1", itemId: "item-1-user" },
        { turnId: "turn-1", itemId: "item-1-assistant" },
        { turnId: "turn-2", itemId: "item-2-user" },
      ],
    }),
  );

  assert.equal(snapshot.liveReadModelIsomorphic, false);
  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    ["live_read_model_mismatch"],
  );
});

test("thread read pagination fails closed on duplicate or legacy paginated history source", () => {
  const snapshot = extractThreadReadPageIsomorphicSnapshot(
    threadReadInput({
      paginationPages: [
        {
          data: [turn("turn-1", ["item-1-user", "item-1-assistant"])],
        },
        {
          data: [turn("turn-1", ["item-1-user", "item-1-assistant"])],
        },
      ],
      observedSources: [
        {
          source: "legacy_paginated_history",
        },
      ],
    }),
  );

  assert.equal(snapshot.paginationStable, false);
  assert.equal(snapshot.legacyPaginatedHistoryClean, false);
  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    ["pagination_reordered_turns", "legacy_paginated_history_used"],
  );
});

test("thread read page requires thread scoped read/list/resume pages", () => {
  const snapshot = extractThreadReadPageIsomorphicSnapshot(
    threadReadInput({
      turnsListPage: {
        threadId: "thread-other",
        data: [turn("turn-1", ["item-1-user", "item-1-assistant"])],
      },
    }),
  );

  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    ["thread_id_mismatch", "turn_page_order_drift"],
  );
});
