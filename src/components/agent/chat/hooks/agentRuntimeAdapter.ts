import { safeListen } from "@/lib/dev-bridge";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  createSubmitTurnRequestFromAgentOp,
  type AgentEvent,
  type AgentOp,
} from "@/lib/api/agentProtocol";
import {
  compactAgentRuntimeSession,
  createAgentRuntimeSession,
  deleteAgentRuntimeSession,
  type AgentRuntimeReplayedActionRequiredView,
  getAgentRuntimeSession,
  getAgentRuntimeThreadRead,
  initAsterAgent,
  interruptAgentRuntimeTurn,
  promoteAgentRuntimeQueuedTurn,
  replayAgentRuntimeRequest,
  removeAgentRuntimeQueuedTurn,
  resumeAgentRuntimeThread,
  listAgentRuntimeSessions,
  respondAgentRuntimeAction,
  submitAgentRuntimeTurn,
  updateAgentRuntimeSession,
  type AsterExecutionStrategy,
  type AsterSessionDetail,
  type AsterSessionInfo,
} from "@/lib/api/agentRuntime";
import type { ActionRequiredScope } from "../types";

export interface AgentRuntimeActionResponse {
  sessionId: string;
  requestId: string;
  actionType: "tool_confirmation" | "ask_user" | "elicitation";
  confirmed: boolean;
  response?: string;
  userData?: unknown;
  metadata?: Record<string, unknown>;
  eventName?: string;
  actionScope?: ActionRequiredScope;
}

export interface AgentRuntimeAdapter {
  init(): Promise<void>;
  createSession(
    workspaceId: string,
    name?: string,
    executionStrategy?: AsterExecutionStrategy,
  ): Promise<string>;
  listSessions(): Promise<AsterSessionInfo[]>;
  getSession(sessionId: string): Promise<AsterSessionDetail>;
  getSessionReadModel(sessionId: string): Promise<AsterSessionDetail["thread_read"]>;
  replayRequest(
    sessionId: string,
    requestId: string,
  ): Promise<AgentRuntimeReplayedActionRequiredView | null>;
  renameSession(sessionId: string, title: string): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  setSessionExecutionStrategy(
    sessionId: string,
    executionStrategy: AsterExecutionStrategy,
  ): Promise<void>;
  submitOp(op: AgentOp): Promise<void>;
  compactSession(sessionId: string, eventName: string): Promise<void>;
  interruptTurn(sessionId: string): Promise<boolean>;
  resumeThread(sessionId: string): Promise<boolean>;
  promoteQueuedTurn(sessionId: string, queuedTurnId: string): Promise<boolean>;
  removeQueuedTurn(sessionId: string, queuedTurnId: string): Promise<boolean>;
  respondToAction(request: AgentRuntimeActionResponse): Promise<void>;
  listenToTurnEvents(
    eventName: string,
    handler: (event: { payload: AgentEvent | unknown }) => void,
  ): Promise<UnlistenFn>;
  listenToTeamEvents(
    eventName: string,
    handler: (event: { payload: AgentEvent | unknown }) => void,
  ): Promise<UnlistenFn>;
}

export const defaultAgentRuntimeAdapter: AgentRuntimeAdapter = {
  async init() {
    await initAsterAgent();
  },
  async createSession(workspaceId, name, executionStrategy) {
    return createAgentRuntimeSession(workspaceId, name, executionStrategy);
  },
  async listSessions() {
    return listAgentRuntimeSessions();
  },
  async getSession(sessionId) {
    return getAgentRuntimeSession(sessionId);
  },
  async getSessionReadModel(sessionId) {
    return getAgentRuntimeThreadRead(sessionId);
  },
  async replayRequest(sessionId, requestId) {
    return replayAgentRuntimeRequest({
      session_id: sessionId,
      request_id: requestId,
    });
  },
  async renameSession(sessionId, title) {
    await updateAgentRuntimeSession({
      session_id: sessionId,
      name: title,
    });
  },
  async deleteSession(sessionId) {
    await deleteAgentRuntimeSession(sessionId);
  },
  async setSessionExecutionStrategy(sessionId, executionStrategy) {
    await updateAgentRuntimeSession({
      session_id: sessionId,
      execution_strategy: executionStrategy,
    });
  },
  async submitOp(op) {
    switch (op.type) {
      case "user_input":
        await submitAgentRuntimeTurn(createSubmitTurnRequestFromAgentOp(op));
        return;
      default:
        throw new Error(`当前 runtime adapter 尚不支持 AgentOp: ${op.type}`);
    }
  },
  async compactSession(sessionId, eventName) {
    await compactAgentRuntimeSession({
      session_id: sessionId,
      event_name: eventName,
    });
  },
  async interruptTurn(sessionId) {
    return interruptAgentRuntimeTurn({
      session_id: sessionId,
    });
  },
  async resumeThread(sessionId) {
    return resumeAgentRuntimeThread({
      session_id: sessionId,
    });
  },
  async promoteQueuedTurn(sessionId, queuedTurnId) {
    return promoteAgentRuntimeQueuedTurn({
      session_id: sessionId,
      queued_turn_id: queuedTurnId,
    });
  },
  async removeQueuedTurn(sessionId, queuedTurnId) {
    return removeAgentRuntimeQueuedTurn({
      session_id: sessionId,
      queued_turn_id: queuedTurnId,
    });
  },
  async respondToAction(request) {
    await respondAgentRuntimeAction({
      session_id: request.sessionId,
      request_id: request.requestId,
      action_type: request.actionType,
      confirmed: request.confirmed,
      response: request.response,
      user_data: request.userData,
      metadata: request.metadata,
      ...(request.eventName ? { event_name: request.eventName } : {}),
      ...(request.actionScope
        ? {
            action_scope: {
              session_id: request.actionScope.sessionId,
              thread_id: request.actionScope.threadId,
              turn_id: request.actionScope.turnId,
            },
          }
        : {}),
    });
  },
  async listenToTurnEvents(eventName, handler) {
    return safeListen<AgentEvent>(eventName, handler);
  },
  async listenToTeamEvents(eventName, handler) {
    return safeListen<AgentEvent>(eventName, handler);
  },
};
