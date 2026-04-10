import { AGENT_RUNTIME_COMMANDS } from "./commandManifest.generated";
import {
  invokeAgentRuntimeCommand,
  type AgentRuntimeCommandInvoke,
} from "./transport";
import type {
  AgentRuntimeToolInventory,
  AgentRuntimeToolInventoryRequest,
} from "./types";

export interface AgentRuntimeInventoryClientDeps {
  invokeCommand?: AgentRuntimeCommandInvoke;
}

export function createInventoryClient({
  invokeCommand = invokeAgentRuntimeCommand,
}: AgentRuntimeInventoryClientDeps = {}) {
  async function getAgentRuntimeToolInventory(
    request: AgentRuntimeToolInventoryRequest = {},
  ): Promise<AgentRuntimeToolInventory> {
    return await invokeCommand<AgentRuntimeToolInventory>(
      AGENT_RUNTIME_COMMANDS.getToolInventory,
      { request },
    );
  }

  return {
    getAgentRuntimeToolInventory,
  };
}

export const { getAgentRuntimeToolInventory } = createInventoryClient();
