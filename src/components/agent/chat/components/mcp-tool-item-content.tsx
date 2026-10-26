import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AgentToolCallState } from "@/lib/api/agentProtocol";
import { cn } from "@/lib/utils";
import {
  buildToolHeadline,
  getToolDisplayInfo,
  humanizeToolName,
  parseToolCallArguments,
  resolveToolFilePath,
  resolveToolPrimarySubject,
} from "../utils/toolDisplayInfo";
import { normalizeToolResultImages } from "../hooks/agentChatToolResult";
import { resolveToolResultStructuredContent } from "../utils/toolResultDetailText";
import { shouldHideProtocolToolResultEnvelope } from "../utils/toolResultEnvelopeDisplay";
import { isMcpToolCall } from "../utils/toolNameFamily";
import { AgentActivityItemRow } from "./agent-activity-item-row";

function formatPayload(value: unknown): string {
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return value == null ? "" : JSON.stringify(value, null, 2);
}

// Desktop mcp-tool-item-content presentation adapted to Lime's canonical tool result.
// No private minified symbol is treated as an upstream source name.
export function McpToolItemContent({
  toolCall,
  defaultExpanded = false,
}: {
  toolCall: AgentToolCallState;
  defaultExpanded?: boolean;
}) {
  const { t } = useTranslation("agent");
  const [expanded, setExpanded] = useState(defaultExpanded);
  const args = parseToolCallArguments(toolCall.arguments);
  const display = getToolDisplayInfo(
    toolCall.name,
    toolCall.status,
    toolCall.metadata,
  );
  const Icon = display.icon;
  const server =
    isMcpToolCall(toolCall) && typeof toolCall.metadata?.server === "string"
      ? toolCall.metadata.server
      : null;
  const headline = server
    ? `${server} / ${humanizeToolName(toolCall.name)}`
    : buildToolHeadline({
        toolDisplay: display,
        toolName: toolCall.name,
        subject: resolveToolPrimarySubject(
          toolCall.name,
          args,
          resolveToolFilePath(args),
          toolCall.metadata,
        ),
      });
  const result = toolCall.result;
  const structured = resolveToolResultStructuredContent(result);
  const output = result?.error || result?.output || "";
  const structuredText = formatPayload(structured);
  const outputText =
    !result?.error &&
    shouldHideProtocolToolResultEnvelope({
      toolName: toolCall.name,
      rawResultText: output,
      structuredContent: structured,
    })
      ? ""
      : formatPayload(output);
  const images =
    normalizeToolResultImages(result?.images, output, result?.metadata) ?? [];
  const failed = toolCall.status === "failed" || result?.success === false;
  const blockClassName =
    "max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[color:var(--lime-surface-muted)] p-3 font-mono text-xs leading-5";

  return (
    <div
      data-testid="tool-call-row"
      data-tool-call-id={toolCall.id}
      data-tool-name={toolCall.name}
      data-mcp-server={server ?? undefined}
      data-tool-status={toolCall.status}
    >
      <AgentActivityItemRow
        expanded={expanded}
        onToggle={() => setExpanded((current) => !current)}
        icon={
          toolCall.status === "running" ? (
            <Loader2
              aria-hidden="true"
              className="h-3.5 w-3.5 shrink-0 animate-spin"
            />
          ) : (
            <Icon
              aria-hidden="true"
              className={cn(
                "h-3.5 w-3.5 shrink-0",
                failed && "text-[color:var(--lime-danger)]",
              )}
            />
          )
        }
        summary={headline}
      >
        <div
          className="space-y-3 pl-5 text-[color:var(--lime-text-strong)]"
          data-testid="tool-call-content"
        >
          {toolCall.arguments ? (
            <section aria-label={t("agentChat.toolCall.input")}>
              <div className="mb-1 text-xs text-[color:var(--lime-text-muted)]">
                {t("agentChat.toolCall.input")}
              </div>
              <pre className={blockClassName}>
                {formatPayload(toolCall.arguments)}
              </pre>
            </section>
          ) : null}
          {result ? (
            <section aria-label={t("agentChat.toolCall.output")}>
              <div className="mb-1 text-xs text-[color:var(--lime-text-muted)]">
                {t("agentChat.toolCall.output")}
              </div>
              {outputText ? (
                <pre
                  className={cn(
                    blockClassName,
                    failed && "text-[color:var(--lime-danger)]",
                  )}
                >
                  {outputText}
                </pre>
              ) : null}
              {structuredText && structuredText !== outputText ? (
                <pre className={cn(blockClassName, "mt-2")}>
                  {structuredText}
                </pre>
              ) : null}
              {!outputText && !structuredText && images.length === 0 ? (
                <p className="text-sm text-[color:var(--lime-text-muted)]">
                  {t("agentChat.toolCall.result.empty")}
                </p>
              ) : null}
              {images.map((image) => (
                <img
                  key={image.src}
                  src={image.src}
                  alt={t("agentChat.toolCall.resultImage.alt")}
                  className="mt-2 max-h-96 max-w-full rounded-lg object-contain"
                />
              ))}
            </section>
          ) : null}
          {toolCall.progress?.message ? (
            <p
              role="status"
              className="text-xs text-[color:var(--lime-text-muted)]"
            >
              {toolCall.progress.message}
            </p>
          ) : null}
        </div>
      </AgentActivityItemRow>
    </div>
  );
}
