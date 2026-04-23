import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  createSubmitTurnRequestFromAgentOp,
  type AgentEvent,
  type AgentOp,
} from "@/lib/api/agentProtocol";
import {
  listenAgentRuntimeEvent,
  type AgentRuntimeEventListener,
} from "@/lib/api/agentRuntimeEvents";
import {
  createAgentRuntimeClient,
  type AgentRuntimeGetSessionOptions,
  type AgentRuntimeReplayedActionRequiredView,
  type AgentRuntimeClient,
  type AsterAgentStatus,
  type AsterExecutionStrategy,
  type AsterSessionDetail,
  type AsterSessionInfo,
} from "@/lib/api/agentRuntime";
import type { AgentAccessMode } from "./agentChatStorage";
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
  init(): Promise<AsterAgentStatus>;
  createSession(
    workspaceId: string,
    name?: string,
    executionStrategy?: AsterExecutionStrategy,
  ): Promise<string>;
  listSessions(): Promise<AsterSessionInfo[]>;
  getSession(
    sessionId: string,
    options?: AgentRuntimeGetSessionOptions,
  ): Promise<AsterSessionDetail>;
  getSessionReadModel(
    sessionId: string,
  ): Promise<AsterSessionDetail["thread_read"]>;
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
  setSessionAccessMode?(
    sessionId: string,
    accessMode: AgentAccessMode,
  ): Promise<void>;
  setSessionProviderSelection(
    sessionId: string,
    providerType: string,
    model: string,
  ): Promise<void>;
  generateSessionTitle?(sessionId: string): Promise<string>;
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

export interface AgentRuntimeAdapterDeps {
  client?: Pick<
    AgentRuntimeClient,
    | "compactAgentRuntimeSession"
    | "createAgentRuntimeSession"
    | "deleteAgentRuntimeSession"
    | "generateAgentRuntimeSessionTitle"
    | "getAgentRuntimeSession"
    | "getAgentRuntimeThreadRead"
    | "initAsterAgent"
    | "interruptAgentRuntimeTurn"
    | "listAgentRuntimeSessions"
    | "promoteAgentRuntimeQueuedTurn"
    | "replayAgentRuntimeRequest"
    | "removeAgentRuntimeQueuedTurn"
    | "resumeAgentRuntimeThread"
    | "respondAgentRuntimeAction"
    | "submitAgentRuntimeTurn"
    | "updateAgentRuntimeSession"
  >;
  listenRuntimeEvent?: AgentRuntimeEventListener;
}

export function createAgentRuntimeAdapter({
  client = createAgentRuntimeClient(),
  listenRuntimeEvent = listenAgentRuntimeEvent,
}: AgentRuntimeAdapterDeps = {}): AgentRuntimeAdapter {
  return {
    async init() {
      return client.initAsterAgent();
    },
    async createSession(workspaceId, name, executionStrategy) {
      return client.createAgentRuntimeSession(
        workspaceId,
        name,
        executionStrategy,
      );
    },
    async listSessions() {
      return client.listAgentRuntimeSessions();
    },
    async getSession(sessionId, options) {
      return client.getAgentRuntimeSession(sessionId, options);
    },
    async getSessionReadModel(sessionId) {
      return client.getAgentRuntimeThreadRead(sessionId);
    },
    async replayRequest(sessionId, requestId) {
      return client.replayAgentRuntimeRequest({
        session_id: sessionId,
        request_id: requestId,
      });
    },
    async renameSession(sessionId, title) {
      await client.updateAgentRuntimeSession({
        session_id: sessionId,
        name: title,
      });
    },
    async deleteSession(sessionId) {
      await client.deleteAgentRuntimeSession(sessionId);
    },
    async setSessionExecutionStrategy(sessionId, executionStrategy) {
      await client.updateAgentRuntimeSession({
        session_id: sessionId,
        execution_strategy: executionStrategy,
      });
    },
    async setSessionAccessMode(sessionId, accessMode) {
      await client.updateAgentRuntimeSession({
        session_id: sessionId,
        recent_access_mode: accessMode,
      });
    },
    async setSessionProviderSelection(sessionId, providerType, model) {
      await client.updateAgentRuntimeSession({
        session_id: sessionId,
        provider_selector: providerType,
        model_name: model,
      });
    },
    async generateSessionTitle(sessionId) {
      return client.generateAgentRuntimeSessionTitle(sessionId);
    },
    async submitOp(op) {
      switch (op.type) {
        case "user_input":
          await client.submitAgentRuntimeTurn(
            createSubmitTurnRequestFromAgentOp(op),
          );
          return;
        default:
          throw new Error(`当前 runtime adapter 尚不支持 AgentOp: ${op.type}`);
      }
    },
    async compactSession(sessionId, eventName) {
      await client.compactAgentRuntimeSession({
        session_id: sessionId,
        event_name: eventName,
      });
    },
    async interruptTurn(sessionId) {
      return client.interruptAgentRuntimeTurn({
        session_id: sessionId,
      });
    },
    async resumeThread(sessionId) {
      return client.resumeAgentRuntimeThread({
        session_id: sessionId,
      });
    },
    async promoteQueuedTurn(sessionId, queuedTurnId) {
      return client.promoteAgentRuntimeQueuedTurn({
        session_id: sessionId,
        queued_turn_id: queuedTurnId,
      });
    },
    async removeQueuedTurn(sessionId, queuedTurnId) {
      return client.removeAgentRuntimeQueuedTurn({
        session_id: sessionId,
        queued_turn_id: queuedTurnId,
      });
    },
    async respondToAction(request) {
      await client.respondAgentRuntimeAction({
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
      return listenRuntimeEvent(eventName, handler);
    },
    async listenToTeamEvents(eventName, handler) {
      return listenRuntimeEvent(eventName, handler);
    },
  };
}

export const defaultAgentRuntimeAdapter = createAgentRuntimeAdapter();
