import { useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type {
  EnhancedModelMetadata,
  ModelReasoningEffortLevel,
} from "@/lib/types/modelRegistry";
import {
  preferredReasoningEffort,
  reasoningPolicyForPreferences,
} from "@/lib/model/reasoningEffortPreferences";
import { useReasoningEffortPreferences } from "@/lib/model/useReasoningEffortPreferences";
import {
  normalizeModelReasoningEffort,
  resolveModelReasoningEffortForModelSwitch,
} from "@/lib/model/modelReasoningPolicy";
import type { ModelReasoningEffortPreset } from "@/lib/model/modelReasoningPolicy";

export function useModelReasoningEffort({
  model,
  value,
  onChange,
  enabled,
}: {
  model: EnhancedModelMetadata | null | undefined;
  value: ModelReasoningEffortLevel | "";
  onChange?: (value: ModelReasoningEffortLevel | "") => void;
  enabled: boolean;
}) {
  const { t } = useTranslation("common");
  const preferences = useReasoningEffortPreferences(enabled);
  const policy = useMemo(
    () =>
      reasoningPolicyForPreferences(
        model?.reasoning_policy,
        preferences.efforts,
      ),
    [model, preferences.efforts],
  );
  const options = policy?.supported_reasoning_levels ?? [];
  const resolve = useCallback(
    (
      next: EnhancedModelMetadata | null | undefined,
      current: ModelReasoningEffortLevel | "",
    ) => {
      const policy = reasoningPolicyForPreferences(
        next?.reasoning_policy,
        preferences.efforts,
      );
      if (!policy?.can_set_reasoning_effort) return "";
      if (
        (current === "max" || current === "ultra") &&
        !preferences.efforts.some((effort) => effort === current)
      )
        return preferredReasoningEffort(policy, current);
      return resolveModelReasoningEffortForModelSwitch(policy, current) ?? "";
    },
    [preferences.efforts],
  );
  useEffect(() => {
    if (!enabled || !onChange || !value || !model) return;
    // 偏好只筛选可选项；不能经 onChange 隐式改写现有 Thread 的 canonical 设置。
    const source = model?.reasoning_policy;
    const next = source?.can_set_reasoning_effort
      ? (resolveModelReasoningEffortForModelSwitch(source, value) ?? "")
      : "";
    if (next !== value) onChange(next);
  }, [enabled, model, onChange, value]);
  const confirmedEffort = normalizeModelReasoningEffort(value);
  const selectedOption: ModelReasoningEffortPreset | undefined =
    model?.reasoning_policy?.supported_reasoning_levels.find(
      (option) => option.value === value,
    ) ??
    (!model && confirmedEffort
      ? {
          id: confirmedEffort,
          value: confirmedEffort,
          label: confirmedEffort,
          description: "",
        }
      : undefined);
  const label = (option: ModelReasoningEffortPreset) =>
    option.label && option.label !== option.value
      ? option.label
      : t(`common.modelSelector.reasoning.level.${option.value}`, {
          defaultValue: option.id,
        });
  return { options, resolve, selectedOption, label };
}
