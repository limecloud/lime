import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, RefreshCw } from "lucide-react";
import {
  capabilityDraftsApi,
  type CapabilityDraftRegistrationApprovalRequest,
  type CapabilityDraftRegistrationVerificationGate,
  type CapabilityDraftVerificationEvidence,
  type WorkspaceRegisteredSkillRecord,
} from "@/lib/api/capabilityDrafts";
import {
  exportAgentRuntimeEvidencePack,
  listWorkspaceSkillBindings,
  type AgentRuntimeCompletionAuditSummary,
  type AgentRuntimeWorkspaceSkillBinding,
} from "@/lib/api/agentRuntime";
import {
  getAutomationJobs,
  getAutomationRunHistory,
  updateAutomationJob,
  type AutomationJobRecord,
} from "@/lib/api/automation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { buildAgentEnvelopeDraftPresentation } from "../agentEnvelopeDraftPresentation";
import {
  buildWorkspaceSkillManagedAutomationPresentation,
  canBuildWorkspaceSkillAgentAutomationDraft,
  isWorkspaceSkillAgentAutomationJobForDirectory,
  type WorkspaceSkillAgentAutomationDraftOptions,
} from "../workspaceSkillAgentAutomationDraft";

interface WorkspaceRegisteredSkillsPanelProps {
  workspaceRoot?: string | null;
  projectPending?: boolean;
  projectError?: string | null;
  refreshSignal?: number;
  workspaceId?: string | null;
  onEnableRuntime?: (binding: AgentRuntimeWorkspaceSkillBinding) => void;
  onCreateManagedAutomationDraft?: (
    binding: AgentRuntimeWorkspaceSkillBinding,
    options?: WorkspaceSkillAgentAutomationDraftOptions,
  ) => void;
  completionAuditSummariesByDirectory?: Record<
    string,
    AgentRuntimeCompletionAuditSummary | undefined
  >;
  className?: string;
}

function summarizePermissionSummary(skill: WorkspaceRegisteredSkillRecord) {
  if (skill.permissionSummary.length === 0) {
    return "未声明额外权限，默认停留在只读发现与注册审计。";
  }
  return skill.permissionSummary.slice(0, 2).join(" / ");
}

function summarizeResourceSummary(skill: WorkspaceRegisteredSkillRecord) {
  const resources = [
    skill.resourceSummary.hasScripts ? "scripts" : null,
    skill.resourceSummary.hasReferences ? "references" : null,
    skill.resourceSummary.hasAssets ? "assets" : null,
  ].filter((item): item is string => Boolean(item));

  return resources.length > 0 ? resources.join(" / ") : "纯 Skill 说明";
}

function summarizeStandardCompliance(skill: WorkspaceRegisteredSkillRecord) {
  if (skill.standardCompliance.validationErrors.length > 0) {
    return `标准检查仍有 ${skill.standardCompliance.validationErrors.length} 个问题`;
  }
  return skill.standardCompliance.isStandard
    ? "Agent Skills 标准通过"
    : "Agent Skills 标准状态待确认";
}

function summarizeBindingStatus(
  binding: AgentRuntimeWorkspaceSkillBinding | undefined,
) {
  if (!binding) {
    return "等待 runtime binding readiness 盘点。";
  }
  if (binding.binding_status === "blocked") {
    return (
      binding.binding_status_reason || "Runtime binding 当前被 gate 阻断。"
    );
  }
  return (
    binding.binding_status_reason ||
    "已具备后续 runtime binding 候选资格，但当前仍未进入默认工具面。"
  );
}

const REGISTRATION_EVIDENCE_LABELS: Record<string, string> = {
  credentialReferenceId: "凭证引用",
  endpointSource: "Endpoint",
  evidenceSchema: "证据 Schema",
  method: "方法",
  policyPath: "Policy",
  preflightMode: "Preflight",
};

const READONLY_HTTP_PREFLIGHT_CHECK_ID = "readonly_http_execution_preflight";

function skillRequiresControlledGetEvidence(
  skill: WorkspaceRegisteredSkillRecord,
): boolean {
  return Boolean(
    skill.registration.approvalRequests?.some(
      (request) => request.sourceCheckId === READONLY_HTTP_PREFLIGHT_CHECK_ID,
    ) ||
      skill.registration.verificationGates?.some(
        (gate) => gate.checkId === READONLY_HTTP_PREFLIGHT_CHECK_ID,
      ),
  );
}

function formatRegistrationEvidenceKey(key: string): string {
  return REGISTRATION_EVIDENCE_LABELS[key] ?? key;
}

function formatRegistrationEvidenceValue(
  evidence: CapabilityDraftVerificationEvidence,
) {
  return evidence.value.trim().replace(/\s+/g, " ");
}

function findRegistrationEvidenceValue(
  gate: CapabilityDraftRegistrationVerificationGate,
  key: string,
) {
  const evidence = gate.evidence.find((item) => item.key === key);
  return evidence ? formatRegistrationEvidenceValue(evidence) : "未记录";
}

function buildReadonlyHttpApprovalPreview(
  gate?: CapabilityDraftRegistrationVerificationGate,
  approvalRequest?: CapabilityDraftRegistrationApprovalRequest,
) {
  if (!gate) {
    return null;
  }

  return {
    approvalId: approvalRequest?.approvalId ?? "未生成",
    createdAt: approvalRequest?.createdAt ?? "未记录",
    status: approvalRequest?.status ?? "preview_only",
    credentialReferenceId:
      approvalRequest?.credentialReferenceId ??
      findRegistrationEvidenceValue(gate, "credentialReferenceId"),
    endpointSource:
      approvalRequest?.endpointSource ??
      findRegistrationEvidenceValue(gate, "endpointSource"),
    evidenceSchema:
      approvalRequest?.evidenceSchema.join(",") ??
      findRegistrationEvidenceValue(gate, "evidenceSchema"),
    method:
      approvalRequest?.method ?? findRegistrationEvidenceValue(gate, "method"),
    policyPath:
      approvalRequest?.policyPath ??
      findRegistrationEvidenceValue(gate, "policyPath"),
    consumptionGate: approvalRequest?.consumptionGate ?? null,
    credentialResolver: approvalRequest?.credentialResolver ?? null,
    consumptionInputSchema: approvalRequest?.consumptionInputSchema ?? null,
    sessionInputIntake: approvalRequest?.sessionInputIntake ?? null,
    sessionInputSubmissionContract:
      approvalRequest?.sessionInputSubmissionContract ?? null,
  };
}

function sortRegisteredSkills(
  skills: WorkspaceRegisteredSkillRecord[],
): WorkspaceRegisteredSkillRecord[] {
  return [...skills].sort((left, right) =>
    right.registration.registeredAt.localeCompare(
      left.registration.registeredAt,
    ),
  );
}

async function loadWorkspaceRegisteredState(workspaceRoot: string) {
  const [nextSkills, bindingSnapshot, automationJobs] = await Promise.all([
    capabilityDraftsApi.listRegisteredSkills({ workspaceRoot }),
    listWorkspaceSkillBindings({
      workspaceRoot,
      caller: "assistant",
      workbench: true,
    }),
    getAutomationJobs().catch(() => [] as AutomationJobRecord[]),
  ]);

  return {
    skills: nextSkills,
    bindings: Array.isArray(bindingSnapshot.bindings)
      ? bindingSnapshot.bindings
      : [],
    automationJobs,
  };
}

function WorkspaceRegisteredSkillCard({
  skill,
  binding,
  managedAutomationJobs,
  managedAutomationUpdatingJobId,
  completionAuditAuditingDirectory,
  completionAuditSummary,
  onToggleManagedAutomationJob,
  onAuditManagedAutomationJob,
  onEnableRuntime,
  onCreateManagedAutomationDraft,
}: {
  skill: WorkspaceRegisteredSkillRecord;
  binding?: AgentRuntimeWorkspaceSkillBinding;
  managedAutomationJobs: AutomationJobRecord[];
  managedAutomationUpdatingJobId?: string | null;
  completionAuditAuditingDirectory?: string | null;
  completionAuditSummary?: AgentRuntimeCompletionAuditSummary;
  onToggleManagedAutomationJob?: (
    job: AutomationJobRecord,
    enabled: boolean,
  ) => void;
  onAuditManagedAutomationJob?: (
    directory: string,
    job: AutomationJobRecord,
  ) => void;
  onEnableRuntime?: (binding: AgentRuntimeWorkspaceSkillBinding) => void;
  onCreateManagedAutomationDraft?: (
    binding: AgentRuntimeWorkspaceSkillBinding,
    options?: WorkspaceSkillAgentAutomationDraftOptions,
  ) => void;
}) {
  const bindingBlocked = binding?.binding_status === "blocked";
  const runtimeEnableReady =
    binding?.binding_status === "ready_for_manual_enable";
  const automationDraftOptions = {
    requiresControlledGetEvidence: skillRequiresControlledGetEvidence(skill),
  };
  const envelopeDraft = buildAgentEnvelopeDraftPresentation({
    skill,
    binding,
    completionAuditSummary,
  });
  const canCreateManagedAutomationDraft =
    canBuildWorkspaceSkillAgentAutomationDraft(binding);
  const canCreateAgentEnvelopeDraft =
    envelopeDraft.actionEnabled &&
    canCreateManagedAutomationDraft &&
    Boolean(onCreateManagedAutomationDraft);
  const managedAutomationPresentation =
    buildWorkspaceSkillManagedAutomationPresentation(managedAutomationJobs);
  const [managedAutomationJob] = managedAutomationJobs;
  const managedAutomationUpdating =
    managedAutomationJob?.id === managedAutomationUpdatingJobId;
  const completionAuditAuditing =
    completionAuditAuditingDirectory === skill.directory;
  const preflightGate = skill.registration.verificationGates?.find(
    (gate) => gate.checkId === READONLY_HTTP_PREFLIGHT_CHECK_ID,
  );
  const approvalRequest = skill.registration.approvalRequests?.find(
    (request) => request.sourceCheckId === READONLY_HTTP_PREFLIGHT_CHECK_ID,
  );
  const approvalPreview = buildReadonlyHttpApprovalPreview(
    preflightGate,
    approvalRequest,
  );

  return (
    <article className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
          <CheckCircle2 className="mr-1 h-3 w-3" />
          已注册
        </span>
        <span
          className={cn(
            "rounded-full border bg-white px-2.5 py-1 text-[11px] font-medium",
            bindingBlocked
              ? "border-amber-200 text-amber-700"
              : "border-sky-200 text-sky-700",
          )}
        >
          {bindingBlocked ? "Binding 阻塞" : "P3C binding 候选"}
        </span>
      </div>
      <div className="mt-2.5 space-y-1.5">
        <h3 className="text-sm font-semibold text-slate-900">
          {skill.name || skill.directory}
        </h3>
        <p className="line-clamp-2 text-[12px] leading-5 text-slate-600">
          {skill.description || "已注册为当前 Workspace 的本地 Skill 包。"}
        </p>
      </div>
      <div className="mt-3 space-y-1 text-[11px] leading-5 text-slate-500">
        <div>
          <span className="font-medium text-slate-700">目录：</span>
          {skill.directory}
        </div>
        <div>
          <span className="font-medium text-slate-700">来源：</span>
          {skill.registration.sourceDraftId}
          {skill.registration.sourceVerificationReportId
            ? ` / ${skill.registration.sourceVerificationReportId}`
            : ""}
        </div>
        <div>
          <span className="font-medium text-slate-700">权限：</span>
          {summarizePermissionSummary(skill)}
        </div>
        <div>
          <span className="font-medium text-slate-700">资源：</span>
          {summarizeResourceSummary(skill)}
        </div>
        <div>
          <span className="font-medium text-slate-700">标准：</span>
          {summarizeStandardCompliance(skill)}
        </div>
        <div>
          <span className="font-medium text-slate-700">运行绑定：</span>
          {summarizeBindingStatus(binding)}
        </div>
        <div className="text-sky-700">
          下一道 gate：
          {binding?.next_gate ||
            "manual_runtime_enable / Query Loop metadata / tool_runtime 授权裁剪"}
        </div>
      </div>
      {preflightGate ? (
        <div className="mt-3 rounded-2xl border border-sky-100 bg-white px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-slate-800">
              注册 provenance
            </span>
            <span className="text-[10px] leading-4 text-sky-700">
              {preflightGate.label || preflightGate.checkId}
            </span>
          </div>
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {preflightGate.evidence.slice(0, 6).map((evidence) => (
              <div
                key={`${preflightGate.checkId}:${evidence.key}`}
                className="rounded-xl border border-sky-100 bg-sky-50 px-2.5 py-1.5"
              >
                <div className="text-[10px] leading-4 text-slate-400">
                  {formatRegistrationEvidenceKey(evidence.key)}
                </div>
                <div className="truncate font-mono text-[10px] leading-4 text-slate-700">
                  {formatRegistrationEvidenceValue(evidence)}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {approvalPreview ? (
        <div className="mt-3 rounded-2xl border border-amber-100 bg-amber-50 px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-amber-900">
              Session approval request artifact
            </span>
            <span className="rounded-full border border-amber-200 bg-white px-2 py-0.5 text-[10px] font-medium text-amber-700">
              {approvalPreview.status} / 未执行 / 未保存凭证
            </span>
          </div>
          <p className="mt-1.5 text-[11px] leading-5 text-amber-800">
            真实 API 执行前必须先消费这条授权请求 artifact；当前只持久化审计入口，
            不保存 token，也不发请求。
          </p>
          {approvalPreview.consumptionGate ? (
            <div className="mt-2 rounded-xl border border-amber-200 bg-white px-2.5 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[10px] font-semibold text-amber-700">
                  消费门禁
                </span>
                <span className="font-mono text-[10px] text-slate-700">
                  {approvalPreview.consumptionGate.status}
                </span>
              </div>
              <p className="mt-1 text-[10px] leading-4 text-amber-800">
                {approvalPreview.consumptionGate.blockedReason}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {approvalPreview.consumptionGate.requiredInputs.map((input) => (
                  <span
                    key={input}
                    className="rounded-full border border-amber-100 bg-amber-50 px-2 py-0.5 font-mono text-[10px] text-amber-800"
                  >
                    {input}
                  </span>
                ))}
              </div>
              <div className="mt-1.5 text-[10px] leading-4 text-slate-600">
                runtimeExecution=
                {String(
                  approvalPreview.consumptionGate.runtimeExecutionEnabled,
                )}{" "}
                / credentialStorage=
                {String(
                  approvalPreview.consumptionGate.credentialStorageEnabled,
                )}
              </div>
            </div>
          ) : null}
          {approvalPreview.credentialResolver ? (
            <div className="mt-2 rounded-xl border border-amber-200 bg-white px-2.5 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[10px] font-semibold text-amber-700">
                  Session credential resolver
                </span>
                <span className="font-mono text-[10px] text-slate-700">
                  {approvalPreview.credentialResolver.status}
                </span>
              </div>
              <p className="mt-1 text-[10px] leading-4 text-amber-800">
                {approvalPreview.credentialResolver.blockedReason}
              </p>
              <div className="mt-1.5 grid gap-1 sm:grid-cols-2">
                {[
                  ["Reference", approvalPreview.credentialResolver.referenceId],
                  ["Scope", approvalPreview.credentialResolver.scope],
                  ["Source", approvalPreview.credentialResolver.source],
                  [
                    "Secret",
                    approvalPreview.credentialResolver.secretMaterialStatus,
                  ],
                  [
                    "tokenPersisted",
                    String(approvalPreview.credentialResolver.tokenPersisted),
                  ],
                  [
                    "runtimeInjection",
                    String(
                      approvalPreview.credentialResolver
                        .runtimeInjectionEnabled,
                    ),
                  ],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="rounded-lg border border-amber-100 bg-amber-50 px-2 py-1"
                  >
                    <span className="text-[10px] text-amber-600">
                      {label}
                    </span>
                    <span className="ml-1 break-words font-mono text-[10px] text-slate-700">
                      {value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {approvalPreview.consumptionInputSchema ? (
            <div className="mt-2 rounded-xl border border-amber-200 bg-white px-2.5 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[10px] font-semibold text-amber-700">
                  Approval consumption input schema
                </span>
                <span className="font-mono text-[10px] text-slate-700">
                  {approvalPreview.consumptionInputSchema.schemaId}
                </span>
              </div>
              <p className="mt-1 text-[10px] leading-4 text-amber-800">
                {approvalPreview.consumptionInputSchema.blockedReason}
              </p>
              <div className="mt-1.5 text-[10px] leading-4 text-slate-600">
                uiSubmission=
                {String(
                  approvalPreview.consumptionInputSchema.uiSubmissionEnabled,
                )}{" "}
                / runtimeExecution=
                {String(
                  approvalPreview.consumptionInputSchema
                    .runtimeExecutionEnabled,
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {approvalPreview.consumptionInputSchema.fields.map((field) => (
                  <span
                    key={field.key}
                    className="rounded-full border border-amber-100 bg-amber-50 px-2 py-0.5 font-mono text-[10px] text-amber-800"
                    title={field.description}
                  >
                    {field.key}:{field.kind}
                    {field.required ? ":required" : ""}
                    {field.secret ? ":secret" : ""}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {approvalPreview.sessionInputIntake ? (
            <div className="mt-2 rounded-xl border border-amber-200 bg-white px-2.5 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[10px] font-semibold text-amber-700">
                  Session input intake
                </span>
                <span className="font-mono text-[10px] text-slate-700">
                  {approvalPreview.sessionInputIntake.status}
                </span>
              </div>
              <p className="mt-1 text-[10px] leading-4 text-amber-800">
                {approvalPreview.sessionInputIntake.blockedReason}
              </p>
              <div className="mt-1.5 grid gap-1 sm:grid-cols-2">
                {[
                  ["Schema", approvalPreview.sessionInputIntake.schemaId],
                  ["Scope", approvalPreview.sessionInputIntake.scope],
                  [
                    "Credential",
                    approvalPreview.sessionInputIntake.credentialReferenceId,
                  ],
                  [
                    "Secret",
                    approvalPreview.sessionInputIntake.secretMaterialStatus,
                  ],
                  [
                    "endpointPersisted",
                    String(
                      approvalPreview.sessionInputIntake.endpointInputPersisted,
                    ),
                  ],
                  [
                    "tokenPersisted",
                    String(approvalPreview.sessionInputIntake.tokenPersisted),
                  ],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="rounded-lg border border-amber-100 bg-amber-50 px-2 py-1"
                  >
                    <span className="text-[10px] text-amber-600">
                      {label}
                    </span>
                    <span className="ml-1 break-words font-mono text-[10px] text-slate-700">
                      {value}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-1.5 text-[10px] leading-4 text-slate-600">
                uiSubmission=
                {String(approvalPreview.sessionInputIntake.uiSubmissionEnabled)}{" "}
                / runtimeExecution=
                {String(
                  approvalPreview.sessionInputIntake.runtimeExecutionEnabled,
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {approvalPreview.sessionInputIntake.missingFieldKeys.map(
                  (fieldKey) => (
                    <span
                      key={fieldKey}
                      className="rounded-full border border-amber-100 bg-amber-50 px-2 py-0.5 font-mono text-[10px] text-amber-800"
                    >
                      missing:{fieldKey}
                    </span>
                  ),
                )}
              </div>
            </div>
          ) : null}
          {approvalPreview.sessionInputSubmissionContract ? (
            <div className="mt-2 rounded-xl border border-amber-200 bg-white px-2.5 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[10px] font-semibold text-amber-700">
                  Session submission contract
                </span>
                <span className="font-mono text-[10px] text-slate-700">
                  {approvalPreview.sessionInputSubmissionContract.status}
                </span>
              </div>
              <p className="mt-1 text-[10px] leading-4 text-amber-800">
                {approvalPreview.sessionInputSubmissionContract.blockedReason}
              </p>
              <div className="mt-1.5 grid gap-1 sm:grid-cols-2">
                {[
                  [
                    "Mode",
                    approvalPreview.sessionInputSubmissionContract.mode,
                  ],
                  [
                    "Retention",
                    approvalPreview.sessionInputSubmissionContract
                      .valueRetention,
                  ],
                  [
                    "submitHandler",
                    String(
                      approvalPreview.sessionInputSubmissionContract
                        .submissionHandlerEnabled,
                    ),
                  ],
                  [
                    "secretAccepted",
                    String(
                      approvalPreview.sessionInputSubmissionContract
                        .secretMaterialAccepted,
                    ),
                  ],
                  [
                    "evidenceRequired",
                    String(
                      approvalPreview.sessionInputSubmissionContract
                        .evidenceCaptureRequired,
                    ),
                  ],
                  [
                    "runtimeExecution",
                    String(
                      approvalPreview.sessionInputSubmissionContract
                        .runtimeExecutionEnabled,
                    ),
                  ],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="rounded-lg border border-amber-100 bg-amber-50 px-2 py-1"
                  >
                    <span className="text-[10px] text-amber-600">
                      {label}
                    </span>
                    <span className="ml-1 break-words font-mono text-[10px] text-slate-700">
                      {value}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {approvalPreview.sessionInputSubmissionContract.validationRules.map(
                  (rule) => (
                    <span
                      key={rule.fieldKey}
                      className="rounded-full border border-amber-100 bg-amber-50 px-2 py-0.5 font-mono text-[10px] text-amber-800"
                      title={rule.rule}
                    >
                      validate:{rule.fieldKey}:{rule.kind}
                      {rule.required ? ":required" : ""}
                    </span>
                  ),
                )}
              </div>
            </div>
          ) : null}
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {[
              ["Approval ID", approvalPreview.approvalId],
              ["状态", approvalPreview.status],
              ["Endpoint", approvalPreview.endpointSource],
              ["方法", approvalPreview.method],
              ["凭证引用", approvalPreview.credentialReferenceId],
              ["Policy", approvalPreview.policyPath],
              ["创建时间", approvalPreview.createdAt],
              ["证据 Schema", approvalPreview.evidenceSchema],
            ].map(([label, value]) => (
              <div
                key={label}
                className={cn(
                  "rounded-xl border border-amber-100 bg-white px-2.5 py-1.5",
                  label === "证据 Schema" && "sm:col-span-2",
                )}
              >
                <div className="text-[10px] leading-4 text-amber-600">
                  {label}
                </div>
                <div className="break-words font-mono text-[10px] leading-4 text-slate-700">
                  {value}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div className="mt-3 rounded-2xl border border-dashed border-cyan-200 bg-white px-3 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-semibold text-cyan-800">
            Agent envelope 草案
          </span>
          <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-[10px] font-medium text-cyan-700">
            {envelopeDraft.statusLabel}
          </span>
        </div>
        <p className="mt-1.5 text-[11px] leading-5 text-slate-600">
          {envelopeDraft.description}
        </p>
        <div className="mt-2 grid gap-1 text-[11px] leading-5 text-slate-500">
          <span>{envelopeDraft.agentCardLabel}</span>
          <span>{envelopeDraft.sharingLabel}</span>
          <span>{envelopeDraft.sharingDiscoveryLabel}</span>
          <span>{envelopeDraft.runbookLabel}</span>
          <span>{envelopeDraft.memoryLabel}</span>
          <span>{envelopeDraft.widgetLabel}</span>
          <span>{envelopeDraft.permissionLabel}</span>
          <span>{envelopeDraft.scheduleLabel}</span>
          <span>{envelopeDraft.evidenceLabel}</span>
          <span>{managedAutomationPresentation.statusLabel}</span>
          <span>{managedAutomationPresentation.scheduleLabel}</span>
          <span>{managedAutomationPresentation.lastRunLabel}</span>
          <span>{managedAutomationPresentation.objectiveLabel}</span>
          <span>{managedAutomationPresentation.auditLabel}</span>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="mt-2 h-7 rounded-xl px-2.5 text-[11px] text-cyan-700 hover:bg-cyan-50"
          disabled={!canCreateAgentEnvelopeDraft}
          onClick={() => {
            if (binding && canCreateAgentEnvelopeDraft) {
              onCreateManagedAutomationDraft?.(binding, automationDraftOptions);
            }
          }}
          data-testid="workspace-registered-agent-envelope-action"
        >
          {envelopeDraft.actionLabel}
        </Button>
        {onCreateManagedAutomationDraft && binding ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="ml-2 mt-2 h-7 rounded-xl border-cyan-200 bg-cyan-50 px-2.5 text-[11px] text-cyan-800 hover:bg-cyan-100"
            disabled={!canCreateManagedAutomationDraft}
            onClick={() =>
              onCreateManagedAutomationDraft(binding, automationDraftOptions)
            }
            data-testid="workspace-registered-agent-managed-automation"
          >
            创建 Managed Job 草案
          </Button>
        ) : null}
        {managedAutomationJob && onToggleManagedAutomationJob ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-2 mt-2 h-7 rounded-xl px-2.5 text-[11px] text-slate-600 hover:bg-slate-50"
            disabled={managedAutomationUpdating}
            onClick={() =>
              onToggleManagedAutomationJob(
                managedAutomationJob,
                !managedAutomationJob.enabled,
              )
            }
            data-testid="workspace-registered-agent-managed-automation-toggle"
          >
            {managedAutomationJob.enabled
              ? "暂停 Managed Job"
              : "恢复 Managed Job"}
          </Button>
        ) : null}
        {managedAutomationJob && onAuditManagedAutomationJob ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-2 mt-2 h-7 rounded-xl px-2.5 text-[11px] text-emerald-700 hover:bg-emerald-50"
            disabled={completionAuditAuditing}
            onClick={() =>
              onAuditManagedAutomationJob(skill.directory, managedAutomationJob)
            }
            data-testid="workspace-registered-agent-completion-audit"
          >
            {completionAuditAuditing ? "正在审计" : "审计最近运行"}
          </Button>
        ) : null}
      </div>
      {onEnableRuntime && binding ? (
        <div className="mt-3 border-t border-slate-200 pt-3">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="rounded-2xl border-sky-200 bg-white px-3 text-[12px] text-sky-700 hover:bg-sky-50 hover:text-sky-900"
            disabled={!runtimeEnableReady}
            onClick={() => onEnableRuntime(binding)}
            data-testid="workspace-registered-skill-enable-runtime"
          >
            本回合启用
          </Button>
          <span className="ml-2 align-middle text-[11px] text-slate-500">
            只写入 session enable metadata，不创建自动化。
          </span>
        </div>
      ) : null}
    </article>
  );
}

export function WorkspaceRegisteredSkillsPanel({
  workspaceRoot,
  projectPending = false,
  projectError,
  refreshSignal = 0,
  workspaceId,
  onEnableRuntime,
  onCreateManagedAutomationDraft,
  completionAuditSummariesByDirectory,
  className,
}: WorkspaceRegisteredSkillsPanelProps) {
  const [skills, setSkills] = useState<WorkspaceRegisteredSkillRecord[]>([]);
  const [bindings, setBindings] = useState<AgentRuntimeWorkspaceSkillBinding[]>(
    [],
  );
  const [automationJobs, setAutomationJobs] = useState<AutomationJobRecord[]>(
    [],
  );
  const [managedAutomationUpdatingJobId, setManagedAutomationUpdatingJobId] =
    useState<string | null>(null);
  const [completionAuditSummaries, setCompletionAuditSummaries] = useState<
    Record<string, AgentRuntimeCompletionAuditSummary | undefined>
  >({});
  const [completionAuditAuditingDirectory, setCompletionAuditAuditingDirectory] =
    useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const normalizedWorkspaceRoot = workspaceRoot?.trim() || null;

  const loadRegisteredSkills = useCallback(async () => {
    if (!normalizedWorkspaceRoot) {
      setSkills([]);
      setBindings([]);
      setAutomationJobs([]);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const nextState = await loadWorkspaceRegisteredState(
        normalizedWorkspaceRoot,
      );
      setSkills(nextState.skills);
      setBindings(nextState.bindings);
      setAutomationJobs(nextState.automationJobs);
    } catch (loadError) {
      setSkills([]);
      setBindings([]);
      setAutomationJobs([]);
      setError(String(loadError));
    } finally {
      setLoading(false);
    }
  }, [normalizedWorkspaceRoot]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!normalizedWorkspaceRoot) {
        setSkills([]);
        setBindings([]);
        setAutomationJobs([]);
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const nextState = await loadWorkspaceRegisteredState(
          normalizedWorkspaceRoot,
        );
        if (!cancelled) {
          setSkills(nextState.skills);
          setBindings(nextState.bindings);
          setAutomationJobs(nextState.automationJobs);
        }
      } catch (loadError) {
        if (!cancelled) {
          setSkills([]);
          setBindings([]);
          setAutomationJobs([]);
          setError(String(loadError));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [normalizedWorkspaceRoot, refreshSignal]);

  const visibleSkills = useMemo(
    () => sortRegisteredSkills(skills).slice(0, 4),
    [skills],
  );
  const bindingByDirectory = useMemo(() => {
    const next = new Map<string, AgentRuntimeWorkspaceSkillBinding>();
    bindings.forEach((binding) => {
      if (binding.directory) {
        next.set(binding.directory, binding);
      }
    });
    return next;
  }, [bindings]);
  const managedAutomationJobsByDirectory = useMemo(() => {
    const next = new Map<string, AutomationJobRecord[]>();
    for (const skill of skills) {
      next.set(
        skill.directory,
        automationJobs.filter(
          (job) =>
            (!workspaceId || job.workspace_id === workspaceId) &&
            isWorkspaceSkillAgentAutomationJobForDirectory(
              job,
              skill.directory,
            ),
        ),
      );
    }
    return next;
  }, [automationJobs, skills, workspaceId]);
  const handleToggleManagedAutomationJob = useCallback(
    async (job: AutomationJobRecord, enabled: boolean) => {
      setManagedAutomationUpdatingJobId(job.id);
      setError(null);
      try {
        const updatedJob = await updateAutomationJob(job.id, { enabled });
        setAutomationJobs((previousJobs) =>
          previousJobs.map((item) =>
            item.id === updatedJob.id ? updatedJob : item,
          ),
        );
      } catch (toggleError) {
        setError(String(toggleError));
      } finally {
        setManagedAutomationUpdatingJobId(null);
      }
    },
    [],
  );
  const handleAuditManagedAutomationJob = useCallback(
    async (directory: string, job: AutomationJobRecord) => {
      setCompletionAuditAuditingDirectory(directory);
      setError(null);
      try {
        const runs = await getAutomationRunHistory(job.id, 5);
        const sessionId = runs.find((run) => run.session_id)?.session_id;
        if (!sessionId) {
          throw new Error("最近 automation run 没有关联 session，无法导出 evidence。");
        }
        const evidencePack = await exportAgentRuntimeEvidencePack(sessionId);
        setCompletionAuditSummaries((previous) => ({
          ...previous,
          [directory]: evidencePack.completion_audit_summary,
        }));
      } catch (auditError) {
        setError(String(auditError));
      } finally {
        setCompletionAuditAuditingDirectory(null);
      }
    },
    [],
  );
  const effectiveError = projectError || error;
  const isBusy = projectPending || loading;

  return (
    <section
      className={cn(
        "rounded-[28px] border border-sky-200/80 bg-white p-5 shadow-sm shadow-sky-950/5",
        className,
      )}
      data-testid="workspace-registered-skills-panel"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-700">
              注册区
            </span>
            <h2 className="text-[15px] font-semibold text-slate-900">
              Workspace 已注册能力
            </h2>
          </div>
          <p className="text-[11px] leading-5 text-slate-500">
            这里只有已通过验证并写入当前项目的 Skill 包；运行仍要等 runtime
            gate。
          </p>
        </div>
        {normalizedWorkspaceRoot ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="rounded-2xl px-3 text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            onClick={() => void loadRegisteredSkills()}
            disabled={isBusy}
            data-testid="workspace-registered-skills-refresh"
          >
            <RefreshCw
              className={cn("mr-1.5 h-3.5 w-3.5", isBusy && "animate-spin")}
            />
            刷新
          </Button>
        ) : null}
      </div>

      {!normalizedWorkspaceRoot ? (
        <div className="mt-4 rounded-[22px] border border-dashed border-sky-200 bg-sky-50/60 px-4 py-5 text-sm leading-6 text-sky-800">
          选择或进入一个项目后，才能查看该项目已注册的 generated skill。
        </div>
      ) : effectiveError ? (
        <div className="mt-4 rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-5 text-sm leading-6 text-rose-700">
          已注册能力暂时没读到：{effectiveError}
        </div>
      ) : isBusy ? (
        <div className="mt-4 rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-5 text-sm leading-6 text-slate-500">
          正在读取已注册能力...
        </div>
      ) : visibleSkills.length === 0 ? (
        <div className="mt-4 rounded-[22px] border border-dashed border-sky-200 bg-sky-50/60 px-4 py-5 text-sm leading-6 text-sky-800">
          当前项目还没有通过 P3A
          注册的能力。草案通过验证并注册后，会先出现在这里。
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {visibleSkills.map((skill) => (
            <WorkspaceRegisteredSkillCard
              key={skill.key || skill.directory}
              skill={skill}
              binding={bindingByDirectory.get(skill.directory)}
              managedAutomationJobs={
                managedAutomationJobsByDirectory.get(skill.directory) ?? []
              }
              managedAutomationUpdatingJobId={managedAutomationUpdatingJobId}
              completionAuditAuditingDirectory={
                completionAuditAuditingDirectory
              }
              completionAuditSummary={
                completionAuditSummaries[skill.directory] ??
                completionAuditSummariesByDirectory?.[skill.directory]
              }
              onToggleManagedAutomationJob={handleToggleManagedAutomationJob}
              onAuditManagedAutomationJob={handleAuditManagedAutomationJob}
              onEnableRuntime={onEnableRuntime}
              onCreateManagedAutomationDraft={onCreateManagedAutomationDraft}
            />
          ))}
        </div>
      )}
    </section>
  );
}
