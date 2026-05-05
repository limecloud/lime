import { hasMeaningfulSiteToolResultSignal } from "../utils/siteToolResultSummary";
import {
  buildImageTaskPreviewFromToolResult,
  buildTaskPreviewFromToolResult,
  buildToolResultArtifactFromToolResult,
} from "../utils/taskPreviewFromToolResult";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

export function hasMeaningfulAgentStreamToolCompletionSignal(params: {
  toolId: string;
  toolName: string;
  normalizedResult:
    | {
        metadata?: unknown;
      }
    | undefined;
}): boolean {
  const resultRecord = asRecord(params.normalizedResult);
  if (hasMeaningfulSiteToolResultSignal(resultRecord?.metadata)) {
    return true;
  }

  const previewParams = {
    toolId: params.toolId,
    toolName: params.toolName,
    toolArguments: undefined,
    toolResult: resultRecord,
    fallbackPrompt: "",
  };

  return Boolean(
    buildImageTaskPreviewFromToolResult(previewParams) ||
      buildTaskPreviewFromToolResult(previewParams) ||
      buildToolResultArtifactFromToolResult(previewParams),
  );
}
