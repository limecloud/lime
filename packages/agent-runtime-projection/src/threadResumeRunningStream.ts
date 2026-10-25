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
  readStringField,
} from "./normalization.js";

export type AgentUiThreadResumeRunningStreamIssueCode =
  | "missing_running_turn"
  | "resume_thread_not_loaded"
  | "running_turn_missing_from_resume_page"
  | "running_turn_completed_on_resume"
  | "running_turn_items_fully_loaded"
  | "live_stream_not_bound"
  | "stream_thread_mismatch"
  | "stream_turn_mismatch"
  | "history_override_allowed_while_running"
  | "override_model_applied_to_running_thread"
  | "override_cwd_applied_to_running_thread"
  | "shadow_session_created";

export interface AgentUiThreadResumeRunningStreamIssue {
  code: AgentUiThreadResumeRunningStreamIssueCode;
  path: string;
  message: string;
}

export interface AgentUiThreadResumeRunningStreamProjectionInput {
  threadId?: string | null;
  runningTurn?: unknown;
  resumeRequest?: unknown;
  resumeResponse?: unknown;
  initialTurnsPage?: unknown;
  streamBindings?: unknown;
  shadowSessions?: unknown;
  timestamp?: string | null;
}

export interface AgentUiRunningTurnSnapshot {
  id: string;
  status?: string;
  itemsView?: string;
}

export interface AgentUiThreadResumeRequestSnapshot {
  threadId?: string;
  requestedModel?: string;
  requestedCwd?: string;
  historyOverride: boolean;
  initialTurnsRequested: boolean;
}

export interface AgentUiThreadResumeResponseSnapshot {
  threadId?: string;
  status?: string;
  effectiveModel?: string;
  effectiveCwd?: string;
  notLoaded: boolean;
}

export interface AgentUiResumePageTurnSnapshot {
  id: string;
  status?: string;
  itemsView?: string;
}

export interface AgentUiLiveStreamBindingSnapshot {
  bindingId?: string;
  threadId?: string;
  turnId?: string;
  active: boolean;
  source?: string;
}

export interface AgentUiThreadResumeRunningStreamSnapshot {
  threadId?: string;
  runningTurn?: AgentUiRunningTurnSnapshot;
  resumeRequest: AgentUiThreadResumeRequestSnapshot;
  resumeResponse: AgentUiThreadResumeResponseSnapshot;
  resumePageTurns: AgentUiResumePageTurnSnapshot[];
  streamBindings: AgentUiLiveStreamBindingSnapshot[];
  shadowSessionIds: string[];
  activeStreamBound: boolean;
  resumeUsesRunningThread: boolean;
  historyOverrideBlocked: boolean;
  validationIssues: AgentUiThreadResumeRunningStreamIssue[];
}

function issue(
  code: AgentUiThreadResumeRunningStreamIssueCode,
  path: string,
  message: string,
): AgentUiThreadResumeRunningStreamIssue {
  return { code, path, message };
}

function recordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => readRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));
}

function normalizeStatus(value: string | undefined): string | undefined {
  return (
    value
      ?.trim()
      .toLowerCase()
      .replace(/[_\s-]+/g, "_") || undefined
  );
}

function normalizeItemsView(value: string | undefined): string | undefined {
  return (
    value
      ?.trim()
      .toLowerCase()
      .replace(/[_\s-]+/g, "_") || undefined
  );
}

function isCompletedStatus(status: string | undefined): boolean {
  return (
    status === "completed" ||
    status === "complete" ||
    status === "finished" ||
    status === "idle"
  );
}

function readTurn(value: unknown): AgentUiRunningTurnSnapshot | undefined {
  const record = readRecord(value);
  const id = readStringField(record, ["id", "turnId", "turn_id"]);
  if (!id) return undefined;
  return compactProjectionFields({
    id,
    status: normalizeStatus(
      readStringField(record, ["status", "turnStatus", "turn_status"]),
    ),
    itemsView: normalizeItemsView(
      readStringField(record, ["itemsView", "items_view"]),
    ),
  } satisfies AgentUiRunningTurnSnapshot);
}

function readResumeRequest(
  input: AgentUiThreadResumeRunningStreamProjectionInput,
): AgentUiThreadResumeRequestSnapshot {
  const record = readRecord(input.resumeRequest) ?? {};
  return {
    threadId:
      readStringField(record, ["threadId", "thread_id"]) ??
      input.threadId ??
      undefined,
    requestedModel: readStringField(record, [
      "model",
      "requestedModel",
      "requested_model",
    ]),
    requestedCwd: readStringField(record, [
      "cwd",
      "path",
      "requestedCwd",
      "requested_cwd",
    ]),
    historyOverride:
      Boolean(record.history) ||
      readBooleanField(record, ["historyOverride", "history_override"]) ===
        true,
    initialTurnsRequested: Boolean(
      record.initialTurnsPage ?? record.initial_turns_page,
    ),
  };
}

function readResumeResponse(
  input: AgentUiThreadResumeRunningStreamProjectionInput,
): AgentUiThreadResumeResponseSnapshot {
  const record = readRecord(input.resumeResponse) ?? {};
  const thread = readRecord(record.thread) ?? record;
  const status = normalizeStatus(
    readStringField(thread, ["status", "threadStatus", "thread_status"]),
  );
  return {
    threadId:
      readStringField(thread, ["id", "threadId", "thread_id"]) ??
      readStringField(record, ["threadId", "thread_id"]),
    status,
    effectiveModel: readStringField(record, [
      "model",
      "effectiveModel",
      "effective_model",
    ]),
    effectiveCwd: readStringField(record, [
      "cwd",
      "effectiveCwd",
      "effective_cwd",
    ]),
    notLoaded: status === "not_loaded" || status === "notloaded",
  };
}

function readPageTurns(
  input: AgentUiThreadResumeRunningStreamProjectionInput,
): AgentUiResumePageTurnSnapshot[] {
  const explicit = recordArray(input.initialTurnsPage);
  const response = readRecord(input.resumeResponse);
  const responsePage = readRecord(
    response?.initialTurnsPage ?? response?.initial_turns_page,
  );
  const records =
    explicit.length > 0 ? explicit : recordArray(responsePage?.data);
  return records
    .map(readTurn)
    .filter((turn): turn is AgentUiResumePageTurnSnapshot => Boolean(turn));
}

function readStreamBindings(
  input: AgentUiThreadResumeRunningStreamProjectionInput,
): AgentUiLiveStreamBindingSnapshot[] {
  return recordArray(input.streamBindings).map((record) =>
    compactProjectionFields({
      bindingId: readStringField(record, ["bindingId", "binding_id", "id"]),
      threadId: readStringField(record, ["threadId", "thread_id"]),
      turnId: readStringField(record, ["turnId", "turn_id"]),
      active:
        readBooleanField(record, ["active", "bound", "listening"]) ?? false,
      source: readStringField(record, ["source", "client", "owner"]),
    } satisfies AgentUiLiveStreamBindingSnapshot),
  );
}

function readShadowSessionIds(value: unknown): string[] {
  return recordArray(value)
    .map((record) =>
      readStringField(record, [
        "id",
        "sessionId",
        "session_id",
        "threadId",
        "thread_id",
      ]),
    )
    .filter((id): id is string => Boolean(id));
}

function validateSnapshot(
  snapshot: Omit<AgentUiThreadResumeRunningStreamSnapshot, "validationIssues">,
): AgentUiThreadResumeRunningStreamIssue[] {
  const issues: AgentUiThreadResumeRunningStreamIssue[] = [];
  const runningTurn = snapshot.runningTurn;
  const threadId = snapshot.threadId ?? snapshot.resumeRequest.threadId;

  if (!runningTurn) {
    issues.push(
      issue(
        "missing_running_turn",
        "$.runningTurn",
        "Running thread resume requires the in-flight turn id and status.",
      ),
    );
    return issues;
  }

  if (snapshot.resumeResponse.notLoaded) {
    issues.push(
      issue(
        "resume_thread_not_loaded",
        "$.resumeResponse.thread.status",
        "Running thread resume must return a loaded thread, not NotLoaded.",
      ),
    );
  }

  const resumedTurn = snapshot.resumePageTurns.find(
    (turn) => turn.id === runningTurn.id,
  );
  if (!resumedTurn) {
    issues.push(
      issue(
        "running_turn_missing_from_resume_page",
        "$.initialTurnsPage.data",
        "Resume initial page must include the active running turn.",
      ),
    );
  } else {
    if (isCompletedStatus(resumedTurn.status)) {
      issues.push(
        issue(
          "running_turn_completed_on_resume",
          "$.initialTurnsPage.data[].status",
          "In-flight turns must remain running on resume instead of being marked completed.",
        ),
      );
    }
    if (
      resumedTurn.itemsView === "full" ||
      resumedTurn.itemsView === "loaded"
    ) {
      issues.push(
        issue(
          "running_turn_items_fully_loaded",
          "$.initialTurnsPage.data[].itemsView",
          "In-flight turn items must stay summary/not-loaded until the live stream completes.",
        ),
      );
    }
  }

  if (snapshot.resumeRequest.historyOverride) {
    issues.push(
      issue(
        "history_override_allowed_while_running",
        "$.resumeRequest.history",
        "Running thread resume must reject history override instead of merging it.",
      ),
    );
  }

  if (
    snapshot.resumeRequest.requestedModel &&
    snapshot.resumeResponse.effectiveModel ===
      snapshot.resumeRequest.requestedModel
  ) {
    issues.push(
      issue(
        "override_model_applied_to_running_thread",
        "$.resumeResponse.model",
        "Running thread resume must keep the active thread model instead of applying override model.",
      ),
    );
  }
  if (
    snapshot.resumeRequest.requestedCwd &&
    snapshot.resumeResponse.effectiveCwd === snapshot.resumeRequest.requestedCwd
  ) {
    issues.push(
      issue(
        "override_cwd_applied_to_running_thread",
        "$.resumeResponse.cwd",
        "Running thread resume must keep the active thread cwd instead of applying override cwd.",
      ),
    );
  }

  const activeBindings = snapshot.streamBindings.filter(
    (binding) => binding.active,
  );
  if (activeBindings.length === 0) {
    issues.push(
      issue(
        "live_stream_not_bound",
        "$.streamBindings",
        "Running thread resume must bind the client to the active live stream.",
      ),
    );
  }
  activeBindings.forEach((binding, index) => {
    if (threadId && binding.threadId !== threadId) {
      issues.push(
        issue(
          "stream_thread_mismatch",
          `$.streamBindings[${index}].threadId`,
          "Live stream binding thread id must match the resumed thread.",
        ),
      );
    }
    if (binding.turnId !== runningTurn.id) {
      issues.push(
        issue(
          "stream_turn_mismatch",
          `$.streamBindings[${index}].turnId`,
          "Live stream binding turn id must match the active running turn.",
        ),
      );
    }
  });

  if (snapshot.shadowSessionIds.length > 0) {
    issues.push(
      issue(
        "shadow_session_created",
        "$.shadowSessions",
        "Running resume must rejoin the active thread instead of creating a shadow session.",
      ),
    );
  }

  return issues;
}

function runtimeStatus(
  issues: readonly AgentUiThreadResumeRunningStreamIssue[],
): AgentUiRuntimeStatus {
  return issues.length > 0 ? "failed" : "completed";
}

export function extractThreadResumeRunningStreamSnapshot(
  input: AgentUiThreadResumeRunningStreamProjectionInput,
): AgentUiThreadResumeRunningStreamSnapshot {
  const runningTurn = readTurn(input.runningTurn);
  const resumeRequest = readResumeRequest(input);
  const resumeResponse = readResumeResponse(input);
  const resumePageTurns = readPageTurns(input);
  const streamBindings = readStreamBindings(input);
  const threadId = definedString(
    input.threadId ?? resumeResponse.threadId ?? resumeRequest.threadId,
  );
  const base = {
    threadId,
    runningTurn,
    resumeRequest,
    resumeResponse,
    resumePageTurns,
    streamBindings,
    shadowSessionIds: readShadowSessionIds(input.shadowSessions),
    activeStreamBound: streamBindings.some(
      (binding) =>
        binding.active &&
        binding.threadId === threadId &&
        (!runningTurn || binding.turnId === runningTurn.id),
    ),
    resumeUsesRunningThread:
      Boolean(threadId && resumeResponse.threadId === threadId) &&
      !resumeResponse.notLoaded,
    historyOverrideBlocked: !resumeRequest.historyOverride,
  };
  return {
    ...base,
    validationIssues: validateSnapshot(base),
  };
}

export function buildThreadResumeRunningStreamProjectionEvent(
  input: AgentUiThreadResumeRunningStreamProjectionInput,
  context: AgentUiProjectionContext = {},
): AgentUiProjectionEvent {
  const snapshot = extractThreadResumeRunningStreamSnapshot(input);
  const status = runtimeStatus(snapshot.validationIssues);
  return compactProjectionFields({
    type: "context.changed",
    sourceType: "thread_resume_running_stream_projection",
    sequence: context.sequence,
    timestamp: definedString(input.timestamp ?? undefined) ?? context.timestamp,
    sessionId: definedString(context.sessionId ?? undefined),
    threadId: snapshot.threadId ?? definedString(context.threadId ?? undefined),
    runId: definedString(context.runId ?? undefined),
    turnId:
      snapshot.runningTurn?.id ?? definedString(context.turnId ?? undefined),
    owner: "context",
    scope: "thread",
    phase: snapshot.validationIssues.length > 0 ? "failed" : "producing",
    surface: "timeline_evidence",
    persistence: "snapshot",
    control: "open_detail",
    runtimeEntity: "agent_turn",
    runtimeStatus: status === "failed" ? "failed" : "running",
    latestTurnStatus: status === "failed" ? "failed" : "running",
    payload: {
      threadResumeRunningStreamEvent: "running_resume_snapshot",
      runningTurnId: snapshot.runningTurn?.id,
      activeStreamBound: snapshot.activeStreamBound,
      resumeUsesRunningThread: snapshot.resumeUsesRunningThread,
      historyOverrideBlocked: snapshot.historyOverrideBlocked,
      streamBindingCount: snapshot.streamBindings.length,
      threadResumeRunningStream: snapshot,
      validationIssues: snapshot.validationIssues,
    },
  } satisfies AgentUiProjectionEvent);
}
