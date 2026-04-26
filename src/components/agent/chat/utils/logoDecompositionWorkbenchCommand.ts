import {
  parseAnalysisWorkbenchCommand,
  type ParsedAnalysisWorkbenchCommand,
} from "./analysisWorkbenchCommand";

export type LogoDecompositionWorkbenchCommandTrigger =
  | "@Logo拆解"
  | "@Image Logo Decomposition";

export interface ParsedLogoDecompositionWorkbenchCommand
  extends Omit<ParsedAnalysisWorkbenchCommand, "trigger"> {
  trigger: LogoDecompositionWorkbenchCommandTrigger;
  analysisMode: "image_logo_decomposition";
}

const DEFAULT_LOGO_DECOMPOSITION_PROMPT =
  "请拆解这张图片或 Logo 的构图、元素、配色、字体与可复用视觉结构";

const LOGO_DECOMPOSITION_COMMAND_PREFIX_REGEX =
  /^\s*(@Logo拆解|@Image Logo Decomposition)(?:\s+|$)([\s\S]*)$/i;

function normalizeTrigger(
  value: string,
): LogoDecompositionWorkbenchCommandTrigger {
  const normalized = value.trim().toLowerCase();
  if (normalized === "@image logo decomposition") {
    return "@Image Logo Decomposition";
  }
  return "@Logo拆解";
}

export function parseLogoDecompositionWorkbenchCommand(
  text: string,
): ParsedLogoDecompositionWorkbenchCommand | null {
  const matched = text.match(LOGO_DECOMPOSITION_COMMAND_PREFIX_REGEX);
  if (!matched) {
    return null;
  }

  const body = (matched[2] || "").trim();
  const delegatedAnalysisCommand = parseAnalysisWorkbenchCommand(`@分析 ${body}`);

  return {
    rawText: text,
    trigger: normalizeTrigger(matched[1] || ""),
    body,
    prompt:
      delegatedAnalysisCommand?.prompt.trim() || DEFAULT_LOGO_DECOMPOSITION_PROMPT,
    content: delegatedAnalysisCommand?.content,
    focus: delegatedAnalysisCommand?.focus,
    style: delegatedAnalysisCommand?.style,
    outputFormat: delegatedAnalysisCommand?.outputFormat,
    analysisMode: "image_logo_decomposition",
  };
}
