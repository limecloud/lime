import { AGENT_RUNTIME_COMMANDS } from "./commandManifest.generated";
import {
  invokeAgentRuntimeCommand,
  type AgentRuntimeCommandInvoke,
} from "./transport";
import type {
  AgentRuntimeListWorkspaceSkillBindingsRequest,
  AgentRuntimeToolInventory,
  AgentRuntimeToolInventoryRequest,
  AgentRuntimeWorkspaceSkillBindings,
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

  async function listWorkspaceSkillBindings(
    request: AgentRuntimeListWorkspaceSkillBindingsRequest,
  ): Promise<AgentRuntimeWorkspaceSkillBindings> {
    return await invokeCommand<AgentRuntimeWorkspaceSkillBindings>(
      AGENT_RUNTIME_COMMANDS.listWorkspaceSkillBindings,
      { request },
    );
  }

  return {
    getAgentRuntimeToolInventory,
    listWorkspaceSkillBindings,
  };
}

export const { getAgentRuntimeToolInventory, listWorkspaceSkillBindings } =
  createInventoryClient();
