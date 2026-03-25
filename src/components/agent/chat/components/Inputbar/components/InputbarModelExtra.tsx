import React from "react";
import { Badge } from "@/components/ui/badge";
import type { AsterSessionExecutionRuntime } from "@/lib/api/agentRuntime";
import { ChatModelSelector } from "../../ChatModelSelector";
import {
  getExecutionRuntimeDisplayLabel,
  getOutputSchemaRuntimeLabel,
} from "../../../utils/sessionExecutionRuntime";

interface InputbarModelExtraProps {
  isFullscreen?: boolean;
  isThemeWorkbenchVariant?: boolean;
  providerType?: string;
  setProviderType?: (type: string) => void;
  model?: string;
  setModel?: (model: string) => void;
  activeTheme?: string;
  onManageProviders?: () => void;
  executionRuntime?: AsterSessionExecutionRuntime | null;
  isExecutionRuntimeActive?: boolean;
}

const NOOP_SET_PROVIDER_TYPE = (_type: string) => {};
const NOOP_SET_MODEL = (_model: string) => {};

export const InputbarModelExtra: React.FC<InputbarModelExtraProps> = ({
  isFullscreen = false,
  isThemeWorkbenchVariant = false,
  providerType,
  setProviderType,
  model,
  setModel,
  activeTheme,
  onManageProviders,
  executionRuntime = null,
  isExecutionRuntimeActive = false,
}) => {
  if (isFullscreen || isThemeWorkbenchVariant || !providerType || !model) {
    return null;
  }

  const executionRuntimeLabel = getExecutionRuntimeDisplayLabel(
    executionRuntime,
    { active: isExecutionRuntimeActive },
  );
  const outputSchemaLabel = getOutputSchemaRuntimeLabel(
    executionRuntime?.output_schema_runtime,
  );
  const executionRuntimeBadgeClass = isExecutionRuntimeActive
    ? "max-w-[220px] truncate border-emerald-200 bg-emerald-50 text-emerald-900"
    : "max-w-[220px] truncate text-muted-foreground";

  return (
    <div className="flex items-center gap-2">
      <ChatModelSelector
        providerType={providerType}
        setProviderType={setProviderType || NOOP_SET_PROVIDER_TYPE}
        model={model}
        setModel={setModel || NOOP_SET_MODEL}
        activeTheme={activeTheme}
        compactTrigger
        popoverSide="top"
        onManageProviders={onManageProviders}
      />
      {executionRuntimeLabel ? (
        <Badge
          variant="outline"
          className={executionRuntimeBadgeClass}
          title={executionRuntimeLabel}
        >
          {executionRuntimeLabel}
        </Badge>
      ) : null}
      {outputSchemaLabel ? (
        <Badge
          variant="outline"
          className="max-w-[180px] truncate text-muted-foreground"
          title={`结构化输出 ${outputSchemaLabel}`}
        >
          结构化输出 {outputSchemaLabel}
        </Badge>
      ) : null}
    </div>
  );
};
