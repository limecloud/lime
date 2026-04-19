import React from "react";
import { ListChecks, PencilLine, X } from "lucide-react";
import type { CuratedTaskTemplateItem } from "../utils/curatedTaskTemplates";

interface CuratedTaskBadgeProps {
  task: CuratedTaskTemplateItem;
  onEdit?: () => void;
  onClear: () => void;
}

export const CuratedTaskBadge: React.FC<CuratedTaskBadgeProps> = ({
  task,
  onEdit,
  onClear,
}) => (
  <div className="mx-1 mt-1 flex w-fit items-center gap-1.5 rounded-md bg-amber-500/10 px-2 py-1.5 text-xs font-medium text-amber-700">
    <ListChecks className="h-3 w-3" />
    <span>{task.title}</span>
    {onEdit ? (
      <button
        type="button"
        onClick={onEdit}
        className="ml-0.5 inline-flex items-center gap-1 rounded-full border border-amber-300/80 bg-white/80 px-1.5 py-0.5 text-[11px] text-amber-700 transition hover:bg-white"
        aria-label={`编辑 ${task.title} 启动信息`}
        title="重新编辑启动信息"
      >
        <PencilLine className="h-3 w-3" />
        <span>编辑</span>
      </button>
    ) : null}
    <button
      type="button"
      onClick={onClear}
      className="ml-0.5 hover:opacity-70"
      aria-label={`清除 ${task.title}`}
      title="清除当前结果模板"
    >
      <X className="h-3 w-3" />
    </button>
  </div>
);
