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
  const hasLaunchableEntries = items.length > 0;

  if (!loading && !hasLaunchableEntries && !canResumeRecentSceneApp) {
    return null;
  }

  return (
    <section className="space-y-2.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <div className="text-sm font-semibold text-slate-900">
            更多起手方式
          </div>
          <p className="text-xs leading-5 text-slate-500 md:text-sm">
            {hasLaunchableEntries
              ? "只有当整套做法比直接拿结果更省事时，再从这里进入；已经知道想拿什么结果，优先用上面的结果入口就够了。"
              : "这次如果只想继续上一套做法，可以直接从这里回到原流程。"}
          </p>
        </div>
        {canResumeRecentSceneApp || onOpenSceneAppsDirectory ? (
          <div className="flex flex-wrap items-center gap-3 text-xs">
            {canResumeRecentSceneApp && onResumeRecentSceneApp ? (
              <button
                type="button"
                className="font-medium text-lime-700 transition-colors hover:text-lime-800"
                onClick={onResumeRecentSceneApp}
              >
                继续最近做法
              </button>
            ) : null}
            {onOpenSceneAppsDirectory ? (
              <button
                type="button"
                className="font-medium text-slate-600 transition-colors hover:text-slate-900"
                onClick={onOpenSceneAppsDirectory}
              >
                查看全部做法
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {loading && items.length === 0 ? (
        <div className="text-sm leading-6 text-slate-500">
          正在整理可直接启动的场景做法…
        </div>
      ) : hasLaunchableEntries ? (
        <div
          data-testid="sceneapps-home-directory"
          className="flex flex-wrap items-center gap-y-2 text-sm leading-6"
        >
          {items.map((item, index) => {
            const isLaunching = launchingSceneAppId === item.id;
            const disabled = Boolean(item.disabledReason) || !onLaunchSceneApp;

            return (
              <div
                key={item.id}
                data-testid={`sceneapp-entry-${item.id}`}
                className="flex min-w-0 items-center"
              >
                {disabled ? (
                  <span
                    className="text-sm text-slate-400"
                    title={item.disabledReason ?? item.summary}
                  >
                    {item.title}
                  </span>
                ) : (
                  <button
                    type="button"
                    data-testid={`sceneapp-launch-${item.id}`}
                    className="text-left font-medium text-slate-700 transition-colors hover:text-slate-950"
                    title={`${item.businessLabel} · ${item.summary}`}
                    disabled={isLaunching}
                    onClick={() => {
                      if (isLaunching) {
                        return;
                      }
                      void onLaunchSceneApp?.(item.id);
                    }}
                  >
                    {item.title}
                  </button>
                )}
                {isLaunching ? (
                  <span className="ml-2 text-xs text-slate-400">准备中…</span>
                ) : null}
                {item.disabledReason ? (
                  <span className="ml-2 text-xs text-amber-600">
                    {item.disabledReason}
                  </span>
                ) : null}
                {index < items.length - 1 ? (
                  <span className="mx-3 text-slate-300">/</span>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-sm leading-6 text-slate-500">
          最近跑过的整套做法可以直接续上，不必重新装配。
        </div>
      )}
    </section>
  );
}
