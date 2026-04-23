import type { AutomationJobRecord } from "@/lib/api/automation";
import type {
  SceneAppAutomationWorkspaceCardViewModel,
  SceneAppRunDetailViewModel,
} from "@/lib/sceneapp";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WorkbenchInfoTip } from "@/components/media/WorkbenchInfoTip";

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
  workspaceName,
  summaryCard = null,
  runDetailView = null,
  loading = false,
  error = null,
  onOpenJobDetails,
  onOpenSceneAppDetail,
  onOpenSceneAppGovernance,
  onReviewCurrentProject,
}: AutomationOverviewFocusCardProps) {
  return (
    <Card
      className="rounded-[28px] border-slate-200/80 bg-white shadow-sm shadow-slate-950/5"
      data-testid="automation-overview-focus-card"
    >
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-xl text-slate-900">
                当前经营焦点
              </CardTitle>
              <WorkbenchInfoTip
                ariaLabel="当前经营焦点说明"
                content="概览页只抬一条最值得继续看的持续流程，直接告诉你这轮判断、下一步和最值得进入的业务去向。"
                tone="slate"
              />
            </div>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              用一条持续流程回答“现在最该继续哪一套做法”。
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
            当前还没有接到做法主链的持续流程。等一条自动化任务带着做法上下文跑起来后，这里会自动显示“最值得继续”的经营焦点。
          </div>
        ) : null}

        {job && loading && !summaryCard ? (
          <div className="rounded-[22px] border border-dashed border-slate-200 bg-slate-50/60 p-6 text-sm leading-6 text-slate-500">
            正在整理这条持续流程对应的做法摘要和经营判断…
          </div>
        ) : null}

        {job ? (
          <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-white bg-white px-3 py-1 text-xs font-medium text-slate-700">
                持续流程：{job.name}
              </span>
              <span className="rounded-full border border-white bg-white px-3 py-1 text-xs font-medium text-slate-700">
                工作区：{workspaceName ?? job.workspace_id}
              </span>
              {summaryCard ? (
                <>
                  <span className="rounded-full border border-white bg-white px-3 py-1 text-xs font-medium text-slate-700">
                    {summaryCard.title}
                  </span>
                  <span className="rounded-full border border-white bg-white px-3 py-1 text-xs font-medium text-slate-700">
                    {summaryCard.businessLabel}
                  </span>
                </>
              ) : null}
            </div>

            {summaryCard ? (
              <>
                <div className="mt-4 rounded-[18px] border border-white bg-white px-4 py-4">
                  <div className="text-sm leading-7 text-slate-800">
                    {summaryCard.summary}
                  </div>
                  <div className="mt-2 text-sm leading-6 text-slate-600">
                    {summaryCard.nextAction}
                  </div>
                </div>

                {summaryCard.scorecardAggregate ? (
                  <div className="mt-4 rounded-[18px] border border-white bg-white px-4 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-xs font-medium text-slate-500">
                        经营判断
                      </div>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
                        {summaryCard.scorecardAggregate.statusLabel}
                      </span>
                      {summaryCard.scorecardAggregate.actionLabel ? (
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                          {summaryCard.scorecardAggregate.actionLabel}
                        </span>
                      ) : null}
                      {summaryCard.scorecardAggregate.topFailureSignalLabel ? (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
                          {summaryCard.scorecardAggregate.topFailureSignalLabel}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-3 text-sm leading-6 text-slate-800">
                      {summaryCard.scorecardAggregate.summary}
                    </div>
                    <div className="mt-2 text-sm leading-6 text-slate-600">
                      {summaryCard.scorecardAggregate.nextAction}
                    </div>
                    {summaryCard.scorecardAggregate.destinations.length ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {summaryCard.scorecardAggregate.destinations.map(
                          (destination) => (
                            <span
                              key={destination.key}
                              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700"
                            >
                              {destination.label}
                            </span>
                          ),
                        )}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : null}

            {runDetailView ? (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-[18px] border border-white bg-white px-4 py-3">
                  <div className="text-xs font-medium text-slate-500">
                    最近结果
                  </div>
                  <div className="mt-2 text-sm font-medium text-slate-900">
                    {runDetailView.statusLabel} · {runDetailView.deliveryCompletionLabel}
                  </div>
                  <div className="mt-2 text-sm leading-6 text-slate-600">
                    {runDetailView.summary}
                  </div>
                </div>
                <div className="rounded-[18px] border border-white bg-white px-4 py-3">
                  <div className="text-xs font-medium text-slate-500">
                    当前更适合
                  </div>
                  <div className="mt-2 text-sm leading-6 text-slate-600">
                    {runDetailView.nextAction}
                  </div>
                </div>
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
                  继续复盘当前项目
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
                  去做法复盘
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
                  回生成准备
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
                  查看任务详情
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
