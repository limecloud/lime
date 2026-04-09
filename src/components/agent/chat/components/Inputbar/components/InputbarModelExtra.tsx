import React from "react";
import type { AsterSessionExecutionRuntime } from "@/lib/api/agentRuntime";
import { hasTauriInvokeCapability } from "@/lib/tauri-runtime";
import { ChatModelSelector } from "../../ChatModelSelector";

interface InputbarModelExtraProps {
  isFullscreen?: boolean;
  providerType?: string;
  setProviderType: (type: string) => void;
  model?: string;
  setModel: (model: string) => void;
  activeTheme?: string;
  onManageProviders?: () => void;
  executionRuntime?: AsterSessionExecutionRuntime | null;
}

export const InputbarModelExtra: React.FC<InputbarModelExtraProps> = ({
  isFullscreen = false,
  providerType,
  setProviderType,
  model,
  setModel,
  activeTheme,
  onManageProviders,
  executionRuntime = null,
}) => {
  if (isFullscreen || !providerType || !model) {
    return null;
  }
  const selectorBackgroundPreload = hasTauriInvokeCapability()
    ? "immediate"
    : "disabled";

  return (
    <div className="flex items-center flex-wrap gap-2">
      <ChatModelSelector
        providerType={providerType}
        setProviderType={setProviderType}
        model={model}
        setModel={setModel}
        activeTheme={activeTheme}
        compactTrigger
        popoverSide="top"
        onManageProviders={onManageProviders}
        backgroundPreload={selectorBackgroundPreload}
      />
    </div>
  );
};
