import test from "node:test";
import assert from "node:assert/strict";

import {
  buildThreadStatusRuntimeUpdateProjectionEvent,
  extractThreadStatusRuntimeUpdateSnapshot,
} from "../dist/index.js";

function statusNotification(threadId, status) {
  return {
    method: "thread/status/changed",
    params: {
      threadId,
      status,
    },
  };
}

function activeStatus(activeFlags = []) {
  return {
    type: "active",
    activeFlags,
  };
}

function idleStatus() {
  return {
    type: "idle",
  };
}

function statusInput(overrides = {}) {
  return {
    threadId: "thread-status",
    notifications: [
      statusNotification("thread-status", activeStatus([])),
      statusNotification("thread-status", idleStatus()),
    ],
    transcriptItems: [],
    readModelItems: [],
    observedSurfaces: [
      {
        surface: "header",
        threadId: "thread-status",
        status: "active",
        source: "runtime_notification",
      },
      {
        surface: "sidebar",
        threadId: "thread-status",
        status: "idle",
        source: "runtime_notification",
      },
    ],
    ...overrides,
  };
}

test("thread status runtime update projects active then idle outside the transcript", () => {
  const event = buildThreadStatusRuntimeUpdateProjectionEvent(statusInput(), {
    sequence: 131,
    sessionId: "session-thread",
    turnId: "turn-status",
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
      sourceType: "thread_status_runtime_update_projection",
      sequence: 131,
      sessionId: "session-thread",
      threadId: "thread-status",
      turnId: "turn-status",
      owner: "runtime",
      scope: "thread",
      phase: "completed",
      surface: "runtime_status",
      persistence: "ephemeral_live",
      control: "none",
      runtimeStatus: "idle",
    },
  );
  assert.equal(event.payload.sawActiveUpdate, true);
  assert.equal(event.payload.sawInactiveAfterActive, true);
  assert.equal(event.payload.transcriptClean, true);
  assert.equal(event.payload.readModelClean, true);
  assert.deepEqual(event.payload.validationIssues, []);
});

test("thread status runtime update maps waiting active flags to waiting runtime status", () => {
  const snapshot = extractThreadStatusRuntimeUpdateSnapshot(
    statusInput({
      notifications: [
        statusNotification(
          "thread-status",
          activeStatus(["waitingOnApproval"]),
        ),
      ],
    }),
  );

  assert.equal(snapshot.latestStatus, "active");
  assert.equal(snapshot.latestRuntimeStatus, "waiting");
  assert.equal(snapshot.statusUpdates[0].activeFlags[0], "waiting_on_approval");
  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    ["missing_inactive_after_active"],
  );
});

test("thread status runtime update can be opted out without requiring notifications", () => {
  const snapshot = extractThreadStatusRuntimeUpdateSnapshot({
    threadId: "thread-status",
    optOutNotificationMethods: ["thread/status/changed"],
    notifications: [],
    transcriptItems: [],
    readModelItems: [],
  });

  assert.equal(snapshot.optedOut, true);
  assert.equal(snapshot.statusUpdates.length, 0);
  assert.deepEqual(snapshot.validationIssues, []);
});

test("thread status runtime update fails if opted-out notifications still arrive", () => {
  const snapshot = extractThreadStatusRuntimeUpdateSnapshot(
    statusInput({
      optOutNotificationMethods: ["thread/status/changed"],
      notifications: [statusNotification("thread-status", activeStatus([]))],
    }),
  );

  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    ["opt_out_notification_emitted"],
  );
});

test("thread status runtime update fails closed without active or inactive edge", () => {
  const missingActive = extractThreadStatusRuntimeUpdateSnapshot(
    statusInput({
      notifications: [statusNotification("thread-status", idleStatus())],
    }),
  );
  assert.deepEqual(
    missingActive.validationIssues.map((item) => item.code),
    ["missing_active_update"],
  );

  const missingInactive = extractThreadStatusRuntimeUpdateSnapshot(
    statusInput({
      notifications: [statusNotification("thread-status", activeStatus([]))],
    }),
  );
  assert.deepEqual(
    missingInactive.validationIssues.map((item) => item.code),
    ["missing_inactive_after_active"],
  );
});

test("thread status runtime update rejects transcript and read-model item leaks", () => {
  const snapshot = extractThreadStatusRuntimeUpdateSnapshot(
    statusInput({
      transcriptItems: [
        {
          type: "thread_status_changed",
          surface: "conversation",
          role: "assistant",
        },
      ],
      readModelItems: [
        {
          type: "thread_status",
          status: "active",
        },
      ],
    }),
  );

  assert.equal(snapshot.transcriptClean, false);
  assert.equal(snapshot.readModelClean, false);
  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    [
      "status_rendered_as_transcript_item",
      "status_persisted_as_read_model_item",
    ],
  );
});

test("thread status runtime update rejects unscoped surfaces and DOM text status inference", () => {
  const snapshot = extractThreadStatusRuntimeUpdateSnapshot(
    statusInput({
      observedSurfaces: [
        {
          surface: "header",
          status: "active",
          source: "dom_text",
        },
      ],
    }),
  );

  assert.equal(snapshot.runtimeSurfacesBound, false);
  assert.equal(snapshot.domTextFree, false);
  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    ["status_surface_missing_thread_scope", "status_derived_from_dom_text"],
  );
});

test("thread status runtime update requires thread id and preserves active flags", () => {
  const snapshot = extractThreadStatusRuntimeUpdateSnapshot({
    notifications: [
      {
        method: "thread/status/changed",
        params: {
          status: {
            type: "active",
            activeFlags: [7],
          },
        },
      },
    ],
  });

  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    ["missing_thread_id", "missing_inactive_after_active", "active_flags_lost"],
  );
});
