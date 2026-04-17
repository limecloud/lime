import {
  type SceneAppRunDetailViewModel,
  type SceneAppScorecardViewModel,
} from "@/lib/sceneapp";
import { cn } from "@/lib/utils";
import { SceneAppProjectPackRuntimePanel } from "./SceneAppProjectPackRuntimePanel";

interface SceneAppScorecardPanelProps {
  scorecardView: SceneAppScorecardViewModel | null;
  packRuntimeView: SceneAppRunDetailViewModel | null;
  packRuntimeLoading?: boolean;
  packRuntimeUsesFallback?: boolean;
  loading: boolean;
  error?: string | null;
  onPackRuntimeArtifactAction?: (
    action: SceneAppRunDetailViewModel["deliveryArtifactEntries"][number],
  ) => void;
}

const METRIC_STATUS_CLASSNAMES = {
  good: "border-emerald-200 bg-emerald-50 text-emerald-700",
  watch: "border-amber-200 bg-amber-50 text-amber-700",
  risk: "border-rose-200 bg-rose-50 text-rose-700",
} as const;

export function SceneAppScorecardPanel({
  scorecardView,
  packRuntimeView,
  packRuntimeLoading = false,
  packRuntimeUsesFallback = false,
  loading,
  error,
  onPackRuntimeArtifactAction,
}: SceneAppScorecardPanelProps) {
  return (
    <section className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">经营评分</div>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            用统一 scorecard
            判断这个场景交付的结果是否值得继续放大、优化还是收口。
          </p>
        </div>
        {scorecardView?.hasRuntimeScorecard && scorecardView.actionLabel ? (
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600">
            {scorecardView.actionLabel}
          </span>
        ) : null}
      </div>

      {loading ? (
        <div className="mt-5 rounded-[22px] border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
          正在加载评分数据…
        </div>
      ) : !scorecardView ? (
        error ? (
          <div className="mt-5 rounded-[22px] border border-dashed border-rose-200 bg-rose-50 px-4 py-5 text-sm text-rose-700">
            {error}
          </div>
        ) : (
          <div className="mt-5 rounded-[22px] border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
            当前还没有评分数据，先跑一次结果链再看表现。
          </div>
        )
      ) : (
        <>
          {error ? (
            <div
              data-testid="sceneapp-scorecard-error-banner"
              className="mt-5 rounded-[22px] border border-dashed border-rose-200 bg-rose-50 px-4 py-5 text-sm text-rose-700"
            >
              {error}
            </div>
          ) : null}
          <p className="mt-5 text-sm leading-6 text-slate-700">
            {scorecardView.summary}
          </p>
          {scorecardView.deliveryContractLabel ||
          scorecardView.viewerLabel ||
          scorecardView.completionStrategyLabel ||
          scorecardView.deliveryRequiredParts.length ||
          scorecardView.packPlanNotes.length ||
          scorecardView.profileRef ||
          scorecardView.metricKeys.length ||
          scorecardView.failureSignals.length ? (
            <div className="mt-4 rounded-[22px] border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-medium text-slate-500">
                当前经营口径
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-700">
                {scorecardView.operatingNarrative}
              </p>
              {scorecardView.deliveryContractLabel ? (
                <div className="mt-3 text-sm text-slate-700">
                  <span className="font-medium text-slate-900">交付合同：</span>
                  {scorecardView.deliveryContractLabel}
                </div>
              ) : null}
              {scorecardView.viewerLabel ? (
                <div className="mt-2 text-sm text-slate-700">
                  <span className="font-medium text-slate-900">查看方式：</span>
                  {scorecardView.viewerLabel}
                </div>
              ) : null}
              {scorecardView.completionStrategyLabel ? (
                <div
                  data-testid="sceneapp-scorecard-completion-strategy"
                  className="mt-2 text-sm text-slate-700"
                >
                  <span className="font-medium text-slate-900">完成口径：</span>
                  {scorecardView.completionStrategyLabel}
                </div>
              ) : null}
              {scorecardView.deliveryRequiredParts.length ? (
                <div
                  data-testid="sceneapp-scorecard-delivery-parts"
                  className="mt-3 flex flex-wrap gap-2"
                >
                  {scorecardView.deliveryRequiredParts.map((part) => (
                    <span
                      key={part.key}
                      className="rounded-full border border-lime-200 bg-lime-50 px-2.5 py-1 text-[11px] font-medium text-lime-700"
                    >
                      {part.label}
                    </span>
                  ))}
                </div>
              ) : null}
              {scorecardView.profileRef ? (
                <div
                  data-testid="sceneapp-scorecard-profile-ref"
                  className="mt-3 text-sm text-slate-700"
                >
                  <span className="font-medium text-slate-900">Profile：</span>
                  {scorecardView.profileRef}
                </div>
              ) : null}
              {scorecardView.metricKeys.length ? (
                <div
                  data-testid="sceneapp-scorecard-metric-keys"
                  className="mt-3 flex flex-wrap gap-2"
                >
                  {scorecardView.metricKeys.map((metric) => (
                    <span
                      key={metric.key}
                      className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700"
                    >
                      {metric.label}
                    </span>
                  ))}
                </div>
              ) : null}
              {scorecardView.failureSignals.length ? (
                <div
                  data-testid="sceneapp-scorecard-failure-signals"
                  className="mt-3 flex flex-wrap gap-2"
                >
                  {scorecardView.failureSignals.map((signal) => (
                    <span
                      key={signal.key}
                      className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700"
                    >
                      {signal.label}
                    </span>
                  ))}
                </div>
              ) : null}
              {scorecardView.topFailureSignalLabel ? (
                <div className="mt-3 text-sm text-slate-700">
                  <span className="font-medium text-slate-900">
                    当前主要阻塞：
                  </span>
                  {scorecardView.topFailureSignalLabel}
                </div>
              ) : null}
              {scorecardView.packPlanNotes.length ? (
                <div className="mt-3">
                  <div className="text-xs font-medium text-slate-500">
                    规划备注
                  </div>
                  <div
                    data-testid="sceneapp-scorecard-pack-notes"
                    className="mt-2 flex flex-wrap gap-2"
                  >
                    {scorecardView.packPlanNotes.map((note) => (
                      <span
                        key={note}
                        className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-700"
                      >
                        {note}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              {scorecardView.contextBaseline ? (
                <div className="mt-4 rounded-[18px] border border-sky-200 bg-white px-3 py-3">
                  <div className="text-xs font-medium text-slate-500">
                    Planning 基线
                  </div>
                  <div
                    data-testid="sceneapp-scorecard-context-reference-count"
                    className="mt-2 text-sm text-slate-700"
                  >
                    <span className="font-medium text-slate-900">
                      参考注入：
                    </span>
                    {scorecardView.contextBaseline.referenceCount} 条
                  </div>
                  {scorecardView.contextBaseline.scopeLabel ? (
                    <div className="mt-2 text-sm text-slate-700">
                      <span className="font-medium text-slate-900">
                        作用域：
                      </span>
                      {scorecardView.contextBaseline.scopeLabel}
                    </div>
                  ) : null}
                  {scorecardView.contextBaseline.referenceItems.length ? (
                    <div
                      data-testid="sceneapp-scorecard-context-reference-items"
                      className="mt-3 flex flex-wrap gap-2"
                    >
                      {scorecardView.contextBaseline.referenceItems.map(
                        (item) => (
                          <span
                            key={item.key}
                            className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700"
                          >
                            {item.label}
                            {item.usageLabel ? ` · ${item.usageLabel}` : ""}
                            {item.feedbackLabel
                              ? ` · ${item.feedbackLabel}`
                              : ""}
                          </span>
                        ),
                      )}
                    </div>
                  ) : null}
                  {scorecardView.contextBaseline.tasteSummary ? (
                    <div
                      data-testid="sceneapp-scorecard-context-taste-summary"
                      className="mt-3 text-sm leading-6 text-slate-700"
                    >
                      <span className="font-medium text-slate-900">
                        风格摘要：
                      </span>
                      {scorecardView.contextBaseline.tasteSummary}
                    </div>
                  ) : null}
                  {scorecardView.contextBaseline.feedbackSummary ? (
                    <div
                      data-testid="sceneapp-scorecard-context-feedback-summary"
                      className="mt-3 text-sm leading-6 text-slate-700"
                    >
                      <span className="font-medium text-slate-900">
                        最近反馈：
                      </span>
                      {scorecardView.contextBaseline.feedbackSummary}
                    </div>
                  ) : null}
                  {scorecardView.contextBaseline.feedbackUpdatedAtLabel ? (
                    <div className="mt-2 text-sm text-slate-700">
                      <span className="font-medium text-slate-900">
                        反馈更新时间：
                      </span>
                      {scorecardView.contextBaseline.feedbackUpdatedAtLabel}
                    </div>
                  ) : null}
                  {scorecardView.contextBaseline.feedbackSignals.length ? (
                    <div
                      data-testid="sceneapp-scorecard-context-feedback-signals"
                      className="mt-3 flex flex-wrap gap-2"
                    >
                      {scorecardView.contextBaseline.feedbackSignals.map(
                        (signal) => (
                          <span
                            key={signal.key}
                            className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-medium text-rose-700"
                          >
                            {signal.label}
                          </span>
                        ),
                      )}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {scorecardView.observedFailureSignals.length ? (
                <div
                  data-testid="sceneapp-scorecard-observed-failure-signals"
                  className="mt-3 flex flex-wrap gap-2"
                >
                  {scorecardView.observedFailureSignals.map((signal) => (
                    <span
                      key={signal.key}
                      className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-medium text-rose-700"
                    >
                      {signal.label}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {scorecardView.hasRuntimeScorecard ? (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {scorecardView.metrics.map((metric) => (
                <article
                  key={metric.key}
                  className="rounded-[22px] border border-slate-200 bg-slate-50/70 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-sm font-medium text-slate-700">
                      {metric.label}
                    </div>
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                        METRIC_STATUS_CLASSNAMES[metric.status],
                      )}
                    >
                      {metric.value}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-[22px] border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
              {error
                ? "评分服务暂时不可用，已保留当前 profile 与指标口径，稍后重试。"
                : "当前还没有真实评分数据，先跑一次结果链再看表现。"}
            </div>
          )}

          <div className="mt-4">
            <SceneAppProjectPackRuntimePanel
              title="最近可消费结果"
              description="把经营评分和最近一轮可打开的 Project Pack 样本绑在一起，避免只剩分数、没有结果入口。"
              emptyMessage="当前还没有可直接打开的结果样本，先跑出一轮带真实文件回流的 Project Pack，再结合 scorecard 继续判断。"
              testIdPrefix="sceneapp-scorecard-pack"
              runDetailView={packRuntimeView}
              loading={packRuntimeLoading}
              usesFallbackRun={packRuntimeUsesFallback}
              onDeliveryArtifactAction={onPackRuntimeArtifactAction}
            />
          </div>
        </>
      )}
    </section>
  );
}
