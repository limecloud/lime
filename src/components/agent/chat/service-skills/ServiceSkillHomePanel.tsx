import { useMemo } from "react";
import { EmptyStateQuickActions } from "../components/EmptyStateQuickActions";
import type { ServiceSkillCatalogMeta, ServiceSkillHomeItem } from "./types";

interface ServiceSkillHomePanelProps {
  skills: ServiceSkillHomeItem[];
  catalogMeta?: ServiceSkillCatalogMeta | null;
  loading?: boolean;
  onSelect: (skill: ServiceSkillHomeItem) => void | Promise<void>;
  onOpenAutomationJob?: (skill: ServiceSkillHomeItem) => void | Promise<void>;
}

export function ServiceSkillHomePanel({
  skills,
  catalogMeta = null,
  loading = false,
  onSelect,
  onOpenAutomationJob,
}: ServiceSkillHomePanelProps) {
  const syncedAtLabel = useMemo(() => {
    if (!catalogMeta?.syncedAt) {
      return null;
    }

    const parsed = new Date(catalogMeta.syncedAt);
    if (Number.isNaN(parsed.getTime())) {
      return catalogMeta.syncedAt;
    }

    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(parsed);
  }, [catalogMeta?.syncedAt]);

  const items = useMemo(
    () =>
      skills.map((skill) => ({
        key: skill.id,
        title: skill.title,
        description: skill.summary,
        badge: skill.badge,
        prompt: "",
        actionLabel: skill.actionLabel,
        outputHint: skill.outputHint,
        secondaryStatusLabel: skill.automationStatus
          ? `本地任务 · ${skill.automationStatus.statusLabel}`
          : undefined,
        secondaryStatusTone: skill.automationStatus?.tone,
        secondaryStatusDescription: skill.automationStatus?.detail ?? undefined,
        statusLabel: skill.runnerLabel,
        statusTone: skill.runnerTone,
        statusDescription: skill.runnerDescription,
        testId: `service-skill-${skill.id}`,
      })),
    [skills],
  );

  return (
    <EmptyStateQuickActions
      title="服务型技能"
      description="先选一个结果导向入口，补齐关键参数后直接进入对应工作模式。"
      headerAddon={
        catalogMeta ? (
          <div className="flex flex-wrap items-center gap-2 text-[11px] leading-5 text-slate-500">
            <span className="rounded-full border border-slate-200 bg-white/92 px-2.5 py-1 font-medium text-slate-600">
              {catalogMeta.sourceLabel}
            </span>
            <span className="rounded-full border border-slate-200/90 bg-slate-50/92 px-2.5 py-1">
              Tenant · {catalogMeta.tenantId}
            </span>
            <span className="rounded-full border border-slate-200/90 bg-slate-50/92 px-2.5 py-1">
              Version · {catalogMeta.version}
            </span>
            <span className="rounded-full border border-slate-200/90 bg-slate-50/92 px-2.5 py-1">
              {catalogMeta.itemCount} 项
            </span>
            {syncedAtLabel ? (
              <span className="rounded-full border border-slate-200/90 bg-slate-50/92 px-2.5 py-1">
                同步于 {syncedAtLabel}
              </span>
            ) : null}
          </div>
        ) : null
      }
      items={items}
      embedded
      loading={loading}
      onSecondaryStatusAction={
        onOpenAutomationJob
          ? (item) => {
              const skill = skills.find((candidate) => candidate.id === item.key);
              if (skill?.automationStatus) {
                void onOpenAutomationJob(skill);
              }
            }
          : undefined
      }
      onAction={(item) => {
        const skill = skills.find((candidate) => candidate.id === item.key);
        if (skill) {
          void onSelect(skill);
        }
      }}
    />
  );
}

export default ServiceSkillHomePanel;
