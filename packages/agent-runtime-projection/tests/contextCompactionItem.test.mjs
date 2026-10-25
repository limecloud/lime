import test from "node:test";
import assert from "node:assert/strict";

import {
  buildContextCompactionItemProjectionEvent,
  extractContextCompactionItemSnapshot,
} from "../dist/index.js";

function compactionItem(id = "cmp-1") {
  return {
    type: "contextCompaction",
    id,
  };
}

function itemNotification(method, threadId, item) {
  return {
    method,
    params: {
      threadId,
      item,
    },
  };
}

function baseInput(overrides = {}) {
  return {
    threadId: "thread-compact",
    itemStarted: [
      itemNotification("item/started", "thread-compact", compactionItem()),
    ],
    itemCompleted: [
      itemNotification("item/completed", "thread-compact", compactionItem()),
    ],
    expectedReplacementHistory: [
      { type: "message", role: "assistant", text: "COMPACT_SUMMARY" },
      compactionItem(),
    ],
    actualReplacementHistory: [
      { type: "message", role: "assistant", text: "COMPACT_SUMMARY" },
      compactionItem(),
    ],
    oldItemFingerprintBefore: {
      itemIds: ["user-1", "assistant-1", "user-2", "assistant-2"],
    },
    oldItemFingerprintAfter: {
      itemIds: ["user-1", "assistant-1", "user-2", "assistant-2"],
    },
    readModelItems: [compactionItem()],
    followupModelInput: [
      { type: "message", role: "assistant", text: "COMPACT_SUMMARY" },
      compactionItem(),
      { type: "message", role: "user", text: "next" },
    ],
    compactStartResponse: {},
    ...overrides,
  };
}

test("context compaction item preserves started/completed lifecycle and hydrated history", () => {
  const event = buildContextCompactionItemProjectionEvent(baseInput(), {
    sequence: 231,
    sessionId: "session-compact",
    turnId: "turn-compact",
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
      runtimeStatus: event.runtimeStatus,
    },
    {
      type: "context.changed",
      sourceType: "context_compaction_item_projection",
      sequence: 231,
      sessionId: "session-compact",
      threadId: "thread-compact",
      turnId: "turn-compact",
      owner: "context",
      scope: "thread",
      phase: "completed",
      surface: "timeline_evidence",
      persistence: "snapshot",
      control: "open_detail",
      runtimeStatus: "completed",
    },
  );
  assert.equal(event.payload.startedSeen, true);
  assert.equal(event.payload.compactionItemId, "cmp-1");
  assert.equal(event.payload.completedSeen, true);
  assert.equal(event.payload.itemIdsMatch, true);
  assert.equal(event.payload.replacementHistoryVerbatim, true);
  assert.equal(event.payload.oldItemsStable, true);
  assert.equal(event.payload.readModelContainsCompaction, true);
  assert.deepEqual(event.payload.validationIssues, []);
});

test("context compaction item requires started and completed items with matching id", () => {
  const snapshot = extractContextCompactionItemSnapshot(
    baseInput({
      itemStarted: [],
      itemCompleted: [
        itemNotification(
          "item/completed",
          "thread-compact",
          compactionItem("cmp-2"),
        ),
      ],
      readModelItems: [compactionItem("cmp-2")],
      followupModelInput: [compactionItem("cmp-2")],
    }),
  );

  assert.equal(snapshot.startedSeen, false);
  assert.equal(snapshot.itemIdsMatch, false);
  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    ["missing_compaction_started", "compaction_item_id_mismatch"],
  );
});

test("context compaction item rejects deprecated thread compacted notification as only signal", () => {
  const snapshot = extractContextCompactionItemSnapshot({
    threadId: "thread-compact",
    deprecatedCompactedNotification: [
      {
        method: "thread/compacted",
        params: {
          threadId: "thread-compact",
        },
      },
    ],
  });

  assert.equal(snapshot.deprecatedOnly, true);
  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    [
      "missing_compaction_started",
      "missing_compaction_completed",
      "compaction_item_id_mismatch",
      "deprecated_thread_compacted_only",
    ],
  );
});

test("context compaction item keeps replacement history verbatim and old item fingerprints stable", () => {
  const snapshot = extractContextCompactionItemSnapshot(
    baseInput({
      actualReplacementHistory: [
        { type: "message", role: "assistant", text: "REWRITTEN_SUMMARY" },
        compactionItem(),
      ],
      oldItemFingerprintAfter: {
        itemIds: ["user-1", "assistant-1", "rewritten"],
      },
    }),
  );

  assert.equal(snapshot.replacementHistoryVerbatim, false);
  assert.equal(snapshot.oldItemsStable, false);
  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    ["replacement_history_rewritten", "old_items_rewritten"],
  );
});

test("context compaction item requires read model and follow-up model input to preserve compaction", () => {
  const snapshot = extractContextCompactionItemSnapshot(
    baseInput({
      readModelItems: [{ type: "message", text: "summary only" }],
      followupModelInput: [{ type: "message", text: "summary only" }],
    }),
  );

  assert.equal(snapshot.readModelContainsCompaction, false);
  assert.equal(snapshot.followupHistoryContainsCompaction, false);
  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    [
      "compaction_missing_from_read_model",
      "followup_history_missing_compaction",
    ],
  );
});

test("context compaction item keeps thread compact start response as empty ack", () => {
  const snapshot = extractContextCompactionItemSnapshot(
    baseInput({
      compactStartResponse: {
        item: compactionItem(),
      },
    }),
  );

  assert.equal(snapshot.compactStartResponseEmpty, false);
  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    ["compact_start_response_not_empty"],
  );
});
