import type {
  AgentUiPhase,
  AgentUiProjectionContext,
  AgentUiProjectionEvent,
  AgentUiRuntimeStatus,
} from "@limecloud/agent-ui-contracts";

import {
  compactProjectionFields,
  definedString,
  readRecord,
  readStringArray,
  readStringField,
} from "./normalization.js";

export type AgentUiThreadRuntimeStatus =
  | "active"
  | "idle"
  | "system_error"
  | "not_loaded"
  | "unknown";

export type AgentUiThreadStatusRuntimeUpdateIssueCode =
  | "missing_thread_id"
  | "missing_status_update"
  | "missing_active_update"
  | "missing_inactive_after_active"
  | "opt_out_notification_emitted"
  | "active_flags_lost"
  | "status_rendered_as_transcript_item"
  | "status_persisted_as_read_model_item"
  | "status_surface_missing_thread_scope"
  | "status_derived_from_dom_text";

export interface AgentUiThreadStatusRuntimeUpdateIssue {
  code: AgentUiThreadStatusRuntimeUpdateIssueCode;
  path: string;
  message: string;
}

export interface AgentUiThreadStatusRuntimeUpdateProjectionInput {
  threadId?: string | null;
  notifications?: unknown;
  events?: unknown;
  statusUpdates?: unknown;
  optOutNotificationMethods?: unknown;
  initializeCapabilities?: unknown;
  clientCapabilities?: unknown;
  transcriptItems?: unknown;
  readModelItems?: unknown;
  observedSurfaces?: unknown;
  timestamp?: string | null;
}

export interface AgentUiThreadStatusRuntimeUpdateSnapshot {
  threadId?: string;
  optedOut: boolean;
  statusUpdates: AgentUiThreadStatusUpdateSnapshot[];
  latestStatus?: AgentUiThreadRuntimeStatus;
  latestRuntimeStatus: AgentUiRuntimeStatus;
  sawActiveUpdate: boolean;
  sawInactiveAfterActive: boolean;
  transcriptClean: boolean;
  readModelClean: boolean;
  runtimeSurfacesBound: boolean;
  domTextFree: boolean;
  validationIssues: AgentUiThreadStatusRuntimeUpdateIssue[];
}

export interface AgentUiThreadStatusUpdateSnapshot {
  index: number;
  threadId?: string;
  status: AgentUiThreadRuntimeStatus;
  runtimeStatus: AgentUiRuntimeStatus;
  activeFlags: string[];
  rawActiveFlagCount: number;
  method?: string;
}

function issue(
  code: AgentUiThreadStatusRuntimeUpdateIssueCode,
  path: string,
  message: string,
): AgentUiThreadStatusRuntimeUpdateIssue {
  return { code, path, message };
}

function recordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => readRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));
}

function normalizeStatus(
  value: string | undefined,
): AgentUiThreadRuntimeStatus {
  const normalized = value
    ?.trim()
    .toLowerCase()
    .replace(/[_\s-]+/g, "_");
  switch (normalized) {
    case "active":
      return "active";
    case "idle":
      return "idle";
    case "system_error":
    case "systemerror":
      return "system_error";
    case "not_loaded":
    case "notloaded":
      return "not_loaded";
    default:
      return "unknown";
  }
}

function normalizeFlag(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[_\s-]+/g, "_");
}

function statusRecord(value: unknown): Record<string, unknown> | undefined {
  const record = readRecord(value);
  return readRecord(record?.status) ?? record;
}

function readStatusKind(value: unknown): AgentUiThreadRuntimeStatus {
  if (typeof value === "string") return normalizeStatus(value);
  const record = statusRecord(value);
  return normalizeStatus(readStringField(record, ["type", "status"]));
}

function readActiveFlags(value: unknown): string[] {
  const record = statusRecord(value);
  const raw = record?.activeFlags ?? record?.active_flags;
  return readStringArray(raw).map(normalizeFlag);
}

function rawActiveFlagCount(value: unknown): number {
  const record = statusRecord(value);
  const raw = record?.activeFlags ?? record?.active_flags;
  return Array.isArray(raw) ? raw.length : 0;
}

function runtimeStatusForThreadStatus(
  status: AgentUiThreadRuntimeStatus,
  activeFlags: readonly string[],
): AgentUiRuntimeStatus {
  switch (status) {
    case "active":
      return activeFlags.some(
        (flag) =>
          flag === "waiting_on_approval" || flag === "waiting_on_user_input",
      )
        ? "waiting"
        : "running";
    case "idle":
      return "idle";
    case "system_error":
      return "failed";
    case "not_loaded":
      return "closed";
    case "unknown":
    default:
      return "unknown";
  }
}

function phaseForRuntimeStatus(status: AgentUiRuntimeStatus): AgentUiPhase {
  switch (status) {
    case "running":
      return "acting";
    case "waiting":
      return "waiting";
    case "failed":
      return "failed";
    case "idle":
    case "closed":
    case "completed":
      return "completed";
    default:
      return "preparing";
  }
}

function notificationRecords(
  input: AgentUiThreadStatusRuntimeUpdateProjectionInput,
): Record<string, unknown>[] {
  for (const value of [
    input.notifications,
    input.statusUpdates,
    input.events,
  ]) {
    const records = recordArray(value);
    if (records.length > 0) return records;
  }
  return [];
}

function readNotificationParams(
  record: Record<string, unknown>,
): Record<string, unknown> {
  return readRecord(record.params) ?? record;
}

function readStatusUpdate(
  record: Record<string, unknown>,
  index: number,
): AgentUiThreadStatusUpdateSnapshot {
  const params = readNotificationParams(record);
  const statusValue = params.status ?? record.status;
  const activeFlags = readActiveFlags(statusValue);
  const status = readStatusKind(statusValue);
  return {
    index,
    threadId: readStringField(params, ["threadId", "thread_id"]),
    status,
    runtimeStatus: runtimeStatusForThreadStatus(status, activeFlags),
    activeFlags,
    rawActiveFlagCount: rawActiveFlagCount(statusValue),
    method: readStringField(record, ["method"]),
  };
}

function readOptOutMethods(
  input: AgentUiThreadStatusRuntimeUpdateProjectionInput,
): string[] {
  const initialize = readRecord(input.initializeCapabilities);
  const client = readRecord(input.clientCapabilities);
  return [
    ...readStringArray(input.optOutNotificationMethods),
    ...readStringArray(initialize?.optOutNotificationMethods),
    ...readStringArray(initialize?.opt_out_notification_methods),
    ...readStringArray(client?.optOutNotificationMethods),
    ...readStringArray(client?.opt_out_notification_methods),
  ];
}

function isThreadStatusMethod(value: string | undefined): boolean {
  return (
    value === "thread/status/changed" ||
    value === "thread_status_changed" ||
    value === "thread.status.changed"
  );
}

function isStatusProjectionRecord(record: Record<string, unknown>): boolean {
  const type = readStringField(record, [
    "type",
    "kind",
    "sourceType",
    "source_type",
  ]);
  const method = readStringField(record, ["method"]);
  return Boolean(
    isThreadStatusMethod(method) ||
    type === "thread_status" ||
    type === "thread_status_changed" ||
    type === "runtime_status" ||
    type === "status_update",
  );
}

function transcriptLeaks(value: unknown): number[] {
  return recordArray(value)
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => {
      const surface = readStringField(record, ["surface"]);
      return (
        isStatusProjectionRecord(record) &&
        (surface === "conversation" ||
          surface === "message" ||
          readStringField(record, ["role"]) === "assistant" ||
          readStringField(record, ["role"]) === "user")
      );
    })
    .map(({ index }) => index);
}

function readModelLeaks(value: unknown): number[] {
  return recordArray(value)
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => isStatusProjectionRecord(record))
    .map(({ index }) => index);
}

function surfaceScopeIssues(
  surfaces: unknown,
  threadId: string | undefined,
): AgentUiThreadStatusRuntimeUpdateIssue[] {
  const issues: AgentUiThreadStatusRuntimeUpdateIssue[] = [];
  recordArray(surfaces).forEach((record, index) => {
    const surfaceThreadId = readStringField(record, ["threadId", "thread_id"]);
    const surface = readStringField(record, ["surface", "target"]);
    const source = readStringField(record, [
      "source",
      "statusSource",
      "status_source",
    ]);
    if (surface && threadId && surfaceThreadId !== threadId) {
      issues.push(
        issue(
          "status_surface_missing_thread_scope",
          `$.observedSurfaces[${index}].threadId`,
          "Thread status surfaces must be scoped to the source thread id.",
        ),
      );
    }
    if (
      source === "dom_text" ||
      source === "text_regex" ||
      source === "message_text"
    ) {
      issues.push(
        issue(
          "status_derived_from_dom_text",
          `$.observedSurfaces[${index}].source`,
          "Thread status must come from runtime notification facts, not DOM text parsing.",
        ),
      );
    }
  });
  return issues;
}

function validateSnapshot(
  input: AgentUiThreadStatusRuntimeUpdateProjectionInput,
  snapshot: Omit<AgentUiThreadStatusRuntimeUpdateSnapshot, "validationIssues">,
): AgentUiThreadStatusRuntimeUpdateIssue[] {
  const issues: AgentUiThreadStatusRuntimeUpdateIssue[] = [];

  if (!snapshot.threadId && !snapshot.optedOut) {
    issues.push(
      issue(
        "missing_thread_id",
        "$.notifications[].params.threadId",
        "thread/status/changed updates must carry the source thread id.",
      ),
    );
  }
  if (snapshot.statusUpdates.length === 0 && !snapshot.optedOut) {
    issues.push(
      issue(
        "missing_status_update",
        "$.notifications",
        "Runtime status guard requires thread/status/changed updates unless the method is opted out.",
      ),
    );
  }
  if (snapshot.optedOut && snapshot.statusUpdates.length > 0) {
    issues.push(
      issue(
        "opt_out_notification_emitted",
        "$.notifications",
        "thread/status/changed must be filtered when optOutNotificationMethods includes it.",
      ),
    );
  }
  if (!snapshot.optedOut && snapshot.statusUpdates.length > 0) {
    if (!snapshot.sawActiveUpdate) {
      issues.push(
        issue(
          "missing_active_update",
          "$.notifications",
          "A turn run should emit an active thread status update.",
        ),
      );
    }
    if (snapshot.sawActiveUpdate && !snapshot.sawInactiveAfterActive) {
      issues.push(
        issue(
          "missing_inactive_after_active",
          "$.notifications",
          "A completed turn should emit idle/system_error/not_loaded after active.",
        ),
      );
    }
  }
  snapshot.statusUpdates.forEach((update) => {
    if (
      update.status === "active" &&
      update.rawActiveFlagCount > 0 &&
      update.activeFlags.length === 0
    ) {
      issues.push(
        issue(
          "active_flags_lost",
          `$.notifications[${update.index}].params.status.activeFlags`,
          "Active thread status flags must be preserved for waiting/runtime UI.",
        ),
      );
    }
  });
  for (const index of transcriptLeaks(input.transcriptItems)) {
    issues.push(
      issue(
        "status_rendered_as_transcript_item",
        `$.transcriptItems[${index}]`,
        "thread/status/changed must update runtime surfaces, not transcript messages.",
      ),
    );
  }
  for (const index of readModelLeaks(input.readModelItems)) {
    issues.push(
      issue(
        "status_persisted_as_read_model_item",
        `$.readModelItems[${index}]`,
        "thread/status/changed must not persist as a thread item in the read model.",
      ),
    );
  }
  issues.push(...surfaceScopeIssues(input.observedSurfaces, snapshot.threadId));
  return issues;
}

export function extractThreadStatusRuntimeUpdateSnapshot(
  input: AgentUiThreadStatusRuntimeUpdateProjectionInput,
): AgentUiThreadStatusRuntimeUpdateSnapshot {
  const statusUpdates = notificationRecords(input).map(readStatusUpdate);
  const threadId =
    definedString(input.threadId ?? undefined) ??
    statusUpdates.find((update) => update.threadId)?.threadId;
  const scopedUpdates = threadId
    ? statusUpdates.filter(
        (update) => !update.threadId || update.threadId === threadId,
      )
    : statusUpdates;
  let sawActiveUpdate = false;
  let sawInactiveAfterActive = false;
  for (const update of scopedUpdates) {
    if (update.status === "active") {
      sawActiveUpdate = true;
    } else if (
      sawActiveUpdate &&
      (update.status === "idle" ||
        update.status === "system_error" ||
        update.status === "not_loaded")
    ) {
      sawInactiveAfterActive = true;
    }
  }
  const latest = scopedUpdates[scopedUpdates.length - 1];
  const optOutMethods = readOptOutMethods(input);
  const base = {
    threadId,
    optedOut: optOutMethods.includes("thread/status/changed"),
    statusUpdates,
    latestStatus: latest?.status,
    latestRuntimeStatus: latest?.runtimeStatus ?? "idle",
    sawActiveUpdate,
    sawInactiveAfterActive,
    transcriptClean: transcriptLeaks(input.transcriptItems).length === 0,
    readModelClean: readModelLeaks(input.readModelItems).length === 0,
    runtimeSurfacesBound:
      surfaceScopeIssues(input.observedSurfaces, threadId).filter(
        (item) => item.code === "status_surface_missing_thread_scope",
      ).length === 0,
    domTextFree:
      surfaceScopeIssues(input.observedSurfaces, threadId).filter(
        (item) => item.code === "status_derived_from_dom_text",
      ).length === 0,
  };
  return {
    ...base,
    validationIssues: validateSnapshot(input, base),
  };
}

export function buildThreadStatusRuntimeUpdateProjectionEvent(
  input: AgentUiThreadStatusRuntimeUpdateProjectionInput,
  context: AgentUiProjectionContext = {},
): AgentUiProjectionEvent {
  const snapshot = extractThreadStatusRuntimeUpdateSnapshot(input);
  const hasIssues = snapshot.validationIssues.length > 0;
  const runtimeStatus = hasIssues ? "failed" : snapshot.latestRuntimeStatus;
  return compactProjectionFields({
    type: "context.changed",
    sourceType: "thread_status_runtime_update_projection",
    sequence: context.sequence,
    timestamp: definedString(input.timestamp ?? undefined) ?? context.timestamp,
    sessionId: definedString(context.sessionId ?? undefined),
    threadId: snapshot.threadId ?? definedString(context.threadId ?? undefined),
    runId: definedString(context.runId ?? undefined),
    turnId: definedString(context.turnId ?? undefined),
    owner: "runtime",
    scope: "thread",
    phase: hasIssues ? "failed" : phaseForRuntimeStatus(runtimeStatus),
    surface: "runtime_status",
    persistence: "ephemeral_live",
    control:
      runtimeStatus === "running" || runtimeStatus === "waiting"
        ? "stop"
        : "none",
    runtimeEntity: "agent_turn",
    runtimeStatus,
    latestTurnStatus: runtimeStatus,
    payload: {
      threadStatusRuntimeUpdateEvent: "thread_status_changed",
      latestStatus: snapshot.latestStatus,
      latestRuntimeStatus: snapshot.latestRuntimeStatus,
      sawActiveUpdate: snapshot.sawActiveUpdate,
      sawInactiveAfterActive: snapshot.sawInactiveAfterActive,
      optedOut: snapshot.optedOut,
      transcriptClean: snapshot.transcriptClean,
      readModelClean: snapshot.readModelClean,
      runtimeSurfacesBound: snapshot.runtimeSurfacesBound,
      domTextFree: snapshot.domTextFree,
      threadStatusRuntimeUpdate: snapshot,
      validationIssues: snapshot.validationIssues,
    },
  } satisfies AgentUiProjectionEvent);
}
