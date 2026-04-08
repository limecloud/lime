import type { ParsedAnalysisWorkbenchCommand } from "./analysisWorkbenchCommand";
import type { ParsedBroadcastWorkbenchCommand } from "./broadcastWorkbenchCommand";
import type { ParsedBrowserWorkbenchCommand } from "./browserWorkbenchCommand";
import type {
  ParsedChannelPreviewWorkbenchCommand,
} from "./channelPreviewWorkbenchCommand";
import type {
  CodeWorkbenchTaskType,
  ParsedCodeWorkbenchCommand,
} from "./codeWorkbenchCommand";
import type { ParsedComplianceWorkbenchCommand } from "./complianceWorkbenchCommand";
import type { ParsedCompetitorWorkbenchCommand } from "./competitorWorkbenchCommand";
import type { ParsedCoverWorkbenchCommand } from "./coverWorkbenchCommand";
import type {
  ParsedDeepSearchWorkbenchCommand,
} from "./deepSearchWorkbenchCommand";
import type { FormType, ParsedFormWorkbenchCommand } from "./formWorkbenchCommand";
import type { ParsedImageWorkbenchCommand } from "./imageWorkbenchCommand";
import type { ParsedPdfWorkbenchCommand } from "./pdfWorkbenchCommand";
import type { ParsedPosterWorkbenchCommand } from "./posterWorkbenchCommand";
import type {
  ParsedPresentationWorkbenchCommand,
  PresentationDeckType,
} from "./presentationWorkbenchCommand";
import type { ParsedPublishWorkbenchCommand } from "./publishWorkbenchCommand";
import type { ParsedReportWorkbenchCommand } from "./reportWorkbenchCommand";
import type {
  ParsedResourceSearchWorkbenchCommand,
  ResourceSearchType,
} from "./resourceSearchWorkbenchCommand";
import type {
  ParsedSearchWorkbenchCommand,
  SearchDepth,
} from "./searchWorkbenchCommand";
import type { ParsedSiteSearchWorkbenchCommand } from "./siteSearchWorkbenchCommand";
import type {
  ParsedSummaryWorkbenchCommand,
  SummaryLength,
} from "./summaryWorkbenchCommand";
import type { ParsedTranscriptionWorkbenchCommand } from "./transcriptionWorkbenchCommand";
import type { ParsedTranslationWorkbenchCommand } from "./translationWorkbenchCommand";
import type { ParsedTypesettingWorkbenchCommand } from "./typesettingWorkbenchCommand";
import type { ParsedUploadWorkbenchCommand } from "./uploadWorkbenchCommand";
import type {
  ParsedUrlParseWorkbenchCommand,
  UrlParseExtractGoal,
} from "./urlParseWorkbenchCommand";
import type { ParsedVideoWorkbenchCommand } from "./videoWorkbenchCommand";
import type { ParsedVoiceWorkbenchCommand } from "./voiceWorkbenchCommand";
import type { ParsedWebpageWorkbenchCommand, WebpageType } from "./webpageWorkbenchCommand";

type ReplayParsedCommand = {
  body: string;
};

interface BuildMentionCommandReplayTextInput {
  commandKey?: string;
  parsedCommand:
    | ParsedAnalysisWorkbenchCommand
    | ParsedChannelPreviewWorkbenchCommand
    | ParsedCodeWorkbenchCommand
    | ParsedComplianceWorkbenchCommand
    | ParsedCompetitorWorkbenchCommand
    | ParsedCoverWorkbenchCommand
    | ParsedSearchWorkbenchCommand
    | ParsedDeepSearchWorkbenchCommand
    | ParsedFormWorkbenchCommand
    | ParsedImageWorkbenchCommand
    | ParsedPdfWorkbenchCommand
    | ParsedPosterWorkbenchCommand
    | ParsedPresentationWorkbenchCommand
    | ParsedPublishWorkbenchCommand
    | ParsedReportWorkbenchCommand
    | ParsedResourceSearchWorkbenchCommand
    | ParsedSiteSearchWorkbenchCommand
    | ParsedSummaryWorkbenchCommand
    | ParsedTranscriptionWorkbenchCommand
    | ParsedTypesettingWorkbenchCommand
    | ParsedTranslationWorkbenchCommand
    | ParsedUploadWorkbenchCommand
    | ParsedUrlParseWorkbenchCommand
    | ParsedVideoWorkbenchCommand
    | ParsedVoiceWorkbenchCommand
    | ParsedWebpageWorkbenchCommand
    | ParsedBroadcastWorkbenchCommand
    | ParsedBrowserWorkbenchCommand
    | ReplayParsedCommand;
}

const SEARCH_DEPTH_LABELS: Record<SearchDepth, string> = {
  quick: "快速",
  standard: "标准",
  deep: "深度",
};

const SUMMARY_LENGTH_LABELS: Record<SummaryLength, string> = {
  short: "简短",
  medium: "适中",
  long: "详细",
};

const URL_PARSE_GOAL_LABELS: Record<UrlParseExtractGoal, string> = {
  summary: "摘要",
  key_points: "要点",
  full_text: "正文",
  quotes: "引用",
};

const PRESENTATION_DECK_TYPE_LABELS: Record<PresentationDeckType, string> = {
  pitch_deck: "路演PPT",
  sales_deck: "销售PPT",
  training_deck: "培训PPT",
  report_deck: "汇报PPT",
  proposal_deck: "方案PPT",
};

const FORM_TYPE_LABELS: Record<FormType, string> = {
  survey_form: "问卷表单",
  lead_form: "线索表单",
  registration_form: "报名表单",
  feedback_form: "反馈表单",
  application_form: "申请表单",
};

const WEBPAGE_TYPE_LABELS: Record<WebpageType, string> = {
  landing_page: "落地页",
  homepage: "官网",
  campaign_page: "活动页",
  product_page: "产品页",
  docs_page: "文档页",
  portfolio: "作品集",
  resume_page: "简历页",
};

const CODE_TASK_TYPE_LABELS: Record<CodeWorkbenchTaskType, string> = {
  code_review: "代码评审",
  bug_fix: "修复",
  implementation: "实现",
  refactor: "重构",
  explain: "解释",
};

const RESOURCE_TYPE_LABELS: Record<ResourceSearchType, string> = {
  image: "图片",
  bgm: "BGM",
  sfx: "音效",
  video: "视频",
};

function normalizeText(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function trimReplayDecorations(value: string): string {
  return value
    .replace(/^[,\s，。；;:：]+|[,\s，。；;:：]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function bodyContainsLiteral(body: string, value?: string | null): boolean {
  const normalizedValue = normalizeText(value);
  if (!normalizedValue) {
    return false;
  }

  return new RegExp(escapeRegExp(normalizedValue), "i").test(body);
}

function quoteReplayPathIfNeeded(value?: string | null): string | undefined {
  const normalizedValue = normalizeText(value);
  if (!normalizedValue) {
    return undefined;
  }

  if (/\s/.test(normalizedValue) && !/^["'].*["']$/.test(normalizedValue)) {
    return `"${normalizedValue}"`;
  }

  return normalizedValue;
}

function joinReplayFields(
  fields: Array<string | undefined>,
): string | undefined {
  const replayText = fields.filter(Boolean).join(" ").trim();
  return replayText || undefined;
}

function resolveAspectOrSizeReplayToken(input: {
  body: string;
  aspectRatio?: string | null;
  size?: string | null;
}): string | undefined {
  if (bodyContainsLiteral(input.body, input.aspectRatio)) {
    return normalizeText(input.aspectRatio);
  }

  if (bodyContainsLiteral(input.body, input.size)) {
    return normalizeText(input.size);
  }

  return undefined;
}

function buildSearchReplayText(
  parsedCommand: Pick<
    ParsedSearchWorkbenchCommand,
    "body" | "query" | "site" | "timeRange" | "depth" | "focus" | "outputFormat"
  >,
  depthOverride?: SearchDepth,
): string | undefined {
  const query = normalizeText(parsedCommand.query);
  const site = normalizeText(parsedCommand.site);
  const timeRange = normalizeText(parsedCommand.timeRange);
  const focus = normalizeText(parsedCommand.focus);
  const outputFormat = normalizeText(parsedCommand.outputFormat);
  const resolvedDepth = depthOverride ?? parsedCommand.depth ?? "standard";

  if (!query && !site && !timeRange && !focus && !outputFormat) {
    return normalizeText(parsedCommand.body);
  }

  return joinReplayFields([
    query ? `关键词:${query}` : undefined,
    site ? `站点:${site}` : undefined,
    timeRange ? `时间:${timeRange}` : undefined,
    `深度:${SEARCH_DEPTH_LABELS[resolvedDepth]}`,
    focus ? `重点:${focus}` : undefined,
    outputFormat ? `输出:${outputFormat}` : undefined,
  ]);
}

function buildReportReplayText(
  parsedCommand: Pick<
    ParsedReportWorkbenchCommand,
    "body" | "query" | "site" | "timeRange" | "focus" | "outputFormat"
  >,
): string | undefined {
  const query = normalizeText(parsedCommand.query);
  const site = normalizeText(parsedCommand.site);
  const timeRange = normalizeText(parsedCommand.timeRange);
  const focus = normalizeText(parsedCommand.focus);
  const outputFormat = normalizeText(parsedCommand.outputFormat);

  if (!query && !site && !timeRange && !focus && !outputFormat) {
    return normalizeText(parsedCommand.body);
  }

  return joinReplayFields([
    query ? `关键词:${query}` : undefined,
    site ? `站点:${site}` : undefined,
    timeRange ? `时间:${timeRange}` : undefined,
    focus ? `重点:${focus}` : undefined,
    outputFormat ? `输出:${outputFormat}` : undefined,
  ]);
}

function buildSiteSearchReplayText(
  parsedCommand: ParsedSiteSearchWorkbenchCommand,
): string | undefined {
  const site = normalizeText(parsedCommand.site);
  const query = normalizeText(parsedCommand.query);
  const limit =
    typeof parsedCommand.limit === "number" && Number.isFinite(parsedCommand.limit)
      ? `${parsedCommand.limit}`
      : undefined;

  if (!site && !query && !limit) {
    return normalizeText(parsedCommand.body);
  }

  return joinReplayFields([
    site ? `站点:${site}` : undefined,
    query ? `关键词:${query}` : undefined,
    limit ? `数量:${limit}` : undefined,
  ]);
}

function buildTypesettingReplayText(
  parsedCommand: ParsedTypesettingWorkbenchCommand,
): string | undefined {
  const targetPlatform = normalizeText(parsedCommand.targetPlatform);
  const prompt = normalizeText(parsedCommand.prompt);

  if (!targetPlatform && !prompt) {
    return normalizeText(parsedCommand.body);
  }

  return joinReplayFields([
    targetPlatform ? `平台:${targetPlatform}` : undefined,
    prompt ? `要求:${prompt}` : undefined,
  ]);
}

function buildPresentationReplayText(
  parsedCommand: ParsedPresentationWorkbenchCommand,
): string | undefined {
  const deckType = parsedCommand.deckType
    ? PRESENTATION_DECK_TYPE_LABELS[parsedCommand.deckType]
    : undefined;
  const style = normalizeText(parsedCommand.style);
  const audience = normalizeText(parsedCommand.audience);
  const slideCount =
    typeof parsedCommand.slideCount === "number" &&
    Number.isFinite(parsedCommand.slideCount)
      ? `${parsedCommand.slideCount}`
      : undefined;
  const prompt = normalizeText(parsedCommand.prompt);

  if (!deckType && !style && !audience && !slideCount && !prompt) {
    return normalizeText(parsedCommand.body);
  }

  return joinReplayFields([
    deckType ? `类型:${deckType}` : undefined,
    style ? `风格:${style}` : undefined,
    audience ? `受众:${audience}` : undefined,
    slideCount ? `页数:${slideCount}` : undefined,
    prompt ? `要求:${prompt}` : undefined,
  ]);
}

function buildFormReplayText(
  parsedCommand: ParsedFormWorkbenchCommand,
): string | undefined {
  const formType = parsedCommand.formType
    ? FORM_TYPE_LABELS[parsedCommand.formType]
    : undefined;
  const style = normalizeText(parsedCommand.style);
  const audience = normalizeText(parsedCommand.audience);
  const fieldCount =
    typeof parsedCommand.fieldCount === "number" &&
    Number.isFinite(parsedCommand.fieldCount)
      ? `${parsedCommand.fieldCount}`
      : undefined;
  const prompt = normalizeText(parsedCommand.prompt);

  if (!formType && !style && !audience && !fieldCount && !prompt) {
    return normalizeText(parsedCommand.body);
  }

  return joinReplayFields([
    formType ? `类型:${formType}` : undefined,
    style ? `风格:${style}` : undefined,
    audience ? `受众:${audience}` : undefined,
    fieldCount ? `字段数:${fieldCount}` : undefined,
    prompt ? `要求:${prompt}` : undefined,
  ]);
}

function buildWebpageReplayText(
  parsedCommand: ParsedWebpageWorkbenchCommand,
): string | undefined {
  const pageType = parsedCommand.pageType
    ? WEBPAGE_TYPE_LABELS[parsedCommand.pageType]
    : undefined;
  const style = normalizeText(parsedCommand.style);
  const techStack = normalizeText(parsedCommand.techStack);
  const prompt = normalizeText(parsedCommand.prompt);

  if (!pageType && !style && !techStack && !prompt) {
    return normalizeText(parsedCommand.body);
  }

  return joinReplayFields([
    pageType ? `类型:${pageType}` : undefined,
    style ? `风格:${style}` : undefined,
    techStack ? `技术:${techStack}` : undefined,
    prompt ? `要求:${prompt}` : undefined,
  ]);
}

function buildSummaryReplayText(
  parsedCommand: ParsedSummaryWorkbenchCommand,
): string | undefined {
  const content = normalizeText(parsedCommand.content);
  const focus = normalizeText(parsedCommand.focus);
  const style = normalizeText(parsedCommand.style);
  const outputFormat = normalizeText(parsedCommand.outputFormat);
  const length = parsedCommand.length
    ? SUMMARY_LENGTH_LABELS[parsedCommand.length]
    : undefined;

  if (!content && !focus && !length && !style && !outputFormat) {
    return normalizeText(parsedCommand.body);
  }

  return joinReplayFields([
    content ? `内容:${content}` : undefined,
    focus ? `重点:${focus}` : undefined,
    length ? `长度:${length}` : undefined,
    style ? `风格:${style}` : undefined,
    outputFormat ? `输出:${outputFormat}` : undefined,
  ]);
}

function buildTranslationReplayText(
  parsedCommand: ParsedTranslationWorkbenchCommand,
): string | undefined {
  const content = normalizeText(parsedCommand.content);
  const sourceLanguage = normalizeText(parsedCommand.sourceLanguage);
  const targetLanguage = normalizeText(parsedCommand.targetLanguage);
  const style = normalizeText(parsedCommand.style);
  const outputFormat = normalizeText(parsedCommand.outputFormat);

  if (!content && !sourceLanguage && !targetLanguage && !style && !outputFormat) {
    return normalizeText(parsedCommand.body);
  }

  return joinReplayFields([
    content ? `内容:${content}` : undefined,
    sourceLanguage ? `原语言:${sourceLanguage}` : undefined,
    targetLanguage ? `目标语言:${targetLanguage}` : undefined,
    style ? `风格:${style}` : undefined,
    outputFormat ? `输出:${outputFormat}` : undefined,
  ]);
}

function buildAnalysisReplayText(
  parsedCommand: Pick<
    ParsedAnalysisWorkbenchCommand,
    "body" | "content" | "focus" | "style" | "outputFormat"
  >,
): string | undefined {
  const content = normalizeText(parsedCommand.content);
  const focus = normalizeText(parsedCommand.focus);
  const style = normalizeText(parsedCommand.style);
  const outputFormat = normalizeText(parsedCommand.outputFormat);

  if (!content && !focus && !style && !outputFormat) {
    return normalizeText(parsedCommand.body);
  }

  return joinReplayFields([
    content ? `内容:${content}` : undefined,
    focus ? `重点:${focus}` : undefined,
    style ? `风格:${style}` : undefined,
    outputFormat ? `输出:${outputFormat}` : undefined,
  ]);
}

function buildComplianceReplayText(
  parsedCommand: ParsedComplianceWorkbenchCommand,
): string | undefined {
  return buildAnalysisReplayText({
    body: parsedCommand.body,
    content: parsedCommand.content,
    focus: parsedCommand.focus,
    style: parsedCommand.style,
    outputFormat: parsedCommand.outputFormat,
  });
}

function buildPdfReplayText(
  parsedCommand: ParsedPdfWorkbenchCommand,
): string | undefined {
  const sourcePath = normalizeText(parsedCommand.sourcePath);
  const sourceUrl = normalizeText(parsedCommand.sourceUrl);
  const focus = normalizeText(parsedCommand.focus);
  const outputFormat = normalizeText(parsedCommand.outputFormat);
  const prompt = normalizeText(parsedCommand.prompt);

  if (!sourcePath && !sourceUrl && !focus && !outputFormat && !prompt) {
    return normalizeText(parsedCommand.body);
  }

  return joinReplayFields([
    sourcePath ? `文件:${sourcePath}` : undefined,
    sourceUrl ? `链接:${sourceUrl}` : undefined,
    focus ? `重点:${focus}` : undefined,
    outputFormat ? `输出:${outputFormat}` : undefined,
    prompt ? `要求:${prompt}` : undefined,
  ]);
}

function buildUrlParseReplayText(
  parsedCommand: ParsedUrlParseWorkbenchCommand,
): string | undefined {
  const url = normalizeText(parsedCommand.url);
  const extractGoal = parsedCommand.extractGoal
    ? URL_PARSE_GOAL_LABELS[parsedCommand.extractGoal]
    : undefined;
  const prompt = normalizeText(parsedCommand.prompt);

  if (!url && !extractGoal && !prompt) {
    return normalizeText(parsedCommand.body);
  }

  return joinReplayFields([
    url ? `链接:${url}` : undefined,
    extractGoal ? `提取:${extractGoal}` : undefined,
    prompt ? `要求:${prompt}` : undefined,
  ]);
}

function buildCodeReplayText(
  parsedCommand: ParsedCodeWorkbenchCommand,
): string | undefined {
  const taskType = parsedCommand.taskType
    ? CODE_TASK_TYPE_LABELS[parsedCommand.taskType]
    : undefined;
  const prompt = normalizeText(parsedCommand.prompt);

  if (!taskType && !prompt) {
    return normalizeText(parsedCommand.body);
  }

  return joinReplayFields([
    taskType ? `类型:${taskType}` : undefined,
    prompt ? `要求:${prompt}` : undefined,
  ]);
}

function buildImageReplayText(
  parsedCommand: ParsedImageWorkbenchCommand,
): string | undefined {
  const targetRef = parsedCommand.targetRef
    ? normalizeText(`#${parsedCommand.targetRef}`)
    : undefined;
  const aspectOrSize = resolveAspectOrSizeReplayToken({
    body: parsedCommand.body,
    aspectRatio: parsedCommand.aspectRatio,
    size: parsedCommand.size,
  });
  const prompt = normalizeText(parsedCommand.prompt);
  const count =
    typeof parsedCommand.count === "number" &&
    Number.isFinite(parsedCommand.count) &&
    parsedCommand.count > 1
      ? `出 ${parsedCommand.count} 张`
      : undefined;

  if (!targetRef && !aspectOrSize && !prompt && !count) {
    return normalizeText(parsedCommand.body);
  }

  return joinReplayFields([targetRef, aspectOrSize, prompt, count]);
}

function buildPosterReplayText(
  parsedCommand: ParsedPosterWorkbenchCommand,
): string | undefined {
  const platform = normalizeText(parsedCommand.platform);
  const style = normalizeText(parsedCommand.style);
  const aspectOrSize = resolveAspectOrSizeReplayToken({
    body: parsedCommand.body,
    aspectRatio: parsedCommand.aspectRatio,
    size: parsedCommand.size,
  });
  let prompt = normalizeText(parsedCommand.prompt);

  if (prompt && platform) {
    prompt = trimReplayDecorations(
      prompt.replace(
        new RegExp(`^适用于\\s*${escapeRegExp(platform)}[，,]?\\s*`, "i"),
        "",
      ),
    );
  }

  if (prompt && style) {
    prompt = trimReplayDecorations(
      prompt.replace(
        new RegExp(`^${escapeRegExp(style)}风格[，,]?\\s*`, "i"),
        "",
      ),
    );
  }

  if (prompt) {
    prompt = trimReplayDecorations(prompt.replace(/^海报设计[，,]?\s*/i, ""));
  }

  if (!platform && !style && !aspectOrSize && !prompt) {
    return normalizeText(parsedCommand.body);
  }

  return joinReplayFields([
    platform ? `平台:${platform}` : undefined,
    style ? `风格:${style}` : undefined,
    aspectOrSize,
    prompt || normalizeText(parsedCommand.body),
  ]);
}

function buildCoverReplayText(
  parsedCommand: ParsedCoverWorkbenchCommand,
): string | undefined {
  const platform = normalizeText(parsedCommand.platform);
  const title = normalizeText(parsedCommand.title);
  const style = normalizeText(parsedCommand.style);
  const size = normalizeText(parsedCommand.size);
  const prompt = normalizeText(parsedCommand.prompt);

  if (!platform && !title && !style && !size && !prompt) {
    return normalizeText(parsedCommand.body);
  }

  return joinReplayFields([
    platform ? `平台:${platform}` : undefined,
    title ? `标题:${title}` : undefined,
    style ? `风格:${style}` : undefined,
    size,
    prompt,
  ]);
}

function buildVideoReplayText(
  parsedCommand: ParsedVideoWorkbenchCommand,
): string | undefined {
  const duration =
    typeof parsedCommand.duration === "number" &&
    Number.isFinite(parsedCommand.duration)
      ? `${parsedCommand.duration}秒`
      : undefined;
  const aspectRatio = parsedCommand.aspectRatio
    ? parsedCommand.aspectRatio === "adaptive"
      ? "自适应"
      : parsedCommand.aspectRatio
    : undefined;
  const resolution = normalizeText(parsedCommand.resolution);
  const prompt = normalizeText(parsedCommand.prompt);

  if (!duration && !aspectRatio && !resolution && !prompt) {
    return normalizeText(parsedCommand.body);
  }

  return joinReplayFields([duration, aspectRatio, resolution, prompt]);
}

function buildBroadcastReplayText(
  parsedCommand: ParsedBroadcastWorkbenchCommand,
): string | undefined {
  const title = normalizeText(parsedCommand.title);
  const audience = normalizeText(parsedCommand.audience);
  const tone = normalizeText(parsedCommand.tone);
  const durationHintMinutes =
    typeof parsedCommand.durationHintMinutes === "number" &&
    Number.isFinite(parsedCommand.durationHintMinutes)
      ? `时长:${parsedCommand.durationHintMinutes}分钟`
      : undefined;
  const prompt = normalizeText(parsedCommand.prompt);
  const content = normalizeText(parsedCommand.content);

  if (!title && !audience && !tone && !durationHintMinutes && !prompt && !content) {
    return normalizeText(parsedCommand.body);
  }

  return joinReplayFields([
    title ? `标题:${title}` : undefined,
    audience ? `听众:${audience}` : undefined,
    tone ? `语气:${tone}` : undefined,
    durationHintMinutes,
    prompt,
    content && content !== prompt ? `内容:${content}` : undefined,
  ]);
}

function buildResourceSearchReplayText(
  parsedCommand: ParsedResourceSearchWorkbenchCommand,
): string | undefined {
  const title = normalizeText(parsedCommand.title);
  const resourceType = parsedCommand.resourceType
    ? RESOURCE_TYPE_LABELS[parsedCommand.resourceType]
    : undefined;
  const query = normalizeText(parsedCommand.query);
  const usage = normalizeText(parsedCommand.usage);
  const count =
    typeof parsedCommand.count === "number" && Number.isFinite(parsedCommand.count)
      ? `${parsedCommand.count}`
      : undefined;

  if (!title && !resourceType && !query && !usage && !count) {
    return normalizeText(parsedCommand.body);
  }

  return joinReplayFields([
    title ? `标题:${title}` : undefined,
    resourceType ? `类型:${resourceType}` : undefined,
    query ? `关键词:${query}` : undefined,
    usage ? `用途:${usage}` : undefined,
    count ? `数量:${count}` : undefined,
  ]);
}

function buildTranscriptionReplayText(
  parsedCommand: ParsedTranscriptionWorkbenchCommand,
): string | undefined {
  const sourcePath = quoteReplayPathIfNeeded(parsedCommand.sourcePath);
  const sourceUrl = normalizeText(parsedCommand.sourceUrl);
  const language = normalizeText(parsedCommand.language);
  const outputFormat = normalizeText(parsedCommand.outputFormat);
  const speakerLabels =
    parsedCommand.speakerLabels === undefined
      ? undefined
      : parsedCommand.speakerLabels
        ? "区分说话人"
        : "不区分说话人";
  const timestamps =
    parsedCommand.timestamps === undefined
      ? undefined
      : parsedCommand.timestamps
        ? "带时间戳"
        : "不要时间戳";
  const prompt = normalizeText(parsedCommand.prompt);

  if (
    !sourcePath &&
    !sourceUrl &&
    !language &&
    !outputFormat &&
    !speakerLabels &&
    !timestamps &&
    !prompt
  ) {
    return normalizeText(parsedCommand.body);
  }

  return joinReplayFields([
    sourcePath || sourceUrl,
    language ? `语言:${language}` : undefined,
    outputFormat ? `格式:${outputFormat}` : undefined,
    speakerLabels,
    timestamps,
    prompt,
  ]);
}

function buildVoiceReplayText(
  parsedCommand: ParsedVoiceWorkbenchCommand,
): string | undefined {
  const targetLanguage = normalizeText(parsedCommand.targetLanguage);
  const voiceStyle = normalizeText(parsedCommand.voiceStyle);
  const prompt = normalizeText(parsedCommand.prompt);

  if (!targetLanguage && !voiceStyle && !prompt) {
    return normalizeText(parsedCommand.body);
  }

  return joinReplayFields([
    targetLanguage ? `目标语言:${targetLanguage}` : undefined,
    voiceStyle ? `风格:${voiceStyle}` : undefined,
    prompt,
  ]);
}

function buildBrowserReplayText(
  parsedCommand: ParsedBrowserWorkbenchCommand,
): string | undefined {
  const launchUrl = normalizeText(parsedCommand.explicitUrl || parsedCommand.launchUrl);
  let prompt = normalizeText(parsedCommand.prompt);

  if (prompt && launchUrl) {
    prompt = trimReplayDecorations(
      prompt.replace(new RegExp(escapeRegExp(launchUrl), "i"), ""),
    );
  }

  if (!launchUrl && !prompt) {
    return normalizeText(parsedCommand.body);
  }

  return joinReplayFields([launchUrl, prompt]);
}

function buildPublishLikeReplayText(
  parsedCommand: Pick<
    | ParsedChannelPreviewWorkbenchCommand
    | ParsedUploadWorkbenchCommand
    | ParsedPublishWorkbenchCommand,
    "body" | "platformLabel" | "prompt"
  >,
): string | undefined {
  const platformLabel = normalizeText(parsedCommand.platformLabel);
  const prompt = normalizeText(parsedCommand.prompt);

  if (!platformLabel && !prompt) {
    return normalizeText(parsedCommand.body);
  }

  return joinReplayFields([
    platformLabel ? `平台:${platformLabel}` : undefined,
    prompt ? `要求:${prompt}` : undefined,
  ]);
}

export function buildMentionCommandReplayText(
  input: BuildMentionCommandReplayTextInput,
): string | undefined {
  if (
    input.commandKey === "image_generate" ||
    input.commandKey === "image_edit" ||
    input.commandKey === "image_variation"
  ) {
    return buildImageReplayText(input.parsedCommand as ParsedImageWorkbenchCommand);
  }

  if (input.commandKey === "poster_generate") {
    return buildPosterReplayText(
      input.parsedCommand as ParsedPosterWorkbenchCommand,
    );
  }

  if (input.commandKey === "cover_generate") {
    return buildCoverReplayText(input.parsedCommand as ParsedCoverWorkbenchCommand);
  }

  if (input.commandKey === "video_generate") {
    return buildVideoReplayText(input.parsedCommand as ParsedVideoWorkbenchCommand);
  }

  if (input.commandKey === "broadcast_generate") {
    return buildBroadcastReplayText(
      input.parsedCommand as ParsedBroadcastWorkbenchCommand,
    );
  }

  if (input.commandKey === "modal_resource_search") {
    return buildResourceSearchReplayText(
      input.parsedCommand as ParsedResourceSearchWorkbenchCommand,
    );
  }

  if (input.commandKey === "research") {
    return buildSearchReplayText(
      input.parsedCommand as ParsedSearchWorkbenchCommand,
    );
  }

  if (input.commandKey === "deep_search") {
    return buildSearchReplayText(
      input.parsedCommand as ParsedDeepSearchWorkbenchCommand,
      "deep",
    );
  }

  if (input.commandKey === "research_report") {
    return buildReportReplayText(
      input.parsedCommand as ParsedReportWorkbenchCommand,
    );
  }

  if (input.commandKey === "competitor_research") {
    return buildReportReplayText(
      input.parsedCommand as ParsedCompetitorWorkbenchCommand,
    );
  }

  if (input.commandKey === "site_search") {
    return buildSiteSearchReplayText(
      input.parsedCommand as ParsedSiteSearchWorkbenchCommand,
    );
  }

  if (input.commandKey === "read_pdf") {
    return buildPdfReplayText(input.parsedCommand as ParsedPdfWorkbenchCommand);
  }

  if (input.commandKey === "typesetting") {
    return buildTypesettingReplayText(
      input.parsedCommand as ParsedTypesettingWorkbenchCommand,
    );
  }

  if (input.commandKey === "presentation_generate") {
    return buildPresentationReplayText(
      input.parsedCommand as ParsedPresentationWorkbenchCommand,
    );
  }

  if (input.commandKey === "form_generate") {
    return buildFormReplayText(input.parsedCommand as ParsedFormWorkbenchCommand);
  }

  if (input.commandKey === "webpage_generate") {
    return buildWebpageReplayText(
      input.parsedCommand as ParsedWebpageWorkbenchCommand,
    );
  }

  if (input.commandKey === "summary") {
    return buildSummaryReplayText(
      input.parsedCommand as ParsedSummaryWorkbenchCommand,
    );
  }

  if (input.commandKey === "translation") {
    return buildTranslationReplayText(
      input.parsedCommand as ParsedTranslationWorkbenchCommand,
    );
  }

  if (input.commandKey === "analysis") {
    return buildAnalysisReplayText(
      input.parsedCommand as ParsedAnalysisWorkbenchCommand,
    );
  }

  if (input.commandKey === "publish_compliance") {
    return buildComplianceReplayText(
      input.parsedCommand as ParsedComplianceWorkbenchCommand,
    );
  }

  if (
    input.commandKey === "url_parse" ||
    input.commandKey === "web_scrape" ||
    input.commandKey === "webpage_read"
  ) {
    return buildUrlParseReplayText(
      input.parsedCommand as ParsedUrlParseWorkbenchCommand,
    );
  }

  if (input.commandKey === "code_runtime") {
    return buildCodeReplayText(input.parsedCommand as ParsedCodeWorkbenchCommand);
  }

  if (input.commandKey === "channel_preview_runtime") {
    return buildPublishLikeReplayText(
      input.parsedCommand as ParsedChannelPreviewWorkbenchCommand,
    );
  }

  if (input.commandKey === "upload_runtime") {
    return buildPublishLikeReplayText(
      input.parsedCommand as ParsedUploadWorkbenchCommand,
    );
  }

  if (input.commandKey === "publish_runtime") {
    return buildPublishLikeReplayText(
      input.parsedCommand as ParsedPublishWorkbenchCommand,
    );
  }

  if (input.commandKey === "transcription_generate") {
    return buildTranscriptionReplayText(
      input.parsedCommand as ParsedTranscriptionWorkbenchCommand,
    );
  }

  if (input.commandKey === "voice_runtime") {
    return buildVoiceReplayText(input.parsedCommand as ParsedVoiceWorkbenchCommand);
  }

  if (input.commandKey === "browser_runtime") {
    return buildBrowserReplayText(
      input.parsedCommand as ParsedBrowserWorkbenchCommand,
    );
  }

  return normalizeText(input.parsedCommand.body);
}
