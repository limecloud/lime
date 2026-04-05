import React from "react";
import { Zap, X } from "lucide-react";
import type { Skill } from "@/lib/api/skills";

interface SkillBadgeProps {
  skill: Skill;
  onClear: () => void;
}

export const SkillBadge: React.FC<SkillBadgeProps> = ({ skill, onClear }) => (
  <div className="flex items-center gap-1.5 px-2 py-1.5 mx-1 mt-1 rounded-md bg-primary/15 text-primary text-xs font-medium w-fit">
    <Zap className="w-3 h-3" />
    <span>{skill.name}</span>
    <button onClick={onClear} className="hover:opacity-70 ml-0.5">
      <X className="w-3 h-3" />
    </button>
  </div>
);
