import React from "react";
import { ImagePlus, X } from "lucide-react";
import type { BuiltinInputCommand } from "../../../skill-selection/builtinCommands";

interface BuiltinCommandBadgeProps {
  command: BuiltinInputCommand;
  onClear: () => void;
}

export const BuiltinCommandBadge: React.FC<BuiltinCommandBadgeProps> = ({
  command,
  onClear,
}) => (
  <div className="mx-1 mt-1 flex w-fit items-center gap-1.5 rounded-md bg-sky-500/10 px-2 py-1.5 text-xs font-medium text-sky-700">
    <ImagePlus className="h-3 w-3" />
    <span>{command.label}</span>
    <button type="button" onClick={onClear} className="ml-0.5 hover:opacity-70">
      <X className="h-3 w-3" />
    </button>
  </div>
);
