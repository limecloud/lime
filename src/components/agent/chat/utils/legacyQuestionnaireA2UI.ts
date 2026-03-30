import type {
  A2UIComponent,
  A2UIFormData,
  A2UIResponse,
} from "@/lib/workspace/a2ui";
import type { ActionRequestGovernanceMeta } from "../types";

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
      governance?: ActionRequestGovernanceMeta;
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
  helperText?: string;
}

interface BuiltQuestionComponentResult {
  component: A2UIComponent;
  isCompact: boolean;
}

interface GovernedLegacyQuestionnaire {
  questionnaire: {
    introText: string;
    sections: LegacyQuestionnaireSection[];
    questionCount: number;
  };
  governance?: ActionRequestGovernanceMeta;
}

const INLINE_A2UI_REGEX = /<a2ui>|```\s*a2ui\b/i;
const SECTION_REGEX = /^\s*\d+[.、)]\s*(.+?)\s*$/;
const BULLET_REGEX = /^\s*[-*•●]\s+(.+?)\s*$/;
const OPTION_SPLIT_REGEX = /\s*(?:\/|／|\||｜|,|，|、)\s*/;
const COMPAT_ASK_MARKER_REGEX =
  /(?:ask\s*)?<arg_key>\s*question\s*<\/arg_key>\s*(?:<arg_key>\s*arg_value>?|<arg_value>)?/i;
const COMPAT_ASK_END_REGEX = /<\/(?:arg_value|tool_calls)>/i;
const COMPAT_ASK_TAG_REGEX = /<\/?(?:tool_calls|arg_key|arg_value)[^>]*>/gi;
const COMPAT_ASK_FOLLOWUP_PREFIX_REGEX = /^(?:另外|此外|同时|并且)[，,\s]*/;
const PLAIN_ASK_INTENT_REGEX =
  /(?:需要先明确|需要先确认|需要补充|请告诉我|请提供|补充以下信息|明确几个问题|在我开始之前|为了继续推进|麻烦补充|说明一下|提供一下)/;
const PLAIN_ASK_FOLLOWUP_REGEX =
  /^(?:一旦|明确后|确认后|收到后|然后|接下来|之后|后续)\b/;
const PLAIN_ASK_INLINE_FOLLOWUP_REGEX =
  /\s*(?=(?:一旦|明确后|确认后|收到后|然后|接下来|之后|后续).*(?:我会|我们会|开始|继续|整理|输出))/;
const LONG_TEXT_QUESTION_REGEX =
  /(?:说明|描述|展开|补充|介绍|背景|现状|原因|为什么|建议|判断|分析|误区|问题|挑战|计划|预期|担忧|详细)/;

function governLegacyQuestionnaire(questionnaire: {
  introText: string;
  sections: LegacyQuestionnaireSection[];
  questionCount: number;
}): GovernedLegacyQuestionnaire {
  if (questionnaire.questionCount <= 1) {
    return {
      questionnaire,
    };
  }

  const firstSectionIndex = questionnaire.sections.findIndex(
    (section) => section.questions.length > 0,
  );
  if (firstSectionIndex < 0) {
    return {
      questionnaire,
    };
  }

  const firstSection = questionnaire.sections[firstSectionIndex];

  return {
    questionnaire: {
      introText: questionnaire.introText,
      sections: [
        {
          title: firstSection.title,
          questions: [firstSection.questions[0]],
        },
      ],
      questionCount: 1,
    },
    governance: {
      strategy: "single_turn_single_question",
      source: "legacy_questionnaire",
      originalSectionCount: questionnaire.sections.length,
      originalQuestionCount: questionnaire.questionCount,
      retainedSectionIndex: firstSectionIndex,
      retainedQuestionIndex: 0,
      deferredQuestionCount: questionnaire.questionCount - 1,
    },
  };
}

function normalizeLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripMarkdownSyntax(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`{1,3}([^`]+)`{1,3}/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/~~(.+?)~~/g, "$1");
}

function normalizePlainTextSurface(value: string): string {
  return normalizeLine(stripMarkdownSyntax(value));
}

function joinMarkdownBlocks(lines: string[]): string {
  return uniqueNormalizedLines(lines).join("\n\n");
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
    const normalized = normalizePlainTextSurface(option);
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
      .map((item) => normalizePlainTextSurface(item))
      .filter(Boolean),
  );
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[：:；;，,。\s]+$/g, "").trim();
}

function uniqueNormalizedLines(lines: string[]): string[] {
  const deduped: string[] = [];

  for (const rawLine of lines) {
    const normalized = normalizeLine(rawLine);
    if (!normalized || deduped[deduped.length - 1] === normalized) {
      continue;
    }
    deduped.push(normalized);
  }

  return deduped;
}

function buildCompatAskHelperText(hints: string[]): string | undefined {
  const normalizedHints = uniqueOptions(hints);
  if (normalizedHints.length === 0) {
    return undefined;
  }

  return `例如：${normalizedHints.slice(0, 5).join("；")}`;
}

function normalizeCompatAskQuestionLabel(value: string): string {
  return stripTrailingPunctuation(
    normalizePlainTextSurface(value).replace(COMPAT_ASK_FOLLOWUP_PREFIX_REGEX, ""),
  );
}

function parseExampleHelperText(value: string): string | undefined {
  const normalized = normalizePlainTextSurface(value);
  if (!normalized) {
    return undefined;
  }

  if (/^(?:例如|比如|如)[：:]/.test(normalized)) {
    return normalized;
  }

  if (/^(?:例如|比如|如)\b/.test(normalized)) {
    return normalized.replace(/^(例如|比如|如)\s*/, "$1：");
  }

  if (/(?:例如|比如|如)/.test(normalized)) {
    return normalized;
  }

  return undefined;
}

function buildPlainAskQuestion(
  rawQuestion: string,
): LegacyQuestionnaireQuestion | null {
  const normalizedQuestion = normalizeLine(rawQuestion);
  if (!normalizedQuestion) {
    return null;
  }

  const parentheticalMatch = normalizedQuestion.match(
    /^(.*?)(?:（([^）]+)）|\(([^)]+)\))\s*$/,
  );
  if (parentheticalMatch) {
    const label = stripTrailingPunctuation(
      normalizePlainTextSurface(parentheticalMatch[1]),
    );
    const helperBlock = parentheticalMatch[2] || parentheticalMatch[3] || "";
    const helperText = parseExampleHelperText(helperBlock);

    if (label && helperText) {
      return {
        id: "",
        label,
        helperText,
      };
    }

    const options = splitOptions(helperBlock);
    if (label && options.length >= 2) {
      return {
        id: "",
        label,
        options,
        multiSelect: /多选/.test(normalizedQuestion),
      };
    }
  }

  const colonMatch = normalizedQuestion.match(/^(.*?)[：:]\s*(.+)$/);
  if (colonMatch) {
    const label = stripTrailingPunctuation(
      normalizePlainTextSurface(colonMatch[1]),
    );
    const helperText = parseExampleHelperText(colonMatch[2]);
    if (label && helperText) {
      return {
        id: "",
        label,
        helperText,
      };
    }

    const options = splitOptions(colonMatch[2]);
    if (label && options.length >= 2) {
      return {
        id: "",
        label,
        options,
        multiSelect: /多选/.test(normalizedQuestion),
      };
    }
  }

  if (
    /^是否/.test(normalizedQuestion) &&
    !/(?:例如|比如|如)/.test(normalizedQuestion)
  ) {
    return {
      id: "",
      label: stripTrailingPunctuation(
        normalizePlainTextSurface(normalizedQuestion),
      ),
      options: ["是", "否"],
      multiSelect: false,
    };
  }

  return {
    id: "",
    label:
      stripTrailingPunctuation(normalizePlainTextSurface(normalizedQuestion)) ||
      normalizePlainTextSurface(normalizedQuestion),
  };
}

function parsePlainAskQuestionnaire(content: string): {
  introText: string;
  sections: LegacyQuestionnaireSection[];
  questionCount: number;
} | null {
  if (COMPAT_ASK_MARKER_REGEX.test(content)) {
    return null;
  }

  if (!PLAIN_ASK_INTENT_REGEX.test(content)) {
    return null;
  }

  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const introLines: string[] = [];
  const questions: LegacyQuestionnaireQuestion[] = [];
  const seenLabels = new Set<string>();

  for (const rawLine of lines) {
    let line = normalizeLine(rawLine);
    if (!line) {
      continue;
    }

    const inlineFollowupMatch = line.match(PLAIN_ASK_INLINE_FOLLOWUP_REGEX);
    const shouldBreakAfterLine = Boolean(
      inlineFollowupMatch && typeof inlineFollowupMatch.index === "number",
    );
    if (
      shouldBreakAfterLine &&
      typeof inlineFollowupMatch?.index === "number"
    ) {
      line = line.slice(0, inlineFollowupMatch.index).trim();
    }

    if (questions.length > 0 && PLAIN_ASK_FOLLOWUP_REGEX.test(line)) {
      break;
    }

    const bulletMatch = rawLine.match(BULLET_REGEX);
    if (bulletMatch) {
      const parsedQuestion = buildPlainAskQuestion(bulletMatch[1]);
      if (parsedQuestion?.label) {
        const questionKey = parsedQuestion.label.toLowerCase();
        if (!seenLabels.has(questionKey)) {
          seenLabels.add(questionKey);
          questions.push({
            ...parsedQuestion,
            id: `plain_1_${questions.length + 1}`,
          });
        }
      }

      if (shouldBreakAfterLine) {
        break;
      }
      continue;
    }

    if (questions.length === 0) {
      introLines.push(line);
      continue;
    }

    if (shouldBreakAfterLine) {
      break;
    }
  }

  if (questions.length < 2) {
    return null;
  }

  return {
    introText: joinMarkdownBlocks(introLines),
    sections: [
      {
        title: "需要补充的信息",
        questions,
      },
    ],
    questionCount: questions.length,
  };
}

function parseLegacyFallbackQuestionnaire(content: string): {
  introText: string;
  sections: LegacyQuestionnaireSection[];
  questionCount: number;
} | null {
  return (
    parseCompatAskQuestionnaire(content) || parsePlainAskQuestionnaire(content)
  );
}

function parseCompatAskQuestionnaire(content: string): {
  introText: string;
  sections: LegacyQuestionnaireSection[];
  questionCount: number;
} | null {
  const normalizedContent = content.replace(/\r\n/g, "\n");
  const markerMatch = normalizedContent.match(COMPAT_ASK_MARKER_REGEX);
  if (!markerMatch || typeof markerMatch.index !== "number") {
    return null;
  }

  const bodyStart = markerMatch.index + markerMatch[0].length;
  const rawBody = normalizedContent.slice(bodyStart);
  const endMatch = rawBody.match(COMPAT_ASK_END_REGEX);
  const body = (
    typeof endMatch?.index === "number"
      ? rawBody.slice(0, endMatch.index)
      : rawBody
  )
    .replace(COMPAT_ASK_TAG_REGEX, " ")
    .trim();

  if (!body) {
    return null;
  }

  const introText = uniqueNormalizedLines(
    normalizedContent
      .slice(0, markerMatch.index)
      .replace(COMPAT_ASK_TAG_REGEX, " ")
      .split("\n"),
  ).join("\n\n");

  const paragraphs = body
    .split(/\n\s*\n/)
    .map((paragraph) =>
      paragraph
        .split("\n")
        .map((line) => normalizeLine(line.replace(COMPAT_ASK_TAG_REGEX, " ")))
        .filter(Boolean),
    )
    .filter((lines) => lines.length > 0);

  if (paragraphs.length === 0) {
    return null;
  }

  const hintLines: string[] = [];
  const promptParagraphs: string[] = [];

  for (const lines of paragraphs) {
    const bulletLines = lines
      .map((line) => line.match(BULLET_REGEX))
      .filter((match): match is RegExpMatchArray => Boolean(match))
      .map((match) => normalizeLine(match[1]));

    if (bulletLines.length > 0) {
      hintLines.push(...bulletLines);
    }

    const nonBulletLines = lines.filter((line) => !BULLET_REGEX.test(line));
    if (nonBulletLines.length > 0) {
      promptParagraphs.push(nonBulletLines.join(" "));
    }
  }

  const questions: LegacyQuestionnaireQuestion[] = [];
  const seenLabels = new Set<string>();
  let hintHelperText = buildCompatAskHelperText(hintLines);

  const pushQuestion = (label: string) => {
    const normalizedLabel = normalizeCompatAskQuestionLabel(label);
    if (!normalizedLabel) {
      return;
    }

    const questionKey = normalizedLabel.toLowerCase();
    if (seenLabels.has(questionKey)) {
      return;
    }

    seenLabels.add(questionKey);
    questions.push({
      id: `compat_1_${questions.length + 1}`,
      label: normalizedLabel,
      helperText: hintHelperText,
    });
    hintHelperText = undefined;
  };

  for (const paragraph of promptParagraphs) {
    const normalizedParagraph = normalizeLine(paragraph);
    if (!normalizedParagraph) {
      continue;
    }

    if (/这可以是[:：]?/.test(normalizedParagraph)) {
      pushQuestion(
        normalizedParagraph.split(/(?:。|\.)?\s*这可以是[:：]?/)[0] ||
          normalizedParagraph,
      );
      continue;
    }

    const sentenceCandidates = normalizedParagraph
      .split(/(?<=[？?])\s*/)
      .map((sentence) => normalizeCompatAskQuestionLabel(sentence))
      .filter(Boolean);
    const candidates =
      sentenceCandidates.length > 0
        ? sentenceCandidates
        : [normalizeCompatAskQuestionLabel(normalizedParagraph)].filter(
            Boolean,
          );

    for (const candidate of candidates) {
      if (
        !/[？?]$/.test(candidate) &&
        !/^(?:请|需要|麻烦|告诉我|说明|描述|补充|提供)/.test(candidate)
      ) {
        continue;
      }
      pushQuestion(candidate);
    }
  }

  if (questions.length === 0) {
    return null;
  }

  return {
    introText,
    sections: [
      {
        title: "需要补充的信息",
        questions,
      },
    ],
    questionCount: questions.length,
  };
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
        label: stripTrailingPunctuation(
          normalizePlainTextSurface(parentheticalMatch[1]),
        ),
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
        label: stripTrailingPunctuation(
          normalizePlainTextSurface(colonMatch[1]),
        ),
        options,
        multiSelect,
      };
    }
  }

  if (/^是否/.test(normalizedQuestion)) {
    return {
      label: stripTrailingPunctuation(
        normalizePlainTextSurface(normalizedQuestion),
      ),
      options: ["是", "否"],
      multiSelect: false,
    };
  }

  return {
    label:
      stripTrailingPunctuation(normalizePlainTextSurface(normalizedQuestion)) ||
      normalizePlainTextSurface(normalizedQuestion),
    multiSelect,
  };
}

function parseLegacyQuestionnaire(content: string): {
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
        title:
          stripTrailingPunctuation(normalizePlainTextSurface(sectionMatch[1])) ||
          normalizePlainTextSurface(sectionMatch[1]),
        questions: [],
      };
      sections.push(currentSection);
      continue;
    }

    const questionMatch = rawLine.match(BULLET_REGEX);
    if (questionMatch) {
      if (!currentSection) {
        return parseLegacyFallbackQuestionnaire(content);
      }

      const parsedQuestion = extractQuestionOptions(questionMatch[1]);
      if (!parsedQuestion.label) {
        return parseLegacyFallbackQuestionnaire(content);
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

    return parseLegacyFallbackQuestionnaire(content);
  }

  if (sections.length < 2 || questionCount < 3) {
    return parseLegacyFallbackQuestionnaire(content);
  }

  if (sections.some((section) => section.questions.length === 0)) {
    return parseLegacyFallbackQuestionnaire(content);
  }

  return {
    introText: joinMarkdownBlocks(introLines),
    sections,
    questionCount,
  };
}

function shouldUseLongTextField(
  question: LegacyQuestionnaireQuestion,
): boolean {
  if (question.options && question.options.length >= 2) {
    return false;
  }

  return LONG_TEXT_QUESTION_REGEX.test(question.label);
}

function isCompactQuestion(question: LegacyQuestionnaireQuestion): boolean {
  return !shouldUseLongTextField(question);
}

function buildQuestionComponent(params: {
  hash: string;
  sectionIndex: number;
  questionIndex: number;
  question: LegacyQuestionnaireQuestion;
}): BuiltQuestionComponentResult {
  const { hash, sectionIndex, questionIndex, question } = params;
  const componentId = `legacy_${hash}_${sectionIndex + 1}_${questionIndex + 1}`;
  const compact = isCompactQuestion(question);
  const safeLabel =
    stripTrailingPunctuation(normalizePlainTextSurface(question.label)) ||
    normalizePlainTextSurface(question.label);
  const safeHelperText = question.helperText
    ? normalizePlainTextSurface(question.helperText)
    : undefined;
  const safeOptions = uniqueOptions(question.options || []);

  if (safeOptions.length >= 2) {
    return {
      component: {
        id: componentId,
        component: "ChoicePicker",
        label: safeLabel,
        value: [],
        weight: 1,
        variant: question.multiSelect
          ? "multipleSelection"
          : "mutuallyExclusive",
        layout: "wrap",
        options: safeOptions.map((option) => ({
          label: option,
          value: option,
        })),
      },
      isCompact: true,
    };
  }

  return {
    component: {
      id: componentId,
      component: "TextField",
      label: safeLabel,
      value: "",
      weight: compact ? 1 : undefined,
      variant: compact ? "shortText" : "longText",
      placeholder: "请输入你的回答",
      helperText: safeHelperText,
    },
    isCompact: compact,
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

function isFieldComponent(component: A2UIComponent): component is Extract<
  A2UIComponent,
  {
    component:
      | "TextField"
      | "ChoicePicker"
      | "CheckBox"
      | "Slider"
      | "DateTimeInput";
  }
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
  const parsedQuestionnaire = parseLegacyQuestionnaire(content);
  if (!parsedQuestionnaire) {
    return null;
  }
  const { questionnaire, governance } =
    governLegacyQuestionnaire(parsedQuestionnaire);

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
    const sectionChildIds: string[] = [];
    const pendingCompactIds: string[] = [];
    const sectionBaseId = `legacy_${hash}_section_${sectionIndex + 1}`;
    const sectionTitleId = `${sectionBaseId}_title`;

    const flushPendingCompactRow = () => {
      if (pendingCompactIds.length === 0) {
        return;
      }

      if (pendingCompactIds.length === 1) {
        sectionChildIds.push(pendingCompactIds[0]);
        pendingCompactIds.length = 0;
        return;
      }

      const rowId = `${sectionBaseId}_row_${sectionChildIds.length + 1}`;
      components.push({
        id: rowId,
        component: "Row",
        children: [...pendingCompactIds],
        gap: 12,
        align: "stretch",
        wrap: true,
        minChildWidth: 220,
      });
      sectionChildIds.push(rowId);
      pendingCompactIds.length = 0;
    };

    components.push({
      id: sectionTitleId,
      component: "Text",
      text: section.title,
      variant: "h4",
    });
    sectionChildIds.push(sectionTitleId);

    section.questions.forEach((question, questionIndex) => {
      const questionResult = buildQuestionComponent({
        hash,
        sectionIndex,
        questionIndex,
        question,
      });
      components.push(questionResult.component);

      if (questionResult.isCompact) {
        pendingCompactIds.push(questionResult.component.id);
        if (pendingCompactIds.length >= 2) {
          flushPendingCompactRow();
        }
        return;
      }

      flushPendingCompactRow();
      sectionChildIds.push(questionResult.component.id);
    });

    flushPendingCompactRow();

    const sectionContentId = `${sectionBaseId}_content`;
    const sectionCardId = `${sectionBaseId}_card`;

    components.push({
      id: sectionContentId,
      component: "Column",
      children: sectionChildIds,
      gap: 10,
      align: "stretch",
    });
    components.push({
      id: sectionCardId,
      component: "Card",
      child: sectionContentId,
    });
    childIds.push(sectionCardId);
  });

  const rootId = `legacy_${hash}_root`;
  components.push({
    id: rootId,
    component: "Column",
    children: childIds,
    gap: 14,
    align: "stretch",
  });

  return {
    id: `legacy-questionnaire-${hash}`,
    root: rootId,
    data: {
      source: "legacy_questionnaire",
      sectionCount: questionnaire.sections.length,
      questionCount: questionnaire.questionCount,
      ...(governance
        ? {
            governance,
          }
        : {}),
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
  return (
    buildLegacyQuestionnaireSubmissionPayload(response, formData)
      ?.formattedMessage || null
  );
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
    .filter((entry): entry is LegacyQuestionnaireSubmissionEntry =>
      Boolean(entry),
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
    response.data && typeof response.data === "object"
      ? response.data
      : undefined;
  const governance =
    data?.governance && typeof data.governance === "object"
      ? (data.governance as ActionRequestGovernanceMeta)
      : undefined;

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
          typeof data?.sectionCount === "number"
            ? data.sectionCount
            : undefined,
        question_count:
          typeof data?.questionCount === "number"
            ? data.questionCount
            : undefined,
        entries,
        governance,
      },
    },
  };
}
