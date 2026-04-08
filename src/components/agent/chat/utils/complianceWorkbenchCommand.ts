import { parseAnalysisWorkbenchCommand } from "./analysisWorkbenchCommand";

export type ComplianceWorkbenchCommandTrigger =
  | "@发布合规"
  | "@合规"
  | "@compliance";

export interface ParsedComplianceWorkbenchCommand {
  rawText: string;
  trigger: ComplianceWorkbenchCommandTrigger;
  body: string;
  prompt: string;
  content?: string;
  focus?: string;
  style?: string;
  outputFormat?: string;
}

const COMPLIANCE_COMMAND_PREFIX_REGEX =
  /^\s*(@发布合规|@合规|@compliance)(?:\s+|$)([\s\S]*)$/i;

const DEFAULT_FOCUS = "广告法、版权、平台发布风险";
const DEFAULT_STYLE = "合规审校";
const DEFAULT_OUTPUT_FORMAT = "风险等级、风险点、修改建议、待确认项";
const DEFAULT_PROMPT = "请检查当前对话中最相关内容的发布合规风险";

function normalizeTrigger(value: string): ComplianceWorkbenchCommandTrigger {
  const normalized = value.trim().toLowerCase();
  if (normalized === "@compliance") {
    return "@compliance";
  }
  if (normalized === "@合规") {
    return "@合规";
  }
  return "@发布合规";
}

export function parseComplianceWorkbenchCommand(
  text: string,
): ParsedComplianceWorkbenchCommand | null {
  const matched = text.match(COMPLIANCE_COMMAND_PREFIX_REGEX);
  if (!matched) {
    return null;
  }

  const body = (matched[2] || "").trim();
  const analysisResult = parseAnalysisWorkbenchCommand(`@分析 ${body}`);

  return {
    rawText: text,
    trigger: normalizeTrigger(matched[1] || ""),
    body,
    prompt: analysisResult?.prompt?.trim() || body || DEFAULT_PROMPT,
    content: analysisResult?.content,
    focus: analysisResult?.focus || DEFAULT_FOCUS,
    style: analysisResult?.style || DEFAULT_STYLE,
    outputFormat: analysisResult?.outputFormat || DEFAULT_OUTPUT_FORMAT,
  };
}
