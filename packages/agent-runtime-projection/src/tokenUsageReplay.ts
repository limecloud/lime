import type {
  AgentUiProjectionContext,
  AgentUiProjectionEvent,
  AgentUiRuntimeStatus,
} from "@limecloud/agent-ui-contracts";

import {
  compactProjectionFields,
  definedString,
  readNumberField,
  readRecord,
  readStringField,
} from "./normalization.js";

export type AgentUiTokenUsageReplayIssueCode =
  | "missing_thread_id"
  | "missing_token_usage_replay"
  | "token_usage_replayed_when_turns_excluded"
  | "token_usage_wrong_thread"
  | "token_usage_wrong_turn"
  | "stale_tail_turn_owns_usage"
  | "token_usage_missing_totals"
  | "token_usage_replayed_after_next_turn"
  | "token_usage_broadcast_to_other_connections"
  | "token_usage_rendered_as_transcript_item"
  | "token_usage_persisted_as_read_model_item"
  | "context_window_surface_not_updated";

export interface AgentUiTokenUsageReplayIssue {
  code: AgentUiTokenUsageReplayIssueCode;
  path: string;
  message: string;
}

export interface AgentUiTokenUsageCounts {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
  totalTokens?: number;
}

export interface AgentUiTokenUsageSnapshot {
  total: AgentUiTokenUsageCounts;
  last: AgentUiTokenUsageCounts;
  modelContextWindow?: number;
}

export interface AgentUiTokenUsageReplayProjectionInput {
  threadId?: string | null;
  expectedTurnId?: string | null;
  staleTailTurnId?: string | null;
  excludeTurns?: boolean;
  tokenUsageNotification?: unknown;
  notifications?: unknown;
  notificationOrder?: unknown;
  otherConnectionNotifications?: unknown;
  contextWindowSurface?: unknown;
  transcriptItems?: unknown;
  readModelItems?: unknown;
  timestamp?: string | null;
}

export interface AgentUiTokenUsageNotificationSnapshot {
  index: number;
  threadId?: string;
  turnId?: string;
  method?: string;
  tokenUsage: AgentUiTokenUsageSnapshot;
}

export interface AgentUiTokenUsageReplaySnapshot {
  threadId?: string;
  expectedTurnId?: string;
  excludeTurns: boolean;
  tokenUsageNotifications: AgentUiTokenUsageNotificationSnapshot[];
  replayNotificationSeen: boolean;
  replaySkippedForExcludeTurns: boolean;
  threadScoped: boolean;
  turnAttributionMatchesExpected: boolean;
  staleTailIgnored: boolean;
  tokenUsageHasTotals: boolean;
  replayBeforeNextTurn: boolean;
  connectionScoped: boolean;
  transcriptClean: boolean;
  readModelClean: boolean;
  contextWindowSurfaceUpdated: boolean;
  latestTokenUsage?: AgentUiTokenUsageSnapshot;
  validationIssues: AgentUiTokenUsageReplayIssue[];
}

function issue(
  code: AgentUiTokenUsageReplayIssueCode,
  path: string,
  message: string,
): AgentUiTokenUsageReplayIssue {
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
  const nested = record.data ?? record.items ?? record.notifications;
  if (nested !== undefined) return recordArray(nested);
  return [record];
}

function readMethod(record: Record<string, unknown>): string | undefined {
  return readStringField(record, ["method"]);
}

function readParams(record: Record<string, unknown>): Record<string, unknown> {
  return readRecord(record.params) ?? record;
}

function readTokenCount(
  record: Record<string, unknown> | undefined,
): AgentUiTokenUsageCounts {
  return compactProjectionFields({
    inputTokens: readNumberField(record, ["inputTokens", "input_tokens"]),
    cachedInputTokens: readNumberField(record, [
      "cachedInputTokens",
      "cached_input_tokens",
    ]),
    outputTokens: readNumberField(record, ["outputTokens", "output_tokens"]),
    reasoningOutputTokens: readNumberField(record, [
      "reasoningOutputTokens",
      "reasoning_output_tokens",
    ]),
    totalTokens: readNumberField(record, ["totalTokens", "total_tokens"]),
  } satisfies AgentUiTokenUsageCounts);
}

function readTokenUsage(value: unknown): AgentUiTokenUsageSnapshot {
  const record = readRecord(value);
  const params = readRecord(record?.params) ?? record;
  const usage =
    readRecord(params?.tokenUsage) ??
    readRecord(params?.token_usage) ??
    readRecord(record?.tokenUsage) ??
    readRecord(record?.token_usage) ??
    record;
  return {
    total: readTokenCount(
      readRecord(usage?.total) ?? readRecord(usage?.totalTokenUsage),
    ),
    last: readTokenCount(
      readRecord(usage?.last) ?? readRecord(usage?.lastTokenUsage),
    ),
    modelContextWindow: readNumberField(usage, [
      "modelContextWindow",
      "model_context_window",
    ]),
  };
}

function isTokenUsageNotification(record: Record<string, unknown>): boolean {
  const method = readMethod(record);
  const params = readParams(record);
  return Boolean(
    method === "thread/tokenUsage/updated" ||
    method === "thread_token_usage_updated" ||
    method === "thread.tokenUsage.updated" ||
    params.tokenUsage ||
    params.token_usage,
  );
}

function readTokenUsageNotifications(
  input: AgentUiTokenUsageReplayProjectionInput,
): AgentUiTokenUsageNotificationSnapshot[] {
  const records = [
    ...recordArray(input.tokenUsageNotification),
    ...recordArray(input.notifications),
  ].filter(isTokenUsageNotification);
  return records.map((record, index) => {
    const params = readParams(record);
    return {
      index,
      threadId: readStringField(params, ["threadId", "thread_id", "id"]),
      turnId: readStringField(params, ["turnId", "turn_id"]),
      method: readMethod(record),
      tokenUsage: readTokenUsage(record),
    };
  });
}

function hasUsageTotals(usage: AgentUiTokenUsageSnapshot | undefined): boolean {
  return Boolean(
    usage &&
    typeof usage.total.totalTokens === "number" &&
    typeof usage.last.totalTokens === "number" &&
    typeof usage.modelContextWindow === "number",
  );
}

function orderBeforeNextTurn(value: unknown): boolean {
  const order = recordArray(value)
    .map((record) => readStringField(record, ["method", "event", "type"]))
    .filter((item): item is string => Boolean(item));
  if (order.length === 0) return true;
  const usageIndex = order.findIndex(
    (item) => item === "thread/tokenUsage/updated",
  );
  const nextTurnIndex = order.findIndex(
    (item) => item === "turn/started" || item === "turn.started",
  );
  return usageIndex >= 0 && (nextTurnIndex < 0 || usageIndex < nextTurnIndex);
}

function isTokenUsageProjectionRecord(
  record: Record<string, unknown>,
): boolean {
  const method = readMethod(record);
  const type = readStringField(record, [
    "type",
    "kind",
    "sourceType",
    "source_type",
  ]);
  return Boolean(
    isTokenUsageNotification(record) ||
    method === "thread/tokenUsage/updated" ||
    type === "token_usage" ||
    type === "thread_token_usage" ||
    type === "token_usage_replay_projection",
  );
}

function leakIndexes(value: unknown): number[] {
  return recordArray(value)
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => isTokenUsageProjectionRecord(record))
    .map(({ index }) => index);
}

function contextWindowSurfaceMatches(
  surface: unknown,
  usage: AgentUiTokenUsageSnapshot | undefined,
): boolean {
  if (surface === undefined || !usage) return true;
  const record = readRecord(surface);
  if (!record) return false;
  const modelContextWindow = readNumberField(record, [
    "modelContextWindow",
    "model_context_window",
  ]);
  const totalTokens = readNumberField(record, [
    "totalTokens",
    "total_tokens",
    "usedTokens",
  ]);
  return (
    modelContextWindow === usage.modelContextWindow &&
    (totalTokens === undefined || totalTokens === usage.total.totalTokens)
  );
}

function validateSnapshot(
  input: AgentUiTokenUsageReplayProjectionInput,
  snapshot: Omit<AgentUiTokenUsageReplaySnapshot, "validationIssues">,
): AgentUiTokenUsageReplayIssue[] {
  const issues: AgentUiTokenUsageReplayIssue[] = [];
  if (!snapshot.threadId) {
    issues.push(
      issue(
        "missing_thread_id",
        "$.threadId",
        "Token usage replay requires a thread id.",
      ),
    );
  }
  if (!snapshot.excludeTurns && !snapshot.replayNotificationSeen) {
    issues.push(
      issue(
        "missing_token_usage_replay",
        "$.tokenUsageNotification",
        "Resume/fork with turns must replay restored thread/tokenUsage/updated.",
      ),
    );
  }
  if (snapshot.excludeTurns && snapshot.replayNotificationSeen) {
    issues.push(
      issue(
        "token_usage_replayed_when_turns_excluded",
        "$.tokenUsageNotification",
        "excludeTurns=true must skip restored token usage replay.",
      ),
    );
  }
  if (!snapshot.threadScoped) {
    issues.push(
      issue(
        "token_usage_wrong_thread",
        "$.tokenUsageNotification.params.threadId",
        "Token usage replay must be scoped to the resumed/forked thread.",
      ),
    );
  }
  if (!snapshot.turnAttributionMatchesExpected) {
    issues.push(
      issue(
        "token_usage_wrong_turn",
        "$.tokenUsageNotification.params.turnId",
        "Token usage replay must be attributed to the turn that owned TokenCount.",
      ),
    );
  }
  if (!snapshot.staleTailIgnored) {
    issues.push(
      issue(
        "stale_tail_turn_owns_usage",
        "$.tokenUsageNotification.params.turnId",
        "A stale interrupted tail after TokenCount must not own restored usage.",
      ),
    );
  }
  if (snapshot.replayNotificationSeen && !snapshot.tokenUsageHasTotals) {
    issues.push(
      issue(
        "token_usage_missing_totals",
        "$.tokenUsageNotification.params.tokenUsage",
        "Token usage replay must include total, last and model_context_window.",
      ),
    );
  }
  if (!snapshot.replayBeforeNextTurn) {
    issues.push(
      issue(
        "token_usage_replayed_after_next_turn",
        "$.notificationOrder",
        "Restored token usage must be emitted before the next turn starts.",
      ),
    );
  }
  if (!snapshot.connectionScoped) {
    issues.push(
      issue(
        "token_usage_broadcast_to_other_connections",
        "$.otherConnectionNotifications",
        "Restored token usage replay must be connection-scoped, not broadcast.",
      ),
    );
  }
  for (const index of leakIndexes(input.transcriptItems)) {
    issues.push(
      issue(
        "token_usage_rendered_as_transcript_item",
        `$.transcriptItems[${index}]`,
        "Token usage is thread metadata/status, not a transcript message.",
      ),
    );
  }
  for (const index of leakIndexes(input.readModelItems)) {
    issues.push(
      issue(
        "token_usage_persisted_as_read_model_item",
        `$.readModelItems[${index}]`,
        "Token usage must not persist as a normal read-model item.",
      ),
    );
  }
  if (!snapshot.contextWindowSurfaceUpdated) {
    issues.push(
      issue(
        "context_window_surface_not_updated",
        "$.contextWindowSurface",
        "Context-window surface must use replayed model_context_window and totals.",
      ),
    );
  }
  return issues;
}

export function extractTokenUsageReplaySnapshot(
  input: AgentUiTokenUsageReplayProjectionInput,
): AgentUiTokenUsageReplaySnapshot {
  const notifications = readTokenUsageNotifications(input);
  const latest = notifications[notifications.length - 1];
  const threadId =
    definedString(input.threadId ?? undefined) ??
    notifications.find((item) => item.threadId)?.threadId;
  const expectedTurnId = definedString(input.expectedTurnId ?? undefined);
  const staleTailTurnId = definedString(input.staleTailTurnId ?? undefined);
  const excludeTurns = input.excludeTurns === true;
  const base = {
    threadId,
    expectedTurnId,
    excludeTurns,
    tokenUsageNotifications: notifications,
    replayNotificationSeen: notifications.length > 0,
    replaySkippedForExcludeTurns: excludeTurns && notifications.length === 0,
    threadScoped: notifications.every(
      (item) => !threadId || item.threadId === threadId,
    ),
    turnAttributionMatchesExpected:
      !expectedTurnId ||
      notifications.every((item) => item.turnId === expectedTurnId),
    staleTailIgnored:
      !staleTailTurnId ||
      notifications.every((item) => item.turnId !== staleTailTurnId),
    tokenUsageHasTotals: hasUsageTotals(latest?.tokenUsage),
    replayBeforeNextTurn: orderBeforeNextTurn(input.notificationOrder),
    connectionScoped:
      recordArray(input.otherConnectionNotifications).length === 0,
    transcriptClean: leakIndexes(input.transcriptItems).length === 0,
    readModelClean: leakIndexes(input.readModelItems).length === 0,
    contextWindowSurfaceUpdated: contextWindowSurfaceMatches(
      input.contextWindowSurface,
      latest?.tokenUsage,
    ),
    latestTokenUsage: latest?.tokenUsage,
  };
  return {
    ...base,
    validationIssues: validateSnapshot(input, base),
  };
}

function runtimeStatus(
  issues: readonly AgentUiTokenUsageReplayIssue[],
): AgentUiRuntimeStatus {
  return issues.length > 0 ? "failed" : "completed";
}

export function buildTokenUsageReplayProjectionEvent(
  input: AgentUiTokenUsageReplayProjectionInput,
  context: AgentUiProjectionContext = {},
): AgentUiProjectionEvent {
  const snapshot = extractTokenUsageReplaySnapshot(input);
  const status = runtimeStatus(snapshot.validationIssues);
  return compactProjectionFields({
    type: "metric.changed",
    sourceType: "token_usage_replay_projection",
    sequence: context.sequence,
    timestamp: definedString(input.timestamp ?? undefined) ?? context.timestamp,
    sessionId: definedString(context.sessionId ?? undefined),
    threadId: snapshot.threadId ?? definedString(context.threadId ?? undefined),
    runId: definedString(context.runId ?? undefined),
    turnId:
      snapshot.expectedTurnId ?? definedString(context.turnId ?? undefined),
    owner: "diagnostics",
    scope: "thread",
    phase: status === "failed" ? "failed" : "completed",
    surface: "runtime_status",
    persistence: "snapshot",
    control: "none",
    runtimeEntity: "agent_turn",
    runtimeStatus: status,
    latestTurnStatus: status,
    payload: {
      tokenUsageReplayEvent: "thread_token_usage_updated",
      replayNotificationSeen: snapshot.replayNotificationSeen,
      replaySkippedForExcludeTurns: snapshot.replaySkippedForExcludeTurns,
      threadScoped: snapshot.threadScoped,
      turnAttributionMatchesExpected: snapshot.turnAttributionMatchesExpected,
      staleTailIgnored: snapshot.staleTailIgnored,
      tokenUsageHasTotals: snapshot.tokenUsageHasTotals,
      replayBeforeNextTurn: snapshot.replayBeforeNextTurn,
      connectionScoped: snapshot.connectionScoped,
      transcriptClean: snapshot.transcriptClean,
      readModelClean: snapshot.readModelClean,
      contextWindowSurfaceUpdated: snapshot.contextWindowSurfaceUpdated,
      latestTokenUsage: snapshot.latestTokenUsage,
      tokenUsageReplay: snapshot,
      validationIssues: snapshot.validationIssues,
    },
  } satisfies AgentUiProjectionEvent);
}
