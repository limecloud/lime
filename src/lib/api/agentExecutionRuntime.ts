export type AsterExecutionStrategy = "react" | "code_orchestrated" | "auto";

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
  recent_preferences?: AsterSessionExecutionRuntimePreferences | null;
  recent_team_selection?: AsterSessionExecutionRuntimeRecentTeamSelection | null;
  recent_theme?: string | null;
  recent_session_mode?: "default" | "theme_workbench" | string | null;
  recent_gate_key?: string | null;
  recent_run_title?: string | null;
  recent_content_id?: string | null;
}
