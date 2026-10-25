import type {
  AgentUiProjectionContext,
  AgentUiProjectionEvent,
  AgentUiRuntimeStatus,
} from "@limecloud/agent-ui-contracts";

import {
  compactProjectionFields,
  definedString,
  readRecord,
  readStringField,
} from "./normalization.js";

export type AgentUiContextCompactionItemIssueCode =
  | "missing_thread_id"
  | "missing_compaction_started"
  | "missing_compaction_completed"
  | "compaction_item_id_mismatch"
  | "deprecated_thread_compacted_only"
  | "replacement_history_rewritten"
  | "old_items_rewritten"
  | "compaction_missing_from_read_model"
  | "followup_history_missing_compaction"
  | "compact_start_response_not_empty";

export interface AgentUiContextCompactionItemIssue {
  code: AgentUiContextCompactionItemIssueCode;
  path: string;
  message: string;
}

export interface AgentUiContextCompactionLifecycleItem {
  id?: string;
  threadId?: string;
  method?: string;
  status?: string;
}

export interface AgentUiContextCompactionItemProjectionInput {
  threadId?: string | null;
  itemStarted?: unknown;
  itemCompleted?: unknown;
  notifications?: unknown;
  deprecatedCompactedNotification?: unknown;
  expectedReplacementHistory?: unknown;
  actualReplacementHistory?: unknown;
  oldItemFingerprintBefore?: unknown;
  oldItemFingerprintAfter?: unknown;
  readModelItems?: unknown;
  followupModelInput?: unknown;
  compactStartResponse?: unknown;
  timestamp?: string | null;
}

export interface AgentUiContextCompactionItemSnapshot {
  threadId?: string;
  startedItems: AgentUiContextCompactionLifecycleItem[];
  completedItems: AgentUiContextCompactionLifecycleItem[];
  compactionItemId?: string;
  startedSeen: boolean;
  completedSeen: boolean;
  itemIdsMatch: boolean;
  deprecatedOnly: boolean;
  replacementHistoryVerbatim: boolean;
  oldItemsStable: boolean;
  readModelContainsCompaction: boolean;
  followupHistoryContainsCompaction: boolean;
  compactStartResponseEmpty: boolean;
  validationIssues: AgentUiContextCompactionItemIssue[];
}

function issue(
  code: AgentUiContextCompactionItemIssueCode,
  path: string,
  message: string,
): AgentUiContextCompactionItemIssue {
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
  const nested =
    record.data ?? record.items ?? record.notifications ?? record.input;
  if (nested !== undefined) return recordArray(nested);
  return [record];
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
  if (left === undefined || right === undefined) return true;
  return (
    JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right))
  );
}

function method(record: Record<string, unknown>): string | undefined {
  return readStringField(record, ["method"]);
}

function params(record: Record<string, unknown>): Record<string, unknown> {
  return readRecord(record.params) ?? record;
}

function itemRecord(
  record: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const base = params(record);
  return (
    readRecord(base.item) ??
    readRecord(base.threadItem) ??
    readRecord(base.thread_item) ??
    base
  );
}

function itemType(
  record: Record<string, unknown> | undefined,
): string | undefined {
  return readStringField(record, ["type", "kind", "itemType", "item_type"]);
}

function isContextCompactionRecord(record: Record<string, unknown>): boolean {
  const item = itemRecord(record);
  const type = itemType(item);
  return Boolean(
    type === "contextCompaction" ||
    type === "context_compaction" ||
    type === "ContextCompaction",
  );
}

function readLifecycleItem(
  record: Record<string, unknown>,
): AgentUiContextCompactionLifecycleItem {
  const base = params(record);
  const item = itemRecord(record);
  return {
    id: readStringField(item, ["id", "itemId", "item_id"]),
    threadId: readStringField(base, ["threadId", "thread_id"]),
    method: method(record),
    status:
      readStringField(base, ["status"]) ?? readStringField(item, ["status"]),
  };
}

function lifecycleItems(
  input: AgentUiContextCompactionItemProjectionInput,
  phase: "started" | "completed",
): AgentUiContextCompactionLifecycleItem[] {
  const direct = phase === "started" ? input.itemStarted : input.itemCompleted;
  const expectedMethod =
    phase === "started" ? "item/started" : "item/completed";
  const records = [
    ...recordArray(direct),
    ...recordArray(input.notifications),
  ].filter(
    (record) =>
      method(record) === expectedMethod && isContextCompactionRecord(record),
  );
  return records.map(readLifecycleItem);
}

function hasDeprecatedCompactedOnly(
  input: AgentUiContextCompactionItemProjectionInput,
  hasCurrentItem: boolean,
): boolean {
  if (hasCurrentItem) return false;
  return [
    ...recordArray(input.deprecatedCompactedNotification),
    ...recordArray(input.notifications),
  ].some((record) => method(record) === "thread/compacted");
}

function containsContextCompaction(
  value: unknown,
  expectedId?: string,
): boolean {
  const records = recordArray(value);
  return records.some((record) => {
    if (!isContextCompactionRecord(record)) return false;
    if (!expectedId) return true;
    const item = itemRecord(record);
    return readStringField(item, ["id", "itemId", "item_id"]) === expectedId;
  });
}

function responseEmpty(value: unknown): boolean {
  if (value === undefined) return true;
  const record = readRecord(value);
  if (!record) return false;
  const result = readRecord(record.result) ?? record;
  return Object.keys(result).length === 0 || result.ok === true;
}

function validateSnapshot(
  snapshot: Omit<AgentUiContextCompactionItemSnapshot, "validationIssues">,
): AgentUiContextCompactionItemIssue[] {
  const issues: AgentUiContextCompactionItemIssue[] = [];
  if (!snapshot.threadId) {
    issues.push(
      issue(
        "missing_thread_id",
        "$.threadId",
        "Context compaction item requires a thread id.",
      ),
    );
  }
  if (!snapshot.startedSeen) {
    issues.push(
      issue(
        "missing_compaction_started",
        "$.itemStarted",
        "Compaction must emit item/started with a contextCompaction item.",
      ),
    );
  }
  if (!snapshot.completedSeen) {
    issues.push(
      issue(
        "missing_compaction_completed",
        "$.itemCompleted",
        "Compaction must emit item/completed with the same contextCompaction item.",
      ),
    );
  }
  if (!snapshot.itemIdsMatch) {
    issues.push(
      issue(
        "compaction_item_id_mismatch",
        "$.itemCompleted.item.id",
        "Started and completed contextCompaction item ids must match.",
      ),
    );
  }
  if (snapshot.deprecatedOnly) {
    issues.push(
      issue(
        "deprecated_thread_compacted_only",
        "$.deprecatedCompactedNotification",
        "Deprecated thread/compacted cannot replace the contextCompaction item lifecycle.",
      ),
    );
  }
  if (!snapshot.replacementHistoryVerbatim) {
    issues.push(
      issue(
        "replacement_history_rewritten",
        "$.actualReplacementHistory",
        "Compaction replacement history must be replayed verbatim.",
      ),
    );
  }
  if (!snapshot.oldItemsStable) {
    issues.push(
      issue(
        "old_items_rewritten",
        "$.oldItemFingerprintAfter",
        "Compaction must install replacement history without rewriting old item fingerprints.",
      ),
    );
  }
  if (!snapshot.readModelContainsCompaction) {
    issues.push(
      issue(
        "compaction_missing_from_read_model",
        "$.readModelItems",
        "Hydrated read model must preserve the contextCompaction item.",
      ),
    );
  }
  if (!snapshot.followupHistoryContainsCompaction) {
    issues.push(
      issue(
        "followup_history_missing_compaction",
        "$.followupModelInput",
        "Post-compaction model input must include the compaction item/history.",
      ),
    );
  }
  if (!snapshot.compactStartResponseEmpty) {
    issues.push(
      issue(
        "compact_start_response_not_empty",
        "$.compactStartResponse",
        "thread/compact/start response should be an empty ack; item lifecycle carries state.",
      ),
    );
  }
  return issues;
}

export function extractContextCompactionItemSnapshot(
  input: AgentUiContextCompactionItemProjectionInput,
): AgentUiContextCompactionItemSnapshot {
  const startedItems = lifecycleItems(input, "started");
  const completedItems = lifecycleItems(input, "completed");
  const startedId = startedItems[0]?.id;
  const completedId = completedItems[0]?.id;
  const compactionItemId = startedId ?? completedId;
  const threadId =
    definedString(input.threadId ?? undefined) ??
    startedItems.find((item) => item.threadId)?.threadId ??
    completedItems.find((item) => item.threadId)?.threadId;
  const hasCurrentItem = startedItems.length > 0 || completedItems.length > 0;
  const base = {
    threadId,
    startedItems,
    completedItems,
    compactionItemId,
    startedSeen: startedItems.length > 0,
    completedSeen: completedItems.length > 0,
    itemIdsMatch: Boolean(
      startedId && completedId && startedId === completedId,
    ),
    deprecatedOnly: hasDeprecatedCompactedOnly(input, hasCurrentItem),
    replacementHistoryVerbatim: stableEqual(
      input.expectedReplacementHistory,
      input.actualReplacementHistory,
    ),
    oldItemsStable: stableEqual(
      input.oldItemFingerprintBefore,
      input.oldItemFingerprintAfter,
    ),
    readModelContainsCompaction:
      input.readModelItems === undefined ||
      containsContextCompaction(input.readModelItems, compactionItemId),
    followupHistoryContainsCompaction:
      input.followupModelInput === undefined ||
      containsContextCompaction(input.followupModelInput, compactionItemId),
    compactStartResponseEmpty: responseEmpty(input.compactStartResponse),
  };
  return {
    ...base,
    validationIssues: validateSnapshot(base),
  };
}

function runtimeStatus(
  issues: readonly AgentUiContextCompactionItemIssue[],
): AgentUiRuntimeStatus {
  return issues.length > 0 ? "failed" : "completed";
}

export function buildContextCompactionItemProjectionEvent(
  input: AgentUiContextCompactionItemProjectionInput,
  context: AgentUiProjectionContext = {},
): AgentUiProjectionEvent {
  const snapshot = extractContextCompactionItemSnapshot(input);
  const status = runtimeStatus(snapshot.validationIssues);
  return compactProjectionFields({
    type: "context.changed",
    sourceType: "context_compaction_item_projection",
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
      contextCompactionItemEvent: "context_compaction_item",
      compactionItemId: snapshot.compactionItemId,
      startedSeen: snapshot.startedSeen,
      completedSeen: snapshot.completedSeen,
      itemIdsMatch: snapshot.itemIdsMatch,
      replacementHistoryVerbatim: snapshot.replacementHistoryVerbatim,
      oldItemsStable: snapshot.oldItemsStable,
      readModelContainsCompaction: snapshot.readModelContainsCompaction,
      followupHistoryContainsCompaction:
        snapshot.followupHistoryContainsCompaction,
      contextCompactionItem: snapshot,
      validationIssues: snapshot.validationIssues,
    },
  } satisfies AgentUiProjectionEvent);
}
