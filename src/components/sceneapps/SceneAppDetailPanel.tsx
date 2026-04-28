import {
  type SceneAppDetailViewModel,
  type SceneAppRunDetailViewModel,
} from "@/lib/sceneapp";
import { ProjectSelector } from "@/components/projects/ProjectSelector";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { SceneAppProjectPackRuntimePanel } from "./SceneAppProjectPackRuntimePanel";

interface SceneAppDetailPanelProps {
  detailView: SceneAppDetailViewModel | null;
  packRuntimeView: SceneAppRunDetailViewModel | null;
  packRuntimeLoading?: boolean;
  packRuntimeUsesFallback?: boolean;
  projectId: string | null;
  launchInput: string;
  planLoading: boolean;
  planError?: string | null;
  saveBaselineDisabledReason?: string;
  launchDisabledReason?: string;
  savingContextBaseline: boolean;
  launching: boolean;
  onProjectChange: (projectId: string) => void;
  onLaunchInputChange: (value: string) => void;
  onPackRuntimeArtifactAction?: (
    action: SceneAppRunDetailViewModel["deliveryArtifactEntries"][number],
  ) => void;
  onSaveContextBaseline: () => void;
  onLaunch: () => void;
}

export function SceneAppDetailPanel({
  detailView,
  packRuntimeView,
  packRuntimeLoading = false,
  packRuntimeUsesFallback = false,
  projectId,
  launchInput,
  planLoading,
  planError,
  saveBaselineDisabledReason,
  launchDisabledReason,
  savingContextBaseline,
  launching,
  onProjectChange,
  onLaunchInputChange,
  onPackRuntimeArtifactAction,
  onSaveContextBaseline,
  onLaunch,
}: SceneAppDetailPanelProps) {
  if (!detailView) {
    return (
      <section className="rounded-[28px] border border-dashed border-slate-200 bg-white p-6 text-sm leading-6 text-slate-500 shadow-sm shadow-slate-950/5">
        先回到全部做法选一套做法，再来补参考、启动信息和结果落点。
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
              <span className="font-medium text-slate-700">会拿到：</span>
              {detailView.outputHint}
            </div>
            <div>
              <span className="font-medium text-slate-700">推进方式：</span>
              {detailView.executionChainLabel}
            </div>
            <div>
              <span className="font-medium text-slate-700">做法来源：</span>
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
            <div className="text-sm font-medium text-slate-900">
              这套做法擅长
            </div>
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
            <div className="text-sm font-medium text-slate-900">
              启动前先确认
            </div>
            {detailView.launchRequirements.length === 0 ? (
              <p className="mt-3 text-sm leading-6 text-slate-500">
                这套做法没有额外前置条件，可以直接进入生成。
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
            <div className="text-sm font-medium text-slate-900">
              默认会拿到
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              {detailView.deliveryNarrative}
            </p>
            <div className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
              <div>
                <span className="font-medium text-slate-700">默认主结果：</span>
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
                  <span className="font-medium text-slate-700">默认入口：</span>
                  {detailView.deliveryViewerLabel}
                </div>
              ) : null}
              {detailView.artifactProfileRef ? (
                <div data-testid="sceneapp-detail-artifact-ref">
                  <span className="font-medium text-slate-700">结果说明：</span>
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
                当前这套做法还没有明确必含结果，后续需要继续补齐。
              </p>
            )}
          </div>

          <div className="rounded-[24px] border border-slate-200 bg-white p-4">
            <div className="text-sm font-medium text-slate-900">
              通常会这样推进
            </div>
            {detailView.compositionBlueprintRef ? (
              <div className="mt-3 space-y-3">
                <div
                  data-testid="sceneapp-detail-blueprint-ref"
                  className="text-sm leading-6 text-slate-600"
                >
                  <span className="font-medium text-slate-700">步骤说明：</span>
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
                            承接面：{step.bindingLabel}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="mt-3 text-sm leading-6 text-slate-500">
                当前这套做法还没有拆出明确步骤，先按当前默认路径继续推进。
              </p>
            )}
          </div>

          <div className="rounded-[24px] border border-slate-200 bg-white p-4">
            <div className="text-sm font-medium text-slate-900">
              默认怎么判断
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              {detailView.scorecardNarrative}
            </p>
            {detailView.scorecardProfileRef ? (
              <div
                data-testid="sceneapp-detail-scorecard-ref"
                className="mt-3 text-sm leading-6 text-slate-600"
              >
                <span className="font-medium text-slate-700">判断说明：</span>
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
                当前这套做法还没有整理出显式判断指标，后续会继续按真实结果补齐。
              </p>
            )}
            {detailView.scorecardFailureSignals.length ? (
              <div className="mt-3">
                <div className="text-xs font-medium text-slate-500">先盯这些</div>
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

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
          <div className="rounded-[24px] border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="text-sm font-medium text-slate-900">
                这轮准备情况
              </div>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                {detailView.planning.statusLabel}
              </span>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              {detailView.planning.summary}
            </p>
            {planLoading ? (
              <p className="mt-3 text-xs font-medium text-lime-700">
                正在根据当前项目与输入刷新准备情况…
              </p>
            ) : null}
            {planError ? (
              <p className="mt-3 text-sm leading-6 text-amber-700">
                {planError}
              </p>
            ) : null}
            {detailView.planning.unmetRequirements.length ? (
              <div className="mt-4">
                <div className="text-xs font-medium text-slate-500">还差这些</div>
                <div
                  data-testid="sceneapp-detail-planning-unmet"
                  className="mt-2 flex flex-col gap-2"
                >
                  {detailView.planning.unmetRequirements.map(
                    (message, index) => (
                      <div
                        key={`${detailView.id}-planning-unmet-${index}`}
                        className="rounded-[18px] border border-amber-200 bg-amber-50/70 px-3 py-2 text-sm leading-6 text-amber-800"
                      >
                        {message}
                      </div>
                    ),
                  )}
                </div>
              </div>
            ) : null}
            {detailView.contextPlan ? (
              <div className="mt-4 space-y-3">
                {detailView.contextPlan.activeLayers.length ? (
                  <div>
                    <div className="text-xs font-medium text-slate-500">
                      这轮已带入
                    </div>
                    <div
                      data-testid="sceneapp-detail-context-layers"
                      className="mt-2 flex flex-wrap gap-2"
                    >
                      {detailView.contextPlan.activeLayers.map((layer) => (
                        <span
                          key={layer.key}
                          className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-700"
                        >
                          {layer.label}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div
                  data-testid="sceneapp-detail-context-reference-count"
                  className="text-sm leading-6 text-slate-600"
                >
                  <span className="font-medium text-slate-700">参考对象：</span>
                  {detailView.contextPlan.referenceCount} 条
                </div>
                {detailView.contextPlan.scopeLabel ? (
                  <div
                    data-testid="sceneapp-detail-context-scope"
                    className="text-sm leading-6 text-slate-600"
                  >
                    <span className="font-medium text-slate-700">作用范围：</span>
                    {detailView.contextPlan.scopeLabel}
                  </div>
                ) : null}
                {detailView.contextPlan.skillRefs.length ? (
                  <div>
                    <div className="text-xs font-medium text-slate-500">
                      已接入做法
                    </div>
                    <div
                      data-testid="sceneapp-detail-context-skill-refs"
                      className="mt-2 flex flex-wrap gap-2"
                    >
                      {detailView.contextPlan.skillRefs.map((skillRef) => (
                        <span
                          key={skillRef.key}
                          className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-medium text-violet-700"
                        >
                          {skillRef.label}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
                {detailView.contextPlan.memoryRefs.length ? (
                  <div>
                    <div className="text-xs font-medium text-slate-500">
                      历史经验
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {detailView.contextPlan.memoryRefs.map((memoryRef) => (
                        <span
                          key={memoryRef.key}
                          className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600"
                        >
                          {memoryRef.label}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
                {detailView.contextPlan.toolRefs.length ? (
                  <div>
                    <div className="text-xs font-medium text-slate-500">
                      可用能力
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {detailView.contextPlan.toolRefs.map((toolRef) => (
                        <span
                          key={toolRef.key}
                          className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700"
                        >
                          {toolRef.label}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
                {detailView.contextPlan.referenceItems.length ? (
                  <div>
                    <div className="text-xs font-medium text-slate-500">
                      参考条目
                    </div>
                    <div
                      data-testid="sceneapp-detail-context-reference-items"
                      className="mt-2 grid gap-3"
                    >
                      {detailView.contextPlan.referenceItems.map(
                        (reference) => (
                          <div
                            key={reference.key}
                            className="rounded-[18px] border border-slate-200 bg-slate-50 px-3 py-3"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium text-slate-900">
                                {reference.label}
                              </span>
                              <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-slate-600">
                                {reference.sourceLabel}
                              </span>
                              <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-sky-700">
                                {reference.contentTypeLabel}
                              </span>
                            </div>
                            {reference.summary ? (
                              <div className="mt-2 text-sm leading-6 text-slate-600">
                                {reference.summary}
                              </div>
                            ) : null}
                            {reference.uri ? (
                              <div className="mt-1 break-all text-xs leading-5 text-slate-500">
                                {reference.uri}
                              </div>
                            ) : null}
                            {reference.usageLabel || reference.feedbackLabel ? (
                              <div className="mt-2 flex flex-wrap gap-2">
                                {reference.usageLabel ? (
                                  <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600">
                                    {reference.usageLabel}
                                  </span>
                                ) : null}
                                {reference.feedbackLabel ? (
                                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                                    {reference.feedbackLabel}
                                  </span>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        ),
                      )}
                    </div>
                  </div>
                ) : null}
                {detailView.contextPlan.tasteSummary ? (
                  <div
                    data-testid="sceneapp-detail-context-taste-summary"
                    className="rounded-[18px] border border-lime-200 bg-lime-50/70 px-3 py-2 text-sm leading-6 text-lime-900"
                  >
                    <span className="font-medium">当前风格方向：</span>
                    {detailView.contextPlan.tasteSummary}
                  </div>
                ) : null}
                {detailView.contextPlan.feedbackSummary ? (
                  <div
                    data-testid="sceneapp-detail-context-feedback-summary"
                    className="rounded-[18px] border border-sky-200 bg-sky-50/70 px-3 py-2 text-sm leading-6 text-sky-900"
                  >
                    <span className="font-medium">最近判断：</span>
                    {detailView.contextPlan.feedbackSummary}
                  </div>
                ) : null}
                {detailView.contextPlan.feedbackUpdatedAtLabel ? (
                  <div className="text-sm leading-6 text-slate-600">
                    <span className="font-medium text-slate-700">
                      反馈更新时间：
                    </span>
                    {detailView.contextPlan.feedbackUpdatedAtLabel}
                  </div>
                ) : null}
                {detailView.contextPlan.feedbackSignals.length ? (
                  <div>
                    <div className="text-xs font-medium text-slate-500">
                      判断信号
                    </div>
                    <div
                      data-testid="sceneapp-detail-context-feedback-signals"
                      className="mt-2 flex flex-wrap gap-2"
                    >
                      {detailView.contextPlan.feedbackSignals.map((signal) => (
                        <span
                          key={signal.key}
                          className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-medium text-rose-700"
                        >
                          {signal.label}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
                {detailView.contextPlan.tasteKeywords.length ? (
                  <div>
                    <div className="text-xs font-medium text-slate-500">
                      偏好关键词
                    </div>
                    <div
                      data-testid="sceneapp-detail-context-taste-keywords"
                      className="mt-2 flex flex-wrap gap-2"
                    >
                      {detailView.contextPlan.tasteKeywords.map((keyword) => (
                        <span
                          key={keyword.key}
                          className="rounded-full border border-lime-200 bg-lime-50 px-2.5 py-1 text-[11px] font-medium text-lime-700"
                        >
                          {keyword.label}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
                {detailView.contextPlan.avoidKeywords.length ? (
                  <div>
                    <div className="text-xs font-medium text-slate-500">
                      避免方向
                    </div>
                    <div
                      data-testid="sceneapp-detail-context-avoid-keywords"
                      className="mt-2 flex flex-wrap gap-2"
                    >
                      {detailView.contextPlan.avoidKeywords.map((keyword) => (
                        <span
                          key={keyword.key}
                          className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700"
                        >
                          {keyword.label}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
                {detailView.contextPlan.notes.length ? (
                  <div className="space-y-2">
                    {detailView.contextPlan.notes.map((note, index) => (
                      <div
                        key={`${detailView.id}-context-note-${index}`}
                        className="rounded-[18px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-600"
                      >
                        {note}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="mt-4 text-sm leading-6 text-slate-500">
                当前还没有整理出这轮带入对象，继续补项目或启动输入后会自动刷新。
              </p>
            )}
            {detailView.planning.warnings.length ? (
              <div className="mt-4 space-y-2">
                {detailView.planning.warnings.map((warning, index) => (
                  <div
                    key={`${detailView.id}-planning-warning-${index}`}
                    className="rounded-[18px] border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-800"
                  >
                    {warning}
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div className="rounded-[24px] border border-slate-200 bg-white p-4">
            <div className="text-sm font-medium text-slate-900">
              默认结果去向
            </div>
            {detailView.projectPackPlan ? (
              <>
                <div className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
                  <div>
                    <span className="font-medium text-slate-700">结果形态：</span>
                    {detailView.projectPackPlan.packKindLabel}
                  </div>
                  <div data-testid="sceneapp-detail-pack-strategy">
                    <span className="font-medium text-slate-700">
                      完成口径：
                    </span>
                    {detailView.projectPackPlan.completionStrategyLabel}
                  </div>
                  {detailView.projectPackPlan.primaryPart ? (
                    <div>
                      <span className="font-medium text-slate-700">主件：</span>
                      {detailView.projectPackPlan.primaryPart}
                    </div>
                  ) : null}
                  {detailView.projectPackPlan.viewerLabel ? (
                    <div>
                      <span className="font-medium text-slate-700">默认入口：</span>
                      {detailView.projectPackPlan.viewerLabel}
                    </div>
                  ) : null}
                </div>
                {detailView.projectPackPlan.requiredParts.length ? (
                  <div
                    data-testid="sceneapp-detail-pack-required-parts"
                    className="mt-3 flex flex-wrap gap-2"
                  >
                    {detailView.projectPackPlan.requiredParts.map((part) => (
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
                    当前这套做法还没有明确整套结果的必含部分，继续沿现有结果回流主链执行。
                  </p>
                )}
                {detailView.projectPackPlan.notes.length ? (
                  <div className="mt-4 space-y-2">
                    {detailView.projectPackPlan.notes.map((note, index) => (
                      <div
                        key={`${detailView.id}-pack-note-${index}`}
                        className="rounded-[18px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-600"
                      >
                        {note}
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <p className="mt-3 text-sm leading-6 text-slate-500">
                当前这套做法还没有明确结果去向，继续沿现有结果约定运行。
              </p>
            )}
          </div>

          <SceneAppProjectPackRuntimePanel
            title="最近结果样本"
            description="先看最近一轮真实拿到了什么，避免准备页只剩说明，没有样本可对照。"
            emptyMessage="当前还没有可直接消费的结果文件。先跑出一轮正式样本，再回来从准备页直接打开结果。"
            testIdPrefix="sceneapp-detail-pack"
            runDetailView={packRuntimeView}
            loading={packRuntimeLoading}
            usesFallbackRun={packRuntimeUsesFallback}
            onDeliveryArtifactAction={onPackRuntimeArtifactAction}
          />
        </div>

        <div className="rounded-[24px] border border-slate-200 bg-white p-4">
          <div className="text-sm font-medium text-slate-900">
            开始这次生成
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            这一步只负责补齐你这次的目标、参考和结果落点；真正执行会进入生成。
          </p>

          <div className="mt-4">
            <div className="mb-2 text-xs font-medium text-slate-500">
              结果沉淀到
            </div>
            <ProjectSelector
              value={projectId}
              workspaceType="general"
              placeholder="选择结果要落到的项目"
              dropdownSide="bottom"
              onChange={onProjectChange}
            />
          </div>

          <div className="mt-4">
            <div className="mb-2 text-xs font-medium text-slate-500">
              这次想让它做什么
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

          <p className="mt-4 text-xs leading-5 text-slate-500">
            保存这次带入对象后，当前参考、输入摘要和风格偏好会一起沉淀到项目目录，方便下次继续沿用。
          </p>
          {saveBaselineDisabledReason ? (
            <p className="mt-2 text-xs text-amber-600">
              {saveBaselineDisabledReason}
            </p>
          ) : null}

          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="min-h-[20px] text-xs text-amber-600">
              {launchDisabledReason ?? ""}
            </div>
            <div className="flex items-center gap-3">
              <Button
                type="button"
                data-testid="sceneapp-save-context-baseline"
                variant="outline"
                className={cn(
                  "rounded-full border-slate-200 px-5 text-slate-700 hover:bg-slate-50",
                )}
                disabled={
                  Boolean(saveBaselineDisabledReason) || savingContextBaseline
                }
                onClick={onSaveContextBaseline}
              >
                {savingContextBaseline ? "保存中…" : "保存这次带入"}
              </Button>
              <Button
                type="button"
                data-testid="sceneapp-page-launch"
                className={cn(
                  "rounded-full px-5",
                  "border border-emerald-200 bg-[image:var(--lime-primary-gradient)] text-white shadow-sm shadow-emerald-950/15 hover:opacity-95",
                )}
                disabled={Boolean(launchDisabledReason) || launching}
                onClick={onLaunch}
              >
                {launching ? "准备中…" : detailView.launchActionLabel}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
