import type { SkillCatalogSceneEntry } from "@/lib/api/skillCatalog";
import type { Project } from "@/lib/api/project";
import type { A2UIFormData, A2UIResponse } from "@/lib/workspace/a2ui";
import type {
  ServiceSkillItem,
  ServiceSkillSlotDefinition,
  ServiceSkillSlotOption,
  ServiceSkillSlotType,
  ServiceSkillSlotValues,
} from "../service-skills/types";
import {
  buildServiceSkillSlotFieldA2UI,
  readServiceSkillSlotValueFromA2UIFormData,
} from "../service-skills/slotFormA2UI";

export type RuntimeSceneGateKind = "require_inputs";

export interface RuntimeSceneGateSlotField {
  kind: "slot";
  key: string;
  label: string;
  slotType: ServiceSkillSlotType;
  required: boolean;
  placeholder?: string;
  helpText?: string;
  options?: ServiceSkillSlotOption[];
  defaultValue?: string;
}

export interface RuntimeSceneGateProjectField {
  kind: "project";
  key: "project_id";
  label: string;
  required: true;
  description?: string;
}

export type RuntimeSceneGateField =
  | RuntimeSceneGateSlotField
  | RuntimeSceneGateProjectField;

export interface RuntimeSceneGateRequest {
  kind: RuntimeSceneGateKind;
  gateKey: string;
  rawText: string;
  sceneKey: string;
  commandPrefix: string;
  sceneTitle: string;
  sceneSummary?: string;
  skillId: string;
  fields: RuntimeSceneGateField[];
}

export interface RuntimeSceneGateSubmission {
  slotValues: Record<string, string>;
  projectId?: string;
  missingFieldLabels: string[];
}

export interface RuntimeSceneGatePrefill {
  slotValues?: ServiceSkillSlotValues;
  projectId?: string;
  hint?: string;
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function buildGateKey(
  sceneKey: string,
  fields: RuntimeSceneGateField[],
): string {
  const fieldKey = fields
    .map((field) => `${field.kind}:${field.key}`)
    .sort()
    .join("|");
  return `${sceneKey}:${fieldKey}`;
}

function buildRuntimeSceneGateFields(params: {
  missingSlots?: ServiceSkillSlotDefinition[];
  requireProject?: boolean;
}): RuntimeSceneGateField[] {
  const fields: RuntimeSceneGateField[] = [];

  for (const slot of params.missingSlots || []) {
    fields.push({
      kind: "slot",
      key: slot.key,
      label: slot.label,
      slotType: slot.type,
      required: slot.required,
      placeholder: slot.placeholder,
      helpText: slot.helpText,
      options: slot.options,
      defaultValue: slot.defaultValue,
    });
  }

  if (params.requireProject) {
    fields.push({
      kind: "project",
      key: "project_id",
      label: "项目工作区",
      required: true,
      description: "选择这次结果要落到哪个项目里。",
    });
  }

  return fields;
}

export function buildRuntimeSceneGateRequest(params: {
  rawText: string;
  sceneEntry: SkillCatalogSceneEntry;
  skill: ServiceSkillItem;
  missingSlots?: ServiceSkillSlotDefinition[];
  requireProject?: boolean;
}): RuntimeSceneGateRequest | null {
  const fields = buildRuntimeSceneGateFields({
    missingSlots: params.missingSlots,
    requireProject: params.requireProject,
  });
  if (fields.length === 0) {
    return null;
  }

  return {
    kind: "require_inputs",
    gateKey: buildGateKey(params.sceneEntry.sceneKey, fields),
    rawText: params.rawText,
    sceneKey: params.sceneEntry.sceneKey,
    commandPrefix: params.sceneEntry.commandPrefix,
    sceneTitle: params.sceneEntry.title || params.skill.title,
    sceneSummary: params.sceneEntry.summary || params.skill.summary,
    skillId: params.skill.id,
    fields,
  };
}

function buildProjectChoiceOptions(projects: Project[]): Array<{
  value: string;
  label: string;
  description?: string;
}> {
  return projects.map((project) => {
    const descriptionParts = [
      project.workspaceType === "general" ? "通用工作区" : project.workspaceType,
      project.isDefault ? "默认项目" : undefined,
      normalizeOptionalText(project.rootPath),
    ].filter((part): part is string => Boolean(part));

    return {
      value: project.id,
      label: project.name,
      description: descriptionParts.join(" · ") || undefined,
    };
  });
}

function buildFieldHelperText(field: RuntimeSceneGateField): string | undefined {
  if (field.kind === "project") {
    return field.description;
  }

  const parts = [normalizeOptionalText(field.helpText), normalizeOptionalText(field.placeholder)].filter(
    (part): part is string => Boolean(part),
  );
  return parts.join(" · ") || undefined;
}

function resolveChoiceInitialValue(
  options: RuntimeSceneGateSlotField["options"] | Array<{ value: string }>,
  value: string | undefined,
): string[] {
  const availableOptions = options || [];
  const normalizedValue = normalizeOptionalText(value);
  if (!normalizedValue) {
    return [];
  }

  if (!availableOptions.some((option) => option.value === normalizedValue)) {
    return [];
  }

  return [normalizedValue];
}

function buildSlotFieldComponent(
  field: RuntimeSceneGateSlotField,
  prefill: RuntimeSceneGatePrefill | undefined,
  components: A2UIResponse["components"],
  childIds: string[],
): void {
  const fieldId = field.key;
  const prefillValue = normalizeOptionalText(prefill?.slotValues?.[field.key]);
  components.push(
    buildServiceSkillSlotFieldA2UI(
      {
        key: field.key,
        label: field.label,
        type: field.slotType,
        required: field.required,
        placeholder: field.placeholder,
        helpText: buildFieldHelperText(field),
        options: field.options,
        defaultValue: field.defaultValue,
      },
      {
        fieldId,
        initialValue:
          resolveChoiceInitialValue(field.options || [], prefillValue)[0] ||
          prefillValue,
      },
    ),
  );
  childIds.push(fieldId);
}

function buildProjectFieldComponent(
  field: RuntimeSceneGateProjectField,
  projects: Project[],
  prefill: RuntimeSceneGatePrefill | undefined,
  components: A2UIResponse["components"],
  childIds: string[],
): void {
  const helperText = buildFieldHelperText(field);
  const fieldId = field.key;
  const projectOptions = buildProjectChoiceOptions(projects);
  const prefillProjectId = normalizeOptionalText(prefill?.projectId);

  if (projectOptions.length > 0) {
    components.push({
      id: fieldId,
      component: "ChoicePicker",
      label: field.label,
      options: projectOptions,
      value: resolveChoiceInitialValue(projectOptions, prefillProjectId),
      variant: "mutuallyExclusive",
      layout: "wrap",
    });
    childIds.push(fieldId);
    return;
  }

  components.push({
    id: fieldId,
    component: "TextField",
    label: field.label,
    value: prefillProjectId || "",
    placeholder: "输入项目 ID",
    helperText:
      helperText || "当前未读取到项目列表，可手动输入目标项目 ID。",
  });
  childIds.push(fieldId);
}

export function buildRuntimeSceneGateA2UIForm(params: {
  request: RuntimeSceneGateRequest;
  projects?: Project[];
  prefill?: RuntimeSceneGatePrefill;
}): A2UIResponse {
  const { request, projects = [], prefill } = params;
  const components: A2UIResponse["components"] = [];
  const childIds: string[] = [];

  const titleId = `${request.gateKey}:title`;
  components.push({
    id: titleId,
    component: "Text",
    text: `继续「${request.sceneTitle}」前，先补几项信息`,
    variant: "h3",
  });
  childIds.push(titleId);

  const descriptionId = `${request.gateKey}:description`;
  components.push({
    id: descriptionId,
    component: "Text",
    text:
      request.sceneSummary ||
      `补齐后会继续执行 ${request.commandPrefix}，不用重新输入。`,
    variant: "caption",
  });
  childIds.push(descriptionId);

  const prefillHint = normalizeOptionalText(prefill?.hint);
  if (prefillHint) {
    const hintId = `${request.gateKey}:prefill-hint`;
    components.push({
      id: hintId,
      component: "Text",
      text: prefillHint,
      variant: "caption",
    });
    childIds.push(hintId);
  }

  for (const field of request.fields) {
    if (field.kind === "project") {
      buildProjectFieldComponent(field, projects, prefill, components, childIds);
      continue;
    }

    buildSlotFieldComponent(field, prefill, components, childIds);
  }

  const rootId = `${request.gateKey}:root`;
  components.push({
    id: rootId,
    component: "Column",
    children: childIds,
    gap: 16,
    align: "stretch",
  });

  return {
    id: `scene-gate:${request.gateKey}`,
    root: rootId,
    components,
    data: {},
    submitAction: {
      label: "继续",
      action: {
        name: "submit",
      },
    },
  };
}

export function readRuntimeSceneGateSubmission(params: {
  request: RuntimeSceneGateRequest;
  formData: A2UIFormData;
  prefill?: RuntimeSceneGatePrefill;
}): RuntimeSceneGateSubmission {
  const slotValues: Record<string, string> = {};
  let projectId: string | undefined;
  const missingFieldLabels: string[] = [];

  for (const field of params.request.fields) {
    const submittedValue =
      readServiceSkillSlotValueFromA2UIFormData(params.formData, field.key) ||
      (field.kind === "project"
        ? normalizeOptionalText(params.prefill?.projectId)
        : normalizeOptionalText(params.prefill?.slotValues?.[field.key]));
    if (!submittedValue) {
      if (field.required) {
        missingFieldLabels.push(field.label);
      }
      continue;
    }

    if (field.kind === "project") {
      projectId = submittedValue;
      continue;
    }

    slotValues[field.key] = submittedValue;
  }

  return {
    slotValues,
    projectId,
    missingFieldLabels,
  };
}

export function formatRuntimeSceneGateValidationMessage(
  request: RuntimeSceneGateRequest,
): string {
  const slotLabels = request.fields
    .filter(
      (field): field is RuntimeSceneGateSlotField => field.kind === "slot",
    )
    .map((field) => field.label.trim())
    .filter(Boolean);
  const requiresProject = request.fields.some((field) => field.kind === "project");

  if (slotLabels.length > 0 && requiresProject) {
    return `还差${slotLabels.join("、")}和项目工作区，补齐后再继续。`;
  }

  if (slotLabels.length > 0) {
    return `还差${slotLabels.join("、")}，补齐后再继续。`;
  }

  if (requiresProject) {
    return "还需要选择项目工作区，补齐后再继续。";
  }

  return "请先补齐当前场景所需信息后再继续。";
}
