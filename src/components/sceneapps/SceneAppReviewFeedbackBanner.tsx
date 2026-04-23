import {
  buildReviewFeedbackProjection,
  type ReviewFeedbackProjection,
} from "@/components/agent/chat/utils/reviewFeedbackProjection";
import type { CuratedTaskRecommendationSignal } from "@/components/agent/chat/utils/curatedTaskRecommendationSignals";

interface SceneAppReviewFeedbackBannerProps {
  signal?: CuratedTaskRecommendationSignal | null;
  dataTestId?: string;
  onContinueReviewFeedback?: (taskId: string) => void;
}

function SceneAppReviewFeedbackProjectionBanner({
  projection,
  dataTestId,
  onContinueReviewFeedback,
}: {
  projection: ReviewFeedbackProjection;
  dataTestId?: string;
  onContinueReviewFeedback?: (taskId: string) => void;
}) {
  const primarySuggestedTask = projection.suggestedTasks[0] ?? null;

  return (
    <div
      className="mt-3 rounded-[16px] border border-emerald-200 bg-emerald-50/70 px-3 py-3"
      data-testid={dataTestId}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-emerald-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
          围绕最近复盘
        </span>
        {projection.suggestedTaskTitles.length > 0 ? (
          <span className="rounded-full border border-white bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600">
            {projection.suggestedTaskTitles.join(" / ")}
          </span>
        ) : null}
      </div>
      <div className="mt-2 text-sm font-medium leading-6 text-slate-900">
        最近复盘已更新：{projection.signal.title}
      </div>
      <div className="mt-1 text-sm leading-6 text-slate-600">
        {projection.signal.summary}
      </div>
      <div className="mt-1 text-sm leading-6 text-slate-600">
        {projection.suggestionText}
      </div>
      {primarySuggestedTask && onContinueReviewFeedback ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-emerald-300 hover:bg-emerald-50"
            data-testid={dataTestId ? `${dataTestId}-action` : undefined}
            onClick={() => onContinueReviewFeedback(primarySuggestedTask.taskId)}
          >
            继续去「{primarySuggestedTask.title}」
          </button>
          <span className="text-xs leading-5 text-slate-500">
            会继续带着当前结果基线，不用重新整理一遍。
          </span>
        </div>
      ) : null}
    </div>
  );
}

export function SceneAppReviewFeedbackBanner({
  signal = null,
  dataTestId,
  onContinueReviewFeedback,
}: SceneAppReviewFeedbackBannerProps) {
  const projection = buildReviewFeedbackProjection({ signal });
  if (!projection) {
    return null;
  }

  return (
    <SceneAppReviewFeedbackProjectionBanner
      projection={projection}
      dataTestId={dataTestId}
      onContinueReviewFeedback={onContinueReviewFeedback}
    />
  );
}
