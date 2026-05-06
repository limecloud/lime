import type { SceneAppEntryCardItem } from "../sceneappEntryTypes";

interface EmptyStateSceneAppsPanelProps {
  items: SceneAppEntryCardItem[];
  loading?: boolean;
  launchingSceneAppId?: string | null;
  onLaunchSceneApp?: (sceneappId: string) => void | Promise<void>;
}

export function EmptyStateSceneAppsPanel({
  items,
  loading = false,
  launchingSceneAppId = null,
  onLaunchSceneApp,
}: EmptyStateSceneAppsPanelProps) {
  const hasLaunchableEntries = items.length > 0;

  if (!loading && !hasLaunchableEntries) {
    return null;
  }

  return (
    <>
      {loading && items.length === 0 ? (
        <span className="text-[11px] leading-5 text-slate-400">
          正在整理可直接续上的 Skills…
        </span>
      ) : hasLaunchableEntries ? (
        <div data-testid="sceneapps-home-directory" className="contents">
          {items.map((item) => {
            const isLaunching = launchingSceneAppId === item.id;
            const disabled =
              Boolean(item.disabledReason) || !onLaunchSceneApp || isLaunching;

            return (
              <button
                key={item.id}
                type="button"
                data-testid={`sceneapp-launch-${item.id}`}
                className="inline-flex items-center rounded-full border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] px-3 py-1.5 text-[11px] font-medium text-[color:var(--lime-text-muted)] transition-colors hover:border-[color:var(--lime-surface-border-strong)] hover:bg-[color:var(--lime-surface-soft)] hover:text-[color:var(--lime-text-strong)] disabled:cursor-not-allowed disabled:opacity-60"
                title={`${item.businessLabel} · ${item.summary}`}
                disabled={disabled}
                onClick={() => {
                  if (disabled) {
                    return;
                  }
                  void onLaunchSceneApp?.(item.id);
                }}
              >
                {isLaunching ? `${item.title} 准备中…` : item.title}
              </button>
            );
          })}
        </div>
      ) : (
        <span className="text-[11px] leading-5 text-slate-400">
          最近跑过的 Skills 可以直接续上，不必重新装配。
        </span>
      )}
    </>
  );
}
