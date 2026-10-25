import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRealtimeConversationProjectionEvent,
  extractRealtimeConversationSnapshot,
} from "../dist/index.js";

function currentEvents() {
  return [
    {
      method: "thread/realtime/started",
      params: {
        threadId: "thread-rt",
        realtimeSessionId: "sess-v2",
        version: "v2",
      },
    },
    {
      method: "thread/realtime/itemAdded",
      params: {
        threadId: "thread-rt",
        item: {
          id: "item-message-1",
          type: "message",
          role: "assistant",
          text: "hi",
        },
      },
    },
    {
      method: "thread/realtime/transcript/delta",
      params: {
        threadId: "thread-rt",
        role: "assistant",
        delta: "working",
      },
    },
    {
      method: "thread/realtime/transcript/done",
      params: {
        threadId: "thread-rt",
        role: "assistant",
        text: "working on it",
      },
    },
    {
      method: "thread/realtime/outputAudio/delta",
      params: {
        threadId: "thread-rt",
        audio: {
          data: "AQID",
          sampleRate: 24000,
          numChannels: 1,
          samplesPerChannel: 512,
        },
      },
    },
    {
      method: "thread/realtime/itemAdded",
      params: {
        threadId: "thread-rt",
        item: {
          id: "item-handoff-1",
          type: "handoff_request",
          handoff_id: "handoff_1",
          input_transcript: "delegate now",
        },
      },
    },
    {
      method: "thread/realtime/error",
      params: {
        threadId: "thread-rt",
        message: "upstream boom",
      },
    },
    {
      method: "thread/realtime/closed",
      params: {
        threadId: "thread-rt",
        reason: "error",
      },
    },
  ];
}

function currentInput(overrides = {}) {
  return {
    featureStatus: "current",
    currentOwner: "app-server-thread-realtime",
    events: currentEvents(),
    projectedRealtimeItems: [
      {
        type: "realtime_session",
        threadId: "thread-rt",
      },
      {
        type: "realtime_transcript",
        threadId: "thread-rt",
      },
      {
        type: "realtime_audio",
        threadId: "thread-rt",
      },
    ],
    appendRequests: [
      {
        kind: "text",
        text: "first",
        responseActive: true,
        createsResponse: false,
      },
      {
        kind: "audio",
        responseActive: true,
      },
    ],
    sidebandAudio: {
      toolCallActive: true,
      audioForwardedBeforeToolComplete: true,
    },
    ...overrides,
  };
}

test("realtime remains explicitly not-current when no owner or events are present", () => {
  const event = buildRealtimeConversationProjectionEvent(
    {
      featureStatus: "not_current",
      events: [],
      visibleTranscriptItems: [],
      toolOutputs: [],
    },
    {
      sessionId: "session-rt",
      threadId: "thread-rt",
      turnId: "turn-rt",
      sequence: 321,
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
      runtimeEntity: event.runtimeEntity,
      runtimeStatus: event.runtimeStatus,
    },
    {
      type: "state.snapshot",
      sourceType: "realtime_conversation_item_projection",
      sequence: 321,
      sessionId: "session-rt",
      threadId: "thread-rt",
      turnId: "turn-rt",
      owner: "runtime",
      scope: "thread",
      phase: "archived",
      surface: "runtime_status",
      persistence: "snapshot",
      runtimeEntity: "agent_turn",
      runtimeStatus: "completed",
    },
  );
  assert.equal(event.payload.featureStatus, "not_current");
  assert.equal(event.payload.notCurrentLeakFree, true);
  assert.deepEqual(event.payload.validationIssues, []);
});

test("not-current realtime events fail closed if they leak to transcript or tool output", () => {
  const snapshot = extractRealtimeConversationSnapshot({
    featureStatus: "not_current",
    events: [
      {
        method: "thread/realtime/transcript/delta",
        params: {
          threadId: "thread-rt",
          role: "assistant",
          delta: "hidden realtime",
        },
      },
    ],
    visibleTranscriptItems: [
      {
        type: "message",
        text: "thread/realtime/transcript/delta hidden realtime",
      },
    ],
    toolOutputs: ["conversation.item.added as ordinary tool output"],
  });

  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    [
      "realtime_current_owner_missing",
      "realtime_event_leaked_to_transcript",
      "realtime_event_leaked_to_tool",
    ],
  );
  assert.equal(snapshot.notCurrentLeakFree, false);
});

test("current realtime projection preserves thread-scoped items, append-only text and nonblocking audio", () => {
  const snapshot = extractRealtimeConversationSnapshot(currentInput());

  assert.deepEqual(snapshot.validationIssues, []);
  assert.equal(snapshot.featureStatus, "current");
  assert.equal(snapshot.threadScoped, true);
  assert.equal(snapshot.lifecycleComplete, true);
  assert.equal(snapshot.currentProjectionComplete, true);
  assert.equal(snapshot.appendOnlyTextInput, true);
  assert.equal(snapshot.sidebandAudioNonBlocking, true);
  assert.deepEqual(snapshot.eventCounts, {
    started: 1,
    item_added: 2,
    item_done: 0,
    transcript_delta: 1,
    transcript_done: 1,
    output_audio_delta: 1,
    sdp: 0,
    error: 1,
    closed: 1,
    response_created: 0,
    response_done: 0,
    response_cancelled: 0,
    unknown: 0,
  });
  assert.deepEqual(snapshot.events[1], {
    index: 1,
    kind: "item_added",
    threadId: "thread-rt",
    itemId: "item-message-1",
    itemType: "message",
    role: "assistant",
    textPreview: "hi",
  });
});

test("current realtime guard catches missing lifecycle, projection, append-only and sideband regressions", () => {
  const snapshot = extractRealtimeConversationSnapshot(
    currentInput({
      events: [
        {
          method: "thread/realtime/transcript/done",
          params: {
            role: "assistant",
            text: "done without thread",
          },
        },
      ],
      projectedRealtimeItems: [],
      appendRequests: [
        {
          kind: "text",
          text: "second",
          responseActive: true,
          createsResponse: true,
        },
      ],
      sidebandAudio: {
        toolCallActive: true,
        audioForwardedBeforeToolComplete: false,
      },
    }),
  );

  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    [
      "missing_thread_id",
      "missing_started_notification",
      "missing_closed_notification",
      "missing_realtime_projection_item",
      "transcript_done_without_delta",
      "append_only_response_created",
      "sideband_audio_blocked_by_tool_call",
    ],
  );
  assert.equal(snapshot.threadScoped, false);
  assert.equal(snapshot.lifecycleComplete, false);
  assert.equal(snapshot.currentProjectionComplete, false);
  assert.equal(snapshot.appendOnlyTextInput, false);
  assert.equal(snapshot.sidebandAudioNonBlocking, false);
});
