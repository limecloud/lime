import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, RefreshCw } from "lucide-react";
import {
  capabilityDraftsApi,
  type WorkspaceRegisteredSkillRecord,
} from "@/lib/api/capabilityDrafts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface WorkspaceRegisteredSkillsPanelProps {
  workspaceRoot?: string | null;
  projectPending?: boolean;
  projectError?: string | null;
  refreshSignal?: number;
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

function sortRegisteredSkills(
  skills: WorkspaceRegisteredSkillRecord[],
): WorkspaceRegisteredSkillRecord[] {
  return [...skills].sort((left, right) =>
    right.registration.registeredAt.localeCompare(
      left.registration.registeredAt,
    ),
  );
}

export function WorkspaceRegisteredSkillsPanel({
  workspaceRoot,
  projectPending = false,
  projectError,
  refreshSignal = 0,
  className,
}: WorkspaceRegisteredSkillsPanelProps) {
  const [skills, setSkills] = useState<WorkspaceRegisteredSkillRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const normalizedWorkspaceRoot = workspaceRoot?.trim() || null;

  const loadRegisteredSkills = useCallback(async () => {
    if (!normalizedWorkspaceRoot) {
      setSkills([]);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const nextSkills = await capabilityDraftsApi.listRegisteredSkills({
        workspaceRoot: normalizedWorkspaceRoot,
      });
      setSkills(nextSkills);
    } catch (loadError) {
      setSkills([]);
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
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const nextSkills = await capabilityDraftsApi.listRegisteredSkills({
          workspaceRoot: normalizedWorkspaceRoot,
        });
        if (!cancelled) {
          setSkills(nextSkills);
        }
      } catch (loadError) {
        if (!cancelled) {
          setSkills([]);
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
          当前项目还没有通过 P3A 注册的能力。草案通过验证并注册后，会先出现在这里。
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {visibleSkills.map((skill) => (
            <article
              key={skill.key || skill.directory}
              className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-3.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                  <CheckCircle2 className="mr-1 h-3 w-3" />
                  已注册
                </span>
                <span className="rounded-full border border-sky-200 bg-white px-2.5 py-1 text-[11px] font-medium text-sky-700">
                  待 runtime gate
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
                <div className="text-sky-700">
                  待运行接入：
                  {skill.runtimeGate ||
                    "进入运行前还需要 Query Loop 与 tool_runtime 授权。"}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
