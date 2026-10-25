import type {
  AgentEvent,
  AgentEventActionRequired,
  AgentEventActionResolved,
  AgentEventToolEnd,
  AgentEventToolInputDelta,
  AgentEventToolOutputDelta,
  AgentEventToolProgress,
  AgentEventToolStart,
  AgentThreadItem,
} from "@/lib/api/agentProtocol";

interface ProjectTimelineItemContext {
  activeSessionId: string;
  fallbackTurnId?: string | null;
  now: string;
}

const LEGACY_TOOL_EVENT_SOURCE = "legacy_tool_event";

function normalizeRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(
  record: Record<string, unknown> | undefined,
  ...keys: string[]
): string | undefined {
  if (!record) {
    return undefined;
  }
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function normalizeToolArguments(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const text = value.trim();
  if (!text) {
    return value;
  }
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

function legacyToolEventMetadata(
  ...records: Array<Record<string, unknown> | undefined>
): Record<string, unknown> {
  return {
    ...records.reduce<Record<string, unknown>>(
      (merged, record) => (record ? { ...merged, ...record } : merged),
      {},
    ),
    runtime_event_source: LEGACY_TOOL_EVENT_SOURCE,
  };
}

function appendTextWithOverlap(
  base: string | undefined,
  delta: string,
): string {
  if (!base) {
    return delta;
  }
  if (!delta || base.endsWith(delta)) {
    return base;
  }
  const maxOverlap = Math.min(base.length, delta.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (base.endsWith(delta.slice(0, overlap))) {
      return `${base}${delta.slice(overlap)}`;
    }
  }
  return `${base}${delta}`;
}

function resolveTurnId(
  context: ProjectTimelineItemContext,
  scope?: { turn_id?: string },
): string {
  return scope?.turn_id?.trim() || context.fallbackTurnId?.trim() || "";
}

function sequenceFromEvent(event: AgentEvent): number {
  const sequence = (event as { sequence?: unknown }).sequence;
  return typeof sequence === "number" && Number.isFinite(sequence)
    ? sequence
    : Number.MAX_SAFE_INTEGER;
}

function timestampFromEvent(
  event: AgentEvent,
  context: ProjectTimelineItemContext,
): string {
  return typeof (event as { timestamp?: unknown }).timestamp === "string"
    ? (event as { timestamp: string }).timestamp || context.now
    : context.now;
}

function baseItem(
  event: AgentEvent,
  context: ProjectTimelineItemContext,
  params: {
    id: string;
    status: AgentThreadItem["status"];
    type: AgentThreadItem["type"];
    turnId?: string;
  },
): AgentThreadItem {
  const timestamp = timestampFromEvent(event, context);
  return {
    id: params.id,
    thread_id: activeThreadId(event, context),
    turn_id:
      params.turnId ||
      readString(
        event as unknown as Record<string, unknown>,
        "turn_id",
        "turnId",
      ) ||
      resolveTurnId(context),
    sequence: sequenceFromEvent(event),
    status: params.status,
    started_at: timestamp,
    updated_at: timestamp,
    ...(params.status === "in_progress" ? {} : { completed_at: timestamp }),
    type: params.type,
  } as AgentThreadItem;
}

function activeThreadId(
  event: AgentEvent,
  context: ProjectTimelineItemContext,
): string {
  return (
    readString(event as unknown as Record<string, unknown>, "thread_id") ||
    context.activeSessionId
  );
}

function mergeBaseItem(
  existing: AgentThreadItem | undefined,
  next: AgentThreadItem,
): AgentThreadItem {
  if (!existing || existing.type !== next.type) {
    return next;
  }
  return {
    ...existing,
    ...next,
    sequence: Math.min(existing.sequence, next.sequence),
    started_at: existing.started_at || next.started_at,
    completed_at: next.completed_at || existing.completed_at,
    updated_at: next.updated_at || existing.updated_at,
  } as AgentThreadItem;
}

function projectToolStart(
  event: AgentEventToolStart,
  context: ProjectTimelineItemContext,
  existing?: AgentThreadItem,
): AgentThreadItem {
  const item = baseItem(event, context, {
    id: event.tool_id,
    status: "in_progress",
    type: "tool_call",
  });
  return {
    ...mergeBaseItem(existing, item),
    type: "tool_call",
    tool_name: event.tool_name,
    arguments: normalizeToolArguments(event.arguments),
    metadata: legacyToolEventMetadata(
      normalizeRecord(existing?.metadata),
      normalizeRecord(event.metadata),
      {},
    ),
  };
}

function projectToolInputDelta(
  event: AgentEventToolInputDelta,
  context: ProjectTimelineItemContext,
  existing?: AgentThreadItem,
): AgentThreadItem {
  const item = baseItem(event, context, {
    id: event.tool_id,
    status: "in_progress",
    type: "tool_call",
  });
  const current =
    existing?.type === "tool_call"
      ? existing
      : ({
          ...item,
          type: "tool_call",
          tool_name: event.tool_name || "",
        } as Extract<AgentThreadItem, { type: "tool_call" }>);
  const accumulated = event.accumulated_arguments || event.delta;
  return {
    ...current,
    ...mergeBaseItem(existing, item),
    type: "tool_call",
    tool_name: event.tool_name || current.tool_name || event.tool_id,
    arguments: normalizeToolArguments(accumulated),
    metadata: legacyToolEventMetadata(
      normalizeRecord(current?.metadata),
      normalizeRecord(event.metadata),
      {},
    ),
  };
}

function projectToolOutputDelta(
  event: AgentEventToolOutputDelta,
  context: ProjectTimelineItemContext,
  existing?: AgentThreadItem,
): AgentThreadItem {
  const metadata = normalizeRecord(event.metadata);
  const item = baseItem(event, context, {
    id: event.tool_id,
    status: "in_progress",
    type: "tool_call",
  });
  const current = existing?.type === "tool_call" ? existing : undefined;
  return {
    ...mergeBaseItem(existing, item),
    type: "tool_call",
    tool_name: current?.tool_name || event.tool_id,
    arguments: current?.arguments,
    output: appendTextWithOverlap(current?.output, event.delta),
    success: current?.success,
    error: current?.error,
    metadata: {
      ...legacyToolEventMetadata(normalizeRecord(current?.metadata), metadata),
      ...(event.output_kind ? { output_kind: event.output_kind } : {}),
      streaming: true,
    },
  };
}

function projectToolProgress(
  event: AgentEventToolProgress,
  context: ProjectTimelineItemContext,
  existing?: AgentThreadItem,
): AgentThreadItem | null {
  if (!event.progress.message && event.progress.progress === undefined) {
    return null;
  }
  const progressMetadata = normalizeRecord(event.progress.metadata);
  const item = baseItem(event, context, {
    id: event.tool_id,
    status: "in_progress",
    type: "tool_call",
  });
  const current = existing?.type === "tool_call" ? existing : undefined;
  return {
    ...mergeBaseItem(existing, item),
    type: "tool_call",
    tool_name: current?.tool_name || event.tool_id,
    arguments: current?.arguments,
    output: current?.output,
    success: current?.success,
    error: current?.error,
    metadata: legacyToolEventMetadata(
      normalizeRecord(current?.metadata),
      {
        progress: event.progress,
      },
      progressMetadata,
      {},
    ),
  };
}

function projectToolEnd(
  event: AgentEventToolEnd,
  context: ProjectTimelineItemContext,
  existing?: AgentThreadItem,
): AgentThreadItem {
  const item = baseItem(event, context, {
    id: event.tool_id,
    status: event.result.success ? "completed" : "failed",
    type: "tool_call",
  });
  const current = existing?.type === "tool_call" ? existing : undefined;
  return {
    ...mergeBaseItem(existing, item),
    type: "tool_call",
    tool_name: current?.tool_name || event.tool_id,
    arguments: current?.arguments,
    output: event.result.output || current?.output,
    success: event.result.success,
    error: event.result.error,
    structuredContent:
      event.result.structuredContent ??
      event.result.structured_content ??
      current?.structuredContent ??
      current?.structured_content,
    structured_content:
      event.result.structured_content ??
      event.result.structuredContent ??
      current?.structured_content ??
      current?.structuredContent,
    metadata: legacyToolEventMetadata(
      normalizeRecord(current?.metadata),
      event.result.metadata,
      {},
    ),
  };
}

function projectActionRequired(
  event: AgentEventActionRequired,
  context: ProjectTimelineItemContext,
  existing?: AgentThreadItem,
): AgentThreadItem {
  const isUserInput =
    event.action_type === "ask_user" || event.action_type === "elicitation";
  const item = baseItem(event, context, {
    id: event.request_id,
    status: "in_progress",
    type: isUserInput ? "request_user_input" : "approval_request",
    turnId: resolveTurnId(context, event.scope),
  });
  if (isUserInput) {
    return {
      ...mergeBaseItem(existing, item),
      type: "request_user_input",
      request_id: event.request_id,
      action_type: event.action_type,
      prompt: event.prompt,
      questions: event.questions?.map((question) => ({
        question: question.question,
        header: question.header,
        options: question.options,
        multi_select: question.multiSelect,
      })),
      response:
        existing?.type === "request_user_input" ? existing.response : undefined,
    };
  }
  return {
    ...mergeBaseItem(existing, item),
    type: "approval_request",
    request_id: event.request_id,
    action_type: event.action_type,
    prompt: event.prompt,
    tool_name: event.tool_name,
    arguments: event.arguments,
    available_decisions: event.available_decisions,
    response:
      existing?.type === "approval_request" ? existing.response : undefined,
  };
}

function projectActionResolved(
  event: AgentEventActionResolved,
  context: ProjectTimelineItemContext,
  existing?: AgentThreadItem,
): AgentThreadItem {
  const isUserInput =
    event.action_type === "ask_user" || event.action_type === "elicitation";
  const itemType =
    existing?.type === "request_user_input" ||
    existing?.type === "approval_request"
      ? existing.type
      : isUserInput
        ? "request_user_input"
        : "approval_request";
  const item = baseItem(event, context, {
    id: event.request_id,
    status: "completed",
    type: itemType,
    turnId: resolveTurnId(context, event.scope),
  });
  const response = {
    ...(normalizeRecord(event.data) ?? {}),
    ...(event.approved !== undefined ? { approved: event.approved } : {}),
    ...(event.feedback ? { feedback: event.feedback } : {}),
    ...(event.permission_mode
      ? { permission_mode: event.permission_mode }
      : {}),
  };
  if (
    existing?.type === "request_user_input" ||
    item.type === "request_user_input"
  ) {
    return {
      ...mergeBaseItem(existing, item),
      type: "request_user_input",
      request_id: event.request_id,
      action_type: event.action_type,
      prompt:
        existing?.type === "request_user_input" ? existing.prompt : undefined,
      questions:
        existing?.type === "request_user_input"
          ? existing.questions
          : undefined,
      response,
    };
  }
  return {
    ...mergeBaseItem(existing, item),
    type: "approval_request",
    request_id: event.request_id,
    action_type: event.action_type,
    prompt: existing?.type === "approval_request" ? existing.prompt : undefined,
    tool_name:
      existing?.type === "approval_request" ? existing.tool_name : undefined,
    arguments:
      existing?.type === "approval_request" ? existing.arguments : undefined,
    available_decisions:
      existing?.type === "approval_request"
        ? existing.available_decisions
        : undefined,
    response,
  };
}

export function projectAgentStreamTimelineItem(
  event: AgentEvent,
  context: ProjectTimelineItemContext,
  existing?: AgentThreadItem,
): AgentThreadItem | null {
  switch (event.type) {
    case "tool_start":
      return projectToolStart(event, context, existing);
    case "tool_input_delta":
      return projectToolInputDelta(event, context, existing);
    case "tool_progress":
      return projectToolProgress(event, context, existing);
    case "tool_output_delta":
      return projectToolOutputDelta(event, context, existing);
    case "tool_end":
      return projectToolEnd(event, context, existing);
    case "action_required":
      return projectActionRequired(event, context, existing);
    case "action_resolved":
      return projectActionResolved(event, context, existing);
    default:
      return null;
  }
}
