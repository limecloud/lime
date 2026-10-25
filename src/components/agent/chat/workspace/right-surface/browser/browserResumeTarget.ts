import type { AgentThreadItem } from "@/lib/api/agentProtocol";
import { browserResumeUrl } from "./browserPresentation";

/** Replay contributes a navigation hint, never a native tab or permission identity. */
export function readBrowserResumeTarget(
  items: readonly AgentThreadItem[],
  threadId: string | null,
): string | null {
  for (const item of [...items].reverse()) {
    if (
      item.thread_id !== threadId ||
      item.type !== "tool_call" ||
      item.status !== "completed" ||
      item.success === false
    )
      continue;
    const metadata = record(item.metadata);
    if (
      metadata?.namespace !== "browser" ||
      !["markDeliverable", "markHandoff"].includes(item.tool_name)
    )
      continue;
    let output: unknown = item.structuredContent ?? item.structured_content;
    if (!output && item.output) {
      try {
        output = JSON.parse(item.output);
      } catch {
        continue;
      }
    }
    const result = record(output);
    const state = record(result?.state) ?? record(result?.tab);
    if (result?.status !== "completed" || state?.threadId !== threadId)
      continue;
    const url = browserResumeUrl(state.url);
    if (url) return url;
  }
  return null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
