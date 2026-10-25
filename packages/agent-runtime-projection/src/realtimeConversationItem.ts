import type {
  AgentUiProjectionContext,
  AgentUiProjectionEvent,
  AgentUiRuntimeStatus,
} from "@limecloud/agent-ui-contracts";

import { buildAgentUiProjectionBase } from "./envelope.js";
import {
  compactProjectionFields,
  definedString,
  readBooleanField,
  readRecord,
  readStringField,
  truncateText,
} from "./normalization.js";

export type AgentUiRealtimeFeatureStatus = "not_current" | "current";

export type AgentUiRealtimeEventKind =
  | "started"
  | "item_added"
  | "item_done"
  | "transcript_delta"
  | "transcript_done"
  | "output_audio_delta"
  | "sdp"
  | "error"
  | "closed"
  | "response_created"
  | "response_done"
  | "response_cancelled"
  | "unknown";

export type AgentUiRealtimeIssueCode =
  | "realtime_current_owner_missing"
  | "realtime_event_leaked_to_transcript"
  | "realtime_event_leaked_to_tool"
  | "missing_thread_id"
  | "missing_started_notification"
  | "missing_closed_notification"
  | "missing_realtime_projection_item"
  | "transcript_done_without_delta"
  | "append_only_response_created"
  | "sideband_audio_blocked_by_tool_call";

export interface AgentUiRealtimeIssue {
  code: AgentUiRealtimeIssueCode;
  path: string;
  message: string;
}

export interface AgentUiRealtimeEventSnapshot {
  index: number;
  kind: AgentUiRealtimeEventKind;
  threadId?: string;
  itemId?: string;
  itemType?: string;
  role?: string;
  textPreview?: string;
  responseId?: string;
}

export interface AgentUiRealtimeAppendRequestSnapshot {
  index: number;
  kind: "text" | "audio" | "speech" | "unknown";
  textPreview?: string;
  responseActive: boolean;
  createsResponse: boolean;
}

export interface AgentUiRealtimeConversationProjectionInput {
  featureStatus?: string | null;
  currentOwner?: string | null;
  events?: readonly unknown[];
  projectedRealtimeItems?: readonly unknown[];
  visibleTranscriptItems?: readonly unknown[];
  toolOutputs?: readonly unknown[];
  appendRequests?: readonly unknown[];
  sidebandAudio?: unknown;
}

export interface AgentUiRealtimeConversationSnapshot {
  featureStatus: AgentUiRealtimeFeatureStatus;
  currentOwner?: string;
  eventCount: number;
  eventCounts: Record<AgentUiRealtimeEventKind, number>;
  events: AgentUiRealtimeEventSnapshot[];
  appendRequests: AgentUiRealtimeAppendRequestSnapshot[];
  threadScoped: boolean;
  lifecycleComplete: boolean;
  currentProjectionComplete: boolean;
  appendOnlyTextInput: boolean;
  sidebandAudioNonBlocking: boolean;
  notCurrentLeakFree: boolean;
  validationIssues: AgentUiRealtimeIssue[];
}

function issue(
  code: AgentUiRealtimeIssueCode,
  path: string,
  message: string,
): AgentUiRealtimeIssue {
  return { code, path, message };
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function featureStatus(
  value: string | null | undefined,
): AgentUiRealtimeFeatureStatus {
  return value === "current" ? "current" : "not_current";
}

function methodOf(record: Record<string, unknown>): string {
  return (
    readStringField(record, ["method", "event", "type"]) ??
    readStringField(readRecord(record.params), ["method", "event", "type"]) ??
    ""
  );
}

function normalizeKind(method: string): AgentUiRealtimeEventKind {
  switch (method) {
    case "thread/realtime/started":
    case "realtime.started":
      return "started";
    case "thread/realtime/itemAdded":
    case "conversation.item.added":
    case "conversation.item.created":
      return "item_added";
    case "conversation.item.done":
      return "item_done";
    case "thread/realtime/transcript/delta":
    case "conversation.item.input_audio_transcription.delta":
    case "response.output_text.delta":
    case "response.output_audio_transcript.delta":
      return "transcript_delta";
    case "thread/realtime/transcript/done":
    case "conversation.item.input_audio_transcription.completed":
    case "response.output_text.done":
    case "response.output_audio_transcript.done":
      return "transcript_done";
    case "thread/realtime/outputAudio/delta":
    case "response.output_audio.delta":
    case "response.audio.delta":
      return "output_audio_delta";
    case "thread/realtime/sdp":
      return "sdp";
    case "thread/realtime/error":
    case "error":
      return "error";
    case "thread/realtime/closed":
      return "closed";
    case "response.created":
      return "response_created";
    case "response.done":
      return "response_done";
    case "response.cancelled":
      return "response_cancelled";
    default:
      return "unknown";
  }
}

function paramsRecord(
  record: Record<string, unknown>,
): Record<string, unknown> {
  return readRecord(record.params) ?? record;
}

function itemRecord(
  record: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const params = paramsRecord(record);
  return readRecord(params.item) ?? readRecord(record.item);
}

function threadIdOf(record: Record<string, unknown>): string | undefined {
  const params = paramsRecord(record);
  return (
    readStringField(params, ["threadId", "thread_id"]) ??
    readStringField(record, ["threadId", "thread_id"])
  );
}

function textOf(record: Record<string, unknown>): string | undefined {
  const params = paramsRecord(record);
  const item = itemRecord(record);
  return (
    readStringField(params, ["delta", "text", "transcript", "message"]) ??
    readStringField(record, ["delta", "text", "transcript", "message"]) ??
    readStringField(item, ["text", "transcript", "input_transcript"])
  );
}

function responseIdOf(record: Record<string, unknown>): string | undefined {
  const params = paramsRecord(record);
  const response = readRecord(params.response) ?? readRecord(record.response);
  return (
    readStringField(response, ["id"]) ??
    readStringField(params, ["responseId", "response_id"]) ??
    readStringField(record, ["responseId", "response_id"])
  );
}

function eventSnapshot(
  value: unknown,
  index: number,
): AgentUiRealtimeEventSnapshot | undefined {
  const record = readRecord(value);
  if (!record) return undefined;
  const item = itemRecord(record);
  const kind = normalizeKind(methodOf(record));
  return compactProjectionFields({
    index,
    kind,
    threadId: threadIdOf(record),
    itemId:
      readStringField(item, ["id", "itemId", "item_id"]) ??
      readStringField(paramsRecord(record), ["itemId", "item_id"]),
    itemType: readStringField(item, ["type"]),
    role:
      readStringField(paramsRecord(record), ["role"]) ??
      readStringField(item, ["role"]),
    textPreview: truncateText(textOf(record)),
    responseId: responseIdOf(record),
  } satisfies AgentUiRealtimeEventSnapshot);
}

function appendKind(
  record: Record<string, unknown>,
): "text" | "audio" | "speech" | "unknown" {
  const kind = readStringField(record, ["kind", "type", "method"]);
  if (!kind) return "unknown";
  if (kind.includes("audio")) return "audio";
  if (kind.includes("speech")) return "speech";
  if (kind.includes("text")) return "text";
  return "unknown";
}

function appendSnapshot(
  value: unknown,
  index: number,
): AgentUiRealtimeAppendRequestSnapshot | undefined {
  const record = readRecord(value);
  if (!record) return undefined;
  return compactProjectionFields({
    index,
    kind: appendKind(record),
    textPreview: truncateText(readStringField(record, ["text", "input"])),
    responseActive:
      readBooleanField(record, ["responseActive", "response_active"]) === true,
    createsResponse:
      readBooleanField(record, [
        "createsResponse",
        "creates_response",
        "requestResponse",
        "request_response",
      ]) === true,
  } satisfies AgentUiRealtimeAppendRequestSnapshot);
}

function eventCounts(
  events: readonly AgentUiRealtimeEventSnapshot[],
): Record<AgentUiRealtimeEventKind, number> {
  const counts = {
    started: 0,
    item_added: 0,
    item_done: 0,
    transcript_delta: 0,
    transcript_done: 0,
    output_audio_delta: 0,
    sdp: 0,
    error: 0,
    closed: 0,
    response_created: 0,
    response_done: 0,
    response_cancelled: 0,
    unknown: 0,
  };
  for (const event of events) {
    counts[event.kind] += 1;
  }
  return counts;
}

function hasRealtimeLeak(value: unknown): boolean {
  return readArray(value).some((entry) => {
    if (typeof entry === "string") {
      return /realtime|conversation\.item|response\.output_|thread\/realtime/i.test(
        entry,
      );
    }
    const record = readRecord(entry);
    if (!record) return false;
    const type = methodOf(record);
    const text = [
      type,
      readStringField(record, ["text", "title", "label", "body"]),
      readStringField(readRecord(record.payload), [
        "text",
        "title",
        "label",
        "body",
      ]),
    ]
      .filter(Boolean)
      .join(" ");
    return /realtime|conversation\.item|response\.output_|thread\/realtime/i.test(
      text,
    );
  });
}

function projectedRealtimeItemCount(value: unknown): number {
  return readArray(value).filter((entry) => {
    const record = readRecord(entry);
    if (!record) return false;
    const type = readStringField(record, ["type", "kind", "itemType"]);
    return Boolean(type && /realtime/i.test(type));
  }).length;
}

function sidebandAudioNonBlocking(value: unknown): boolean {
  const record = readRecord(value);
  if (!record) return true;
  const toolCallActive =
    readBooleanField(record, ["toolCallActive", "tool_call_active"]) === true;
  if (!toolCallActive) return true;
  return (
    readBooleanField(record, [
      "audioForwardedBeforeToolComplete",
      "audio_forwarded_before_tool_complete",
      "audioForwarded",
      "audio_forwarded",
    ]) === true
  );
}

function validateSnapshot(
  snapshot: Omit<AgentUiRealtimeConversationSnapshot, "validationIssues">,
  input: AgentUiRealtimeConversationProjectionInput,
): AgentUiRealtimeIssue[] {
  const issues: AgentUiRealtimeIssue[] = [];
  if (
    snapshot.featureStatus === "not_current" &&
    snapshot.eventCount > 0 &&
    !snapshot.currentOwner
  ) {
    issues.push(
      issue(
        "realtime_current_owner_missing",
        "$.currentOwner",
        "Realtime events are not current in Lime unless an explicit current owner is declared.",
      ),
    );
  }
  if (
    snapshot.featureStatus === "not_current" &&
    hasRealtimeLeak(input.visibleTranscriptItems)
  ) {
    issues.push(
      issue(
        "realtime_event_leaked_to_transcript",
        "$.visibleTranscriptItems",
        "Not-current realtime events must not leak into the ordinary transcript.",
      ),
    );
  }
  if (
    snapshot.featureStatus === "not_current" &&
    hasRealtimeLeak(input.toolOutputs)
  ) {
    issues.push(
      issue(
        "realtime_event_leaked_to_tool",
        "$.toolOutputs",
        "Not-current realtime events must not masquerade as ordinary tool output.",
      ),
    );
  }
  snapshot.events.forEach((event) => {
    if (event.kind !== "unknown" && !event.threadId) {
      issues.push(
        issue(
          "missing_thread_id",
          `$.events[${event.index}].threadId`,
          "Realtime notifications must stay thread-scoped.",
        ),
      );
    }
  });
  if (snapshot.featureStatus === "current" && snapshot.eventCount > 0) {
    if (snapshot.eventCounts.started === 0) {
      issues.push(
        issue(
          "missing_started_notification",
          "$.events",
          "Current realtime projection requires thread/realtime/started.",
        ),
      );
    }
    if (snapshot.eventCounts.closed === 0) {
      issues.push(
        issue(
          "missing_closed_notification",
          "$.events",
          "Current realtime projection requires thread/realtime/closed.",
        ),
      );
    }
    if (!snapshot.currentProjectionComplete) {
      issues.push(
        issue(
          "missing_realtime_projection_item",
          "$.projectedRealtimeItems",
          "Current realtime events must project into realtime Thread/Turn/Item items.",
        ),
      );
    }
    if (
      snapshot.eventCounts.transcript_done > 0 &&
      snapshot.eventCounts.transcript_delta === 0
    ) {
      issues.push(
        issue(
          "transcript_done_without_delta",
          "$.events",
          "Realtime transcript done must remain paired with transcript delta lineage.",
        ),
      );
    }
  }
  snapshot.appendRequests.forEach((request) => {
    if (
      request.kind === "text" &&
      request.responseActive &&
      request.createsResponse
    ) {
      issues.push(
        issue(
          "append_only_response_created",
          `$.appendRequests[${request.index}]`,
          "Realtime V2 text input while a response is active must append only and not request a new response.",
        ),
      );
    }
  });
  if (!snapshot.sidebandAudioNonBlocking) {
    issues.push(
      issue(
        "sideband_audio_blocked_by_tool_call",
        "$.sidebandAudio",
        "Sideband realtime audio must continue while delegated tool calls are active.",
      ),
    );
  }
  return issues;
}

function runtimeStatus(
  issues: readonly AgentUiRealtimeIssue[],
): AgentUiRuntimeStatus {
  return issues.length > 0 ? "failed" : "completed";
}

export function extractRealtimeConversationSnapshot(
  input: AgentUiRealtimeConversationProjectionInput,
): AgentUiRealtimeConversationSnapshot {
  const status = featureStatus(input.featureStatus ?? undefined);
  const currentOwner = definedString(input.currentOwner ?? undefined);
  const events = readArray(input.events)
    .map(eventSnapshot)
    .filter((entry): entry is AgentUiRealtimeEventSnapshot => Boolean(entry));
  const appendRequests = readArray(input.appendRequests)
    .map(appendSnapshot)
    .filter((entry): entry is AgentUiRealtimeAppendRequestSnapshot =>
      Boolean(entry),
    );
  const counts = eventCounts(events);
  const threadScoped = events.every(
    (event) => event.kind === "unknown" || Boolean(event.threadId),
  );
  const lifecycleComplete =
    events.length === 0 || (counts.started > 0 && counts.closed > 0);
  const currentProjectionComplete =
    status !== "current" ||
    events.length === 0 ||
    projectedRealtimeItemCount(input.projectedRealtimeItems) > 0;
  const appendOnlyTextInput = appendRequests.every(
    (request) =>
      request.kind !== "text" ||
      !request.responseActive ||
      !request.createsResponse,
  );
  const nonBlocking = sidebandAudioNonBlocking(input.sidebandAudio);
  const notCurrentLeakFree =
    status === "current" ||
    (!hasRealtimeLeak(input.visibleTranscriptItems) &&
      !hasRealtimeLeak(input.toolOutputs));
  const partial = {
    featureStatus: status,
    currentOwner,
    eventCount: events.length,
    eventCounts: counts,
    events,
    appendRequests,
    threadScoped,
    lifecycleComplete,
    currentProjectionComplete,
    appendOnlyTextInput,
    sidebandAudioNonBlocking: nonBlocking,
    notCurrentLeakFree,
  };
  const validationIssues = validateSnapshot(partial, input);
  return {
    ...partial,
    validationIssues,
  };
}

export function buildRealtimeConversationProjectionEvent(
  input: AgentUiRealtimeConversationProjectionInput,
  context: AgentUiProjectionContext = {},
): AgentUiProjectionEvent {
  const snapshot = extractRealtimeConversationSnapshot(input);
  return {
    ...buildAgentUiProjectionBase(
      { sourceType: "realtime_conversation_item_projection" },
      context,
    ),
    type: "state.snapshot",
    sequence: context.sequence,
    owner: "runtime",
    scope: "thread",
    phase: snapshot.featureStatus === "current" ? "completed" : "archived",
    surface: "runtime_status",
    persistence: "snapshot",
    runtimeEntity: "agent_turn",
    runtimeStatus: runtimeStatus(snapshot.validationIssues),
    payload: {
      featureStatus: snapshot.featureStatus,
      currentOwner: snapshot.currentOwner,
      eventCount: snapshot.eventCount,
      eventCounts: snapshot.eventCounts,
      events: snapshot.events,
      appendRequests: snapshot.appendRequests,
      threadScoped: snapshot.threadScoped,
      lifecycleComplete: snapshot.lifecycleComplete,
      currentProjectionComplete: snapshot.currentProjectionComplete,
      appendOnlyTextInput: snapshot.appendOnlyTextInput,
      sidebandAudioNonBlocking: snapshot.sidebandAudioNonBlocking,
      notCurrentLeakFree: snapshot.notCurrentLeakFree,
      validationIssues: snapshot.validationIssues,
    },
    refs:
      snapshot.validationIssues.length > 0
        ? {
            diagnosticKeys: snapshot.validationIssues.map(
              (entry) => entry.code,
            ),
          }
        : undefined,
  };
}
