import { cn } from "@/lib/utils";
import type { ChoicePickerComponent, A2UIFormData } from "../../../types";
import { resolveDynamicValue } from "../../../parser";
import {
  A2UI_FORM_TOKENS,
  getA2UIChoiceIndicatorClasses,
  getA2UIChoiceOptionClasses,
  getA2UIChoiceTitleClasses,
} from "../../../taskFormTokens";

interface ChoicePickerRendererProps {
  component: ChoicePickerComponent;
  data: Record<string, unknown>;
  formData: A2UIFormData;
  onFormChange: (id: string, value: unknown) => void;
  scopePath?: string;
}

export function ChoicePickerRenderer({
  component,
  data,
  formData,
  onFormChange,
  scopePath = "/",
}: ChoicePickerRendererProps) {
  const label = component.label
    ? String(resolveDynamicValue(component.label, data, "", scopePath))
    : "";
  const selectedValues =
    (formData[component.id] as string[]) ??
    (resolveDynamicValue(component.value, data, [], scopePath) as string[]);
  const isMultiple = component.variant === "multipleSelection";
  const isWrap =
    component.layout === "wrap" || component.layout === "horizontal";
  const isMutuallyExclusive =
    component.variant === "mutuallyExclusive" || !isMultiple;

  const handleSelect = (optionValue: string) => {
    if (isMultiple) {
      const newValues = selectedValues.includes(optionValue)
        ? selectedValues.filter((value) => value !== optionValue)
        : [...selectedValues, optionValue];
      onFormChange(component.id, newValues);
    } else {
      onFormChange(component.id, [optionValue]);
    }
  };

  return (
    <div className={A2UI_FORM_TOKENS.fieldStack}>
      {label && <div className={A2UI_FORM_TOKENS.fieldLabel}>{label}</div>}
      <div
        className={cn(
          A2UI_FORM_TOKENS.optionList,
          isWrap ? "flex-wrap" : "flex-col",
        )}
      >
        {component.options.map((option) => {
          const optionLabel = String(
            resolveDynamicValue(option.label, data, "", scopePath),
          );
          const isSelected = selectedValues.includes(option.value);

          return (
            <button
              key={option.value}
              type="button"
              onClick={() => handleSelect(option.value)}
              className={getA2UIChoiceOptionClasses(isWrap, isSelected)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className={getA2UIChoiceTitleClasses(isSelected)}>
                    {option.icon && <span>{option.icon}</span>}
                    <span>{optionLabel}</span>
                  </div>
                  {option.description && (
                    <div className={A2UI_FORM_TOKENS.optionDescription}>
                      {option.description}
                    </div>
                  )}
                </div>
                <span
                  className={getA2UIChoiceIndicatorClasses(
                    isMutuallyExclusive,
                    isSelected,
                  )}
                  aria-hidden="true"
                />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export const ChoicePicker = ChoicePickerRenderer;
