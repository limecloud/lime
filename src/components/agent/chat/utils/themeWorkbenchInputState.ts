import { useMemo } from "react";
import type { StepStatus } from "@/lib/workspace/workbenchContract";

export interface ThemeWorkbenchGateState {
  key: string;
  title: string;
  status: "running" | "waiting" | "idle";
  description: string;
}

export interface ThemeWorkbenchWorkflowStep {
  id: string;
  title: string;
  status: StepStatus;
}

export interface ThemeWorkbenchQuickAction {
  id: string;
  label: string;
  prompt: string;
}

interface UseThemeWorkbenchInputStateParams {
  isThemeWorkbenchVariant: boolean;
  themeWorkbenchGate?: ThemeWorkbenchGateState | null;
  workflowSteps?: ThemeWorkbenchWorkflowStep[];
  themeWorkbenchRunState?: "idle" | "auto_running" | "await_user_decision";
  isSending: boolean;
}

function resolveThemeWorkbenchQuickActions(
  gateKey?: string,
): ThemeWorkbenchQuickAction[] {
  switch (gateKey) {
    case "topic_select":
      return [
        {
          id: "topic-options",
          label: "生成 3 个选题",
          prompt: "请给我 3 个可执行选题方向，并说明目标读者与传播价值。",
        },
        {
          id: "topic-choose-b",
          label: "采纳 B 方向",
          prompt: "我采纳 B 方向，请继续推进主稿与配图编排。",
        },
      ];
    case "write_mode":
      return [
        {
          id: "write-fast",
          label: "快速模式出稿",
          prompt: "请按快速模式生成可发布主稿，并标注可优化段落。",
        },
        {
          id: "write-coach",
          label: "教练模式引导",
          prompt: "请按教练模式逐步提问我，帮助补充真实案例后再成稿。",
        },
      ];
    case "publish_confirm":
      return [
        {
          id: "publish-checklist",
          label: "发布前检查",
          prompt: "请给我发布前检查清单，包含标题、封面、平台合规与风险项。",
        },
        {
          id: "publish-now",
          label: "进入发布整理",
          prompt: "请整理最终发布稿，并输出配套标题、摘要和封面文案。",
        },
      ];
    default:
      return [
        {
          id: "next-step",
          label: "继续编排",
          prompt: "请继续按照当前编排推进，并在关键闸门前向我确认。",
        },
      ];
  }
}

export function useThemeWorkbenchInputState({
  isThemeWorkbenchVariant,
  themeWorkbenchGate,
  workflowSteps = [],
  themeWorkbenchRunState,
  isSending,
}: UseThemeWorkbenchInputStateParams) {
  const themeWorkbenchQuickActions = useMemo(
    () =>
      isThemeWorkbenchVariant
        ? resolveThemeWorkbenchQuickActions(themeWorkbenchGate?.key)
        : [],
    [isThemeWorkbenchVariant, themeWorkbenchGate?.key],
  );

  const themeWorkbenchQueueItems = useMemo(() => {
    if (!isThemeWorkbenchVariant) {
      return [];
    }

    const visibleSteps = workflowSteps
      .filter(
        (step) => step.status !== "completed" && step.status !== "skipped",
      )
      .slice(0, 3);

    if (visibleSteps.length > 0) {
      return visibleSteps;
    }

    if (themeWorkbenchGate) {
      return [
        {
          id: `gate-${themeWorkbenchGate.key}`,
          title: themeWorkbenchGate.title,
          status:
            themeWorkbenchGate.status === "waiting"
              ? ("pending" as StepStatus)
              : ("active" as StepStatus),
        },
      ];
    }

    return [];
  }, [isThemeWorkbenchVariant, themeWorkbenchGate, workflowSteps]);

  const renderThemeWorkbenchGeneratingPanel = isThemeWorkbenchVariant
    ? themeWorkbenchRunState
      ? themeWorkbenchRunState === "auto_running"
      : isSending
    : false;

  return {
    themeWorkbenchQuickActions,
    themeWorkbenchQueueItems,
    renderThemeWorkbenchGeneratingPanel,
  };
}
