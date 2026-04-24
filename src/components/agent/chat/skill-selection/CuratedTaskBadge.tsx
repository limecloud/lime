import React, { useEffect, useMemo, useState } from "react";
import { ListChecks, PencilLine, X } from "lucide-react";
import {
  buildCuratedTaskCapabilityDescription,
  buildCuratedTaskFollowUpDescription,
  findCuratedTaskTemplateById,
  type CuratedTaskTemplateItem,
} from "../utils/curatedTaskTemplates";
import {
  listCuratedTaskRecommendationSignals,
  subscribeCuratedTaskRecommendationSignalsChanged,
} from "../utils/curatedTaskRecommendationSignals";
import { buildReviewFeedbackProjection } from "../utils/reviewFeedbackProjection";
import type { CuratedTaskReferenceEntry } from "../utils/curatedTaskReferenceSelection";
import {
  buildSceneAppExecutionReviewPrefillHighlights,
  buildSceneAppExecutionReviewPrefillSnapshot,
} from "../utils/sceneAppCuratedTaskReference";

interface CuratedTaskBadgeProps {
  task: CuratedTaskTemplateItem;
  projectId?: string | null;
  sessionId?: string | null;
  referenceEntries?: CuratedTaskReferenceEntry[] | null;
  onEdit?: () => void;
  onApplyReviewSuggestion?: (task: CuratedTaskTemplateItem) => void;
  onClear: () => void;
}

function truncateBadgeReviewText(value: string, maxLength = 28): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength).trimEnd()}...`;
}

export const CuratedTaskBadge: React.FC<CuratedTaskBadgeProps> = ({
  task,
  projectId,
  sessionId,
  referenceEntries,
  onEdit,
  onApplyReviewSuggestion,
  onClear,
}) => {
  const [recommendationSignalsVersion, setRecommendationSignalsVersion] =
    useState(0);

  useEffect(() => {
    return subscribeCuratedTaskRecommendationSignalsChanged(() => {
      setRecommendationSignalsVersion((previous) => previous + 1);
    });
  }, []);

  const followUpSummary = buildCuratedTaskFollowUpDescription(task, {
    limit: 2,
  });
  const badgeTitle = buildCuratedTaskCapabilityDescription(task, {
    includeSummary: false,
    includeResultDestination: true,
    includeFollowUpActions: true,
    followUpLimit: 2,
  });
  const sceneAppReviewSnapshot = useMemo(() => {
    return buildSceneAppExecutionReviewPrefillSnapshot({
      referenceEntries,
      taskId: task.id,
    });
  }, [referenceEntries, task.id]);
  const sceneAppReviewHighlights = useMemo(
    () =>
      buildSceneAppExecutionReviewPrefillHighlights(sceneAppReviewSnapshot),
    [sceneAppReviewSnapshot],
  );
  const latestReviewSignal = useMemo(() => {
    void recommendationSignalsVersion;
    return (
      listCuratedTaskRecommendationSignals({
        projectId,
        sessionId,
      })
        .filter((signal) => signal.source === "review_feedback")
        .sort((left, right) => right.createdAt - left.createdAt)[0] ?? null
    );
  }, [projectId, recommendationSignalsVersion, sessionId]);
  const reviewProjection = useMemo(
    () =>
      buildReviewFeedbackProjection({
        signal: latestReviewSignal,
        currentTaskId: task.id,
        currentTaskTitle: task.title,
      }),
    [latestReviewSignal, task.id, task.title],
  );
  const visibleReviewProjection =
    reviewProjection &&
    (reviewProjection.matchedCurrentTask || Boolean(onApplyReviewSuggestion))
      ? reviewProjection
      : null;
  const primarySuggestedTask = useMemo(() => {
    if (!visibleReviewProjection || visibleReviewProjection.matchedCurrentTask) {
      return null;
    }

    const suggestedTaskId = visibleReviewProjection.suggestedTasks[0]?.taskId;
    if (!suggestedTaskId) {
      return null;
    }

    return findCuratedTaskTemplateById(suggestedTaskId);
  }, [visibleReviewProjection]);
  const reviewSummary = visibleReviewProjection
    ? truncateBadgeReviewText(
        visibleReviewProjection.matchedCurrentTask
          ? visibleReviewProjection.signal.title.startsWith("最近复盘")
            ? visibleReviewProjection.signal.title
            : `复盘：${visibleReviewProjection.signal.title}`
          : `更适合：${primarySuggestedTask?.title || visibleReviewProjection.signal.title}`,
      )
    : null;
  const sceneAppStatusSummary = sceneAppReviewSnapshot?.statusLabel
    ? truncateBadgeReviewText(
        `当前判断：${sceneAppReviewSnapshot.statusLabel}`,
        34,
      )
    : sceneAppReviewSnapshot?.failureSignalLabel
      ? truncateBadgeReviewText(
          `当前卡点：${sceneAppReviewSnapshot.failureSignalLabel}`,
          34,
        )
      : null;
  const sceneAppNextSummary = sceneAppReviewSnapshot?.destinationsLabel
    ? truncateBadgeReviewText(
        `更适合去向：${sceneAppReviewSnapshot.destinationsLabel}`,
        28,
      )
    : sceneAppReviewSnapshot?.operatingAction
      ? truncateBadgeReviewText(
          `经营动作：${sceneAppReviewSnapshot.operatingAction}`,
          28,
        )
      : null;
  const sceneAppSummaryTitle =
    sceneAppReviewSnapshot && sceneAppReviewHighlights.length > 0
      ? [
          `当前结果基线：${sceneAppReviewSnapshot.sourceTitle}`,
          ...sceneAppReviewHighlights,
        ].join(" · ")
      : sceneAppReviewSnapshot?.sourceTitle
        ? `当前结果基线：${sceneAppReviewSnapshot.sourceTitle}`
        : null;

  return (
    <div
      data-testid="curated-task-badge"
      className="mx-1 mt-1 inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-md bg-amber-500/10 px-2 py-1.5 text-xs font-medium text-amber-700"
      title={badgeTitle || task.title}
    >
      <ListChecks className="h-3 w-3" />
      <span>{task.title}</span>
      {reviewSummary ? (
        <span
          data-testid="curated-task-badge-review-signal"
          className="inline-flex max-w-[240px] items-center rounded-full border border-emerald-300/70 bg-white/90 px-2 py-0.5 text-[11px] leading-4 text-emerald-700"
          title={`围绕最近复盘 · ${visibleReviewProjection?.signal.summary || visibleReviewProjection?.signal.title || ""}`}
        >
          <span className="truncate">
            {visibleReviewProjection?.matchedCurrentTask
              ? `围绕最近复盘 · ${reviewSummary}`
              : reviewSummary}
          </span>
        </span>
      ) : null}
      {primarySuggestedTask && onApplyReviewSuggestion ? (
        <button
          type="button"
          data-testid="curated-task-badge-review-action"
          className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-white/90 px-2 py-0.5 text-[11px] leading-4 text-sky-700 transition hover:bg-white"
          title={`按最近复盘切到「${primarySuggestedTask.title}」`}
          onClick={() => onApplyReviewSuggestion(primarySuggestedTask)}
        >
          <span className="truncate">改用「{primarySuggestedTask.title}」</span>
        </button>
      ) : null}
      {sceneAppStatusSummary ? (
        <span
          data-testid="curated-task-badge-sceneapp-status"
          className="inline-flex max-w-[240px] items-center rounded-full border border-sky-300/70 bg-white/90 px-2 py-0.5 text-[11px] leading-4 text-sky-700"
          title={sceneAppSummaryTitle || undefined}
        >
          <span className="truncate">{sceneAppStatusSummary}</span>
        </span>
      ) : null}
      {sceneAppNextSummary ? (
        <span
          data-testid="curated-task-badge-sceneapp-next"
          className="inline-flex max-w-[220px] items-center rounded-full border border-emerald-300/70 bg-white/90 px-2 py-0.5 text-[11px] leading-4 text-emerald-700"
          title={sceneAppSummaryTitle || undefined}
        >
          <span className="truncate">{sceneAppNextSummary}</span>
        </span>
      ) : null}
      {followUpSummary ? (
        <span className="inline-flex max-w-[320px] items-center rounded-full border border-amber-300/70 bg-white/80 px-2 py-0.5 text-[11px] leading-4 text-amber-700">
          <span className="truncate">{followUpSummary}</span>
        </span>
      ) : null}
      {onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          className="ml-0.5 inline-flex items-center gap-1 rounded-full border border-amber-300/80 bg-white/80 px-1.5 py-0.5 text-[11px] text-amber-700 transition hover:bg-white"
          aria-label={`编辑 ${task.title} 启动信息`}
          title="重新编辑启动信息"
        >
          <PencilLine className="h-3 w-3" />
          <span>编辑</span>
        </button>
      ) : null}
      <button
        type="button"
        onClick={onClear}
        className="ml-0.5 hover:opacity-70"
        aria-label={`清除 ${task.title}`}
        title="清除当前结果模板"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
};
