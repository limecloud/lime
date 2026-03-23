import { useMemo } from "react";
import { EmptyStateQuickActions } from "../components/EmptyStateQuickActions";
import type { ServiceSkillHomeItem } from "./types";

interface ServiceSkillHomePanelProps {
  skills: ServiceSkillHomeItem[];
  loading?: boolean;
  onSelect: (skill: ServiceSkillHomeItem) => void | Promise<void>;
}

export function ServiceSkillHomePanel({
  skills,
  loading = false,
  onSelect,
}: ServiceSkillHomePanelProps) {
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
      items={items}
      embedded
      loading={loading}
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
