import React from "react";
import { ListChecks } from "lucide-react";
import {
  MetaToggleButton,
  MetaToggleCheck,
  MetaToggleGlyph,
  MetaToggleLabel,
} from "../styles";

interface InputbarExecutionStrategySelectProps {
  isFullscreen?: boolean;
  executionStrategy?: "react" | "code_orchestrated" | "auto";
  setExecutionStrategy?: (
    strategy: "react" | "code_orchestrated" | "auto",
  ) => void;
}

export const InputbarExecutionStrategySelect: React.FC<
  InputbarExecutionStrategySelectProps
> = (props) => {
  const {
    isFullscreen = false,
    executionStrategy,
    setExecutionStrategy,
  } = props;

  if (isFullscreen || !setExecutionStrategy) {
    return null;
  }

  const planEnabled = executionStrategy === "code_orchestrated";

  return (
    <MetaToggleButton
      type="button"
      $checked={planEnabled}
      aria-label={planEnabled ? "关闭 Plan 模式" : "开启 Plan 模式"}
      aria-pressed={planEnabled}
      data-testid="inputbar-plan-toggle"
      title={planEnabled ? "关闭 Plan 模式" : "开启 Plan 模式"}
      onClick={() =>
        setExecutionStrategy(planEnabled ? "react" : "code_orchestrated")
      }
    >
      <MetaToggleCheck $checked={planEnabled} aria-hidden />
      <MetaToggleGlyph aria-hidden>
        <ListChecks strokeWidth={1.8} />
      </MetaToggleGlyph>
      <MetaToggleLabel>Plan</MetaToggleLabel>
    </MetaToggleButton>
  );
};
