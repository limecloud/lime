import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLiveTailCommitProjectionEvent,
  extractLiveTailCommitProjectionSnapshot,
} from "../dist/index.js";

const ITEM_SEQUENCE = ["user-item-1", "assistant-history-1"];

function frame(phase, sequence, overrides = {}) {
  return {
    phase,
    sequence,
    turnId: "turn-live-tail",
    messageId: "assistant-message-1",
    liveTailItemId: "assistant-live-tail-1",
    scrollAnchorItemId: "assistant-history-1",
    itemSequence: ITEM_SEQUENCE,
    output: "partial output",
    ...overrides,
  };
}

function baseInput(overrides = {}) {
  return {
    turnId: "turn-live-tail",
    messageId: "assistant-message-1",
    frames: [
      frame("first_visible", 1, {
        firstOutputVisible: true,
        output: "H",
      }),
      frame("streaming", 2, {
        output: "Hello with a live markdown table tail",
      }),
      frame("overflow_commit", 3, {
        historyItemId: "assistant-history-1",
        overflowCommitted: true,
        tableTail: {
          reflowed: true,
          rowCount: 4,
          columnCount: 3,
        },
      }),
      frame("completed", 4, {
        liveTailItemId: undefined,
        historyItemId: "assistant-history-1",
      }),
    ],
    ...overrides,
  };
}

test("live tail commit keeps first output visible and commits without sequence drift", () => {
  const event = buildLiveTailCommitProjectionEvent(baseInput(), {
    sessionId: "session-live-tail",
    threadId: "thread-live-tail",
    turnId: "turn-live-tail",
    sequence: 351,
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
      messageId: event.messageId,
      owner: event.owner,
      scope: event.scope,
      phase: event.phase,
      surface: event.surface,
      persistence: event.persistence,
      runtimeEntity: event.runtimeEntity,
      runtimeStatus: event.runtimeStatus,
    },
    {
      type: "state.snapshot",
      sourceType: "live_tail_commit_projection",
      sequence: 351,
      sessionId: "session-live-tail",
      threadId: "thread-live-tail",
      turnId: "turn-live-tail",
      messageId: "assistant-message-1",
      owner: "ui_projection",
      scope: "message",
      phase: "completed",
      surface: "conversation",
      persistence: "snapshot",
      runtimeEntity: "agent_turn",
      runtimeStatus: "completed",
    },
  );

  assert.deepEqual(event.payload.validationIssues, []);
  assert.equal(event.payload.firstOutputVisible, true);
  assert.equal(event.payload.firstOutputBeforeCommit, true);
  assert.equal(event.payload.liveTailHistorySeparated, true);
  assert.equal(event.payload.overflowCommitPreservesSequence, true);
  assert.equal(event.payload.scrollAnchorStable, true);
  assert.equal(event.payload.tableTailReflowStable, true);
  assert.equal(event.payload.overlayBufferRejected, true);
});

test("first output must appear before overflow commit", () => {
  const snapshot = extractLiveTailCommitProjectionSnapshot(
    baseInput({
      frames: [
        frame("overflow_commit", 1, {
          historyItemId: "assistant-history-1",
          overflowCommitted: true,
          tableTail: {
            reflowed: true,
            rowCount: 4,
            columnCount: 3,
          },
        }),
        frame("first_visible", 2, {
          firstOutputVisible: true,
        }),
      ],
    }),
  );

  assert(
    snapshot.validationIssues.some(
      (issue) => issue.code === "first_output_after_commit",
    ),
  );
  assert.equal(snapshot.firstOutputBeforeCommit, false);
});

test("overlay assistant buffer and pageText-only output fail closed", () => {
  const snapshot = extractLiveTailCommitProjectionSnapshot(
    baseInput({
      frames: [
        frame("first_visible", 1, {
          firstOutputVisible: true,
          overlayBufferUsed: true,
        }),
        {
          phase: "overflow_commit",
          sequence: 2,
          historyItemId: "assistant-history-1",
          scrollAnchorItemId: "assistant-history-1",
          itemSequence: ITEM_SEQUENCE,
          pageText: "long output still visible",
          tableTail: {
            reflowed: true,
            rowCount: 4,
            columnCount: 3,
          },
          overflowCommitted: true,
        },
      ],
    }),
  );

  assert(
    snapshot.validationIssues.some(
      (issue) => issue.code === "overlay_buffer_used",
    ),
  );
  assert(
    snapshot.validationIssues.some(
      (issue) => issue.code === "page_text_only_live_tail_oracle",
    ),
  );
  assert.equal(snapshot.overlayBufferRejected, false);
  assert.equal(snapshot.pageTextOnlyRejected, false);
});

test("live tail commit rejects history merge, scroll drift and missing table reflow", () => {
  const snapshot = extractLiveTailCommitProjectionSnapshot(
    baseInput({
      frames: [
        frame("first_visible", 1, {
          firstOutputVisible: true,
          liveTailItemId: "assistant-history-1",
        }),
        frame("overflow_commit", 2, {
          liveTailItemId: "assistant-history-1",
          historyItemId: "assistant-history-1",
          scrollAnchorItemId: "other-anchor",
          itemSequence: ["user-item-1", "assistant-history-1", "other-item"],
          overflowCommitted: true,
        }),
      ],
    }),
  );

  assert(
    snapshot.validationIssues.some(
      (issue) => issue.code === "live_tail_history_not_separated",
    ),
  );
  assert(
    snapshot.validationIssues.some(
      (issue) => issue.code === "overflow_commit_sequence_drift",
    ),
  );
  assert(
    snapshot.validationIssues.some(
      (issue) => issue.code === "scroll_anchor_lost",
    ),
  );
  assert(
    snapshot.validationIssues.some(
      (issue) => issue.code === "table_tail_reflow_missing",
    ),
  );
});
