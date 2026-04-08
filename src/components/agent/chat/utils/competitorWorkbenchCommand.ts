import {
  parseReportWorkbenchCommand,
  type ParsedReportWorkbenchCommand,
} from "./reportWorkbenchCommand";

export type CompetitorWorkbenchCommandTrigger =
  | "@竞品"
  | "@competitor"
  | "@competitive";

export interface ParsedCompetitorWorkbenchCommand
  extends Omit<ParsedReportWorkbenchCommand, "trigger" | "focus" | "outputFormat"> {
  trigger: CompetitorWorkbenchCommandTrigger;
  focus: string;
  outputFormat: string;
}

export const DEFAULT_COMPETITOR_FOCUS =
  "产品定位、目标用户、核心功能、定价模式、渠道策略、差异化优劣势";
export const DEFAULT_COMPETITOR_OUTPUT_FORMAT = "竞品分析";

const COMPETITOR_COMMAND_PREFIX_REGEX =
  /^\s*(@竞品|@competitor|@competitive)(?:\s+|$)([\s\S]*)$/i;
const EXPLICIT_OUTPUT_FORMAT_REGEX =
  /(?:输出|格式|output|format)\s*[:：=]\s*/i;

function normalizeTrigger(value: string): CompetitorWorkbenchCommandTrigger {
  const normalized = value.trim().toLowerCase();
  if (normalized === "@competitor") {
    return "@competitor";
  }
  if (normalized === "@competitive") {
    return "@competitive";
  }
  return "@竞品";
}

export function parseCompetitorWorkbenchCommand(
  text: string,
): ParsedCompetitorWorkbenchCommand | null {
  const matched = text.match(COMPETITOR_COMMAND_PREFIX_REGEX);
  if (!matched) {
    return null;
  }

  const body = (matched[2] || "").trim();
  const parsed = parseReportWorkbenchCommand(`@研报 ${body}`);
  if (!parsed) {
    return null;
  }
  const hasExplicitOutputFormat = EXPLICIT_OUTPUT_FORMAT_REGEX.test(body);

  return {
    ...parsed,
    rawText: text,
    trigger: normalizeTrigger(matched[1] || ""),
    body,
    focus: parsed.focus || DEFAULT_COMPETITOR_FOCUS,
    outputFormat: hasExplicitOutputFormat
      ? parsed.outputFormat || DEFAULT_COMPETITOR_OUTPUT_FORMAT
      : DEFAULT_COMPETITOR_OUTPUT_FORMAT,
  };
}
