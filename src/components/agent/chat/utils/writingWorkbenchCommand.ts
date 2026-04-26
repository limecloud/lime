import {
  parseContentPostPlatform,
  stripContentPostPromptDecorations,
  type ContentPostPlatformType,
} from "./contentPostPlatform";

export type WritingWorkbenchCommandTrigger =
  | "@写作"
  | "@文案"
  | "@write"
  | "@Writing Partner"
  | "@Writers 1"
  | "@Blog 1"
  | "@Newsletters Pro"
  | "@Web Copy";

export type WritingDraftKind = "general" | "blog" | "newsletter";

export interface ParsedWritingWorkbenchCommand {
  rawText: string;
  trigger: WritingWorkbenchCommandTrigger;
  body: string;
  prompt: string;
  dispatchBody: string;
  draftKind: WritingDraftKind;
  platformType?: ContentPostPlatformType;
  platformLabel?: string;
}

const WRITING_COMMAND_PREFIX_REGEX =
  /^\s*(@Newsletters Pro|@Writing Partner|@Writers 1|@Blog 1|@Web Copy|@写作|@文案|@write)(?:\s+|$)([\s\S]*)$/i;

function normalizeTrigger(value: string): WritingWorkbenchCommandTrigger {
  const normalized = value.trim().toLowerCase();
  if (normalized === "@writing partner") {
    return "@Writing Partner";
  }
  if (normalized === "@writers 1") {
    return "@Writers 1";
  }
  if (normalized === "@blog 1") {
    return "@Blog 1";
  }
  if (normalized === "@newsletters pro") {
    return "@Newsletters Pro";
  }
  if (normalized === "@web copy") {
    return "@Web Copy";
  }
  if (normalized === "@文案") {
    return "@文案";
  }
  if (normalized === "@write") {
    return "@write";
  }
  return "@写作";
}

function resolveDraftKind(
  trigger: WritingWorkbenchCommandTrigger,
): WritingDraftKind {
  switch (trigger) {
    case "@Blog 1":
      return "blog";
    case "@Newsletters Pro":
      return "newsletter";
    default:
      return "general";
  }
}

function buildDispatchBody(input: {
  prompt: string;
  draftKind: WritingDraftKind;
  platformLabel?: string;
}): string {
  const platformPrefix = input.platformLabel
    ? `平台:${input.platformLabel}`
    : undefined;
  const writingInstruction =
    input.draftKind === "newsletter"
      ? input.platformLabel
        ? `请基于当前内容生成一版适用于${input.platformLabel}的 Newsletter / 简报主稿，优先输出标题、开场摘要、分节要点和结尾行动建议`
        : "请基于当前内容生成一版 Newsletter / 简报主稿，优先输出标题、开场摘要、分节要点和结尾行动建议"
      : input.draftKind === "blog"
        ? input.platformLabel
          ? `请基于当前内容生成一篇适用于${input.platformLabel}发布的 Blog 文章主稿，优先输出标题、导语、小标题结构、正文和结尾行动建议`
          : "请基于当前内容生成一篇 Blog 文章主稿，优先输出标题、导语、小标题结构、正文和结尾行动建议"
        : input.platformLabel
          ? `请基于当前内容生成一版适用于${input.platformLabel}的写作主稿，优先输出标题、结构、正文和结尾行动建议`
          : "请基于当前内容生成一版可继续修改的写作主稿，优先输出标题、结构、正文和结尾行动建议";

  return [platformPrefix, writingInstruction, input.prompt.trim() || undefined]
    .filter(Boolean)
    .join(" ")
    .trim();
}

export function parseWritingWorkbenchCommand(
  text: string,
): ParsedWritingWorkbenchCommand | null {
  const matched = text.match(WRITING_COMMAND_PREFIX_REGEX);
  if (!matched) {
    return null;
  }

  const body = (matched[2] || "").trim();
  const trigger = normalizeTrigger(matched[1] || "");
  const draftKind = resolveDraftKind(trigger);
  const {
    platformType,
    platformLabel,
    explicitPlatformText,
    leadingPlatformText,
  } = parseContentPostPlatform(body);
  const prompt = stripContentPostPromptDecorations(
    body,
    explicitPlatformText || leadingPlatformText,
  );

  return {
    rawText: text,
    trigger,
    body,
    prompt: prompt || body,
    dispatchBody: buildDispatchBody({
      prompt: prompt || body,
      draftKind,
      platformLabel,
    }),
    draftKind,
    platformType,
    platformLabel,
  };
}
