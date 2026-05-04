export type AsterExecutionStrategy = "react" | "code_orchestrated" | "auto";
export type AsterApprovalPolicy =
  | "never"
  | "on-request"
  | "on-failure"
  | "untrusted";
export type AsterSandboxPolicy =
  | "read-only"
  | "workspace-write"
  | "danger-full-access";
export type AsterSessionExecutionRuntimeAccessMode =
  | "read-only"
  | "current"
  | "full-access";

export type AsterSessionExecutionRuntimeSource =
  | "session"
  | "runtime_snapshot"
  | "turn_context"
  | "model_change";

export interface AsterSessionExecutionRuntimePreferences {
  webSearch: boolean;
  thinking: boolean;
  task: boolean;
  subagent: boolean;
}

export type AsterSessionExecutionRuntimeRecentTeamSource =
  | "builtin"
  | "custom"
  | "ephemeral";

export interface AsterSessionExecutionRuntimeRecentTeamRole {
  id?: string | null;
  label?: string | null;
  summary?: string | null;
  profileId?: string | null;
  roleKey?: string | null;
  skillIds?: string[] | null;
}

export interface AsterSessionExecutionRuntimeRecentTeamSelection {
  disabled: boolean;
  theme?: string | null;
  preferredTeamPresetId?: string | null;
  selectedTeamId?: string | null;
  selectedTeamSource?: AsterSessionExecutionRuntimeRecentTeamSource | null;
  selectedTeamLabel?: string | null;
  selectedTeamDescription?: string | null;
  selectedTeamSummary?: string | null;
  selectedTeamRoles?: AsterSessionExecutionRuntimeRecentTeamRole[] | null;
}

export interface AsterSessionExecutionRuntimeTaskProfile {
  kind: string;
  source: string;
  traits?: string[];
  modalityContractKey?: string | null;
  routingSlot?: string | null;
  executionProfileKey?: string | null;
  executorAdapterKey?: string | null;
  executorKind?: string | null;
  executorBindingKey?: string | null;
  permissionProfileKeys?: string[];
  userLockPolicy?: string | null;
  serviceModelSlot?: string | null;
  sceneKind?: string | null;
  sceneSkillId?: string | null;
  entrySource?: string | null;
}

export interface AsterSessionExecutionRuntimeRoutingDecision {
  routingMode: string;
  decisionSource: string;
  decisionReason: string;
  selectedProvider?: string | null;
  selectedModel?: string | null;
  requestedProvider?: string | null;
  requestedModel?: string | null;
  candidateCount: number;
  estimatedCostClass?: string | null;
  capabilityGap?: string | null;
  fallbackChain?: string[];
  settingsSource?: string | null;
  serviceModelSlot?: string | null;
}

export interface AsterSessionExecutionRuntimeLimitState {
  status: string;
  singleCandidateOnly: boolean;
  providerLocked: boolean;
  settingsLocked: boolean;
  oemLocked: boolean;
  candidateCount: number;
  capabilityGap?: string | null;
  notes?: string[];
}

export interface AsterSessionExecutionRuntimeCostState {
  status: string;
  estimatedCostClass?: string | null;
  inputPerMillion?: number | null;
  outputPerMillion?: number | null;
  cacheReadPerMillion?: number | null;
  cacheWritePerMillion?: number | null;
  currency?: string | null;
  estimatedTotalCost?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  cachedInputTokens?: number | null;
  cacheCreationInputTokens?: number | null;
}

export interface AsterSessionExecutionRuntimePermissionState {
  status: "not_required" | "declared_only" | "requires_confirmation" | string;
  requiredProfileKeys?: string[];
  askProfileKeys?: string[];
  blockingProfileKeys?: string[];
  decisionSource: string;
  decisionScope: string;
  confirmationStatus?: "not_required" | "not_requested" | "requested" | "resolved" | string | null;
  confirmationRequestId?: string | null;
  confirmationSource?: string | null;
  notes?: string[];
}

export interface AsterSessionExecutionRuntimeLimitEvent {
  eventKind: string;
  message: string;
  retryable: boolean;
}

export type AsterTurnOutputSchemaSource = "session" | "turn";

export type AsterTurnOutputSchemaStrategy = "native" | "final_output_tool";

export interface AsterTurnOutputSchemaRuntime {
  source: AsterTurnOutputSchemaSource;
  strategy: AsterTurnOutputSchemaStrategy;
  providerName?: string | null;
  modelName?: string | null;
}

export interface AsterSessionExecutionRuntime {
  session_id: string;
  provider_selector?: string | null;
  provider_name?: string | null;
  model_name?: string | null;
  execution_strategy?: AsterExecutionStrategy | null;
  output_schema_runtime?: AsterTurnOutputSchemaRuntime | null;
  source: AsterSessionExecutionRuntimeSource;
  mode?: string | null;
  latest_turn_id?: string | null;
  latest_turn_status?:
    | "idle"
    | "queued"
    | "running"
    | "completed"
    | "failed"
    | "aborted"
    | "closed"
    | "not_found"
    | null;
  recent_access_mode?: AsterSessionExecutionRuntimeAccessMode | null;
  recent_preferences?: AsterSessionExecutionRuntimePreferences | null;
  recent_team_selection?: AsterSessionExecutionRuntimeRecentTeamSelection | null;
  recent_theme?: string | null;
  recent_session_mode?: "default" | "general_workbench" | string | null;
  recent_gate_key?: string | null;
  recent_run_title?: string | null;
  recent_content_id?: string | null;
  task_profile?: AsterSessionExecutionRuntimeTaskProfile | null;
  routing_decision?: AsterSessionExecutionRuntimeRoutingDecision | null;
  limit_state?: AsterSessionExecutionRuntimeLimitState | null;
  cost_state?: AsterSessionExecutionRuntimeCostState | null;
  permission_state?: AsterSessionExecutionRuntimePermissionState | null;
  limit_event?: AsterSessionExecutionRuntimeLimitEvent | null;
}
