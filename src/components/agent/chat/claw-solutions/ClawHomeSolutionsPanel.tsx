import { useMemo } from "react";
import { EmptyStateQuickActions } from "../components/EmptyStateQuickActions";
import type { ClawSolutionHomeItem } from "./types";

interface ClawHomeSolutionsPanelProps {
  solutions: ClawSolutionHomeItem[];
  loading?: boolean;
  onSelect: (solution: ClawSolutionHomeItem) => void | Promise<void>;
}

export function ClawHomeSolutionsPanel({
  solutions,
  loading = false,
  onSelect,
}: ClawHomeSolutionsPanelProps) {
  const items = useMemo(
    () =>
      solutions.map((solution) => ({
        key: solution.id,
        title: solution.title,
        description: solution.summary,
        badge: solution.badge,
        prompt: "",
        actionLabel: solution.readiness === "ready" ? "立即开始" : "去配置",
        outputHint: solution.outputHint,
        statusLabel: solution.readinessLabel,
        statusTone: solution.readinessTone,
        statusDescription: solution.readinessMessage,
        solutionId: solution.id,
        testId: `claw-solution-${solution.id}`,
      })),
    [solutions],
  );

  return (
    <EmptyStateQuickActions
      title="推荐方案"
      description="先选一个方案，Claw 会自动进入对应工作模式并带好起始动作。"
      items={items}
      embedded
      loading={loading}
      onAction={(item) => {
        const solution = solutions.find(
          (candidate) => candidate.id === item.solutionId,
        );
        if (solution) {
          void onSelect(solution);
        }
      }}
    />
  );
}

export default ClawHomeSolutionsPanel;
