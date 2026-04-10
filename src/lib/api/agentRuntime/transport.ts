import { safeInvoke } from "@/lib/dev-bridge";
import type { AgentRuntimeCommandName } from "./commandManifest.generated";

export type AgentRuntimeBridgeInvoke = <TResponse>(
  command: string,
  payload?: Record<string, unknown>,
) => Promise<TResponse>;

export type AgentRuntimeCommandInvoke = <TResponse>(
  command: AgentRuntimeCommandName,
  payload?: Record<string, unknown>,
) => Promise<TResponse>;

export interface AgentRuntimeTransportDeps {
  invoke?: typeof safeInvoke;
}

export interface AgentRuntimeCommandTransportDeps
  extends AgentRuntimeTransportDeps {
  bridgeInvoke?: AgentRuntimeBridgeInvoke;
}

export function createAgentRuntimeBridgeInvoke({
  invoke = safeInvoke,
}: AgentRuntimeTransportDeps = {}): AgentRuntimeBridgeInvoke {
  return async <TResponse>(
    command: string,
    payload?: Record<string, unknown>,
  ): Promise<TResponse> => {
    if (typeof payload === "undefined") {
      return await invoke<TResponse>(command);
    }

    return await invoke<TResponse>(command, payload);
  };
}

export const invokeAgentRuntimeBridge = createAgentRuntimeBridgeInvoke();

export function createAgentRuntimeCommandInvoke({
  bridgeInvoke,
  invoke,
}: AgentRuntimeCommandTransportDeps = {}): AgentRuntimeCommandInvoke {
  const resolvedBridgeInvoke =
    bridgeInvoke ?? createAgentRuntimeBridgeInvoke({ invoke });

  return async <TResponse>(
    command: AgentRuntimeCommandName,
    payload?: Record<string, unknown>,
  ): Promise<TResponse> => {
    if (typeof payload === "undefined") {
      return await resolvedBridgeInvoke<TResponse>(command);
    }

    return await resolvedBridgeInvoke<TResponse>(command, payload);
  };
}

export const invokeAgentRuntimeCommand = createAgentRuntimeCommandInvoke({
  bridgeInvoke: invokeAgentRuntimeBridge,
});
