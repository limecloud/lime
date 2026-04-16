import { AGENT_RUNTIME_COMMANDS } from "./commandManifest.generated";
import { normalizeThreadReadModel } from "./normalizers";
import {
  invokeAgentRuntimeCommand,
  type AgentRuntimeCommandInvoke,
} from "./transport";
import type {
  AgentRuntimeCompactSessionRequest,
  AgentRuntimeDiffFileCheckpointRequest,
  AgentRuntimeFileCheckpointDetail,
  AgentRuntimeFileCheckpointDiffResult,
  AgentRuntimeFileCheckpointListResult,
  AgentRuntimeGetFileCheckpointRequest,
  AgentRuntimeInterruptTurnRequest,
  AgentRuntimeListFileCheckpointsRequest,
  AgentRuntimePromoteQueuedTurnRequest,
  AgentRuntimeRemoveQueuedTurnRequest,
  AgentRuntimeReplayRequestRequest,
  AgentRuntimeReplayedActionRequiredView,
  AgentRuntimeRespondActionRequest,
  AgentRuntimeResumeThreadRequest,
  AgentRuntimeSubmitTurnRequest,
  AgentRuntimeThreadReadModel,
} from "./types";

export interface AgentRuntimeThreadClientDeps {
  invokeCommand?: AgentRuntimeCommandInvoke;
}

export function createThreadClient({
  invokeCommand = invokeAgentRuntimeCommand,
}: AgentRuntimeThreadClientDeps = {}) {
  async function submitAgentRuntimeTurn(
    request: AgentRuntimeSubmitTurnRequest,
  ): Promise<void> {
    return await invokeCommand<void>(AGENT_RUNTIME_COMMANDS.submitTurn, {
      request,
    });
  }

  async function interruptAgentRuntimeTurn(
    request: AgentRuntimeInterruptTurnRequest,
  ): Promise<boolean> {
    return await invokeCommand<boolean>(AGENT_RUNTIME_COMMANDS.interruptTurn, {
      request,
    });
  }

  async function compactAgentRuntimeSession(
    request: AgentRuntimeCompactSessionRequest,
  ): Promise<void> {
    return await invokeCommand<void>(AGENT_RUNTIME_COMMANDS.compactSession, {
      request,
    });
  }

  async function resumeAgentRuntimeThread(
    request: AgentRuntimeResumeThreadRequest,
  ): Promise<boolean> {
    return await invokeCommand<boolean>(AGENT_RUNTIME_COMMANDS.resumeThread, {
      request,
    });
  }

  async function replayAgentRuntimeRequest(
    request: AgentRuntimeReplayRequestRequest,
  ): Promise<AgentRuntimeReplayedActionRequiredView | null> {
    return await invokeCommand<AgentRuntimeReplayedActionRequiredView | null>(
      AGENT_RUNTIME_COMMANDS.replayRequest,
      {
        request,
      },
    );
  }

  async function removeAgentRuntimeQueuedTurn(
    request: AgentRuntimeRemoveQueuedTurnRequest,
  ): Promise<boolean> {
    return await invokeCommand<boolean>(
      AGENT_RUNTIME_COMMANDS.removeQueuedTurn,
      {
        request,
      },
    );
  }

  async function promoteAgentRuntimeQueuedTurn(
    request: AgentRuntimePromoteQueuedTurnRequest,
  ): Promise<boolean> {
    return await invokeCommand<boolean>(
      AGENT_RUNTIME_COMMANDS.promoteQueuedTurn,
      { request },
    );
  }

  async function respondAgentRuntimeAction(
    request: AgentRuntimeRespondActionRequest,
  ): Promise<void> {
    return await invokeCommand<void>(AGENT_RUNTIME_COMMANDS.respondAction, {
      request,
    });
  }

  async function getAgentRuntimeThreadRead(
    sessionId: string,
  ): Promise<AgentRuntimeThreadReadModel> {
    const threadRead = await invokeCommand<AgentRuntimeThreadReadModel>(
      AGENT_RUNTIME_COMMANDS.getThreadRead,
      { sessionId },
    );

    return normalizeThreadReadModel(
      threadRead as AgentRuntimeThreadReadModel | null | undefined,
    ) as AgentRuntimeThreadReadModel;
  }

  async function listAgentRuntimeFileCheckpoints(
    request: AgentRuntimeListFileCheckpointsRequest,
  ): Promise<AgentRuntimeFileCheckpointListResult> {
    return await invokeCommand<AgentRuntimeFileCheckpointListResult>(
      AGENT_RUNTIME_COMMANDS.listFileCheckpoints,
      { request },
    );
  }

  async function getAgentRuntimeFileCheckpoint(
    request: AgentRuntimeGetFileCheckpointRequest,
  ): Promise<AgentRuntimeFileCheckpointDetail> {
    return await invokeCommand<AgentRuntimeFileCheckpointDetail>(
      AGENT_RUNTIME_COMMANDS.getFileCheckpoint,
      { request },
    );
  }

  async function diffAgentRuntimeFileCheckpoint(
    request: AgentRuntimeDiffFileCheckpointRequest,
  ): Promise<AgentRuntimeFileCheckpointDiffResult> {
    return await invokeCommand<AgentRuntimeFileCheckpointDiffResult>(
      AGENT_RUNTIME_COMMANDS.diffFileCheckpoint,
      { request },
    );
  }

  return {
    compactAgentRuntimeSession,
    diffAgentRuntimeFileCheckpoint,
    getAgentRuntimeFileCheckpoint,
    getAgentRuntimeThreadRead,
    interruptAgentRuntimeTurn,
    listAgentRuntimeFileCheckpoints,
    promoteAgentRuntimeQueuedTurn,
    removeAgentRuntimeQueuedTurn,
    replayAgentRuntimeRequest,
    respondAgentRuntimeAction,
    resumeAgentRuntimeThread,
    submitAgentRuntimeTurn,
  };
}

export const {
  compactAgentRuntimeSession,
  diffAgentRuntimeFileCheckpoint,
  getAgentRuntimeFileCheckpoint,
  getAgentRuntimeThreadRead,
  interruptAgentRuntimeTurn,
  listAgentRuntimeFileCheckpoints,
  promoteAgentRuntimeQueuedTurn,
  removeAgentRuntimeQueuedTurn,
  replayAgentRuntimeRequest,
  respondAgentRuntimeAction,
  resumeAgentRuntimeThread,
  submitAgentRuntimeTurn,
} = createThreadClient();
