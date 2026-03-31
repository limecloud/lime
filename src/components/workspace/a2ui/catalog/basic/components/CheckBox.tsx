import type { CheckBoxComponent, A2UIFormData } from "../../../types";
import { resolveDynamicValue } from "../../../parser";
import { A2UI_FORM_TOKENS } from "../../../taskFormTokens";

interface CheckBoxRendererProps {
  component: CheckBoxComponent;
  data: Record<string, unknown>;
  formData: A2UIFormData;
  onFormChange: (id: string, value: unknown) => void;
  scopePath?: string;
}

export function CheckBoxRenderer({
  component,
  data,
  formData,
  onFormChange,
  scopePath = "/",
}: CheckBoxRendererProps) {
  const label = String(
    resolveDynamicValue(component.label, data, "", scopePath),
  );
  const checked =
    (formData[component.id] as boolean) ??
    Boolean(resolveDynamicValue(component.value, data, false, scopePath));

  return (
    <label className={A2UI_FORM_TOKENS.checkboxRow}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onFormChange(component.id, event.target.checked)}
        className={A2UI_FORM_TOKENS.checkboxInput}
      />
      <span className={A2UI_FORM_TOKENS.checkboxText}>{label}</span>
    </label>
  );
}

export const CheckBox = CheckBoxRenderer;
