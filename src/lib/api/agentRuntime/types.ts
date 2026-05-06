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
  AsterSessionExecutionRuntimeCostState,
  AsterSessionExecutionRuntimeLimitEvent,
  AsterSessionExecutionRuntime,
  AsterSessionExecutionRuntimeAccessMode,
  AsterSessionExecutionRuntimeLimitState,
  AsterSessionExecutionRuntimePermissionState,
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
  AsterSessionExecutionRuntimeCostState,
  AsterSessionExecutionRuntimeLimitEvent,
  AsterSessionExecutionRuntime,
  AsterSessionExecutionRuntimeAccessMode,
  AsterSessionExecutionRuntimeLimitState,
  AsterSessionExecutionRuntimePermissionState,
  AsterSessionExecutionRuntimePreferences,
  AsterSessionExecutionRuntimeRecentTeamRole,
  AsterSessionExecutionRuntimeRecentTeamSelection,
  AsterSessionExecutionRuntimeRecentTeamSource,
  AsterSessionExecutionRuntimeRoutingDecision,
  AsterSessionExecutionRuntimeSource,
  AsterSessionExecutionRuntimeTaskProfile,
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

export interface AgentRuntimeGeneratedTitleResult {
  title: string;
  sessionId?: string | null;
  executionRuntime?: AsterSessionExecutionRuntime | null;
  usedFallback?: boolean;
  fallbackReason?: string | null;
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
  archived_at?: number | null;
  model?: string;
  messages_count?: number;
  execution_strategy?: AsterExecutionStrategy;
  workspace_id?: string;
  working_dir?: string;
}

export interface AgentRuntimeListSessionsOptions {
  includeArchived?: boolean;
  archivedOnly?: boolean;
  workspaceId?: string;
  limit?: number;
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

export interface AgentRuntimeFileCheckpointSummary {
  checkpoint_id: string;
  turn_id: string;
  path: string;
  source: string;
  updated_at: string | number;
  version_no?: number;
  version_id?: string;
  request_id?: string;
  title?: string;
  kind?: string;
  status?: string;
  preview_text?: string;
  snapshot_path?: string;
  validation_issue_count: number;
}

export interface AgentRuntimeFileCheckpointThreadSummary {
  count: number;
  latest_checkpoint?: AgentRuntimeFileCheckpointSummary | null;
}

export interface AgentRuntimeFileCheckpointListResult {
  session_id: string;
  thread_id: string;
  checkpoint_count: number;
  checkpoints: AgentRuntimeFileCheckpointSummary[];
}

export interface AgentRuntimeFileCheckpointDetail {
  session_id: string;
  thread_id: string;
  checkpoint: AgentRuntimeFileCheckpointSummary;
  live_path: string;
  snapshot_path: string;
  checkpoint_document?: unknown;
  live_document?: unknown;
  version_history: unknown[];
  validation_issues: string[];
  metadata?: unknown;
  content?: string;
}

export interface AgentRuntimeFileCheckpointDiffResult {
  session_id: string;
  thread_id: string;
  checkpoint: AgentRuntimeFileCheckpointSummary;
  current_version_id?: string;
  previous_version_id?: string;
  diff?: unknown;
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
  file_checkpoint_summary?: AgentRuntimeFileCheckpointThreadSummary | null;
  diagnostics?: AgentRuntimeThreadDiagnostics | null;
  task_kind?: string | null;
  service_model_slot?: string | null;
  routing_mode?: string | null;
  decision_source?: string | null;
  decision_reason?: string | null;
  candidate_count?: number | null;
  fallback_chain?: string[] | null;
  capability_gap?: string | null;
  estimated_cost_class?: string | null;
  single_candidate_only?: boolean | null;
  oem_policy?: AgentRuntimeOemPolicySummary | null;
  runtime_summary?: AgentRuntimeSummary | null;
  auxiliary_task_runtime?: Record<string, unknown>[] | null;
  limit_state?: AsterSessionExecutionRuntimeLimitState | null;
  cost_state?: AsterSessionExecutionRuntimeCostState | null;
  permission_state?: AsterSessionExecutionRuntimePermissionState | null;
  limit_event?: AsterSessionExecutionRuntimeLimitEvent | null;
}

export interface AgentRuntimeOemPolicySummary {
  tenantId?: string | null;
  providerSource?: string | null;
  providerKey?: string | null;
  defaultModel?: string | null;
  configMode?: string | null;
  offerState?: string | null;
  quotaStatus?: string | null;
  fallbackToLocalAllowed?: boolean | null;
  canInvoke?: boolean | null;
  locked?: boolean | null;
  quotaLow?: boolean | null;
  limitEventKind?: string | null;
  limitEventMessage?: string | null;
  decisionSource?: string | null;
  selectedProvider?: string | null;
  selectedModel?: string | null;
}

export interface AgentRuntimeSummary {
  candidateCount?: number | null;
  routingMode?: string | null;
  decisionSource?: string | null;
  decisionReason?: string | null;
  fallbackChain?: string[] | null;
  estimatedCostClass?: string | null;
  estimatedTotalCost?: number | null;
  limitStatus?: string | null;
  limitEventKind?: string | null;
  limitEventMessage?: string | null;
  capabilityGap?: string | null;
  singleCandidateOnly?: boolean | null;
  oemLocked?: boolean | null;
  quotaLow?: boolean | null;
  limecorePolicy?: AgentRuntimeThreadLimeCorePolicySummary | null;
}

export interface AgentRuntimeThreadLimeCorePolicySummary {
  contractKey?: string | null;
  snapshotStatus?: string | null;
  decision?: string | null;
  decisionSource?: string | null;
  decisionScope?: string | null;
  decisionReason?: string | null;
  refs?: string[];
  evaluatedRefs?: string[];
  missingInputs?: string[];
  pendingHitRefs?: string[];
  policyValueHitCount?: number | null;
  source?: string | null;
  evaluation?: AgentRuntimeThreadLimeCorePolicyEvaluation | null;
}

export interface AgentRuntimeThreadLimeCorePolicyEvaluation {
  status?: string | null;
  decision?: string | null;
  decisionSource?: string | null;
  decisionScope?: string | null;
  decisionReason?: string | null;
  blockingRefs?: string[];
  askRefs?: string[];
  pendingRefs?: string[];
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

export interface AsterSessionHistoryCursor {
  oldest_message_id?: number | null;
  start_index?: number | null;
  loaded_count?: number | null;
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
  messages_count?: number;
  history_limit?: number | null;
  history_offset?: number | null;
  history_cursor?: AsterSessionHistoryCursor | null;
  history_truncated?: boolean;
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

export type AgentRuntimeEvidenceVerificationOutcome =
  | "success"
  | "blocking_failure"
  | "advisory_failure"
  | "recovered";

export interface AgentRuntimeEvidenceSignalCoverageEntry {
  signal: string;
  status: string;
  source: string;
  detail: string;
}

export interface AgentRuntimeEvidenceCountEntry {
  count: number;
}

export interface AgentRuntimeEvidenceStatusCount extends AgentRuntimeEvidenceCountEntry {
  status: string;
}

export interface AgentRuntimeEvidenceArtifactKindCount extends AgentRuntimeEvidenceCountEntry {
  artifact_kind: string;
}

export interface AgentRuntimeEvidenceActionCount extends AgentRuntimeEvidenceCountEntry {
  action: string;
}

export interface AgentRuntimeEvidenceBackendCount extends AgentRuntimeEvidenceCountEntry {
  backend: string;
}

export interface AgentRuntimeEvidenceBrowserActionItem {
  artifact_path?: string;
  contract_key?: string;
  source?: string;
  entry_source?: string;
  artifact_kind?: string;
  tool_name?: string;
  action?: string;
  status?: string;
  success?: boolean;
  session_id?: string;
  target_id?: string;
  profile_key?: string;
  backend?: string;
  request_id?: string;
  last_url?: string;
  title?: string;
  attempt_count?: number;
  observation_available?: boolean;
  screenshot_available?: boolean;
}

export interface AgentRuntimeEvidenceBrowserActionIndex {
  action_count: number;
  session_count: number;
  observation_count: number;
  screenshot_count: number;
  last_url?: string;
  session_ids: string[];
  target_ids: string[];
  profile_keys: string[];
  status_counts: AgentRuntimeEvidenceStatusCount[];
  artifact_kind_counts: AgentRuntimeEvidenceArtifactKindCount[];
  action_counts: AgentRuntimeEvidenceActionCount[];
  backend_counts: AgentRuntimeEvidenceBackendCount[];
  items: AgentRuntimeEvidenceBrowserActionItem[];
}

export interface AgentRuntimeEvidenceTaskIndexItem {
  artifact_path?: string;
  task_id?: string;
  task_type?: string;
  contract_key?: string;
  source?: string;
  thread_id?: string;
  turn_id?: string;
  content_id?: string;
  entry_key?: string;
  entry_source?: string;
  modality?: string;
  skill_id?: string;
  model_id?: string;
  executor_kind?: string;
  executor_binding_key?: string;
  cost_state?: string;
  limit_state?: string;
  estimated_cost_class?: string;
  limit_event_kind?: string;
  quota_low?: boolean;
  routing_outcome?: string;
}

export interface AgentRuntimeEvidenceTaskIndex {
  snapshot_count: number;
  thread_ids: string[];
  turn_ids: string[];
  content_ids: string[];
  entry_keys: string[];
  modalities: string[];
  skill_ids: string[];
  model_ids: string[];
  executor_kinds: string[];
  executor_binding_keys: string[];
  cost_states: string[];
  limit_states: string[];
  estimated_cost_classes: string[];
  limit_event_kinds: string[];
  quota_low_count: number;
  items: AgentRuntimeEvidenceTaskIndexItem[];
}

export interface AgentRuntimeEvidenceDecisionCount extends AgentRuntimeEvidenceCountEntry {
  decision: string;
}

export interface AgentRuntimeEvidenceLimeCorePolicyItem {
  artifact_path?: string;
  contract_key?: string;
  execution_profile_key?: string;
  executor_adapter_key?: string;
  refs: string[];
  status?: string;
  decision?: string;
  decision_source?: string;
  decision_scope?: string;
  decision_reason?: string;
  evaluated_refs?: string[];
  unresolved_refs?: string[];
  missing_inputs?: string[];
  policy_inputs?: AgentRuntimeEvidenceLimeCorePolicyInput[];
  pending_hit_refs?: string[];
  policy_value_hits?: AgentRuntimeEvidenceLimeCorePolicyValueHit[];
  policy_value_hit_count?: number;
  policy_evaluation?: AgentRuntimeEvidenceLimeCorePolicyEvaluation;
  source?: string;
}

export interface AgentRuntimeEvidenceLimeCorePolicyEvaluation {
  status?: string;
  decision?: string;
  decision_source?: string;
  decision_scope?: string;
  decision_reason?: string;
  blocking_refs?: string[];
  ask_refs?: string[];
  pending_refs?: string[];
}

export interface AgentRuntimeEvidenceLimeCorePolicyInput {
  ref_key: string;
  status?: string;
  source?: string;
  value_source?: string;
}

export interface AgentRuntimeEvidenceLimeCorePolicyValueHit {
  ref_key: string;
  status?: string;
  source?: string;
  value_source?: string;
  value?: unknown;
  summary?: string;
  evidence_ref?: string;
  observed_at?: string;
}

export interface AgentRuntimeEvidenceLimeCorePolicyIndex {
  snapshot_count: number;
  ref_keys: string[];
  missing_inputs?: string[];
  pending_hit_refs?: string[];
  policy_value_hit_count?: number;
  status_counts: AgentRuntimeEvidenceStatusCount[];
  decision_counts: AgentRuntimeEvidenceDecisionCount[];
  items: AgentRuntimeEvidenceLimeCorePolicyItem[];
}

export interface AgentRuntimeEvidenceSnapshotIndex {
  task_index?: AgentRuntimeEvidenceTaskIndex;
  browser_action_index?: AgentRuntimeEvidenceBrowserActionIndex;
  limecore_policy_index?: AgentRuntimeEvidenceLimeCorePolicyIndex;
}

export interface AgentRuntimeEvidenceModalityRuntimeContracts {
  snapshot_count: number;
  snapshot_index?: AgentRuntimeEvidenceSnapshotIndex;
}

export interface AgentRuntimeArtifactValidatorVerificationSummary {
  applicable: boolean;
  record_count: number;
  issue_count: number;
  repaired_count: number;
  fallback_used_count: number;
  outcome?: AgentRuntimeEvidenceVerificationOutcome;
}

export interface AgentRuntimeBrowserVerificationSummary {
  record_count: number;
  success_count: number;
  failure_count: number;
  unknown_count: number;
  latest_updated_at?: string;
  outcome?: AgentRuntimeEvidenceVerificationOutcome;
}

export interface AgentRuntimeGuiSmokeVerificationSummary {
  status?: string;
  exit_code?: number;
  passed: boolean;
  updated_at?: string;
  has_output_preview: boolean;
  outcome?: AgentRuntimeEvidenceVerificationOutcome;
}

export interface AgentRuntimeEvidenceObservabilityVerificationOutcomes {
  blocking_failure: string[];
  advisory_failure: string[];
  recovered: string[];
}

export interface AgentRuntimeEvidenceVerificationSummary {
  artifact_validator?: AgentRuntimeArtifactValidatorVerificationSummary;
  browser_verification?: AgentRuntimeBrowserVerificationSummary;
  gui_smoke?: AgentRuntimeGuiSmokeVerificationSummary;
  observability_verification_outcomes?: AgentRuntimeEvidenceObservabilityVerificationOutcomes;
  focus_verification_failure_outcomes: string[];
  focus_verification_recovered_outcomes: string[];
}

export interface AgentRuntimeEvidenceObservabilitySummary {
  schema_version?: string;
  known_gaps: string[];
  signal_coverage: AgentRuntimeEvidenceSignalCoverageEntry[];
  verification_summary?: AgentRuntimeEvidenceVerificationSummary;
  modality_runtime_contracts?: AgentRuntimeEvidenceModalityRuntimeContracts;
}

export interface AgentRuntimeCompletionAuditRequiredEvidence {
  automation_owner: boolean;
  workspace_skill_tool_call: boolean;
  artifact_or_timeline: boolean;
}

export interface AgentRuntimeCompletionAuditSummary {
  source: string;
  decision: string;
  owner_run_count: number;
  successful_owner_run_count: number;
  workspace_skill_tool_call_count: number;
  artifact_count: number;
  owner_audit_statuses: string[];
  required_evidence: AgentRuntimeCompletionAuditRequiredEvidence;
  blocking_reasons: string[];
  notes: string[];
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
  observability_summary?: AgentRuntimeEvidenceObservabilitySummary;
  completion_audit_summary?: AgentRuntimeCompletionAuditSummary;
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
  verification_summary?: AgentRuntimeEvidenceVerificationSummary;
  limit_status?: string;
  capability_gap?: string;
  user_locked_capability_summary?: string;
  permission_status?: string;
  permission_confirmation_status?: string;
  permission_confirmation_request_id?: string;
  permission_confirmation_source?: string;
  permission_confirmation_summary?: string;
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
  skip_pre_submit_resume?: boolean;
}

export interface AgentRuntimeCreateSessionOptions {
  runStartHooks?: boolean;
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

export interface AgentRuntimeGetSessionOptions {
  resumeSessionStartHooks?: boolean;
  /**
   * 限制返回的历史窗口数量；传 0 表示请求完整历史。
   */
  historyLimit?: number;
  /**
   * 从最新历史向前跳过的消息数量，用于加载更早历史分页。
   */
  historyOffset?: number;
  /**
   * 稳定游标：读取指定后端消息 ID 之前的更早历史，优先于 offset。
   */
  historyBeforeMessageId?: number;
}

export interface AgentRuntimeReplayRequestRequest {
  session_id: string;
  request_id: string;
}

export interface AgentRuntimeListFileCheckpointsRequest {
  session_id: string;
}

export interface AgentRuntimeGetFileCheckpointRequest {
  session_id: string;
  checkpoint_id: string;
}

export interface AgentRuntimeDiffFileCheckpointRequest {
  session_id: string;
  checkpoint_id: string;
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
  provider_selector?: string;
  provider_name?: string;
  model_name?: string;
  execution_strategy?: AsterExecutionStrategy;
  archived?: boolean;
  recent_access_mode?: AsterSessionExecutionRuntimeAccessMode;
  recent_preferences?: AsterSessionExecutionRuntimePreferences;
  recent_team_selection?: AsterSessionExecutionRuntimeRecentTeamSelection;
}

export interface AgentRuntimeFrontmatterHookMatcher {
  matcher?: string;
  hooks: AgentRuntimeFrontmatterHook[];
}

export type AgentRuntimeFrontmatterHook =
  | {
      type: "command";
      command: string;
      timeout?: number;
      once?: boolean;
      shell?: string;
      if?: string;
      statusMessage?: string;
      async?: boolean;
      asyncRewake?: boolean;
    }
  | {
      type: "prompt";
      prompt: string;
      timeout?: number;
      model?: string;
      once?: boolean;
      if?: string;
      statusMessage?: string;
    }
  | {
      type: "agent";
      prompt: string;
      timeout?: number;
      model?: string;
      once?: boolean;
      if?: string;
      statusMessage?: string;
    }
  | {
      type: "http" | "url";
      url: string;
      timeout?: number;
      headers?: Record<string, string>;
      once?: boolean;
      if?: string;
      statusMessage?: string;
      allowedEnvVars?: string[];
    };

export type AgentRuntimeFrontmatterHooks = Partial<
  Record<string, AgentRuntimeFrontmatterHookMatcher[]>
>;

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
  hooks?: AgentRuntimeFrontmatterHooks;
  allowed_tools?: string[];
  disallowed_tools?: string[];
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
  titleGenerationResult?: AgentRuntimeGeneratedTitleResult | null;
  mode?: "generate" | "edit" | "variation";
  rawText?: string;
  layoutHint?: string;
  size?: string;
  aspectRatio?: string;
  count?: number;
  usage?: string;
  style?: string;
  providerId?: string;
  model?: string;
  sessionId?: string;
  threadId?: string;
  turnId?: string;
  projectId?: string;
  contentId?: string;
  entrySource?: string;
  modalityContractKey?: "image_generation";
  modality?: "image";
  requiredCapabilities?: string[];
  routingSlot?: "image_generation_model";
  runtimeContract?: Record<string, unknown>;
  requestedTarget?: "generate" | "cover";
  slotId?: string;
  anchorHint?: string;
  anchorSectionTitle?: string;
  anchorText?: string;
  targetOutputId?: string;
  targetOutputRefId?: string;
  referenceImages?: string[];
  storyboardSlots?: Array<{
    slotId?: string;
    label?: string;
    prompt: string;
    shotType?: string;
  }>;
}

export interface CreateAudioGenerationTaskArtifactRequest {
  projectRootPath: string;
  sourceText: string;
  title?: string;
  rawText?: string;
  voice?: string;
  voiceStyle?: string;
  targetLanguage?: string;
  mimeType?: string;
  audioPath?: string;
  durationMs?: number;
  providerId?: string;
  model?: string;
  sessionId?: string;
  threadId?: string;
  turnId?: string;
  projectId?: string;
  contentId?: string;
  entrySource?: string;
  modalityContractKey?: "voice_generation";
  modality?: "audio";
  requiredCapabilities?: string[];
  routingSlot?: "voice_generation_model";
  runtimeContract?: Record<string, unknown>;
  requestedTarget?: "voice" | "dubbing";
  outputPath?: string;
}

export interface CompleteAudioGenerationTaskArtifactRequest {
  projectRootPath: string;
  taskRef: string;
  audioPath: string;
  mimeType?: string;
  durationMs?: number;
  providerId?: string;
  model?: string;
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
  modalityContractKey?: string;
  routingOutcome?: "accepted" | "failed" | "blocked";
  limit?: number;
}

export interface MediaTaskListFilters {
  status?: string | null;
  task_family?: string | null;
  task_type?: string | null;
  modality_contract_key?: string | null;
  routing_outcome?: string | null;
  limit?: number | null;
}

export interface MediaTaskModalityRuntimeContractIndexEntry {
  task_id: string;
  task_type: string;
  normalized_status: string;
  contract_key?: string | null;
  entry_key?: string | null;
  thread_id?: string | null;
  turn_id?: string | null;
  content_id?: string | null;
  modality?: string | null;
  skill_id?: string | null;
  model_id?: string | null;
  cost_state?: string | null;
  limit_state?: string | null;
  estimated_cost_class?: string | null;
  limit_event_kind?: string | null;
  quota_low?: boolean | null;
  routing_slot?: string | null;
  provider_id?: string | null;
  model?: string | null;
  execution_profile_key?: string | null;
  executor_adapter_key?: string | null;
  executor_kind?: string | null;
  executor_binding_key?: string | null;
  limecore_policy_refs: string[];
  limecore_policy_snapshot_status?: string | null;
  limecore_policy_decision?: string | null;
  limecore_policy_decision_source?: string | null;
  limecore_policy_decision_scope?: string | null;
  limecore_policy_decision_reason?: string | null;
  limecore_policy_evaluation_status?: string | null;
  limecore_policy_evaluation_decision?: string | null;
  limecore_policy_evaluation_decision_source?: string | null;
  limecore_policy_evaluation_decision_scope?: string | null;
  limecore_policy_evaluation_decision_reason?: string | null;
  limecore_policy_evaluation_blocking_refs?: string[];
  limecore_policy_evaluation_ask_refs?: string[];
  limecore_policy_evaluation_pending_refs?: string[];
  limecore_policy_unresolved_refs?: string[];
  limecore_policy_missing_inputs?: string[];
  limecore_policy_pending_hit_refs?: string[];
  limecore_policy_value_hits?: unknown[];
  limecore_policy_value_hit_count?: number;
  routing_event: string;
  routing_outcome: string;
  failure_code?: string | null;
  model_capability_assessment_source?: string | null;
  model_supports_image_generation?: boolean | null;
  audio_output_status?: string | null;
  audio_output_path?: string | null;
  audio_output_mime_type?: string | null;
  audio_output_duration_ms?: number | null;
  audio_output_error_code?: string | null;
  audio_output_retryable?: boolean | null;
  transcript_status?: string | null;
  transcript_path?: string | null;
  transcript_source_url?: string | null;
  transcript_source_path?: string | null;
  transcript_language?: string | null;
  transcript_output_format?: string | null;
  transcript_error_code?: string | null;
  transcript_retryable?: boolean | null;
}

export interface MediaTaskRoutingOutcomeCount {
  outcome: string;
  count: number;
}

export interface MediaTaskAudioOutputStatusCount {
  status: string;
  count: number;
}

export interface MediaTaskTranscriptStatusCount {
  status: string;
  count: number;
}

export interface MediaTaskLimeCorePolicySnapshotStatusCount {
  status: string;
  count: number;
}

export interface MediaTaskLimeCorePolicyEvaluationStatusCount {
  status: string;
  count: number;
}

export interface MediaTaskModalityRuntimeContractIndex {
  snapshot_count: number;
  contract_keys: string[];
  entry_keys?: string[];
  thread_ids?: string[];
  turn_ids?: string[];
  content_ids?: string[];
  modalities?: string[];
  skill_ids?: string[];
  model_ids?: string[];
  cost_states?: string[];
  limit_states?: string[];
  estimated_cost_classes?: string[];
  limit_event_kinds?: string[];
  quota_low_count?: number;
  execution_profile_keys: string[];
  executor_adapter_keys: string[];
  executor_kinds?: string[];
  executor_binding_keys?: string[];
  limecore_policy_refs: string[];
  limecore_policy_snapshot_count: number;
  limecore_policy_snapshot_statuses: MediaTaskLimeCorePolicySnapshotStatusCount[];
  limecore_policy_decisions: string[];
  limecore_policy_decision_sources?: string[];
  limecore_policy_evaluation_statuses?: MediaTaskLimeCorePolicyEvaluationStatusCount[];
  limecore_policy_evaluation_decisions?: string[];
  limecore_policy_evaluation_decision_sources?: string[];
  limecore_policy_evaluation_blocking_refs?: string[];
  limecore_policy_evaluation_ask_refs?: string[];
  limecore_policy_evaluation_pending_refs?: string[];
  limecore_policy_unresolved_refs?: string[];
  limecore_policy_missing_inputs?: string[];
  limecore_policy_pending_hit_refs?: string[];
  limecore_policy_value_hit_count?: number;
  blocked_count: number;
  routing_outcomes: MediaTaskRoutingOutcomeCount[];
  model_registry_assessment_count: number;
  audio_output_count: number;
  audio_output_statuses: MediaTaskAudioOutputStatusCount[];
  audio_output_error_codes: string[];
  transcript_count: number;
  transcript_statuses: MediaTaskTranscriptStatusCount[];
  transcript_error_codes: string[];
  snapshots: MediaTaskModalityRuntimeContractIndexEntry[];
}

export interface ListMediaTaskArtifactsOutput {
  success: boolean;
  workspace_root: string;
  artifact_root: string;
  filters: MediaTaskListFilters;
  total: number;
  modality_runtime_contracts: MediaTaskModalityRuntimeContractIndex;
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

export type AgentRuntimeToolInventoryRuntimeSourceKind =
  | "registry_native"
  | "current_surface"
  | "runtime_extension"
  | "mcp";

export interface AgentRuntimeToolInventoryRequest {
  caller?: string;
  workbench?: boolean;
  browserAssist?: boolean;
  metadata?: Record<string, unknown>;
}

export interface AgentRuntimeListWorkspaceSkillBindingsRequest {
  workspaceRoot: string;
  caller?: string;
  workbench?: boolean;
  browserAssist?: boolean;
}

export interface AgentRuntimeToolInventorySurface {
  workbench: boolean;
  browser_assist: boolean;
}

export interface AgentRuntimeWorkspaceSkillBindingRequest {
  workspace_root: string;
  caller: string;
  surface: AgentRuntimeToolInventorySurface;
}

export type AgentRuntimeWorkspaceSkillBindingStatus =
  | "ready_for_manual_enable"
  | "blocked";

export interface AgentRuntimeSkillBindingRegistration {
  registrationId?: string;
  registration_id?: string;
  registeredAt?: string;
  registered_at?: string;
  skillDirectory?: string;
  skill_directory?: string;
  registeredSkillDirectory?: string;
  registered_skill_directory?: string;
  sourceDraftId?: string;
  source_draft_id?: string;
  sourceVerificationReportId?: string | null;
  source_verification_report_id?: string | null;
  generatedFileCount?: number;
  generated_file_count?: number;
  permissionSummary?: string[];
  permission_summary?: string[];
}

export interface AgentRuntimeSkillBindingResourceSummary {
  hasScripts?: boolean;
  has_scripts?: boolean;
  hasReferences?: boolean;
  has_references?: boolean;
  hasAssets?: boolean;
  has_assets?: boolean;
}

export interface AgentRuntimeSkillBindingStandardCompliance {
  isStandard?: boolean;
  is_standard?: boolean;
  validationErrors?: string[];
  validation_errors?: string[];
  deprecatedFields?: string[];
  deprecated_fields?: string[];
}

export interface AgentRuntimeWorkspaceSkillBinding {
  key: string;
  name: string;
  description: string;
  directory: string;
  registered_skill_directory: string;
  registration: AgentRuntimeSkillBindingRegistration;
  permission_summary: string[];
  metadata: Record<string, string>;
  allowed_tools: string[];
  resource_summary: AgentRuntimeSkillBindingResourceSummary;
  standard_compliance: AgentRuntimeSkillBindingStandardCompliance;
  runtime_binding_target: string;
  binding_status: AgentRuntimeWorkspaceSkillBindingStatus;
  binding_status_reason: string;
  next_gate: string;
  query_loop_visible: boolean;
  tool_runtime_visible: boolean;
  launch_enabled: boolean;
  runtime_gate: string;
}

export interface AgentRuntimeWorkspaceSkillBindingCounts {
  registered_total: number;
  ready_for_manual_enable_total: number;
  blocked_total: number;
  query_loop_visible_total: number;
  tool_runtime_visible_total: number;
  launch_enabled_total: number;
}

export interface AgentRuntimeWorkspaceSkillBindings {
  request: AgentRuntimeWorkspaceSkillBindingRequest;
  warnings: string[];
  counts: AgentRuntimeWorkspaceSkillBindingCounts;
  bindings: AgentRuntimeWorkspaceSkillBinding[];
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

export interface AgentRuntimeToolInventoryRuntimeEntry {
  name: string;
  description: string;
  source_kind: AgentRuntimeToolInventoryRuntimeSourceKind;
  source_label?: string;
  status?: string;
  catalog_entry_name?: string;
  catalog_source?: AgentToolSourceKind;
  catalog_lifecycle?: AgentToolLifecycle;
  catalog_permission_plane?: AgentToolPermissionPlane;
  catalog_workspace_default_allow?: boolean;
  deferred_loading: boolean;
  always_visible: boolean;
  allowed_callers: string[];
  tags: string[];
  input_examples_count: number;
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
  runtime_total?: number;
  runtime_visible_total?: number;
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
  runtime_tools?: AgentRuntimeToolInventoryRuntimeEntry[];
  extension_surfaces: AgentRuntimeToolInventoryExtensionSurfaceEntry[];
  extension_tools: AgentRuntimeToolInventoryExtensionToolEntry[];
  mcp_tools: AgentRuntimeToolInventoryMcpEntry[];
}
