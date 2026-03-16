import { safeListen } from "@/lib/dev-bridge";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  createAgentRuntimeSession,
  deleteAgentRuntimeSession,
  getAgentRuntimeSession,
  initAsterAgent,
  interruptAgentRuntimeTurn,
  removeAgentRuntimeQueuedTurn,
  listAgentRuntimeSessions,
  respondAgentRuntimeAction,
  submitAgentRuntimeTurn,
  updateAgentRuntimeSession,
  type AsterExecutionStrategy,
  type AsterProviderConfig,
  type AgentSearchMode,
  type AsterSessionDetail,
  type AsterSessionInfo,
  type AutoContinueRequestPayload,
  type ImageInput,
} from "@/lib/api/agentRuntime";
import type { StreamEvent } from "@/lib/api/agentStream";

export interface AgentRuntimeTurnRequest {
  message: string;
  sessionId: string;
  eventName: string;
  workspaceId: string;
  images?: ImageInput[];
  providerConfig?: AsterProviderConfig;
  executionStrategy?: AsterExecutionStrategy;
  webSearch?: boolean;
  searchMode?: AgentSearchMode;
  autoContinue?: AutoContinueRequestPayload;
  systemPrompt?: string;
  metadata?: Record<string, unknown>;
  queueIfBusy?: boolean;
  queuedTurnId?: string;
}

export interface AgentRuntimeActionResponse {
  sessionId: string;
  requestId: string;
  actionType: "tool_confirmation" | "ask_user" | "elicitation";
  confirmed: boolean;
  response?: string;
  userData?: unknown;
  metadata?: Record<string, unknown>;
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
  renameSession(sessionId: string, title: string): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  setSessionExecutionStrategy(
    sessionId: string,
    executionStrategy: AsterExecutionStrategy,
  ): Promise<void>;
  submitTurn(request: AgentRuntimeTurnRequest): Promise<void>;
  interruptTurn(sessionId: string): Promise<boolean>;
  removeQueuedTurn(sessionId: string, queuedTurnId: string): Promise<boolean>;
  respondToAction(request: AgentRuntimeActionResponse): Promise<void>;
  listenToTurnEvents(
    eventName: string,
    handler: (event: { payload: StreamEvent | unknown }) => void,
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
  async submitTurn(request) {
    await submitAgentRuntimeTurn({
      message: request.message,
      session_id: request.sessionId,
      event_name: request.eventName,
      workspace_id: request.workspaceId,
      images: request.images,
      turn_config: {
        provider_config: request.providerConfig,
        execution_strategy: request.executionStrategy,
        web_search: request.webSearch,
        search_mode: request.searchMode,
        auto_continue: request.autoContinue,
        system_prompt: request.systemPrompt,
        metadata: request.metadata,
      },
      queue_if_busy: request.queueIfBusy,
      queued_turn_id: request.queuedTurnId,
    });
  },
  async interruptTurn(sessionId) {
    return interruptAgentRuntimeTurn({
      session_id: sessionId,
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
    });
  },
  async listenToTurnEvents(eventName, handler) {
    return safeListen<StreamEvent>(eventName, handler);
  },
};
