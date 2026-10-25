import type {
  AgentUiProjectionContext,
  AgentUiProjectionEvent,
  AgentUiRuntimeStatus,
} from "@limecloud/agent-ui-contracts";

import {
  compactProjectionFields,
  definedString,
  readBooleanField,
  readNumberField,
  readRecord,
  readStringField,
} from "./normalization.js";

export type AgentUiGoalLifecycleStatus =
  | "active"
  | "blocked"
  | "budget_limited"
  | "usage_limited"
  | "paused"
  | "completed"
  | "failed"
  | "verifying"
  | "needs_input"
  | "unknown";

export type AgentUiGoalLifecycleHydrateIssueCode =
  | "missing_thread_id"
  | "missing_goal_hydrate"
  | "goal_thread_mismatch"
  | "goal_status_unmapped"
  | "goal_update_notification_missing"
  | "resumable_stopped_status_missing"
  | "goal_usage_reset_on_objective_edit"
  | "goal_budget_limited_usage_missing"
  | "goal_clear_missing"
  | "goal_read_not_cleared"
  | "goal_surface_missing"
  | "goal_surface_thread_mismatch"
  | "goal_surface_local_state_only"
  | "analytics_leaks_objective"
  | "analytics_missing_non_sensitive_fields"
  | "goal_rendered_as_transcript_item"
  | "goal_persisted_as_read_model_item";

export interface AgentUiGoalLifecycleHydrateIssue {
  code: AgentUiGoalLifecycleHydrateIssueCode;
  path: string;
  message: string;
}

export interface AgentUiGoalSnapshot {
  index: number;
  goalId?: string;
  threadId?: string;
  status?: AgentUiGoalLifecycleStatus;
  tokenBudget?: number;
  tokensUsed?: number;
  timeUsedSeconds?: number;
  createdAt?: string;
  updatedAt?: string;
  objectivePresent: boolean;
}

export interface AgentUiGoalStatusSurfaceSnapshot {
  index: number;
  surface: "header" | "footer" | "goal" | "unknown";
  presentationOwner?: string;
  threadId?: string;
  goalId?: string;
  status?: AgentUiGoalLifecycleStatus;
  tokenBudget?: number;
  tokensUsed?: number;
  timeUsedSeconds?: number;
  localStateOnly: boolean;
}

export interface AgentUiGoalAnalyticsSnapshot {
  index: number;
  eventName?: string;
  action?: string;
  goalId?: string;
  threadId?: string;
  turnId?: string;
  goalStatus?: AgentUiGoalLifecycleStatus;
  hasTokenBudget?: boolean;
  cumulativeTokensAccounted?: number;
  cumulativeTimeAccountedSeconds?: number;
}

export interface AgentUiGoalLifecycleHydrateProjectionInput {
  threadId?: string | null;
  expectedGoalId?: string | null;
  expectedStoppedStatuses?: readonly string[];
  goalSetResponses?: unknown;
  goalRead?: unknown;
  goalUpdatedNotifications?: unknown;
  goalClearedNotifications?: unknown;
  analyticsEvents?: unknown;
  statusSurfaces?: unknown;
  transcriptItems?: unknown;
  readModelItems?: unknown;
  timestamp?: string | null;
}

export interface AgentUiGoalLifecycleHydrateSnapshot {
  threadId?: string;
  expectedGoalId?: string;
  goalSnapshots: AgentUiGoalSnapshot[];
  updatedNotifications: AgentUiGoalSnapshot[];
  statusSurfaces: AgentUiGoalStatusSurfaceSnapshot[];
  analyticsEvents: AgentUiGoalAnalyticsSnapshot[];
  hydratedGoalSeen: boolean;
  threadScoped: boolean;
  statusesMapped: boolean;
  updateNotificationSeen: boolean;
  expectedStoppedStatusesHydrated: boolean;
  usagePreservedAcrossObjectiveEdit: boolean;
  budgetLimitedUsageHydrated: boolean;
  clearNotificationSeen: boolean;
  readAfterClearIsNull: boolean;
  goalSurfacesHydrated: boolean;
  surfaceThreadScoped: boolean;
  sharedSurfaceOwner: boolean;
  analyticsSanitized: boolean;
  analyticsNonSensitiveFieldsPresent: boolean;
  transcriptClean: boolean;
  readModelClean: boolean;
  latestGoal?: AgentUiGoalSnapshot;
  validationIssues: AgentUiGoalLifecycleHydrateIssue[];
}

interface InternalGoalSnapshot extends AgentUiGoalSnapshot {
  objectiveText?: string;
}

function issue(
  code: AgentUiGoalLifecycleHydrateIssueCode,
  path: string,
  message: string,
): AgentUiGoalLifecycleHydrateIssue {
  return { code, path, message };
}

function recordArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => readRecord(item))
      .filter((item): item is Record<string, unknown> => Boolean(item));
  }
  const record = readRecord(value);
  if (!record) return [];
  for (const key of ["data", "items", "notifications", "events", "messages"]) {
    const nested = record[key];
    if (Array.isArray(nested)) return recordArray(nested);
  }
  return [record];
}

function normalizeStatus(
  value: string | undefined,
): AgentUiGoalLifecycleStatus | undefined {
  const normalized = value
    ?.trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
  switch (normalized) {
    case "active":
    case "blocked":
    case "budget_limited":
    case "usage_limited":
    case "paused":
    case "completed":
    case "failed":
    case "verifying":
    case "needs_input":
      return normalized;
    case undefined:
    case "":
      return undefined;
    default:
      return "unknown";
  }
}

function readGoalEnvelope(
  record: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const params = readRecord(record.params);
  const response = readRecord(record.response);
  const result = readRecord(record.result) ?? readRecord(response?.result);
  return (
    readRecord(record.goal) ??
    readRecord(params?.goal) ??
    readRecord(result?.goal) ??
    (readStringField(record, [
      "objective",
      "objectiveText",
      "objective_text",
    ]) ||
    readStringField(record, ["status"]) ||
    readStringField(record, [
      "goalId",
      "goal_id",
      "objectiveId",
      "objective_id",
    ])
      ? record
      : undefined)
  );
}

function readGoalSnapshots(value: unknown): InternalGoalSnapshot[] {
  const snapshots: InternalGoalSnapshot[] = [];
  for (const [index, record] of recordArray(value).entries()) {
    const goal = readGoalEnvelope(record);
    if (!goal) continue;
    const objectiveText = readStringField(goal, [
      "objective",
      "objectiveText",
      "objective_text",
    ]);
    snapshots.push(
      compactProjectionFields({
        index,
        goalId: readStringField(goal, [
          "goalId",
          "goal_id",
          "id",
          "objectiveId",
          "objective_id",
        ]),
        threadId: readStringField(goal, ["threadId", "thread_id"]),
        status: normalizeStatus(readStringField(goal, ["status"])),
        tokenBudget: readNumberField(goal, ["tokenBudget", "token_budget"]),
        tokensUsed: readNumberField(goal, ["tokensUsed", "tokens_used"]),
        timeUsedSeconds: readNumberField(goal, [
          "timeUsedSeconds",
          "time_used_seconds",
        ]),
        createdAt: readStringField(goal, ["createdAt", "created_at"]),
        updatedAt: readStringField(goal, ["updatedAt", "updated_at"]),
        objectivePresent: Boolean(objectiveText),
        objectiveText,
      } satisfies InternalGoalSnapshot),
    );
  }
  return snapshots;
}

function publicGoalSnapshot(
  snapshot: InternalGoalSnapshot,
): AgentUiGoalSnapshot {
  return compactProjectionFields({
    index: snapshot.index,
    goalId: snapshot.goalId,
    threadId: snapshot.threadId,
    status: snapshot.status,
    tokenBudget: snapshot.tokenBudget,
    tokensUsed: snapshot.tokensUsed,
    timeUsedSeconds: snapshot.timeUsedSeconds,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    objectivePresent: snapshot.objectivePresent,
  } satisfies AgentUiGoalSnapshot);
}

function hasNullGoal(value: unknown): boolean {
  return recordArray(value).some((record) => {
    const response = readRecord(record.response);
    const result = readRecord(record.result) ?? readRecord(response?.result);
    return (
      (Object.prototype.hasOwnProperty.call(record, "goal") &&
        record.goal === null) ||
      (result &&
        Object.prototype.hasOwnProperty.call(result, "goal") &&
        result.goal === null)
    );
  });
}

function normalizeSurface(
  value: string | undefined,
): "header" | "footer" | "goal" | "unknown" {
  switch (value) {
    case "header":
    case "status_header":
    case "statusHeader":
      return "header";
    case "footer":
    case "status_footer":
    case "statusFooter":
      return "footer";
    case "goal":
    case "goal_status":
    case "goalStatus":
      return "goal";
    default:
      return "unknown";
  }
}

function readStatusSurfaces(
  value: unknown,
): AgentUiGoalStatusSurfaceSnapshot[] {
  return recordArray(value).map((record, index) => {
    const facts =
      readRecord(record.facts) ??
      readRecord(record.metadata) ??
      readRecord(record.goal) ??
      record;
    return compactProjectionFields({
      index,
      surface: normalizeSurface(
        readStringField(record, ["surface", "kind", "target"]),
      ),
      presentationOwner: readStringField(record, [
        "presentationOwner",
        "presentation_owner",
        "owner",
      ]),
      threadId:
        readStringField(record, ["threadId", "thread_id"]) ??
        readStringField(facts, ["threadId", "thread_id"]),
      goalId: readStringField(facts, [
        "goalId",
        "goal_id",
        "id",
        "objectiveId",
        "objective_id",
      ]),
      status: normalizeStatus(
        readStringField(facts, ["status", "goalStatus", "goal_status"]),
      ),
      tokenBudget: readNumberField(facts, ["tokenBudget", "token_budget"]),
      tokensUsed: readNumberField(facts, ["tokensUsed", "tokens_used"]),
      timeUsedSeconds: readNumberField(facts, [
        "timeUsedSeconds",
        "time_used_seconds",
      ]),
      localStateOnly:
        readBooleanField(record, ["localStateOnly", "local_state_only"]) ===
        true,
    } satisfies AgentUiGoalStatusSurfaceSnapshot);
  });
}

function eventParams(record: Record<string, unknown>): Record<string, unknown> {
  return (
    readRecord(record.event_params) ??
    readRecord(record.eventParams) ??
    readRecord(record.params) ??
    record
  );
}

function readAnalytics(value: unknown): AgentUiGoalAnalyticsSnapshot[] {
  return recordArray(value).map((record, index) => {
    const params = eventParams(record);
    return compactProjectionFields({
      index,
      eventName: readStringField(record, ["event_name", "eventName", "name"]),
      action: readStringField(params, ["action", "goal_event", "goalEvent"]),
      goalId: readStringField(params, ["goal_id", "goalId"]),
      threadId: readStringField(params, ["thread_id", "threadId"]),
      turnId: readStringField(params, ["turn_id", "turnId"]),
      goalStatus: normalizeStatus(
        readStringField(params, ["goal_status", "goalStatus", "status"]),
      ),
      hasTokenBudget: readBooleanField(params, [
        "has_token_budget",
        "hasTokenBudget",
      ]),
      cumulativeTokensAccounted: readNumberField(params, [
        "cumulative_tokens_accounted",
        "cumulativeTokensAccounted",
      ]),
      cumulativeTimeAccountedSeconds: readNumberField(params, [
        "cumulative_time_accounted_seconds",
        "cumulativeTimeAccountedSeconds",
      ]),
    } satisfies AgentUiGoalAnalyticsSnapshot);
  });
}

function containsForbiddenAnalyticsKey(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsForbiddenAnalyticsKey);
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (
      key === "objective" ||
      key === "token_budget" ||
      key === "tokenBudget"
    ) {
      return true;
    }
    if (containsForbiddenAnalyticsKey(child)) return true;
  }
  return false;
}

function analyticsEventsSanitized(value: unknown): boolean {
  return recordArray(value).every(
    (record) => !containsForbiddenAnalyticsKey(record),
  );
}

function analyticsNonSensitiveFieldsPresent(
  analytics: readonly AgentUiGoalAnalyticsSnapshot[],
): boolean {
  if (analytics.length === 0) return true;
  return analytics.every((event) => {
    if (!event.goalId || !event.goalStatus) return false;
    if (event.action === "created" && event.hasTokenBudget !== true)
      return false;
    return true;
  });
}

function goalLeakIndexes(value: unknown): number[] {
  return recordArray(value)
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => {
      const type = readStringField(record, [
        "type",
        "kind",
        "sourceType",
        "source_type",
        "itemType",
        "item_type",
      ]);
      const method = readStringField(record, ["method", "event"]);
      return Boolean(
        type?.toLowerCase().includes("goal") ||
        method?.toLowerCase().startsWith("thread/goal"),
      );
    })
    .map(({ index }) => index);
}

function usagePreservedAcrossObjectiveEdit(
  snapshots: readonly InternalGoalSnapshot[],
  hasUsageAccounting: boolean,
): boolean {
  for (let index = 1; index < snapshots.length; index += 1) {
    const previous = snapshots[index - 1];
    const current = snapshots[index];
    if (!previous.objectiveText || !current.objectiveText) continue;
    if (previous.objectiveText === current.objectiveText) continue;
    const sameGoal =
      !previous.goalId || !current.goalId || previous.goalId === current.goalId;
    const sameCreatedAt =
      !previous.createdAt ||
      !current.createdAt ||
      previous.createdAt === current.createdAt;
    const tokensPreserved =
      (current.tokensUsed ?? 0) >= (previous.tokensUsed ?? 0) &&
      (!hasUsageAccounting || (current.tokensUsed ?? 0) > 0);
    const timePreserved =
      (current.timeUsedSeconds ?? 0) >= (previous.timeUsedSeconds ?? 0) &&
      (!hasUsageAccounting || (current.timeUsedSeconds ?? 0) > 0);
    if (!sameGoal || !sameCreatedAt || !tokensPreserved || !timePreserved) {
      return false;
    }
  }
  return true;
}

function hasExpectedStoppedStatuses(
  statuses: ReadonlySet<AgentUiGoalLifecycleStatus>,
  expectedStatuses: readonly string[] | undefined,
): boolean {
  const expected = (expectedStatuses ?? [])
    .map(normalizeStatus)
    .filter((status): status is AgentUiGoalLifecycleStatus => Boolean(status));
  return expected.every((status) => statuses.has(status));
}

function goalSurfacesHydrated(
  surfaces: readonly AgentUiGoalStatusSurfaceSnapshot[],
): boolean {
  const covered = new Set(surfaces.map((surface) => surface.surface));
  const requiredCovered =
    covered.has("header") && covered.has("footer") && covered.has("goal");
  return (
    requiredCovered &&
    surfaces.every(
      (surface) =>
        surface.goalId &&
        surface.status &&
        (surface.tokenBudget !== undefined ||
          surface.tokensUsed !== undefined ||
          surface.timeUsedSeconds !== undefined),
    )
  );
}

function validateSnapshot(
  input: AgentUiGoalLifecycleHydrateProjectionInput,
  snapshot: Omit<AgentUiGoalLifecycleHydrateSnapshot, "validationIssues">,
): AgentUiGoalLifecycleHydrateIssue[] {
  const issues: AgentUiGoalLifecycleHydrateIssue[] = [];
  if (!snapshot.threadId) {
    issues.push(
      issue(
        "missing_thread_id",
        "$.threadId",
        "Goal hydrate requires a thread id.",
      ),
    );
  }
  if (!snapshot.hydratedGoalSeen) {
    issues.push(
      issue(
        "missing_goal_hydrate",
        "$.goalSetResponses",
        "Goal lifecycle hydrate requires at least one structured goal snapshot.",
      ),
    );
  }
  if (!snapshot.threadScoped) {
    issues.push(
      issue(
        "goal_thread_mismatch",
        "$.goalSetResponses.goal.threadId",
        "Goal snapshots must stay scoped to the owning thread.",
      ),
    );
  }
  if (!snapshot.statusesMapped) {
    issues.push(
      issue(
        "goal_status_unmapped",
        "$.goalSetResponses.goal.status",
        "Goal status must map wire statuses such as budgetLimited/usageLimited.",
      ),
    );
  }
  if (!snapshot.updateNotificationSeen) {
    issues.push(
      issue(
        "goal_update_notification_missing",
        "$.goalUpdatedNotifications",
        "thread/goal/updated must hydrate the status surface and read model facts.",
      ),
    );
  }
  if (!snapshot.expectedStoppedStatusesHydrated) {
    issues.push(
      issue(
        "resumable_stopped_status_missing",
        "$.expectedStoppedStatuses",
        "Blocked/usage-limited resumable statuses must survive set/get notification hydrate.",
      ),
    );
  }
  if (!snapshot.usagePreservedAcrossObjectiveEdit) {
    issues.push(
      issue(
        "goal_usage_reset_on_objective_edit",
        "$.goalSetResponses",
        "Editing the objective must not reset goal id, created_at, tokens_used or time_used_seconds.",
      ),
    );
  }
  if (!snapshot.budgetLimitedUsageHydrated) {
    issues.push(
      issue(
        "goal_budget_limited_usage_missing",
        "$.analyticsEvents",
        "Budget-limited usage accounting must hydrate cumulative usage and matching goal status.",
      ),
    );
  }
  if (!snapshot.clearNotificationSeen) {
    issues.push(
      issue(
        "goal_clear_missing",
        "$.goalClearedNotifications",
        "thread/goal/clear must emit thread/goal/cleared.",
      ),
    );
  }
  if (!snapshot.readAfterClearIsNull) {
    issues.push(
      issue(
        "goal_read_not_cleared",
        "$.goalRead",
        "thread/goal/get after clear must return goal=null.",
      ),
    );
  }
  if (!snapshot.goalSurfacesHydrated) {
    issues.push(
      issue(
        "goal_surface_missing",
        "$.statusSurfaces",
        "Header, footer and goal status surfaces must hydrate from structured goal facts.",
      ),
    );
  }
  if (!snapshot.surfaceThreadScoped) {
    issues.push(
      issue(
        "goal_surface_thread_mismatch",
        "$.statusSurfaces.threadId",
        "Goal status surfaces must stay scoped to the same thread.",
      ),
    );
  }
  if (!snapshot.sharedSurfaceOwner) {
    issues.push(
      issue(
        "goal_surface_local_state_only",
        "$.statusSurfaces.presentationOwner",
        "Goal status surfaces must share a structured owner and not exist only as GUI local state.",
      ),
    );
  }
  if (!snapshot.analyticsSanitized) {
    issues.push(
      issue(
        "analytics_leaks_objective",
        "$.analyticsEvents",
        "Goal analytics must not serialize objective or token_budget; use non-sensitive fields only.",
      ),
    );
  }
  if (!snapshot.analyticsNonSensitiveFieldsPresent) {
    issues.push(
      issue(
        "analytics_missing_non_sensitive_fields",
        "$.analyticsEvents.event_params",
        "Goal analytics must keep goal_id, goal_status and has_token_budget/cumulative usage facts.",
      ),
    );
  }
  for (const index of goalLeakIndexes(input.transcriptItems)) {
    issues.push(
      issue(
        "goal_rendered_as_transcript_item",
        `$.transcriptItems[${index}]`,
        "Goal lifecycle is thread metadata/status, not an assistant transcript item.",
      ),
    );
  }
  for (const index of goalLeakIndexes(input.readModelItems)) {
    issues.push(
      issue(
        "goal_persisted_as_read_model_item",
        `$.readModelItems[${index}]`,
        "Goal lifecycle must not persist as a normal read-model timeline item.",
      ),
    );
  }
  return issues;
}

export function extractGoalLifecycleHydrateSnapshot(
  input: AgentUiGoalLifecycleHydrateProjectionInput,
): AgentUiGoalLifecycleHydrateSnapshot {
  const goalSnapshots = readGoalSnapshots(input.goalSetResponses);
  const updatedNotifications = readGoalSnapshots(
    input.goalUpdatedNotifications,
  );
  const statusSurfaces = readStatusSurfaces(input.statusSurfaces);
  const analyticsEvents = readAnalytics(input.analyticsEvents);
  const allGoalSnapshots = [...goalSnapshots, ...updatedNotifications];
  const latestGoal = allGoalSnapshots[allGoalSnapshots.length - 1];
  const threadId =
    definedString(input.threadId ?? undefined) ??
    allGoalSnapshots.find((goal) => goal.threadId)?.threadId ??
    statusSurfaces.find((surface) => surface.threadId)?.threadId;
  const expectedGoalId = definedString(input.expectedGoalId ?? undefined);
  const statuses = new Set(
    allGoalSnapshots
      .map((goal) => goal.status)
      .filter((status): status is AgentUiGoalLifecycleStatus =>
        Boolean(status),
      ),
  );
  const usageAnalyticsSeen = analyticsEvents.some(
    (event) =>
      event.action === "usage_accounted" ||
      event.cumulativeTokensAccounted !== undefined ||
      event.cumulativeTimeAccountedSeconds !== undefined,
  );
  const budgetLimitedAnalyticsSeen = analyticsEvents.some(
    (event) =>
      event.goalStatus === "budget_limited" ||
      event.goalStatus === "usage_limited",
  );
  const ownerSet = new Set(
    statusSurfaces
      .map((surface) => surface.presentationOwner)
      .filter((owner): owner is string => Boolean(owner)),
  );
  const base = {
    threadId,
    expectedGoalId,
    goalSnapshots: goalSnapshots.map(publicGoalSnapshot),
    updatedNotifications: updatedNotifications.map(publicGoalSnapshot),
    statusSurfaces,
    analyticsEvents,
    hydratedGoalSeen: goalSnapshots.length > 0,
    threadScoped: allGoalSnapshots.every(
      (goal) => !threadId || !goal.threadId || goal.threadId === threadId,
    ),
    statusesMapped: allGoalSnapshots.every(
      (goal) => !goal.status || goal.status !== "unknown",
    ),
    updateNotificationSeen: updatedNotifications.length > 0,
    expectedStoppedStatusesHydrated: hasExpectedStoppedStatuses(
      statuses,
      input.expectedStoppedStatuses,
    ),
    usagePreservedAcrossObjectiveEdit: usagePreservedAcrossObjectiveEdit(
      goalSnapshots,
      usageAnalyticsSeen,
    ),
    budgetLimitedUsageHydrated:
      !budgetLimitedAnalyticsSeen ||
      (latestGoal?.status === "budget_limited" &&
        typeof latestGoal.tokensUsed === "number" &&
        typeof latestGoal.timeUsedSeconds === "number"),
    clearNotificationSeen:
      recordArray(input.goalClearedNotifications).length > 0,
    readAfterClearIsNull: hasNullGoal(input.goalRead),
    goalSurfacesHydrated: goalSurfacesHydrated(statusSurfaces),
    surfaceThreadScoped: statusSurfaces.every(
      (surface) =>
        !threadId || !surface.threadId || surface.threadId === threadId,
    ),
    sharedSurfaceOwner:
      statusSurfaces.length > 0 &&
      ownerSet.size === 1 &&
      statusSurfaces.every((surface) => !surface.localStateOnly),
    analyticsSanitized: analyticsEventsSanitized(input.analyticsEvents),
    analyticsNonSensitiveFieldsPresent:
      analyticsNonSensitiveFieldsPresent(analyticsEvents),
    transcriptClean: goalLeakIndexes(input.transcriptItems).length === 0,
    readModelClean: goalLeakIndexes(input.readModelItems).length === 0,
    latestGoal: latestGoal ? publicGoalSnapshot(latestGoal) : undefined,
  };
  return {
    ...base,
    validationIssues: validateSnapshot(input, base),
  };
}

function runtimeStatus(
  issues: readonly AgentUiGoalLifecycleHydrateIssue[],
): AgentUiRuntimeStatus {
  return issues.length > 0 ? "failed" : "completed";
}

export function buildGoalLifecycleHydrateProjectionEvent(
  input: AgentUiGoalLifecycleHydrateProjectionInput,
  context: AgentUiProjectionContext = {},
): AgentUiProjectionEvent {
  const snapshot = extractGoalLifecycleHydrateSnapshot(input);
  const status = runtimeStatus(snapshot.validationIssues);
  return compactProjectionFields({
    type: "state.snapshot",
    sourceType: "goal_lifecycle_hydrate_projection",
    sequence: context.sequence,
    timestamp: definedString(input.timestamp ?? undefined) ?? context.timestamp,
    sessionId: definedString(context.sessionId ?? undefined),
    threadId: snapshot.threadId ?? definedString(context.threadId ?? undefined),
    runId: definedString(context.runId ?? undefined),
    turnId: definedString(context.turnId ?? undefined),
    owner: "ui_projection",
    scope: "thread",
    phase: status === "failed" ? "failed" : "completed",
    surface: "runtime_status",
    persistence: "snapshot",
    control: "open_detail",
    runtimeEntity: "agent_turn",
    runtimeStatus: status,
    latestTurnStatus: status,
    payload: {
      goalLifecycleHydrateEvent: "thread_goal_lifecycle_hydrate",
      hydratedGoalSeen: snapshot.hydratedGoalSeen,
      threadScoped: snapshot.threadScoped,
      statusesMapped: snapshot.statusesMapped,
      updateNotificationSeen: snapshot.updateNotificationSeen,
      expectedStoppedStatusesHydrated: snapshot.expectedStoppedStatusesHydrated,
      usagePreservedAcrossObjectiveEdit:
        snapshot.usagePreservedAcrossObjectiveEdit,
      budgetLimitedUsageHydrated: snapshot.budgetLimitedUsageHydrated,
      clearNotificationSeen: snapshot.clearNotificationSeen,
      readAfterClearIsNull: snapshot.readAfterClearIsNull,
      goalSurfacesHydrated: snapshot.goalSurfacesHydrated,
      analyticsSanitized: snapshot.analyticsSanitized,
      analyticsNonSensitiveFieldsPresent:
        snapshot.analyticsNonSensitiveFieldsPresent,
      transcriptClean: snapshot.transcriptClean,
      readModelClean: snapshot.readModelClean,
      latestGoal: snapshot.latestGoal,
      goalLifecycleHydrate: snapshot,
      validationIssues: snapshot.validationIssues,
    },
  } satisfies AgentUiProjectionEvent);
}
