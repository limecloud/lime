import type { A2UIFormData, A2UIResponse } from "@/lib/workspace/a2ui";
import {
  createDefaultServiceSkillSlotValues,
  resolveServiceSkillSlotValue,
} from "./promptComposer";
import {
  buildServiceSkillSlotFieldA2UI,
  buildServiceSkillSlotFormData,
  readServiceSkillSlotValueFromA2UIFormData,
  toServiceSkillSlotA2UIField,
} from "./slotFormA2UI";
import type { ServiceSkillItem, ServiceSkillSlotValues } from "./types";

interface BuildServiceSkillLaunchA2UIResponseOptions {
  initialSlotValues?: ServiceSkillSlotValues;
  prefillHint?: string;
  includeHeading?: boolean;
  includeRequiredLabelSuffix?: boolean;
  submitLabel?: string | null;
  responseKey?: string;
}

function normalizeOptionalText(value?: string | null): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

export function getServiceSkillSlotFieldId(slotKey: string): string {
  return `service-skill-slot-${slotKey}`;
}

export function buildInitialServiceSkillLaunchFormData(
  skill: ServiceSkillItem,
  initialSlotValues?: ServiceSkillSlotValues,
): A2UIFormData {
  const mergedValues = {
    ...createDefaultServiceSkillSlotValues(skill),
    ...(initialSlotValues || {}),
  };

  return buildServiceSkillSlotFormData(
    skill.slotSchema.map(toServiceSkillSlotA2UIField),
    mergedValues,
    {
      fieldIdForKey: getServiceSkillSlotFieldId,
    },
  );
}

export function readServiceSkillLaunchSlotValuesFromFormData(
  skill: ServiceSkillItem,
  formData: A2UIFormData,
): ServiceSkillSlotValues {
  const slotValues: ServiceSkillSlotValues = {};

  for (const slot of skill.slotSchema) {
    const normalizedValue = readServiceSkillSlotValueFromA2UIFormData(
      formData,
      getServiceSkillSlotFieldId(slot.key),
    );
    if (!normalizedValue) {
      continue;
    }

    slotValues[slot.key] = normalizedValue;
  }

  return slotValues;
}

export function buildServiceSkillLaunchA2UIResponse(
  skill: ServiceSkillItem,
  options: BuildServiceSkillLaunchA2UIResponseOptions = {},
): A2UIResponse {
  const {
    initialSlotValues,
    prefillHint,
    includeHeading = true,
    includeRequiredLabelSuffix = true,
    submitLabel = "直接开始",
    responseKey,
  } = options;
  const components: A2UIResponse["components"] = [];
  const childIds: string[] = [];
  const mergedValues = {
    ...createDefaultServiceSkillSlotValues(skill),
    ...(initialSlotValues || {}),
  };
  const normalizedPrefillHint = normalizeOptionalText(prefillHint);
  const responseIdSuffix = normalizeOptionalText(responseKey);
  const baseId = responseIdSuffix
    ? `${skill.id}:${responseIdSuffix}`
    : skill.id.trim();

  if (includeHeading) {
    const titleId = `${baseId}:title`;
    components.push({
      id: titleId,
      component: "Text",
      text: `继续「${skill.title}」前，先补几项信息`,
      variant: "h3",
    });
    childIds.push(titleId);

    const descriptionId = `${baseId}:description`;
    components.push({
      id: descriptionId,
      component: "Text",
      text:
        normalizeOptionalText(skill.summary) ||
        "补齐后会继续在当前对话里直接开始，不用重新打开其他面板。",
      variant: "caption",
    });
    childIds.push(descriptionId);

    if (normalizedPrefillHint) {
      const hintId = `${baseId}:prefill-hint`;
      components.push({
        id: hintId,
        component: "Text",
        text: normalizedPrefillHint,
        variant: "caption",
      });
      childIds.push(hintId);
    }
  }

  for (const slot of skill.slotSchema) {
    const fieldId = getServiceSkillSlotFieldId(slot.key);
    components.push(
      buildServiceSkillSlotFieldA2UI(toServiceSkillSlotA2UIField(slot), {
        fieldId,
        initialValue: resolveServiceSkillSlotValue(slot, mergedValues),
        includeRequiredLabelSuffix,
      }),
    );
    childIds.push(fieldId);
  }

  const rootId = `${baseId}:root`;
  components.push({
    id: rootId,
    component: "Column",
    children: childIds,
    gap: 16,
    align: "stretch",
  });

  return {
    id: `service-skill-launch:${baseId}`,
    root: rootId,
    components,
    data: {},
    ...(submitLabel
      ? {
          submitAction: {
            label: submitLabel,
            action: {
              name: "submit",
            },
          },
        }
      : {}),
  };
}
