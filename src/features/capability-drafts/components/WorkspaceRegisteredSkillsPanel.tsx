import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, RefreshCw } from "lucide-react";
import {
  capabilityDraftsApi,
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
  ) => void;
}) {
  const bindingBlocked = binding?.binding_status === "blocked";
  const runtimeEnableReady =
    binding?.binding_status === "ready_for_manual_enable";
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
              onCreateManagedAutomationDraft?.(binding);
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
            onClick={() => onCreateManagedAutomationDraft(binding)}
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
