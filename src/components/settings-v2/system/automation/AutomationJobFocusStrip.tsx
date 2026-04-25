import type { SceneAppAutomationWorkspaceCardViewModel } from "@/lib/sceneapp";
import type { SceneAppRunDetailViewModel } from "@/lib/sceneapp";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface AutomationJobFocusStripProps {
  jobId: string;
  summaryCard?: SceneAppAutomationWorkspaceCardViewModel | null;
  runDetailView?: SceneAppRunDetailViewModel | null;
  loading?: boolean;
  error?: string | null;
  onReviewCurrentProject?: () => void;
  onOpenSceneAppGovernance?: () => void;
}

export function AutomationJobFocusStrip({
  jobId,
  summaryCard = null,
  runDetailView = null,
  loading = false,
  error = null,
  onReviewCurrentProject,
  onOpenSceneAppGovernance,
}: AutomationJobFocusStripProps) {
  const primarySummary =
    summaryCard?.scorecardAggregate?.summary ?? summaryCard?.summary ?? null;
  const nextAction =
    summaryCard?.scorecardAggregate?.nextAction ??
    runDetailView?.nextAction ??
    summaryCard?.nextAction ??
    null;

  return (
    <div
      data-testid={`automation-job-focus-strip-${jobId}`}
      className="mt-3 rounded-[18px] border border-sky-200/80 bg-sky-50/80 px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="border-sky-200 bg-white text-sky-700 hover:bg-white">
          现在先继续这条
        </Badge>
        {summaryCard?.title ? (
          <span className="rounded-full border border-white bg-white px-3 py-1 text-xs font-medium text-slate-700">
            {summaryCard.title}
          </span>
        ) : null}
        {summaryCard?.statusLabel ? (
          <span className="rounded-full border border-white bg-white px-3 py-1 text-xs font-medium text-slate-700">
            {summaryCard.statusLabel}
          </span>
        ) : null}
      </div>

      {loading && !primarySummary ? (
        <div className="mt-3 text-xs leading-6 text-slate-600">
          正在整理这条做法最近一轮的结果和下一步…
        </div>
      ) : null}

      {primarySummary ? (
        <div className="mt-3 text-xs leading-6 text-slate-700">
          这轮判断：{primarySummary}
        </div>
      ) : null}

      {runDetailView ? (
        <div className="mt-1 text-xs leading-6 text-slate-600">
          最近结果：{runDetailView.statusLabel} ·{" "}
          {runDetailView.deliveryCompletionLabel}
        </div>
      ) : null}

      {nextAction ? (
        <div className="mt-1 text-xs leading-6 text-slate-600">
          先做：{nextAction}
        </div>
      ) : null}

      {error ? (
        <div className="mt-2 text-xs leading-6 text-amber-700">{error}</div>
      ) : null}

      {onReviewCurrentProject || onOpenSceneAppGovernance ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {onReviewCurrentProject ? (
            <Button
              type="button"
              size="sm"
              className="h-8 rounded-full bg-slate-900 px-3 text-xs hover:bg-slate-800"
              data-testid={`automation-job-focus-review-${jobId}`}
              onClick={(event) => {
                event.stopPropagation();
                onReviewCurrentProject();
              }}
            >
              继续看结果
            </Button>
          ) : null}
          {onOpenSceneAppGovernance ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 rounded-full border-sky-200 bg-white px-3 text-xs text-sky-700 hover:bg-sky-100 hover:text-sky-800"
              data-testid={`automation-job-focus-governance-${jobId}`}
              onClick={(event) => {
                event.stopPropagation();
                onOpenSceneAppGovernance();
              }}
            >
              看最近结果
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
