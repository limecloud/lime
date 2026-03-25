/**
 * Agent / Aster 现役运行时 API
 *
 * 仅保留当前仍在维护的进程、会话、流式与交互能力。
 */

import { safeInvoke } from "@/lib/dev-bridge";
import { logAgentDebug } from "@/lib/agentDebug";
import type {
  AgentMessage,
  AgentThreadItem,
  AgentThreadTurn,
} from "./agentProtocol";
import type {
  AsterExecutionStrategy,
  AsterSessionExecutionRuntime,
} from "./agentExecutionRuntime";
import {
  normalizeQueuedTurnSnapshots,
  type QueuedTurnSnapshot,
} from "./queuedTurn";

export type { QueuedTurnSnapshot } from "./queuedTurn";
export type {
  AsterExecutionStrategy,
  AsterSessionExecutionRuntime,
  AsterSessionExecutionRuntimeSource,
  AsterTurnOutputSchemaRuntime,
  AsterTurnOutputSchemaSource,
  AsterTurnOutputSchemaStrategy,
} from "./agentExecutionRuntime";

/**
 * Agent 状态
 */
export interface AgentProcessStatus {
  running: boolean;
  base_url?: string;
  port?: number;
}

/**
 * 图片输入
 */
export interface ImageInput {
  data: string;
  media_type: string;
}

const requireWorkspaceId = (
  workspaceId?: string,
  fallbackWorkspaceId?: string,
): string => {
  const resolvedWorkspaceId = (workspaceId ?? fallbackWorkspaceId)?.trim();
  if (!resolvedWorkspaceId) {
    throw new Error("workspaceId 不能为空，请先选择项目工作区");
  }
  return resolvedWorkspaceId;
};

/**
 * Aster Agent 状态
 */
export interface AsterAgentStatus {
  initialized: boolean;
  provider_configured: boolean;
  provider_name?: string;
  model_name?: string;
}

/**
 * Aster Provider 配置
 */
export interface AsterProviderConfig {
  provider_id?: string;
  provider_name: string;
  model_name: string;
  api_key?: string;
  base_url?: string;
}

export interface AutoContinueRequestPayload {
  enabled: boolean;
  fast_mode_enabled: boolean;
  continuation_length: number;
  sensitivity: number;
  source?: string;
}

export type AgentSearchMode = "disabled" | "allowed" | "required";

/**
 * Aster 会话信息（匹配后端 SessionInfo 结构）
 */
export interface AsterSessionInfo {
  id: string;
  name?: string;
  created_at: number;
  updated_at: number;
  model?: string;
  messages_count?: number;
  execution_strategy?: AsterExecutionStrategy;
  workspace_id?: string;
  working_dir?: string;
}

export interface AsterTodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  active_form?: string;
}

export interface AgentRuntimeRequestView {
  id: string;
  thread_id: string;
  turn_id?: string;
  item_id?: string;
  request_type: string;
  status: string;
  title?: string;
  payload?: unknown;
  decision?: unknown;
  scope?: Record<string, unknown>;
  created_at?: string | number;
  resolved_at?: string | number;
}

export interface AgentRuntimeOutcomeView {
  thread_id: string;
  turn_id?: string;
  outcome_type: string;
  summary?: string;
  primary_cause?: string;
  retryable?: boolean;
  ended_at?: string | number;
}

export interface AgentRuntimeIncidentView {
  id: string;
  thread_id: string;
  turn_id?: string;
  item_id?: string;
  incident_type: string;
  severity?: string;
  status?: string;
  title?: string;
  details?: unknown;
  detected_at?: string | number;
  cleared_at?: string | number;
}

export interface AgentRuntimeDiagnosticWarningSample {
  item_id: string;
  turn_id?: string;
  code?: string;
  message: string;
  updated_at: string | number;
}

export interface AgentRuntimeDiagnosticContextCompactionSample {
  item_id: string;
  turn_id?: string;
  stage: string;
  trigger?: string;
  detail?: string;
  updated_at: string | number;
}

export interface AgentRuntimeDiagnosticFailedToolSample {
  item_id: string;
  turn_id?: string;
  tool_name: string;
  error?: string;
  updated_at: string | number;
}

export interface AgentRuntimeDiagnosticFailedCommandSample {
  item_id: string;
  turn_id?: string;
  command: string;
  exit_code?: number;
  error?: string;
  updated_at: string | number;
}

export interface AgentRuntimeDiagnosticPendingRequestSample {
  request_id: string;
  turn_id?: string;
  request_type: string;
  title?: string;
  waited_seconds?: number;
  created_at?: string | number;
}

export interface AgentRuntimeThreadDiagnostics {
  latest_turn_status?: string;
  latest_turn_started_at?: string | number;
  latest_turn_completed_at?: string | number;
  latest_turn_updated_at?: string | number;
  latest_turn_elapsed_seconds?: number;
  latest_turn_stalled_seconds?: number;
  latest_turn_error_message?: string;
  interrupt_reason?: string;
  runtime_interrupt_source?: string;
  runtime_interrupt_requested_at?: string | number;
  runtime_interrupt_wait_seconds?: number;
  warning_count: number;
  context_compaction_count: number;
  failed_tool_call_count: number;
  failed_command_count: number;
  pending_request_count: number;
  oldest_pending_request_wait_seconds?: number;
  primary_blocking_kind?: string;
  primary_blocking_summary?: string;
  latest_warning?: AgentRuntimeDiagnosticWarningSample | null;
  latest_context_compaction?: AgentRuntimeDiagnosticContextCompactionSample | null;
  latest_failed_tool?: AgentRuntimeDiagnosticFailedToolSample | null;
  latest_failed_command?: AgentRuntimeDiagnosticFailedCommandSample | null;
  latest_pending_request?: AgentRuntimeDiagnosticPendingRequestSample | null;
}

export interface AgentRuntimeThreadReadModel {
  thread_id: string;
  status?: string;
  active_turn_id?: string;
  pending_requests?: AgentRuntimeRequestView[];
  last_outcome?: AgentRuntimeOutcomeView | null;
  incidents?: AgentRuntimeIncidentView[];
  queued_turns?: QueuedTurnSnapshot[];
  interrupt_state?: string;
  updated_at?: string | number;
  diagnostics?: AgentRuntimeThreadDiagnostics | null;
}

export interface AsterSubagentSessionInfo {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
  session_type: string;
  model?: string;
  provider_name?: string;
  working_dir?: string;
  workspace_id?: string;
  task_summary?: string;
  role_hint?: string;
  origin_tool?: string;
  created_from_turn_id?: string;
  blueprint_role_id?: string;
  blueprint_role_label?: string;
  profile_id?: string;
  profile_name?: string;
  role_key?: string;
  team_preset_id?: string;
  theme?: string;
  output_contract?: string;
  skill_ids?: string[];
  skills?: AsterSubagentSkillInfo[];
  runtime_status?:
    | "idle"
    | "queued"
    | "running"
    | "completed"
    | "failed"
    | "aborted"
    | "closed";
  latest_turn_status?:
    | "idle"
    | "queued"
    | "running"
    | "completed"
    | "failed"
    | "aborted"
    | "closed";
  queued_turn_count?: number;
  team_phase?: "queued" | "running";
  team_parallel_budget?: number;
  team_active_count?: number;
  team_queued_count?: number;
  provider_concurrency_group?: string;
  provider_parallel_budget?: number;
  queue_reason?: string;
  retryable_overload?: boolean;
}

export interface AsterSubagentSkillInfo {
  id: string;
  name: string;
  description?: string;
  source?: string;
  directory?: string;
}

export interface AsterSubagentParentContext {
  parent_session_id: string;
  parent_session_name: string;
  role_hint?: string;
  task_summary?: string;
  origin_tool?: string;
  created_from_turn_id?: string;
  blueprint_role_id?: string;
  blueprint_role_label?: string;
  profile_id?: string;
  profile_name?: string;
  role_key?: string;
  team_preset_id?: string;
  theme?: string;
  output_contract?: string;
  skill_ids?: string[];
  skills?: AsterSubagentSkillInfo[];
  sibling_subagent_sessions?: AsterSubagentSessionInfo[];
}

/**
 * Aster 会话详情（匹配后端 SessionDetail 结构）
 */
export interface AsterSessionDetail {
  id: string;
  thread_id?: string;
  name?: string;
  created_at: number;
  updated_at: number;
  model?: string;
  workspace_id?: string;
  working_dir?: string;
  execution_strategy?: AsterExecutionStrategy;
  execution_runtime?: AsterSessionExecutionRuntime | null;
  messages: AgentMessage[];
  turns?: AgentThreadTurn[];
  items?: AgentThreadItem[];
  queued_turns?: QueuedTurnSnapshot[];
  thread_read?: AgentRuntimeThreadReadModel | null;
  todo_items?: AsterTodoItem[];
  child_subagent_sessions?: AsterSubagentSessionInfo[];
  subagent_parent_context?: AsterSubagentParentContext;
}

function normalizeThreadReadModel(
  threadRead?: AgentRuntimeThreadReadModel | null,
): AgentRuntimeThreadReadModel | null | undefined {
  if (!threadRead) {
    return threadRead;
  }

  return {
    ...threadRead,
    queued_turns: normalizeQueuedTurnSnapshots(threadRead.queued_turns),
  };
}

export interface AgentTurnConfigSnapshot {
  provider_config?: AsterProviderConfig;
  provider_preference?: string;
  model_preference?: string;
  thinking_enabled?: boolean;
  execution_strategy?: AsterExecutionStrategy;
  web_search?: boolean;
  search_mode?: AgentSearchMode;
  auto_continue?: AutoContinueRequestPayload;
  system_prompt?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentRuntimeSubmitTurnRequest {
  message: string;
  session_id: string;
  event_name: string;
  workspace_id: string;
  turn_id?: string;
  images?: ImageInput[];
  turn_config?: AgentTurnConfigSnapshot;
  queue_if_busy?: boolean;
  queued_turn_id?: string;
}

export interface AgentRuntimeInterruptTurnRequest {
  session_id: string;
  turn_id?: string;
}

export interface AgentRuntimeCompactSessionRequest {
  session_id: string;
  event_name: string;
}

export interface AgentRuntimeResumeThreadRequest {
  session_id: string;
}

export interface AgentRuntimeReplayRequestRequest {
  session_id: string;
  request_id: string;
}

export interface AgentRuntimeRemoveQueuedTurnRequest {
  session_id: string;
  queued_turn_id: string;
}

export interface AgentRuntimePromoteQueuedTurnRequest {
  session_id: string;
  queued_turn_id: string;
}

export interface AgentRuntimeRespondActionRequest {
  session_id: string;
  request_id: string;
  action_type: "tool_confirmation" | "ask_user" | "elicitation";
  confirmed: boolean;
  response?: string;
  user_data?: unknown;
  metadata?: Record<string, unknown>;
  event_name?: string;
  action_scope?: {
    session_id?: string;
    thread_id?: string;
    turn_id?: string;
  };
}

export interface AgentRuntimeReplayedActionRequiredView {
  type: "action_required";
  request_id: string;
  action_type: "tool_confirmation" | "ask_user" | "elicitation";
  tool_name?: string;
  arguments?: Record<string, unknown>;
  prompt?: string;
  questions?: unknown;
  requested_schema?: Record<string, unknown>;
  scope?: {
    session_id?: string;
    thread_id?: string;
    turn_id?: string;
  };
}

export interface AgentRuntimeUpdateSessionRequest {
  session_id: string;
  name?: string;
  execution_strategy?: AsterExecutionStrategy;
}

export interface AgentRuntimeSpawnSubagentRequest {
  parent_session_id: string;
  message: string;
  agent_type?: string;
  model?: string;
  reasoning_effort?: string;
  fork_context?: boolean;
  blueprint_role_id?: string;
  blueprint_role_label?: string;
  profile_id?: string;
  profile_name?: string;
  role_key?: string;
  skill_ids?: string[];
  skill_directories?: string[];
  team_preset_id?: string;
  theme?: string;
  system_overlay?: string;
  output_contract?: string;
}

export interface AgentRuntimeSpawnSubagentResponse {
  agent_id: string;
  nickname?: string;
}

export interface AgentRuntimeSendSubagentInputRequest {
  id: string;
  message: string;
  interrupt?: boolean;
}

export interface AgentRuntimeSendSubagentInputResponse {
  submission_id: string;
}

export interface AgentRuntimeStatusSnapshot {
  session_id: string;
  kind:
    | "idle"
    | "queued"
    | "running"
    | "completed"
    | "failed"
    | "aborted"
    | "closed"
    | "not_found";
  latest_turn_id?: string;
  latest_turn_status?:
    | "idle"
    | "queued"
    | "running"
    | "completed"
    | "failed"
    | "aborted"
    | "closed"
    | "not_found";
  queued_turn_count?: number;
  closed?: boolean;
}

export interface AgentRuntimeWaitSubagentsRequest {
  ids: string[];
  timeout_ms?: number;
}

export interface AgentRuntimeWaitSubagentsResponse {
  status: Record<string, AgentRuntimeStatusSnapshot>;
  timed_out: boolean;
}

export interface AgentRuntimeResumeSubagentRequest {
  id: string;
}

export interface AgentRuntimeResumeSubagentResponse {
  status: AgentRuntimeStatusSnapshot;
  cascade_session_ids: string[];
  changed_session_ids: string[];
}

export interface AgentRuntimeCloseSubagentRequest {
  id: string;
}

export interface AgentRuntimeCloseSubagentResponse {
  previous_status: AgentRuntimeStatusSnapshot;
  cascade_session_ids: string[];
  changed_session_ids: string[];
}

export type AgentToolSurfaceProfile = "core" | "creator" | "browser_assist";

export type AgentToolCapability =
  | "planning"
  | "delegation"
  | "web_search"
  | "skill_execution"
  | "session_control"
  | "content_creation"
  | "browser_runtime"
  | "workspace_io"
  | "execution"
  | "vision";

export type AgentToolLifecycle = "current" | "compat" | "deprecated";

export type AgentToolSourceKind =
  | "aster_builtin"
  | "lime_injected"
  | "browser_compatibility";

export type AgentToolPermissionPlane =
  | "session_allowlist"
  | "parameter_restricted"
  | "caller_filtered";

export type AgentToolExecutionWarningPolicy = "none" | "shell_command_risk";

export type AgentToolExecutionRestrictionProfile =
  | "none"
  | "workspace_path_required"
  | "workspace_path_optional"
  | "workspace_absolute_path_required"
  | "workspace_shell_command"
  | "analyze_image_input"
  | "safe_https_url_required";

export type AgentToolExecutionSandboxProfile = "none" | "workspace_command";
export type AgentToolExecutionPolicySource =
  | "default"
  | "persisted"
  | "runtime";

export type AgentRuntimeExtensionSourceKind =
  | "mcp_bridge"
  | "runtime_extension";

export interface AgentRuntimeToolInventoryRequest {
  caller?: string;
  creator?: boolean;
  browserAssist?: boolean;
  metadata?: Record<string, unknown>;
}

export interface AgentRuntimeToolInventorySurface {
  creator: boolean;
  browser_assist: boolean;
}

export interface AgentRuntimeToolInventoryCatalogEntry {
  name: string;
  profiles: AgentToolSurfaceProfile[];
  capabilities: AgentToolCapability[];
  lifecycle: AgentToolLifecycle;
  source: AgentToolSourceKind;
  permission_plane: AgentToolPermissionPlane;
  workspace_default_allow: boolean;
  execution_warning_policy: AgentToolExecutionWarningPolicy;
  execution_warning_policy_source: AgentToolExecutionPolicySource;
  execution_restriction_profile: AgentToolExecutionRestrictionProfile;
  execution_restriction_profile_source: AgentToolExecutionPolicySource;
  execution_sandbox_profile: AgentToolExecutionSandboxProfile;
  execution_sandbox_profile_source: AgentToolExecutionPolicySource;
}

export interface AgentRuntimeToolInventoryRegistryEntry {
  name: string;
  description: string;
  catalog_entry_name?: string;
  catalog_source?: AgentToolSourceKind;
  catalog_lifecycle?: AgentToolLifecycle;
  catalog_permission_plane?: AgentToolPermissionPlane;
  catalog_workspace_default_allow?: boolean;
  catalog_execution_warning_policy?: AgentToolExecutionWarningPolicy;
  catalog_execution_warning_policy_source?: AgentToolExecutionPolicySource;
  catalog_execution_restriction_profile?: AgentToolExecutionRestrictionProfile;
  catalog_execution_restriction_profile_source?: AgentToolExecutionPolicySource;
  catalog_execution_sandbox_profile?: AgentToolExecutionSandboxProfile;
  catalog_execution_sandbox_profile_source?: AgentToolExecutionPolicySource;
  deferred_loading: boolean;
  always_visible: boolean;
  allowed_callers: string[];
  tags: string[];
  input_examples_count: number;
  caller_allowed: boolean;
  visible_in_context: boolean;
}

export interface AgentRuntimeToolInventoryExtensionSurfaceEntry {
  extension_name: string;
  description: string;
  source_kind: AgentRuntimeExtensionSourceKind;
  deferred_loading: boolean;
  allowed_caller?: string;
  available_tools: string[];
  always_expose_tools: string[];
  loaded_tools: string[];
  searchable_tools: string[];
}

export interface AgentRuntimeToolInventoryExtensionToolEntry {
  name: string;
  description: string;
  extension_name?: string;
  source_kind: AgentRuntimeExtensionSourceKind;
  deferred_loading: boolean;
  allowed_caller?: string;
  status: string;
  caller_allowed: boolean;
  visible_in_context: boolean;
}

export interface AgentRuntimeToolInventoryMcpEntry {
  server_name: string;
  name: string;
  description: string;
  deferred_loading: boolean;
  always_visible: boolean;
  allowed_callers: string[];
  tags: string[];
  input_examples_count: number;
  caller_allowed: boolean;
  visible_in_context: boolean;
}

export interface AgentRuntimeToolInventoryCounts {
  catalog_total: number;
  catalog_current_total: number;
  catalog_compat_total: number;
  catalog_deprecated_total: number;
  default_allowed_total: number;
  registry_total: number;
  registry_visible_total: number;
  registry_catalog_unmapped_total: number;
  extension_surface_total: number;
  extension_mcp_bridge_total: number;
  extension_runtime_total: number;
  extension_tool_total: number;
  extension_tool_visible_total: number;
  mcp_server_total: number;
  mcp_tool_total: number;
  mcp_tool_visible_total: number;
}

export interface AgentRuntimeToolInventory {
  request: {
    caller: string;
    surface: AgentRuntimeToolInventorySurface;
  };
  agent_initialized: boolean;
  warnings: string[];
  mcp_servers: string[];
  default_allowed_tools: string[];
  counts: AgentRuntimeToolInventoryCounts;
  catalog_tools: AgentRuntimeToolInventoryCatalogEntry[];
  registry_tools: AgentRuntimeToolInventoryRegistryEntry[];
  extension_surfaces: AgentRuntimeToolInventoryExtensionSurfaceEntry[];
  extension_tools: AgentRuntimeToolInventoryExtensionToolEntry[];
  mcp_tools: AgentRuntimeToolInventoryMcpEntry[];
}

export async function submitAgentRuntimeTurn(
  request: AgentRuntimeSubmitTurnRequest,
): Promise<void> {
  return await safeInvoke("agent_runtime_submit_turn", { request });
}

export async function interruptAgentRuntimeTurn(
  request: AgentRuntimeInterruptTurnRequest,
): Promise<boolean> {
  return await safeInvoke("agent_runtime_interrupt_turn", { request });
}

export async function compactAgentRuntimeSession(
  request: AgentRuntimeCompactSessionRequest,
): Promise<void> {
  return await safeInvoke("agent_runtime_compact_session", { request });
}

export async function resumeAgentRuntimeThread(
  request: AgentRuntimeResumeThreadRequest,
): Promise<boolean> {
  return await safeInvoke("agent_runtime_resume_thread", { request });
}

export async function replayAgentRuntimeRequest(
  request: AgentRuntimeReplayRequestRequest,
): Promise<AgentRuntimeReplayedActionRequiredView | null> {
  return await safeInvoke("agent_runtime_replay_request", { request });
}

export async function removeAgentRuntimeQueuedTurn(
  request: AgentRuntimeRemoveQueuedTurnRequest,
): Promise<boolean> {
  return await safeInvoke("agent_runtime_remove_queued_turn", { request });
}

export async function promoteAgentRuntimeQueuedTurn(
  request: AgentRuntimePromoteQueuedTurnRequest,
): Promise<boolean> {
  return await safeInvoke("agent_runtime_promote_queued_turn", { request });
}

export async function respondAgentRuntimeAction(
  request: AgentRuntimeRespondActionRequest,
): Promise<void> {
  return await safeInvoke("agent_runtime_respond_action", { request });
}

export async function createAgentRuntimeSession(
  workspaceId: string,
  name?: string,
  executionStrategy?: AsterExecutionStrategy,
): Promise<string> {
  return await safeInvoke("agent_runtime_create_session", {
    workspaceId: requireWorkspaceId(workspaceId),
    name,
    executionStrategy,
  });
}

export async function listAgentRuntimeSessions(): Promise<AsterSessionInfo[]> {
  const startedAt = Date.now();
  let settled = false;
  const slowTimer: number | null =
    typeof window !== "undefined"
      ? window.setTimeout(() => {
          if (settled) {
            return;
          }
          logAgentDebug(
            "AgentApi",
            "runtimeListSessions.slow",
            {
              elapsedMs: Date.now() - startedAt,
            },
            {
              dedupeKey: "runtimeListSessions.slow",
              level: "warn",
              throttleMs: 1000,
            },
          );
        }, 1000)
      : null;

  logAgentDebug("AgentApi", "runtimeListSessions.start");

  try {
    const sessions = await safeInvoke<AsterSessionInfo[]>(
      "agent_runtime_list_sessions",
    );
    settled = true;
    logAgentDebug("AgentApi", "runtimeListSessions.success", {
      durationMs: Date.now() - startedAt,
      sessionsCount: sessions.length,
    });
    return sessions;
  } catch (error) {
    settled = true;
    logAgentDebug(
      "AgentApi",
      "runtimeListSessions.error",
      {
        durationMs: Date.now() - startedAt,
        error,
      },
      { level: "error" },
    );
    throw error;
  } finally {
    if (slowTimer !== null) {
      clearTimeout(slowTimer);
    }
  }
}

export async function getAgentRuntimeSession(
  sessionId: string,
): Promise<AsterSessionDetail> {
  const detail = await safeInvoke("agent_runtime_get_session", { sessionId });
  const normalizedDetail = detail as AsterSessionDetail | null | undefined;
  return {
    ...(detail as AsterSessionDetail),
    queued_turns: normalizeQueuedTurnSnapshots(
      normalizedDetail?.queued_turns,
    ),
    thread_read: normalizeThreadReadModel(normalizedDetail?.thread_read),
  };
}

export async function getAgentRuntimeThreadRead(
  sessionId: string,
): Promise<AgentRuntimeThreadReadModel> {
  const threadRead = await safeInvoke("agent_runtime_get_thread_read", {
    sessionId,
  });
  return normalizeThreadReadModel(
    threadRead as AgentRuntimeThreadReadModel | null | undefined,
  ) as AgentRuntimeThreadReadModel;
}

export async function getAgentRuntimeToolInventory(
  request: AgentRuntimeToolInventoryRequest = {},
): Promise<AgentRuntimeToolInventory> {
  return await safeInvoke("agent_runtime_get_tool_inventory", { request });
}

export async function updateAgentRuntimeSession(
  request: AgentRuntimeUpdateSessionRequest,
): Promise<void> {
  return await safeInvoke("agent_runtime_update_session", { request });
}

export async function spawnAgentRuntimeSubagent(
  request: AgentRuntimeSpawnSubagentRequest,
): Promise<AgentRuntimeSpawnSubagentResponse> {
  return await safeInvoke("agent_runtime_spawn_subagent", { request });
}

export async function sendAgentRuntimeSubagentInput(
  request: AgentRuntimeSendSubagentInputRequest,
): Promise<AgentRuntimeSendSubagentInputResponse> {
  return await safeInvoke("agent_runtime_send_subagent_input", { request });
}

export async function waitAgentRuntimeSubagents(
  request: AgentRuntimeWaitSubagentsRequest,
): Promise<AgentRuntimeWaitSubagentsResponse> {
  return await safeInvoke("agent_runtime_wait_subagents", { request });
}

export async function resumeAgentRuntimeSubagent(
  request: AgentRuntimeResumeSubagentRequest,
): Promise<AgentRuntimeResumeSubagentResponse> {
  return await safeInvoke("agent_runtime_resume_subagent", { request });
}

export async function closeAgentRuntimeSubagent(
  request: AgentRuntimeCloseSubagentRequest,
): Promise<AgentRuntimeCloseSubagentResponse> {
  return await safeInvoke("agent_runtime_close_subagent", { request });
}

export async function deleteAgentRuntimeSession(
  sessionId: string,
): Promise<void> {
  return await safeInvoke("agent_runtime_delete_session", { sessionId });
}

/**
 * 启动 Agent（初始化原生 Agent）
 */
export async function startAgentProcess(): Promise<AgentProcessStatus> {
  return await safeInvoke("agent_start_process", {});
}

/**
 * 停止 Agent
 */
export async function stopAgentProcess(): Promise<void> {
  return await safeInvoke("agent_stop_process");
}

/**
 * 获取 Agent 状态
 */
export async function getAgentProcessStatus(): Promise<AgentProcessStatus> {
  return await safeInvoke("agent_get_process_status");
}

/**
 * 生成会话智能标题
 *
 * 现役 runtime 命名入口。
 */
export async function generateAgentRuntimeSessionTitle(
  sessionId: string,
): Promise<string> {
  return await safeInvoke("agent_generate_title", {
    sessionId,
  });
}

/**
 * 初始化 Aster Agent
 */
export async function initAsterAgent(): Promise<AsterAgentStatus> {
  return await safeInvoke("aster_agent_init");
}

/**
 * 获取 Aster Agent 状态
 */
export async function getAsterAgentStatus(): Promise<AsterAgentStatus> {
  return await safeInvoke("aster_agent_status");
}

/**
 * 配置 Aster Agent 的 Provider
 */
export async function configureAsterProvider(
  config: AsterProviderConfig,
  sessionId: string,
): Promise<AsterAgentStatus> {
  return await safeInvoke("aster_agent_configure_provider", {
    request: config,
    session_id: sessionId,
  });
}
