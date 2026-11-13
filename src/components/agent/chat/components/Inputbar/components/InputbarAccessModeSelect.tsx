import React from "react";
import { ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MetaSelect, MetaSelectIcon, MetaSelectWrap } from "../styles";
import {
  DEFAULT_AGENT_ACCESS_MODE,
  type AgentAccessMode,
} from "../../../hooks/agentChatStorage";
import { useComposerPermissionVisibility } from "@/lib/composerPermissionVisibility";

interface InputbarAccessModeSelectProps {
  isFullscreen?: boolean;
  disabled?: boolean;
  accessMode?: AgentAccessMode;
  setAccessMode?: (mode: AgentAccessMode) => void;
}

const ACCESS_MODE_OPTIONS: Array<{
  value: AgentAccessMode;
  label: string;
}> = [
  {
    value: "read-only",
    label: "generalWorkbench.taskRail.context.access.readOnly",
  },
  {
    value: "current",
    label: "generalWorkbench.taskRail.context.access.current",
  },
  {
    value: "full-access",
    label: "generalWorkbench.taskRail.context.access.fullAccess",
  },
];

export const InputbarAccessModeSelect: React.FC<
  InputbarAccessModeSelectProps
> = ({
  isFullscreen = false,
  disabled = false,
  accessMode = DEFAULT_AGENT_ACCESS_MODE,
  setAccessMode,
}) => {
  const { t } = useTranslation("agent");
  const visibility = useComposerPermissionVisibility();
  if (isFullscreen || !setAccessMode) {
    return null;
  }
  const visibleOptions = ACCESS_MODE_OPTIONS.filter((option) => {
    if (option.value === "read-only") return true;
    if (option.value === "current") {
      return visibility.defaultPermission || accessMode === "current";
    }
    return visibility.fullAccess || accessMode === "full-access";
  });
  const selectedOption =
    visibleOptions.find((option) => option.value === accessMode) ??
    ACCESS_MODE_OPTIONS.find((option) => option.value === accessMode)!;
  const accessModeLabel = t(selectedOption.label);

  return (
    <MetaSelectWrap data-access-mode={accessMode} title={accessModeLabel}>
      <MetaSelectIcon aria-hidden>
        <ShieldCheck strokeWidth={1.8} />
      </MetaSelectIcon>
      <span data-access-mode-label aria-hidden="true">
        {accessModeLabel}
      </span>
      <MetaSelect
        disabled={disabled}
        aria-label={t("agentChat.inputbar.accessMode.label")}
        data-testid="inputbar-access-mode-select"
        value={accessMode}
        onChange={(event) =>
          setAccessMode(event.target.value as AgentAccessMode)
        }
      >
        {visibleOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {t(option.label)}
          </option>
        ))}
      </MetaSelect>
    </MetaSelectWrap>
  );
};
