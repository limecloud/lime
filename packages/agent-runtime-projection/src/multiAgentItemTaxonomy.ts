import type { AgentUiRuntimeStatus } from "@limecloud/agent-ui-contracts";

import {
  getMultiAgentToolSchemaContract,
  isLegacyMultiAgentToolName,
  type AgentUiMultiAgentToolName,
} from "./multiAgentToolSchema.js";
import {
  compactProjectionFields,
  definedString,
  readRecord,
  readStringArrayField,
  readStringField,
  truncateText,
} from "./normalization.js";

export type AgentUiMultiAgentItemTaxonomyIssueCode =
  | "missing_multi_agent_item"
  | "unknown_tool"
  | "legacy_tool_name"
  | "missing_item_id"
  | "missing_turn_id"
  | "missing_parent_thread_id"
  | "missing_child_thread_id"
  | "expected_tool_missing"
  | "expected_status_missing"
  | "surface_item_binding_missing"
  | "text_summary_timeline_leak"
  | "orphan_agent_history";

export interface AgentUiMultiAgentItemTaxonomyIssue {
  code: AgentUiMultiAgentItemTaxonomyIssueCode;
  path: string;
  message: string;
}

export interface AgentUiMultiAgentTaxonomyItem {
  index: number;
  itemId?: string;
  toolName?: AgentUiMultiAgentToolName;
  rawToolName?: string;
  status: AgentUiRuntimeStatus;
  sourceStatus?: string;
  parentThreadId?: string;
  turnId?: string;
  childThreadId?: string;
  receiverThreadIds: string[];
  taskName?: string;
  messagePreview?: string;
}

export interface AgentUiMultiAgentTaxonomySurfaceBinding {
  surface: "team_transcript" | "worker_card" | "review_lane" | "unknown";
  itemIds: string[];
}

export interface AgentUiMultiAgentItemTaxonomyInput {
  threadId?: string | null;
  expectedTools?: readonly string[];
  expectedStatuses?: readonly string[];
  taxonomyItems?: unknown;
  threadItems?: unknown;
  surfaceBindings?: unknown;
  legacyTextSummaries?: unknown;
  orphanAgentHistories?: unknown;
  timestamp?: string | null;
}

export interface AgentUiMultiAgentItemTaxonomySnapshot {
  threadId?: string;
  items: AgentUiMultiAgentTaxonomyItem[];
  surfaceBindings: AgentUiMultiAgentTaxonomySurfaceBinding[];
  itemTaxonomySeen: boolean;
  toolsCovered: boolean;
  statusesCovered: boolean;
  itemIdsStable: boolean;
  turnIdsStable: boolean;
  parentThreadBound: boolean;
  childLineageStable: boolean;
  surfacesBoundToItems: boolean;
  legacyTextSummaryClean: boolean;
  orphanAgentHistoryClean: boolean;
  validationIssues: AgentUiMultiAgentItemTaxonomyIssue[];
}

function issue(
  code: AgentUiMultiAgentItemTaxonomyIssueCode,
  path: string,
  message: string,
): AgentUiMultiAgentItemTaxonomyIssue {
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
  for (const key of ["items", "threadItems", "thread_items", "data"]) {
    if (Array.isArray(record[key])) return recordArray(record[key]);
  }
  return [record];
}

function camelToSnake(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-.\s]+/g, "_")
    .toLowerCase();
}

function normalizeToolName(
  value: string | undefined,
): AgentUiMultiAgentToolName | undefined {
  const normalized = value ? camelToSnake(value) : undefined;
  switch (normalized) {
    case "spawn_agent":
      return "spawn_agent";
    case "send_message":
      return "send_message";
    case "followup_task":
      return "followup_task";
    case "wait_agent":
      return "wait_agent";
    case "interrupt_agent":
      return "interrupt_agent";
    case "list_agents":
      return "list_agents";
    default:
      return undefined;
  }
}

function normalizeStatus(value: string | undefined): AgentUiRuntimeStatus {
  switch (value ? camelToSnake(value) : undefined) {
    case "queued":
    case "pending_init":
      return "queued";
    case "running":
    case "in_progress":
      return "running";
    case "completed":
      return "completed";
    case "interrupted":
    case "aborted":
      return "aborted";
    case "cancelled":
    case "canceled":
      return "cancelled";
    case "failed":
    case "errored":
    case "error":
      return "failed";
    case "closed":
    case "shutdown":
      return "closed";
    case "not_found":
      return "not_found";
    default:
      return "unknown";
  }
}

function readReceiverThreadIds(record: Record<string, unknown>): string[] {
  const ids = [
    ...readStringArrayField(record, [
      "receiverThreadIds",
      "receiver_thread_ids",
    ]),
    ...readStringArrayField(record, ["receiverThreadId", "receiver_thread_id"]),
    ...readStringArrayField(record, ["targetThreadIds", "target_thread_ids"]),
  ];
  const childThreadId = readStringField(record, [
    "childThreadId",
    "child_thread_id",
    "newThreadId",
    "new_thread_id",
  ]);
  if (childThreadId && !ids.includes(childThreadId)) ids.push(childThreadId);
  return [...new Set(ids)];
}

function readTaxonomyItem(
  record: Record<string, unknown>,
  index: number,
): AgentUiMultiAgentTaxonomyItem | undefined {
  const rawToolName = readStringField(record, ["toolName", "tool", "name"]);
  const toolName = normalizeToolName(rawToolName);
  const itemType = readStringField(record, [
    "type",
    "kind",
    "itemType",
    "item_type",
  ]);
  if (
    !toolName &&
    itemType !== "collabToolCall" &&
    itemType !== "CollabAgentToolCall" &&
    itemType !== "subAgentActivity" &&
    itemType !== "SubAgentActivity"
  ) {
    return undefined;
  }
  const sourceStatus = readStringField(record, ["status", "state"]);
  const childThreadId = readStringField(record, [
    "childThreadId",
    "child_thread_id",
    "newThreadId",
    "new_thread_id",
  ]);
  return compactProjectionFields({
    index,
    itemId: readStringField(record, ["itemId", "item_id", "id", "toolCallId"]),
    toolName,
    rawToolName,
    status: normalizeStatus(sourceStatus),
    sourceStatus,
    parentThreadId: readStringField(record, [
      "parentThreadId",
      "parent_thread_id",
      "senderThreadId",
      "sender_thread_id",
    ]),
    turnId: readStringField(record, ["turnId", "turn_id"]),
    childThreadId,
    receiverThreadIds: readReceiverThreadIds(record),
    taskName: readStringField(record, ["taskName", "task_name", "target"]),
    messagePreview: truncateText(
      readStringField(record, ["message", "prompt", "summary"]),
      160,
    ),
  } satisfies AgentUiMultiAgentTaxonomyItem);
}

function readTaxonomyItems(
  input: AgentUiMultiAgentItemTaxonomyInput,
): AgentUiMultiAgentTaxonomyItem[] {
  return [
    ...recordArray(input.taxonomyItems),
    ...recordArray(input.threadItems),
  ]
    .map(readTaxonomyItem)
    .filter((item): item is AgentUiMultiAgentTaxonomyItem => Boolean(item));
}

function normalizeSurface(
  value: string | undefined,
): AgentUiMultiAgentTaxonomySurfaceBinding["surface"] {
  switch (value ? camelToSnake(value) : undefined) {
    case "team_transcript":
      return "team_transcript";
    case "worker_card":
    case "worker_cards":
      return "worker_card";
    case "review_lane":
      return "review_lane";
    default:
      return "unknown";
  }
}

function readSurfaceBindings(
  value: unknown,
): AgentUiMultiAgentTaxonomySurfaceBinding[] {
  return recordArray(value).map((record) => ({
    surface: normalizeSurface(
      readStringField(record, ["surface", "kind", "target"]),
    ),
    itemIds: readStringArrayField(record, [
      "itemIds",
      "item_ids",
      "collabItemIds",
      "collab_item_ids",
    ]),
  }));
}

function expectedToolsCovered(
  items: readonly AgentUiMultiAgentTaxonomyItem[],
  expectedTools: readonly string[] | undefined,
): boolean {
  const expected = (expectedTools ?? [])
    .map(normalizeToolName)
    .filter((tool): tool is AgentUiMultiAgentToolName => Boolean(tool));
  const covered = new Set(items.map((item) => item.toolName).filter(Boolean));
  return expected.every((tool) => covered.has(tool));
}

function expectedStatusesCovered(
  items: readonly AgentUiMultiAgentTaxonomyItem[],
  expectedStatuses: readonly string[] | undefined,
): boolean {
  const expected = (expectedStatuses ?? []).map(normalizeStatus);
  const covered = new Set(items.map((item) => item.status));
  return expected.every((status) => covered.has(status));
}

function surfacesBoundToItems(
  items: readonly AgentUiMultiAgentTaxonomyItem[],
  bindings: readonly AgentUiMultiAgentTaxonomySurfaceBinding[],
): boolean {
  if (bindings.length === 0) return false;
  const itemIds = new Set(items.map((item) => item.itemId).filter(Boolean));
  const surfaces = new Set(bindings.map((binding) => binding.surface));
  const requiredSurfaces =
    surfaces.has("team_transcript") &&
    surfaces.has("worker_card") &&
    surfaces.has("review_lane");
  return (
    requiredSurfaces &&
    bindings.every(
      (binding) =>
        binding.itemIds.length > 0 &&
        binding.itemIds.every((itemId) => itemIds.has(itemId)),
    )
  );
}

function orphanHistoryIndexes(value: unknown): number[] {
  return recordArray(value)
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => {
      const hasAgentRef = Boolean(
        readStringField(record, [
          "agentId",
          "agent_id",
          "childSessionId",
          "child_session_id",
        ]),
      );
      const hasLineage = Boolean(
        readStringField(record, ["parentThreadId", "parent_thread_id"]) &&
        readStringField(record, ["turnId", "turn_id"]) &&
        readStringField(record, ["itemId", "item_id"]),
      );
      return hasAgentRef && !hasLineage;
    })
    .map(({ index }) => index);
}

function validateSnapshot(
  input: AgentUiMultiAgentItemTaxonomyInput,
  snapshot: Omit<AgentUiMultiAgentItemTaxonomySnapshot, "validationIssues">,
): AgentUiMultiAgentItemTaxonomyIssue[] {
  const issues: AgentUiMultiAgentItemTaxonomyIssue[] = [];
  if (!snapshot.itemTaxonomySeen) {
    issues.push(
      issue(
        "missing_multi_agent_item",
        "$.taxonomyItems",
        "Multi-agent flow must hydrate structured ThreadItem values.",
      ),
    );
  }
  for (const item of snapshot.items) {
    const path = `$.items[${item.index}]`;
    if (item.rawToolName && isLegacyMultiAgentToolName(item.rawToolName)) {
      issues.push(
        issue(
          "legacy_tool_name",
          `${path}.toolName`,
          `${item.rawToolName} is a legacy team tool.`,
        ),
      );
    } else if (
      !item.toolName ||
      !getMultiAgentToolSchemaContract(item.toolName)
    ) {
      issues.push(
        issue(
          "unknown_tool",
          `${path}.toolName`,
          "Multi-agent item tool must map to the v2 taxonomy.",
        ),
      );
    }
    if (!item.itemId)
      issues.push(
        issue(
          "missing_item_id",
          `${path}.itemId`,
          "Multi-agent item id is required.",
        ),
      );
    if (!item.turnId)
      issues.push(
        issue(
          "missing_turn_id",
          `${path}.turnId`,
          "Multi-agent item must keep owner turn id.",
        ),
      );
    if (!item.parentThreadId) {
      issues.push(
        issue(
          "missing_parent_thread_id",
          `${path}.parentThreadId`,
          "Multi-agent item must keep parent/coordinator thread id.",
        ),
      );
    }
    if (
      item.toolName === "spawn_agent" &&
      item.status === "completed" &&
      !item.childThreadId &&
      item.receiverThreadIds.length === 0
    ) {
      issues.push(
        issue(
          "missing_child_thread_id",
          `${path}.childThreadId`,
          "Completed spawn_agent item must keep spawned child thread id.",
        ),
      );
    }
  }
  if (!snapshot.toolsCovered) {
    issues.push(
      issue(
        "expected_tool_missing",
        "$.expectedTools",
        "spawn/send/followup/wait/list/interrupt taxonomy must all be covered.",
      ),
    );
  }
  if (!snapshot.statusesCovered) {
    issues.push(
      issue(
        "expected_status_missing",
        "$.expectedStatuses",
        "Team item statuses must include running/completed/interrupted coverage.",
      ),
    );
  }
  if (!snapshot.surfacesBoundToItems) {
    issues.push(
      issue(
        "surface_item_binding_missing",
        "$.surfaceBindings",
        "Team transcript, worker card and review lane must point back to taxonomy item ids.",
      ),
    );
  }
  if (!snapshot.legacyTextSummaryClean) {
    issues.push(
      issue(
        "text_summary_timeline_leak",
        "$.legacyTextSummaries",
        "Text summary Team timelines cannot replace structured item taxonomy.",
      ),
    );
  }
  for (const index of orphanHistoryIndexes(input.orphanAgentHistories)) {
    issues.push(
      issue(
        "orphan_agent_history",
        `$.orphanAgentHistories[${index}]`,
        "Agent history must keep parentThreadId, turnId and itemId lineage.",
      ),
    );
  }
  return issues;
}

export function extractMultiAgentItemTaxonomySnapshot(
  input: AgentUiMultiAgentItemTaxonomyInput,
): AgentUiMultiAgentItemTaxonomySnapshot {
  const items = readTaxonomyItems(input);
  const surfaceBindings = readSurfaceBindings(input.surfaceBindings);
  const threadId =
    definedString(input.threadId ?? undefined) ??
    items.find((item) => item.parentThreadId)?.parentThreadId;
  const base = {
    threadId,
    items,
    surfaceBindings,
    itemTaxonomySeen: items.length > 0,
    toolsCovered: expectedToolsCovered(items, input.expectedTools),
    statusesCovered: expectedStatusesCovered(items, input.expectedStatuses),
    itemIdsStable: items.every((item) => Boolean(item.itemId)),
    turnIdsStable: items.every((item) => Boolean(item.turnId)),
    parentThreadBound: items.every(
      (item) =>
        Boolean(item.parentThreadId) &&
        (!threadId || item.parentThreadId === threadId),
    ),
    childLineageStable: items.every(
      (item) =>
        item.toolName !== "spawn_agent" ||
        item.status !== "completed" ||
        Boolean(item.childThreadId || item.receiverThreadIds.length > 0),
    ),
    surfacesBoundToItems: surfacesBoundToItems(items, surfaceBindings),
    legacyTextSummaryClean: recordArray(input.legacyTextSummaries).length === 0,
    orphanAgentHistoryClean:
      orphanHistoryIndexes(input.orphanAgentHistories).length === 0,
  };
  return {
    ...base,
    validationIssues: validateSnapshot(input, base),
  };
}
