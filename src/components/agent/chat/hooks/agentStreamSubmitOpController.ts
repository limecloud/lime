import type { AgentUserInputOp } from "@/lib/api/agentProtocol";
import type { BuildUserInputSubmitOpOptions } from "../utils/buildUserInputSubmitOp";
import { buildUserInputSubmitOp } from "../utils/buildUserInputSubmitOp";

type AgentStreamSubmitOpBaseOptions = Omit<
  BuildUserInputSubmitOpOptions,
  "queueIfBusy" | "sessionId" | "turnId" | "workspaceId"
>;

export interface BuildAgentStreamSubmitOpOptions
  extends AgentStreamSubmitOpBaseOptions {
  activeSessionId: string;
  requestTurnId: string;
  submitWorkspaceId?: string;
}

export function buildAgentStreamSubmitOp(
  options: BuildAgentStreamSubmitOpOptions,
): AgentUserInputOp {
  const {
    activeSessionId,
    requestTurnId,
    submitWorkspaceId,
    ...submitOpOptions
  } = options;

  return buildUserInputSubmitOp({
    ...submitOpOptions,
    sessionId: activeSessionId,
    workspaceId: submitWorkspaceId,
    turnId: requestTurnId,
    queueIfBusy: true,
  });
}
