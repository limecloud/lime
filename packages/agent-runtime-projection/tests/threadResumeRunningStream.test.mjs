import test from "node:test";
import assert from "node:assert/strict";

import {
  buildThreadResumeRunningStreamProjectionEvent,
  extractThreadResumeRunningStreamSnapshot,
} from "../dist/index.js";

function runningResumeInput(overrides = {}) {
  return {
    threadId: "thread-running",
    runningTurn: {
      id: "turn-running",
      status: "in_progress",
      itemsView: "not_loaded",
    },
    resumeRequest: {
      threadId: "thread-running",
      model: "not-the-running-model",
      cwd: "/tmp",
      initialTurnsPage: {},
    },
    resumeResponse: {
      thread: {
        id: "thread-running",
        status: "active",
      },
      model: "gpt-5.4",
      cwd: "/repo/current",
      initialTurnsPage: {
        data: [
          {
            id: "turn-running",
            status: "in_progress",
            itemsView: "summary",
          },
        ],
      },
    },
    streamBindings: [
      {
        id: "binding-1",
        threadId: "thread-running",
        turnId: "turn-running",
        active: true,
        source: "resume",
      },
    ],
    ...overrides,
  };
}

test("thread resume running stream keeps in-flight turn bound to the live stream", () => {
  const event = buildThreadResumeRunningStreamProjectionEvent(
    runningResumeInput(),
    {
      sequence: 111,
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
      sourceType: "thread_resume_running_stream_projection",
      sequence: 111,
      sessionId: "session-thread",
      threadId: "thread-running",
      turnId: "turn-running",
      owner: "context",
      scope: "thread",
      phase: "producing",
      surface: "timeline_evidence",
      persistence: "snapshot",
      control: "open_detail",
      runtimeStatus: "running",
    },
  );
  assert.equal(event.payload.activeStreamBound, true);
  assert.equal(event.payload.resumeUsesRunningThread, true);
  assert.equal(event.payload.historyOverrideBlocked, true);
  assert.deepEqual(event.payload.validationIssues, []);
});

test("thread resume running stream keeps override model and cwd from replacing the running thread", () => {
  const snapshot =
    extractThreadResumeRunningStreamSnapshot(runningResumeInput());

  assert.equal(snapshot.resumeRequest.requestedModel, "not-the-running-model");
  assert.equal(snapshot.resumeResponse.effectiveModel, "gpt-5.4");
  assert.equal(snapshot.resumeRequest.requestedCwd, "/tmp");
  assert.equal(snapshot.resumeResponse.effectiveCwd, "/repo/current");
  assert.deepEqual(snapshot.validationIssues, []);
});

test("thread resume running stream fails closed if resume returns NotLoaded", () => {
  const snapshot = extractThreadResumeRunningStreamSnapshot(
    runningResumeInput({
      resumeResponse: {
        thread: {
          id: "thread-running",
          status: "not_loaded",
        },
        initialTurnsPage: {
          data: [
            {
              id: "turn-running",
              status: "in_progress",
              itemsView: "summary",
            },
          ],
        },
      },
    }),
  );

  assert.equal(snapshot.resumeUsesRunningThread, false);
  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    ["resume_thread_not_loaded"],
  );
});

test("thread resume running stream fails closed if running turn is missing or completed in resume page", () => {
  const missing = extractThreadResumeRunningStreamSnapshot(
    runningResumeInput({
      resumeResponse: {
        thread: {
          id: "thread-running",
          status: "active",
        },
        initialTurnsPage: {
          data: [],
        },
      },
    }),
  );

  assert.deepEqual(
    missing.validationIssues.map((item) => item.code),
    ["running_turn_missing_from_resume_page"],
  );

  const completed = extractThreadResumeRunningStreamSnapshot(
    runningResumeInput({
      resumeResponse: {
        thread: {
          id: "thread-running",
          status: "active",
        },
        initialTurnsPage: {
          data: [
            {
              id: "turn-running",
              status: "completed",
              itemsView: "full",
            },
          ],
        },
      },
    }),
  );

  assert.deepEqual(
    completed.validationIssues.map((item) => item.code),
    ["running_turn_completed_on_resume", "running_turn_items_fully_loaded"],
  );
});

test("thread resume running stream rejects history override while the turn is running", () => {
  const snapshot = extractThreadResumeRunningStreamSnapshot(
    runningResumeInput({
      resumeRequest: {
        threadId: "thread-running",
        history: [
          {
            role: "user",
            content: "history override",
          },
        ],
      },
    }),
  );

  assert.equal(snapshot.historyOverrideBlocked, false);
  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    ["history_override_allowed_while_running"],
  );
});

test("thread resume running stream fails closed when live stream binding is absent or mismatched", () => {
  const absent = extractThreadResumeRunningStreamSnapshot(
    runningResumeInput({
      streamBindings: [],
    }),
  );

  assert.equal(absent.activeStreamBound, false);
  assert.deepEqual(
    absent.validationIssues.map((item) => item.code),
    ["live_stream_not_bound"],
  );

  const mismatched = extractThreadResumeRunningStreamSnapshot(
    runningResumeInput({
      streamBindings: [
        {
          id: "binding-wrong",
          threadId: "thread-other",
          turnId: "turn-other",
          active: true,
        },
      ],
    }),
  );

  assert.equal(mismatched.activeStreamBound, false);
  assert.deepEqual(
    mismatched.validationIssues.map((item) => item.code),
    ["stream_thread_mismatch", "stream_turn_mismatch"],
  );
});

test("thread resume running stream fails closed when resume creates a shadow session", () => {
  const snapshot = extractThreadResumeRunningStreamSnapshot(
    runningResumeInput({
      shadowSessions: [
        {
          id: "shadow-thread",
        },
      ],
    }),
  );

  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    ["shadow_session_created"],
  );
});
