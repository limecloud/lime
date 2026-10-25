import type { AgentToolCallState as ToolCallState } from "@/lib/api/agentProtocol";
import type { AgentThreadItem } from "../types";


export type ToolProcessStatus =
  | ToolCallState["status"]
  | Extract<AgentThreadItem["status"], "in_progress">;

export type ToolProcessNarrativeSource =
  | "none"
  | "error"
  | "tool_search"
  | "search_results"
  | "site"
  | "vision"
  | "plain_result"
  | "metadata"
  | "generic";

export interface ToolProcessNarrative {
  preSummary: string | null;
  postSummary: string | null;
  summary: string | null;
  postSource: ToolProcessNarrativeSource;
}
