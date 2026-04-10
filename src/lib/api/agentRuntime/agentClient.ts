import type {
  AgentProcessStatus,
  AsterAgentStatus,
  AsterProviderConfig,
} from "./types";
import {
  invokeAgentRuntimeBridge,
  type AgentRuntimeBridgeInvoke,
} from "./transport";

export interface AgentRuntimeAgentClientDeps {
  bridgeInvoke?: AgentRuntimeBridgeInvoke;
}

export function createAgentClient({
  bridgeInvoke = invokeAgentRuntimeBridge,
}: AgentRuntimeAgentClientDeps = {}) {
  async function startAgentProcess(): Promise<AgentProcessStatus> {
    return await bridgeInvoke("agent_start_process", {});
  }

  async function stopAgentProcess(): Promise<void> {
    return await bridgeInvoke("agent_stop_process");
  }

  async function getAgentProcessStatus(): Promise<AgentProcessStatus> {
    return await bridgeInvoke("agent_get_process_status");
  }

  async function generateAgentRuntimeSessionTitle(
    sessionId: string,
  ): Promise<string> {
    return await bridgeInvoke("agent_generate_title", {
      sessionId,
    });
  }

  async function initAsterAgent(): Promise<AsterAgentStatus> {
    return await bridgeInvoke("aster_agent_init");
  }

  async function getAsterAgentStatus(): Promise<AsterAgentStatus> {
    return await bridgeInvoke("aster_agent_status");
  }

  async function configureAsterProvider(
    config: AsterProviderConfig,
    sessionId: string,
  ): Promise<AsterAgentStatus> {
    return await bridgeInvoke("aster_agent_configure_provider", {
      request: config,
      session_id: sessionId,
    });
  }

  return {
    configureAsterProvider,
    generateAgentRuntimeSessionTitle,
    getAgentProcessStatus,
    getAsterAgentStatus,
    initAsterAgent,
    startAgentProcess,
    stopAgentProcess,
  };
}

export const {
  configureAsterProvider,
  generateAgentRuntimeSessionTitle,
  getAgentProcessStatus,
  getAsterAgentStatus,
  initAsterAgent,
  startAgentProcess,
  stopAgentProcess,
} = createAgentClient();
