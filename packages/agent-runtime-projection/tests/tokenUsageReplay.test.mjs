import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTokenUsageReplayProjectionEvent,
  extractTokenUsageReplaySnapshot,
} from "../dist/index.js";

function tokenUsageNotification(threadId, turnId, tokenUsage = usage()) {
  return {
    method: "thread/tokenUsage/updated",
    params: {
      threadId,
      turnId,
      tokenUsage,
    },
  };
}

function usage(overrides = {}) {
  return {
    total: {
      input_tokens: 120,
      cached_input_tokens: 20,
      output_tokens: 30,
      reasoning_output_tokens: 10,
      total_tokens: 150,
    },
    last: {
      input_tokens: 70,
      cached_input_tokens: 10,
      output_tokens: 20,
      reasoning_output_tokens: 5,
      total_tokens: 90,
    },
    model_context_window: 200000,
    ...overrides,
  };
}

function baseInput(overrides = {}) {
  return {
    threadId: "thread-token",
    expectedTurnId: "turn-owner",
    staleTailTurnId: "turn-stale-tail",
    tokenUsageNotification: [
      tokenUsageNotification("thread-token", "turn-owner"),
    ],
    notificationOrder: [
      { method: "thread/resume.response" },
      { method: "thread/tokenUsage/updated" },
      { method: "turn/started" },
    ],
    otherConnectionNotifications: [],
    contextWindowSurface: {
      model_context_window: 200000,
      total_tokens: 150,
    },
    transcriptItems: [],
    readModelItems: [],
    ...overrides,
  };
}

test("token usage replay projects restored usage before the next turn", () => {
  const event = buildTokenUsageReplayProjectionEvent(baseInput(), {
    sequence: 221,
    sessionId: "session-token",
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
      type: "metric.changed",
      sourceType: "token_usage_replay_projection",
      sequence: 221,
      sessionId: "session-token",
      threadId: "thread-token",
      turnId: "turn-owner",
      owner: "diagnostics",
      scope: "thread",
      phase: "completed",
      surface: "runtime_status",
      persistence: "snapshot",
      control: "none",
      runtimeStatus: "completed",
    },
  );
  assert.equal(event.payload.replayNotificationSeen, true);
  assert.equal(event.payload.turnAttributionMatchesExpected, true);
  assert.equal(event.payload.staleTailIgnored, true);
  assert.equal(event.payload.tokenUsageHasTotals, true);
  assert.equal(event.payload.replayBeforeNextTurn, true);
  assert.deepEqual(event.payload.validationIssues, []);
});

test("token usage replay skips notification when turns are excluded", () => {
  const snapshot = extractTokenUsageReplaySnapshot({
    threadId: "thread-token",
    excludeTurns: true,
    tokenUsageNotification: [],
  });

  assert.equal(snapshot.replaySkippedForExcludeTurns, true);
  assert.deepEqual(snapshot.validationIssues, []);

  const unexpected = extractTokenUsageReplaySnapshot(
    baseInput({
      excludeTurns: true,
    }),
  );
  assert.deepEqual(
    unexpected.validationIssues.map((item) => item.code),
    ["token_usage_replayed_when_turns_excluded"],
  );
});

test("token usage replay fails closed on wrong thread or wrong turn attribution", () => {
  const snapshot = extractTokenUsageReplaySnapshot(
    baseInput({
      tokenUsageNotification: [
        tokenUsageNotification("other-thread", "turn-stale-tail"),
      ],
    }),
  );

  assert.equal(snapshot.threadScoped, false);
  assert.equal(snapshot.turnAttributionMatchesExpected, false);
  assert.equal(snapshot.staleTailIgnored, false);
  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    [
      "token_usage_wrong_thread",
      "token_usage_wrong_turn",
      "stale_tail_turn_owns_usage",
    ],
  );
});

test("token usage replay requires totals and context window surface", () => {
  const snapshot = extractTokenUsageReplaySnapshot(
    baseInput({
      tokenUsageNotification: [
        tokenUsageNotification("thread-token", "turn-owner", {
          total: {
            total_tokens: 150,
          },
          last: {},
        }),
      ],
      contextWindowSurface: {
        model_context_window: 128000,
        total_tokens: 150,
      },
    }),
  );

  assert.equal(snapshot.tokenUsageHasTotals, false);
  assert.equal(snapshot.contextWindowSurfaceUpdated, false);
  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    ["token_usage_missing_totals", "context_window_surface_not_updated"],
  );
});

test("token usage replay must happen before next turn and stay connection-scoped", () => {
  const snapshot = extractTokenUsageReplaySnapshot(
    baseInput({
      notificationOrder: [
        { method: "thread/resume.response" },
        { method: "turn/started" },
        { method: "thread/tokenUsage/updated" },
      ],
      otherConnectionNotifications: [
        tokenUsageNotification("thread-token", "turn-owner"),
      ],
    }),
  );

  assert.equal(snapshot.replayBeforeNextTurn, false);
  assert.equal(snapshot.connectionScoped, false);
  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    [
      "token_usage_replayed_after_next_turn",
      "token_usage_broadcast_to_other_connections",
    ],
  );
});

test("token usage replay must not become transcript or read-model items", () => {
  const snapshot = extractTokenUsageReplaySnapshot(
    baseInput({
      transcriptItems: [
        {
          type: "token_usage",
          role: "assistant",
        },
      ],
      readModelItems: [
        {
          type: "thread_token_usage",
        },
      ],
    }),
  );

  assert.equal(snapshot.transcriptClean, false);
  assert.equal(snapshot.readModelClean, false);
  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    [
      "token_usage_rendered_as_transcript_item",
      "token_usage_persisted_as_read_model_item",
    ],
  );
});
