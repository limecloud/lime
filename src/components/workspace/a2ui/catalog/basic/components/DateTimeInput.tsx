import type { A2UIFormData, DateTimeInputComponent } from "../../../types";
import { resolveDynamicValue } from "../../../parser";
import { A2UI_FORM_TOKENS } from "../../../taskFormTokens";

interface DateTimeInputRendererProps {
  component: DateTimeInputComponent;
  data: Record<string, unknown>;
  formData: A2UIFormData;
  onFormChange: (id: string, value: unknown) => void;
  scopePath?: string;
}

function getInputType(component: DateTimeInputComponent): string {
  if (component.enableDate && component.enableTime) {
    return "datetime-local";
  }

  if (component.enableDate) {
    return "date";
  }

  if (component.enableTime) {
    return "time";
  }

  return "text";
}

function normalizeDateTimeValue(value: string, inputType: string): string {
  if (!value) {
    return "";
  }

  if (inputType === "date") {
    return value.slice(0, 10);
  }

  if (inputType === "time") {
    const timeMatch = value.match(/(\d{2}:\d{2})/);
    return timeMatch ? timeMatch[1] : value;
  }

  if (inputType === "datetime-local") {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
      return value;
    }

    const normalized = value.replace("Z", "");
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(normalized)) {
      return normalized.slice(0, 16);
    }
  }

  return value;
}

export function DateTimeInputRenderer({
  component,
  data,
  formData,
  onFormChange,
  scopePath = "/",
}: DateTimeInputRendererProps) {
  const label = component.label
    ? String(resolveDynamicValue(component.label, data, "", scopePath))
    : "";
  const inputType = getInputType(component);
  const currentValue =
    (formData[component.id] as string | undefined) ??
    String(resolveDynamicValue(component.value, data, "", scopePath) ?? "");

  return (
    <div className={A2UI_FORM_TOKENS.fieldStack}>
      {label && <label className={A2UI_FORM_TOKENS.fieldLabel}>{label}</label>}
      <input
        type={inputType}
        value={normalizeDateTimeValue(currentValue, inputType)}
        min={
          component.min
            ? String(resolveDynamicValue(component.min, data, "", scopePath))
            : undefined
        }
        max={
          component.max
            ? String(resolveDynamicValue(component.max, data, "", scopePath))
            : undefined
        }
        onChange={(event) => onFormChange(component.id, event.target.value)}
        className={A2UI_FORM_TOKENS.textInput}
      />
    </div>
  );
}

export const DateTimeInput = DateTimeInputRenderer;
