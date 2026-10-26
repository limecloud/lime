import type { AgentToolCallState as ToolCallState } from "@/lib/api/agentProtocol";
import { normalizeSiteToolResultSummary } from "../utils/siteToolResultSummary";
import { normalizeToolSearchResultSummary, resolveUserFacingToolSearchItemLabel } from "../utils/toolSearchResultSummary";
import { resolveRequiredAgentChatCopy } from "../utils/agentChatCopy";
import { extractStructuredToolDetailText, normalizeToolResultDetailText, parseStructuredToolResult } from "../utils/toolResultDetailText";

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function readString(
  record: Record<string, unknown> | null,
  keys: string[],
): string | null {
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

export function readNumber(
  record: Record<string, unknown> | null,
  keys: string[],
): number | null {
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

export function readBoolean(
  record: Record<string, unknown> | null,
  keys: string[],
): boolean | null {
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return null;
}

export function summarizeResultText(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const singleLine = trimmed.replace(/\s+/g, " ");
  if (singleLine.length <= 180) {
    return singleLine;
  }
  return `${singleLine.slice(0, 180).trim()}...`;
}

export const LARGE_RESULT_AUTO_COLLAPSE_CHARS = 1200;

function resolveSiteProjectTargetCopy(params: {
  source?: string;
  projectId?: string;
}): string {
  if (params.source === "context_project") {
    return resolveRequiredAgentChatCopy(
      "toolCall.siteResult.target.currentProject",
    );
  }
  if (params.source === "explicit_project") {
    return resolveRequiredAgentChatCopy(
      "toolCall.siteResult.target.selectedProject",
    );
  }
  if (params.projectId?.trim()) {
    return resolveRequiredAgentChatCopy("toolCall.siteResult.target.project", {
      projectId: params.projectId.trim(),
    });
  }
  return resolveRequiredAgentChatCopy("toolCall.siteResult.target.generic");
}

export function summarizeToolSearchPreview(
  value: ReturnType<typeof normalizeToolSearchResultSummary>,
): string | null {
  if (!value) {
    return null;
  }

  const toolNames = value.tools
    .slice(0, 2)
    .map((item) => resolveUserFacingToolSearchItemLabel(item.name))
    .filter(Boolean);
  const prefix = resolveRequiredAgentChatCopy(
    "toolCall.inline.toolSearchPreview.count",
    { count: value.count },
  );

  if (toolNames.length === 0) {
    return prefix;
  }

  return resolveRequiredAgentChatCopy(
    "toolCall.inline.toolSearchPreview.withTools",
    {
      countLabel: prefix,
      tools: toolNames.join(" "),
    },
  );
}

export function summarizeSearchResultPreview(resultCount: number): string | null {
  if (resultCount <= 0) {
    return null;
  }

  return resolveRequiredAgentChatCopy(
    "toolCall.inline.searchResultPreview.count",
    { count: resultCount },
  );
}

export function summarizeDiagnosticResultPreview(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = parseStructuredToolResult(trimmed);
  const record = asRecord(parsed);
  const webSearchMetadata = asRecord(record?.metadata)?.web_search;
  const webSearchRecord = asRecord(webSearchMetadata);
  const attempts = Array.isArray(webSearchRecord?.attempts)
    ? webSearchRecord.attempts
    : [];
  const firstAttempt = asRecord(attempts[0]);
  const firstAttemptError = readString(firstAttempt, ["error", "message"]);

  if (firstAttemptError) {
    return resolveRequiredAgentChatCopy(
      "toolCall.inline.searchDiagnostic.withMessage",
      { message: summarizeResultText(firstAttemptError) },
    );
  }

  const message =
    readString(record, ["error", "message", "detail", "output"]) ||
    extractStructuredToolDetailText(parsed);

  return message
    ? resolveRequiredAgentChatCopy(
        "toolCall.inline.searchDiagnostic.withMessage",
        { message: summarizeResultText(message) },
      )
    : resolveRequiredAgentChatCopy("toolCall.inline.searchDiagnostic.collapsed");
}

export function resolveWebFetchResultText(params: {
  rawResultText: string;
  fallbackSummary?: string | null;
}): string {
  const parsed = parseStructuredToolResult(params.rawResultText);
  const parsedRecord = asRecord(parsed);
  const directResult =
    readString(parsedRecord, [
      "markdown",
      "markdownContent",
      "markdown_content",
      "content",
      "text",
      "body",
      "summary",
      "result",
      "output",
    ]) ||
    extractStructuredToolDetailText(parsed);

  return (
    directResult?.trim() ||
    params.fallbackSummary?.trim() ||
    normalizeToolResultDetailText(params.rawResultText)
  );
}

export function normalizeSummaryLine(
  value: string | null,
  headline: string,
): string | null {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }

  const normalizedHeadline = headline.trim();
  if (normalized === normalizedHeadline) {
    return null;
  }

  return normalized;
}

export function buildSiteNoticeLines(toolCall: ToolCallState): string[] {
  const summary = normalizeSiteToolResultSummary(toolCall.result?.metadata);
  if (!summary) {
    return [];
  }

  const lines: string[] = [];
  const savedProjectId =
    summary.savedProjectId || summary.savedContent?.projectId || "";
  const savedProjectTarget = resolveSiteProjectTargetCopy({
    source: summary.savedBy,
    projectId: savedProjectId || undefined,
  });

  if (summary.savedContent?.title) {
    lines.push(
      resolveRequiredAgentChatCopy("toolCall.siteResult.saved", {
        target: savedProjectTarget,
        title: summary.savedContent.title,
      }),
    );
  }

  if (summary.savedContent?.markdownRelativePath) {
    lines.push(
      resolveRequiredAgentChatCopy("toolCall.siteResult.markdownExported"),
    );
  }

  if (typeof summary.savedContent?.imageCount === "number") {
    lines.push(
      resolveRequiredAgentChatCopy("toolCall.siteResult.images", {
        count: summary.savedContent.imageCount,
      }),
    );
  }

  if (summary.saveSkippedProjectId) {
    const skippedProjectTarget = resolveSiteProjectTargetCopy({
      source: summary.saveSkippedBy,
      projectId: summary.saveSkippedProjectId,
    });
    lines.push(
      resolveRequiredAgentChatCopy("toolCall.siteResult.saveSkipped", {
        target: skippedProjectTarget,
      }),
    );
  }

  if (summary.saveErrorMessage) {
    lines.push(
      resolveRequiredAgentChatCopy("toolCall.siteResult.saveError", {
        message: summary.saveErrorMessage,
      }),
    );
  }

  return lines;
}
