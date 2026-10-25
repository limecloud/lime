import test from "node:test";
import assert from "node:assert/strict";

import {
  buildResizeReflowSnapshotProjectionEvent,
  extractResizeReflowProjectionSnapshot,
} from "../dist/index.js";

function frame(phase, width, height, overrides = {}) {
  return {
    phase,
    viewport: { width, height },
    threadId: "thread-resize",
    turnId: "turn-resize",
    messageList: {
      anchorItemId: "assistant-item-2",
      topItemId: "user-item-1",
      bottomItemId: "assistant-item-2",
      scrollTop: 420,
    },
    inputbar: {
      visible: true,
      row: 24,
      bottomPx: 12,
    },
    rightSurface: {
      visible: true,
      owner: "artifact_workspace",
      requestId: "workspace-request-1",
      width: 360,
    },
    itemSequence: ["user-item-1", "assistant-item-2"],
    ...overrides,
  };
}

function baseInput(overrides = {}) {
  return {
    threadId: "thread-resize",
    turnId: "turn-resize",
    frames: [
      frame("before", 1280, 820),
      frame("after", 880, 720, {
        inputbar: {
          visible: true,
          row: 24,
          bottomPx: 14,
        },
        rightSurface: {
          visible: true,
          owner: "artifact_workspace",
          requestId: "workspace-request-1",
          width: 260,
        },
      }),
    ],
    ...overrides,
  };
}

test("resize reflow snapshot keeps message, inputbar and right surface anchors stable", () => {
  const event = buildResizeReflowSnapshotProjectionEvent(baseInput(), {
    sessionId: "session-resize",
    threadId: "thread-resize",
    turnId: "turn-resize",
    sequence: 341,
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
      runtimeEntity: event.runtimeEntity,
      runtimeStatus: event.runtimeStatus,
    },
    {
      type: "state.snapshot",
      sourceType: "resize_reflow_snapshot_projection",
      sequence: 341,
      sessionId: "session-resize",
      threadId: "thread-resize",
      turnId: "turn-resize",
      owner: "ui_projection",
      scope: "thread",
      phase: "completed",
      surface: "conversation",
      persistence: "snapshot",
      runtimeEntity: "agent_turn",
      runtimeStatus: "completed",
    },
  );

  assert.deepEqual(event.payload.validationIssues, []);
  assert.equal(event.payload.resizePairCovered, true);
  assert.deepEqual(event.payload.viewportSizes, ["1280x820", "880x720"]);
  assert.equal(event.payload.threadTurnBindingPreserved, true);
  assert.equal(event.payload.messageAnchorStable, true);
  assert.equal(event.payload.inputbarAnchorStable, true);
  assert.equal(event.payload.rightSurfaceAnchorStable, true);
  assert.equal(event.payload.itemSequenceStable, true);
  assert.equal(event.payload.layoutStateKeptOutOfItems, true);
});

test("pageText-only resize assertions fail closed", () => {
  const snapshot = extractResizeReflowProjectionSnapshot(
    baseInput({
      frames: [
        frame("before", 1280, 820),
        {
          phase: "after",
          viewport: { width: 880, height: 720 },
          threadId: "thread-resize",
          turnId: "turn-resize",
          pageText: "assistant text still visible",
          inputbar: { visible: true, row: 24, bottomPx: 12 },
          rightSurface: {
            visible: true,
            owner: "artifact_workspace",
            requestId: "workspace-request-1",
            width: 260,
          },
        },
      ],
    }),
  );

  assert(
    snapshot.validationIssues.some(
      (issue) => issue.code === "page_text_only_layout_oracle",
    ),
  );
  assert(
    snapshot.validationIssues.some(
      (issue) => issue.code === "message_anchor_lost",
    ),
  );
  assert.equal(snapshot.pageTextOnlyRejected, false);
});

test("resize guard rejects lost thread binding, sequence drift and layout item writes", () => {
  const snapshot = extractResizeReflowProjectionSnapshot(
    baseInput({
      frames: [
        frame("before", 1280, 820),
        frame("after", 880, 720, {
          threadId: "thread-other",
          messageList: {
            anchorItemId: "assistant-item-other",
          },
          itemSequence: ["user-item-1", "assistant-item-other"],
          layoutStateWrittenToItem: true,
        }),
      ],
    }),
  );

  assert(
    snapshot.validationIssues.some(
      (issue) => issue.code === "thread_turn_binding_lost",
    ),
  );
  assert(
    snapshot.validationIssues.some(
      (issue) => issue.code === "message_anchor_lost",
    ),
  );
  assert(
    snapshot.validationIssues.some(
      (issue) => issue.code === "item_sequence_drift",
    ),
  );
  assert(
    snapshot.validationIssues.some(
      (issue) => issue.code === "layout_state_written_to_item",
    ),
  );
});

test("right surface owner and request must stay stable across resize", () => {
  const snapshot = extractResizeReflowProjectionSnapshot(
    baseInput({
      frames: [
        frame("before", 1280, 820),
        frame("after", 880, 720, {
          rightSurface: {
            visible: true,
            owner: "review_lane",
            requestId: "workspace-request-2",
            width: 260,
          },
        }),
      ],
    }),
  );

  assert(
    snapshot.validationIssues.some(
      (issue) => issue.code === "right_surface_anchor_lost",
    ),
  );
  assert.equal(snapshot.rightSurfaceAnchorStable, false);
});
