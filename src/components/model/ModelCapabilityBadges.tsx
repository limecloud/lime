import React from "react";
import { useTranslation } from "react-i18next";
import { Brain, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  EnhancedModelMetadata,
  ModelCapabilities,
} from "@/lib/types/modelRegistry";
import {
  getModelRuntimeFeatures,
  getModelInputModalities,
  getModelTaskFamilies,
} from "@/lib/model/inferModelCapabilities";

interface CapabilityBadgeProps {
  active: boolean;
  icon: React.ReactNode;
  activeLabel: string;
  inactiveLabel: string;
}

interface ModelCapabilityBadgesProps {
  capabilities: ModelCapabilities;
  model?: Parameters<typeof getModelTaskFamilies>[0] &
    Pick<EnhancedModelMetadata, "reasoning_policy">;
  className?: string;
  compact?: boolean;
  showNegative?: boolean;
}

function CapabilityBadge({
  active,
  icon,
  activeLabel,
  inactiveLabel,
}: CapabilityBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs leading-4",
        active ? "text-[var(--lime-text)]" : "text-[var(--lime-text-muted)]",
      )}
    >
      {icon}
      <span>{active ? activeLabel : inactiveLabel}</span>
    </span>
  );
}

export const ModelCapabilityBadges: React.FC<ModelCapabilityBadgesProps> = ({
  capabilities,
  model,
  className,
  compact = false,
  showNegative = true,
}) => {
  const { t } = useTranslation("common");
  const resolvedTaskFamilies = model ? getModelTaskFamilies(model) : [];
  const resolvedInputModalities = model ? getModelInputModalities(model) : [];
  const resolvedRuntimeFeatures = model ? getModelRuntimeFeatures(model) : [];
  const reasoningActive =
    capabilities.reasoning ||
    Boolean(model?.reasoning_policy?.supports_reasoning_summaries) ||
    resolvedTaskFamilies.includes("reasoning") ||
    resolvedRuntimeFeatures.includes("reasoning");
  const visionActive =
    capabilities.vision ||
    resolvedTaskFamilies.includes("vision_understanding") ||
    resolvedInputModalities.includes("image");
  const capabilityItems = [
    {
      key: "reasoning",
      active: reasoningActive,
      icon: <Brain className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />,
      activeLabel: t("common.modelCapabilities.reasoning.active"),
      inactiveLabel: t("common.modelCapabilities.reasoning.inactive"),
    },
    {
      key: "vision",
      active: Boolean(visionActive),
      icon: <Eye className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />,
      activeLabel: t("common.modelCapabilities.vision.active"),
      inactiveLabel: t("common.modelCapabilities.vision.inactive"),
    },
  ];

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {capabilityItems
        .filter((item) => item.active || showNegative)
        .map((item) => (
          <CapabilityBadge
            key={item.key}
            active={item.active}
            icon={item.icon}
            activeLabel={item.activeLabel}
            inactiveLabel={item.inactiveLabel}
          />
        ))}
    </div>
  );
};
