import React from "react";
import { Workflow } from "lucide-react";
import { cn } from "@/lib/utils";

interface TeamModeEntryButtonProps {
  selectedTeamLabel?: string | null;
  onClick: () => void;
  className?: string;
  dataTestId?: string;
  recommended?: boolean;
  hint?: string;
}

export const TeamModeEntryButton: React.FC<TeamModeEntryButtonProps> = ({
  selectedTeamLabel,
  onClick,
  className,
  dataTestId,
  recommended = false,
  hint,
}) => {
  const trimmedLabel = selectedTeamLabel?.trim() || "";
  const buttonLabel = trimmedLabel ? `开启 Team · ${trimmedLabel}` : "开启 Team";
  const title =
    hint?.trim() ||
    (recommended
      ? "当前任务更适合拆分协作，但仍由你手动决定是否启用 Team"
      : "仅在当前任务适合拆分协作时启用 Team");

  return (
    <button
      type="button"
      data-testid={dataTestId}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium shadow-none transition-colors",
        recommended
          ? "border-sky-300 bg-sky-50 text-sky-700 hover:border-sky-400 hover:bg-sky-100"
          : "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700 hover:border-fuchsia-300 hover:bg-fuchsia-100",
        className,
      )}
      title={title}
      aria-label={buttonLabel}
    >
      <Workflow className="h-3.5 w-3.5" />
      <span className="max-w-[180px] truncate">{buttonLabel}</span>
      {recommended ? (
        <span className="rounded-full border border-sky-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold leading-none text-sky-700">
          推荐
        </span>
      ) : null}
    </button>
  );
};

export default TeamModeEntryButton;
