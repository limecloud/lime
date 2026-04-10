import {
  normalizeLegacyToolSurfaceName,
} from "../agentTextNormalization";
import { normalizeQueuedTurnSnapshots } from "../queuedTurn";
import type {
  AgentRuntimeAnalysisArtifact,
  AgentRuntimeAnalysisHandoff,
  AgentRuntimeReviewDecision,
  AgentRuntimeReviewDecisionArtifact,
  AgentRuntimeReviewDecisionRiskLevel,
  AgentRuntimeReviewDecisionStatus,
  AgentRuntimeReviewDecisionTemplate,
  AgentRuntimeThreadReadModel,
  AsterSubagentParentContext,
  AsterSubagentSessionInfo,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readStringField(
  record: Record<string, unknown>,
  camelKey: string,
  snakeKey?: string,
): string {
  const value = record[camelKey] ?? (snakeKey ? record[snakeKey] : undefined);
  return typeof value === "string" ? value : "";
}

function readOptionalStringField(
  record: Record<string, unknown>,
  camelKey: string,
  snakeKey?: string,
): string | undefined {
  const value = record[camelKey] ?? (snakeKey ? record[snakeKey] : undefined);
  return typeof value === "string" && value ? value : undefined;
}

function readNumberField(
  record: Record<string, unknown>,
  camelKey: string,
  snakeKey?: string,
): number {
  const value = record[camelKey] ?? (snakeKey ? record[snakeKey] : undefined);
  return typeof value === "number" ? value : 0;
}

function readStringListField(
  record: Record<string, unknown>,
  camelKey: string,
  snakeKey?: string,
): string[] {
  const value = record[camelKey] ?? (snakeKey ? record[snakeKey] : undefined);
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function normalizeAnalysisArtifact(
  value: unknown,
): AgentRuntimeAnalysisArtifact | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    kind:
      readStringField(value, "kind") === "analysis_context"
        ? "analysis_context"
        : "analysis_brief",
    title: readStringField(value, "title"),
    relative_path: readStringField(value, "relativePath", "relative_path"),
    absolute_path: readStringField(value, "absolutePath", "absolute_path"),
    bytes: readNumberField(value, "bytes"),
  };
}

function normalizeReviewDecisionArtifact(
  value: unknown,
): AgentRuntimeReviewDecisionArtifact | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    kind:
      readStringField(value, "kind") === "review_decision_json"
        ? "review_decision_json"
        : "review_decision_markdown",
    title: readStringField(value, "title"),
    relative_path: readStringField(value, "relativePath", "relative_path"),
    absolute_path: readStringField(value, "absolutePath", "absolute_path"),
    bytes: readNumberField(value, "bytes"),
  };
}

function normalizeReviewDecisionStatus(
  value: string,
): AgentRuntimeReviewDecisionStatus {
  switch (value) {
    case "accepted":
    case "deferred":
    case "rejected":
    case "needs_more_evidence":
    case "pending_review":
      return value;
    default:
      return "pending_review";
  }
}

function normalizeReviewDecisionRiskLevel(
  value: string,
): AgentRuntimeReviewDecisionRiskLevel {
  switch (value) {
    case "low":
    case "medium":
    case "high":
    case "unknown":
      return value;
    default:
      return "unknown";
  }
}

function normalizeReviewDecision(value: unknown): AgentRuntimeReviewDecision {
  const record = isRecord(value) ? value : {};

  return {
    decision_status: normalizeReviewDecisionStatus(
      readStringField(record, "decisionStatus", "decision_status"),
    ),
    decision_summary: readStringField(
      record,
      "decisionSummary",
      "decision_summary",
    ),
    chosen_fix_strategy: readStringField(
      record,
      "chosenFixStrategy",
      "chosen_fix_strategy",
    ),
    risk_level: normalizeReviewDecisionRiskLevel(
      readStringField(record, "riskLevel", "risk_level"),
    ),
    risk_tags: readStringListField(record, "riskTags", "risk_tags"),
    human_reviewer: readStringField(record, "humanReviewer", "human_reviewer"),
    reviewed_at: readOptionalStringField(record, "reviewedAt", "reviewed_at"),
    followup_actions: readStringListField(
      record,
      "followupActions",
      "followup_actions",
    ),
    regression_requirements: readStringListField(
      record,
      "regressionRequirements",
      "regression_requirements",
    ),
    notes: readStringField(record, "notes"),
  };
}

export function normalizeSubagentSessionInfo(
  session: AsterSubagentSessionInfo,
): AsterSubagentSessionInfo {
  return {
    ...session,
    origin_tool: normalizeLegacyToolSurfaceName(session.origin_tool),
  };
}

export function normalizeSubagentParentContext(
  context?: AsterSubagentParentContext | null,
): AsterSubagentParentContext | undefined {
  if (!context) {
    return undefined;
  }

  return {
    ...context,
    origin_tool: normalizeLegacyToolSurfaceName(context.origin_tool),
    sibling_subagent_sessions: Array.isArray(context.sibling_subagent_sessions)
      ? context.sibling_subagent_sessions.map(normalizeSubagentSessionInfo)
      : context.sibling_subagent_sessions,
  };
}

export function normalizeAnalysisHandoff(
  value: unknown,
): AgentRuntimeAnalysisHandoff {
  const record = isRecord(value) ? value : {};
  const rawArtifacts = Array.isArray(record.artifacts) ? record.artifacts : [];

  return {
    session_id: readStringField(record, "sessionId", "session_id"),
    thread_id: readStringField(record, "threadId", "thread_id"),
    workspace_id: readOptionalStringField(
      record,
      "workspaceId",
      "workspace_id",
    ),
    workspace_root: readStringField(record, "workspaceRoot", "workspace_root"),
    analysis_relative_root: readStringField(
      record,
      "analysisRelativeRoot",
      "analysis_relative_root",
    ),
    analysis_absolute_root: readStringField(
      record,
      "analysisAbsoluteRoot",
      "analysis_absolute_root",
    ),
    handoff_bundle_relative_root: readStringField(
      record,
      "handoffBundleRelativeRoot",
      "handoff_bundle_relative_root",
    ),
    evidence_pack_relative_root: readStringField(
      record,
      "evidencePackRelativeRoot",
      "evidence_pack_relative_root",
    ),
    replay_case_relative_root: readStringField(
      record,
      "replayCaseRelativeRoot",
      "replay_case_relative_root",
    ),
    exported_at: readStringField(record, "exportedAt", "exported_at"),
    title: readStringField(record, "title"),
    thread_status: readStringField(record, "threadStatus", "thread_status"),
    latest_turn_status: readOptionalStringField(
      record,
      "latestTurnStatus",
      "latest_turn_status",
    ),
    pending_request_count: readNumberField(
      record,
      "pendingRequestCount",
      "pending_request_count",
    ),
    queued_turn_count: readNumberField(
      record,
      "queuedTurnCount",
      "queued_turn_count",
    ),
    sanitized_workspace_root: readStringField(
      record,
      "sanitizedWorkspaceRoot",
      "sanitized_workspace_root",
    ),
    copy_prompt: readStringField(record, "copyPrompt", "copy_prompt"),
    artifacts: rawArtifacts
      .map((artifact) => normalizeAnalysisArtifact(artifact))
      .filter(Boolean) as AgentRuntimeAnalysisArtifact[],
  };
}

export function normalizeReviewDecisionTemplate(
  value: unknown,
): AgentRuntimeReviewDecisionTemplate {
  const record = isRecord(value) ? value : {};
  const rawArtifacts = Array.isArray(record.artifacts) ? record.artifacts : [];
  const rawAnalysisArtifacts = Array.isArray(record.analysisArtifacts)
    ? record.analysisArtifacts
    : Array.isArray(record.analysis_artifacts)
      ? record.analysis_artifacts
      : [];

  return {
    session_id: readStringField(record, "sessionId", "session_id"),
    thread_id: readStringField(record, "threadId", "thread_id"),
    workspace_id: readOptionalStringField(
      record,
      "workspaceId",
      "workspace_id",
    ),
    workspace_root: readStringField(record, "workspaceRoot", "workspace_root"),
    review_relative_root: readStringField(
      record,
      "reviewRelativeRoot",
      "review_relative_root",
    ),
    review_absolute_root: readStringField(
      record,
      "reviewAbsoluteRoot",
      "review_absolute_root",
    ),
    analysis_relative_root: readStringField(
      record,
      "analysisRelativeRoot",
      "analysis_relative_root",
    ),
    analysis_absolute_root: readStringField(
      record,
      "analysisAbsoluteRoot",
      "analysis_absolute_root",
    ),
    handoff_bundle_relative_root: readStringField(
      record,
      "handoffBundleRelativeRoot",
      "handoff_bundle_relative_root",
    ),
    evidence_pack_relative_root: readStringField(
      record,
      "evidencePackRelativeRoot",
      "evidence_pack_relative_root",
    ),
    replay_case_relative_root: readStringField(
      record,
      "replayCaseRelativeRoot",
      "replay_case_relative_root",
    ),
    exported_at: readStringField(record, "exportedAt", "exported_at"),
    title: readStringField(record, "title"),
    thread_status: readStringField(record, "threadStatus", "thread_status"),
    latest_turn_status: readOptionalStringField(
      record,
      "latestTurnStatus",
      "latest_turn_status",
    ),
    pending_request_count: readNumberField(
      record,
      "pendingRequestCount",
      "pending_request_count",
    ),
    queued_turn_count: readNumberField(
      record,
      "queuedTurnCount",
      "queued_turn_count",
    ),
    default_decision_status: readStringField(
      record,
      "defaultDecisionStatus",
      "default_decision_status",
    ),
    decision: normalizeReviewDecision(record.decision),
    decision_status_options: readStringListField(
      record,
      "decisionStatusOptions",
      "decision_status_options",
    ).map((status) => normalizeReviewDecisionStatus(status)),
    risk_level_options: readStringListField(
      record,
      "riskLevelOptions",
      "risk_level_options",
    ).map((riskLevel) => normalizeReviewDecisionRiskLevel(riskLevel)),
    review_checklist: readStringListField(
      record,
      "reviewChecklist",
      "review_checklist",
    ),
    analysis_artifacts: rawAnalysisArtifacts
      .map((artifact) => normalizeAnalysisArtifact(artifact))
      .filter(Boolean) as AgentRuntimeAnalysisArtifact[],
    artifacts: rawArtifacts
      .map((artifact) => normalizeReviewDecisionArtifact(artifact))
      .filter(Boolean) as AgentRuntimeReviewDecisionArtifact[],
  };
}

export function normalizeThreadReadModel(
  threadRead?: AgentRuntimeThreadReadModel | null,
): AgentRuntimeThreadReadModel | null | undefined {
  if (!threadRead) {
    return threadRead;
  }

  return {
    ...threadRead,
    queued_turns: normalizeQueuedTurnSnapshots(threadRead.queued_turns),
  };
}
