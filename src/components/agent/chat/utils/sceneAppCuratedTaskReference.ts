import type {
  SceneAppExecutionSummaryViewModel,
  SceneAppRunDetailViewModel,
} from "@/lib/sceneapp/product";
import {
  buildCuratedTaskLaunchInputPrefillFromReferenceEntries,
  extractCuratedTaskReferenceMemoryIds,
  mergeCuratedTaskReferenceEntries,
  type CuratedTaskReferenceEntry,
} from "./curatedTaskReferenceSelection";
import {
  buildCuratedTaskLaunchPrompt,
  findCuratedTaskTemplateById,
} from "./curatedTaskTemplates";
import type { InputCapabilitySendRoute } from "../skill-selection/inputCapabilitySelection";

function normalizeOptionalText(value?: string | null): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : undefined;
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function dedupeNonEmptyText(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => normalizeOptionalText(value))
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

function buildSceneAppExistingResultsSummary(params: {
  summary: SceneAppExecutionSummaryViewModel;
  latestRunDetailView?: SceneAppRunDetailViewModel | null;
}): string {
  const { summary, latestRunDetailView } = params;
  const sections = [
    summary.summary,
    latestRunDetailView?.summary,
    latestRunDetailView?.deliveryCompletionLabel,
    latestRunDetailView?.failureSignalLabel
      ? `当前卡点：${latestRunDetailView.failureSignalLabel}`
      : null,
    latestRunDetailView?.nextAction
      ? `建议下一步：${latestRunDetailView.nextAction}`
      : null,
    summary.feedbackSummary,
  ];

  return truncateText(dedupeNonEmptyText(sections).join(" "), 280);
}

export function buildCuratedTaskReferenceEntryFromSceneAppExecution(params: {
  summary?: SceneAppExecutionSummaryViewModel | null;
  latestRunDetailView?: SceneAppRunDetailViewModel | null;
}): CuratedTaskReferenceEntry | null {
  const { summary, latestRunDetailView } = params;
  const sceneappId = normalizeOptionalText(summary?.sceneappId);
  if (!summary || !sceneappId) {
    return null;
  }

  const runId =
    normalizeOptionalText(latestRunDetailView?.runId) ||
    normalizeOptionalText(summary.runtimeBackflow?.runId);
  const id = runId
    ? `sceneapp:${sceneappId}:run:${runId}`
    : `sceneapp:${sceneappId}`;
  const title = normalizeOptionalText(summary.title) || "当前项目结果";
  const summaryText = truncateText(
    dedupeNonEmptyText([
      latestRunDetailView?.summary,
      summary.runtimeBackflow?.summary,
      summary.feedbackSummary,
      summary.summary,
    ]).join(" "),
    180,
  );
  const tags = dedupeNonEmptyText([
    summary.businessLabel,
    summary.typeLabel,
    latestRunDetailView?.statusLabel,
    latestRunDetailView?.failureSignalLabel,
    summary.runtimeBackflow?.topFailureSignalLabel,
    ...summary.scorecardFailureSignals.map((item) => item.label),
  ]).slice(0, 6);

  return {
    id,
    sourceKind: "sceneapp_execution_summary",
    title,
    summary: summaryText || "当前已有一轮项目结果与执行摘要，可直接带入复盘。",
    category: "experience",
    categoryLabel: "成果",
    tags,
    taskPrefillByTaskId: {
      "account-project-review": {
        project_goal:
          normalizeOptionalText(summary.title) ||
          "复盘当前这轮项目结果并明确下一步优化动作",
        existing_results: buildSceneAppExistingResultsSummary({
          summary,
          latestRunDetailView,
        }),
      },
    },
  };
}

export function buildSceneAppExecutionReviewFollowUpAction(params: {
  referenceEntries?: Array<CuratedTaskReferenceEntry | null | undefined> | null;
}): {
  prompt: string;
  capabilityRoute: Extract<InputCapabilitySendRoute, { kind: "curated_task" }>;
} | null {
  const task = findCuratedTaskTemplateById("account-project-review");
  if (!task) {
    return null;
  }

  const referenceEntries = mergeCuratedTaskReferenceEntries(
    params.referenceEntries ?? [],
  ).slice(0, 3);
  if (referenceEntries.length === 0) {
    return null;
  }

  const inputValues =
    buildCuratedTaskLaunchInputPrefillFromReferenceEntries({
      taskId: task.id,
      referenceEntries,
    });
  const prompt = buildCuratedTaskLaunchPrompt({
    task,
    inputValues: inputValues ?? {},
    referenceEntries,
  }).trim();
  if (!prompt) {
    return null;
  }

  const referenceMemoryIds =
    extractCuratedTaskReferenceMemoryIds(referenceEntries) ?? [];

  return {
    prompt,
    capabilityRoute: {
      kind: "curated_task",
      taskId: task.id,
      taskTitle: task.title,
      prompt,
      ...(inputValues
        ? {
            launchInputValues: inputValues,
          }
        : {}),
      ...(referenceMemoryIds.length > 0
        ? {
            referenceMemoryIds,
          }
        : {}),
      referenceEntries,
    },
  };
}
