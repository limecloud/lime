import test from "node:test";
import assert from "node:assert/strict";

import {
  buildThreadInjectItemsProjectionEvent,
  extractThreadInjectItemsSnapshot,
} from "../dist/index.js";

function messageItem(id, text, metadata = undefined) {
  return {
    type: "message",
    id,
    role: "assistant",
    content: [
      {
        type: "output_text",
        text,
      },
    ],
    ...(metadata
      ? {
          internal_chat_message_metadata_passthrough: metadata,
        }
      : {}),
  };
}

function userPrompt(text) {
  return {
    type: "message",
    role: "user",
    content: [
      {
        type: "input_text",
        text,
      },
    ],
  };
}

function environmentContext() {
  return {
    type: "message",
    role: "system",
    content: [
      {
        type: "input_text",
        text: "<environment_context>",
      },
    ],
  };
}

function injectInput(overrides = {}) {
  const first = messageItem("msg-injected-1", "Injected assistant context", {
    source: "fixture",
    raw_response_payload_id: "raw-1",
  });
  const second = messageItem("msg-injected-2", "Second injected context");
  return {
    threadId: "thread-inject",
    turnId: "turn-inject",
    injectRequest: {
      threadId: "thread-inject",
      items: [first, second],
    },
    injectResponse: {},
    persistedHistory: {
      history: [
        {
          responseItem: first,
        },
        {
          responseItem: second,
        },
      ],
    },
    previousModelRequestInput: [environmentContext()],
    nextModelRequestInput: [
      environmentContext(),
      first,
      second,
      userPrompt("Hello"),
    ],
    hydratedItems: [
      {
        rawResponseItemId: "msg-injected-1",
        role: "context",
        surface: "timeline_evidence",
      },
      {
        rawResponseItemId: "msg-injected-2",
        role: "context",
        surface: "timeline_evidence",
      },
    ],
    ...overrides,
  };
}

test("thread inject items preserves raw response order and model-visible history", () => {
  const event = buildThreadInjectItemsProjectionEvent(injectInput(), {
    sequence: 121,
    sessionId: "session-thread",
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
      sourceType: "thread_inject_items_projection",
      sequence: 121,
      sessionId: "session-thread",
      threadId: "thread-inject",
      turnId: "turn-inject",
      owner: "context",
      scope: "thread",
      phase: "completed",
      surface: "timeline_evidence",
      persistence: "snapshot",
      control: "open_detail",
      runtimeStatus: "completed",
    },
  );
  assert.equal(event.payload.itemCount, 2);
  assert.equal(event.payload.persistedHistoryMatches, true);
  assert.equal(event.payload.nextModelInputMatches, true);
  assert.equal(event.payload.previousModelInputClean, true);
  assert.equal(event.payload.insertionOrderStable, true);
  assert.equal(event.payload.rawMetadataPreserved, true);
  assert.deepEqual(event.payload.validationIssues, []);
});

test("thread inject items after a turn only appears in the follow-up request", () => {
  const injected = messageItem("msg-after-turn", "Injected after first turn");
  const snapshot = extractThreadInjectItemsSnapshot(
    injectInput({
      turnId: "turn-after-first",
      injectRequest: {
        threadId: "thread-inject",
        items: [injected],
      },
      persistedHistory: [userPrompt("First turn"), { responseItem: injected }],
      previousModelRequestInput: [
        environmentContext(),
        userPrompt("First turn"),
      ],
      nextModelRequestInput: [
        environmentContext(),
        userPrompt("First turn"),
        injected,
        userPrompt("Second turn"),
      ],
      hydratedItems: [
        {
          rawResponseItemId: "msg-after-turn",
          role: "context",
          surface: "timeline_evidence",
        },
      ],
    }),
  );

  assert.equal(snapshot.injectionTurnId, "turn-after-first");
  assert.equal(snapshot.previousModelInputClean, true);
  assert.equal(snapshot.nextModelInputMatches, true);
  assert.deepEqual(snapshot.validationIssues, []);
});

test("thread inject items fails closed if rollout history or next model input drops the item", () => {
  const snapshot = extractThreadInjectItemsSnapshot(
    injectInput({
      persistedHistory: [],
      nextModelRequestInput: [environmentContext(), userPrompt("Hello")],
    }),
  );

  assert.equal(snapshot.persistedHistoryMatches, false);
  assert.equal(snapshot.nextModelInputMatches, false);
  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    ["persisted_history_missing_item", "next_model_input_missing_item"],
  );
});

test("thread inject items flags order drift and raw metadata loss", () => {
  const first = messageItem("msg-a", "A", {
    source: "fixture",
  });
  const second = messageItem("msg-b", "B");
  const firstWithoutMetadata = messageItem("msg-a", "A");
  const snapshot = extractThreadInjectItemsSnapshot(
    injectInput({
      injectRequest: {
        threadId: "thread-inject",
        items: [first, second],
      },
      persistedHistory: [second, firstWithoutMetadata],
      nextModelRequestInput: [environmentContext(), second, first],
    }),
  );

  assert.equal(snapshot.insertionOrderStable, false);
  assert.equal(snapshot.rawMetadataPreserved, false);
  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    ["raw_metadata_dropped", "insertion_order_changed"],
  );
});

test("thread inject items rejects premature input use and transcript hydrate leaks", () => {
  const first = messageItem("msg-leak", "Leaked injected context");
  const snapshot = extractThreadInjectItemsSnapshot(
    injectInput({
      injectRequest: {
        threadId: "thread-inject",
        items: [first],
      },
      persistedHistory: [first],
      previousModelRequestInput: [first],
      nextModelRequestInput: [environmentContext(), first, userPrompt("Hello")],
      hydratedItems: [
        {
          rawResponseItemId: "msg-leak",
          role: "assistant",
          surface: "conversation",
          final: true,
        },
        {
          rawResponseItemId: "msg-leak",
          role: "user",
          type: "user_message",
        },
      ],
    }),
  );

  assert.equal(snapshot.previousModelInputClean, false);
  assert.equal(snapshot.hydratedAsContextOnly, false);
  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    [
      "previous_model_input_contains_injected_item",
      "injected_item_rendered_as_assistant_final_tail",
      "injected_item_rendered_as_user_input",
    ],
  );
});

test("thread inject items requires a loaded thread, a turn linkage and inline images", () => {
  const remoteImageItem = {
    type: "message",
    role: "user",
    content: [
      {
        type: "input_image",
        image_url: "https://example.test/image.png",
      },
    ],
  };
  const snapshot = extractThreadInjectItemsSnapshot({
    injectRequest: {
      items: [remoteImageItem],
    },
    persistedHistory: [remoteImageItem],
    nextModelRequestInput: [remoteImageItem],
  });

  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    [
      "missing_thread_id",
      "injected_item_missing_turn_linkage",
      "remote_image_url_allowed",
    ],
  );
});

test("thread inject items rejects empty and non-response-item payloads", () => {
  const empty = extractThreadInjectItemsSnapshot({
    threadId: "thread-inject",
    turnId: "turn-inject",
    injectRequest: {
      threadId: "thread-inject",
      items: [],
    },
  });
  assert.deepEqual(
    empty.validationIssues.map((item) => item.code),
    ["empty_injected_items"],
  );

  const invalid = extractThreadInjectItemsSnapshot({
    threadId: "thread-inject",
    turnId: "turn-inject",
    injectRequest: {
      threadId: "thread-inject",
      items: ["not-a-response-item"],
    },
  });
  assert.deepEqual(
    invalid.validationIssues.map((item) => item.code),
    ["invalid_response_item"],
  );
});
