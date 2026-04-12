/**
 * Agent / Aster 现役运行时 API
 *
 * 仅保留当前仍在维护的进程、会话、流式与交互能力。
 */

import type {
  AgentMessage,
  AgentThreadItem,
  AgentThreadTurn,
} from "../agentProtocol";
import type {
  AsterApprovalPolicy,
  AsterExecutionStrategy,
  AsterSandboxPolicy,
  AsterSessionExecutionRuntime,
  AsterSessionExecutionRuntimeAccessMode,
  AsterSessionExecutionRuntimePreferences,
  AsterSessionExecutionRuntimeRecentTeamSelection,
} from "../agentExecutionRuntime";
import type { QueuedTurnSnapshot } from "../queuedTurn";
import type { ModelCapabilities } from "@/lib/types/modelRegistry";

export type { QueuedTurnSnapshot } from "../queuedTurn";
export type {
  AsterApprovalPolicy,
  AsterExecutionStrategy,
  AsterSandboxPolicy,
  AsterSessionExecutionRuntime,
  AsterSessionExecutionRuntimeAccessMode,
  AsterSessionExecutionRuntimePreferences,
  AsterSessionExecutionRuntimeRecentTeamRole,
  AsterSessionExecutionRuntimeRecentTeamSelection,
  AsterSessionExecutionRuntimeRecentTeamSource,
  AsterSessionExecutionRuntimeSource,
  AsterTurnOutputSchemaRuntime,
  AsterTurnOutputSchemaSource,
  AsterTurnOutputSchemaStrategy,
} from "../agentExecutionRuntime";

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

/**
 * Aster Agent 状态
 */
export interface AsterAgentStatus {
  initialized: boolean;
  provider_configured: boolean;
  provider_name?: string;
  provider_selector?: string;
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
  model_capabilities?: ModelCapabilities;
  tool_call_strategy?: "native" | "tool_shim";
  toolshim_model?: string;
}

export interface AutoContinueRequestPayload {
  enabled: boolean;
  fast_mode_enabled: boolean;
  continuation_length: number;
  sensitivity: number;
  source?: string;
}

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

export interface AgentRuntimeCompactionBoundarySnapshot {
  session_id: string;
  summary_preview: string;
  turn_count?: number;
  created_at: string | number;
  trigger?: string;
  detail?: string;
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
  latest_compaction_boundary?: AgentRuntimeCompactionBoundarySnapshot | null;
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

export type AgentRuntimeHandoffArtifactKind =
  | "plan"
  | "progress"
  | "handoff"
  | "review_summary";

export interface AgentRuntimeHandoffArtifact {
  kind: AgentRuntimeHandoffArtifactKind;
  title: string;
  relative_path: string;
  absolute_path: string;
  bytes: number;
}

export interface AgentRuntimeHandoffBundle {
  session_id: string;
  thread_id: string;
  workspace_id?: string;
  workspace_root: string;
  bundle_relative_root: string;
  bundle_absolute_root: string;
  exported_at: string;
  thread_status: string;
  latest_turn_status?: string;
  pending_request_count: number;
  queued_turn_count: number;
  active_subagent_count: number;
  todo_total: number;
  todo_pending: number;
  todo_in_progress: number;
  todo_completed: number;
  artifacts: AgentRuntimeHandoffArtifact[];
}

export type AgentRuntimeEvidenceArtifactKind =
  | "summary"
  | "runtime"
  | "timeline"
  | "artifacts";

export interface AgentRuntimeEvidenceArtifact {
  kind: AgentRuntimeEvidenceArtifactKind;
  title: string;
  relative_path: string;
  absolute_path: string;
  bytes: number;
}

export interface AgentRuntimeEvidencePack {
  session_id: string;
  thread_id: string;
  workspace_id?: string;
  workspace_root: string;
  pack_relative_root: string;
  pack_absolute_root: string;
  exported_at: string;
  thread_status: string;
  latest_turn_status?: string;
  turn_count: number;
  item_count: number;
  pending_request_count: number;
  queued_turn_count: number;
  recent_artifact_count: number;
  known_gaps: string[];
  artifacts: AgentRuntimeEvidenceArtifact[];
}

export type AgentRuntimeReplayArtifactKind =
  | "input"
  | "expected"
  | "grader"
  | "evidence_links";

export interface AgentRuntimeReplayArtifact {
  kind: AgentRuntimeReplayArtifactKind;
  title: string;
  relative_path: string;
  absolute_path: string;
  bytes: number;
}

export interface AgentRuntimeReplayCase {
  session_id: string;
  thread_id: string;
  workspace_id?: string;
  workspace_root: string;
  replay_relative_root: string;
  replay_absolute_root: string;
  handoff_bundle_relative_root: string;
  evidence_pack_relative_root: string;
  exported_at: string;
  thread_status: string;
  latest_turn_status?: string;
  pending_request_count: number;
  queued_turn_count: number;
  linked_handoff_artifact_count: number;
  linked_evidence_artifact_count: number;
  recent_artifact_count: number;
  artifacts: AgentRuntimeReplayArtifact[];
}

export type AgentRuntimeAnalysisArtifactKind =
  | "analysis_brief"
  | "analysis_context";

export interface AgentRuntimeAnalysisArtifact {
  kind: AgentRuntimeAnalysisArtifactKind;
  title: string;
  relative_path: string;
  absolute_path: string;
  bytes: number;
}

export interface AgentRuntimeAnalysisHandoff {
  session_id: string;
  thread_id: string;
  workspace_id?: string;
  workspace_root: string;
  analysis_relative_root: string;
  analysis_absolute_root: string;
  handoff_bundle_relative_root: string;
  evidence_pack_relative_root: string;
  replay_case_relative_root: string;
  exported_at: string;
  title: string;
  thread_status: string;
  latest_turn_status?: string;
  pending_request_count: number;
  queued_turn_count: number;
  sanitized_workspace_root: string;
  copy_prompt: string;
  artifacts: AgentRuntimeAnalysisArtifact[];
}

export type AgentRuntimeReviewDecisionArtifactKind =
  | "review_decision_markdown"
  | "review_decision_json";

export type AgentRuntimeReviewDecisionStatus =
  | "accepted"
  | "deferred"
  | "rejected"
  | "needs_more_evidence"
  | "pending_review";

export type AgentRuntimeReviewDecisionRiskLevel =
  | "low"
  | "medium"
  | "high"
  | "unknown";

export interface AgentRuntimeReviewDecisionArtifact {
  kind: AgentRuntimeReviewDecisionArtifactKind;
  title: string;
  relative_path: string;
  absolute_path: string;
  bytes: number;
}

export interface AgentRuntimeReviewDecision {
  decision_status: AgentRuntimeReviewDecisionStatus;
  decision_summary: string;
  chosen_fix_strategy: string;
  risk_level: AgentRuntimeReviewDecisionRiskLevel;
  risk_tags: string[];
  human_reviewer: string;
  reviewed_at?: string;
  followup_actions: string[];
  regression_requirements: string[];
  notes: string;
}

export interface AgentRuntimeSaveReviewDecisionRequest extends AgentRuntimeReviewDecision {
  session_id: string;
}

export interface AgentRuntimeReviewDecisionTemplate {
  session_id: string;
  thread_id: string;
  workspace_id?: string;
  workspace_root: string;
  review_relative_root: string;
  review_absolute_root: string;
  analysis_relative_root: string;
  analysis_absolute_root: string;
  handoff_bundle_relative_root: string;
  evidence_pack_relative_root: string;
  replay_case_relative_root: string;
  exported_at: string;
  title: string;
  thread_status: string;
  latest_turn_status?: string;
  pending_request_count: number;
  queued_turn_count: number;
  default_decision_status: string;
  decision: AgentRuntimeReviewDecision;
  decision_status_options: AgentRuntimeReviewDecisionStatus[];
  risk_level_options: AgentRuntimeReviewDecisionRiskLevel[];
  review_checklist: string[];
  analysis_artifacts: AgentRuntimeAnalysisArtifact[];
  artifacts: AgentRuntimeReviewDecisionArtifact[];
}

export interface AgentTurnConfigSnapshot {
  provider_config?: AsterProviderConfig;
  provider_preference?: string;
  model_preference?: string;
  thinking_enabled?: boolean;
  approval_policy?: AsterApprovalPolicy;
  sandbox_policy?: AsterSandboxPolicy;
  execution_strategy?: AsterExecutionStrategy;
  web_search?: boolean;
  auto_continue?: AutoContinueRequestPayload;
  system_prompt?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentRuntimeSubmitTurnRequest {
  message: string;
  session_id: string;
  event_name: string;
  workspace_id?: string;
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
  provider_name?: string;
  model_name?: string;
  execution_strategy?: AsterExecutionStrategy;
  recent_access_mode?: AsterSessionExecutionRuntimeAccessMode;
  recent_preferences?: AsterSessionExecutionRuntimePreferences;
  recent_team_selection?: AsterSessionExecutionRuntimeRecentTeamSelection;
}

export interface AgentRuntimeSpawnSubagentRequest {
  parent_session_id: string;
  message: string;
  name?: string;
  team_name?: string;
  agent_type?: string;
  model?: string;
  run_in_background?: boolean;
  mode?: string;
  isolation?: "worktree" | "remote" | string;
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
  cwd?: string;
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

export interface CreateImageGenerationTaskArtifactRequest {
  projectRootPath: string;
  prompt: string;
  title?: string;
  mode?: "generate" | "edit" | "variation";
  rawText?: string;
  size?: string;
  aspectRatio?: string;
  count?: number;
  usage?: string;
  style?: string;
  providerId?: string;
  model?: string;
  sessionId?: string;
  projectId?: string;
  contentId?: string;
  entrySource?: string;
  requestedTarget?: "generate" | "cover";
  slotId?: string;
  anchorHint?: string;
  anchorSectionTitle?: string;
  anchorText?: string;
  targetOutputId?: string;
  targetOutputRefId?: string;
  referenceImages?: string[];
}

export interface MediaTaskArtifactRecord {
  task_id: string;
  task_type: string;
  task_family: string;
  title?: string | null;
  summary?: string | null;
  payload: Record<string, unknown>;
  status: string;
  normalized_status: string;
  created_at: string;
  updated_at?: string | null;
  current_attempt_id?: string | null;
  idempotency_key?: string | null;
  retry_count?: number;
  result?: unknown;
  last_error?: Record<string, unknown> | null;
  attempts?: Array<Record<string, unknown>>;
  relationships?: Record<string, unknown>;
  progress?: Record<string, unknown>;
  ui_hints?: Record<string, unknown>;
}

export interface MediaTaskArtifactOutput {
  success: boolean;
  task_id: string;
  task_type: string;
  task_family: string;
  status: string;
  normalized_status: string;
  current_attempt_id?: string | null;
  path: string;
  absolute_path: string;
  artifact_path: string;
  absolute_artifact_path: string;
  reused_existing: boolean;
  idempotency_key?: string | null;
  record: MediaTaskArtifactRecord;
}

export interface MediaTaskLookupRequest {
  projectRootPath: string;
  taskRef: string;
}

export interface ListMediaTaskArtifactsRequest {
  projectRootPath: string;
  status?: string;
  taskFamily?: string;
  taskType?: string;
  limit?: number;
}

export interface MediaTaskListFilters {
  status?: string | null;
  task_family?: string | null;
  task_type?: string | null;
  limit?: number | null;
}

export interface ListMediaTaskArtifactsOutput {
  success: boolean;
  workspace_root: string;
  artifact_root: string;
  filters: MediaTaskListFilters;
  total: number;
  tasks: MediaTaskArtifactOutput[];
}

export type AgentToolSurfaceProfile = "core" | "workbench" | "browser_assist";

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
  workbench?: boolean;
  browserAssist?: boolean;
  metadata?: Record<string, unknown>;
}

export interface AgentRuntimeToolInventorySurface {
  workbench: boolean;
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
