import type { AgentToolCallState as ToolCallState } from "@/lib/api/agentProtocol";
import type { AgentThreadItem } from "../types";
import type { ToolCallArgumentValue } from "./toolDisplayInfo";


export type ToolBatchKind = "exploration" | "browser" | "web_search";

export interface ToolBatchSummaryDescriptor
  {
  kind: ToolBatchKind;
  title: string;
  supportingLines: string[];
  supportingSections?: ToolBatchSummarySection[];
  countLabel: string;
  rawDetailLabel: string;
  hasRunning?: boolean;
}

export type ToolBatchSummarySectionKind =
  | "web_search_sources"
  | "web_fetch_pages";

export interface ToolBatchSummarySection {
  kind: ToolBatchSummarySectionKind;
  lines: string[];
}

export type ToolOperationKind =
  | "read"
  | "search"
  | "web_search"
  | "web_fetch"
  | "list"
  | "browser"
  | "mutation"
  | "absorbed"
  | "other";

export type ToolLikeStatus =
  | ToolCallState["status"]
  | AgentThreadItem["status"]
  | null
  | undefined;

export interface ToolLikeDescriptor {
  toolName: string;
  argumentsValue?: string | Record<string, ToolCallArgumentValue>;
  command?: string | null;
  metadata?: unknown;
  query?: string | null;
  output?: string | null;
  status?: ToolLikeStatus;
}
