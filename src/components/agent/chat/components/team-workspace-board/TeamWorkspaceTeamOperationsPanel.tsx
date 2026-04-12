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

  if (useCompactCanvasChrome) {
    return (
      <div
        className="mt-2 flex items-start gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        data-testid="team-workspace-team-operations"
      >
        <div className="sticky left-0 z-10 flex shrink-0 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-500 shadow-sm shadow-slate-950/5">
          <Activity className="h-3.5 w-3.5" />
          <span>协作动态</span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-600">
            {teamOperationEntries.length}
          </span>
        </div>
        {teamOperationEntries.map((entry) => {
          const content = (
            <div className="flex min-w-0 items-start gap-2">
              <span
                className={cn(
                  "mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                  entry.badgeClassName,
                )}
              >
                {entry.title}
              </span>
              <div className="min-w-0">
                <div className="truncate text-xs leading-5 text-slate-700">
                  {entry.detail}
                </div>
                <div className="mt-0.5 text-[10px] text-slate-500">
                  {formatOperationUpdatedAt(entry.updatedAt)}
                </div>
              </div>
            </div>
          );

          return entry.targetSessionId ? (
            <button
              key={entry.id}
              type="button"
              className="inline-flex min-w-[220px] max-w-[340px] shrink-0 rounded-[16px] border border-slate-200 bg-white px-3 py-2 text-left transition hover:border-slate-300 hover:bg-slate-50"
              onClick={() => onSelectTeamOperationEntry(entry)}
            >
              {content}
            </button>
          ) : (
            <div
              key={entry.id}
              className="inline-flex min-w-[220px] max-w-[340px] shrink-0 rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-2"
            >
              {content}
            </div>
          );
        })}
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
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        <Activity className="h-3.5 w-3.5" />
        <span>协作动态</span>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium tracking-normal text-slate-600 normal-case">
          最近 {teamOperationEntries.length} 条
        </span>
      </div>
      <div className="mt-3 space-y-2">
        {teamOperationEntries.map((entry) => {
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
              <p className="mt-1 text-sm leading-6 text-slate-700">
                {entry.detail}
              </p>
            </>
          );

          return entry.targetSessionId ? (
            <button
              key={entry.id}
              type="button"
              className={cn(
                "w-full text-left transition",
                embedded
                  ? "border-l-2 border-slate-200 px-3 py-2 hover:border-slate-300 hover:bg-slate-50"
                  : "rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2.5 hover:border-slate-300 hover:bg-slate-50",
              )}
              onClick={() => onSelectTeamOperationEntry(entry)}
            >
              {content}
            </button>
          ) : (
            <div
              key={entry.id}
              className={cn(
                embedded
                  ? "border-l-2 border-slate-200 px-3 py-2"
                  : "rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2.5",
              )}
            >
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
}
