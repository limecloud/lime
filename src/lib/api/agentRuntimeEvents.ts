import { safeListen } from "@/lib/dev-bridge";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type { AgentEvent } from "@/lib/api/agentProtocol";

export function getAgentSubagentStatusEventName(sessionId: string): string {
  return `agent_subagent_status:${sessionId}`;
}

export function getAgentSubagentStreamEventName(sessionId: string): string {
  return `agent_subagent_stream:${sessionId}`;
}

export function dedupeAgentRuntimeEventNames(
  eventNames: Array<string | null | undefined>,
): string[] {
  return eventNames.filter((value, index, values): value is string => {
    return Boolean(value) && values.indexOf(value) === index;
  });
}

export async function listenAgentRuntimeEvent(
  eventName: string,
  handler: (event: { payload: AgentEvent | unknown }) => void,
): Promise<UnlistenFn> {
  return safeListen<AgentEvent>(eventName, handler);
}

export async function listenAgentSubagentStatus(
  sessionId: string,
  handler: (event: { payload: AgentEvent | unknown }) => void,
): Promise<UnlistenFn> {
  return listenAgentRuntimeEvent(
    getAgentSubagentStatusEventName(sessionId),
    handler,
  );
}

export async function listenAgentSubagentStream(
  sessionId: string,
  handler: (event: { payload: AgentEvent | unknown }) => void,
): Promise<UnlistenFn> {
  return listenAgentRuntimeEvent(
    getAgentSubagentStreamEventName(sessionId),
    handler,
  );
}
