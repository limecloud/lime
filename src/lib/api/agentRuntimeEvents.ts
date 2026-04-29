import { safeListen } from "@/lib/dev-bridge";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type { AgentEvent } from "@/lib/api/agentProtocol";

export type AgentRuntimeEventHandler<TPayload = AgentEvent | unknown> =
  (event: { payload: TPayload | unknown }) => void;

export type AgentRuntimeEventListener = <TPayload = AgentEvent | unknown>(
  eventName: string,
  handler: AgentRuntimeEventHandler<TPayload>,
) => Promise<UnlistenFn>;

export interface AgentRuntimeEventTransportDeps {
  listen?: typeof safeListen;
}

export interface AgentRuntimeEventSourceDeps extends AgentRuntimeEventTransportDeps {
  listenEvent?: AgentRuntimeEventListener;
}

export interface AgentRuntimeEventSource {
  listenRuntimeEvent: AgentRuntimeEventListener;
  listenSubagentStatus(
    sessionId: string,
    handler: AgentRuntimeEventHandler,
  ): Promise<UnlistenFn>;
  listenSubagentStream(
    sessionId: string,
    handler: AgentRuntimeEventHandler,
  ): Promise<UnlistenFn>;
}

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

export function createAgentRuntimeEventListener({
  listen = safeListen,
}: AgentRuntimeEventTransportDeps = {}): AgentRuntimeEventListener {
  return async <TPayload = AgentEvent | unknown>(
    eventName: string,
    handler: AgentRuntimeEventHandler<TPayload>,
  ): Promise<UnlistenFn> => {
    return await listen<TPayload>(eventName, handler);
  };
}

export function createAgentRuntimeEventSource({
  listenEvent,
  listen,
}: AgentRuntimeEventSourceDeps = {}): AgentRuntimeEventSource {
  const resolvedListenEvent =
    listenEvent ?? createAgentRuntimeEventListener({ listen });

  async function listenRuntimeEvent(
    eventName: string,
    handler: AgentRuntimeEventHandler,
  ): Promise<UnlistenFn> {
    return await resolvedListenEvent(eventName, handler);
  }

  async function listenSubagentStatus(
    sessionId: string,
    handler: AgentRuntimeEventHandler,
  ): Promise<UnlistenFn> {
    return await listenRuntimeEvent(
      getAgentSubagentStatusEventName(sessionId),
      handler,
    );
  }

  async function listenSubagentStream(
    sessionId: string,
    handler: AgentRuntimeEventHandler,
  ): Promise<UnlistenFn> {
    return await listenRuntimeEvent(
      getAgentSubagentStreamEventName(sessionId),
      handler,
    );
  }

  return {
    listenRuntimeEvent,
    listenSubagentStatus,
    listenSubagentStream,
  };
}

export const defaultAgentRuntimeEventSource = createAgentRuntimeEventSource();

export const listenAgentRuntimeEvent: AgentRuntimeEventListener =
  defaultAgentRuntimeEventSource.listenRuntimeEvent;

export async function listenAgentSubagentStatus(
  sessionId: string,
  handler: AgentRuntimeEventHandler,
): Promise<UnlistenFn> {
  return await defaultAgentRuntimeEventSource.listenSubagentStatus(
    sessionId,
    handler,
  );
}

export async function listenAgentSubagentStream(
  sessionId: string,
  handler: AgentRuntimeEventHandler,
): Promise<UnlistenFn> {
  return await defaultAgentRuntimeEventSource.listenSubagentStream(
    sessionId,
    handler,
  );
}
