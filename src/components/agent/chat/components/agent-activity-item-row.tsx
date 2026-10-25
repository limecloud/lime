import { useId, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

// Adapted from Desktop 26.1021.31345 agent-activity-item-row; private symbols unavailable.
export function AgentActivityItemRow({
  icon,
  summary,
  expanded,
  onToggle,
  children,
}: {
  icon: ReactNode;
  summary: ReactNode;
  expanded: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="min-w-0 py-1">
      <button
        type="button"
        className="group/activity-header inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-md p-0 text-left text-sm leading-6 text-[color:var(--lime-text-muted)] hover:text-[color:var(--lime-text-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={expanded}
        aria-controls={expanded ? id : undefined}
        onClick={onToggle}
      >
        {icon}
        <span className="min-w-0 truncate">{summary}</span>
        <ChevronRight
          aria-hidden="true"
          className={cn("h-3 w-3 shrink-0", expanded && "rotate-90")}
        />
      </button>
      {expanded ? (
        <div id={id} className="mt-2 min-w-0">
          {children}
        </div>
      ) : null}
    </div>
  );
}
