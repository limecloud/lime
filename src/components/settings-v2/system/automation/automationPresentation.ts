import type {
  AutomationJobRecord,
  AutomationLastDeliveryRecord,
  AutomationOutputFormat,
  AutomationOutputSchema,
  AutomationPayload,
} from "@/lib/api/automation";
import type { AgentRun } from "@/lib/api/executionRun";
import {
  mergeAutomationServiceSkillContexts,
  resolveServiceSkillContextFromMetadataRecord,
  type AutomationServiceSkillContext,
} from "./serviceSkillContext";

export const LEGACY_BROWSER_AUTOMATION_NOTICE =
  "浏览器自动化已下线，系统不会再自动启动 Chrome。请删除旧任务，并改建为 Agent 对话任务。";
export const LEGACY_BROWSER_AUTOMATION_STATUS = "已下线";

export type AutomationBadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "outline";

export function formatTime(value?: string | null): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN", { hour12: false });
}

export function describeSchedule(job: AutomationJobRecord): string {
  if (job.schedule.kind === "every") {
    const secs = job.schedule.every_secs;
    if (secs % 3600 === 0) {
      return `每 ${secs / 3600} 小时`;
    }
    if (secs % 60 === 0) {
      return `每 ${secs / 60} 分钟`;
    }
    return `每 ${secs} 秒`;
  }
  if (job.schedule.kind === "cron") {
    return `Cron: ${job.schedule.expr}`;
  }
  return `一次性: ${formatTime(job.schedule.at)}`;
}

export function executionModeLabel(
  mode: AutomationJobRecord["execution_mode"],
): string {
  switch (mode) {
    case "intelligent":
      return "智能执行";
    case "skill":
      return "技能执行";
    case "log_only":
      return "只记录";
    default:
      return mode;
  }
}

export function payloadKindLabel(kind: AutomationPayload["kind"]): string {
  return kind === "browser_session"
    ? "浏览器自动化（已下线）"
    : "Agent 对话任务";
}

export function describePayload(payload: AutomationPayload): string {
  if (payload.kind === "agent_turn") {
    return payload.prompt;
  }

  const lines = [LEGACY_BROWSER_AUTOMATION_NOTICE];
  lines.push(`资料: ${payload.profile_key ?? payload.profile_id}`);
  if (payload.environment_preset_id) {
    lines.push(`环境预设: ${payload.environment_preset_id}`);
  }
  if (payload.url) {
    lines.push(`启动地址: ${payload.url}`);
  }
  if (payload.target_id) {
    lines.push(`Target ID: ${payload.target_id}`);
  }
  lines.push(`调试窗口: ${payload.open_window ? "打开" : "关闭"}`);
  lines.push(`流模式: ${payload.stream_mode}`);
  return lines.join("\n");
}

export function isLegacyBrowserAutomation(
  job?: AutomationJobRecord | null,
): boolean {
  return job?.payload.kind === "browser_session";
}

function parseRunMetadata(run: AgentRun): Record<string, unknown> | null {
  if (!run.metadata) {
    return null;
  }
  try {
    const parsed = JSON.parse(run.metadata);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function resolveRunSessionId(run: AgentRun): string | null {
  if (run.session_id) {
    return run.session_id;
  }
  const metadata = parseRunMetadata(run);
  const metadataSessionId = metadata?.session_id;
  return typeof metadataSessionId === "string" && metadataSessionId.trim()
    ? metadataSessionId
    : null;
}

function resolveBrowserLifecycleStatus(run: AgentRun): string | null {
  const metadata = parseRunMetadata(run);
  const lifecycle = metadata?.browser_lifecycle_state;
  return typeof lifecycle === "string" && lifecycle.trim() ? lifecycle : null;
}

function resolveRunHumanReason(run: AgentRun): string | null {
  const metadata = parseRunMetadata(run);
  const reason = metadata?.human_reason;
  return typeof reason === "string" && reason.trim() ? reason : null;
}

export function resolveRunInfoMessage(run: AgentRun): string | null {
  const reason = resolveRunHumanReason(run);
  if (!reason) {
    return null;
  }
  if (run.error_message && run.error_message.trim() === reason) {
    return null;
  }
  return reason;
}

export function resolveRunDelivery(
  run: AgentRun,
): AutomationLastDeliveryRecord | null {
  const metadata = parseRunMetadata(run);
  const delivery = metadata?.delivery;
  if (!delivery || typeof delivery !== "object" || Array.isArray(delivery)) {
    return null;
  }

  const deliveryRecord = delivery as Record<string, unknown>;
  const success = deliveryRecord.success;
  const message = deliveryRecord.message;
  const outputKind = deliveryRecord.output_kind;
  const outputSchema = deliveryRecord.output_schema;
  const outputFormat = deliveryRecord.output_format;
  const outputPreview = deliveryRecord.output_preview;
  const attemptedAt = deliveryRecord.attempted_at;
  if (
    typeof success !== "boolean" ||
    typeof message !== "string" ||
    typeof outputKind !== "string" ||
    typeof outputSchema !== "string" ||
    typeof outputFormat !== "string" ||
    typeof outputPreview !== "string" ||
    typeof attemptedAt !== "string"
  ) {
    return null;
  }

  return {
    success,
    message,
    channel:
      typeof deliveryRecord.channel === "string"
        ? deliveryRecord.channel
        : null,
    target:
      typeof deliveryRecord.target === "string" ? deliveryRecord.target : null,
    output_kind: outputKind,
    output_schema:
      outputSchema === "json" ||
      outputSchema === "table" ||
      outputSchema === "csv" ||
      outputSchema === "links"
        ? outputSchema
        : "text",
    output_format: outputFormat === "json" ? "json" : "text",
    output_preview: outputPreview,
    delivery_attempt_id:
      typeof deliveryRecord.delivery_attempt_id === "string"
        ? deliveryRecord.delivery_attempt_id
        : null,
    run_id:
      typeof deliveryRecord.run_id === "string" ? deliveryRecord.run_id : null,
    execution_retry_count:
      typeof deliveryRecord.execution_retry_count === "number"
        ? deliveryRecord.execution_retry_count
        : null,
    delivery_attempts:
      typeof deliveryRecord.delivery_attempts === "number"
        ? deliveryRecord.delivery_attempts
        : null,
    attempted_at: attemptedAt,
  };
}

export function statusLabel(status?: string | null): string {
  switch (status) {
    case "queued":
      return "排队中";
    case "success":
      return "成功";
    case "running":
      return "运行中";
    case "waiting_for_human":
      return "等待人工处理";
    case "human_controlling":
      return "人工接管中";
    case "agent_resuming":
      return "恢复给 Agent";
    case "error":
      return "失败";
    case "timeout":
      return "超时";
    default:
      return "待执行";
  }
}

export function statusVariant(
  status?: string | null,
): AutomationBadgeVariant {
  if (status === "success") {
    return "default";
  }
  if (
    status === "queued" ||
    status === "running" ||
    status === "agent_resuming"
  ) {
    return "secondary";
  }
  if (status === "waiting_for_human" || status === "human_controlling") {
    return "outline";
  }
  if (status === "error" || status === "timeout") {
    return "destructive";
  }
  return "outline";
}

export function runDisplayStatus(run: AgentRun): string {
  if (run.status === "running") {
    const lifecycleStatus = resolveBrowserLifecycleStatus(run);
    if (lifecycleStatus) {
      return lifecycleStatus;
    }
  }
  return run.status;
}

export function runStatusVariant(run: AgentRun): AutomationBadgeVariant {
  return statusVariant(runDisplayStatus(run));
}

export function runInfoToneClass(run: AgentRun): string {
  switch (runDisplayStatus(run)) {
    case "waiting_for_human":
      return "border-orange-200 bg-orange-50 text-orange-700";
    case "human_controlling":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "agent_resuming":
      return "border-sky-200 bg-sky-50 text-sky-700";
    default:
      return "border-slate-200/80 bg-white text-slate-600";
  }
}

export function statusDetailToneClass(status?: string | null): string {
  switch (status) {
    case "waiting_for_human":
      return "text-orange-700";
    case "human_controlling":
      return "text-amber-700";
    case "agent_resuming":
      return "text-sky-700";
    case "error":
    case "timeout":
      return "text-rose-700";
    default:
      return "text-slate-500";
  }
}

export function statusDetailPrefix(status?: string | null): string {
  switch (status) {
    case "waiting_for_human":
    case "human_controlling":
      return "当前阻塞";
    case "agent_resuming":
      return "恢复说明";
    case "error":
    case "timeout":
      return "最近异常";
    default:
      return "运行说明";
  }
}

export function resolveDeliveryOutputFormat(
  format?: AutomationOutputFormat | null,
): AutomationOutputFormat {
  return format === "json" ? "json" : "text";
}

export function resolveDeliveryOutputSchema(
  job: AutomationJobRecord,
): AutomationOutputSchema {
  switch (job.delivery.output_schema) {
    case "json":
    case "table":
    case "csv":
    case "links":
    case "text":
      return job.delivery.output_schema;
    default:
      return resolveDeliveryOutputFormat(job.delivery.output_format) === "json"
        ? "json"
        : "text";
  }
}

export function deliveryModeLabel(job: AutomationJobRecord): string {
  return job.delivery.mode === "announce" ? "任务完成后投递" : "关闭";
}

export function deliveryChannelLabel(channel?: string | null): string {
  switch (channel) {
    case "webhook":
      return "Webhook";
    case "google_sheets":
      return "Google Sheets";
    case "local_file":
      return "本地文件";
    case "telegram":
      return "Telegram";
    default:
      return channel?.trim() ? channel : "-";
  }
}

export function outputSchemaLabel(schema: AutomationOutputSchema): string {
  switch (schema) {
    case "json":
      return "JSON 对象";
    case "table":
      return "表格";
    case "csv":
      return "CSV";
    case "links":
      return "链接列表";
    default:
      return "文本摘要";
  }
}

export function outputFormatLabel(format: AutomationOutputFormat): string {
  return format === "json" ? "JSON 编码" : "文本编码";
}

export function deliveryStatusVariant(success: boolean): AutomationBadgeVariant {
  return success ? "default" : "destructive";
}

export function deliveryToneClass(
  delivery: AutomationLastDeliveryRecord | null | undefined,
): string {
  if (!delivery) {
    return "border-slate-200/80 bg-slate-50 text-slate-500";
  }
  return delivery.success
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-rose-200 bg-rose-50 text-rose-700";
}

export function describeServiceSkillTaskLine(
  serviceSkillContext: AutomationServiceSkillContext,
): string {
  return `技能项: ${serviceSkillContext.title}`;
}

export function describeServiceSkillSlotPreview(
  serviceSkillContext: AutomationServiceSkillContext,
  limit: number = 2,
): string | null {
  const preview = serviceSkillContext.slotSummary
    .slice(0, limit)
    .map((item) => `${item.label}: ${item.value}`);
  if (preview.length > 0) {
    const suffix =
      serviceSkillContext.slotSummary.length > limit
        ? ` 等 ${serviceSkillContext.slotSummary.length} 项`
        : "";
    return `${preview.join(" · ")}${suffix}`;
  }

  if (serviceSkillContext.userInput) {
    return serviceSkillContext.userInput;
  }

  return null;
}

export function resolveRunServiceSkillContext(
  run: AgentRun,
  fallbackContext: AutomationServiceSkillContext | null,
): AutomationServiceSkillContext | null {
  const metadata = parseRunMetadata(run);
  const runContext = metadata
    ? resolveServiceSkillContextFromMetadataRecord(metadata)
    : null;
  return mergeAutomationServiceSkillContexts(runContext, fallbackContext);
}
