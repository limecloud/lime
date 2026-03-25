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
}
