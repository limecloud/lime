import type {
  SceneAppGovernancePanelViewModel,
  SceneAppRunDetailViewModel,
} from "@/lib/sceneapp";
import type { CuratedTaskRecommendationSignal } from "@/components/agent/chat/utils/curatedTaskRecommendationSignals";
import { cn } from "@/lib/utils";
import { SceneAppReviewFeedbackBanner } from "./SceneAppReviewFeedbackBanner";
import type { SceneAppQuickReviewAction } from "./useSceneAppsPageRuntime";

interface SceneAppGovernancePanelProps {
  hasSelectedSceneApp: boolean;
  governanceView: SceneAppGovernancePanelViewModel | null;
  loading: boolean;
  error?: string | null;
  latestReviewFeedbackSignal?: CuratedTaskRecommendationSignal | null;
  onContinueReviewFeedback?: (taskId: string) => void;
  humanReviewAvailable?: boolean;
  humanReviewLoading?: boolean;
  quickReviewActions?: SceneAppQuickReviewAction[];
  quickReviewPending?: boolean;
  onOpenHumanReview?: () => void;
  onApplyQuickReview?: (actionKey: SceneAppQuickReviewAction["key"]) => void;
  onGovernanceAction?: (
    action: SceneAppRunDetailViewModel["governanceActionEntries"][number],
  ) => void;
  onGovernanceArtifactAction?: (
    action: SceneAppRunDetailViewModel["governanceArtifactEntries"][number],
  ) => void;
  onEntryAction?: (
    action: NonNullable<SceneAppRunDetailViewModel["entryAction"]>,
  ) => void;
}

const STATUS_CLASSNAMES = {
  idle: "border-slate-200 bg-slate-50 text-slate-700",
  good: "border-emerald-200 bg-emerald-50 text-emerald-700",
  watch: "border-amber-200 bg-amber-50 text-amber-700",
  risk: "border-rose-200 bg-rose-50 text-rose-700",
} as const;

const STATUS_ITEM_CLASSNAMES = {
  idle: "border-slate-200 bg-slate-50/80",
  good: "border-emerald-200 bg-emerald-50/70",
  watch: "border-amber-200 bg-amber-50/70",
  risk: "border-rose-200 bg-rose-50/70",
} as const;

const QUICK_REVIEW_TONE_CLASSNAMES = {
  positive: "border-emerald-200 bg-emerald-50/80 hover:border-emerald-300",
  neutral: "border-slate-200 bg-slate-50 hover:border-slate-300",
  warning: "border-amber-200 bg-amber-50/80 hover:border-amber-300",
  risk: "border-rose-200 bg-rose-50/80 hover:border-rose-300",
} as const;

export function SceneAppGovernancePanel({
  hasSelectedSceneApp,
  governanceView,
  loading,
  error,
  latestReviewFeedbackSignal = null,
  onContinueReviewFeedback,
  humanReviewAvailable = false,
  humanReviewLoading = false,
  quickReviewActions = [],
  quickReviewPending = false,
  onOpenHumanReview,
  onApplyQuickReview,
  onGovernanceAction,
  onGovernanceArtifactAction,
  onEntryAction,
}: SceneAppGovernancePanelProps) {
  if (!hasSelectedSceneApp) {
    return (
      <section className="rounded-[24px] border border-dashed border-slate-200 bg-white p-4 text-sm leading-6 text-slate-500 shadow-sm shadow-slate-950/5">
        先选一个 Skill，结果页才会带出最近结果、证据和下一步判断。
      </section>
    );
  }

  if (loading && !governanceView) {
    return (
      <section className="rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-950/5">
        <div className="text-sm font-semibold text-slate-900">结果判断</div>
        <div className="mt-5 rounded-[22px] border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
          正在整理结果判断…
        </div>
      </section>
    );
  }

  if (error && !governanceView) {
    return (
      <section className="rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-950/5">
        <div className="text-sm font-semibold text-slate-900">结果判断</div>
        <div className="mt-5 rounded-[22px] border border-dashed border-rose-200 bg-rose-50 px-4 py-5 text-sm text-rose-700">
          {error}
        </div>
      </section>
    );
  }

  if (!governanceView) {
    return (
      <section className="rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-950/5">
        <div className="text-sm font-semibold text-slate-900">结果判断</div>
        <div className="mt-5 rounded-[22px] border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
          当前还没有可整理的结果信息，先跑一轮结果再回来判断。
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-950/5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">结果判断</div>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            先看值不值得继续。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {humanReviewAvailable ? (
            <button
              type="button"
              data-testid="sceneapp-governance-open-human-review"
              className="rounded-full border border-lime-200 bg-lime-50 px-3 py-1 text-[11px] font-medium text-lime-800 transition-colors hover:border-lime-300 hover:bg-lime-100"
              onClick={() => onOpenHumanReview?.()}
            >
              {humanReviewLoading ? "准备人工复核…" : "补人工复核"}
            </button>
          ) : null}
          {loading ? (
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-500">
              刷新中
            </span>
          ) : null}
          {governanceView.scorecardActionLabel ? (
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600">
              {governanceView.scorecardActionLabel}
            </span>
          ) : null}
          <span
            data-testid="sceneapp-governance-status-badge"
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-medium",
              STATUS_CLASSNAMES[governanceView.status],
            )}
          >
            {governanceView.statusLabel}
          </span>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-[22px] border border-dashed border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1.08fr)_minmax(300px,0.92fr)]">
        <div className="rounded-[20px] border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-white bg-white px-2.5 py-1 text-[11px] font-medium text-lime-700">
              最近一轮判断
            </span>
            <span className="rounded-full border border-white bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600">
              {governanceView.latestRunLabel}
            </span>
          </div>
          <p
            data-testid="sceneapp-governance-summary"
            className="mt-3 text-sm leading-6 text-slate-800"
          >
            {governanceView.summary}
          </p>
        </div>

        <div className="space-y-3">
          <div className="rounded-[20px] border border-slate-200 bg-white p-4">
            <div className="text-xs font-medium text-slate-500">下一步</div>
            <p
              data-testid="sceneapp-governance-next-action"
              className="mt-2 text-sm font-medium leading-6 text-slate-900"
            >
              {governanceView.nextAction}
            </p>
            {governanceView.topFailureSignalLabel ? (
              <div className="mt-3">
                <span className="inline-flex max-w-full items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800">
                  当前卡点：{governanceView.topFailureSignalLabel}
                </span>
              </div>
            ) : null}
            {governanceView.destinations.length ? (
              <div className="mt-4">
                <div className="text-xs font-medium text-slate-500">建议去向</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {governanceView.destinations.map((destination) => (
                    <span
                      key={destination.key}
                      className="max-w-full rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700"
                      title={destination.description}
                    >
                      {destination.label}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          {humanReviewAvailable && quickReviewActions.length ? (
            <div className="rounded-[20px] border border-slate-200 bg-slate-50 p-3.5">
              <div className="text-xs font-medium text-slate-500">快速判断</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {quickReviewActions.map((action) => (
                  <button
                    key={action.key}
                    type="button"
                    data-testid={`sceneapp-governance-quick-review-${action.key}`}
                    disabled={quickReviewPending}
                    title={action.helperText}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                      QUICK_REVIEW_TONE_CLASSNAMES[action.tone],
                    )}
                    onClick={() => onApplyQuickReview?.(action.key)}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <details
        data-testid="sceneapp-governance-advanced-sections"
        className="group mt-4 rounded-[20px] border border-slate-200 bg-slate-50"
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
          <div>
            <div className="text-sm font-medium text-slate-900">判断依据与材料</div>
            <div className="mt-1 text-xs text-slate-500">需要时再展开。</div>
          </div>
          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 group-open:hidden">
            展开
          </span>
          <span className="hidden rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 group-open:inline-flex">
            收起
          </span>
        </summary>

        <div className="border-t border-slate-200 bg-white p-4">
          <div>
            <div className="text-xs font-medium text-slate-500">
              现在够不够继续
            </div>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              {governanceView.statusItems.map((item) => (
                <article
                  key={item.key}
                  className={cn(
                    "rounded-[16px] border p-2.5",
                    STATUS_ITEM_CLASSNAMES[item.tone],
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-sm font-medium text-slate-900">
                      {item.label}
                    </div>
                    <span className="rounded-full border border-white/80 bg-white/80 px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-slate-700">
                      {item.value}
                    </span>
                  </div>
                  <div className="mt-1.5 text-xs leading-5 text-slate-600">
                    {item.description}
                  </div>
                </article>
              ))}
            </div>
          </div>

          {governanceView.contextBaseline ? (
            <div className="mt-4 rounded-[18px] border border-sky-200 bg-sky-50/40 px-3 py-3">
              <div className="text-xs font-medium text-slate-500">
                这轮带入的参考
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-sm text-slate-700">
                <div
                  data-testid="sceneapp-governance-context-reference-count"
                  className="rounded-full border border-slate-200 bg-white px-2.5 py-1"
                >
                  <span className="font-medium text-slate-900">参考对象：</span>
                  {governanceView.contextBaseline.referenceCount} 条
                </div>
                {governanceView.contextBaseline.scopeLabel ? (
                  <div className="rounded-full border border-slate-200 bg-white px-2.5 py-1">
                    <span className="font-medium text-slate-900">作用范围：</span>
                    {governanceView.contextBaseline.scopeLabel}
                  </div>
                ) : null}
              </div>
              {governanceView.contextBaseline.referenceItems.length ? (
                <details className="group mt-3 rounded-[16px] border border-slate-200 bg-white">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2">
                    <span className="text-[11px] font-medium text-slate-600">
                      查看参考条目
                    </span>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-600 group-open:hidden">
                      展开
                    </span>
                    <span className="hidden rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-600 group-open:inline-flex">
                      收起
                    </span>
                  </summary>
                  <div
                    data-testid="sceneapp-governance-context-reference-items"
                    className="border-t border-slate-200 px-3 py-3"
                  >
                    <div className="flex flex-wrap gap-2">
                      {governanceView.contextBaseline.referenceItems.map((item) => (
                        <span
                          key={item.key}
                          className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700"
                        >
                          {item.label}
                          {item.usageLabel ? ` · ${item.usageLabel}` : ""}
                          {item.feedbackLabel ? ` · ${item.feedbackLabel}` : ""}
                        </span>
                      ))}
                    </div>
                  </div>
                </details>
              ) : null}
              {governanceView.contextBaseline.tasteSummary ? (
                <div
                  data-testid="sceneapp-governance-context-taste-summary"
                  className="mt-3 text-sm leading-6 text-slate-700"
                >
                  <span className="font-medium text-slate-900">风格方向：</span>
                  {governanceView.contextBaseline.tasteSummary}
                </div>
              ) : null}
              <SceneAppReviewFeedbackBanner
                signal={latestReviewFeedbackSignal}
                dataTestId="sceneapp-governance-review-feedback-banner"
                onContinueReviewFeedback={onContinueReviewFeedback}
              />
              {governanceView.contextBaseline.feedbackSummary ? (
                <div
                  data-testid="sceneapp-governance-context-feedback-summary"
                  className="mt-3 text-sm leading-6 text-slate-700"
                >
                  <span className="font-medium text-slate-900">最近反馈：</span>
                  {governanceView.contextBaseline.feedbackSummary}
                </div>
              ) : null}
              {governanceView.contextBaseline.feedbackUpdatedAtLabel ? (
                <div className="mt-2 text-sm text-slate-700">
                  <span className="font-medium text-slate-900">
                    反馈更新时间：
                  </span>
                  {governanceView.contextBaseline.feedbackUpdatedAtLabel}
                </div>
              ) : null}
              {governanceView.contextBaseline.feedbackSignals.length ? (
                <div
                  data-testid="sceneapp-governance-context-feedback-signals"
                  className="mt-3 flex flex-wrap gap-2"
                >
                  {governanceView.contextBaseline.feedbackSignals.map(
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

          {governanceView.governanceActionEntries.length ||
          governanceView.entryAction ? (
            <div className="mt-4">
              <div className="text-xs font-medium text-slate-500">
                下一步建议
              </div>
              <div className="mt-2 grid gap-3 xl:grid-cols-2">
                {governanceView.governanceActionEntries.map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    data-testid={`sceneapp-governance-action-${entry.key}`}
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
                    <div className="mt-2 line-clamp-2 text-xs leading-5 text-slate-600">
                      {entry.helperText}
                    </div>
                  </button>
                ))}

                {governanceView.entryAction ? (
                  <button
                    type="button"
                    data-testid="sceneapp-governance-entry-action"
                    className="rounded-[18px] border border-slate-200 bg-white p-3 text-left transition-colors hover:border-slate-300 hover:bg-slate-50"
                    onClick={() => onEntryAction?.(governanceView.entryAction!)}
                  >
                    <div className="text-sm font-medium text-slate-900">
                      {governanceView.entryAction.label}
                    </div>
                    <div className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500">
                      {governanceView.entryAction.helperText}
                    </div>
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {governanceView.governanceArtifactEntries.length ? (
            <div className="mt-4">
              <div className="text-xs font-medium text-slate-500">
                可打开材料
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {governanceView.governanceArtifactEntries.map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    data-testid={`sceneapp-governance-artifact-${entry.key}`}
                    className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-white"
                    onClick={() => onGovernanceArtifactAction?.(entry)}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </details>
    </section>
  );
}
