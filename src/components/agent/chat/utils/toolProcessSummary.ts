import type { AgentToolCallState as ToolCallState } from "@/lib/api/agentProtocol";
import type { AgentThreadItem } from "../types";
import { resolveRequiredAgentChatCopy } from "./agentChatCopy";
import {
  buildBrowserPostSummary,
  buildFetchSearchFailureSummary,
  buildGenericPostSummary,
  buildGenericPreSummary,
  buildSitePostSummary,
  buildToolSearchPostSummary,
  buildVisionToolSummary,
  buildWebSearchPostSummary,
  normalizeNarrativeSubject,
} from "./toolProcessSummaryBuilders";
import type {
  ToolProcessNarrative,
  ToolProcessNarrativeSource,
  ToolProcessStatus,
} from "./toolProcessSummaryTypes";
import {
  asRecord,
  isLikelyWebRetrievalDiagnosticNoise,
  normalizeArgumentsRecord,
  normalizePlainResultLine,
  resolveToolErrorSummaryText,
  resolveToolSubject,
} from "./toolProcessSummaryText";
import {
  isLimeTaskProtocolFailure,
  resolveLimeTaskProtocolFailureDisplayText,
} from "./limeTaskProtocolNoise";
import { resolveImageTaskToolResultSummary } from "./imageTaskToolResult";
import {
  resolveToolProcessFactsFamily,
  resolveToolProcessFactsSubject,
  resolveToolProcessSummaryMetadata,
} from "./toolProcessSummaryMetadata";
import {
  getToolDisplayInfo,
  isBrowserToolName,
  normalizeToolNameKey,
} from "./toolDisplayInfo";
import { isUnifiedWebSearchToolName } from "./searchResultPreview";

import { resolveToolDisplayName } from "./toolDisplayName";

export type {
  ToolProcessNarrative,
  ToolProcessNarrativeSource,
  ToolProcessStatus,
} from "./toolProcessSummaryTypes";

export {
  isLikelyWebRetrievalDiagnosticNoise,
  resolveToolErrorDetailText,
  resolveToolErrorSummaryText,
} from "./toolProcessSummaryText";

interface ToolProcessInput {
  toolName: string;
  argumentsValue?: string | Record<string, unknown>;
  status: ToolProcessStatus;
  output?: string;
  error?: string;
  metadata?: unknown;
}

function normalizeMetadataRecord(
  value: unknown,
): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function mergeMetadata(base: unknown, override: unknown): unknown {
  const baseRecord = normalizeMetadataRecord(base);
  const overrideRecord = normalizeMetadataRecord(override);
  if (baseRecord && overrideRecord) {
    return {
      ...baseRecord,
      ...overrideRecord,
    };
  }
  return overrideRecord ?? baseRecord ?? override ?? base;
}

function buildNarrative(input: ToolProcessInput): ToolProcessNarrative {
  input = {
    ...input,
    toolName: resolveToolDisplayName(input.toolName, input.metadata),
  };
  const metadataSummary = resolveToolProcessSummaryMetadata(
    input.metadata,
    input.status,
  );
  const factsSubject = resolveToolProcessFactsSubject(input.metadata);
  const factsFamily = resolveToolProcessFactsFamily(input.metadata);
  const preSummary =
    metadataSummary?.preSummary ??
    buildGenericPreSummary({
      toolName: input.toolName,
      argumentsValue: input.argumentsValue,
      metadata: input.metadata,
      factsSubject,
      factsFamily,
    });
  const normalizedName = normalizeToolNameKey(input.toolName);
  const display = getToolDisplayInfo(
    input.toolName,
    input.status === "in_progress" ? "running" : input.status,
  );
  const displayFamily = factsFamily || display.family;
  const resultOutput = input.output || "";
  const plainError = resolveToolErrorSummaryText(
    input.toolName,
    input.error,
    88,
  );
  const plainOutput = normalizePlainResultLine(resultOutput, 96);
  const failedOutputSummary =
    input.status === "failed"
      ? resolveToolErrorSummaryText(input.toolName, resultOutput, 96) ||
        plainOutput
      : plainOutput;
  const limeTaskFailureSummary =
    input.status === "failed" &&
    isLimeTaskProtocolFailure({
      toolName: input.toolName,
      text: input.error || resultOutput,
    })
      ? resolveLimeTaskProtocolFailureDisplayText({
          toolName: input.toolName,
          text: input.error || resultOutput,
        })
      : null;
  const args = normalizeArgumentsRecord(input.argumentsValue);
  const metadata = asRecord(input.metadata);
  const subject =
    factsSubject || resolveToolSubject(input.toolName, input.argumentsValue);

  let postSummary: string | null = metadataSummary?.postSummary ?? null;
  let postSource: ToolProcessNarrativeSource =
    metadataSummary?.postSource ?? "none";

  if (!postSummary && input.status === "failed") {
    if (limeTaskFailureSummary) {
      postSummary = limeTaskFailureSummary;
      postSource = "error";
    } else if (displayFamily === "fetch" || displayFamily === "search") {
      postSummary = buildFetchSearchFailureSummary(displayFamily);
      postSource = "error";
    } else {
      postSummary =
        plainError ||
        (failedOutputSummary
          ? resolveRequiredAgentChatCopy(
              "toolCall.processSummary.error.failed",
              { message: failedOutputSummary },
            )
          : null);
    }
    if (postSummary && !limeTaskFailureSummary) {
      if (displayFamily !== "fetch" && displayFamily !== "search") {
        const failurePrefix = resolveRequiredAgentChatCopy(
          "toolCall.processSummary.error.failedPrefix",
        );
        if (!postSummary.startsWith(failurePrefix)) {
          postSummary = resolveRequiredAgentChatCopy(
            "toolCall.processSummary.error.failed",
            { message: postSummary },
          );
        }
      }
      postSource = "error";
    }
  }

  if (
    !postSummary &&
    (displayFamily === "fetch" || displayFamily === "search") &&
    resultOutput &&
    isLikelyWebRetrievalDiagnosticNoise(resultOutput)
  ) {
    postSummary = buildFetchSearchFailureSummary(displayFamily);
    postSource = "error";
  }

  if (!postSummary) {
    const imageTaskSummary = resolveImageTaskToolResultSummary({
      toolName: input.toolName,
      output: input.output,
      metadata: input.metadata,
    });
    if (imageTaskSummary) {
      postSummary = imageTaskSummary;
      postSource = "generic";
    }
  }

  if (!postSummary) {
    const siteSummary = buildSitePostSummary(input.metadata);
    if (siteSummary) {
      postSummary = siteSummary;
      postSource = "site";
    }
  }

  if (!postSummary && normalizedName === "toolsearch") {
    const toolSearchSummary = buildToolSearchPostSummary(resultOutput);
    if (toolSearchSummary) {
      postSummary = toolSearchSummary;
      postSource = "tool_search";
    }
  }

  if (!postSummary && isUnifiedWebSearchToolName(input.toolName)) {
    const searchSummary = buildWebSearchPostSummary(resultOutput);
    if (searchSummary) {
      postSummary = searchSummary;
      postSource = "search_results";
    }
  }

  if (
    !postSummary &&
    (displayFamily === "browser" ||
      (!factsFamily && isBrowserToolName(normalizedName)))
  ) {
    postSummary = buildBrowserPostSummary(normalizedName, args, metadata);
    postSource = postSummary ? "generic" : "none";
  }

  if (!postSummary && displayFamily === "vision") {
    const visionSummary = buildVisionToolSummary(
      "post",
      normalizedName,
      normalizeNarrativeSubject(subject),
    );
    if (visionSummary) {
      postSummary = visionSummary;
      postSource = "vision";
    }
  }

  if (!postSummary && plainOutput) {
    postSummary = plainOutput;
    postSource = "plain_result";
  }

  if (!postSummary) {
    postSummary = buildGenericPostSummary({
      toolName: input.toolName,
      status: input.status,
      subject,
      factsFamily,
    });
    postSource = postSummary ? "generic" : "none";
  }

  const resolvedPreSummary =
    input.status !== "running" &&
    input.status !== "in_progress" &&
    normalizedName === "updateplan"
      ? postSummary || preSummary
      : preSummary;
  const summary =
    input.status === "running" || input.status === "in_progress"
      ? resolvedPreSummary
      : postSummary || resolvedPreSummary;

  return {
    preSummary: resolvedPreSummary,
    postSummary,
    summary,
    postSource,

  };
}

export function resolveToolProcessNarrative(
  toolCall: ToolCallState,
): ToolProcessNarrative {
  return buildNarrative({
    toolName: toolCall.name,
    argumentsValue: toolCall.arguments,
    status: toolCall.status,
    output: toolCall.result?.output,
    error: toolCall.result?.error,
    metadata: mergeMetadata(toolCall.result?.metadata, toolCall.metadata),
  });
}

function readThreadItemMetadata(item: AgentThreadItem): unknown {
  return "metadata" in item ? item.metadata : undefined;
}

export function resolveAgentThreadToolProcessNarrative(
  item: AgentThreadItem,
): ToolProcessNarrative | null {
  if (item.type === "tool_call") {
    return buildNarrative({
      toolName: item.tool_name,
      argumentsValue: asRecord(item.arguments) || undefined,
      status: item.status,
      output: item.output,
      error: item.error,
      metadata: item.metadata,
    });
  }

  if (item.type === "command_execution") {
    return buildNarrative({
      toolName: "exec_command",
      argumentsValue: {
        command: item.command,
        cwd: item.cwd,
      },
      status: item.status,
      output: item.aggregated_output,
      error: item.error,
      metadata: mergeMetadata(
        item.exit_code !== undefined
          ? {
              exit_code: item.exit_code,
              cwd: item.cwd,
            }
          : { cwd: item.cwd },
        readThreadItemMetadata(item),
      ),
    });
  }

  if (item.type === "web_search") {
    return buildNarrative({
      toolName: "web_search",
      argumentsValue: item.query
        ? { action: item.action || "web_search", query: item.query }
        : { action: item.action || "web_search" },
      status: item.status,
      output: item.output,
      metadata: readThreadItemMetadata(item),
    });
  }

  return null;
}

export function resolveAgentThreadToolProcessPreview(
  item: AgentThreadItem,
): string | null {
  const narrative = resolveAgentThreadToolProcessNarrative(item);
  if (!narrative) {
    return null;
  }

  if (item.status !== "completed") {
    return narrative.summary;
  }

  return narrative.postSource !== "generic" ? narrative.summary : null;
}
