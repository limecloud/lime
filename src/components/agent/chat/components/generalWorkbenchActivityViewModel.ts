import type { AgentRun } from "@/lib/api/executionRun";
import type { SidebarActivityLog } from "./generalWorkbenchWorkflowData";
import type {
  buildGeneralWorkbenchActivityLogGroups,
  GeneralWorkbenchActivityLogGroup,
  GeneralWorkbenchRunMetadataSummary,
} from "./generalWorkbenchWorkflowData";
import type {
  GeneralWorkbenchActivityArtifactActionGroup,
  GeneralWorkbenchActivityLogProjection,
  GeneralWorkbenchActivitySectionProjection,
  GeneralWorkbenchRunDetailActionItem,
  GeneralWorkbenchRunDetailArtifactProjection,
  GeneralWorkbenchRunDetailFactRow,
  GeneralWorkbenchRunDetailProjection,
  GeneralWorkbenchWorkflowPanelTranslate,
} from "./generalWorkbenchWorkflowPanelTypes";

export function formatGateLabel(
  t: GeneralWorkbenchWorkflowPanelTranslate,
  gateKey?: SidebarActivityLog["gateKey"],
): string | null {
  if (!gateKey || gateKey === "idle") {
    return null;
  }
  if (gateKey === "topic_select") {
    return t("generalWorkbench.workflow.activity.gate.topicSelect");
  }
  if (gateKey === "write_mode") {
    return t("generalWorkbench.workflow.activity.gate.writeMode");
  }
  if (gateKey === "publish_confirm") {
    return t("generalWorkbench.workflow.activity.gate.publishConfirm");
  }
  return null;
}

export function formatRunIdShort(runId?: string): string | null {
  const trimmed = runId?.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length <= 8) {
    return trimmed;
  }
  return `${trimmed.slice(0, 8)}…`;
}

export function formatRunStatusLabel(
  t: GeneralWorkbenchWorkflowPanelTranslate,
  status: AgentRun["status"],
): string {
  if (status === "queued") {
    return t("generalWorkbench.workflow.runDetail.status.queued");
  }
  if (status === "running") {
    return t("generalWorkbench.workflow.runDetail.status.running");
  }
  if (status === "success") {
    return t("generalWorkbench.workflow.runDetail.status.success");
  }
  if (status === "error") {
    return t("generalWorkbench.workflow.runDetail.status.error");
  }
  if (status === "canceled") {
    return t("generalWorkbench.workflow.runDetail.status.canceled");
  }
  if (status === "timeout") {
    return t("generalWorkbench.workflow.runDetail.status.timeout");
  }
  return status;
}

export function getPrimaryActivityLog(
  group: ReturnType<typeof buildGeneralWorkbenchActivityLogGroups>[number],
):
  | ReturnType<
      typeof buildGeneralWorkbenchActivityLogGroups
    >[number]["logs"][number]
  | undefined {
  return group.logs.find((log) => log.source === "skill") || group.logs[0];
}

export function buildActivityStepSummary(
  log: GeneralWorkbenchActivityLogGroup["logs"][number],
): string | null {
  const parts = [log.inputSummary, log.outputSummary]
    .map((item) => item?.trim() || "")
    .filter((item) => item.length > 0);
  if (parts.length === 0) {
    return null;
  }
  return parts.join(" → ");
}

export function formatActivityStatusLabel(
  t: GeneralWorkbenchWorkflowPanelTranslate,
  status: ReturnType<
    typeof buildGeneralWorkbenchActivityLogGroups
  >[number]["status"],
): string {
  if (status === "running") {
    return t("generalWorkbench.workflow.activity.status.running");
  }
  if (status === "failed") {
    return t("generalWorkbench.workflow.activity.status.failed");
  }
  return t("generalWorkbench.workflow.activity.status.recorded");
}

export function formatActivitySourceLabel(
  t: GeneralWorkbenchWorkflowPanelTranslate,
  source?: string,
): string | null {
  const normalized = source?.trim();
  if (!normalized) {
    return null;
  }
  if (normalized === "skill") {
    return t("generalWorkbench.workflow.activity.source.skill");
  }
  if (normalized === "tool") {
    return t("generalWorkbench.workflow.activity.source.tool");
  }
  if (normalized === "workflow") {
    return t("generalWorkbench.workflow.activity.source.workflow");
  }
  return normalized;
}

export function buildRunDetailSummaryText(params: {
  runMetadataSummary: GeneralWorkbenchRunMetadataSummary;
  activeRunStagesLabel?: string | null;
  t: GeneralWorkbenchWorkflowPanelTranslate;
}): string {
  const { runMetadataSummary, activeRunStagesLabel, t } = params;
  const parts: string[] = [];
  if (runMetadataSummary.curatedTask?.taskTitle) {
    parts.push(
      t("generalWorkbench.workflow.runDetail.summary.curatedTask", {
        title: runMetadataSummary.curatedTask.taskTitle,
      }),
    );
  }
  if (activeRunStagesLabel) {
    parts.push(activeRunStagesLabel);
  }
  if (runMetadataSummary.workflow) {
    parts.push(
      t("generalWorkbench.workflow.runDetail.summary.workflow", {
        workflow: runMetadataSummary.workflow,
      }),
    );
  }
  if (runMetadataSummary.artifactPaths.length > 0) {
    parts.push(
      runMetadataSummary.artifactPaths.length === 1
        ? t("generalWorkbench.workflow.runDetail.summary.artifactPath", {
            path: runMetadataSummary.artifactPaths[0],
          })
        : t("generalWorkbench.workflow.runDetail.summary.artifactCount", {
            count: runMetadataSummary.artifactPaths.length,
          }),
    );
  }
  return (
    parts.join(" · ") || t("generalWorkbench.workflow.runDetail.summary.empty")
  );
}

export function buildGeneralWorkbenchRunDetailArtifactProjection({
  artifactPath,
  t,
}: {
  artifactPath: string;
  t: GeneralWorkbenchWorkflowPanelTranslate;
}): GeneralWorkbenchRunDetailArtifactProjection {
  return {
    path: artifactPath,
    actions: [
      {
        kind: "copy",
        label: t("generalWorkbench.workflow.runDetail.copyArtifact"),
        ariaLabel: t("generalWorkbench.workflow.runDetail.copyArtifactAria", {
          path: artifactPath,
        }),
        targetPath: artifactPath,
      },
      {
        kind: "reveal",
        label: t("generalWorkbench.workflow.runDetail.revealArtifact"),
        ariaLabel: t("generalWorkbench.workflow.runDetail.revealArtifactAria", {
          path: artifactPath,
        }),
        targetPath: artifactPath,
      },
      {
        kind: "open",
        label: t("generalWorkbench.workflow.runDetail.openArtifact"),
        ariaLabel: t("generalWorkbench.workflow.runDetail.openArtifactAria", {
          path: artifactPath,
        }),
        targetPath: artifactPath,
      },
    ],
  };
}

export function buildGeneralWorkbenchRunDetailActions({
  runId,
  runMetadataText,
  t,
}: {
  runId: string;
  runMetadataText: string;
  t: GeneralWorkbenchWorkflowPanelTranslate;
}): GeneralWorkbenchRunDetailActionItem[] {
  return [
    {
      kind: "copy_id",
      label: t("generalWorkbench.workflow.runDetail.copyId"),
      ariaLabel: t("generalWorkbench.workflow.runDetail.copyIdAria"),
      copyTarget: runId,
    },
    {
      kind: "copy_raw",
      label: t("generalWorkbench.workflow.runDetail.copyRaw"),
      ariaLabel: t("generalWorkbench.workflow.runDetail.copyRawAria"),
      copyTarget: runMetadataText,
    },
  ];
}

export function buildGeneralWorkbenchRunDetailFactRows({
  runMetadataText,
  t,
}: {
  runMetadataText: string;
  t: GeneralWorkbenchWorkflowPanelTranslate;
}): GeneralWorkbenchRunDetailFactRow[] {
  const workflowRecord = readWorkflowMetadataRecord(runMetadataText);
  if (!workflowRecord) {
    return [];
  }

  const rows: GeneralWorkbenchRunDetailFactRow[] = [];
  const failureValue = readWorkflowFailureValue(workflowRecord);
  if (failureValue) {
    rows.push({
      key: "workflow-failure",
      label: t("generalWorkbench.workflow.runDetail.workflowFailure"),
      value: failureValue,
    });
  }

  const retryValue = readWorkflowRetryValue(workflowRecord);
  if (retryValue) {
    rows.push({
      key: "workflow-retry",
      label: t("generalWorkbench.workflow.runDetail.workflowRetry"),
      value: retryValue,
    });
  }

  const waitingActionValue = readWorkflowWaitingActionValue(workflowRecord, t);
  if (waitingActionValue) {
    rows.push({
      key: "workflow-waiting-action",
      label: t("generalWorkbench.workflow.runDetail.workflowWaitingAction"),
      value: waitingActionValue,
    });
  }

  return rows;
}

function readWorkflowMetadataRecord(
  raw: string,
): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return (
      asPlainRecord(parsed.workflow_read_model) ??
      asPlainRecord(parsed.workflowReadModel)
    );
  } catch {
    return null;
  }
}

function readWorkflowFailureValue(
  workflowRecord: Record<string, unknown>,
): string | null {
  const runFailure = readFailureText(asPlainRecord(workflowRecord.failure));
  if (runFailure) {
    return runFailure;
  }

  const failedStep = readWorkflowStepRecords(workflowRecord).find((step) => {
    const status = readStringField(step, ["status"])?.toLowerCase();
    return status === "failed" || status === "failure" || status === "error";
  });
  if (!failedStep) {
    return null;
  }

  const stepTitle =
    readStringField(failedStep, ["title", "stepTitle", "step_title", "id"]) ??
    null;
  const failureText = readFailureText(asPlainRecord(failedStep.failure));
  if (!failureText && !stepTitle) {
    return null;
  }
  return [stepTitle, failureText].filter(Boolean).join(": ");
}

function readWorkflowRetryValue(
  workflowRecord: Record<string, unknown>,
): string | null {
  const retryRecord =
    asPlainRecord(workflowRecord.retry) ??
    readWorkflowStepRecords(workflowRecord)
      .map((step) => asPlainRecord(step.retry))
      .find((item): item is Record<string, unknown> => Boolean(item));
  if (!retryRecord) {
    return null;
  }

  const sourceTurnId = readStringField(retryRecord, [
    "sourceTurnId",
    "source_turn_id",
  ]);
  const rescheduledTurnId = readStringField(retryRecord, [
    "rescheduledTurnId",
    "rescheduled_turn_id",
  ]);
  const reason = readStringField(retryRecord, [
    "reason",
    "reasonCode",
    "reason_code",
  ]);
  const linkage =
    sourceTurnId && rescheduledTurnId
      ? `${sourceTurnId} -> ${rescheduledTurnId}`
      : (rescheduledTurnId ?? sourceTurnId);
  return [linkage, reason].filter(Boolean).join(" · ") || null;
}

function readWorkflowWaitingActionValue(
  workflowRecord: Record<string, unknown>,
  t: GeneralWorkbenchWorkflowPanelTranslate,
): string | null {
  const actions = readRecordArray(workflowRecord.actions)
    .map((action) => {
      const actionType = readWorkflowActionPresentationType(action);
      const requestId = readStringField(action, ["requestId", "request_id"]);
      const stepId = readStringField(action, ["stepId", "step_id"]);
      return [formatWorkflowActionTypeLabel(actionType, t), requestId, stepId]
        .filter(Boolean)
        .join(" / ");
    })
    .filter((item) => item.length > 0);
  if (actions.length > 0) {
    return actions.join(", ");
  }

  const waitingSteps = readWorkflowStepRecords(workflowRecord)
    .filter((step) => {
      const status = readStringField(step, ["status"])?.toLowerCase();
      return (
        status === "waiting" ||
        status === "waiting_action" ||
        status === "waitingaction" ||
        status === "waiting_permission"
      );
    })
    .map((step) => {
      const title = readStringField(step, ["title", "stepTitle", "step_title"]);
      const requestId = readStringField(step, ["requestId", "request_id"]);
      const actionType = readStringField(step, [
        "agentActionType",
        "agent_action_type",
      ]);
      return [title, formatWorkflowActionTypeLabel(actionType, t), requestId]
        .filter(Boolean)
        .join(" / ");
    })
    .filter((item) => item.length > 0);
  return waitingSteps.join(", ") || null;
}

function readWorkflowActionPresentationType(
  action: Record<string, unknown>,
): string | null {
  const agentActionType = readStringField(action, [
    "agentActionType",
    "agent_action_type",
  ]);
  if (agentActionType) {
    return agentActionType;
  }
  const actionType = readStringField(action, [
    "actionType",
    "action_type",
    "type",
  ]);
  return actionType === "respond" ? null : actionType;
}

function formatWorkflowActionTypeLabel(
  actionType: string | null,
  t: GeneralWorkbenchWorkflowPanelTranslate,
): string | null {
  if (!actionType) {
    return null;
  }
  const normalized = actionType.trim().toLowerCase();
  if (normalized === "ask_user") {
    return t("generalWorkbench.workflow.runDetail.waitingAction.askUser");
  }
  if (normalized === "elicitation") {
    return t("generalWorkbench.workflow.runDetail.waitingAction.elicitation");
  }
  if (normalized === "tool_confirmation") {
    return t(
      "generalWorkbench.workflow.runDetail.waitingAction.toolConfirmation",
    );
  }
  return actionType;
}

function readWorkflowStepRecords(
  workflowRecord: Record<string, unknown>,
): Record<string, unknown>[] {
  return readRecordArray(workflowRecord.steps);
}

function readFailureText(
  record: Record<string, unknown> | null,
): string | null {
  if (!record) {
    return null;
  }
  return readStringField(record, [
    "message",
    "errorMessage",
    "error_message",
    "reason",
    "reasonCode",
    "reason_code",
    "code",
    "category",
    "failureCategory",
    "failure_category",
  ]);
}

function asPlainRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value
        .map(asPlainRecord)
        .filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
}

function readStringField(
  record: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value !== "string") {
      continue;
    }
    const normalized = value.trim();
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

export function buildGeneralWorkbenchActivityArtifactActionGroup({
  artifactPath,
  sessionId,
  t,
}: {
  artifactPath: string;
  sessionId?: string | null;
  t: GeneralWorkbenchWorkflowPanelTranslate;
}): GeneralWorkbenchActivityArtifactActionGroup {
  return {
    path: artifactPath,
    sessionId: sessionId ?? null,
    actions: [
      {
        kind: "reveal",
        label: t("generalWorkbench.workflow.activity.revealArtifact"),
        ariaLabel: t("generalWorkbench.workflow.activity.revealArtifactAria", {
          path: artifactPath,
        }),
        targetPath: artifactPath,
      },
      {
        kind: "open",
        label: t("generalWorkbench.workflow.activity.openArtifact"),
        ariaLabel: t("generalWorkbench.workflow.activity.openArtifactAria", {
          path: artifactPath,
        }),
        targetPath: artifactPath,
      },
    ],
  };
}

export function buildActivitySummary(
  group: ReturnType<typeof buildGeneralWorkbenchActivityLogGroups>[number],
  gateLabel: string | null,
  t: GeneralWorkbenchWorkflowPanelTranslate,
): string {
  const parts: string[] = [];
  if (gateLabel) {
    parts.push(gateLabel);
  }
  if (group.artifactPaths.length > 0) {
    parts.push(
      group.artifactPaths.length === 1
        ? t("generalWorkbench.workflow.activity.summary.artifactPath", {
            path: group.artifactPaths[0],
          })
        : t("generalWorkbench.workflow.activity.summary.artifactCount", {
            count: group.artifactPaths.length,
          }),
    );
  }
  if (group.logs.length > 1) {
    parts.push(
      t("generalWorkbench.workflow.activity.summary.stepCount", {
        count: group.logs.length,
      }),
    );
  }
  return parts.join(" · ");
}

export function buildActivitySectionSummary(params: {
  groups: ReturnType<typeof buildGeneralWorkbenchActivityLogGroups>;
  activeRunDetail?: Pick<AgentRun, "id"> | null;
  t: GeneralWorkbenchWorkflowPanelTranslate;
}): {
  title: string;
  meta: string;
} {
  const { groups, activeRunDetail, t } = params;
  if (groups.length === 0) {
    return {
      title: t("generalWorkbench.workflow.activity.summary.emptyTitle"),
      meta: t("generalWorkbench.workflow.activity.summary.emptyMeta"),
    };
  }

  const latestGroup = groups[0];
  const primaryLog = getPrimaryActivityLog(latestGroup);
  const gateLabel = formatGateLabel(t, latestGroup.gateKey);
  const sourceLabel = formatActivitySourceLabel(t, latestGroup.source);
  const activeRunLabel = activeRunDetail?.id
    ? formatRunIdShort(activeRunDetail.id) || activeRunDetail.id
    : null;
  const metaParts = [
    latestGroup.timeLabel ||
      t("generalWorkbench.workflow.activity.summary.latestTimeFallback"),
    formatActivityStatusLabel(t, latestGroup.status),
    sourceLabel,
    gateLabel,
    latestGroup.logs.length > 1
      ? t("generalWorkbench.workflow.activity.summary.stepCount", {
          count: latestGroup.logs.length,
        })
      : null,
    latestGroup.artifactPaths.length > 0
      ? t("generalWorkbench.workflow.activity.summary.artifactBadge", {
          count: latestGroup.artifactPaths.length,
        })
      : null,
    activeRunLabel
      ? t("generalWorkbench.workflow.activity.summary.activeRun", {
          run: activeRunLabel,
        })
      : null,
  ].filter(Boolean);

  return {
    title: t("generalWorkbench.workflow.activity.summary.latestTitle", {
      name:
        primaryLog?.name ||
        t("generalWorkbench.workflow.activity.summary.nameFallback"),
    }),
    meta: metaParts.join(" · "),
  };
}

export function buildGeneralWorkbenchActivityLogProjection({
  group,
  t,
}: {
  group: GeneralWorkbenchActivityLogGroup;
  t: GeneralWorkbenchWorkflowPanelTranslate;
}): GeneralWorkbenchActivityLogProjection {
  const gateLabel = formatGateLabel(t, group.gateKey);
  const runLabel = formatRunIdShort(group.runId);
  const sourceLabel = formatActivitySourceLabel(t, group.source);
  const primaryLog = getPrimaryActivityLog(group);
  const stepCountLabel =
    group.logs.length > 1
      ? t("generalWorkbench.workflow.activity.summary.stepCount", {
          count: group.logs.length,
        })
      : null;
  const artifactCountLabel =
    group.artifactPaths.length > 0
      ? t("generalWorkbench.workflow.activity.summary.artifactBadge", {
          count: group.artifactPaths.length,
        })
      : null;

  return {
    key: group.key,
    status: group.status,
    statusLabel: formatActivityStatusLabel(t, group.status),
    title:
      primaryLog?.name ||
      t("generalWorkbench.workflow.activity.summary.nameFallback"),
    timeLabel: group.timeLabel,
    sourceLabel,
    gateLabel,
    stepCountLabel,
    artifactCountLabel,
    summary: buildActivitySummary(group, gateLabel, t) || null,
    runId: group.runId ?? null,
    runLabel: group.runId ? runLabel || group.runId : null,
    runAction: group.runId
      ? {
          runId: group.runId,
          label: t("generalWorkbench.workflow.activity.viewRun", {
            run: runLabel || group.runId,
          }),
        }
      : null,
    artifactPaths: group.runId ? [] : group.artifactPaths,
    artifactActions: group.runId
      ? []
      : group.artifactPaths.map((artifactPath) =>
          buildGeneralWorkbenchActivityArtifactActionGroup({
            artifactPath,
            sessionId: group.sessionId,
            t,
          }),
        ),
    sessionId: group.sessionId ?? null,
    steps: group.logs.map((log) => ({
      id: log.id,
      name: log.name,
      timeLabel: log.timeLabel,
      summary: buildActivityStepSummary(log),
    })),
  };
}

export function buildGeneralWorkbenchActivitySectionProjection({
  groups,
  t,
}: {
  groups: GeneralWorkbenchActivityLogGroup[];
  t: GeneralWorkbenchWorkflowPanelTranslate;
}): GeneralWorkbenchActivitySectionProjection {
  return {
    emptyText: t("generalWorkbench.workflow.activity.empty"),
    loadingText: t("generalWorkbench.workflow.runDetail.loading"),
    runDetailTitle: t("generalWorkbench.workflow.runDetail.title"),
    logs: groups.map((group) =>
      buildGeneralWorkbenchActivityLogProjection({
        group,
        t,
      }),
    ),
  };
}

export function buildGeneralWorkbenchRunDetailProjection({
  activeRunDetail,
  runMetadataSummary,
  runMetadataText,
  activeRunStagesLabel,
  t,
}: {
  activeRunDetail: Pick<AgentRun, "id" | "source" | "status">;
  runMetadataSummary: GeneralWorkbenchRunMetadataSummary;
  runMetadataText: string;
  activeRunStagesLabel?: string | null;
  t: GeneralWorkbenchWorkflowPanelTranslate;
}): GeneralWorkbenchRunDetailProjection {
  const sourceLabel =
    formatActivitySourceLabel(t, activeRunDetail.source) ||
    t("generalWorkbench.workflow.runDetail.fallbackSource");
  const badges = [
    sourceLabel,
    runMetadataSummary.workflow,
    runMetadataSummary.curatedTask?.taskTitle,
    runMetadataSummary.artifactPaths.length > 0
      ? t("generalWorkbench.workflow.runDetail.artifactCount", {
          count: runMetadataSummary.artifactPaths.length,
        })
      : null,
  ].filter((item): item is string => Boolean(item));

  return {
    id: activeRunDetail.id,
    status: activeRunDetail.status,
    statusLabel: formatRunStatusLabel(t, activeRunDetail.status),
    sourceLabel,
    badges,
    summary: buildRunDetailSummaryText({
      runMetadataSummary,
      activeRunStagesLabel,
      t,
    }),
    detailRows: buildGeneralWorkbenchRunDetailFactRows({
      runMetadataText,
      t,
    }),
    actions: buildGeneralWorkbenchRunDetailActions({
      runId: activeRunDetail.id,
      runMetadataText,
      t,
    }),
    artifactPaths: runMetadataSummary.artifactPaths,
    artifacts: runMetadataSummary.artifactPaths.map((artifactPath) =>
      buildGeneralWorkbenchRunDetailArtifactProjection({
        artifactPath,
        t,
      }),
    ),
  };
}
