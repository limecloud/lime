import type { WorkspaceRegisteredSkillRecord } from "@/lib/api/capabilityDrafts";
import type {
  AgentRuntimeCompletionAuditSummary,
  AgentRuntimeWorkspaceSkillBinding,
} from "@/lib/api/agentRuntime";

export type AgentEnvelopeDraftStage =
  | "blocked"
  | "manual_enable_required"
  | "source_metadata_ready"
  | "evidence_ready";

export type AgentEnvelopeDraftEvidenceStatus =
  | "missing"
  | "source_metadata_only"
  | "evidence_pack_ready";

export interface WorkspaceSkillRuntimeSourceMetadata {
  workspaceRoot?: string;
  workspace_root?: string;
  authorizationScope?: string;
  authorization_scope?: string;
  directory?: string;
  registeredSkillDirectory?: string;
  registered_skill_directory?: string;
  skillName?: string;
  skill?: string;
  sourceDraftId?: string;
  source_draft_id?: string;
  sourceVerificationReportId?: string | null;
  source_verification_report_id?: string | null;
  permissionSummary?: string[];
  permission_summary?: string[];
}

export interface AgentEnvelopeDraftPresentation {
  id: string;
  name: string;
  stage: AgentEnvelopeDraftStage;
  statusLabel: string;
  actionLabel: string;
  actionEnabled: boolean;
  description: string;
  agentCardLabel: string;
  sharingLabel: string;
  sharingDiscoveryLabel: string;
  runbookLabel: string;
  memoryLabel: string;
  widgetLabel: string;
  permissionLabel: string;
  scheduleLabel: string;
  evidenceStatus: AgentEnvelopeDraftEvidenceStatus;
  evidenceLabel: string;
  sourceDraftId: string;
  sourceVerificationReportId?: string | null;
  registeredSkillDirectory: string;
}

export interface BuildAgentEnvelopeDraftPresentationParams {
  skill: WorkspaceRegisteredSkillRecord;
  binding?: AgentRuntimeWorkspaceSkillBinding;
  sourceMetadata?: WorkspaceSkillRuntimeSourceMetadata | null;
  evidencePackId?: string | null;
  completionAuditSummary?: AgentRuntimeCompletionAuditSummary | null;
}

function firstNonEmpty(...values: Array<string | null | undefined>): string {
  return (
    values.find((value) => typeof value === "string" && value.trim())?.trim() ??
    ""
  );
}

function sourcePermissionSummary(
  skill: WorkspaceRegisteredSkillRecord,
  binding?: AgentRuntimeWorkspaceSkillBinding,
  sourceMetadata?: WorkspaceSkillRuntimeSourceMetadata | null,
): string[] {
  const fromMetadata =
    sourceMetadata?.permissionSummary ?? sourceMetadata?.permission_summary;
  if (Array.isArray(fromMetadata) && fromMetadata.length > 0) {
    return fromMetadata.filter(Boolean);
  }
  if (binding?.permission_summary?.length) {
    return binding.permission_summary;
  }
  return skill.permissionSummary;
}

function buildPermissionLabel(permissionSummary: string[]): string {
  if (permissionSummary.length === 0) {
    return "权限：默认手动确认，未声明额外外部写权限。";
  }
  return `权限：${permissionSummary.slice(0, 2).join(" / ")}。`;
}

function resolveStage(
  binding?: AgentRuntimeWorkspaceSkillBinding,
  sourceMetadata?: WorkspaceSkillRuntimeSourceMetadata | null,
  evidencePackId?: string | null,
  completionAuditSummary?: AgentRuntimeCompletionAuditSummary | null,
): AgentEnvelopeDraftStage {
  if (binding?.binding_status === "blocked") {
    return "blocked";
  }
  if (isCompletionAuditReady(completionAuditSummary)) {
    return "evidence_ready";
  }
  if (sourceMetadata || evidencePackId?.trim()) {
    return "source_metadata_ready";
  }
  return "manual_enable_required";
}

function isCompletionAuditReady(
  summary?: AgentRuntimeCompletionAuditSummary | null,
): boolean {
  return Boolean(
    summary?.decision === "completed" &&
      summary.required_evidence.automation_owner &&
      summary.required_evidence.workspace_skill_tool_call &&
      summary.required_evidence.artifact_or_timeline,
  );
}

function evidenceStatusForStage(
  stage: AgentEnvelopeDraftStage,
): AgentEnvelopeDraftEvidenceStatus {
  if (stage === "evidence_ready") {
    return "evidence_pack_ready";
  }
  if (stage === "source_metadata_ready") {
    return "source_metadata_only";
  }
  return "missing";
}

export function buildAgentEnvelopeDraftPresentation({
  skill,
  binding,
  sourceMetadata,
  evidencePackId,
  completionAuditSummary,
}: BuildAgentEnvelopeDraftPresentationParams): AgentEnvelopeDraftPresentation {
  const completionAuditReady = isCompletionAuditReady(completionAuditSummary);
  const stage = resolveStage(
    binding,
    sourceMetadata,
    evidencePackId,
    completionAuditSummary,
  );
  const evidenceStatus = evidenceStatusForStage(stage);
  const sourceDraftId = firstNonEmpty(
    sourceMetadata?.sourceDraftId,
    sourceMetadata?.source_draft_id,
    binding?.registration.sourceDraftId,
    binding?.registration.source_draft_id,
    skill.registration.sourceDraftId,
  );
  const sourceVerificationReportId =
    firstNonEmpty(
      sourceMetadata?.sourceVerificationReportId ?? undefined,
      sourceMetadata?.source_verification_report_id ?? undefined,
      binding?.registration.sourceVerificationReportId ?? undefined,
      binding?.registration.source_verification_report_id ?? undefined,
      skill.registration.sourceVerificationReportId ?? undefined,
    ) || null;
  const registeredSkillDirectory = firstNonEmpty(
    sourceMetadata?.registeredSkillDirectory,
    sourceMetadata?.registered_skill_directory,
    binding?.registered_skill_directory,
    skill.registeredSkillDirectory,
    skill.registration.registeredSkillDirectory,
  );
  const permissionSummary = sourcePermissionSummary(
    skill,
    binding,
    sourceMetadata,
  );

  const blockedReason =
    binding?.binding_status === "blocked"
      ? binding.binding_status_reason || "runtime binding 当前被 gate 阻断"
      : "";

  const statusLabelByStage: Record<AgentEnvelopeDraftStage, string> = {
    blocked: "Agent 草案阻塞",
    manual_enable_required: "等待成功运行",
    source_metadata_ready: "等待 Completion Audit",
    evidence_ready: "Evidence 已就绪",
  };

  const blockingReasons =
    completionAuditSummary?.blocking_reasons.filter(Boolean) ?? [];
  const pendingEvidencePackLabel =
    evidencePackId?.trim() && !completionAuditReady
      ? `Evidence：已关联 evidence pack ${evidencePackId.trim()}，但还缺 completed completion audit，不能固化为 Agent。`
      : null;
  const completedEvidenceLabel = completionAuditSummary
    ? `Evidence：completion audit ${completionAuditSummary.decision}，owner ${completionAuditSummary.successful_owner_run_count}/${completionAuditSummary.owner_run_count}，ToolCall ${completionAuditSummary.workspace_skill_tool_call_count}，artifact ${completionAuditSummary.artifact_count}${
        blockingReasons.length > 0
          ? `，阻塞：${blockingReasons.slice(0, 2).join(" / ")}`
          : ""
      }。`
    : `Evidence：已关联 evidence pack${evidencePackId ? ` ${evidencePackId}` : ""}。`;

  const evidenceLabelByStatus: Record<AgentEnvelopeDraftEvidenceStatus, string> = {
    missing: "Evidence：还没有成功运行证据；先通过本回合启用拿到一次结果。",
    source_metadata_only:
      pendingEvidencePackLabel ??
      "Evidence：已有 P3E source metadata，可追踪本次 session 授权来源。",
    evidence_pack_ready: completedEvidenceLabel,
  };

  return {
    id: `agent-envelope:${skill.directory}`,
    name: skill.name || skill.directory,
    stage,
    statusLabel: statusLabelByStage[stage],
    actionLabel:
      stage === "blocked"
        ? "先解除阻塞"
        : stage === "manual_enable_required"
          ? "先本回合启用"
          : "转成 Agent 草案",
    actionEnabled: completionAuditReady,
    description:
      stage === "blocked"
        ? blockedReason
        : "成功运行后可把 Skill、权限、手动 rerun 和 evidence 组合成 Workspace Agent envelope。",
    agentCardLabel:
      stage === "evidence_ready"
        ? `Agent card：workspace-local/${skill.directory}，由已注册 Skill、Managed Job 和 completion audit 派生。`
        : "Agent card：等待 evidence-ready 后派生，不创建平行持久化实体。",
    sharingLabel:
      stage === "evidence_ready"
        ? "Sharing：可在当前 workspace / team 内共享；不进入 public Marketplace。"
        : "Sharing：未完成审计前仅对当前操作者展示草案。",
    sharingDiscoveryLabel: registeredSkillDirectory
      ? `Discovery：同 workspace 成员通过 registered skill 发现 ${registeredSkillDirectory}，复用同一 Managed Job / evidence。`
      : "Discovery：等待 workspace-local skill 注册路径后再进入团队发现。",
    runbookLabel: `Runbook：${firstNonEmpty(
      sourceMetadata?.skillName,
      sourceMetadata?.skill,
      `project:${skill.directory}`,
    )}`,
    memoryLabel: sourceVerificationReportId
      ? `Memory：引用 verification report ${sourceVerificationReportId} 与后续运行修正。`
      : "Memory：等待首轮运行后记录用户偏好、方法论和修正历史。",
    widgetLabel:
      stage === "evidence_ready"
        ? "Widget：展示 Managed Job 状态、最近产物、审计结论和下一步动作。"
        : "Widget：等待运行后展示状态、产物、阻塞点和 evidence 入口。",
    permissionLabel: buildPermissionLabel(permissionSummary),
    scheduleLabel: "Schedule：第一刀仅支持 manual rerun 草案，不创建长期任务。",
    evidenceStatus,
    evidenceLabel: evidenceLabelByStatus[evidenceStatus],
    sourceDraftId,
    sourceVerificationReportId,
    registeredSkillDirectory,
  };
}
