import type {
  A2UIComponent,
  A2UIFormData,
  A2UIResponse,
} from "@/lib/workspace/a2ui";
import type {
  ActionRequired,
  ActionRequestGovernanceMeta,
  Question,
  QuestionOption,
} from "../types";
import { governActionRequest } from "./actionRequestGovernance";
import { isRuntimeActionConfirmationRequestId } from "./runtimeActionConfirmation";

type SchemaProperty = Record<string, unknown>;
type ActionRequestFieldEntry = {
  fieldKey: string;
  component: A2UIComponent;
};

export interface ActionRequestSubmissionEntry {
  fieldId: string;
  fieldKey: string;
  label: string;
  value: unknown;
  summary: string;
}

export interface ActionRequestSubmissionContext {
  entries: ActionRequestSubmissionEntry[];
  requestMetadata: {
    elicitation_context: {
      source: "action_required";
      mode: "runtime_protocol";
      form_id: string;
      action_type: ActionRequired["actionType"];
      field_count: number;
      prompt?: string;
      entries: ActionRequestSubmissionEntry[];
      governance?: ActionRequestGovernanceMeta;
    };
  };
}

export interface ActionRequestSubmissionPayload {
  userData: unknown;
  responseText: string;
  entries: ActionRequestSubmissionEntry[];
  requestMetadata?: ActionRequestSubmissionContext["requestMetadata"];
}

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_");
}

function humanizeKey(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .replace(/^\w/, (char) => char.toUpperCase());
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeChoiceOptions(
  options: QuestionOption[] | undefined,
): Array<{ label: string; value: string; description?: string }> {
  return (options || [])
    .filter((option) => isNonEmptyString(option.label))
    .map((option) => ({
      label: option.label.trim(),
      value: option.label.trim(),
      description: isNonEmptyString(option.description)
        ? option.description.trim()
        : undefined,
    }));
}

function resolveQuestionFieldKey(
  question: Question,
  index: number,
  total: number,
): string {
  if (total === 1) {
    return "answer";
  }

  const header = question.header?.trim();
  if (header) {
    return sanitizeId(header.toLowerCase());
  }

  return `question_${index + 1}`;
}

function createQuestionField(params: {
  requestId: string;
  question: Question;
  index: number;
  total: number;
}): ActionRequestFieldEntry {
  const { requestId, question, index, total } = params;
  const fieldKey = resolveQuestionFieldKey(question, index, total);
  const fieldId = sanitizeId(`${requestId}_${fieldKey}`);
  const label =
    question.header?.trim() || question.question.trim() || `问题 ${index + 1}`;
  const helperText =
    question.header?.trim() &&
    question.header.trim() !== question.question.trim()
      ? question.question.trim()
      : undefined;
  const options = normalizeChoiceOptions(question.options);
  const choiceVariant: "multipleSelection" | "mutuallyExclusive" =
    question.multiSelect ? "multipleSelection" : "mutuallyExclusive";

  if (options.length > 0) {
    return {
      fieldKey,
      component: {
        id: fieldId,
        component: "ChoicePicker" as const,
        label,
        value: [],
        variant: choiceVariant,
        layout: "vertical" as const,
        options,
      },
    };
  }

  return {
    fieldKey,
    component: {
      id: fieldId,
      component: "TextField" as const,
      label,
      value: "",
      variant: "longText" as const,
      placeholder: "请输入你的回答",
      helperText,
    },
  };
}

function createSchemaField(params: {
  requestId: string;
  propertyKey: string;
  property: SchemaProperty;
}): ActionRequestFieldEntry {
  const { requestId, propertyKey, property } = params;
  const fieldKey = propertyKey;
  const fieldId = sanitizeId(`${requestId}_${propertyKey}`);
  const label =
    (typeof property.title === "string" && property.title.trim()) ||
    humanizeKey(propertyKey);
  const helperText =
    typeof property.description === "string" && property.description.trim()
      ? property.description.trim()
      : undefined;
  const enumValues = Array.isArray(property.enum)
    ? property.enum.filter((item): item is string => typeof item === "string")
    : [];

  if (enumValues.length > 0) {
    return {
      fieldKey,
      component: {
        id: fieldId,
        component: "ChoicePicker" as const,
        label,
        value: [],
        variant: "mutuallyExclusive" as const,
        layout: "vertical" as const,
        options: enumValues.map((value) => ({
          label: value,
          value,
        })),
      },
    };
  }

  const propertyType =
    typeof property.type === "string" ? property.type : "string";
  if (propertyType === "boolean") {
    return {
      fieldKey,
      component: {
        id: fieldId,
        component: "CheckBox" as const,
        label,
        value: false,
      },
    };
  }

  const itemRecord =
    property.items &&
    typeof property.items === "object" &&
    !Array.isArray(property.items)
      ? (property.items as SchemaProperty)
      : null;
  const itemEnumValues = Array.isArray(itemRecord?.enum)
    ? itemRecord.enum.filter((item): item is string => typeof item === "string")
    : [];
  if (propertyType === "array" && itemEnumValues.length > 0) {
    return {
      fieldKey,
      component: {
        id: fieldId,
        component: "ChoicePicker" as const,
        label,
        value: [],
        variant: "multipleSelection" as const,
        layout: "vertical" as const,
        options: itemEnumValues.map((value) => ({
          label: value,
          value,
        })),
      },
    };
  }

  return {
    fieldKey,
    component: {
      id: fieldId,
      component: "TextField" as const,
      label,
      value: "",
      variant:
        propertyType === "number" || propertyType === "integer"
          ? ("number" as const)
          : ("longText" as const),
      placeholder: "请输入内容",
      helperText,
    },
  };
}

function buildAskUserFields(request: ActionRequired) {
  const questions = request.questions || [];
  if (questions.length === 0) {
    const fallbackQuestion: Question = {
      question: request.prompt?.trim() || "请输入你的回答",
    };
    return [
      createQuestionField({
        requestId: request.requestId,
        question: fallbackQuestion,
        index: 0,
        total: 1,
      }),
    ];
  }

  return questions.map((question, index) =>
    createQuestionField({
      requestId: request.requestId,
      question,
      index,
      total: questions.length,
    }),
  );
}

function buildElicitationFields(request: ActionRequired) {
  const schema =
    request.requestedSchema &&
    typeof request.requestedSchema === "object" &&
    !Array.isArray(request.requestedSchema)
      ? (request.requestedSchema as SchemaProperty)
      : null;
  const properties =
    schema?.properties &&
    typeof schema.properties === "object" &&
    !Array.isArray(schema.properties)
      ? (schema.properties as Record<string, SchemaProperty>)
      : null;

  if (!properties || Object.keys(properties).length === 0) {
    return [
      createSchemaField({
        requestId: request.requestId,
        propertyKey: "answer",
        property: {
          type: "string",
          title: request.prompt?.trim() || "请输入你的回答",
        },
      }),
    ];
  }

  return Object.entries(properties).map(([propertyKey, property]) =>
    createSchemaField({
      requestId: request.requestId,
      propertyKey,
      property,
    }),
  );
}

function buildActionRequestFieldEntries(
  request: ActionRequired,
): ActionRequestFieldEntry[] {
  return request.actionType === "ask_user"
    ? buildAskUserFields(request)
    : buildElicitationFields(request);
}

function normalizeSubmissionValue(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value;
  }

  const normalizedArray = value.filter(
    (item): item is string =>
      typeof item === "string" && item.trim().length > 0,
  );

  if (normalizedArray.length <= 1) {
    return normalizedArray[0] || "";
  }

  return normalizedArray;
}

function tryParseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }

  return null;
}

function summarizeValue(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim() || null;
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (typeof value === "boolean") {
    return value ? "是" : "否";
  }

  if (Array.isArray(value)) {
    const normalized = value
      .map((item) => summarizeValue(item))
      .filter((item): item is string => Boolean(item));
    return normalized.length > 0 ? normalized.join("、") : null;
  }

  return null;
}

export function isActionRequestA2UICompatible(
  request: ActionRequired | null | undefined,
): request is ActionRequired {
  if (!request) {
    return false;
  }

  if (isRuntimeActionConfirmationRequestId(request.requestId)) {
    return false;
  }

  return (
    request.actionType === "ask_user" || request.actionType === "elicitation"
  );
}

export function buildActionRequestA2UI(
  request: ActionRequired,
): A2UIResponse | null {
  const governedRequest = governActionRequest(request);
  if (!isActionRequestA2UICompatible(governedRequest)) {
    return null;
  }

  const fieldEntries = buildActionRequestFieldEntries(governedRequest);
  if (fieldEntries.length === 0) {
    return null;
  }

  const requestId = sanitizeId(governedRequest.requestId);
  const rootId = `${requestId}_root`;
  const childIds: string[] = [];
  const components: A2UIResponse["components"] = [];
  const promptText = governedRequest.prompt?.trim();
  const firstFieldLabel =
    "label" in fieldEntries[0].component &&
    typeof fieldEntries[0].component.label === "string"
      ? fieldEntries[0].component.label.trim()
      : "";

  if (promptText && promptText !== firstFieldLabel) {
    const promptId = `${requestId}_prompt`;
    components.push({
      id: promptId,
      component: "Text",
      text: promptText,
      variant: "body",
    });
    childIds.push(promptId);
  }

  fieldEntries.forEach((entry) => {
    components.push(entry.component);
    childIds.push(entry.component.id);
  });

  components.push({
    id: rootId,
    component: "Column",
    children: childIds,
    gap: 16,
    align: "stretch",
  });

  return {
    id: `action-request-${requestId}`,
    root: rootId,
    data: governedRequest.governance
      ? {
          governance: governedRequest.governance,
        }
      : {},
    components,
    submitAction: {
      label: "确认并继续",
      action: {
        name: "submit",
      },
    },
  };
}

export function normalizeActionRequestFormDataForSubmission(
  request: ActionRequired,
  formData: A2UIFormData,
): { userData: unknown; responseText: string } {
  const governedRequest = governActionRequest(request);
  const fieldEntries = buildActionRequestFieldEntries(governedRequest);

  const record = fieldEntries.reduce<Record<string, unknown>>(
    (accumulator, entry) => {
      accumulator[entry.fieldKey] = normalizeSubmissionValue(
        formData[entry.component.id],
      );
      return accumulator;
    },
    {},
  );

  const userData =
    Object.keys(record).length === 1 && "answer" in record
      ? { answer: record.answer }
      : record;

  return {
    userData,
    responseText: JSON.stringify(userData),
  };
}

function normalizeSubmissionRecordFromUserData(
  fieldEntries: ActionRequestFieldEntry[],
  userData: unknown,
): Record<string, unknown> {
  if (userData && typeof userData === "object" && !Array.isArray(userData)) {
    return userData as Record<string, unknown>;
  }

  if (typeof userData === "string") {
    const parsed = tryParseJsonRecord(userData);
    if (parsed) {
      return parsed;
    }
  }

  if (fieldEntries.length === 1 && userData !== undefined) {
    return {
      [fieldEntries[0].fieldKey]: normalizeSubmissionValue(userData),
    };
  }

  return {};
}

function resolveActionRequestSubmissionEntries(
  request: ActionRequired,
  userData: unknown,
): ActionRequestSubmissionEntry[] {
  const fieldEntries = buildActionRequestFieldEntries(request);
  const record = normalizeSubmissionRecordFromUserData(fieldEntries, userData);

  return fieldEntries.reduce<ActionRequestSubmissionEntry[]>(
    (accumulator, entry, index) => {
      const fallbackQuestion =
        request.actionType === "ask_user" && request.questions
          ? request.questions[index]?.question
          : undefined;
      const rawValue =
        record[entry.fieldKey] ??
        (fallbackQuestion ? record[fallbackQuestion] : undefined) ??
        (fieldEntries.length === 1 ? record.answer : undefined);

      if (rawValue === undefined) {
        return accumulator;
      }

      const value = normalizeSubmissionValue(rawValue);
      const summary = summarizeValue(value);
      const label =
        "label" in entry.component && typeof entry.component.label === "string"
          ? entry.component.label
          : humanizeKey(entry.fieldKey);

      if (!summary) {
        return accumulator;
      }

      accumulator.push({
        fieldId: entry.component.id,
        fieldKey: entry.fieldKey,
        label,
        value,
        summary,
      });
      return accumulator;
    },
    [],
  );
}

export function buildActionRequestSubmissionContext(
  request: ActionRequired,
  userData: unknown,
): ActionRequestSubmissionContext | null {
  const governedRequest = governActionRequest(request);
  if (!isActionRequestA2UICompatible(governedRequest)) {
    return null;
  }

  const entries = resolveActionRequestSubmissionEntries(
    governedRequest,
    userData,
  );
  if (entries.length === 0) {
    return null;
  }

  return {
    entries,
    requestMetadata: {
      elicitation_context: {
        source: "action_required",
        mode: "runtime_protocol",
        form_id: governedRequest.requestId,
        action_type: governedRequest.actionType,
        field_count: entries.length,
        prompt: isNonEmptyString(governedRequest.prompt)
          ? governedRequest.prompt.trim()
          : undefined,
        entries,
        governance: governedRequest.governance,
      },
    },
  };
}

export function buildActionRequestSubmissionPayload(
  request: ActionRequired,
  formData: A2UIFormData,
): ActionRequestSubmissionPayload {
  const normalizedPayload = normalizeActionRequestFormDataForSubmission(
    request,
    formData,
  );
  const submissionContext = buildActionRequestSubmissionContext(
    request,
    normalizedPayload.userData,
  );

  return {
    ...normalizedPayload,
    entries: submissionContext?.entries || [],
    requestMetadata: submissionContext?.requestMetadata,
  };
}

function resolveSubmittedUserDataRecord(
  request: ActionRequired,
): Record<string, unknown> {
  const userData = request.submittedUserData;
  if (userData && typeof userData === "object" && !Array.isArray(userData)) {
    return userData as Record<string, unknown>;
  }

  if (typeof request.submittedResponse === "string") {
    const parsed = tryParseJsonRecord(request.submittedResponse);
    if (parsed) {
      return parsed;
    }

    if (request.submittedResponse.trim()) {
      return { answer: request.submittedResponse.trim() };
    }
  }

  if (typeof userData === "string" && userData.trim()) {
    return { answer: userData.trim() };
  }

  return {};
}

function normalizeInitialFormValue(
  component: ActionRequestFieldEntry["component"],
  value: unknown,
): unknown {
  if (component.component === "ChoicePicker") {
    if (Array.isArray(value)) {
      return value.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      );
    }
    if (typeof value === "string" && value.trim()) {
      return [value.trim()];
    }
    return [];
  }

  if (component.component === "CheckBox") {
    return value === true;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : String(item)))
      .filter(Boolean)
      .join(", ");
  }

  if (typeof value === "string") {
    return value;
  }

  return "";
}

export function resolveActionRequestInitialFormData(
  request: ActionRequired,
): A2UIFormData {
  const governedRequest = governActionRequest(request);
  if (!isActionRequestA2UICompatible(governedRequest)) {
    return {};
  }

  const fieldEntries = buildActionRequestFieldEntries(governedRequest);
  const submittedRecord = resolveSubmittedUserDataRecord(governedRequest);

  return fieldEntries.reduce<A2UIFormData>((accumulator, entry, index) => {
    const fallbackQuestion =
      governedRequest.actionType === "ask_user" && governedRequest.questions
        ? governedRequest.questions[index]?.question
        : undefined;
    const rawValue =
      submittedRecord[entry.fieldKey] ??
      (fallbackQuestion ? submittedRecord[fallbackQuestion] : undefined) ??
      (fieldEntries.length === 1 ? submittedRecord.answer : undefined);

    if (rawValue === undefined) {
      return accumulator;
    }

    accumulator[entry.component.id] = normalizeInitialFormValue(
      entry.component,
      rawValue,
    );
    return accumulator;
  }, {});
}

export function summarizeActionRequestSubmission(
  request: ActionRequired,
): string | null {
  const directSummary = summarizeValue(request.submittedUserData);
  if (directSummary) {
    return directSummary;
  }

  if (
    typeof request.submittedUserData === "object" &&
    request.submittedUserData
  ) {
    const record = request.submittedUserData as Record<string, unknown>;
    if ("answer" in record) {
      const answerSummary = summarizeValue(record.answer);
      if (answerSummary) {
        return answerSummary;
      }
    }

    const summarizedEntries = Object.entries(record)
      .map(([key, value]) => {
        const valueSummary = summarizeValue(value);
        if (!valueSummary) {
          return null;
        }
        return `${humanizeKey(key)}: ${valueSummary}`;
      })
      .filter((item): item is string => Boolean(item))
      .slice(0, 3);

    if (summarizedEntries.length > 0) {
      return summarizedEntries.join(" · ");
    }
  }

  if (isNonEmptyString(request.submittedResponse)) {
    const parsed = tryParseJsonRecord(request.submittedResponse);
    if (parsed) {
      const normalizedRequest: ActionRequired = {
        ...request,
        submittedUserData: parsed,
      };
      return summarizeActionRequestSubmission(normalizedRequest);
    }

    return request.submittedResponse.trim();
  }

  return null;
}
