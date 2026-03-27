import { useMemo } from "react";
import { EmptyStateQuickActions } from "../components/EmptyStateQuickActions";
import { resolveServiceSkillEntryDescription } from "./entryAdapter";
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
  const cloudSkills = useMemo(
    () => skills.filter((skill) => skill.source === "cloud_catalog"),
    [skills],
  );
  const localSkills = useMemo(
    () => skills.filter((skill) => skill.source === "local_custom"),
    [skills],
  );
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

  const buildQuickActionItems = useMemo(
    () =>
      (sectionSkills: ServiceSkillHomeItem[]) =>
        sectionSkills.map((skill) => {
          const secondaryStatus = skill.automationStatus
            ? {
                label: `本地任务 · ${skill.automationStatus.statusLabel}`,
                tone: skill.automationStatus.tone,
                description: skill.automationStatus.detail ?? undefined,
                actionable: true,
              }
            : skill.cloudStatus
              ? {
                  label: `云端状态 · ${skill.cloudStatus.statusLabel}`,
                  tone: skill.cloudStatus.tone,
                  description: skill.cloudStatus.detail ?? undefined,
                  actionable: false,
                }
              : null;

          return {
            key: skill.id,
            title: skill.title,
            description: resolveServiceSkillEntryDescription(skill),
            badge: skill.badge,
            prompt: "",
            actionLabel: skill.actionLabel,
            outputHint: skill.outputHint,
            secondaryStatusLabel: secondaryStatus?.label,
            secondaryStatusTone: secondaryStatus?.tone,
            secondaryStatusDescription: secondaryStatus?.description,
            secondaryStatusActionable: secondaryStatus?.actionable,
            statusLabel: skill.runnerLabel,
            statusTone: skill.runnerTone,
            statusDescription: skill.runnerDescription,
            testId: `service-skill-${skill.id}`,
          };
        }),
    [],
  );
  const cloudItems = useMemo(
    () => buildQuickActionItems(cloudSkills),
    [buildQuickActionItems, cloudSkills],
  );
  const localItems = useMemo(
    () => buildQuickActionItems(localSkills),
    [buildQuickActionItems, localSkills],
  );
  const resolveSkillById = useMemo(
    () =>
      (skillId: string) =>
        skills.find((candidate) => candidate.id === skillId) ?? null,
    [skills],
  );

  return (
    <div className="space-y-4">
      <EmptyStateQuickActions
        title="服务型技能"
        description="先选一个结果导向入口，补齐关键参数后直接进入对应工作模式。"
        headerAddon={
          catalogMeta && (cloudItems.length > 0 || loading) ? (
            <div className="flex flex-wrap items-center gap-2 text-[11px] leading-5 text-slate-500">
              <span className="rounded-full border border-slate-200/90 bg-slate-50/92 px-2.5 py-1">
                {catalogMeta.sourceLabel}
              </span>
              <span className="rounded-full border border-slate-200/90 bg-slate-50/92 px-2.5 py-1">
                Tenant · {catalogMeta.tenantId}
              </span>
              <span className="rounded-full border border-slate-200/90 bg-slate-50/92 px-2.5 py-1">
                Version · {catalogMeta.version}
              </span>
              <span className="rounded-full border border-slate-200/90 bg-slate-50/92 px-2.5 py-1">
                云目录 {cloudItems.length} 项
              </span>
              {localItems.length ? (
                <span className="rounded-full border border-amber-200/90 bg-amber-50/92 px-2.5 py-1 text-amber-700">
                  本地补充 {localItems.length} 项
                </span>
              ) : null}
              {syncedAtLabel ? (
                <span className="rounded-full border border-slate-200/90 bg-slate-50/92 px-2.5 py-1">
                  同步于 {syncedAtLabel}
                </span>
              ) : null}
            </div>
          ) : null
        }
        items={cloudItems}
        embedded
        loading={loading}
        onSecondaryStatusAction={
          onOpenAutomationJob
            ? (item) => {
                const skill = resolveSkillById(item.key);
                if (skill?.automationStatus) {
                  void onOpenAutomationJob(skill);
                }
              }
            : undefined
        }
        onAction={(item) => {
          const skill = resolveSkillById(item.key);
          if (skill) {
            void onSelect(skill);
          }
        }}
      />
      {localItems.length ? (
        <EmptyStateQuickActions
          title="本地技能 / 自定义技能"
          description="保留离线或项目级补充入口，但不覆盖 OEM 云目录中的正式服务项。"
          headerAddon={
            <div className="flex flex-wrap items-center gap-2 text-[11px] leading-5 text-slate-500">
              <span className="rounded-full border border-amber-200/90 bg-amber-50/92 px-2.5 py-1 font-medium text-amber-700">
                本地补充目录
              </span>
              <span className="rounded-full border border-slate-200/90 bg-slate-50/92 px-2.5 py-1">
                {localItems.length} 项
              </span>
            </div>
          }
          items={localItems}
          embedded
          onSecondaryStatusAction={
            onOpenAutomationJob
              ? (item) => {
                  const skill = resolveSkillById(item.key);
                  if (skill?.automationStatus) {
                    void onOpenAutomationJob(skill);
                  }
                }
              : undefined
          }
          onAction={(item) => {
            const skill = resolveSkillById(item.key);
            if (skill) {
              void onSelect(skill);
            }
          }}
        />
      ) : null}
    </div>
  );
}

export default ServiceSkillHomePanel;
