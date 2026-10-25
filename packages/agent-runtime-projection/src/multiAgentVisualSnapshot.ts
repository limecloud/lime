import type { AgentUiRuntimeStatus } from "@limecloud/agent-ui-contracts";

import {
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

export type AgentUiMultiAgentVisualTool = AgentUiMultiAgentToolName;

export type AgentUiMultiAgentVisualIssueCode =
  | "missing_collab_tool_call_item"
  | "legacy_tool_name"
  | "legacy_plain_transcript_only"
  | "legacy_agent_text_transcript_leak"
  | "missing_sender_thread_id"
  | "missing_receiver_thread_id"
  | "spawn_missing_new_thread_id"
  | "missing_team_transcript_snapshot"
  | "missing_team_roster_snapshot"
  | "missing_delegation_graph_snapshot"
  | "missing_worker_notification_snapshot"
  | "missing_requested_model_effort";

export interface AgentUiMultiAgentVisualIssue {
  code: AgentUiMultiAgentVisualIssueCode;
  path: string;
  message: string;
}

export interface AgentUiMultiAgentVisualTranscriptRow {
  itemId: string;
  tool: AgentUiMultiAgentVisualTool;
  status: string;
  senderThreadId: string;
  receiverThreadIds: string[];
  newThreadId?: string;
  promptPreview?: string;
  requestedModel?: string;
  reasoningEffort?: string;
}

export interface AgentUiMultiAgentVisualRosterCard {
  threadId: string;
  status: AgentUiRuntimeStatus;
  sourceStatus: string;
  sourceItemId: string;
  nickname?: string;
  role?: string;
  messagePreview?: string;
}

export interface AgentUiMultiAgentVisualDelegationEdge {
  itemId: string;
  fromThreadId: string;
  toThreadId: string;
  tool: AgentUiMultiAgentVisualTool;
  status: string;
}

export interface AgentUiMultiAgentVisualWorkerNotification {
  notificationId: string;
  itemId: string;
  threadId: string;
  status: AgentUiRuntimeStatus;
  messagePreview?: string;
}

export interface AgentUiMultiAgentObservedVisualSnapshot {
  teamTranscriptRows?: unknown[];
  teamRosterCards?: unknown[];
  delegationEdges?: unknown[];
  workerNotifications?: unknown[];
}

export interface AgentUiMultiAgentVisualSnapshotInput {
  threadId?: string | null;
  collabToolCallItems?: unknown[];
  threadItems?: unknown[];
  observedSnapshot?: AgentUiMultiAgentObservedVisualSnapshot | null;
  legacyTranscriptRows?: unknown[];
  agentMetadata?: Record<string, unknown>;
}

export interface AgentUiMultiAgentVisualSnapshot {
  threadId?: string;
  collabItemCount: number;
  teamTranscriptRows: AgentUiMultiAgentVisualTranscriptRow[];
  teamRosterCards: AgentUiMultiAgentVisualRosterCard[];
  delegationEdges: AgentUiMultiAgentVisualDelegationEdge[];
  workerNotifications: AgentUiMultiAgentVisualWorkerNotification[];
  requestedModelEffortVisible: boolean;
  lineageStable: boolean;
  legacyTranscriptOnly: boolean;
  legacyTranscriptLeak: boolean;
  visualSurfaces: {
    teamTranscript: boolean;
    teamRoster: boolean;
    delegationGraph: boolean;
    workerNotifications: boolean;
  };
  validationIssues: AgentUiMultiAgentVisualIssue[];
}

interface NormalizedCollabItem {
  path: string;
  itemId?: string;
  tool?: AgentUiMultiAgentVisualTool;
  rawTool?: string;
  status: string;
  senderThreadId?: string;
  receiverThreadIds: string[];
  newThreadId?: string;
  prompt?: string;
  requestedModel?: string;
  reasoningEffort?: string;
  agentsStates: Record<string, Record<string, unknown>>;
}

interface CompleteTranscriptCollabItem extends NormalizedCollabItem {
  itemId: string;
  tool: AgentUiMultiAgentVisualTool;
  senderThreadId: string;
}

const TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "errored",
  "error",
  "interrupted",
  "aborted",
  "cancelled",
  "canceled",
  "shutdown",
  "closed",
  "not_found",
]);

function issue(
  code: AgentUiMultiAgentVisualIssueCode,
  path: string,
  message: string,
): AgentUiMultiAgentVisualIssue {
  return { code, path, message };
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function camelToSnake(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-.\s]+/g, "_")
    .toLowerCase();
}

function normalizeTool(
  value: string | undefined,
): AgentUiMultiAgentVisualTool | undefined {
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

function requiresReceiverThreadLineage(
  tool: AgentUiMultiAgentVisualTool | undefined,
): boolean {
  return (
    tool === "send_message" ||
    tool === "followup_task" ||
    tool === "interrupt_agent"
  );
}

function runtimeStatus(value: string | undefined): AgentUiRuntimeStatus {
  switch (value ? camelToSnake(value) : undefined) {
    case "pending_init":
    case "queued":
      return "queued";
    case "in_progress":
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "failed":
    case "errored":
    case "error":
      return "failed";
    case "interrupted":
    case "aborted":
      return "aborted";
    case "cancelled":
    case "canceled":
      return "cancelled";
    case "shutdown":
    case "closed":
      return "closed";
    case "not_found":
      return "not_found";
    default:
      return "unknown";
  }
}

function normalizeAgentStateMap(
  value: unknown,
): Record<string, Record<string, unknown>> {
  const record = readRecord(value);
  if (!record) return {};
  return Object.fromEntries(
    Object.entries(record)
      .map(([threadId, state]) => [threadId, readRecord(state)])
      .filter((entry): entry is [string, Record<string, unknown>] =>
        Boolean(entry[1]),
      ),
  );
}

function metadataForThread(
  metadata: Record<string, unknown> | undefined,
  threadId: string,
): Record<string, unknown> | undefined {
  return readRecord(metadata?.[threadId]);
}

function normalizeCollabItem(
  value: unknown,
  path: string,
): NormalizedCollabItem | undefined {
  const record = readRecord(value);
  if (!record) return undefined;
  const type = readStringField(record, ["type", "itemType", "kind"]);
  const rawTool = readStringField(record, ["tool", "toolName", "name"]);
  const tool = normalizeTool(rawTool);
  if (
    type &&
    type !== "collabToolCall" &&
    type !== "CollabAgentToolCall" &&
    !tool
  ) {
    return undefined;
  }

  const receiverThreadIds = [
    ...readStringArrayField(record, [
      "receiverThreadIds",
      "receiver_thread_ids",
    ]),
    ...readStringArrayField(record, ["receiverThreadId", "receiver_thread_id"]),
  ];
  const newThreadId = readStringField(record, ["newThreadId", "new_thread_id"]);
  if (newThreadId && !receiverThreadIds.includes(newThreadId)) {
    receiverThreadIds.push(newThreadId);
  }

  return {
    path,
    itemId: readStringField(record, ["id", "itemId", "toolCallId"]),
    tool,
    rawTool,
    status: readStringField(record, ["status"]) ?? "unknown",
    senderThreadId: readStringField(record, [
      "senderThreadId",
      "sender_thread_id",
    ]),
    receiverThreadIds,
    newThreadId,
    prompt: readStringField(record, ["prompt", "message"]),
    requestedModel: readStringField(record, [
      "requestedModel",
      "requested_model",
      "model",
    ]),
    reasoningEffort: readStringField(record, [
      "reasoningEffort",
      "reasoning_effort",
      "effort",
    ]),
    agentsStates: normalizeAgentStateMap(
      record.agentsStates ?? record.agents_states,
    ),
  };
}

function collectCollabItems(
  input: AgentUiMultiAgentVisualSnapshotInput,
): NormalizedCollabItem[] {
  const explicitItems = readArray(input.collabToolCallItems).map(
    (item, index) =>
      normalizeCollabItem(item, `$.collabToolCallItems[${index}]`),
  );
  const threadItems = readArray(input.threadItems).map((item, index) =>
    normalizeCollabItem(item, `$.threadItems[${index}]`),
  );
  return [...explicitItems, ...threadItems].filter(
    (item): item is NormalizedCollabItem => Boolean(item),
  );
}

function buildTranscriptRows(
  items: readonly NormalizedCollabItem[],
): AgentUiMultiAgentVisualTranscriptRow[] {
  return items
    .filter((item): item is CompleteTranscriptCollabItem =>
      Boolean(item.itemId && item.tool && item.senderThreadId),
    )
    .map((item) =>
      compactProjectionFields({
        itemId: item.itemId,
        tool: item.tool,
        status: item.status,
        senderThreadId: item.senderThreadId,
        receiverThreadIds: item.receiverThreadIds,
        newThreadId: item.newThreadId,
        promptPreview: truncateText(item.prompt, 160),
        requestedModel: item.requestedModel,
        reasoningEffort: item.reasoningEffort,
      } satisfies AgentUiMultiAgentVisualTranscriptRow),
    );
}

function buildRosterCards(
  items: readonly NormalizedCollabItem[],
  metadata: Record<string, unknown> | undefined,
): AgentUiMultiAgentVisualRosterCard[] {
  const rows = new Map<string, AgentUiMultiAgentVisualRosterCard>();
  for (const item of items) {
    if (!item.itemId) continue;
    for (const [threadId, state] of Object.entries(item.agentsStates)) {
      const sourceStatus = readStringField(state, ["status"]) ?? item.status;
      const threadMetadata = metadataForThread(metadata, threadId);
      rows.set(
        threadId,
        compactProjectionFields({
          threadId,
          status: runtimeStatus(sourceStatus),
          sourceStatus,
          sourceItemId: item.itemId,
          nickname: readStringField(threadMetadata, [
            "nickname",
            "agentNickname",
            "agent_nickname",
          ]),
          role: readStringField(threadMetadata, [
            "role",
            "agentRole",
            "agent_role",
          ]),
          messagePreview: truncateText(
            readStringField(state, ["message", "summary"]),
            240,
          ),
        } satisfies AgentUiMultiAgentVisualRosterCard),
      );
    }
  }
  return [...rows.values()].sort((left, right) =>
    left.threadId.localeCompare(right.threadId),
  );
}

function buildDelegationEdges(
  items: readonly NormalizedCollabItem[],
): AgentUiMultiAgentVisualDelegationEdge[] {
  return items.flatMap((item) => {
    if (!item.itemId || !item.tool || !item.senderThreadId) return [];
    return item.receiverThreadIds.map((receiverThreadId) => ({
      itemId: item.itemId as string,
      fromThreadId: item.senderThreadId as string,
      toThreadId: receiverThreadId,
      tool: item.tool as AgentUiMultiAgentVisualTool,
      status: item.status,
    }));
  });
}

function buildWorkerNotifications(
  rows: readonly AgentUiMultiAgentVisualRosterCard[],
): AgentUiMultiAgentVisualWorkerNotification[] {
  return rows
    .filter((row) => TERMINAL_STATUSES.has(camelToSnake(row.sourceStatus)))
    .map((row) =>
      compactProjectionFields({
        notificationId: `${row.threadId}:${row.status}`,
        itemId: row.sourceItemId,
        threadId: row.threadId,
        status: row.status,
        messagePreview: row.messagePreview,
      } satisfies AgentUiMultiAgentVisualWorkerNotification),
    );
}

function observedIds(rows: unknown[], keys: string[]): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    const record = readRecord(row);
    const id = readStringField(record, keys);
    if (id) ids.add(id);
  }
  return ids;
}

function hasObservedRequestedModelEffort(
  rows: unknown[],
  expected: AgentUiMultiAgentVisualTranscriptRow,
): boolean {
  return rows.some((row) => {
    const record = readRecord(row);
    if (!record) return false;
    const itemId = readStringField(record, [
      "itemId",
      "collabItemId",
      "toolCallId",
      "id",
    ]);
    if (itemId !== expected.itemId) return false;
    const model =
      readStringField(record, ["requestedModel", "model"]) ??
      readStringField(record, ["text", "label", "title"]);
    const effort =
      readStringField(record, ["reasoningEffort", "effort"]) ??
      readStringField(record, ["text", "label", "title"]);
    return Boolean(
      model?.includes(expected.requestedModel ?? "") &&
      effort
        ?.toLowerCase()
        .includes((expected.reasoningEffort ?? "").toLowerCase()),
    );
  });
}

function validateSnapshot(
  input: AgentUiMultiAgentVisualSnapshotInput,
  items: readonly NormalizedCollabItem[],
  snapshot: Omit<AgentUiMultiAgentVisualSnapshot, "validationIssues">,
): AgentUiMultiAgentVisualIssue[] {
  const issues: AgentUiMultiAgentVisualIssue[] = [];
  if (items.length === 0) {
    issues.push(
      issue(
        "missing_collab_tool_call_item",
        "$.collabToolCallItems",
        "Multi-agent visual snapshots must be derived from collabToolCall ThreadItem values.",
      ),
    );
  }
  if (snapshot.legacyTranscriptOnly) {
    issues.push(
      issue(
        "legacy_plain_transcript_only",
        "$.legacyTranscriptRows",
        "Legacy plain transcript rows cannot be the only team visual evidence.",
      ),
    );
  } else if (snapshot.legacyTranscriptLeak) {
    issues.push(
      issue(
        "legacy_agent_text_transcript_leak",
        "$.legacyTranscriptRows",
        "Team visuals must not mix item-derived rows with legacy text transcript rows.",
      ),
    );
  }

  for (const item of items) {
    if (item.rawTool && isLegacyMultiAgentToolName(item.rawTool)) {
      issues.push(
        issue(
          "legacy_tool_name",
          `${item.path}.tool`,
          `${item.rawTool} is not a collab item tool.`,
        ),
      );
    }
    if (!item.senderThreadId) {
      issues.push(
        issue(
          "missing_sender_thread_id",
          `${item.path}.senderThreadId`,
          "Collab tool call items must keep the coordinator senderThreadId.",
        ),
      );
    }
    if (
      requiresReceiverThreadLineage(item.tool) &&
      item.receiverThreadIds.length === 0
    ) {
      issues.push(
        issue(
          "missing_receiver_thread_id",
          `${item.path}.receiverThreadIds`,
          `${item.tool} must keep receiver thread lineage.`,
        ),
      );
    }
    if (
      item.tool === "spawn_agent" &&
      runtimeStatus(item.status) === "completed" &&
      item.receiverThreadIds.length === 0
    ) {
      issues.push(
        issue(
          "spawn_missing_new_thread_id",
          `${item.path}.newThreadId`,
          "Completed spawn_agent items must expose the spawned thread id.",
        ),
      );
    }
  }

  const observed = input.observedSnapshot;
  const transcriptRows = readArray(observed?.teamTranscriptRows);
  const transcriptIds = observedIds(transcriptRows, [
    "itemId",
    "collabItemId",
    "toolCallId",
    "id",
  ]);
  const expectedTranscriptIds = snapshot.teamTranscriptRows.map(
    (row) => row.itemId,
  );
  if (
    expectedTranscriptIds.length > 0 &&
    !expectedTranscriptIds.every((id) => transcriptIds.has(id))
  ) {
    issues.push(
      issue(
        "missing_team_transcript_snapshot",
        "$.observedSnapshot.teamTranscriptRows",
        "Team transcript visual snapshot must carry collab item ids.",
      ),
    );
  }

  const rosterIds = observedIds(readArray(observed?.teamRosterCards), [
    "threadId",
    "agentId",
    "sessionId",
    "id",
  ]);
  if (
    snapshot.teamRosterCards.length > 0 &&
    !snapshot.teamRosterCards.every((row) => rosterIds.has(row.threadId))
  ) {
    issues.push(
      issue(
        "missing_team_roster_snapshot",
        "$.observedSnapshot.teamRosterCards",
        "Team roster visual snapshot must carry worker thread ids.",
      ),
    );
  }

  const edgeIds = observedIds(readArray(observed?.delegationEdges), [
    "itemId",
    "collabItemId",
    "toolCallId",
    "id",
  ]);
  if (
    snapshot.delegationEdges.length > 0 &&
    !snapshot.delegationEdges.every((edge) => edgeIds.has(edge.itemId))
  ) {
    issues.push(
      issue(
        "missing_delegation_graph_snapshot",
        "$.observedSnapshot.delegationEdges",
        "Delegation graph snapshot must preserve collab item lineage.",
      ),
    );
  }

  const workerIds = observedIds(readArray(observed?.workerNotifications), [
    "threadId",
    "agentId",
    "sessionId",
    "childThreadId",
    "id",
  ]);
  if (
    snapshot.workerNotifications.length > 0 &&
    !snapshot.workerNotifications.every((row) => workerIds.has(row.threadId))
  ) {
    issues.push(
      issue(
        "missing_worker_notification_snapshot",
        "$.observedSnapshot.workerNotifications",
        "Worker notification snapshot must preserve terminal worker thread ids.",
      ),
    );
  }

  const spawnRows = snapshot.teamTranscriptRows.filter(
    (row) =>
      row.tool === "spawn_agent" && row.requestedModel && row.reasoningEffort,
  );
  if (
    spawnRows.length > 0 &&
    !spawnRows.every((row) =>
      hasObservedRequestedModelEffort(transcriptRows, row),
    )
  ) {
    issues.push(
      issue(
        "missing_requested_model_effort",
        "$.observedSnapshot.teamTranscriptRows",
        "Spawn transcript rows must expose requested model and reasoning effort.",
      ),
    );
  }

  return issues;
}

export function extractMultiAgentVisualSnapshot(
  input: AgentUiMultiAgentVisualSnapshotInput,
): AgentUiMultiAgentVisualSnapshot {
  const items = collectCollabItems(input);
  const teamTranscriptRows = buildTranscriptRows(items);
  const teamRosterCards = buildRosterCards(items, input.agentMetadata);
  const delegationEdges = buildDelegationEdges(items);
  const workerNotifications = buildWorkerNotifications(teamRosterCards);
  const legacyRows = readArray(input.legacyTranscriptRows);
  const base = {
    threadId: definedString(input.threadId ?? undefined),
    collabItemCount: items.length,
    teamTranscriptRows,
    teamRosterCards,
    delegationEdges,
    workerNotifications,
    requestedModelEffortVisible: teamTranscriptRows.some(
      (row) =>
        row.tool === "spawn_agent" && row.requestedModel && row.reasoningEffort,
    ),
    lineageStable: items.every(
      (item) =>
        Boolean(item.senderThreadId) &&
        (!requiresReceiverThreadLineage(item.tool) ||
          item.receiverThreadIds.length > 0),
    ),
    legacyTranscriptOnly: items.length === 0 && legacyRows.length > 0,
    legacyTranscriptLeak: items.length > 0 && legacyRows.length > 0,
    visualSurfaces: {
      teamTranscript: teamTranscriptRows.length > 0,
      teamRoster: teamRosterCards.length > 0,
      delegationGraph: delegationEdges.length > 0,
      workerNotifications: workerNotifications.length > 0,
    },
  };

  return {
    ...base,
    validationIssues: validateSnapshot(input, items, base),
  };
}
