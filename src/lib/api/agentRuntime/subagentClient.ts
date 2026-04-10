import { AGENT_RUNTIME_COMMANDS } from "./commandManifest.generated";
import {
  invokeAgentRuntimeCommand,
  type AgentRuntimeCommandInvoke,
} from "./transport";
import type {
  AgentRuntimeCloseSubagentRequest,
  AgentRuntimeCloseSubagentResponse,
  AgentRuntimeResumeSubagentRequest,
  AgentRuntimeResumeSubagentResponse,
  AgentRuntimeSendSubagentInputRequest,
  AgentRuntimeSendSubagentInputResponse,
  AgentRuntimeSpawnSubagentRequest,
  AgentRuntimeSpawnSubagentResponse,
  AgentRuntimeWaitSubagentsRequest,
  AgentRuntimeWaitSubagentsResponse,
} from "./types";

export interface AgentRuntimeSubagentClientDeps {
  invokeCommand?: AgentRuntimeCommandInvoke;
}

export function createSubagentClient({
  invokeCommand = invokeAgentRuntimeCommand,
}: AgentRuntimeSubagentClientDeps = {}) {
  async function spawnAgentRuntimeSubagent(
    request: AgentRuntimeSpawnSubagentRequest,
  ): Promise<AgentRuntimeSpawnSubagentResponse> {
    return await invokeCommand<AgentRuntimeSpawnSubagentResponse>(
      AGENT_RUNTIME_COMMANDS.spawnSubagent,
      { request },
    );
  }

  async function sendAgentRuntimeSubagentInput(
    request: AgentRuntimeSendSubagentInputRequest,
  ): Promise<AgentRuntimeSendSubagentInputResponse> {
    return await invokeCommand<AgentRuntimeSendSubagentInputResponse>(
      AGENT_RUNTIME_COMMANDS.sendSubagentInput,
      { request },
    );
  }

  async function waitAgentRuntimeSubagents(
    request: AgentRuntimeWaitSubagentsRequest,
  ): Promise<AgentRuntimeWaitSubagentsResponse> {
    return await invokeCommand<AgentRuntimeWaitSubagentsResponse>(
      AGENT_RUNTIME_COMMANDS.waitSubagents,
      { request },
    );
  }

  async function resumeAgentRuntimeSubagent(
    request: AgentRuntimeResumeSubagentRequest,
  ): Promise<AgentRuntimeResumeSubagentResponse> {
    return await invokeCommand<AgentRuntimeResumeSubagentResponse>(
      AGENT_RUNTIME_COMMANDS.resumeSubagent,
      { request },
    );
  }

  async function closeAgentRuntimeSubagent(
    request: AgentRuntimeCloseSubagentRequest,
  ): Promise<AgentRuntimeCloseSubagentResponse> {
    return await invokeCommand<AgentRuntimeCloseSubagentResponse>(
      AGENT_RUNTIME_COMMANDS.closeSubagent,
      { request },
    );
  }

  return {
    closeAgentRuntimeSubagent,
    resumeAgentRuntimeSubagent,
    sendAgentRuntimeSubagentInput,
    spawnAgentRuntimeSubagent,
    waitAgentRuntimeSubagents,
  };
}

export const {
  closeAgentRuntimeSubagent,
  resumeAgentRuntimeSubagent,
  sendAgentRuntimeSubagentInput,
  spawnAgentRuntimeSubagent,
  waitAgentRuntimeSubagents,
} = createSubagentClient();
