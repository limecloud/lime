import React from "react";
import { ArrowRight, Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  TEAM_ROLE_LABELS,
  type SuggestedTeamRole,
} from "../utils/teamSuggestion";

interface TeamSuggestionBarProps {
  score: number;
  reasons: string[];
  suggestedRoles: SuggestedTeamRole[];
  suggestedPresetLabel?: string;
  onEnableTeam?: () => void;
  onContinueSingleAgent?: () => void;
  compact?: boolean;
}

export function TeamSuggestionBar({
  score,
  reasons,
  suggestedRoles,
  suggestedPresetLabel,
  onEnableTeam,
  onContinueSingleAgent,
  compact = false,
}: TeamSuggestionBarProps) {
  const containerClassName = compact
    ? "mb-2 rounded-[18px] border border-slate-200/85 bg-gradient-to-r from-slate-50 via-white to-sky-50/70 px-3.5 py-3 shadow-sm shadow-slate-950/5"
    : "mx-4 mb-3 rounded-[20px] border border-slate-200/85 bg-gradient-to-r from-slate-50 via-white to-sky-50/70 px-4 py-3 shadow-sm shadow-slate-950/5";

  return (
    <div data-testid="team-suggestion-bar" className={containerClassName}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="border border-slate-200 bg-white text-slate-700">
              <Workflow className="mr-1 h-3.5 w-3.5" />
              任务分工建议
            </Badge>
            {!compact ? (
              <span className="text-xs font-medium text-slate-500">
                适配度 {Math.round(score * 100)}%
              </span>
            ) : null}
          </div>
          <div className="text-sm font-medium text-slate-900">
            当前任务更适合分工推进
          </div>
          <div className="text-sm leading-6 text-slate-600">
            {reasons.slice(0, 2).join(" ")}
          </div>
          {suggestedPresetLabel ? (
            <div className="text-xs text-slate-500">
              推荐预设：{suggestedPresetLabel}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {suggestedRoles.slice(0, 3).map((role) => (
              <span
                key={role}
                className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600"
              >
                建议角色：{TEAM_ROLE_LABELS[role]}
              </span>
            ))}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2 lg:justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            onClick={onContinueSingleAgent}
          >
            继续单代理
          </Button>
          <Button
            type="button"
            size="sm"
            className="bg-slate-900 text-white hover:bg-slate-800"
            onClick={onEnableTeam}
          >
            启用任务分工
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export default TeamSuggestionBar;
