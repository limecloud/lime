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
    <section className="space-y-2.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <div className="text-sm font-semibold text-slate-900">场景应用</div>
          <p className="text-xs leading-5 text-slate-500 md:text-sm">
            不是单个技能，而是一条完整结果链。先选一个目标，Lime 会把合适的能力组合起来。
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
                继续最近场景
              </button>
            ) : null}
            {onOpenSceneAppsDirectory ? (
              <button
                type="button"
                className="font-medium text-slate-600 transition-colors hover:text-slate-900"
                onClick={onOpenSceneAppsDirectory}
              >
                查看全部场景
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {loading && items.length === 0 ? (
        <div className="text-sm leading-6 text-slate-500">
          正在整理可直接启动的场景应用…
        </div>
      ) : (
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
      )}
    </section>
  );
}
