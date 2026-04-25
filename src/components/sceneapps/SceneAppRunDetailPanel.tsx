import { type SceneAppRunDetailViewModel } from "@/lib/sceneapp";
import type { CuratedTaskRecommendationSignal } from "@/components/agent/chat/utils/curatedTaskRecommendationSignals";
import { cn } from "@/lib/utils";
import { SceneAppReviewFeedbackBanner } from "./SceneAppReviewFeedbackBanner";
import type { SceneAppQuickReviewAction } from "./useSceneAppsPageRuntime";

interface SceneAppRunDetailPanelProps {
  hasSelectedSceneApp: boolean;
  runDetailView: SceneAppRunDetailViewModel | null;
  loading: boolean;
  error?: string | null;
  latestReviewFeedbackSignal?: CuratedTaskRecommendationSignal | null;
  onContinueReviewFeedback?: (taskId: string) => void;
  savedAsInspiration?: boolean;
  onSaveAsInspiration?: () => void;
  onOpenInspirationLibrary?: () => void;
  humanReviewAvailable?: boolean;
  humanReviewLoading?: boolean;
  quickReviewActions?: SceneAppQuickReviewAction[];
  quickReviewPending?: boolean;
  onOpenHumanReview?: () => void;
  onApplyQuickReview?: (
    actionKey: SceneAppQuickReviewAction["key"],
  ) => void;
  onDeliveryArtifactAction?: (
    action: SceneAppRunDetailViewModel["deliveryArtifactEntries"][number],
  ) => void;
  onEntryAction?: (
    action: NonNullable<SceneAppRunDetailViewModel["entryAction"]>,
  ) => void;
  onGovernanceAction?: (
    action: SceneAppRunDetailViewModel["governanceActionEntries"][number],
  ) => void;
  onGovernanceArtifactAction?: (
    action: SceneAppRunDetailViewModel["governanceArtifactEntries"][number],
  ) => void;
}

const RUN_STATUS_CLASSNAMES = {
  queued: "border-slate-200 bg-slate-50 text-slate-700",
  running: "border-sky-200 bg-sky-50 text-sky-700",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  error: "border-rose-200 bg-rose-50 text-rose-700",
  canceled: "border-amber-200 bg-amber-50 text-amber-700",
  timeout: "border-rose-200 bg-rose-50 text-rose-700",
} as const;

const QUICK_REVIEW_TONE_CLASSNAMES = {
  positive: "border-emerald-200 bg-emerald-50/80 hover:border-emerald-300",
  neutral: "border-slate-200 bg-slate-50 hover:border-slate-300",
  warning: "border-amber-200 bg-amber-50/80 hover:border-amber-300",
  risk: "border-rose-200 bg-rose-50/80 hover:border-rose-300",
} as const;

export function SceneAppRunDetailPanel({
  hasSelectedSceneApp,
  runDetailView,
  loading,
  error,
  latestReviewFeedbackSignal = null,
  onContinueReviewFeedback,
  savedAsInspiration = false,
  onSaveAsInspiration,
  onOpenInspirationLibrary,
  humanReviewAvailable = false,
  humanReviewLoading = false,
  quickReviewActions = [],
  quickReviewPending = false,
  onOpenHumanReview,
  onApplyQuickReview,
  onDeliveryArtifactAction,
  onEntryAction,
  onGovernanceAction,
  onGovernanceArtifactAction,
}: SceneAppRunDetailPanelProps) {
  if (!hasSelectedSceneApp) {
    return (
      <section className="rounded-[28px] border border-dashed border-slate-200 bg-white p-5 text-sm leading-6 text-slate-500 shadow-sm shadow-slate-950/5">
        先选一套做法，这里才会带出最近一轮结果。
      </section>
    );
  }

  if (loading && !runDetailView) {
    return (
      <section className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5">
        <div className="text-sm font-semibold text-slate-900">这轮结果</div>
        <div className="mt-5 rounded-[22px] border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
          正在加载这轮结果…
        </div>
      </section>
    );
  }

  if (error && !runDetailView) {
    return (
      <section className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5">
        <div className="text-sm font-semibold text-slate-900">这轮结果</div>
        <div className="mt-5 rounded-[22px] border border-dashed border-rose-200 bg-rose-50 px-4 py-5 text-sm text-rose-700">
          {error}
        </div>
      </section>
    );
  }

  if (!runDetailView) {
    return (
      <section className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5">
        <div className="text-sm font-semibold text-slate-900">这轮结果</div>
        <div className="mt-5 rounded-[22px] border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
          当前还没有可查看的这轮结果，先试跑一轮再回来判断。
        </div>
      </section>
    );
  }

  const entryAction = runDetailView.entryAction;

  return (
    <section className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">这轮结果</div>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            先看这一轮拿到了什么、卡在哪里，以及下一步该怎么接。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onSaveAsInspiration ? (
            <button
              type="button"
              data-testid="sceneapp-run-detail-save-as-inspiration"
              disabled={savedAsInspiration}
              className={cn(
                "inline-flex items-center justify-center rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors",
                savedAsInspiration
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900",
              )}
              onClick={onSaveAsInspiration}
            >
              {savedAsInspiration ? "已收进灵感库" : "保存到灵感库"}
            </button>
          ) : null}
          {loading ? (
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-500">
              刷新中
            </span>
          ) : null}
          <span
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-medium",
              RUN_STATUS_CLASSNAMES[runDetailView.status],
            )}
          >
            {runDetailView.statusLabel}
          </span>
        </div>
      </div>

      {savedAsInspiration ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <p
            className="text-xs leading-5 text-emerald-700"
            data-testid="sceneapp-run-detail-saved-inspiration-hint"
          >
            这轮结果已进入灵感库，下一轮推荐会继续带上它。
          </p>
          {onOpenInspirationLibrary ? (
            <button
              type="button"
              data-testid="sceneapp-run-detail-open-inspiration-library"
              className="inline-flex items-center justify-center rounded-full px-2 py-1 text-xs font-medium text-emerald-800 transition-colors hover:bg-emerald-50 hover:text-emerald-900"
              onClick={onOpenInspirationLibrary}
            >
              去灵感库继续
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="mt-5 rounded-[24px] border border-slate-200 bg-slate-50 p-4">
        <div className="text-[11px] font-semibold tracking-[0.08em] text-lime-700">
          {runDetailView.stageLabel}
        </div>
        <p
          data-testid="sceneapp-run-detail-summary"
          className="mt-2 text-sm leading-7 text-slate-800"
        >
          {runDetailView.summary}
        </p>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {runDetailView.nextAction}
        </p>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <article className="rounded-[22px] border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">这轮记录</div>
          <div className="mt-2 text-sm font-medium text-slate-900">
            {runDetailView.runId}
          </div>
        </article>

        <article className="rounded-[22px] border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">来自哪里</div>
          <div className="mt-2 text-sm font-medium text-slate-900">
            {runDetailView.sourceLabel}
          </div>
        </article>

        <article className="rounded-[22px] border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">已回流结果</div>
          <div className="mt-2 text-sm font-medium text-slate-900">
            {runDetailView.artifactCount} 份
          </div>
        </article>

        <article className="rounded-[22px] border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">开始于</div>
          <div className="mt-2 text-sm font-medium text-slate-900">
            {runDetailView.startedAtLabel}
          </div>
        </article>

        <article className="rounded-[22px] border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">结束于</div>
          <div className="mt-2 text-sm font-medium text-slate-900">
            {runDetailView.finishedAtLabel}
          </div>
        </article>

        <article className="rounded-[22px] border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">这轮用时</div>
          <div className="mt-2 text-sm font-medium text-slate-900">
            {runDetailView.durationLabel}
          </div>
        </article>
      </div>

      <div className="mt-4 rounded-[22px] border border-slate-200 bg-slate-50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-medium text-slate-500">这轮拿到了什么</div>
            <div className="mt-2 text-sm font-medium text-slate-900">
              {runDetailView.deliveryCompletionLabel}
            </div>
          </div>
          {runDetailView.failureSignalLabel ? (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">
              当前卡点：{runDetailView.failureSignalLabel}
            </span>
          ) : null}
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          {runDetailView.deliverySummary}
        </p>

        {runDetailView.deliveryArtifactEntries.length ? (
          <div className="mt-4">
            <div className="text-xs font-medium text-slate-500">可直接打开</div>
            <div className="mt-2 grid gap-3 xl:grid-cols-2">
              {runDetailView.deliveryArtifactEntries.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  data-testid={`sceneapp-run-detail-artifact-entry-${entry.key}`}
                  className="rounded-[18px] border border-slate-200 bg-white p-3 text-left transition-colors hover:border-slate-300 hover:bg-slate-50"
                  onClick={() => onDeliveryArtifactAction?.(entry)}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-900">
                      {entry.label}
                    </span>
                    {entry.isPrimary ? (
                      <span className="rounded-full border border-lime-200 bg-lime-50 px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-lime-700">
                        主结果
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {entry.pathLabel}
                  </div>
                  <div className="mt-2 text-xs leading-5 text-slate-500">
                    {entry.helperText}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {runDetailView.deliveryRequiredParts.length ? (
          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            <div>
              <div className="text-xs font-medium text-slate-500">原本约定</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {runDetailView.deliveryRequiredParts.map((part) => (
                  <span
                    key={`required-${part.key}`}
                    className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700"
                  >
                    {part.label}
                  </span>
                ))}
              </div>
            </div>

            <div>
              <div className="text-xs font-medium text-slate-500">已经拿到</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {runDetailView.deliveryCompletedParts.length ? (
                  runDetailView.deliveryCompletedParts.map((part) => (
                    <span
                      key={`completed-${part.key}`}
                      className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700"
                    >
                      {part.label}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-slate-500">暂未确认</span>
                )}
              </div>
            </div>

            <div>
              <div className="text-xs font-medium text-slate-500">还缺什么</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {runDetailView.deliveryMissingParts.length ? (
                  runDetailView.deliveryMissingParts.map((part) => (
                    <span
                      key={`missing-${part.key}`}
                      className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-medium text-rose-700"
                    >
                      {part.label}
                    </span>
                  ))
                ) : runDetailView.deliveryPartCoverageKnown ? (
                  <span className="text-sm text-slate-500">当前无缺件</span>
                ) : (
                  <span className="text-sm text-slate-500">部件明细待回流</span>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {runDetailView.packCompletionStrategyLabel ||
        runDetailView.packViewerLabel ||
        runDetailView.plannedDeliveryRequiredParts.length ||
        runDetailView.packPlanNotes.length ||
        runDetailView.contextBaseline ? (
          <div className="mt-4 rounded-[18px] border border-dashed border-slate-200 bg-white p-4">
            <div className="text-xs font-medium text-slate-500">启动前约定</div>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              这部分展示开始前约定的结果标准，方便和当前真实回流的覆盖率对照。
            </p>

            {runDetailView.packCompletionStrategyLabel ? (
              <div
                data-testid="sceneapp-run-detail-pack-strategy"
                className="mt-3 text-sm text-slate-700"
              >
                <span className="font-medium text-slate-900">完成口径：</span>
                {runDetailView.packCompletionStrategyLabel}
              </div>
            ) : null}

            {runDetailView.packViewerLabel ? (
              <div className="mt-2 text-sm text-slate-700">
                <span className="font-medium text-slate-900">默认入口：</span>
                {runDetailView.packViewerLabel}
              </div>
            ) : null}

            {runDetailView.plannedDeliveryRequiredParts.length ? (
              <div className="mt-3">
                <div className="text-xs font-medium text-slate-500">原定必含</div>
                <div
                  data-testid="sceneapp-run-detail-pack-required-parts"
                  className="mt-2 flex flex-wrap gap-2"
                >
                  {runDetailView.plannedDeliveryRequiredParts.map((part) => (
                    <span
                      key={`planned-${part.key}`}
                      className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-700"
                    >
                      {part.label}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {runDetailView.packPlanNotes.length ? (
              <div className="mt-3">
                <div className="text-xs font-medium text-slate-500">约定备注</div>
                <div
                  data-testid="sceneapp-run-detail-pack-notes"
                  className="mt-2 flex flex-wrap gap-2"
                >
                  {runDetailView.packPlanNotes.map((note) => (
                    <span
                      key={note}
                      className="rounded-full border border-lime-200 bg-lime-50 px-2.5 py-1 text-[11px] font-medium text-lime-700"
                    >
                      {note}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {runDetailView.contextBaseline ? (
              <div className="mt-4 rounded-[18px] border border-sky-200 bg-sky-50/50 p-3">
                <div className="text-xs font-medium text-slate-500">
                  这轮带入的参考
                </div>
                <div
                  data-testid="sceneapp-run-detail-context-reference-count"
                  className="mt-2 text-sm text-slate-700"
                >
                  <span className="font-medium text-slate-900">参考对象：</span>
                  {runDetailView.contextBaseline.referenceCount} 条
                </div>
                {runDetailView.contextBaseline.scopeLabel ? (
                  <div className="mt-2 text-sm text-slate-700">
                    <span className="font-medium text-slate-900">作用范围：</span>
                    {runDetailView.contextBaseline.scopeLabel}
                  </div>
                ) : null}
                {runDetailView.contextBaseline.referenceItems.length ? (
                  <div
                    data-testid="sceneapp-run-detail-context-reference-items"
                    className="mt-3 flex flex-wrap gap-2"
                  >
                    {runDetailView.contextBaseline.referenceItems.map(
                      (item) => (
                        <span
                          key={item.key}
                          className="rounded-full border border-white bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700"
                        >
                          {item.label}
                          {item.usageLabel ? ` · ${item.usageLabel}` : ""}
                          {item.feedbackLabel ? ` · ${item.feedbackLabel}` : ""}
                        </span>
                      ),
                    )}
                  </div>
                ) : null}
                {runDetailView.contextBaseline.tasteSummary ? (
                  <div
                    data-testid="sceneapp-run-detail-context-taste-summary"
                    className="mt-3 text-sm leading-6 text-slate-700"
                  >
                    <span className="font-medium text-slate-900">风格方向：</span>
                    {runDetailView.contextBaseline.tasteSummary}
                  </div>
                ) : null}
                <SceneAppReviewFeedbackBanner
                  signal={latestReviewFeedbackSignal}
                  dataTestId="sceneapp-run-detail-review-feedback-banner"
                  onContinueReviewFeedback={onContinueReviewFeedback}
                />
                {runDetailView.contextBaseline.feedbackSummary ? (
                  <div
                    data-testid="sceneapp-run-detail-context-feedback-summary"
                    className="mt-3 text-sm leading-6 text-slate-700"
                  >
                    <span className="font-medium text-slate-900">最近反馈：</span>
                    {runDetailView.contextBaseline.feedbackSummary}
                  </div>
                ) : null}
                {runDetailView.contextBaseline.feedbackUpdatedAtLabel ? (
                  <div className="mt-2 text-sm text-slate-700">
                    <span className="font-medium text-slate-900">
                      反馈更新时间：
                    </span>
                    {runDetailView.contextBaseline.feedbackUpdatedAtLabel}
                  </div>
                ) : null}
                {runDetailView.contextBaseline.feedbackSignals.length ? (
                  <div
                    data-testid="sceneapp-run-detail-context-feedback-signals"
                    className="mt-3 flex flex-wrap gap-2"
                  >
                    {runDetailView.contextBaseline.feedbackSignals.map(
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
          </div>
        ) : null}
      </div>

      <div className="mt-4 rounded-[22px] border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-medium text-slate-500">复核与证据</div>
            <div className="mt-2 text-sm font-medium text-slate-900">
              {runDetailView.evidenceSourceLabel}
            </div>
          </div>
          {runDetailView.deliveryViewerLabel ? (
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700">
              结果入口：{runDetailView.deliveryViewerLabel}
            </span>
          ) : null}
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <article className="rounded-[18px] border border-slate-200 bg-slate-50 p-3">
            <div className="text-[11px] font-semibold tracking-[0.08em] text-slate-500">
              关联记录
            </div>
            <p
              data-testid="sceneapp-run-detail-request-telemetry"
              className="mt-2 text-sm leading-6 text-slate-700"
            >
              {runDetailView.requestTelemetryLabel}
            </p>
          </article>

          <article className="rounded-[18px] border border-slate-200 bg-slate-50 p-3">
            <div className="text-[11px] font-semibold tracking-[0.08em] text-slate-500">
              结果校验
            </div>
            <p
              data-testid="sceneapp-run-detail-artifact-validator"
              className="mt-2 text-sm leading-6 text-slate-700"
            >
              {runDetailView.artifactValidatorLabel}
            </p>
          </article>
        </div>

        {runDetailView.governanceArtifactEntries.length ? (
          <div className="mt-4">
            {humanReviewAvailable ? (
              <div className="mb-4">
                <div className="text-xs font-medium text-slate-500">
                  人工复核
                </div>
                <button
                  type="button"
                  data-testid="sceneapp-run-detail-open-human-review"
                  className="mt-2 rounded-[18px] border border-lime-200 bg-lime-50/70 px-3 py-2 text-sm font-medium text-lime-900 transition-colors hover:border-lime-300 hover:bg-white"
                  onClick={() => onOpenHumanReview?.()}
                >
                  {humanReviewLoading ? "准备人工复核…" : "补人工复核"}
                </button>
                {quickReviewActions.length ? (
                  <div className="mt-3 grid gap-3 xl:grid-cols-2">
                    {quickReviewActions.map((action) => (
                      <button
                        key={action.key}
                        type="button"
                        data-testid={`sceneapp-run-detail-quick-review-${action.key}`}
                        disabled={quickReviewPending}
                        className={cn(
                          "rounded-[18px] border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                          QUICK_REVIEW_TONE_CLASSNAMES[action.tone],
                        )}
                        onClick={() => onApplyQuickReview?.(action.key)}
                      >
                        <div className="text-sm font-medium text-slate-900">
                          {action.label}
                        </div>
                        <div className="mt-2 text-xs leading-5 text-slate-600">
                          {action.helperText}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            {runDetailView.governanceActionEntries.length ? (
              <div>
                <div className="text-xs font-medium text-slate-500">继续处理</div>
                <div className="mt-2 grid gap-3 xl:grid-cols-2">
                  {runDetailView.governanceActionEntries.map((entry) => (
                    <button
                      key={entry.key}
                      type="button"
                      data-testid={`sceneapp-run-detail-governance-action-${entry.key}`}
                      className="rounded-[18px] border border-lime-200 bg-lime-50/70 p-3 text-left transition-colors hover:border-lime-300 hover:bg-white"
                      onClick={() => onGovernanceAction?.(entry)}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-slate-900">
                          {entry.label}
                        </span>
                        <span className="rounded-full border border-lime-200 bg-white px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-lime-700">
                          打开 {entry.primaryArtifactLabel}
                        </span>
                      </div>
                      <div className="mt-2 text-xs leading-5 text-slate-600">
                        {entry.helperText}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div
              className={cn(
                "text-xs font-medium text-slate-500",
                runDetailView.governanceActionEntries.length ? "mt-4" : "",
              )}
            >
              可打开材料
            </div>
            <div className="mt-2 grid gap-3 xl:grid-cols-2">
              {runDetailView.governanceArtifactEntries.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  data-testid={`sceneapp-run-detail-governance-entry-${entry.key}`}
                  className="rounded-[18px] border border-slate-200 bg-slate-50 p-3 text-left transition-colors hover:border-slate-300 hover:bg-white"
                  onClick={() => onGovernanceArtifactAction?.(entry)}
                >
                  <div className="text-sm font-medium text-slate-900">
                    {entry.label}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {entry.pathLabel}
                  </div>
                  <div className="mt-2 text-xs leading-5 text-slate-500">
                    {entry.helperText}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {runDetailView.verificationFailureOutcomes.length ? (
          <div className="mt-4">
            <div className="text-xs font-medium text-slate-500">
              当前复核阻塞
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {runDetailView.verificationFailureOutcomes.map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {runDetailView.evidenceKnownGaps.length ? (
          <div className="mt-4">
            <div className="text-xs font-medium text-slate-500">
              当前证据缺口
            </div>
            <div
              data-testid="sceneapp-run-detail-evidence-gaps"
              className="mt-2 flex flex-wrap gap-2"
            >
              {runDetailView.evidenceKnownGaps.map((gap) => (
                <span
                  key={gap}
                  className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600"
                >
                  {gap}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {entryAction ? (
        <div className="mt-4 rounded-[22px] border border-slate-200 bg-slate-50/80 p-4">
          <div className="text-xs font-medium text-slate-500">回到来源继续</div>
          <div className="mt-2 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <p className="text-sm leading-6 text-slate-600">
              {entryAction.helperText}
            </p>
            <button
              type="button"
              data-testid="sceneapp-run-detail-entry-action"
              className="inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50 hover:text-slate-900"
              onClick={() => onEntryAction?.(entryAction)}
            >
              {entryAction.label}
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="mt-4 rounded-[20px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-700">
          这轮详情接口暂时不可用，当前先展示列表里的摘要信息。{error}
        </div>
      ) : null}
    </section>
  );
}
