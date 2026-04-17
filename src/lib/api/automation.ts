import { safeInvoke } from "@/lib/dev-bridge";
import type { AgentRun } from "@/lib/api/executionRun";
import type { BrowserStreamMode } from "@/lib/webview-api";
import type {
  AsterApprovalPolicy,
  AsterSandboxPolicy,
} from "@/lib/api/agentRuntime";

export type TaskSchedule =
  | { kind: "every"; every_secs: number }
  | { kind: "cron"; expr: string; tz?: string | null }
  | { kind: "at"; at: string };

export type AutomationExecutionMode = "intelligent" | "skill" | "log_only";

export type AutomationOutputFormat = "text" | "json";
export type AutomationOutputSchema =
  | "text"
  | "json"
  | "table"
  | "csv"
  | "links";
export type AutomationRequestMetadata = Record<string, unknown>;

export interface DeliveryConfig {
  mode: "none" | "announce";
  channel?:
    | "webhook"
    | "telegram"
    | "local_file"
    | "google_sheets"
    | string
    | null;
  target?: string | null;
  best_effort: boolean;
  output_schema?: AutomationOutputSchema | null;
  output_format?: AutomationOutputFormat | null;
}

export interface AutomationLastDeliveryRecord {
  success: boolean;
  message: string;
  channel?: string | null;
  target?: string | null;
  output_kind: string;
  output_schema: AutomationOutputSchema;
  output_format: AutomationOutputFormat;
  output_preview: string;
  delivery_attempt_id?: string | null;
  run_id?: string | null;
  execution_retry_count?: number | null;
  delivery_attempts?: number | null;
  attempted_at: string;
}

export interface AutomationSchedulerConfig {
  enabled: boolean;
  poll_interval_secs: number;
  enable_history: boolean;
}

export interface AutomationStatus {
  running: boolean;
  last_polled_at: string | null;
  next_poll_at: string | null;
  last_job_count: number;
  total_executions: number;
  active_job_id: string | null;
  active_job_name: string | null;
}

export interface AgentTurnAutomationPayload {
  kind: "agent_turn";
  prompt: string;
  system_prompt?: string | null;
  web_search: boolean;
  content_id?: string | null;
  approval_policy?: AsterApprovalPolicy | null;
  sandbox_policy?: AsterSandboxPolicy | null;
  request_metadata?: AutomationRequestMetadata | null;
}

export interface BrowserSessionAutomationPayload {
  kind: "browser_session";
  profile_id: string;
  profile_key?: string | null;
  url?: string | null;
  environment_preset_id?: string | null;
  target_id?: string | null;
  open_window: boolean;
  stream_mode: BrowserStreamMode;
}

export type AutomationPayload =
  | AgentTurnAutomationPayload
  | BrowserSessionAutomationPayload;

export interface AutomationJobRecord {
  id: string;
  name: string;
  description?: string | null;
  enabled: boolean;
  workspace_id: string;
  execution_mode: AutomationExecutionMode;
  schedule: TaskSchedule;
  payload: AutomationPayload;
  delivery: DeliveryConfig;
  timeout_secs?: number | null;
  max_retries: number;
  next_run_at?: string | null;
  last_status?: string | null;
  last_error?: string | null;
  last_run_at?: string | null;
  last_finished_at?: string | null;
  running_started_at?: string | null;
  consecutive_failures: number;
  last_retry_count: number;
  auto_disabled_until?: string | null;
  last_delivery?: AutomationLastDeliveryRecord | null;
  created_at: string;
  updated_at: string;
}

export interface AutomationJobRequest {
  name: string;
  description?: string | null;
  enabled?: boolean;
  workspace_id: string;
  execution_mode?: AutomationExecutionMode;
  schedule: TaskSchedule;
  payload: AutomationPayload;
  delivery?: DeliveryConfig;
  timeout_secs?: number | null;
  max_retries?: number;
}

export interface UpdateAutomationJobRequest {
  name?: string;
  description?: string | null;
  enabled?: boolean;
  workspace_id?: string;
  execution_mode?: AutomationExecutionMode;
  schedule?: TaskSchedule;
  payload?: AutomationPayload;
  delivery?: DeliveryConfig;
  timeout_secs?: number | null;
  clear_timeout_secs?: boolean;
  max_retries?: number;
}

export interface AutomationHealthQuery {
  running_timeout_minutes?: number;
  top_limit?: number;
  cooldown_alert_threshold?: number;
  stale_running_alert_threshold?: number;
  failed_24h_alert_threshold?: number;
}

export interface AutomationFailureTrendPoint {
  bucket_start: string;
  label: string;
  error_count: number;
  timeout_count: number;
}

export interface AutomationHealthAlert {
  code: string;
  severity: string;
  message: string;
  current_value: number;
  threshold: number;
}

export interface AutomationRiskJobInfo {
  job_id: string;
  name: string;
  status: string;
  consecutive_failures: number;
  retry_count: number;
  detail_message?: string | null;
  auto_disabled_until?: string | null;
  updated_at: string;
}

export interface AutomationHealthResult {
  total_jobs: number;
  enabled_jobs: number;
  pending_jobs: number;
  running_jobs: number;
  failed_jobs: number;
  cooldown_jobs: number;
  stale_running_jobs: number;
  failed_last_24h: number;
  failure_trend_24h: AutomationFailureTrendPoint[];
  alerts: AutomationHealthAlert[];
  risky_jobs: AutomationRiskJobInfo[];
  generated_at: string;
}

export interface AutomationCycleResult {
  job_count: number;
  success_count: number;
  failed_count: number;
  timeout_count: number;
}

export interface ScheduleValidationResult {
  valid: boolean;
  error?: string | null;
}

export async function getAutomationSchedulerConfig(): Promise<AutomationSchedulerConfig> {
  return safeInvoke("get_automation_scheduler_config");
}

export async function updateAutomationSchedulerConfig(
  config: AutomationSchedulerConfig,
): Promise<void> {
  return safeInvoke("update_automation_scheduler_config", { config });
}

export async function getAutomationStatus(): Promise<AutomationStatus> {
  return safeInvoke("get_automation_status");
}

export async function getAutomationJobs(): Promise<AutomationJobRecord[]> {
  return safeInvoke("get_automation_jobs");
}

export async function getAutomationJob(
  id: string,
): Promise<AutomationJobRecord | null> {
  return safeInvoke("get_automation_job", { id });
}

export async function createAutomationJob(
  request: AutomationJobRequest,
): Promise<AutomationJobRecord> {
  return safeInvoke("create_automation_job", { request });
}

export async function updateAutomationJob(
  id: string,
  request: UpdateAutomationJobRequest,
): Promise<AutomationJobRecord> {
  return safeInvoke("update_automation_job", { id, request });
}

export async function deleteAutomationJob(id: string): Promise<boolean> {
  return safeInvoke("delete_automation_job", { id });
}

export async function runAutomationJobNow(
  id: string,
): Promise<AutomationCycleResult> {
  return safeInvoke("run_automation_job_now", { id });
}

export async function getAutomationHealth(
  query?: AutomationHealthQuery,
): Promise<AutomationHealthResult> {
  return safeInvoke("get_automation_health", { query: query ?? null });
}

export async function getAutomationRunHistory(
  id: string,
  limit: number = 20,
): Promise<AgentRun[]> {
  return safeInvoke("get_automation_run_history", { id, limit });
}

export async function previewAutomationSchedule(
  schedule: TaskSchedule,
): Promise<string | null> {
  return safeInvoke("preview_automation_schedule", { schedule });
}

export async function validateAutomationSchedule(
  schedule: TaskSchedule,
): Promise<ScheduleValidationResult> {
  return safeInvoke("validate_automation_schedule", { schedule });
}
