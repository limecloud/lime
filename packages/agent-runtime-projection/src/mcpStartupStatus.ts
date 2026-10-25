import type {
  AgentUiProjectionContext,
  AgentUiProjectionEvent,
  AgentUiRuntimeStatus,
} from "@limecloud/agent-ui-contracts";

import {
  compactProjectionFields,
  definedString,
  normalizeProjectionIdList,
  readBooleanField,
  readRecord,
  readStringArray,
  readStringField,
} from "./normalization.js";

export type AgentUiMcpStartupState =
  | "starting"
  | "ready"
  | "failed"
  | "cancelled";

export type AgentUiMcpStartupEventKind =
  | "update"
  | "complete"
  | "lag_elapsed"
  | "turn_started"
  | "turn_completed";

export type AgentUiMcpStartupIgnoredReason =
  | "other_thread"
  | "missing_thread_scope"
  | "stale_completed_round";

export type AgentUiMcpStartupIssueCode =
  | "missing_active_thread"
  | "missing_startup_server"
  | "missing_startup_state"
  | "missing_update_thread_scope"
  | "missing_complete_thread_scope"
  | "startup_rendered_as_assistant_item"
  | "other_thread_update_applied"
  | "startup_complete_cleared_running_task"
  | "turn_start_replaced_active_startup_header"
  | "startup_complete_did_not_restore_running_header"
  | "stale_update_reopened_startup";

export interface AgentUiMcpStartupIssue {
  code: AgentUiMcpStartupIssueCode;
  path: string;
  message: string;
}

export interface AgentUiMcpStartupStatusProjectionInput {
  activeThreadId?: string | null;
  expectedServers?: unknown;
  events?: unknown;
  activeTurnRunning?: boolean | null;
  observed?: unknown;
  assistantItems?: unknown;
  timestamp?: string | null;
}

export interface AgentUiMcpStartupObservedState {
  taskRunningAfterStartup?: boolean;
  statusHeader?: string;
  appliedOtherThreadUpdate?: boolean;
  reopenedFromStaleUpdate?: boolean;
}

export interface AgentUiMcpStartupNormalizedEvent {
  kind: AgentUiMcpStartupEventKind;
  threadId?: string;
  server?: string;
  state?: AgentUiMcpStartupState;
  error?: string;
  failureReason?: string;
  ready: string[];
  failed: Array<{ server: string; error?: string }>;
  cancelled: string[];
  roundId?: string;
}

export interface AgentUiMcpStartupServerSnapshot {
  server: string;
  state: AgentUiMcpStartupState;
  error?: string;
  failureReason?: string;
}

export interface AgentUiMcpStartupIgnoredUpdate {
  server?: string;
  state?: AgentUiMcpStartupState;
  threadId?: string;
  roundId?: string;
  reason: AgentUiMcpStartupIgnoredReason;
}

export interface AgentUiMcpStartupWarningSnapshot {
  server?: string;
  message: string;
  summary: boolean;
}

export interface AgentUiMcpStartupStatusSnapshot {
  activeThreadId?: string;
  expectedServers: string[];
  activeRoundId?: string;
  completedRoundIds: string[];
  startupActive: boolean;
  activeTurnRunning: boolean;
  taskRunning: boolean;
  startupHeaderActive: boolean;
  statusHeader?: string;
  runtimeStatus: AgentUiRuntimeStatus;
  servers: AgentUiMcpStartupServerSnapshot[];
  ignoredUpdates: AgentUiMcpStartupIgnoredUpdate[];
  warnings: AgentUiMcpStartupWarningSnapshot[];
  assistantItemCount: number;
  observed: AgentUiMcpStartupObservedState;
  validationIssues: AgentUiMcpStartupIssue[];
}

function issue(
  code: AgentUiMcpStartupIssueCode,
  path: string,
  message: string,
): AgentUiMcpStartupIssue {
  return { code, path, message };
}

function recordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => readRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));
}

function readExpectedServers(
  input: AgentUiMcpStartupStatusProjectionInput,
): string[] {
  return normalizeProjectionIdList(readStringArray(input.expectedServers));
}

function normalizeKind(
  value: string | undefined,
): AgentUiMcpStartupEventKind | undefined {
  switch (value) {
    case "mcp_startup_update":
    case "mcpServer/startupStatus/updated":
    case "mcp_server_status_updated":
    case "update":
      return "update";
    case "mcp_startup_complete":
    case "mcpServer/startupStatus/completed":
    case "complete":
      return "complete";
    case "lag_elapsed":
    case "finish_after_lag":
      return "lag_elapsed";
    case "turn_started":
    case "turn.started":
      return "turn_started";
    case "turn_completed":
    case "turn.completed":
    case "turn_failed":
    case "turn.failed":
    case "turn_cancelled":
    case "turn.canceled":
      return "turn_completed";
    default:
      return undefined;
  }
}

function normalizeState(
  value: string | undefined,
): AgentUiMcpStartupState | undefined {
  const normalized = value?.trim().toLowerCase();
  switch (normalized) {
    case "starting":
      return "starting";
    case "ready":
      return "ready";
    case "failed":
      return "failed";
    case "cancelled":
    case "canceled":
      return "cancelled";
    default:
      return undefined;
  }
}

function readStatusRecord(
  record: Record<string, unknown>,
): Record<string, unknown> | undefined {
  return readRecord(record.status) ?? readRecord(record.state);
}

function readEventState(
  record: Record<string, unknown>,
): AgentUiMcpStartupState | undefined {
  const statusRecord = readStatusRecord(record);
  return normalizeState(
    readStringField(statusRecord, ["state", "status"]) ??
      readStringField(record, ["state", "status"]),
  );
}

function readFailureReason(
  record: Record<string, unknown>,
): string | undefined {
  const statusRecord = readStatusRecord(record);
  return (
    readStringField(statusRecord, [
      "reason",
      "failureReason",
      "failure_reason",
    ]) ?? readStringField(record, ["failureReason", "failure_reason", "reason"])
  );
}

function readFailureList(
  value: unknown,
): Array<{ server: string; error?: string }> {
  const failures: Array<{ server: string; error?: string }> = [];
  for (const record of recordArray(value)) {
    const server = readStringField(record, ["server", "name"]);
    if (!server) continue;
    failures.push(
      compactProjectionFields({
        server,
        error: readStringField(record, ["error", "message"]),
      } satisfies { server: string; error?: string }),
    );
  }
  return failures;
}

function normalizeEvent(
  record: Record<string, unknown>,
): AgentUiMcpStartupNormalizedEvent | undefined {
  const kind = normalizeKind(
    readStringField(record, [
      "kind",
      "type",
      "event",
      "eventClass",
      "event_class",
    ]),
  );
  if (!kind) return undefined;
  const statusRecord = readStatusRecord(record);
  return compactProjectionFields({
    kind,
    threadId: readStringField(record, ["threadId", "thread_id"]),
    server: readStringField(record, ["server", "name"]),
    state: readEventState(record),
    error:
      readStringField(statusRecord, ["error", "message"]) ??
      readStringField(record, ["error", "message"]),
    failureReason: readFailureReason(record),
    ready: normalizeProjectionIdList(readStringArray(record.ready)),
    failed: readFailureList(record.failed),
    cancelled: normalizeProjectionIdList([
      ...readStringArray(record.cancelled),
      ...readStringArray(record.canceled),
    ]),
    roundId: readStringField(record, ["roundId", "round_id", "startupRoundId"]),
  } satisfies AgentUiMcpStartupNormalizedEvent);
}

function normalizeEvents(
  input: AgentUiMcpStartupStatusProjectionInput,
): AgentUiMcpStartupNormalizedEvent[] {
  return recordArray(input.events)
    .map(normalizeEvent)
    .filter((event): event is AgentUiMcpStartupNormalizedEvent =>
      Boolean(event),
    );
}

function observedState(
  input: AgentUiMcpStartupStatusProjectionInput,
): AgentUiMcpStartupObservedState {
  const observed = readRecord(input.observed);
  return compactProjectionFields({
    taskRunningAfterStartup: readBooleanField(observed, [
      "taskRunningAfterStartup",
    ]),
    statusHeader: readStringField(observed, ["statusHeader", "header"]),
    appliedOtherThreadUpdate: readBooleanField(observed, [
      "appliedOtherThreadUpdate",
    ]),
    reopenedFromStaleUpdate: readBooleanField(observed, [
      "reopenedFromStaleUpdate",
    ]),
  } satisfies AgentUiMcpStartupObservedState);
}

function assistantItemCount(
  input: AgentUiMcpStartupStatusProjectionInput,
): number {
  return Array.isArray(input.assistantItems) ? input.assistantItems.length : 0;
}

function ignoredUpdate(
  event: AgentUiMcpStartupNormalizedEvent,
  reason: AgentUiMcpStartupIgnoredReason,
): AgentUiMcpStartupIgnoredUpdate {
  return compactProjectionFields({
    server: event.server,
    state: event.state,
    threadId: event.threadId,
    roundId: event.roundId,
    reason,
  } satisfies AgentUiMcpStartupIgnoredUpdate);
}

function serverSnapshots(
  states: ReadonlyMap<string, AgentUiMcpStartupServerSnapshot>,
): AgentUiMcpStartupServerSnapshot[] {
  return Array.from(states.values()).sort((left, right) =>
    left.server.localeCompare(right.server),
  );
}

function startupHeader(
  servers: readonly AgentUiMcpStartupServerSnapshot[],
): string | undefined {
  const starting = servers
    .filter((server) => server.state === "starting")
    .map((server) => server.server)
    .sort();
  if (starting.length === 0) return undefined;
  if (servers.length === 1) return `Booting MCP server: ${starting[0]}`;
  const completed = servers.length - starting.length;
  const listed = starting.slice(0, 3);
  if (starting.length > 3) listed.push("...");
  return `Starting MCP servers (${completed}/${servers.length}): ${listed.join(", ")}`;
}

function addFailureWarning(
  warnings: AgentUiMcpStartupWarningSnapshot[],
  server: string,
  error: string | undefined,
): void {
  const message = error ?? `MCP client for \`${server}\` failed to start`;
  const duplicate = warnings.some(
    (warning) =>
      !warning.summary &&
      warning.server === server &&
      warning.message === message,
  );
  if (!duplicate) {
    warnings.push({ server, message, summary: false });
  }
}

function finishStartup(
  states: Map<string, AgentUiMcpStartupServerSnapshot>,
  expectedServers: readonly string[],
  warnings: AgentUiMcpStartupWarningSnapshot[],
): void {
  const serverNames = new Set([...states.keys(), ...expectedServers]);
  const failed: string[] = [];
  const cancelled: string[] = [];
  for (const server of serverNames) {
    const state = states.get(server)?.state;
    if (state === "failed") failed.push(server);
    if (state === "cancelled" || state === "starting" || !state)
      cancelled.push(server);
  }
  failed.sort();
  cancelled.sort();
  if (cancelled.length > 0) {
    warnings.push({
      message: `MCP startup interrupted. The following servers were not initialized: ${cancelled.join(", ")}`,
      summary: true,
    });
  }
  if (failed.length > 0) {
    warnings.push({
      message: `MCP startup incomplete (failed: ${failed.join(", ")})`,
      summary: true,
    });
  }
  states.clear();
}

function updateServerState(
  states: Map<string, AgentUiMcpStartupServerSnapshot>,
  event: AgentUiMcpStartupNormalizedEvent,
  warnings: AgentUiMcpStartupWarningSnapshot[],
): void {
  if (!event.server || !event.state) return;
  states.set(
    event.server,
    compactProjectionFields({
      server: event.server,
      state: event.state,
      error: event.error,
      failureReason: event.failureReason,
    } satisfies AgentUiMcpStartupServerSnapshot),
  );
  if (event.state === "failed") {
    addFailureWarning(warnings, event.server, event.error);
  }
}

function expectedSettled(
  states: ReadonlyMap<string, AgentUiMcpStartupServerSnapshot>,
  expectedServers: readonly string[],
): boolean {
  return (
    expectedServers.length > 0 &&
    expectedServers.every((server) => states.has(server)) &&
    Array.from(states.values()).every((server) => server.state !== "starting")
  );
}

function applyComplete(
  states: Map<string, AgentUiMcpStartupServerSnapshot>,
  event: AgentUiMcpStartupNormalizedEvent,
  warnings: AgentUiMcpStartupWarningSnapshot[],
): void {
  for (const server of event.ready) {
    states.set(server, { server, state: "ready" });
  }
  for (const failure of event.failed) {
    states.set(
      failure.server,
      compactProjectionFields({
        server: failure.server,
        state: "failed",
        error: failure.error,
      } satisfies AgentUiMcpStartupServerSnapshot),
    );
    addFailureWarning(warnings, failure.server, failure.error);
  }
  for (const server of event.cancelled) {
    states.set(server, { server, state: "cancelled" });
  }
}

function validateSnapshot(
  snapshot: Omit<AgentUiMcpStartupStatusSnapshot, "validationIssues">,
): AgentUiMcpStartupIssue[] {
  const issues: AgentUiMcpStartupIssue[] = [];
  if (!snapshot.activeThreadId) {
    issues.push(
      issue(
        "missing_active_thread",
        "$.activeThreadId",
        "MCP startup projection requires an active thread id.",
      ),
    );
  }
  snapshot.servers.forEach((server, serverIndex) => {
    if (!server.server) {
      issues.push(
        issue(
          "missing_startup_server",
          `$.servers[${serverIndex}].server`,
          "MCP startup update requires a server name.",
        ),
      );
    }
    if (!server.state) {
      issues.push(
        issue(
          "missing_startup_state",
          `$.servers[${serverIndex}].state`,
          "MCP startup update requires a startup state.",
        ),
      );
    }
  });
  snapshot.ignoredUpdates.forEach((ignored, ignoredIndex) => {
    if (ignored.reason === "missing_thread_scope") {
      issues.push(
        issue(
          "missing_update_thread_scope",
          `$.ignoredUpdates[${ignoredIndex}].threadId`,
          "MCP startup status updates must carry thread scope.",
        ),
      );
    }
  });
  if (snapshot.assistantItemCount > 0) {
    issues.push(
      issue(
        "startup_rendered_as_assistant_item",
        "$.assistantItems",
        "MCP startup status must not be rendered as assistant output.",
      ),
    );
  }
  if (snapshot.observed.appliedOtherThreadUpdate) {
    issues.push(
      issue(
        "other_thread_update_applied",
        "$.observed.appliedOtherThreadUpdate",
        "MCP startup updates for another thread must be ignored.",
      ),
    );
  }
  if (
    snapshot.activeTurnRunning &&
    snapshot.observed.taskRunningAfterStartup === false
  ) {
    issues.push(
      issue(
        "startup_complete_cleared_running_task",
        "$.observed.taskRunningAfterStartup",
        "MCP startup completion must not clear an active running turn.",
      ),
    );
  }
  if (
    snapshot.startupActive &&
    snapshot.activeTurnRunning &&
    snapshot.observed.statusHeader &&
    !snapshot.observed.statusHeader.startsWith("Booting MCP server") &&
    !snapshot.observed.statusHeader.startsWith("Starting MCP servers")
  ) {
    issues.push(
      issue(
        "turn_start_replaced_active_startup_header",
        "$.observed.statusHeader",
        "Turn start must preserve an active MCP startup status header.",
      ),
    );
  }
  if (
    !snapshot.startupActive &&
    snapshot.activeTurnRunning &&
    snapshot.warnings.length > 0 &&
    snapshot.observed.statusHeader &&
    (snapshot.observed.statusHeader.startsWith("Booting MCP server") ||
      snapshot.observed.statusHeader.startsWith("Starting MCP servers"))
  ) {
    issues.push(
      issue(
        "startup_complete_did_not_restore_running_header",
        "$.observed.statusHeader",
        "MCP startup completion must restore the active turn status header.",
      ),
    );
  }
  if (snapshot.observed.reopenedFromStaleUpdate) {
    issues.push(
      issue(
        "stale_update_reopened_startup",
        "$.observed.reopenedFromStaleUpdate",
        "Late MCP startup updates from a completed round must not reopen startup.",
      ),
    );
  }
  return issues;
}

function runtimeStatusForSnapshot(
  startupActive: boolean,
  activeTurnRunning: boolean,
  issues: readonly AgentUiMcpStartupIssue[],
): AgentUiRuntimeStatus {
  if (issues.length > 0) return "failed";
  if (startupActive || activeTurnRunning) return "running";
  return "completed";
}

export function extractMcpStartupStatusSnapshot(
  input: AgentUiMcpStartupStatusProjectionInput,
): AgentUiMcpStartupStatusSnapshot {
  const activeThreadId = definedString(input.activeThreadId ?? undefined);
  const expectedServers = readExpectedServers(input);
  const events = normalizeEvents(input);
  const states = new Map<string, AgentUiMcpStartupServerSnapshot>();
  const ignoredUpdates: AgentUiMcpStartupIgnoredUpdate[] = [];
  const warnings: AgentUiMcpStartupWarningSnapshot[] = [];
  const completedRoundIds = new Set<string>();
  let activeRoundId: string | undefined;
  let activeTurnRunning = input.activeTurnRunning === true;

  events.forEach((event) => {
    if (event.kind === "turn_started") {
      activeTurnRunning = true;
      return;
    }
    if (event.kind === "turn_completed") {
      activeTurnRunning = false;
      return;
    }
    if (event.kind === "lag_elapsed") {
      finishStartup(states, expectedServers, warnings);
      if (activeRoundId) completedRoundIds.add(activeRoundId);
      activeRoundId = undefined;
      return;
    }
    if (!event.threadId) {
      ignoredUpdates.push(ignoredUpdate(event, "missing_thread_scope"));
      return;
    }
    if (activeThreadId && event.threadId !== activeThreadId) {
      ignoredUpdates.push(ignoredUpdate(event, "other_thread"));
      return;
    }
    if (event.roundId && completedRoundIds.has(event.roundId)) {
      ignoredUpdates.push(ignoredUpdate(event, "stale_completed_round"));
      return;
    }
    if (event.kind === "complete") {
      applyComplete(states, event, warnings);
      finishStartup(states, expectedServers, warnings);
      if (event.roundId) completedRoundIds.add(event.roundId);
      activeRoundId = undefined;
      return;
    }
    if (event.kind === "update") {
      activeRoundId = event.roundId ?? activeRoundId ?? "implicit";
      updateServerState(states, event, warnings);
      if (expectedSettled(states, expectedServers)) {
        finishStartup(states, expectedServers, warnings);
        if (activeRoundId) completedRoundIds.add(activeRoundId);
        activeRoundId = undefined;
      }
    }
  });

  const servers = serverSnapshots(states);
  const header = startupHeader(servers);
  const startupActive = servers.length > 0;
  const base = {
    activeThreadId,
    expectedServers,
    activeRoundId,
    completedRoundIds: Array.from(completedRoundIds).sort(),
    startupActive,
    activeTurnRunning,
    taskRunning: activeTurnRunning || startupActive,
    startupHeaderActive: Boolean(header),
    statusHeader: header ?? (activeTurnRunning ? "Working" : undefined),
    runtimeStatus: "completed" as AgentUiRuntimeStatus,
    servers,
    ignoredUpdates,
    warnings,
    assistantItemCount: assistantItemCount(input),
    observed: observedState(input),
  };
  const validationIssues = validateSnapshot(base);
  const runtimeStatus = runtimeStatusForSnapshot(
    startupActive,
    activeTurnRunning,
    validationIssues,
  );
  return {
    ...base,
    runtimeStatus,
    validationIssues,
  };
}

export function buildMcpStartupStatusProjectionEvent(
  input: AgentUiMcpStartupStatusProjectionInput,
  context: AgentUiProjectionContext = {},
): AgentUiProjectionEvent {
  const snapshot = extractMcpStartupStatusSnapshot(input);
  return compactProjectionFields({
    type: "context.changed",
    sourceType: "mcp_startup_status_projection",
    sequence: context.sequence,
    timestamp: definedString(input.timestamp ?? undefined) ?? context.timestamp,
    sessionId: definedString(context.sessionId ?? undefined),
    threadId:
      snapshot.activeThreadId ?? definedString(context.threadId ?? undefined),
    runId: definedString(context.runId ?? undefined),
    turnId: definedString(context.turnId ?? undefined),
    owner: "runtime",
    scope: "thread",
    phase:
      snapshot.validationIssues.length > 0
        ? "failed"
        : snapshot.startupActive
          ? "preparing"
          : "completed",
    surface: "runtime_status",
    persistence: "ephemeral_live",
    control: "open_detail",
    runtimeEntity: "agent_turn",
    runtimeStatus: snapshot.runtimeStatus,
    latestTurnStatus: snapshot.activeTurnRunning
      ? "running"
      : snapshot.runtimeStatus,
    payload: {
      mcpStartupEvent: "status",
      activeThreadId: snapshot.activeThreadId,
      expectedServers: snapshot.expectedServers,
      startupActive: snapshot.startupActive,
      activeTurnRunning: snapshot.activeTurnRunning,
      taskRunning: snapshot.taskRunning,
      startupHeaderActive: snapshot.startupHeaderActive,
      statusHeader: snapshot.statusHeader,
      ignoredUpdateCount: snapshot.ignoredUpdates.length,
      warningCount: snapshot.warnings.length,
      mcpStartupStatus: snapshot,
      validationIssues: snapshot.validationIssues,
    },
  } satisfies AgentUiProjectionEvent);
}
