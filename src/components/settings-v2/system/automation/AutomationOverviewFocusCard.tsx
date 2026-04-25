import type { AutomationJobRecord } from "@/lib/api/automation";
import type {
  SceneAppAutomationWorkspaceCardViewModel,
  SceneAppRunDetailViewModel,
} from "@/lib/sceneapp";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface AutomationOverviewFocusCardProps {
  job: AutomationJobRecord | null;
  workspaceName: string | null;
  summaryCard?: SceneAppAutomationWorkspaceCardViewModel | null;
  runDetailView?: SceneAppRunDetailViewModel | null;
  loading?: boolean;
  error?: string | null;
  onOpenJobDetails?: () => void;
  onOpenSceneAppDetail?: () => void;
  onOpenSceneAppGovernance?: () => void;
  onReviewCurrentProject?: () => void;
}

export function AutomationOverviewFocusCard({
  job,
  workspaceName: _workspaceName,
  summaryCard = null,
  runDetailView = null,
  loading = false,
  error = null,
  onOpenJobDetails,
  onOpenSceneAppDetail,
  onOpenSceneAppGovernance,
  onReviewCurrentProject,
}: AutomationOverviewFocusCardProps) {
  const focusSummary =
    summaryCard?.scorecardAggregate?.summary ??
    summaryCard?.summary ??
    runDetailView?.summary ??
    null;
  const focusNextAction =
    summaryCard?.scorecardAggregate?.nextAction ??
    runDetailView?.nextAction ??
    summaryCard?.nextAction ??
    null;
  const focusActionLabel =
    summaryCard?.scorecardAggregate?.actionLabel ?? summaryCard?.statusLabel ?? null;
  const focusSignalLabel =
    summaryCard?.scorecardAggregate?.topFailureSignalLabel ?? null;

  return (
    <Card
      className="rounded-[28px] border-slate-200/80 bg-white shadow-sm shadow-slate-950/5"
      data-testid="automation-overview-focus-card"
    >
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-xl text-slate-900">
              现在先继续这条
            </CardTitle>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              持续流程里只抬一条最值得续上的做法和下一步。
            </p>
          </div>
          {summaryCard ? (
            <Badge variant="secondary">{summaryCard.statusLabel}</Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!job ? (
          <div className="rounded-[22px] border border-dashed border-slate-200 bg-slate-50/60 p-6 text-sm leading-6 text-slate-500">
            还没有持续接上的做法。等一条持续流程真的带着结果跑起来后，这里会自动接上。
          </div>
        ) : null}

        {job && loading && !summaryCard ? (
          <div className="rounded-[22px] border border-dashed border-slate-200 bg-slate-50/60 p-6 text-sm leading-6 text-slate-500">
            正在整理这条做法最近一轮的结果和下一步…
          </div>
        ) : null}

        {job ? (
          <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-white bg-white px-3 py-1 text-xs font-medium text-slate-700">
                {job.name}
              </span>
              {summaryCard ? (
                <>
                  <span className="rounded-full border border-white bg-white px-3 py-1 text-xs font-medium text-slate-700">
                    {summaryCard.title}
                  </span>
                </>
              ) : null}
              {focusActionLabel ? (
                <span className="rounded-full border border-white bg-white px-3 py-1 text-xs font-medium text-slate-700">
                  {focusActionLabel}
                </span>
              ) : null}
              {focusSignalLabel ? (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
                  {focusSignalLabel}
                </span>
              ) : null}
            </div>

            {focusSummary || focusNextAction ? (
              <div className="mt-4 rounded-[18px] border border-white bg-white px-4 py-4">
                {focusSummary ? (
                  <div className="text-sm leading-7 text-slate-800">
                    {focusSummary}
                  </div>
                ) : null}
                {focusNextAction ? (
                  <div className="mt-2 text-sm leading-6 text-slate-600">
                    先做：{focusNextAction}
                  </div>
                ) : null}
              </div>
            ) : null}

            {runDetailView ? (
              <div className="mt-4 rounded-[18px] border border-white bg-white px-4 py-3">
                <div className="text-xs font-medium text-slate-500">
                  最近结果
                </div>
                <div className="mt-2 text-sm font-medium text-slate-900">
                  {runDetailView.statusLabel} ·{" "}
                  {runDetailView.deliveryCompletionLabel}
                </div>
                {runDetailView.summary ? (
                  <div className="mt-2 text-sm leading-6 text-slate-600">
                    {runDetailView.summary}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              {onReviewCurrentProject ? (
                <Button
                  type="button"
                  size="sm"
                  data-testid="automation-overview-review-current-project"
                  onClick={onReviewCurrentProject}
                >
                  继续看这轮结果
                </Button>
              ) : null}
              {onOpenSceneAppGovernance ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  data-testid="automation-overview-open-governance"
                  onClick={onOpenSceneAppGovernance}
                >
                  看最近结果
                </Button>
              ) : null}
              {onOpenSceneAppDetail ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  data-testid="automation-overview-open-detail"
                  onClick={onOpenSceneAppDetail}
                >
                  回补这轮信息
                </Button>
              ) : null}
              {onOpenJobDetails ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  data-testid="automation-overview-open-job-details"
                  onClick={onOpenJobDetails}
                >
                  看这条详情
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="rounded-[18px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-700">
            {error}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
