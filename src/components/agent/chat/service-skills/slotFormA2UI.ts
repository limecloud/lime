import type { A2UIComponent, A2UIFormData } from "@/lib/workspace/a2ui";
import type {
  ServiceSkillSlotDefinition,
  ServiceSkillSlotOption,
  ServiceSkillSlotType,
  ServiceSkillSlotValues,
} from "./types";

export interface ServiceSkillSlotA2UIField {
  key: string;
  label: string;
  type: ServiceSkillSlotType;
  required: boolean;
  placeholder?: string;
  helpText?: string;
  options?: ServiceSkillSlotOption[];
  defaultValue?: string;
}

interface BuildServiceSkillSlotFieldOptions {
  fieldId?: string;
  initialValue?: string;
  includeRequiredLabelSuffix?: boolean;
}

interface BuildServiceSkillSlotFormDataOptions {
  fieldIdForKey?: (key: string) => string;
}

function normalizeOptionalText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeChoiceValue(value: string | undefined): string[] {
  const normalizedValue = normalizeOptionalText(value);
  return normalizedValue ? [normalizedValue] : [];
}

function resolveFieldLabel(
  field: ServiceSkillSlotA2UIField,
  includeRequiredLabelSuffix: boolean,
): string {
  if (!includeRequiredLabelSuffix || !field.required) {
    return field.label;
  }

  return `${field.label}（必填）`;
}

export function buildServiceSkillSlotFieldA2UI(
  field: ServiceSkillSlotA2UIField,
  options: BuildServiceSkillSlotFieldOptions = {},
): A2UIComponent {
  const {
    fieldId = field.key,
    initialValue,
    includeRequiredLabelSuffix = false,
  } = options;
  const resolvedInitialValue =
    normalizeOptionalText(initialValue) ||
    normalizeOptionalText(field.defaultValue);

  if (
    (field.type === "enum" || field.type === "platform") &&
    field.options &&
    field.options.length > 0
  ) {
    return {
      id: fieldId,
      component: "ChoicePicker",
      label: resolveFieldLabel(field, includeRequiredLabelSuffix),
      options: field.options.map((option) => ({
        label: option.label,
        value: option.value,
        description: option.description,
      })),
      value: normalizeChoiceValue(resolvedInitialValue),
      variant: "mutuallyExclusive",
      layout: "wrap",
    };
  }

  return {
    id: fieldId,
    component: "TextField",
    label: resolveFieldLabel(field, includeRequiredLabelSuffix),
    value: resolvedInitialValue,
    variant:
      field.type === "textarea" || field.type === "account_list"
        ? "longText"
        : "shortText",
    placeholder: field.placeholder,
    helperText: field.helpText,
  };
}

export function buildServiceSkillSlotFormData(
  fields: ServiceSkillSlotA2UIField[],
  slotValues: ServiceSkillSlotValues,
  options: BuildServiceSkillSlotFormDataOptions = {},
): A2UIFormData {
  const formData: A2UIFormData = {};

  for (const field of fields) {
    const fieldId = options.fieldIdForKey?.(field.key) ?? field.key;
    const nextValue =
      normalizeOptionalText(slotValues[field.key]) ||
      normalizeOptionalText(field.defaultValue);

    if (field.type === "enum" || field.type === "platform") {
      formData[fieldId] = normalizeChoiceValue(nextValue);
      continue;
    }

    formData[fieldId] = nextValue;
  }

  return formData;
}

export function readServiceSkillSlotValueFromA2UIFormData(
  formData: A2UIFormData,
  fieldId: string,
): string {
  const rawValue = formData[fieldId];
  if (Array.isArray(rawValue)) {
    return normalizeOptionalText(
      rawValue.find((item) => typeof item === "string"),
    );
  }

  return normalizeOptionalText(rawValue);
}

export function toServiceSkillSlotA2UIField(
  field: ServiceSkillSlotDefinition,
): ServiceSkillSlotA2UIField {
  return {
    key: field.key,
    label: field.label,
    type: field.type,
    required: field.required,
    placeholder: field.placeholder,
    helpText: field.helpText,
    options: field.options,
    defaultValue: field.defaultValue,
  };
}
