import type {
  AgentUiProjectionContext,
  AgentUiProjectionEvent,
  AgentUiRuntimeStatus,
} from "@limecloud/agent-ui-contracts";

import {
  compactProjectionFields,
  definedString,
  readBooleanField,
  readRecord,
  readStringArray,
  readStringField,
} from "./normalization.js";

export type AgentUiThreadArchiveDeleteHydrateIssueCode =
  | "missing_thread_id"
  | "archive_notification_missing"
  | "archived_read_missing"
  | "archived_list_missing"
  | "active_list_still_contains_archived"
  | "unarchive_notification_missing"
  | "unarchive_not_restored"
  | "delete_notification_missing"
  | "delete_descendant_missing"
  | "deleted_still_readable"
  | "deleted_still_resumable"
  | "metadata_mutated_items"
  | "archive_only_sidebar_state"
  | "archive_path_state_inconsistent"
  | "unarchive_path_state_inconsistent"
  | "delete_path_state_inconsistent";

export interface AgentUiThreadArchiveDeleteHydrateIssue {
  code: AgentUiThreadArchiveDeleteHydrateIssueCode;
  path: string;
  message: string;
}

export interface AgentUiThreadArchiveDeleteHydrateProjectionInput {
  threadId?: string | null;
  descendantThreadIds?: unknown;
  itemFingerprintBefore?: unknown;
  itemFingerprintAfter?: unknown;
  archiveNotification?: unknown;
  archivedReadResponse?: unknown;
  activeListAfterArchive?: unknown;
  archivedListAfterArchive?: unknown;
  unarchiveResponse?: unknown;
  unarchiveNotification?: unknown;
  activeListAfterUnarchive?: unknown;
  deleteNotifications?: unknown;
  readAfterDelete?: unknown;
  resumeAfterDelete?: unknown;
  pathState?: unknown;
  renderedState?: unknown;
  timestamp?: string | null;
}

export interface AgentUiThreadStoragePathState {
  activePathExistsAfterArchive?: boolean;
  archivedPathExistsAfterArchive?: boolean;
  activePathExistsAfterUnarchive?: boolean;
  archivedPathExistsAfterUnarchive?: boolean;
  activePathExistsAfterDelete?: boolean;
  archivedPathExistsAfterDelete?: boolean;
}

export interface AgentUiThreadArchiveDeleteHydrateSnapshot {
  threadId?: string;
  descendantThreadIds: string[];
  archivedNotificationIds: string[];
  unarchivedNotificationIds: string[];
  deletedNotificationIds: string[];
  archivedReadThreadId?: string;
  unarchivedThreadId?: string;
  activeListAfterArchiveIds: string[];
  archivedListAfterArchiveIds: string[];
  activeListAfterUnarchiveIds: string[];
  itemFingerprintStable: boolean;
  archiveNotificationSeen: boolean;
  archivedReadableById: boolean;
  archivedListConsistent: boolean;
  unarchiveNotificationSeen: boolean;
  unarchiveRestored: boolean;
  deleteNotificationsComplete: boolean;
  deletedReadBlocked: boolean;
  deletedResumeBlocked: boolean;
  sidebarOnlyArchive: boolean;
  pathState: AgentUiThreadStoragePathState;
  validationIssues: AgentUiThreadArchiveDeleteHydrateIssue[];
}

function issue(
  code: AgentUiThreadArchiveDeleteHydrateIssueCode,
  path: string,
  message: string,
): AgentUiThreadArchiveDeleteHydrateIssue {
  return { code, path, message };
}

function recordArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => readRecord(item))
      .filter((item): item is Record<string, unknown> => Boolean(item));
  }
  const record = readRecord(value);
  if (!record) return [];
  const nested = record.data ?? record.threads ?? record.items;
  if (nested !== undefined) return recordArray(nested);
  return threadIdFromRecord(record) ? [record] : [];
}

function threadRecord(value: unknown): Record<string, unknown> | undefined {
  const record = readRecord(value);
  return readRecord(record?.thread) ?? record;
}

function threadIdFromRecord(
  record: Record<string, unknown> | undefined,
): string | undefined {
  return readStringField(record, ["id", "threadId", "thread_id"]);
}

function idList(value: unknown): string[] {
  const strings = readStringArray(value);
  if (strings.length > 0) return strings;
  return recordArray(value)
    .map((record) => threadIdFromRecord(record))
    .filter((item): item is string => Boolean(item));
}

function notificationIds(value: unknown): string[] {
  return recordArray(value)
    .map((record) => {
      const params = readRecord(record.params) ?? record;
      return readStringField(params, ["threadId", "thread_id", "id"]);
    })
    .filter((item): item is string => Boolean(item));
}

function threadIdsFromList(value: unknown): string[] {
  return idList(value);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  const record = readRecord(value);
  if (!record) return value;
  return Object.fromEntries(
    Object.entries(record)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]),
  );
}

function stableEqual(left: unknown, right: unknown): boolean {
  if (right === undefined || right === null) return true;
  return (
    JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right))
  );
}

function readPathState(value: unknown): AgentUiThreadStoragePathState {
  const record = readRecord(value);
  return compactProjectionFields({
    activePathExistsAfterArchive: readBooleanField(record, [
      "activePathExistsAfterArchive",
      "active_path_exists_after_archive",
    ]),
    archivedPathExistsAfterArchive: readBooleanField(record, [
      "archivedPathExistsAfterArchive",
      "archived_path_exists_after_archive",
    ]),
    activePathExistsAfterUnarchive: readBooleanField(record, [
      "activePathExistsAfterUnarchive",
      "active_path_exists_after_unarchive",
    ]),
    archivedPathExistsAfterUnarchive: readBooleanField(record, [
      "archivedPathExistsAfterUnarchive",
      "archived_path_exists_after_unarchive",
    ]),
    activePathExistsAfterDelete: readBooleanField(record, [
      "activePathExistsAfterDelete",
      "active_path_exists_after_delete",
    ]),
    archivedPathExistsAfterDelete: readBooleanField(record, [
      "archivedPathExistsAfterDelete",
      "archived_path_exists_after_delete",
    ]),
  } satisfies AgentUiThreadStoragePathState);
}

function resultBlocked(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  const record = readRecord(value);
  if (!record) return false;
  if (
    readBooleanField(record, ["blocked", "failed", "notFound", "not_found"]) ===
    true
  ) {
    return true;
  }
  const status = readStringField(record, ["status", "error", "code"]);
  return Boolean(
    status &&
    [
      "not_found",
      "deleted",
      "error",
      "failed",
      "notloaded",
      "not_loaded",
    ].includes(status.trim().toLowerCase()),
  );
}

function validateSnapshot(
  snapshot: Omit<AgentUiThreadArchiveDeleteHydrateSnapshot, "validationIssues">,
): AgentUiThreadArchiveDeleteHydrateIssue[] {
  const issues: AgentUiThreadArchiveDeleteHydrateIssue[] = [];

  if (!snapshot.threadId) {
    issues.push(
      issue(
        "missing_thread_id",
        "$.threadId",
        "Archive/delete hydrate guard requires a thread id.",
      ),
    );
  }
  if (!snapshot.archiveNotificationSeen) {
    issues.push(
      issue(
        "archive_notification_missing",
        "$.archiveNotification",
        "Archive must emit thread/archived for the target thread.",
      ),
    );
  }
  if (!snapshot.archivedReadableById) {
    issues.push(
      issue(
        "archived_read_missing",
        "$.archivedReadResponse.thread",
        "thread/read must return archived threads by id.",
      ),
    );
  }
  if (!snapshot.archivedListAfterArchiveIds.includes(snapshot.threadId ?? "")) {
    issues.push(
      issue(
        "archived_list_missing",
        "$.archivedListAfterArchive",
        "Archived thread must appear in the archived list.",
      ),
    );
  }
  if (snapshot.activeListAfterArchiveIds.includes(snapshot.threadId ?? "")) {
    issues.push(
      issue(
        "active_list_still_contains_archived",
        "$.activeListAfterArchive",
        "Archived thread must leave the active list.",
      ),
    );
  }
  if (!snapshot.unarchiveNotificationSeen) {
    issues.push(
      issue(
        "unarchive_notification_missing",
        "$.unarchiveNotification",
        "Unarchive must emit thread/unarchived for the target thread.",
      ),
    );
  }
  if (!snapshot.unarchiveRestored) {
    issues.push(
      issue(
        "unarchive_not_restored",
        "$.activeListAfterUnarchive",
        "Unarchived thread must return to active/readable state.",
      ),
    );
  }
  if (!snapshot.deletedNotificationIds.includes(snapshot.threadId ?? "")) {
    issues.push(
      issue(
        "delete_notification_missing",
        "$.deleteNotifications",
        "Delete must emit thread/deleted for the target thread.",
      ),
    );
  }
  for (const descendantId of snapshot.descendantThreadIds) {
    if (!snapshot.deletedNotificationIds.includes(descendantId)) {
      issues.push(
        issue(
          "delete_descendant_missing",
          "$.deleteNotifications",
          "Delete must cover spawned descendants.",
        ),
      );
      break;
    }
  }
  if (!snapshot.deletedReadBlocked) {
    issues.push(
      issue(
        "deleted_still_readable",
        "$.readAfterDelete",
        "Deleted threads must not remain readable.",
      ),
    );
  }
  if (!snapshot.deletedResumeBlocked) {
    issues.push(
      issue(
        "deleted_still_resumable",
        "$.resumeAfterDelete",
        "Deleted threads must not be resumable.",
      ),
    );
  }
  if (!snapshot.itemFingerprintStable) {
    issues.push(
      issue(
        "metadata_mutated_items",
        "$.itemFingerprintAfter",
        "Archive/unarchive/delete metadata state must not rewrite thread items.",
      ),
    );
  }
  if (snapshot.sidebarOnlyArchive) {
    issues.push(
      issue(
        "archive_only_sidebar_state",
        "$.renderedState",
        "Archive cannot be implemented by hiding only the sidebar row.",
      ),
    );
  }
  if (
    snapshot.pathState.activePathExistsAfterArchive === true ||
    snapshot.pathState.archivedPathExistsAfterArchive === false
  ) {
    issues.push(
      issue(
        "archive_path_state_inconsistent",
        "$.pathState",
        "Archive must move active rollout into archived storage.",
      ),
    );
  }
  if (
    snapshot.pathState.activePathExistsAfterUnarchive === false ||
    snapshot.pathState.archivedPathExistsAfterUnarchive === true
  ) {
    issues.push(
      issue(
        "unarchive_path_state_inconsistent",
        "$.pathState",
        "Unarchive must restore active rollout and remove archived path.",
      ),
    );
  }
  if (
    snapshot.pathState.activePathExistsAfterDelete === true ||
    snapshot.pathState.archivedPathExistsAfterDelete === true
  ) {
    issues.push(
      issue(
        "delete_path_state_inconsistent",
        "$.pathState",
        "Delete must remove active and archived rollout paths.",
      ),
    );
  }

  return issues;
}

function runtimeStatus(
  issues: readonly AgentUiThreadArchiveDeleteHydrateIssue[],
): AgentUiRuntimeStatus {
  return issues.length > 0 ? "failed" : "completed";
}

export function extractThreadArchiveDeleteHydrateSnapshot(
  input: AgentUiThreadArchiveDeleteHydrateProjectionInput,
): AgentUiThreadArchiveDeleteHydrateSnapshot {
  const archivedThread = threadRecord(input.archivedReadResponse);
  const unarchivedThread = threadRecord(input.unarchiveResponse);
  const threadId =
    definedString(input.threadId ?? undefined) ??
    threadIdFromRecord(archivedThread) ??
    threadIdFromRecord(unarchivedThread);
  const archivedNotificationIds = notificationIds(input.archiveNotification);
  const unarchivedNotificationIds = notificationIds(
    input.unarchiveNotification,
  );
  const deletedNotificationIds = notificationIds(input.deleteNotifications);
  const activeListAfterArchiveIds = threadIdsFromList(
    input.activeListAfterArchive,
  );
  const archivedListAfterArchiveIds = threadIdsFromList(
    input.archivedListAfterArchive,
  );
  const activeListAfterUnarchiveIds = threadIdsFromList(
    input.activeListAfterUnarchive,
  );
  const rendered = readRecord(input.renderedState);
  const sidebarHidden =
    readBooleanField(rendered, ["sidebarHidden", "sidebar_hidden"]) === true;
  const readModelStillActive =
    readBooleanField(rendered, [
      "readModelStillActive",
      "read_model_still_active",
    ]) === true;
  const base = {
    threadId,
    descendantThreadIds: idList(input.descendantThreadIds),
    archivedNotificationIds,
    unarchivedNotificationIds,
    deletedNotificationIds,
    archivedReadThreadId: threadIdFromRecord(archivedThread),
    unarchivedThreadId: threadIdFromRecord(unarchivedThread),
    activeListAfterArchiveIds,
    archivedListAfterArchiveIds,
    activeListAfterUnarchiveIds,
    itemFingerprintStable: stableEqual(
      input.itemFingerprintBefore,
      input.itemFingerprintAfter,
    ),
    archiveNotificationSeen: archivedNotificationIds.includes(threadId ?? ""),
    archivedReadableById: threadIdFromRecord(archivedThread) === threadId,
    archivedListConsistent:
      archivedListAfterArchiveIds.includes(threadId ?? "") &&
      !activeListAfterArchiveIds.includes(threadId ?? ""),
    unarchiveNotificationSeen: unarchivedNotificationIds.includes(
      threadId ?? "",
    ),
    unarchiveRestored:
      threadIdFromRecord(unarchivedThread) === threadId ||
      activeListAfterUnarchiveIds.includes(threadId ?? ""),
    deleteNotificationsComplete: [
      threadId,
      ...idList(input.descendantThreadIds),
    ]
      .filter((item): item is string => Boolean(item))
      .every((item) => deletedNotificationIds.includes(item)),
    deletedReadBlocked: resultBlocked(input.readAfterDelete),
    deletedResumeBlocked: resultBlocked(input.resumeAfterDelete),
    sidebarOnlyArchive: sidebarHidden && readModelStillActive,
    pathState: readPathState(input.pathState),
  };
  return {
    ...base,
    validationIssues: validateSnapshot(base),
  };
}

export function buildThreadArchiveDeleteHydrateProjectionEvent(
  input: AgentUiThreadArchiveDeleteHydrateProjectionInput,
  context: AgentUiProjectionContext = {},
): AgentUiProjectionEvent {
  const snapshot = extractThreadArchiveDeleteHydrateSnapshot(input);
  const status = runtimeStatus(snapshot.validationIssues);
  return compactProjectionFields({
    type: "context.changed",
    sourceType: "thread_archive_delete_hydrate_projection",
    sequence: context.sequence,
    timestamp: definedString(input.timestamp ?? undefined) ?? context.timestamp,
    sessionId: definedString(context.sessionId ?? undefined),
    threadId: snapshot.threadId ?? definedString(context.threadId ?? undefined),
    runId: definedString(context.runId ?? undefined),
    turnId: definedString(context.turnId ?? undefined),
    owner: "context",
    scope: "thread",
    phase: status === "failed" ? "failed" : "completed",
    surface: "timeline_evidence",
    persistence: "snapshot",
    control: "open_detail",
    runtimeEntity: "agent_turn",
    runtimeStatus: status,
    latestTurnStatus: status,
    payload: {
      threadArchiveDeleteHydrateEvent: "archive_delete_hydrate_snapshot",
      archiveNotificationSeen: snapshot.archiveNotificationSeen,
      archivedReadableById: snapshot.archivedReadableById,
      archivedListConsistent: snapshot.archivedListConsistent,
      unarchiveRestored: snapshot.unarchiveRestored,
      deleteNotificationsComplete: snapshot.deleteNotificationsComplete,
      deletedReadBlocked: snapshot.deletedReadBlocked,
      deletedResumeBlocked: snapshot.deletedResumeBlocked,
      itemFingerprintStable: snapshot.itemFingerprintStable,
      threadArchiveDeleteHydrate: snapshot,
      validationIssues: snapshot.validationIssues,
    },
  } satisfies AgentUiProjectionEvent);
}
