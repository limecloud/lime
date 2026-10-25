import test from "node:test";
import assert from "node:assert/strict";

import {
  buildThreadArchiveDeleteHydrateProjectionEvent,
  extractThreadArchiveDeleteHydrateSnapshot,
} from "../dist/index.js";

function notification(method, threadId) {
  return {
    method,
    params: {
      threadId,
    },
  };
}

function thread(id, extra = {}) {
  return {
    id,
    preview: "Saved user message",
    ...extra,
  };
}

function baseInput(overrides = {}) {
  return {
    threadId: "thread-archive",
    descendantThreadIds: ["thread-child", "thread-grandchild"],
    itemFingerprintBefore: {
      turns: [
        {
          id: "turn-1",
          items: ["item-user-1", "item-assistant-1"],
        },
      ],
    },
    itemFingerprintAfter: {
      turns: [
        {
          id: "turn-1",
          items: ["item-user-1", "item-assistant-1"],
        },
      ],
    },
    archiveNotification: [notification("thread/archived", "thread-archive")],
    archivedReadResponse: {
      thread: thread("thread-archive", {
        path: "/repo/.lime/archived_sessions/rollout-thread-archive.jsonl",
      }),
    },
    activeListAfterArchive: [],
    archivedListAfterArchive: [thread("thread-archive")],
    unarchiveResponse: {
      thread: thread("thread-archive", {
        status: "not_loaded",
        path: "/repo/.lime/sessions/rollout-thread-archive.jsonl",
      }),
    },
    unarchiveNotification: [
      notification("thread/unarchived", "thread-archive"),
    ],
    activeListAfterUnarchive: [thread("thread-archive")],
    deleteNotifications: [
      notification("thread/deleted", "thread-grandchild"),
      notification("thread/deleted", "thread-child"),
      notification("thread/deleted", "thread-archive"),
    ],
    readAfterDelete: {
      status: "not_found",
    },
    resumeAfterDelete: {
      error: "not_found",
    },
    pathState: {
      activePathExistsAfterArchive: false,
      archivedPathExistsAfterArchive: true,
      activePathExistsAfterUnarchive: true,
      archivedPathExistsAfterUnarchive: false,
      activePathExistsAfterDelete: false,
      archivedPathExistsAfterDelete: false,
    },
    ...overrides,
  };
}

test("thread archive delete hydrate keeps metadata state consistent across read, list and restore", () => {
  const event = buildThreadArchiveDeleteHydrateProjectionEvent(baseInput(), {
    sequence: 161,
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
      sourceType: "thread_archive_delete_hydrate_projection",
      sequence: 161,
      sessionId: "session-thread",
      threadId: "thread-archive",
      owner: "context",
      scope: "thread",
      phase: "completed",
      surface: "timeline_evidence",
      persistence: "snapshot",
      control: "open_detail",
      runtimeStatus: "completed",
    },
  );
  assert.equal(event.payload.archiveNotificationSeen, true);
  assert.equal(event.payload.archivedReadableById, true);
  assert.equal(event.payload.archivedListConsistent, true);
  assert.equal(event.payload.unarchiveRestored, true);
  assert.equal(event.payload.deleteNotificationsComplete, true);
  assert.equal(event.payload.deletedReadBlocked, true);
  assert.equal(event.payload.deletedResumeBlocked, true);
  assert.equal(event.payload.itemFingerprintStable, true);
  assert.deepEqual(event.payload.validationIssues, []);
});

test("thread archive delete hydrate rejects archive list drift", () => {
  const snapshot = extractThreadArchiveDeleteHydrateSnapshot(
    baseInput({
      activeListAfterArchive: [thread("thread-archive")],
      archivedListAfterArchive: [],
    }),
  );

  assert.equal(snapshot.archivedListConsistent, false);
  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    ["archived_list_missing", "active_list_still_contains_archived"],
  );
});

test("thread archive delete hydrate requires archive and unarchive notifications", () => {
  const snapshot = extractThreadArchiveDeleteHydrateSnapshot(
    baseInput({
      archiveNotification: [],
      unarchiveNotification: [],
      unarchiveResponse: {},
      activeListAfterUnarchive: [],
    }),
  );

  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    [
      "archive_notification_missing",
      "unarchive_notification_missing",
      "unarchive_not_restored",
    ],
  );
});

test("thread archive delete hydrate requires archived thread read by id", () => {
  const snapshot = extractThreadArchiveDeleteHydrateSnapshot(
    baseInput({
      archivedReadResponse: {
        thread: thread("other-thread"),
      },
    }),
  );

  assert.equal(snapshot.archivedReadableById, false);
  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    ["archived_read_missing"],
  );
});

test("thread archive delete hydrate requires delete notifications and deleted fail-closed read/resume", () => {
  const snapshot = extractThreadArchiveDeleteHydrateSnapshot(
    baseInput({
      deleteNotifications: [notification("thread/deleted", "thread-archive")],
      readAfterDelete: {
        thread: thread("thread-archive"),
      },
      resumeAfterDelete: {
        thread: thread("thread-archive"),
      },
    }),
  );

  assert.equal(snapshot.deleteNotificationsComplete, false);
  assert.equal(snapshot.deletedReadBlocked, false);
  assert.equal(snapshot.deletedResumeBlocked, false);
  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    [
      "delete_descendant_missing",
      "deleted_still_readable",
      "deleted_still_resumable",
    ],
  );
});

test("thread archive delete hydrate rejects item mutation and sidebar-only archive", () => {
  const snapshot = extractThreadArchiveDeleteHydrateSnapshot(
    baseInput({
      itemFingerprintAfter: {
        turns: [
          {
            id: "turn-1",
            items: ["item-user-1"],
          },
        ],
      },
      renderedState: {
        sidebarHidden: true,
        readModelStillActive: true,
      },
    }),
  );

  assert.equal(snapshot.itemFingerprintStable, false);
  assert.equal(snapshot.sidebarOnlyArchive, true);
  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    ["metadata_mutated_items", "archive_only_sidebar_state"],
  );
});

test("thread archive delete hydrate checks storage path transitions", () => {
  const snapshot = extractThreadArchiveDeleteHydrateSnapshot(
    baseInput({
      pathState: {
        activePathExistsAfterArchive: true,
        archivedPathExistsAfterArchive: false,
        activePathExistsAfterUnarchive: false,
        archivedPathExistsAfterUnarchive: true,
        activePathExistsAfterDelete: true,
        archivedPathExistsAfterDelete: true,
      },
    }),
  );

  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    [
      "archive_path_state_inconsistent",
      "unarchive_path_state_inconsistent",
      "delete_path_state_inconsistent",
    ],
  );
});

test("thread archive delete hydrate requires a thread id", () => {
  const snapshot = extractThreadArchiveDeleteHydrateSnapshot({
    archiveNotification: [],
    archivedReadResponse: {},
    archivedListAfterArchive: [],
    unarchiveNotification: [],
    deleteNotifications: [],
  });

  assert.equal(snapshot.threadId, undefined);
  assert.ok(
    snapshot.validationIssues
      .map((item) => item.code)
      .includes("missing_thread_id"),
  );
});
