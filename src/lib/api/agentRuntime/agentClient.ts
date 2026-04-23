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

export interface GenerateAgentRuntimeTitleRequest {
  sessionId?: string;
  previewText?: string;
  titleKind?: "session" | "image_task";
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

  async function generateAgentRuntimeTitle(
    request: GenerateAgentRuntimeTitleRequest,
  ): Promise<string> {
    const payload: Record<string, string> = {};
    if (request.sessionId?.trim()) {
      payload.sessionId = request.sessionId.trim();
    }
    if (request.previewText?.trim()) {
      payload.previewText = request.previewText.trim();
    }
    if (request.titleKind?.trim()) {
      payload.titleKind = request.titleKind.trim();
    }

    return await bridgeInvoke("agent_generate_title", payload);
  }

  async function generateAgentRuntimeSessionTitle(
    sessionId: string,
  ): Promise<string> {
    return await generateAgentRuntimeTitle({
      sessionId,
      titleKind: "session",
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
    generateAgentRuntimeTitle,
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
  generateAgentRuntimeTitle,
  generateAgentRuntimeSessionTitle,
  getAgentProcessStatus,
  getAsterAgentStatus,
  initAsterAgent,
  startAgentProcess,
  stopAgentProcess,
} = createAgentClient();
