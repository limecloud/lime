import { ChevronDown, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatPathPreview } from "../domain/knowledgeVisibility";

export function KnowledgeTroubleshootingPanel({
  open,
  workingDir,
  workingDirInput,
  onToggle,
  onWorkingDirInputChange,
  onApplyWorkingDir,
}: {
  open: boolean;
  workingDir: string;
  workingDirInput: string;
  onToggle: () => void;
  onWorkingDirInputChange: (value: string) => void;
  onApplyWorkingDir: () => void;
}) {
  return (
    <div className="mt-4 rounded-[20px] border border-slate-200 bg-slate-50 px-3 py-3">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="min-w-0">
          <span className="block text-xs font-semibold text-slate-700">
            排障设置
          </span>
          <span className="mt-1 block truncate text-xs text-slate-500">
            无法识别当前项目时，再手动指定项目目录：{formatPathPreview(workingDir)}
          </span>
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-slate-400 transition",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? (
        <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto]">
          <input
            value={workingDirInput}
            onChange={(event) => onWorkingDirInputChange(event.target.value)}
            placeholder="仅排障时填写，例如 /Users/me/project"
            className="h-10 rounded-2xl border border-slate-200 bg-white px-3 font-mono text-sm text-slate-800 outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
          />
          <button
            type="button"
            onClick={onApplyWorkingDir}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            <RefreshCw className="h-4 w-4" />
            使用此目录
          </button>
        </div>
      ) : null}
    </div>
  );
}
