import {
  EMPTY_STATE_BADGE_BASE_CLASSNAME,
  EMPTY_STATE_BADGE_TONE_CLASSNAMES,
  EMPTY_STATE_PANEL_EMBEDDED_CLASSNAME,
  EMPTY_STATE_PRIMARY_ACTION_BUTTON_CLASSNAME,
} from "./emptyStateSurfaceTokens";
import type { SceneAppEntryCardItem } from "../sceneappEntryTypes";

interface EmptyStateSceneAppsPanelProps {
  items: SceneAppEntryCardItem[];
  loading?: boolean;
  launchingSceneAppId?: string | null;
  onLaunchSceneApp?: (sceneappId: string) => void | Promise<void>;
  canResumeRecentSceneApp?: boolean;
  onResumeRecentSceneApp?: () => void;
  onOpenSceneAppsDirectory?: () => void;
}

export function EmptyStateSceneAppsPanel({
  items,
  loading = false,
  launchingSceneAppId = null,
  onLaunchSceneApp,
  canResumeRecentSceneApp = false,
  onResumeRecentSceneApp,
  onOpenSceneAppsDirectory,
}: EmptyStateSceneAppsPanelProps) {
  if (!loading && items.length === 0) {
    return null;
  }

  return (
    <section className={EMPTY_STATE_PANEL_EMBEDDED_CLASSNAME}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <div className="text-sm font-semibold text-slate-900">场景应用</div>
          <p className="text-xs leading-5 text-slate-500 md:text-sm">
            不是单个技能，而是一条完整结果链。先选一个目标，Lime 会把合适的能力组合起来。
          </p>
        </div>
        {canResumeRecentSceneApp || onOpenSceneAppsDirectory ? (
          <div className="flex flex-wrap items-center gap-2">
            {canResumeRecentSceneApp && onResumeRecentSceneApp ? (
              <button
                type="button"
                className="rounded-full border border-lime-200 bg-lime-50 px-3 py-1.5 text-xs font-medium text-lime-700 transition-colors hover:border-lime-300 hover:bg-lime-100"
                onClick={onResumeRecentSceneApp}
              >
                继续最近场景
              </button>
            ) : null}
            {onOpenSceneAppsDirectory ? (
              <button
                type="button"
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-900"
                onClick={onOpenSceneAppsDirectory}
              >
                查看全部场景
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {canResumeRecentSceneApp ? (
        <p className="mt-2 text-[11px] leading-5 text-slate-400">
          继续最近场景会恢复你上次打开的 SceneApp、项目和运行上下文。
        </p>
      ) : null}

      {loading && items.length === 0 ? (
        <div className="mt-3 rounded-[20px] border border-dashed border-slate-200 bg-slate-50/70 px-4 py-4 text-sm text-slate-500">
          正在整理可直接启动的场景应用…
        </div>
      ) : (
        <div className="mt-3 grid gap-3 xl:grid-cols-3">
          {items.map((item) => {
            const isLaunching = launchingSceneAppId === item.id;
            const disabled = Boolean(item.disabledReason) || !onLaunchSceneApp;

            return (
              <article
                key={item.id}
                data-testid={`sceneapp-entry-${item.id}`}
                className="flex min-w-0 flex-col rounded-[22px] border border-lime-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(247,254,231,0.88)_100%)] p-4 shadow-sm shadow-slate-950/5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold tracking-[0.08em] text-lime-700">
                      {item.businessLabel}
                    </div>
                    <h3 className="mt-1 text-base font-semibold text-slate-900">
                      {item.title}
                    </h3>
                  </div>
                  <span
                    className={[
                      EMPTY_STATE_BADGE_BASE_CLASSNAME,
                      EMPTY_STATE_BADGE_TONE_CLASSNAMES[item.executionTone],
                      "shrink-0",
                    ].join(" ")}
                  >
                    {item.executionLabel}
                  </span>
                </div>

                <p className="mt-2 text-sm font-medium leading-6 text-slate-700">
                  {item.valueStatement}
                </p>
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  {item.summary}
                </p>

                <dl className="mt-3 grid gap-2 rounded-[18px] border border-slate-200/80 bg-white/85 px-3.5 py-3 text-xs leading-5 text-slate-600">
                  <div>
                    <dt className="font-medium text-slate-500">会产出</dt>
                    <dd className="mt-0.5 text-slate-700">{item.deliveryLabel}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-500">模式</dt>
                    <dd className="mt-0.5 text-slate-700">
                      {item.patternSummary}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-500">基础设施</dt>
                    <dd className="mt-0.5 text-slate-700">{item.infraSummary}</dd>
                  </div>
                </dl>

                <div className="mt-3 rounded-[18px] border border-slate-200/80 bg-slate-50/80 px-3.5 py-3">
                  <div className="text-[11px] font-medium text-slate-500">
                    {item.sourceLabel}
                  </div>
                  <div className="mt-1 text-xs leading-5 text-slate-700">
                    {item.sourcePreview}
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between gap-3">
                  <span className="min-h-[20px] text-xs text-amber-600">
                    {item.disabledReason ?? ""}
                  </span>
                  <button
                    type="button"
                    data-testid={`sceneapp-launch-${item.id}`}
                    className={`${EMPTY_STATE_PRIMARY_ACTION_BUTTON_CLASSNAME} shrink-0 disabled:cursor-not-allowed disabled:opacity-60`}
                    disabled={disabled || isLaunching}
                    onClick={() => {
                      if (disabled || isLaunching) {
                        return;
                      }
                      void onLaunchSceneApp?.(item.id);
                    }}
                  >
                    {isLaunching ? "准备中…" : item.actionLabel}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
