import type { AutomationJobDialogInitialValues } from "@/components/settings-v2/system/automation/AutomationJobDialog";
import type { AgentRuntimeWorkspaceSkillBinding } from "@/lib/api/agentRuntime";
import type { AutomationJobRecord, TaskSchedule } from "@/lib/api/automation";

const DEFAULT_CRON_TIMEZONE = "Asia/Shanghai";
const DEFAULT_CRON_EXPR = "0 9 * * *";

export interface WorkspaceSkillManagedAutomationPresentation {
  statusLabel: string;
  scheduleLabel: string;
  lastRunLabel: string;
  objectiveLabel: string;
  auditLabel: string;
  jobId?: string;
  jobName?: string;
  enabled?: boolean;
}

export interface WorkspaceSkillAgentAutomationDraftOptions {
  requiresControlledGetEvidence?: boolean;
}

function normalizeText(value?: string | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringArray(value?: string[] | null): string[] {
  return Array.isArray(value)
    ? value.map((item) => item.trim()).filter(Boolean)
    : [];
}

function resolveSourceDraftId(
  binding: AgentRuntimeWorkspaceSkillBinding,
): string {
  return normalizeText(
    binding.registration.source_draft_id ?? binding.registration.sourceDraftId,
  );
}

function resolveSourceVerificationReportId(
  binding: AgentRuntimeWorkspaceSkillBinding,
): string {
  return normalizeText(
    binding.registration.source_verification_report_id ??
      binding.registration.sourceVerificationReportId,
  );
}

function buildSkillName(binding: AgentRuntimeWorkspaceSkillBinding): string {
  return `project:${binding.directory}`;
}

function buildDisplayName(binding: AgentRuntimeWorkspaceSkillBinding): string {
  return normalizeText(binding.name) || binding.directory;
}

function buildPermissionSummary(
  binding: AgentRuntimeWorkspaceSkillBinding,
): string[] {
  return normalizeStringArray(
    binding.permission_summary ?? binding.registration.permission_summary,
  );
}

export function canBuildWorkspaceSkillAgentAutomationDraft(
  binding?: AgentRuntimeWorkspaceSkillBinding | null,
): binding is AgentRuntimeWorkspaceSkillBinding {
  if (!binding || binding.binding_status !== "ready_for_manual_enable") {
    return false;
  }
  return Boolean(
    normalizeText(binding.directory) &&
    normalizeText(binding.registered_skill_directory) &&
    resolveSourceDraftId(binding) &&
    resolveSourceVerificationReportId(binding),
  );
}

export function buildWorkspaceSkillAgentAutomationRequestMetadata(input: {
  binding: AgentRuntimeWorkspaceSkillBinding;
  workspaceRoot: string;
  options?: WorkspaceSkillAgentAutomationDraftOptions;
}): Record<string, unknown> | null {
  const { binding } = input;
  const workspaceRoot = normalizeText(input.workspaceRoot);
  if (!workspaceRoot || !canBuildWorkspaceSkillAgentAutomationDraft(binding)) {
    return null;
  }

  const skillName = buildSkillName(binding);
  const displayName = buildDisplayName(binding);
  const permissionSummary = buildPermissionSummary(binding);
  const sourceDraftId = resolveSourceDraftId(binding);
  const sourceVerificationReportId = resolveSourceVerificationReportId(binding);
  const requiresControlledGetEvidence =
    input.options?.requiresControlledGetEvidence === true;

  return {
    harness: {
      theme: "general",
      session_mode: "general_workbench",
      run_title: displayName,
      agent_envelope: {
        source: "skill_forge_p4_agent_envelope",
        state: "automation_draft",
        skill: skillName,
        directory: binding.directory,
        registered_skill_directory: binding.registered_skill_directory,
        source_draft_id: sourceDraftId,
        source_verification_report_id: sourceVerificationReportId,
        authorization_scope: "scheduled_run_session",
      },
      managed_objective: {
        source: "skill_forge_p4_managed_execution",
        owner_type: "automation_job",
        state: "planned",
        objective: `按计划运行 Workspace Skill「${displayName}」，交付可审计结果。`,
        success_criteria: [
          "必须通过 agent_runtime_submit_turn 执行",
          "必须由 workspace_skill_runtime_enable 在本次运行 session 内显式授权",
          "完成状态必须依赖 artifact / timeline / evidence，而不是模型自报",
          ...(requiresControlledGetEvidence
            ? ["Read-Only HTTP API 任务必须包含 executed 受控 GET evidence"]
            : []),
        ],
        completion_audit: "artifact_or_evidence_required",
        ...(requiresControlledGetEvidence
          ? {
              required_external_evidence: ["controlled_get_evidence"],
              completion_evidence_policy: {
                controlled_get_evidence_required: true,
                controlled_get_evidence_source:
                  "capability_draft_controlled_get_evidence",
              },
            }
          : {}),
      },
      workspace_skill_runtime_enable: {
        source: "agent_envelope_scheduled_run",
        approval: "manual",
        workspace_root: workspaceRoot,
        bindings: [
          {
            directory: binding.directory,
            skill: skillName,
            registered_skill_directory: binding.registered_skill_directory,
            source_draft_id: sourceDraftId,
            source_verification_report_id: sourceVerificationReportId,
            permission_summary: permissionSummary,
          },
        ],
      },
    },
  };
}

function buildAutomationPrompt(
  binding: AgentRuntimeWorkspaceSkillBinding,
): string {
  const displayName = buildDisplayName(binding);
  const skillName = buildSkillName(binding);
  return [
    `请按当前 Workspace Agent envelope 草案运行 Skill「${displayName}」（${skillName}）。`,
    "先读取 Skill 的 Runbook、权限说明和输入约束，再执行任务。",
    "如果执行缺少必要输入或外部写权限，请返回 needs_input / blocked 的原因，不要绕过确认。",
    "完成后输出结果摘要，并保留可进入 evidence pack 的产物与关键步骤。",
  ].join("\n");
}

export function buildWorkspaceSkillAgentAutomationInitialValues(input: {
  binding: AgentRuntimeWorkspaceSkillBinding;
  workspaceRoot: string;
  workspaceId: string;
  options?: WorkspaceSkillAgentAutomationDraftOptions;
}): AutomationJobDialogInitialValues | null {
  const workspaceId = normalizeText(input.workspaceId);
  const requestMetadata = buildWorkspaceSkillAgentAutomationRequestMetadata({
    binding: input.binding,
    workspaceRoot: input.workspaceRoot,
    options: input.options,
  });
  if (!workspaceId || !requestMetadata) {
    return null;
  }

  const displayName = buildDisplayName(input.binding);
  const sourceDraftId = resolveSourceDraftId(input.binding);
  const sourceVerificationReportId = resolveSourceVerificationReportId(
    input.binding,
  );

  return {
    name: `${displayName}｜Managed Agent 草案`,
    description: [
      "来源：P4 Workspace Agent envelope 草案。",
      `Skill：${buildSkillName(input.binding)}`,
      `Provenance：${sourceDraftId} / ${sourceVerificationReportId}`,
      "默认先暂停，确认调度与权限后再启用。",
    ].join("\n"),
    workspace_id: workspaceId,
    enabled: false,
    execution_mode: "skill",
    payload_kind: "agent_turn",
    schedule_kind: "cron",
    cron_expr: DEFAULT_CRON_EXPR,
    cron_tz: DEFAULT_CRON_TIMEZONE,
    prompt: buildAutomationPrompt(input.binding),
    system_prompt: "",
    web_search: false,
    agent_content_id: "",
    agent_request_metadata: requestMetadata,
    max_retries: "2",
    delivery_mode: "none",
    delivery_output_schema: "text",
    delivery_output_format: "text",
    best_effort: true,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function readNestedRecord(
  source: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  return asRecord(source?.[key]);
}

function describeSchedule(schedule: TaskSchedule): string {
  switch (schedule.kind) {
    case "every":
      return `每 ${schedule.every_secs} 秒`;
    case "cron":
      return `Cron ${schedule.expr}${schedule.tz ? ` · ${schedule.tz}` : ""}`;
    case "at":
      return `一次性 ${schedule.at}`;
    default:
      return "未知调度";
  }
}

export function isWorkspaceSkillAgentAutomationJobForDirectory(
  job: AutomationJobRecord,
  directory: string,
): boolean {
  if (job.payload.kind !== "agent_turn") {
    return false;
  }
  const normalizedDirectory = normalizeText(directory);
  if (!normalizedDirectory) {
    return false;
  }

  const requestMetadata = asRecord(job.payload.request_metadata);
  const harness = readNestedRecord(requestMetadata, "harness");
  const agentEnvelope =
    readNestedRecord(harness, "agent_envelope") ??
    readNestedRecord(harness, "agentEnvelope");
  const envelopeDirectory = normalizeText(
    agentEnvelope?.directory as string | undefined,
  );
  const envelopeSkill = normalizeText(
    agentEnvelope?.skill as string | undefined,
  );

  return (
    envelopeDirectory === normalizedDirectory ||
    envelopeSkill === `project:${normalizedDirectory}`
  );
}

export function buildWorkspaceSkillManagedAutomationPresentation(
  jobs: readonly AutomationJobRecord[],
): WorkspaceSkillManagedAutomationPresentation {
  const [job] = jobs;
  if (!job) {
    return {
      statusLabel: "Managed Job：未创建",
      scheduleLabel: "Schedule：等待创建 automation job 草案。",
      lastRunLabel: "最近运行：暂无",
      objectiveLabel: "Managed Objective：planned，等待绑定 automation job。",
      auditLabel: "Completion Audit：缺少运行与 evidence，不能判定完成。",
    };
  }

  const stateLabel = job.enabled ? "已启用" : "草案暂停";
  const objectiveState = resolveManagedObjectiveState(job);
  return {
    jobId: job.id,
    jobName: job.name,
    enabled: job.enabled,
    statusLabel: `Managed Job：${stateLabel} · ${job.last_status ?? "尚未运行"}`,
    scheduleLabel: `Schedule：${describeSchedule(job.schedule)}${
      job.next_run_at ? ` · 下次 ${job.next_run_at}` : ""
    }`,
    lastRunLabel: `最近运行：${job.last_run_at ?? "暂无"}${
      job.last_error ? ` · ${job.last_error}` : ""
    }`,
    objectiveLabel: `Managed Objective：${objectiveState}`,
    auditLabel: buildCompletionAuditLabel(job, objectiveState),
  };
}

function resolveManagedObjectiveState(job: AutomationJobRecord): string {
  if (job.running_started_at) {
    return "running";
  }
  if (!job.enabled) {
    return "paused";
  }
  if (job.last_error || job.last_status === "failed") {
    return "blocked";
  }
  if (job.last_status === "success") {
    return "verifying";
  }
  return "planned";
}

function buildCompletionAuditLabel(
  job: AutomationJobRecord,
  objectiveState: string,
): string {
  if (objectiveState === "verifying") {
    return "Completion Audit：运行成功后仍需 artifact / timeline / evidence 审计，暂不直接标记 completed。";
  }
  if (objectiveState === "blocked") {
    return `Completion Audit：blocked，需处理失败原因${job.last_error ? `：${job.last_error}` : "。"}`;
  }
  if (objectiveState === "running") {
    return "Completion Audit：运行中，等待 automation run 结束后再审计。";
  }
  if (objectiveState === "paused") {
    return "Completion Audit：paused，恢复并产生运行证据后再审计。";
  }
  return "Completion Audit：planned，等待首次运行证据。";
}
