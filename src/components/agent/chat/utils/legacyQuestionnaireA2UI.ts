import type {
  A2UIComponent,
  A2UIFormData,
  A2UIResponse,
} from "@/components/content-creator/a2ui/types";

export interface LegacyQuestionnaireSubmissionEntry {
  fieldId: string;
  label: string;
  value: string | string[] | number | boolean;
  summary: string;
}

export interface LegacyQuestionnaireSubmissionPayload {
  formattedMessage: string;
  entries: LegacyQuestionnaireSubmissionEntry[];
  userData: Record<string, string | string[] | number | boolean>;
  requestMetadata: {
    elicitation_context: {
      source: "legacy_questionnaire";
      mode: "compatibility_bridge";
      form_id: string;
      section_count?: number;
      question_count?: number;
      entries: LegacyQuestionnaireSubmissionEntry[];
    };
  };
}

interface LegacyQuestionnaireSection {
  title: string;
  questions: LegacyQuestionnaireQuestion[];
}

interface LegacyQuestionnaireQuestion {
  id: string;
  label: string;
  options?: string[];
  multiSelect?: boolean;
}

const INLINE_A2UI_REGEX = /<a2ui>|```\s*a2ui\b/i;
const SECTION_REGEX = /^\s*\d+[.、)]\s*(.+?)\s*$/;
const BULLET_REGEX = /^\s*[-*•●]\s+(.+?)\s*$/;
const OPTION_SPLIT_REGEX = /\s*(?:\/|／|\||｜|,|，|、)\s*/;

function normalizeLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function buildStableHash(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}

function uniqueOptions(options: string[]): string[] {
  const seen = new Set<string>();
  return options.filter((option) => {
    const normalized = option.trim();
    if (!normalized || seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
}

function splitOptions(value: string): string[] {
  return uniqueOptions(
    value
      .split(OPTION_SPLIT_REGEX)
      .map((item) => normalizeLine(item))
      .filter(Boolean),
  );
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[：:；;，,。\s]+$/g, "").trim();
}

function extractQuestionOptions(rawQuestion: string): {
  label: string;
  options?: string[];
  multiSelect: boolean;
} {
  const normalizedQuestion = normalizeLine(rawQuestion);
  const multiSelect = /多选/.test(normalizedQuestion);
  const parentheticalMatch = normalizedQuestion.match(
    /^(.*?)(?:（([^）]+)）|\(([^)]+)\))\s*$/,
  );

  if (parentheticalMatch) {
    const optionBlock = parentheticalMatch[2] || parentheticalMatch[3] || "";
    const options = splitOptions(optionBlock);
    if (options.length >= 2) {
      return {
        label: stripTrailingPunctuation(parentheticalMatch[1]),
        options,
        multiSelect,
      };
    }
  }

  const colonMatch = normalizedQuestion.match(/^(.*?)[：:]\s*(.+)$/);
  if (colonMatch) {
    const options = splitOptions(colonMatch[2]);
    if (options.length >= 2) {
      return {
        label: stripTrailingPunctuation(colonMatch[1]),
        options,
        multiSelect,
      };
    }
  }

  if (/^是否/.test(normalizedQuestion)) {
    return {
      label: stripTrailingPunctuation(normalizedQuestion),
      options: ["是", "否"],
      multiSelect: false,
    };
  }

  return {
    label: stripTrailingPunctuation(normalizedQuestion) || normalizedQuestion,
    multiSelect,
  };
}

function parseLegacyQuestionnaire(
  content: string,
): {
  introText: string;
  sections: LegacyQuestionnaireSection[];
  questionCount: number;
} | null {
  if (!content.trim() || INLINE_A2UI_REGEX.test(content)) {
    return null;
  }

  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const introLines: string[] = [];
  const sections: LegacyQuestionnaireSection[] = [];
  let currentSection: LegacyQuestionnaireSection | null = null;
  let questionCount = 0;

  for (const rawLine of lines) {
    const line = normalizeLine(rawLine);
    if (!line) {
      continue;
    }

    const sectionMatch = rawLine.match(SECTION_REGEX);
    if (sectionMatch) {
      currentSection = {
        title: normalizeLine(sectionMatch[1]),
        questions: [],
      };
      sections.push(currentSection);
      continue;
    }

    const questionMatch = rawLine.match(BULLET_REGEX);
    if (questionMatch) {
      if (!currentSection) {
        return null;
      }

      const parsedQuestion = extractQuestionOptions(questionMatch[1]);
      if (!parsedQuestion.label) {
        return null;
      }

      currentSection.questions.push({
        id: `${sections.length}_${currentSection.questions.length + 1}`,
        label: parsedQuestion.label,
        options: parsedQuestion.options,
        multiSelect: parsedQuestion.multiSelect,
      });
      questionCount += 1;
      continue;
    }

    if (!currentSection) {
      introLines.push(line);
      continue;
    }

    if (currentSection.questions.length === 0) {
      continue;
    }

    return null;
  }

  if (sections.length < 2 || questionCount < 3) {
    return null;
  }

  if (sections.some((section) => section.questions.length === 0)) {
    return null;
  }

  return {
    introText: introLines.join(" "),
    sections,
    questionCount,
  };
}

function buildQuestionComponent(params: {
  hash: string;
  sectionIndex: number;
  questionIndex: number;
  question: LegacyQuestionnaireQuestion;
}): A2UIComponent {
  const { hash, sectionIndex, questionIndex, question } = params;
  const componentId = `legacy_${hash}_${sectionIndex + 1}_${questionIndex + 1}`;

  if (question.options && question.options.length >= 2) {
    return {
      id: componentId,
      component: "ChoicePicker",
      label: question.label,
      value: [],
      variant: question.multiSelect
        ? "multipleSelection"
        : "mutuallyExclusive",
      layout: "vertical",
      options: question.options.map((option) => ({
        label: option,
        value: option,
      })),
    };
  }

  return {
    id: componentId,
    component: "TextField",
    label: question.label,
    value: "",
    variant: "longText",
    placeholder: "请输入你的回答",
  };
}

function summarizeFormValue(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim() || null;
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (typeof value === "boolean") {
    return value ? "是" : null;
  }

  if (Array.isArray(value)) {
    const items = value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
    return items.length > 0 ? items.join("、") : null;
  }

  return null;
}

function normalizeStructuredValue(
  value: unknown,
): string | string[] | number | boolean | null {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized || null;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    const normalized = value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
    if (normalized.length === 0) {
      return null;
    }
    return normalized.length === 1 ? normalized[0] : normalized;
  }

  return null;
}

function isFieldComponent(
  component: A2UIComponent,
): component is Extract<
  A2UIComponent,
  { component: "TextField" | "ChoicePicker" | "CheckBox" | "Slider" | "DateTimeInput" }
> {
  return (
    component.component === "TextField" ||
    component.component === "ChoicePicker" ||
    component.component === "CheckBox" ||
    component.component === "Slider" ||
    component.component === "DateTimeInput"
  );
}

function resolveComponentLabel(component: A2UIComponent): string | null {
  if (!isFieldComponent(component)) {
    return null;
  }

  if (!("label" in component) || typeof component.label !== "string") {
    return null;
  }

  return component.label.trim() || null;
}

export function buildLegacyQuestionnaireA2UI(
  content: string,
): A2UIResponse | null {
  const questionnaire = parseLegacyQuestionnaire(content);
  if (!questionnaire) {
    return null;
  }

  const hash = buildStableHash(content);
  const components: A2UIComponent[] = [];
  const childIds: string[] = [];
  const titleId = `legacy_${hash}_title`;

  components.push({
    id: titleId,
    component: "Text",
    text: "补充信息",
    variant: "h3",
  });
  childIds.push(titleId);

  if (questionnaire.introText) {
    const introId = `legacy_${hash}_intro`;
    components.push({
      id: introId,
      component: "Text",
      text: questionnaire.introText,
      variant: "body",
    });
    childIds.push(introId);
  }

  questionnaire.sections.forEach((section, sectionIndex) => {
    const sectionId = `legacy_${hash}_section_${sectionIndex + 1}`;
    components.push({
      id: sectionId,
      component: "Text",
      text: section.title,
      variant: "h4",
    });
    childIds.push(sectionId);

    section.questions.forEach((question, questionIndex) => {
      const questionComponent = buildQuestionComponent({
        hash,
        sectionIndex,
        questionIndex,
        question,
      });
      components.push(questionComponent);
      childIds.push(questionComponent.id);
    });
  });

  const rootId = `legacy_${hash}_root`;
  components.push({
    id: rootId,
    component: "Column",
    children: childIds,
    gap: 16,
    align: "stretch",
  });

  return {
    id: `legacy-questionnaire-${hash}`,
    root: rootId,
    data: {
      source: "legacy_questionnaire",
      sectionCount: questionnaire.sections.length,
      questionCount: questionnaire.questionCount,
    },
    components,
    submitAction: {
      label: "确认并继续",
      action: {
        name: "submit",
      },
    },
  };
}

export function formatLegacyQuestionnaireSubmission(
  response: A2UIResponse,
  formData: A2UIFormData,
): string | null {
  return buildLegacyQuestionnaireSubmissionPayload(response, formData)
    ?.formattedMessage || null;
}

export function buildLegacyQuestionnaireSubmissionPayload(
  response: A2UIResponse,
  formData: A2UIFormData,
): LegacyQuestionnaireSubmissionPayload | null {
  const entries = response.components
    .filter(isFieldComponent)
    .map((component) => {
      const label = resolveComponentLabel(component);
      if (!label) {
        return null;
      }

      const structuredValue = normalizeStructuredValue(formData[component.id]);
      if (structuredValue === null) {
        return null;
      }

      const summary = summarizeFormValue(structuredValue);
      if (!summary) {
        return null;
      }

      return {
        fieldId: component.id,
        label,
        value: structuredValue,
        summary,
      };
    })
    .filter(
      (entry): entry is LegacyQuestionnaireSubmissionEntry => Boolean(entry),
    );

  if (entries.length === 0) {
    return null;
  }

  const lines = entries.map((entry) => `- ${entry.label}: ${entry.summary}`);
  const userData = entries.reduce<
    Record<string, string | string[] | number | boolean>
  >((accumulator, entry) => {
    accumulator[entry.label] = entry.value;
    return accumulator;
  }, {});
  const data =
    response.data && typeof response.data === "object" ? response.data : undefined;

  return {
    formattedMessage: `我的选择：\n${lines.join("\n")}`,
    entries,
    userData,
    requestMetadata: {
      elicitation_context: {
        source: "legacy_questionnaire",
        mode: "compatibility_bridge",
        form_id: response.id,
        section_count:
          typeof data?.sectionCount === "number" ? data.sectionCount : undefined,
        question_count:
          typeof data?.questionCount === "number" ? data.questionCount : undefined,
        entries,
      },
    },
  };
}
