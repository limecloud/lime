import { AGENT_RUNTIME_COMMANDS } from "./commandManifest.generated";
import {
  normalizeAnalysisHandoff,
  normalizeReviewDecisionTemplate,
} from "./normalizers";
import {
  invokeAgentRuntimeCommand,
  type AgentRuntimeCommandInvoke,
} from "./transport";
import type {
  AgentRuntimeAnalysisHandoff,
  AgentRuntimeEvidencePack,
  AgentRuntimeHandoffBundle,
  AgentRuntimeReplayCase,
  AgentRuntimeReviewDecisionTemplate,
  AgentRuntimeSaveReviewDecisionRequest,
} from "./types";

export interface AgentRuntimeExportClientDeps {
  invokeCommand?: AgentRuntimeCommandInvoke;
}

export function createExportClient({
  invokeCommand = invokeAgentRuntimeCommand,
}: AgentRuntimeExportClientDeps = {}) {
  async function exportAgentRuntimeHandoffBundle(
    sessionId: string,
  ): Promise<AgentRuntimeHandoffBundle> {
    return await invokeCommand<AgentRuntimeHandoffBundle>(
      AGENT_RUNTIME_COMMANDS.exportHandoffBundle,
      { sessionId },
    );
  }

  async function exportAgentRuntimeAnalysisHandoff(
    sessionId: string,
  ): Promise<AgentRuntimeAnalysisHandoff> {
    return normalizeAnalysisHandoff(
      await invokeCommand(AGENT_RUNTIME_COMMANDS.exportAnalysisHandoff, {
        sessionId,
      }),
    );
  }

  async function exportAgentRuntimeReviewDecisionTemplate(
    sessionId: string,
  ): Promise<AgentRuntimeReviewDecisionTemplate> {
    return normalizeReviewDecisionTemplate(
      await invokeCommand(
        AGENT_RUNTIME_COMMANDS.exportReviewDecisionTemplate,
        {
          sessionId,
        },
      ),
    );
  }

  async function saveAgentRuntimeReviewDecision(
    request: AgentRuntimeSaveReviewDecisionRequest,
  ): Promise<AgentRuntimeReviewDecisionTemplate> {
    return normalizeReviewDecisionTemplate(
      await invokeCommand(AGENT_RUNTIME_COMMANDS.saveReviewDecision, {
        request,
      }),
    );
  }

  async function exportAgentRuntimeEvidencePack(
    sessionId: string,
  ): Promise<AgentRuntimeEvidencePack> {
    return await invokeCommand<AgentRuntimeEvidencePack>(
      AGENT_RUNTIME_COMMANDS.exportEvidencePack,
      { sessionId },
    );
  }

  async function exportAgentRuntimeReplayCase(
    sessionId: string,
  ): Promise<AgentRuntimeReplayCase> {
    return await invokeCommand<AgentRuntimeReplayCase>(
      AGENT_RUNTIME_COMMANDS.exportReplayCase,
      { sessionId },
    );
  }

  return {
    exportAgentRuntimeAnalysisHandoff,
    exportAgentRuntimeEvidencePack,
    exportAgentRuntimeHandoffBundle,
    exportAgentRuntimeReplayCase,
    exportAgentRuntimeReviewDecisionTemplate,
    saveAgentRuntimeReviewDecision,
  };
}

export const {
  exportAgentRuntimeAnalysisHandoff,
  exportAgentRuntimeEvidencePack,
  exportAgentRuntimeHandoffBundle,
  exportAgentRuntimeReplayCase,
  exportAgentRuntimeReviewDecisionTemplate,
  saveAgentRuntimeReviewDecision,
} = createExportClient();
