import { Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatOperationUpdatedAt,
  type TeamOperationDisplayEntry,
} from "../../team-workspace-runtime/teamOperationSelectors";

interface TeamWorkspaceTeamOperationsPanelProps {
  embedded: boolean;
  onSelectTeamOperationEntry: (entry: TeamOperationDisplayEntry) => void;
  teamOperationEntries: TeamOperationDisplayEntry[];
  useCompactCanvasChrome: boolean;
}

export function TeamWorkspaceTeamOperationsPanel({
  embedded,
  onSelectTeamOperationEntry,
  teamOperationEntries,
  useCompactCanvasChrome,
}: TeamWorkspaceTeamOperationsPanelProps) {
  if (teamOperationEntries.length === 0) {
    return null;
  }

  const heading = (
    <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
      <Activity className="h-3.5 w-3.5" />
      <span>任务进展</span>
      <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium tracking-normal text-slate-600 normal-case">
        最近 {teamOperationEntries.length} 条
      </span>
    </div>
  );

  const renderEntry = (entry: TeamOperationDisplayEntry, compact: boolean) => {
    const content = (
      <>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-medium",
              entry.badgeClassName,
            )}
          >
            {entry.title}
          </span>
          <span className="text-[11px] text-slate-500">
            {formatOperationUpdatedAt(entry.updatedAt)}
          </span>
        </div>
        <p
          className={cn(
            "mt-1 whitespace-pre-wrap break-words text-slate-700",
            compact ? "text-xs leading-5" : "text-sm leading-6",
          )}
        >
          {entry.detail}
        </p>
      </>
    );

    if (entry.targetSessionId) {
      return (
        <button
          key={entry.id}
          type="button"
          className={cn(
            "w-full text-left transition",
            compact
              ? "rounded-[14px] border border-slate-200 bg-white px-3 py-2.5 hover:border-slate-300"
              : embedded
                ? "border-l-2 border-slate-200 px-3 py-2 hover:border-slate-300 hover:bg-slate-50"
                : "rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2.5 hover:border-slate-300 hover:bg-slate-50",
          )}
          onClick={() => onSelectTeamOperationEntry(entry)}
        >
          {content}
        </button>
      );
    }

    return (
      <div
        key={entry.id}
        className={cn(
          compact
            ? "rounded-[14px] border border-slate-200 bg-white px-3 py-2.5"
            : embedded
              ? "border-l-2 border-slate-200 px-3 py-2"
              : "rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2.5",
        )}
      >
        {content}
      </div>
    );
  };

  if (useCompactCanvasChrome) {
    return (
      <div
        className="mt-2 rounded-[18px] border border-slate-200 bg-slate-50 p-3"
        data-testid="team-workspace-team-operations"
      >
        {heading}
        <div
          className="mt-3 space-y-2"
          data-testid="team-workspace-team-operations-list"
        >
          {teamOperationEntries.map((entry) => renderEntry(entry, true))}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        embedded
          ? "mt-3 border-t border-slate-200 pt-3"
          : "mt-3 rounded-[18px] border border-slate-200 bg-white p-3",
      )}
      data-testid="team-workspace-team-operations"
    >
      {heading}
      <div className="mt-3 space-y-2">
        {teamOperationEntries.map((entry) => renderEntry(entry, false))}
      </div>
    </div>
  );
}
