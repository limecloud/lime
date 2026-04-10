import {
  normalizeQueuedTurnSnapshot,
  type QueuedTurnSnapshot,
} from "./queuedTurn";
import {
  normalizeLegacyRuntimeStatusTitle,
  normalizeLegacyThreadItem,
} from "./agentTextNormalization";
import type { AsterTurnOutputSchemaRuntime } from "./agentExecutionRuntime";
import type {
  AsterApprovalPolicy,
  AgentRuntimeSubmitTurnRequest,
  AsterExecutionStrategy,
  AsterSandboxPolicy,
  AutoContinueRequestPayload,
  ImageInput,
} from "./agentRuntime/types";

export interface AgentContextTraceStep {
  stage: string;
  detail: string;
}

export interface AgentToolResultImage {
  src: string;
  mimeType?: string;
  origin?: "data_url" | "tool_payload" | "file_path";
}

export type AgentToolResultMetadata = Record<string, unknown>;

export interface AgentToolExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  images?: AgentToolResultImage[];
  metadata?: AgentToolResultMetadata;
}

export interface AgentMessageContentText {
  type: "text";
  text: string;
}

export interface AgentMessageContentThinking {
  type: "thinking";
  text: string;
}

export interface AgentMessageContentToolRequest {
  type: "tool_request";
  id: string;
  tool_name: string;
  arguments: unknown;
}

export interface AgentMessageContentToolResponse {
  type: "tool_response";
  id: string;
  success: boolean;
  output: string;
  error?: string;
  images?: AgentToolResultImage[];
  metadata?: AgentToolResultMetadata;
}

export interface AgentMessageContentActionRequired {
  type: "action_required";
  id: string;
  action_type: AgentActionRequiredType | string;
  data: unknown;
  scope?: AgentActionRequiredScope;
}

export interface AgentMessageContentImage {
  type: "image";
  mime_type: string;
  data: string;
}

export type AgentMessageContent =
  | AgentMessageContentText
  | AgentMessageContentThinking
  | AgentMessageContentToolRequest
  | AgentMessageContentToolResponse
  | AgentMessageContentActionRequired
  | AgentMessageContentImage;

export interface AgentMessage {
  id?: string;
  role: string;
  content: AgentMessageContent[];
  timestamp: number;
  usage?: AgentTokenUsage;
}

export interface AgentArtifactSignal {
  artifactId: string;
  filePath?: string;
  content?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentTokenUsage {
  input_tokens: number;
  output_tokens: number;
}

export type AgentThreadTurnStatus =
  | "running"
  | "completed"
  | "failed"
  | "aborted";

export type AgentThreadItemStatus = "in_progress" | "completed" | "failed";

export interface AgentThreadTurn {
  id: string;
  thread_id: string;
  prompt_text: string;
  status: AgentThreadTurnStatus;
  started_at: string;
  completed_at?: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
}

export interface AgentRequestOption {
  label: string;
  description?: string;
}

export interface AgentRequestQuestion {
  question: string;
  header?: string;
  options?: AgentRequestOption[];
  multi_select?: boolean;
}

interface AgentThreadItemBase {
  id: string;
  thread_id: string;
  turn_id: string;
  sequence: number;
  status: AgentThreadItemStatus;
  started_at: string;
  completed_at?: string;
  updated_at: string;
}

export interface AgentThreadUserMessageItem extends AgentThreadItemBase {
  type: "user_message";
  content: string;
}

export interface AgentThreadAgentMessageItem extends AgentThreadItemBase {
  type: "agent_message";
  text: string;
  phase?: string;
}

export interface AgentThreadPlanItem extends AgentThreadItemBase {
  type: "plan";
  text: string;
}

export interface AgentThreadReasoningItem extends AgentThreadItemBase {
  type: "reasoning";
  text: string;
  summary?: string[];
}

export interface AgentThreadToolCallItem extends AgentThreadItemBase {
  type: "tool_call";
  tool_name: string;
  arguments?: unknown;
  output?: string;
  success?: boolean;
  error?: string;
  metadata?: unknown;
}

export interface AgentThreadCommandExecutionItem extends AgentThreadItemBase {
  type: "command_execution";
  command: string;
  cwd: string;
  aggregated_output?: string;
  exit_code?: number;
  error?: string;
}

export interface AgentThreadWebSearchItem extends AgentThreadItemBase {
  type: "web_search";
  query?: string;
  action?: string;
  output?: string;
}

export interface AgentThreadApprovalRequestItem extends AgentThreadItemBase {
  type: "approval_request";
  request_id: string;
  action_type: string;
  prompt?: string;
  tool_name?: string;
  arguments?: unknown;
  response?: unknown;
}

export interface AgentThreadRequestUserInputItem extends AgentThreadItemBase {
  type: "request_user_input";
  request_id: string;
  action_type: string;
  prompt?: string;
  questions?: AgentRequestQuestion[];
  response?: unknown;
}

export interface AgentThreadFileArtifactItem extends AgentThreadItemBase {
  type: "file_artifact";
  path: string;
  source: string;
  content?: string;
  metadata?: unknown;
}

export interface AgentThreadSubagentActivityItem extends AgentThreadItemBase {
  type: "subagent_activity";
  status_label: string;
  title?: string;
  summary?: string;
  role?: string;
  model?: string;
  session_id?: string;
}

export interface AgentThreadWarningItem extends AgentThreadItemBase {
  type: "warning";
  message: string;
  code?: string;
}

export interface AgentThreadContextCompactionItem extends AgentThreadItemBase {
  type: "context_compaction";
  stage: "started" | "completed" | string;
  trigger?: string;
  detail?: string;
}

export interface AgentThreadErrorItem extends AgentThreadItemBase {
  type: "error";
  message: string;
}

export interface AgentThreadTurnSummaryItem extends AgentThreadItemBase {
  type: "turn_summary";
  text: string;
}

export type AgentThreadItem =
  | AgentThreadUserMessageItem
  | AgentThreadAgentMessageItem
  | AgentThreadPlanItem
  | AgentThreadReasoningItem
  | AgentThreadToolCallItem
  | AgentThreadCommandExecutionItem
  | AgentThreadWebSearchItem
  | AgentThreadApprovalRequestItem
  | AgentThreadRequestUserInputItem
  | AgentThreadFileArtifactItem
  | AgentThreadSubagentActivityItem
  | AgentThreadWarningItem
  | AgentThreadContextCompactionItem
  | AgentThreadErrorItem
  | AgentThreadTurnSummaryItem;

export interface AgentToolCallState {
  id: string;
  name: string;
  arguments?: string;
  status: "running" | "completed" | "failed";
  result?: AgentToolExecutionResult;
  startTime: Date;
  endTime?: Date;
  logs?: string[];
}

export interface AgentActionRequiredScope {
  session_id?: string;
  thread_id?: string;
  turn_id?: string;
}

export type AgentActionRequiredType =
  | "tool_confirmation"
  | "ask_user"
  | "elicitation";

export interface AgentActionRequiredOption {
  label: string;
  description?: string;
}

export interface AgentActionRequiredQuestion {
  question: string;
  header?: string;
  options?: AgentActionRequiredOption[];
  multiSelect?: boolean;
}

export interface AgentEventTextDelta {
  type: "text_delta";
  text: string;
}

export interface AgentEventThreadStarted {
  type: "thread_started";
  thread_id: string;
}

export interface AgentEventTurnStarted {
  type: "turn_started";
  turn: AgentThreadTurn;
}

export interface AgentEventItemStarted {
  type: "item_started";
  item: AgentThreadItem;
}

export interface AgentEventItemUpdated {
  type: "item_updated";
  item: AgentThreadItem;
}

export interface AgentEventItemCompleted {
  type: "item_completed";
  item: AgentThreadItem;
}

export interface AgentEventTurnCompleted {
  type: "turn_completed";
  turn: AgentThreadTurn;
}

export interface AgentEventTurnFailed {
  type: "turn_failed";
  turn: AgentThreadTurn;
}

export interface AgentEventThinkingDelta {
  type: "thinking_delta";
  text: string;
}

export interface AgentEventToolStart {
  type: "tool_start";
  tool_name: string;
  tool_id: string;
  arguments?: string;
}

export interface AgentEventToolEnd {
  type: "tool_end";
  tool_id: string;
  result: AgentToolExecutionResult;
}

export interface AgentEventArtifactSnapshot {
  type: "artifact_snapshot";
  artifact: AgentArtifactSignal;
}

export interface AgentEventActionRequired {
  type: "action_required";
  request_id: string;
  action_type: AgentActionRequiredType;
  scope?: AgentActionRequiredScope;
  tool_name?: string;
  arguments?: Record<string, unknown>;
  prompt?: string;
  questions?: AgentActionRequiredQuestion[];
  requested_schema?: Record<string, unknown>;
}

export interface AgentEventContextTrace {
  type: "context_trace";
  steps: AgentContextTraceStep[];
}

export interface AgentEventTurnContext {
  type: "turn_context";
  session_id: string;
  thread_id: string;
  turn_id: string;
  output_schema_runtime?: AsterTurnOutputSchemaRuntime | null;
}

export interface AgentEventModelChange {
  type: "model_change";
  model: string;
  mode: string;
}

export interface AgentRuntimeStatusMetadata {
  team_phase?: string;
  team_parallel_budget?: number;
  team_active_count?: number;
  team_queued_count?: number;
  concurrency_phase?: string;
  concurrency_scope?: string;
  concurrency_active_count?: number;
  concurrency_queued_count?: number;
  concurrency_budget?: number;
  provider_concurrency_group?: string;
  provider_parallel_budget?: number;
  queue_reason?: string;
  retryable_overload?: boolean;
}

export interface AgentRuntimeStatusPayload {
  phase: "preparing" | "routing" | "context" | "failed";
  title: string;
  detail: string;
  checkpoints?: string[];
  metadata?: AgentRuntimeStatusMetadata;
}

export interface AgentEventRuntimeStatus {
  type: "runtime_status";
  status: AgentRuntimeStatusPayload;
}

export interface AgentEventQueueAdded {
  type: "queue_added";
  session_id: string;
  queued_turn: QueuedTurnSnapshot;
}

export interface AgentEventQueueRemoved {
  type: "queue_removed";
  session_id: string;
  queued_turn_id: string;
}

export interface AgentEventQueueStarted {
  type: "queue_started";
  session_id: string;
  queued_turn_id: string;
}

export interface AgentEventQueueCleared {
  type: "queue_cleared";
  session_id: string;
  queued_turn_ids: string[];
}

export type AgentSubagentRuntimeStatus =
  | "idle"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "aborted"
  | "closed"
  | "not_found";

export interface AgentEventSubagentStatusChanged {
  type: "subagent_status_changed";
  session_id: string;
  root_session_id: string;
  parent_session_id?: string;
  status: AgentSubagentRuntimeStatus;
}

export interface AgentEventDone {
  type: "done";
  usage?: AgentTokenUsage;
}

export interface AgentEventFinalDone {
  type: "final_done";
  usage?: AgentTokenUsage;
}

export interface AgentEventWarning {
  type: "warning";
  code?: string;
  message: string;
}

export interface AgentEventError {
  type: "error";
  message: string;
}

export type AgentEvent =
  | AgentEventThreadStarted
  | AgentEventTurnStarted
  | AgentEventItemStarted
  | AgentEventItemUpdated
  | AgentEventItemCompleted
  | AgentEventTurnCompleted
  | AgentEventTurnFailed
  | AgentEventTextDelta
  | AgentEventThinkingDelta
  | AgentEventToolStart
  | AgentEventToolEnd
  | AgentEventArtifactSnapshot
  | AgentEventActionRequired
  | AgentEventTurnContext
  | AgentEventModelChange
  | AgentEventContextTrace
  | AgentEventRuntimeStatus
  | AgentEventQueueAdded
  | AgentEventQueueRemoved
  | AgentEventQueueStarted
  | AgentEventQueueCleared
  | AgentEventSubagentStatusChanged
  | AgentEventDone
  | AgentEventFinalDone
  | AgentEventWarning
  | AgentEventError;

export interface AgentUserPreferences {
  providerPreference?: string;
  modelPreference?: string;
  thinking?: boolean;
  webSearch?: boolean;
  approvalPolicy?: AsterApprovalPolicy;
  sandboxPolicy?: AsterSandboxPolicy;
  executionStrategy?: AsterExecutionStrategy;
  autoContinue?: AutoContinueRequestPayload;
}

export interface AgentUserInputOp {
  type: "user_input";
  text: string;
  sessionId: string;
  eventName: string;
  workspaceId?: string;
  turnId?: string;
  images?: ImageInput[];
  preferences?: AgentUserPreferences;
  systemPrompt?: string;
  metadata?: Record<string, unknown>;
  queueIfBusy?: boolean;
  queuedTurnId?: string;
}

export interface AgentInterruptOp {
  type: "interrupt";
  sessionId: string;
  turnId?: string;
}

export interface AgentRetryOp {
  type: "retry";
  sessionId: string;
  turnId: string;
}

export interface AgentConfigUpdateOp {
  type: "config_update";
  sessionId: string;
  key: string;
  value: unknown;
}

export interface AgentShutdownOp {
  type: "shutdown";
  sessionId?: string;
}

export type AgentOp =
  | AgentUserInputOp
  | AgentInterruptOp
  | AgentRetryOp
  | AgentConfigUpdateOp
  | AgentShutdownOp;

function normalizeActionRequiredScope(
  value: unknown,
): AgentActionRequiredScope | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const scope = {
    session_id:
      typeof record.session_id === "string"
        ? record.session_id
        : typeof record.sessionId === "string"
          ? record.sessionId
          : undefined,
    thread_id:
      typeof record.thread_id === "string"
        ? record.thread_id
        : typeof record.threadId === "string"
          ? record.threadId
          : undefined,
    turn_id:
      typeof record.turn_id === "string"
        ? record.turn_id
        : typeof record.turnId === "string"
          ? record.turnId
          : undefined,
  };

  return scope.session_id || scope.thread_id || scope.turn_id
    ? scope
    : undefined;
}

export function parseAgentEvent(data: unknown): AgentEvent | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const event = data as Record<string, unknown>;
  const type = event.type as string;

  switch (type) {
    case "thread_started":
      return {
        type: "thread_started",
        thread_id: (event.thread_id as string) || "",
      };
    case "turn_started":
      return {
        type: "turn_started",
        turn: event.turn as AgentThreadTurn,
      };
    case "item_started":
      return {
        type: "item_started",
        item: normalizeLegacyThreadItem(event.item as AgentThreadItem),
      };
    case "item_updated":
      return {
        type: "item_updated",
        item: normalizeLegacyThreadItem(event.item as AgentThreadItem),
      };
    case "item_completed":
      return {
        type: "item_completed",
        item: normalizeLegacyThreadItem(event.item as AgentThreadItem),
      };
    case "turn_completed":
      return {
        type: "turn_completed",
        turn: event.turn as AgentThreadTurn,
      };
    case "turn_failed":
      return {
        type: "turn_failed",
        turn: event.turn as AgentThreadTurn,
      };
    case "text_delta":
      return {
        type: "text_delta",
        text: (event.text as string) || "",
      };
    case "reasoning_delta":
    case "thinking_delta":
      return {
        type: "thinking_delta",
        text: (event.text as string) || "",
      };
    case "tool_start":
      return {
        type: "tool_start",
        tool_name: (event.tool_name as string) || "",
        tool_id: (event.tool_id as string) || "",
        arguments: event.arguments as string | undefined,
      };
    case "tool_end":
      return {
        type: "tool_end",
        tool_id: (event.tool_id as string) || "",
        result: event.result as AgentToolExecutionResult,
      };
    case "artifact_snapshot":
    case "ArtifactSnapshot": {
      const nestedArtifact =
        event.artifact && typeof event.artifact === "object"
          ? (event.artifact as Record<string, unknown>)
          : undefined;
      return {
        type: "artifact_snapshot",
        artifact: {
          artifactId: String(
            nestedArtifact?.artifactId ||
              nestedArtifact?.artifact_id ||
              event.artifact_id ||
              event.artifactId ||
              event.id ||
              "artifact-unknown",
          ),
          filePath:
            (nestedArtifact?.filePath as string | undefined) ||
            (nestedArtifact?.file_path as string | undefined) ||
            (event.file_path as string | undefined) ||
            (event.filePath as string | undefined),
          content:
            (nestedArtifact?.content as string | undefined) ||
            (event.content as string | undefined),
          metadata:
            (nestedArtifact?.metadata as Record<string, unknown> | undefined) ||
            (event.metadata as Record<string, unknown> | undefined),
        },
      };
    }
    case "action_required": {
      const actionData =
        (event.data as Record<string, unknown> | undefined) || {};
      const requestId =
        (event.request_id as string | undefined) ||
        (actionData.request_id as string | undefined) ||
        (actionData.id as string | undefined) ||
        "";
      const actionType =
        (event.action_type as string | undefined) ||
        (actionData.action_type as string | undefined) ||
        (actionData.type as string | undefined) ||
        "tool_confirmation";

      return {
        type: "action_required",
        request_id: requestId,
        action_type: actionType as AgentActionRequiredType,
        scope: normalizeActionRequiredScope(event.scope ?? actionData.scope),
        tool_name:
          (event.tool_name as string | undefined) ||
          (actionData.tool_name as string | undefined),
        arguments:
          (event.arguments as Record<string, unknown> | undefined) ||
          (actionData.arguments as Record<string, unknown> | undefined),
        prompt:
          (event.prompt as string | undefined) ||
          (actionData.prompt as string | undefined) ||
          (actionData.message as string | undefined),
        questions:
          (event.questions as AgentActionRequiredQuestion[] | undefined) ||
          (actionData.questions as AgentActionRequiredQuestion[] | undefined),
        requested_schema:
          (event.requested_schema as Record<string, unknown> | undefined) ||
          (actionData.requested_schema as Record<string, unknown> | undefined),
      };
    }
    case "turn_context":
      return {
        type: "turn_context",
        session_id: (event.session_id as string) || "",
        thread_id: (event.thread_id as string) || "",
        turn_id: (event.turn_id as string) || "",
        output_schema_runtime:
          (event.output_schema_runtime as
            | AsterTurnOutputSchemaRuntime
            | null
            | undefined) || null,
      };
    case "model_change":
      return {
        type: "model_change",
        model: (event.model as string) || "",
        mode: (event.mode as string) || "",
      };
    case "done":
      return {
        type: "done",
        usage: event.usage as AgentTokenUsage | undefined,
      };
    case "context_trace":
      return {
        type: "context_trace",
        steps: Array.isArray(event.steps)
          ? (event.steps as AgentContextTraceStep[])
          : [],
      };
    case "runtime_status": {
      const status =
        event.status && typeof event.status === "object"
          ? (event.status as Record<string, unknown>)
          : null;
      const metadata =
        status?.metadata && typeof status.metadata === "object"
          ? (status.metadata as Record<string, unknown>)
          : null;
      const phase = status?.phase;
      return {
        type: "runtime_status",
        status: {
          phase:
            phase === "preparing" ||
            phase === "routing" ||
            phase === "context" ||
            phase === "failed"
              ? phase
              : "routing",
          title:
            typeof status?.title === "string"
              ? normalizeLegacyRuntimeStatusTitle(status.title)
              : "",
          detail: typeof status?.detail === "string" ? status.detail : "",
          checkpoints: Array.isArray(status?.checkpoints)
            ? (status?.checkpoints as string[])
            : undefined,
          metadata: metadata
            ? {
                team_phase:
                  typeof metadata.team_phase === "string"
                    ? metadata.team_phase
                    : undefined,
                team_parallel_budget:
                  typeof metadata.team_parallel_budget === "number"
                    ? metadata.team_parallel_budget
                    : undefined,
                team_active_count:
                  typeof metadata.team_active_count === "number"
                    ? metadata.team_active_count
                    : undefined,
                team_queued_count:
                  typeof metadata.team_queued_count === "number"
                    ? metadata.team_queued_count
                    : undefined,
                concurrency_phase:
                  typeof metadata.concurrency_phase === "string"
                    ? metadata.concurrency_phase
                    : undefined,
                concurrency_scope:
                  typeof metadata.concurrency_scope === "string"
                    ? metadata.concurrency_scope
                    : undefined,
                concurrency_active_count:
                  typeof metadata.concurrency_active_count === "number"
                    ? metadata.concurrency_active_count
                    : undefined,
                concurrency_queued_count:
                  typeof metadata.concurrency_queued_count === "number"
                    ? metadata.concurrency_queued_count
                    : undefined,
                concurrency_budget:
                  typeof metadata.concurrency_budget === "number"
                    ? metadata.concurrency_budget
                    : undefined,
                provider_concurrency_group:
                  typeof metadata.provider_concurrency_group === "string"
                    ? metadata.provider_concurrency_group
                    : undefined,
                provider_parallel_budget:
                  typeof metadata.provider_parallel_budget === "number"
                    ? metadata.provider_parallel_budget
                    : undefined,
                queue_reason:
                  typeof metadata.queue_reason === "string"
                    ? metadata.queue_reason
                    : undefined,
                retryable_overload:
                  typeof metadata.retryable_overload === "boolean"
                    ? metadata.retryable_overload
                    : undefined,
              }
            : undefined,
        },
      };
    }
    case "queue_added": {
      const queuedTurn = normalizeQueuedTurnSnapshot(event.queued_turn);
      if (!queuedTurn) {
        return null;
      }
      return {
        type: "queue_added",
        session_id: (event.session_id as string) || "",
        queued_turn: queuedTurn,
      };
    }
    case "queue_removed":
      return {
        type: "queue_removed",
        session_id: (event.session_id as string) || "",
        queued_turn_id: (event.queued_turn_id as string) || "",
      };
    case "queue_started":
      return {
        type: "queue_started",
        session_id: (event.session_id as string) || "",
        queued_turn_id: (event.queued_turn_id as string) || "",
      };
    case "queue_cleared":
      return {
        type: "queue_cleared",
        session_id: (event.session_id as string) || "",
        queued_turn_ids: Array.isArray(event.queued_turn_ids)
          ? (event.queued_turn_ids as string[])
          : [],
      };
    case "subagent_status_changed":
      return {
        type: "subagent_status_changed",
        session_id: (event.session_id as string) || "",
        root_session_id: (event.root_session_id as string) || "",
        parent_session_id: event.parent_session_id as string | undefined,
        status:
          (event.status as AgentSubagentRuntimeStatus | undefined) || "idle",
      };
    case "final_done":
      return {
        type: "final_done",
        usage: event.usage as AgentTokenUsage | undefined,
      };
    case "error":
      return {
        type: "error",
        message: (event.message as string) || "Unknown error",
      };
    case "warning":
      return {
        type: "warning",
        code: event.code as string | undefined,
        message: (event.message as string) || "Unknown warning",
      };
    default:
      return null;
  }
}

export function createSubmitTurnRequestFromAgentOp(
  op: AgentUserInputOp,
): AgentRuntimeSubmitTurnRequest {
  const preferences = op.preferences;

  return {
    message: op.text,
    session_id: op.sessionId,
    event_name: op.eventName,
    ...(op.workspaceId ? { workspace_id: op.workspaceId } : {}),
    turn_id: op.turnId,
    images: op.images,
    turn_config: {
      provider_preference: preferences?.providerPreference,
      model_preference: preferences?.modelPreference,
      thinking_enabled: preferences?.thinking,
      approval_policy: preferences?.approvalPolicy,
      sandbox_policy: preferences?.sandboxPolicy,
      execution_strategy: preferences?.executionStrategy,
      web_search: preferences?.webSearch,
      auto_continue: preferences?.autoContinue,
      system_prompt: op.systemPrompt,
      metadata: op.metadata,
    },
    queue_if_busy: op.queueIfBusy,
    queued_turn_id: op.queuedTurnId,
  };
}
