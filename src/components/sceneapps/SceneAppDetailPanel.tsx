import {
  type SceneAppDetailViewModel,
} from "@/lib/sceneapp";
import { ProjectSelector } from "@/components/projects/ProjectSelector";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface SceneAppDetailPanelProps {
  detailView: SceneAppDetailViewModel | null;
  projectId: string | null;
  launchInput: string;
  launchDisabledReason?: string;
  launching: boolean;
  onProjectChange: (projectId: string) => void;
  onLaunchInputChange: (value: string) => void;
  onLaunch: () => void;
}

export function SceneAppDetailPanel({
  detailView,
  projectId,
  launchInput,
  launchDisabledReason,
  launching,
  onProjectChange,
  onLaunchInputChange,
  onLaunch,
}: SceneAppDetailPanelProps) {
  if (!detailView) {
    return (
      <section className="rounded-[28px] border border-dashed border-slate-200 bg-white p-6 text-sm leading-6 text-slate-500 shadow-sm shadow-slate-950/5">
        先回到场景目录选择一个 SceneApp，再补齐启动意图和项目工作区。
      </section>
    );
  }

  return (
    <section className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold tracking-[0.08em] text-lime-700">
              {detailView.businessLabel}
            </div>
            <h2
              data-testid="sceneapp-detail-title"
              className="mt-1 text-xl font-semibold text-slate-900"
            >
              {detailView.title}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              {detailView.summary}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600">
              {detailView.typeLabel}
            </span>
            <span className="rounded-full border border-lime-200 bg-lime-50 px-2.5 py-1 text-[11px] font-medium text-lime-700">
              {detailView.deliveryContractLabel}
            </span>
          </div>
        </div>

        <div className="rounded-[24px] border border-slate-200 bg-slate-50/70 p-4">
          <div className="text-sm font-medium text-slate-900">
            {detailView.valueStatement}
          </div>
          <div className="mt-2 grid gap-2 text-sm text-slate-500 md:grid-cols-2">
            <div>
              <span className="font-medium text-slate-700">产出：</span>
              {detailView.outputHint}
            </div>
            <div>
              <span className="font-medium text-slate-700">执行主链：</span>
              {detailView.executionChainLabel}
            </div>
            <div>
              <span className="font-medium text-slate-700">来源包：</span>
              {detailView.sourcePackageId}
            </div>
            <div>
              <span className="font-medium text-slate-700">版本：</span>
              {detailView.sourcePackageVersion}
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="rounded-[24px] border border-slate-200 bg-white p-4">
            <div className="text-sm font-medium text-slate-900">设计模式</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {detailView.patternLabels.map((patternLabel) => (
                <span
                  key={patternLabel}
                  className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-700"
                >
                  {patternLabel}
                </span>
              ))}
            </div>
          </div>

          <div className="rounded-[24px] border border-slate-200 bg-white p-4">
            <div className="text-sm font-medium text-slate-900">启动前置</div>
            {detailView.launchRequirements.length === 0 ? (
              <p className="mt-3 text-sm leading-6 text-slate-500">
                这个 SceneApp 没有额外前置条件，可以直接启动。
              </p>
            ) : (
              <div className="mt-3 flex flex-col gap-2">
                {detailView.launchRequirements.map((message, index) => (
                  <div
                    key={`${detailView.id}-requirement-${index}`}
                    className="rounded-[18px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-600"
                  >
                    {message}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-3">
          <div className="rounded-[24px] border border-slate-200 bg-white p-4">
            <div className="text-sm font-medium text-slate-900">交付合同</div>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              {detailView.deliveryNarrative}
            </p>
            <div className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
              <div>
                <span className="font-medium text-slate-700">主结果：</span>
                {detailView.outputHint}
              </div>
              {detailView.deliveryPrimaryPart ? (
                <div>
                  <span className="font-medium text-slate-700">默认主件：</span>
                  {detailView.deliveryPrimaryPart}
                </div>
              ) : null}
              {detailView.deliveryViewerLabel ? (
                <div>
                  <span className="font-medium text-slate-700">查看方式：</span>
                  {detailView.deliveryViewerLabel}
                </div>
              ) : null}
              {detailView.artifactProfileRef ? (
                <div data-testid="sceneapp-detail-artifact-ref">
                  <span className="font-medium text-slate-700">Artifact：</span>
                  {detailView.artifactProfileRef}
                </div>
              ) : null}
            </div>
            {detailView.deliveryRequiredParts.length ? (
              <div
                data-testid="sceneapp-detail-delivery-parts"
                className="mt-3 flex flex-wrap gap-2"
              >
                {detailView.deliveryRequiredParts.map((part) => (
                  <span
                    key={part.key}
                    className="rounded-full border border-lime-200 bg-lime-50 px-2.5 py-1 text-[11px] font-medium text-lime-700"
                  >
                    {part.label}
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm leading-6 text-slate-500">
                当前还没有显式声明必含交付部件，后续需要继续补齐。
              </p>
            )}
          </div>

          <div className="rounded-[24px] border border-slate-200 bg-white p-4">
            <div className="text-sm font-medium text-slate-900">组合步骤</div>
            {detailView.compositionBlueprintRef ? (
              <div className="mt-3 space-y-3">
                <div
                  data-testid="sceneapp-detail-blueprint-ref"
                  className="text-sm leading-6 text-slate-600"
                >
                  <span className="font-medium text-slate-700">蓝图：</span>
                  {detailView.compositionBlueprintRef}
                </div>
                <div className="text-sm leading-6 text-slate-600">
                  <span className="font-medium text-slate-700">阶段数：</span>
                  {detailView.compositionStepCount}
                </div>
                {detailView.compositionSteps.length ? (
                  <div className="flex flex-col gap-2">
                    {detailView.compositionSteps.map((step) => (
                      <div
                        key={step.id}
                        className="rounded-[18px] border border-slate-200 bg-slate-50 px-3 py-2"
                      >
                        <div className="text-sm font-medium text-slate-700">
                          {step.title}
                        </div>
                        {step.bindingLabel ? (
                          <div className="mt-1 text-xs text-slate-500">
                            执行面：{step.bindingLabel}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="mt-3 text-sm leading-6 text-slate-500">
                当前 SceneApp 还没有显式组合蓝图，继续按单阶段 binding 运行。
              </p>
            )}
          </div>

          <div className="rounded-[24px] border border-slate-200 bg-white p-4">
            <div className="text-sm font-medium text-slate-900">评分口径</div>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              {detailView.scorecardNarrative}
            </p>
            {detailView.scorecardProfileRef ? (
              <div
                data-testid="sceneapp-detail-scorecard-ref"
                className="mt-3 text-sm leading-6 text-slate-600"
              >
                <span className="font-medium text-slate-700">Profile：</span>
                {detailView.scorecardProfileRef}
              </div>
            ) : null}
            {detailView.scorecardMetricKeys.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {detailView.scorecardMetricKeys.map((metric) => (
                  <span
                    key={metric.key}
                    className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700"
                  >
                    {metric.label}
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm leading-6 text-slate-500">
                当前 profile 还没有显式暴露指标键，后续会继续和真实评分聚合对齐。
              </p>
            )}
            {detailView.scorecardFailureSignals.length ? (
              <div className="mt-3">
                <div className="text-xs font-medium text-slate-500">
                  重点关注
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {detailView.scorecardFailureSignals.map((signal) => (
                    <span
                      key={signal.key}
                      className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700"
                    >
                      {signal.label}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="rounded-[24px] border border-slate-200 bg-white p-4">
          <div className="text-sm font-medium text-slate-900">启动输入</div>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            这一步只负责补齐场景意图，真正执行仍继续复用 Agent 或自动化主链。
          </p>

          <div className="mt-4">
            <div className="mb-2 text-xs font-medium text-slate-500">
              项目工作区
            </div>
            <ProjectSelector
              value={projectId}
              workspaceType="general"
              placeholder="选择项目工作区"
              dropdownSide="bottom"
              onChange={onProjectChange}
            />
          </div>

          <div className="mt-4">
            <div className="mb-2 text-xs font-medium text-slate-500">
              启动意图
            </div>
            <Textarea
              value={launchInput}
              placeholder={detailView.launchInputPlaceholder}
              className="min-h-[128px] rounded-[20px] border-slate-200 bg-slate-50 text-sm leading-6"
              onChange={(event) => onLaunchInputChange(event.target.value)}
            />
          </div>

          <div className="mt-4 rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-[11px] font-medium text-slate-500">
              {detailView.launchSeedLabel}
            </div>
            <div className="mt-1 text-sm leading-6 text-slate-700">
              {detailView.launchSeedPreview}
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="min-h-[20px] text-xs text-amber-600">
              {launchDisabledReason ?? ""}
            </div>
            <Button
              type="button"
              data-testid="sceneapp-page-launch"
              className={cn(
                "rounded-full px-5",
                "bg-slate-900 text-white hover:bg-slate-800",
              )}
              disabled={Boolean(launchDisabledReason) || launching}
              onClick={onLaunch}
            >
              {launching ? "准备中…" : detailView.launchActionLabel}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
