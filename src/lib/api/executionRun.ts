import { safeInvoke } from "@/lib/dev-bridge";

export type AgentRunSource = "chat" | "skill" | "automation";

export type AgentRunStatus =
  | "queued"
  | "running"
  | "success"
  | "error"
  | "canceled"
  | "timeout";

export interface AgentRun {
  id: string;
  source: AgentRunSource;
  source_ref: string | null;
  session_id: string | null;
  status: AgentRunStatus;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  error_code: string | null;
  error_message: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

export interface ThemeWorkbenchRunTodoItem {
  run_id: string;
  execution_id?: string | null;
  session_id?: string | null;
  artifact_paths?: string[];
  title: string;
  gate_key?: "topic_select" | "write_mode" | "publish_confirm" | null;
  status: AgentRunStatus;
  source: AgentRunSource | string;
  source_ref: string | null;
  started_at: string;
}

export interface ThemeWorkbenchRunTerminalItem {
  run_id: string;
  execution_id?: string | null;
  session_id?: string | null;
  artifact_paths?: string[];
  title: string;
  gate_key?: "topic_select" | "write_mode" | "publish_confirm" | null;
  status: AgentRunStatus;
  source: AgentRunSource | string;
  source_ref: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface ThemeWorkbenchRunState {
  run_state: "idle" | "auto_running";
  current_gate_key?:
    | "idle"
    | "topic_select"
    | "write_mode"
    | "publish_confirm"
    | null;
  queue_items: ThemeWorkbenchRunTodoItem[];
  latest_terminal: ThemeWorkbenchRunTerminalItem | null;
  recent_terminals?: ThemeWorkbenchRunTerminalItem[] | null;
  updated_at: string;
}

export interface ThemeWorkbenchRunHistoryPage {
  items: ThemeWorkbenchRunTerminalItem[];
  has_more: boolean;
  next_offset: number | null;
}

export async function executionRunList(
  limit: number = 50,
  offset: number = 0,
): Promise<AgentRun[]> {
  return await safeInvoke("execution_run_list", { limit, offset });
}

export async function executionRunGet(
  runId: string,
): Promise<AgentRun | null> {
  return await safeInvoke("execution_run_get", { runId });
}

export async function executionRunGetThemeWorkbenchState(
  sessionId: string,
  limit: number = 3,
): Promise<ThemeWorkbenchRunState> {
  return await safeInvoke("execution_run_get_theme_workbench_state", {
    sessionId,
    session_id: sessionId,
    limit,
  });
}

export async function executionRunListThemeWorkbenchHistory(
  sessionId: string,
  limit: number = 20,
  offset: number = 0,
): Promise<ThemeWorkbenchRunHistoryPage> {
  return await safeInvoke("execution_run_list_theme_workbench_history", {
    sessionId,
    session_id: sessionId,
    limit,
    offset,
  });
}
