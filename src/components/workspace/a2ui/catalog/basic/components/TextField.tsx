import { useCallback, useEffect, useRef, useState } from "react";
import type { TextFieldComponent, A2UIFormData } from "../../../types";
import { resolveDynamicValue } from "../../../parser";
import { A2UI_FORM_TOKENS } from "../../../taskFormTokens";

interface TextFieldRendererProps {
  component: TextFieldComponent;
  data: Record<string, unknown>;
  formData: A2UIFormData;
  onFormChange: (id: string, value: unknown) => void;
  scopePath?: string;
}

export function TextFieldRenderer({
  component,
  data,
  formData,
  onFormChange,
  scopePath = "/",
}: TextFieldRendererProps) {
  const label = String(
    resolveDynamicValue(component.label, data, "", scopePath),
  );
  const value =
    (formData[component.id] as string) ??
    String(resolveDynamicValue(component.value, data, "", scopePath));
  const isLongText = component.variant === "longText";
  const latestLocalValueRef = useRef(value);
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    latestLocalValueRef.current = value;
    setLocalValue(value);
  }, [value]);

  const commitValue = useCallback(
    (nextValue: string) => {
      onFormChange(component.id, nextValue);
    },
    [component.id, onFormChange],
  );

  const handleInputChange = useCallback(
    (nextValue: string) => {
      latestLocalValueRef.current = nextValue;
      setLocalValue(nextValue);
      commitValue(nextValue);
    },
    [commitValue],
  );

  const handleBlur = useCallback(() => {
    commitValue(latestLocalValueRef.current);
  }, [commitValue]);

  return (
    <div className={A2UI_FORM_TOKENS.fieldStack}>
      {label && <label className={A2UI_FORM_TOKENS.fieldLabel}>{label}</label>}
      {isLongText ? (
        <textarea
          value={localValue}
          onChange={(event) => handleInputChange(event.target.value)}
          onBlur={handleBlur}
          placeholder={component.placeholder}
          className={A2UI_FORM_TOKENS.textarea}
        />
      ) : (
        <input
          type={
            component.variant === "number"
              ? "number"
              : component.variant === "obscured"
                ? "password"
                : "text"
          }
          value={localValue}
          onChange={(event) => handleInputChange(event.target.value)}
          onBlur={handleBlur}
          placeholder={component.placeholder}
          className={A2UI_FORM_TOKENS.textInput}
        />
      )}
      {component.helperText && (
        <p className={A2UI_FORM_TOKENS.helperText}>{component.helperText}</p>
      )}
    </div>
  );
}

export const TextField = TextFieldRenderer;
