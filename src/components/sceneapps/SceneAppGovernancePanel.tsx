import type {
  SceneAppGovernancePanelViewModel,
  SceneAppRunDetailViewModel,
} from "@/lib/sceneapp";
import { cn } from "@/lib/utils";
import type { SceneAppQuickReviewAction } from "./useSceneAppsPageRuntime";

interface SceneAppGovernancePanelProps {
  hasSelectedSceneApp: boolean;
  governanceView: SceneAppGovernancePanelViewModel | null;
  loading: boolean;
  error?: string | null;
  humanReviewAvailable?: boolean;
  humanReviewLoading?: boolean;
  quickReviewActions?: SceneAppQuickReviewAction[];
  quickReviewPending?: boolean;
  onOpenHumanReview?: () => void;
  onApplyQuickReview?: (
    actionKey: SceneAppQuickReviewAction["key"],
  ) => void;
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
      <section className="rounded-[28px] border border-dashed border-slate-200 bg-white p-5 text-sm leading-6 text-slate-500 shadow-sm shadow-slate-950/5">
        先选一套做法，复盘页才会带出最近结果、证据和下一步判断。
      </section>
    );
  }

  if (loading && !governanceView) {
    return (
      <section className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5">
        <div className="text-sm font-semibold text-slate-900">做法复盘</div>
        <div className="mt-5 rounded-[22px] border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
          正在整理复盘视图…
        </div>
      </section>
    );
  }

  if (error && !governanceView) {
    return (
      <section className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5">
        <div className="text-sm font-semibold text-slate-900">做法复盘</div>
        <div className="mt-5 rounded-[22px] border border-dashed border-rose-200 bg-rose-50 px-4 py-5 text-sm text-rose-700">
          {error}
        </div>
      </section>
    );
  }

  if (!governanceView) {
    return (
      <section className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5">
        <div className="text-sm font-semibold text-slate-900">做法复盘</div>
        <div className="mt-5 rounded-[22px] border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
          当前还没有可整理的复盘信息，先跑一轮结果链再回来判断。
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">做法复盘</div>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            把最近一轮结果翻成业务判断，决定现在适合继续、先修哪里，还是先停下来补材料。
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

      <div className="mt-4 rounded-[24px] border border-slate-200 bg-slate-50 p-4">
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold tracking-[0.08em] text-lime-700">
          <span>最近一轮判断</span>
          <span className="text-slate-400">·</span>
          <span className="text-slate-500">
            {governanceView.latestRunLabel}
          </span>
        </div>
        <p
          data-testid="sceneapp-governance-summary"
          className="mt-2 text-sm leading-7 text-slate-800"
        >
          {governanceView.summary}
        </p>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {governanceView.nextAction}
        </p>
        {governanceView.topFailureSignalLabel ? (
          <div className="mt-3 text-sm text-slate-700">
            <span className="font-medium text-slate-900">现在最卡的一点：</span>
            {governanceView.topFailureSignalLabel}
          </div>
        ) : null}
        {humanReviewAvailable && quickReviewActions.length ? (
          <div className="mt-4">
            <div className="text-xs font-medium text-slate-500">快速判断</div>
            <div className="mt-2 grid gap-3 xl:grid-cols-2">
              {quickReviewActions.map((action) => (
                <button
                  key={action.key}
                  type="button"
                  data-testid={`sceneapp-governance-quick-review-${action.key}`}
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
          </div>
        ) : null}
        {governanceView.contextBaseline ? (
          <div className="mt-4 rounded-[18px] border border-sky-200 bg-white px-3 py-3">
            <div className="text-xs font-medium text-slate-500">
              这轮带入的参考
            </div>
            <div
              data-testid="sceneapp-governance-context-reference-count"
              className="mt-2 text-sm text-slate-700"
            >
              <span className="font-medium text-slate-900">参考对象：</span>
              {governanceView.contextBaseline.referenceCount} 条
            </div>
            {governanceView.contextBaseline.scopeLabel ? (
              <div className="mt-2 text-sm text-slate-700">
                <span className="font-medium text-slate-900">作用范围：</span>
                {governanceView.contextBaseline.scopeLabel}
              </div>
            ) : null}
            {governanceView.contextBaseline.referenceItems.length ? (
              <div
                data-testid="sceneapp-governance-context-reference-items"
                className="mt-3 flex flex-wrap gap-2"
              >
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
      </div>

      {governanceView.destinations.length ? (
        <div className="mt-4">
          <div className="text-xs font-medium text-slate-500">更适合往哪继续</div>
          <div className="mt-2 grid gap-3 md:grid-cols-2">
            {governanceView.destinations.map((destination) => (
              <article
                key={destination.key}
                className="rounded-[18px] border border-slate-200 bg-white p-3"
              >
                <div className="text-sm font-medium text-slate-900">
                  {destination.label}
                </div>
                <div className="mt-1 text-xs leading-5 text-slate-500">
                  {destination.description}
                </div>
              </article>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-4">
        <div className="text-xs font-medium text-slate-500">现在够不够继续</div>
        <div className="mt-2 grid gap-3 md:grid-cols-2">
          {governanceView.statusItems.map((item) => (
            <article
              key={item.key}
              className={cn(
                "rounded-[18px] border p-3",
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
              <div className="mt-2 text-xs leading-5 text-slate-600">
                {item.description}
              </div>
            </article>
          ))}
        </div>
      </div>

      {governanceView.governanceActionEntries.length ||
      governanceView.entryAction ? (
        <div className="mt-4">
          <div className="text-xs font-medium text-slate-500">下一步建议</div>
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
                <div className="mt-2 text-xs leading-5 text-slate-600">
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
                <div className="mt-2 text-xs leading-5 text-slate-500">
                  {governanceView.entryAction.helperText}
                </div>
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {governanceView.governanceArtifactEntries.length ? (
        <div className="mt-4">
          <div className="text-xs font-medium text-slate-500">可打开材料</div>
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
    </section>
  );
}
