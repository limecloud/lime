import type {
  AgentEvent,
  AgentEventToolEnd,
  AgentEventToolInputDelta,
  AgentEventToolOutputDelta,
  AgentEventToolProgress,
  AgentEventToolStart,
} from "@/lib/api/agentProtocol";
import type {
  AgentUiProjectionContext,
  AgentUiProjectionEvent,
} from "@limecloud/agent-ui-contracts";
import {
  buildAgentUiToolEndEvents,
  buildAgentUiToolInputDeltaEvent,
  buildAgentUiToolOutputDeltaEvent,
  buildAgentUiToolProgressEvent,
  buildAgentUiToolStartEvents,
} from "@limecloud/agent-runtime-projection";

type ToolProjectionEvent = Extract<
  AgentEvent,
  {
    type:
      | "tool_start"
      | "tool_end"
      | "tool_progress"
      | "tool_output_delta"
      | "tool_input_delta";
  }
>;

export function buildToolProjectionEvents(
  event: ToolProjectionEvent,
  context: AgentUiProjectionContext,
): AgentUiProjectionEvent[] {
  switch (event.type) {
    case "tool_start":
      return buildToolStartEvents(event, context);
    case "tool_end":
      return buildToolEndEvents(event, context);
    case "tool_progress":
      return [buildToolProgressEvent(event, context)];
    case "tool_output_delta":
      return [buildToolOutputDeltaEvent(event, context)];
    case "tool_input_delta":
      return [buildToolInputDeltaEvent(event, context)];
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

export function buildToolStartEvents(
  event: AgentEventToolStart,
  context: AgentUiProjectionContext,
): AgentUiProjectionEvent[] {
  return buildAgentUiToolStartEvents(
    {
      sourceType: event.type,
      toolCallId: event.tool_id,
      toolName: event.tool_name,
      input: event.arguments,
    },
    context,
  );
}

export function buildToolEndEvents(
  event: AgentEventToolEnd,
  context: AgentUiProjectionContext,
): AgentUiProjectionEvent[] {
  return buildAgentUiToolEndEvents(
    {
      sourceType: event.type,
      toolCallId: event.tool_id,
      result: event.result,
    },
    context,
  );
}

export function buildToolProgressEvent(
  event: AgentEventToolProgress,
  context: AgentUiProjectionContext,
): AgentUiProjectionEvent {
  return buildAgentUiToolProgressEvent(
    {
      sourceType: event.type,
      toolCallId: event.tool_id,
      progress: event.progress,
    },
    context,
  );
}

export function buildToolOutputDeltaEvent(
  event: AgentEventToolOutputDelta,
  context: AgentUiProjectionContext,
): AgentUiProjectionEvent {
  return buildAgentUiToolOutputDeltaEvent(
    {
      sourceType: event.type,
      toolCallId: event.tool_id,
      delta: event.delta,
      outputKind: event.output_kind,
      metadata: event.metadata,
    },
    context,
  );
}

export function buildToolInputDeltaEvent(
  event: AgentEventToolInputDelta,
  context: AgentUiProjectionContext,
): AgentUiProjectionEvent {
  return buildAgentUiToolInputDeltaEvent(
    {
      sourceType: event.type,
      toolCallId: event.tool_id,
      toolName: event.tool_name,
      delta: event.delta,
      accumulatedInput: event.accumulated_arguments,
      provider: event.provider,
    },
    context,
  );
}
