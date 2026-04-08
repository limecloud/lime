import {
  extractExplicitUrlFromText,
  resolveBrowserAssistLaunchUrl,
} from "./browserAssistIntent";
import { detectBrowserTaskRequirement } from "./browserTaskRequirement";

export type BrowserWorkbenchCommandTrigger =
  | "@浏览器"
  | "@browser"
  | "@browse";

export interface ParsedBrowserWorkbenchCommand {
  rawText: string;
  trigger: BrowserWorkbenchCommandTrigger;
  body: string;
  prompt: string;
  launchUrl: string;
  browserRequirement: "required" | "required_with_user_step";
  browserRequirementReason: string;
  explicitUrl?: string;
}

const BROWSER_COMMAND_PREFIX_REGEX =
  /^\s*(@浏览器|@browser|@browse)(?:\s+|$)([\s\S]*)$/i;
const PROMPT_PREFIX_REGEX =
  /^\s*(帮我|给我|请|打开|访问|进入|前往|去|导航到|open|visit|navigate)(?:\s|$|[:：])*/i;

function trimDecorations(value: string): string {
  return value.replace(/^[,\s，。；;:：]+|[,\s，。；;:：]+$/g, "").trim();
}

function normalizeTrigger(value: string): BrowserWorkbenchCommandTrigger {
  const normalized = value.trim().toLowerCase();
  if (normalized === "@browser") {
    return "@browser";
  }
  if (normalized === "@browse") {
    return "@browse";
  }
  return "@浏览器";
}

function stripPromptDecorations(body: string): string {
  return trimDecorations(
    body.replace(PROMPT_PREFIX_REGEX, "").replace(/\s+/g, " "),
  );
}

export function parseBrowserWorkbenchCommand(
  text: string,
): ParsedBrowserWorkbenchCommand | null {
  const matched = text.match(BROWSER_COMMAND_PREFIX_REGEX);
  if (!matched) {
    return null;
  }

  const body = (matched[2] || "").trim();
  const prompt = stripPromptDecorations(body) || body;
  const requirementMatch = detectBrowserTaskRequirement(body || text);
  const explicitUrl = extractExplicitUrlFromText(body) || undefined;

  return {
    rawText: text,
    trigger: normalizeTrigger(matched[1] || ""),
    body,
    prompt,
    explicitUrl,
    launchUrl:
      requirementMatch?.launchUrl ||
      resolveBrowserAssistLaunchUrl(prompt || body || text),
    browserRequirement:
      requirementMatch?.requirement === "required_with_user_step"
        ? "required_with_user_step"
        : "required",
    browserRequirementReason:
      requirementMatch?.reason ||
      "当前命令显式要求使用真实浏览器执行，请优先走 Lime 浏览器运行时，而不是退回 WebSearch 或普通聊天。",
  };
}
