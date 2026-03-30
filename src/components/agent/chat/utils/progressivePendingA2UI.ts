import type {
  A2UIComponent,
  A2UIFormData,
  A2UIResponse,
  ChildList,
  TextComponent,
} from "@/lib/workspace/a2ui";

type PromptFieldComponent = Extract<
  A2UIComponent,
  {
    component:
      | "TextField"
      | "ChoicePicker"
      | "CheckBox"
      | "Slider"
      | "DateTimeInput";
  }
>;

interface FieldDescriptor {
  component: PromptFieldComponent;
  isCompact: boolean;
  sectionTitle?: string;
}

interface ProgressiveA2UIStepDefinition {
  fields: FieldDescriptor[];
}

export interface ProgressiveA2UIProgressMeta {
  currentStep: number;
  totalSteps: number;
  questionsInStep: number;
  totalQuestions: number;
  isFinalStep: boolean;
  fieldIds: string[];
}

export interface ProgressiveA2UIStepView {
  form: A2UIResponse;
  meta: ProgressiveA2UIProgressMeta;
}

const STEP_BUDGET = 2;

function isStaticChildList(children: ChildList): children is string[] {
  return Array.isArray(children);
}

function isFieldComponent(component: A2UIComponent): component is PromptFieldComponent {
  return (
    component.component === "TextField" ||
    component.component === "ChoicePicker" ||
    component.component === "CheckBox" ||
    component.component === "Slider" ||
    component.component === "DateTimeInput"
  );
}

function isCompactField(component: PromptFieldComponent): boolean {
  switch (component.component) {
    case "TextField":
      return component.variant !== "longText";
    case "ChoicePicker":
      return (
        component.layout === "wrap" || component.layout === "horizontal"
      );
    case "CheckBox":
    case "Slider":
    case "DateTimeInput":
      return true;
    default:
      return false;
  }
}

function getFieldCost(component: PromptFieldComponent): number {
  return isCompactField(component) ? 1 : 2;
}

function getComponentChildren(component: A2UIComponent): string[] {
  switch (component.component) {
    case "Row":
    case "Column":
    case "List":
      return isStaticChildList(component.children) ? component.children : [];
    case "Card":
      return [component.child];
    case "Tabs":
      return component.tabs.map((tab) => tab.child);
    case "Modal":
      return [component.trigger, component.content];
    default:
      return [];
  }
}

function getTextValue(component: TextComponent): string {
  return typeof component.text === "string" ? component.text.trim() : "";
}

function extractPromptStructure(response: A2UIResponse): {
  title?: string;
  introBlocks: string[];
  fields: FieldDescriptor[];
} {
  const componentMap = new Map(
    response.components.map((component) => [component.id, component]),
  );
  const visited = new Set<string>();
  const introBlocks: string[] = [];
  const fields: FieldDescriptor[] = [];
  let title: string | undefined;
  let currentSectionTitle: string | undefined;
  let seenFirstField = false;

  const walk = (componentId: string) => {
    if (visited.has(componentId)) {
      return;
    }
    visited.add(componentId);

    const component = componentMap.get(componentId);
    if (!component) {
      return;
    }

    if (component.component === "Text") {
      const text = getTextValue(component);
      if (!text) {
        return;
      }

      if (component.variant === "h4") {
        currentSectionTitle = text;
        return;
      }

      if (!seenFirstField) {
        if (!title && ["h1", "h2", "h3"].includes(component.variant || "")) {
          title = text;
          return;
        }
        introBlocks.push(text);
      }
      return;
    }

    if (isFieldComponent(component)) {
      seenFirstField = true;
      fields.push({
        component,
        isCompact: isCompactField(component),
        sectionTitle: currentSectionTitle,
      });
      return;
    }

    getComponentChildren(component).forEach(walk);
  };

  walk(response.root);

  return {
    title,
    introBlocks,
    fields,
  };
}

function buildStepDefinitions(fields: FieldDescriptor[]): ProgressiveA2UIStepDefinition[] {
  const steps: ProgressiveA2UIStepDefinition[] = [];
  let currentFields: FieldDescriptor[] = [];
  let currentBudget = 0;
  let currentSectionTitle: string | undefined;

  const flush = () => {
    if (currentFields.length === 0) {
      return;
    }
    steps.push({ fields: currentFields });
    currentFields = [];
    currentBudget = 0;
    currentSectionTitle = undefined;
  };

  for (const field of fields) {
    const fieldCost = getFieldCost(field.component);
    const nextSectionTitle = field.sectionTitle || undefined;
    const shouldBreakForSection =
      currentFields.length > 0 && currentSectionTitle !== nextSectionTitle;
    const shouldBreakForBudget =
      currentFields.length > 0 && currentBudget + fieldCost > STEP_BUDGET;

    if (shouldBreakForSection || shouldBreakForBudget) {
      flush();
    }

    currentFields.push(field);
    currentBudget += fieldCost;
    currentSectionTitle = nextSectionTitle;
  }

  flush();
  return steps;
}

function cloneFieldComponent(component: PromptFieldComponent): PromptFieldComponent {
  if (component.component === "ChoicePicker") {
    return {
      ...component,
      options: component.options.map((option) => ({ ...option })),
    };
  }

  return { ...component };
}

function createProgressText(meta: ProgressiveA2UIProgressMeta): string {
  const currentStepCopy =
    meta.questionsInStep > 1
      ? `先回答这 ${meta.questionsInStep} 项`
      : "先回答这 1 项";
  const suffix = meta.isFinalStep ? "完成后我就继续处理。" : "我再继续下一步。";
  return `第 ${meta.currentStep} / ${meta.totalSteps} 步 · ${currentStepCopy}，${suffix}`;
}

export function readProgressiveA2UIProgressMeta(
  response: A2UIResponse | null | undefined,
): ProgressiveA2UIProgressMeta | null {
  const rawMeta = response?.data?.progressiveA2UI;
  if (!rawMeta || typeof rawMeta !== "object") {
    return null;
  }

  const currentStep =
    typeof (rawMeta as { currentStep?: unknown }).currentStep === "number"
      ? (rawMeta as { currentStep: number }).currentStep
      : null;
  const totalSteps =
    typeof (rawMeta as { totalSteps?: unknown }).totalSteps === "number"
      ? (rawMeta as { totalSteps: number }).totalSteps
      : null;
  const questionsInStep =
    typeof (rawMeta as { questionsInStep?: unknown }).questionsInStep ===
    "number"
      ? (rawMeta as { questionsInStep: number }).questionsInStep
      : null;
  const totalQuestions =
    typeof (rawMeta as { totalQuestions?: unknown }).totalQuestions === "number"
      ? (rawMeta as { totalQuestions: number }).totalQuestions
      : null;
  const isFinalStep =
    typeof (rawMeta as { isFinalStep?: unknown }).isFinalStep === "boolean"
      ? (rawMeta as { isFinalStep: boolean }).isFinalStep
      : null;
  const fieldIds = Array.isArray((rawMeta as { fieldIds?: unknown }).fieldIds)
    ? (rawMeta as { fieldIds: unknown[] }).fieldIds.filter(
        (fieldId): fieldId is string => typeof fieldId === "string",
      )
    : [];

  if (
    currentStep === null ||
    totalSteps === null ||
    questionsInStep === null ||
    totalQuestions === null ||
    isFinalStep === null
  ) {
    return null;
  }

  return {
    currentStep,
    totalSteps,
    questionsInStep,
    totalQuestions,
    isFinalStep,
    fieldIds,
  };
}

export function buildProgressiveA2UIStepForm(
  response: A2UIResponse,
  stepIndex = 0,
): ProgressiveA2UIStepView | null {
  const structure = extractPromptStructure(response);
  if (structure.fields.length === 0) {
    return null;
  }

  const steps = buildStepDefinitions(structure.fields);
  if (steps.length <= 1) {
    return null;
  }

  const clampedStepIndex = Math.min(Math.max(stepIndex, 0), steps.length - 1);
  const step = steps[clampedStepIndex];
  const meta: ProgressiveA2UIProgressMeta = {
    currentStep: clampedStepIndex + 1,
    totalSteps: steps.length,
    questionsInStep: step.fields.length,
    totalQuestions: structure.fields.length,
    isFinalStep: clampedStepIndex === steps.length - 1,
    fieldIds: step.fields.map((field) => field.component.id),
  };

  const components: A2UIComponent[] = [];
  const childIds: string[] = [];
  const baseId = `${response.id}_progressive_${clampedStepIndex + 1}`;

  if (structure.title) {
    const titleId = `${baseId}_title`;
    components.push({
      id: titleId,
      component: "Text",
      text: structure.title,
      variant: "h3",
    });
    childIds.push(titleId);
  }

  const progressId = `${baseId}_progress`;
  components.push({
    id: progressId,
    component: "Text",
    text: createProgressText(meta),
    variant: "caption",
  });
  childIds.push(progressId);

  if (clampedStepIndex === 0) {
    structure.introBlocks.forEach((block, index) => {
      const introId = `${baseId}_intro_${index + 1}`;
      components.push({
        id: introId,
        component: "Text",
        text: block,
        variant: "body",
      });
      childIds.push(introId);
    });
  }

  const currentSectionTitle = step.fields[0]?.sectionTitle?.trim();
  if (currentSectionTitle) {
    const sectionId = `${baseId}_section`;
    components.push({
      id: sectionId,
      component: "Text",
      text: currentSectionTitle,
      variant: "h4",
    });
    childIds.push(sectionId);
  }

  const clonedFields = step.fields.map((field) => cloneFieldComponent(field.component));
  components.push(...clonedFields);

  if (
    clonedFields.length === 2 &&
    step.fields.every((field) => field.isCompact) &&
    step.fields.every((field) => field.sectionTitle === step.fields[0]?.sectionTitle)
  ) {
    const rowId = `${baseId}_row`;
    components.push({
      id: rowId,
      component: "Row",
      children: clonedFields.map((field) => field.id),
      gap: 12,
      align: "stretch",
      wrap: true,
      minChildWidth: 220,
    });
    childIds.push(rowId);
  } else {
    childIds.push(...clonedFields.map((field) => field.id));
  }

  const rootId = `${baseId}_root`;
  components.push({
    id: rootId,
    component: "Column",
    children: childIds,
    gap: 10,
    align: "stretch",
  });

  return {
    form: {
      id: `${response.id}::progressive::${clampedStepIndex + 1}`,
      root: rootId,
      components,
      data: {
        ...(response.data || {}),
        progressiveA2UI: meta,
      },
      submitAction: response.submitAction
        ? {
            ...response.submitAction,
            label: meta.isFinalStep
              ? response.submitAction.label
              : "继续下一步",
          }
        : undefined,
    },
    meta,
  };
}

export function hasMeaningfulProgressiveA2UIAnswers(
  fieldIds: string[],
  formData: A2UIFormData,
): boolean {
  return fieldIds.some((fieldId) => {
    const value = formData[fieldId];
    if (typeof value === "string") {
      return value.trim().length > 0;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      return true;
    }

    if (Array.isArray(value)) {
      return value.some(
        (item) => typeof item === "string" && item.trim().length > 0,
      );
    }

    return value !== null && value !== undefined;
  });
}
