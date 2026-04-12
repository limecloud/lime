import { Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SessionActivityPreviewState } from "../../team-workspace-runtime/activityPreviewSelectors";
import type { TeamWorkspaceActivityEntry } from "../../teamWorkspaceRuntime";

interface SelectedSessionInlineActivitySectionProps {
  inlineDetailSectionClassName: string;
  inlineTimelineEntryClassName: string;
  inlineTimelineFeedClassName: string;
  selectedSessionActivityEntries: TeamWorkspaceActivityEntry[];
  selectedSessionActivityPreview: SessionActivityPreviewState | null;
  selectedSessionActivityPreviewText: string | null;
  selectedSessionActivityShouldPoll: boolean;
  selectedSessionSupportsActivityPreview: boolean;
}

export function SelectedSessionInlineActivitySection({
  inlineDetailSectionClassName,
  inlineTimelineEntryClassName,
  inlineTimelineFeedClassName,
  selectedSessionActivityEntries,
  selectedSessionActivityPreview,
  selectedSessionActivityPreviewText,
  selectedSessionActivityShouldPoll,
  selectedSessionSupportsActivityPreview,
}: SelectedSessionInlineActivitySectionProps) {
  if (!selectedSessionSupportsActivityPreview) {
    return null;
  }

  return (
    <div className={inlineDetailSectionClassName}>
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        <Activity className="h-3.5 w-3.5" />
        <span>完整进展</span>
        {selectedSessionActivityShouldPoll ? (
          <span className="rounded-full border border-sky-200 bg-white px-2 py-0.5 text-[10px] font-medium tracking-normal text-sky-700 normal-case">
            处理中自动刷新
          </span>
        ) : null}
      </div>
      {selectedSessionActivityPreviewText ? (
        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">
          {selectedSessionActivityPreviewText}
        </p>
      ) : selectedSessionActivityPreview?.status === "error" ? (
        <p className="mt-2 text-sm leading-6 text-rose-600">
          最新进展暂不可用：
          {selectedSessionActivityPreview.errorMessage ?? "同步失败"}
        </p>
      ) : selectedSessionActivityPreview?.status === "ready" ? (
        <p className="mt-2 text-sm leading-6 text-slate-500">
          这项任务暂时还没有可展示的新进展。
        </p>
      ) : (
        <p className="mt-2 text-sm leading-6 text-slate-500">
          正在同步这项任务的最新进展...
        </p>
      )}

      {selectedSessionActivityEntries.length > 0 ? (
        <div
          className={inlineTimelineFeedClassName}
          data-testid="team-workspace-activity-feed"
        >
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            <span>进展记录</span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium tracking-normal text-slate-600 normal-case">
              {selectedSessionActivityEntries.length} 条
            </span>
          </div>
          <div className="mt-3 space-y-2.5">
            {selectedSessionActivityEntries.map((entry) => (
              <div key={entry.id} className={inlineTimelineEntryClassName}>
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="font-semibold text-slate-800">
                    {entry.title}
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 font-medium",
                      entry.badgeClassName,
                    )}
                  >
                    {entry.statusLabel}
                  </span>
                </div>
                <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">
                  {entry.detail}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
