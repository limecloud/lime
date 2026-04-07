import {
  parseSearchWorkbenchCommand,
  type ParsedSearchWorkbenchCommand,
} from "./searchWorkbenchCommand";

export type DeepSearchWorkbenchCommandTrigger =
  | "@深搜"
  | "@deep"
  | "@deepsearch";

export interface ParsedDeepSearchWorkbenchCommand extends Omit<
  ParsedSearchWorkbenchCommand,
  "trigger" | "depth"
> {
  trigger: DeepSearchWorkbenchCommandTrigger;
  depth: "deep";
}

const DEEP_SEARCH_COMMAND_PREFIX_REGEX =
  /^\s*(@深搜|@deep|@deepsearch)(?:\s+|$)([\s\S]*)$/i;

function normalizeTrigger(value: string): DeepSearchWorkbenchCommandTrigger {
  const normalized = value.trim().toLowerCase();
  if (normalized === "@deep") {
    return "@deep";
  }
  if (normalized === "@deepsearch") {
    return "@deepsearch";
  }
  return "@深搜";
}

export function parseDeepSearchWorkbenchCommand(
  text: string,
): ParsedDeepSearchWorkbenchCommand | null {
  const matched = text.match(DEEP_SEARCH_COMMAND_PREFIX_REGEX);
  if (!matched) {
    return null;
  }

  const body = (matched[2] || "").trim();
  const parsed = parseSearchWorkbenchCommand(`@搜索 ${body}`);
  if (!parsed) {
    return null;
  }

  return {
    ...parsed,
    rawText: text,
    trigger: normalizeTrigger(matched[1] || ""),
    body,
    depth: "deep",
  };
}
