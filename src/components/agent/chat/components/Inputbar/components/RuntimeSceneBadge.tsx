import React from "react";
import { Sparkles, X } from "lucide-react";
import type { RuntimeSceneSlashCommand } from "../../../skill-selection/builtinCommands";

interface RuntimeSceneBadgeProps {
  command: RuntimeSceneSlashCommand;
  onClear: () => void;
}

export const RuntimeSceneBadge: React.FC<RuntimeSceneBadgeProps> = ({
  command,
  onClear,
}) => (
  <div className="mx-1 mt-1 flex w-fit items-center gap-1.5 rounded-md bg-emerald-500/10 px-2 py-1.5 text-xs font-medium text-emerald-700">
    <Sparkles className="h-3 w-3" />
    <span>{command.label}</span>
    <button type="button" onClick={onClear} className="ml-0.5 hover:opacity-70">
      <X className="h-3 w-3" />
    </button>
  </div>
);
