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

const TEAM_SUGGESTION_PRIMARY_BUTTON_CLASSNAME =
  "h-8 rounded-full border border-emerald-200 bg-[linear-gradient(135deg,#0ea5e9_0%,#14b8a6_52%,#10b981_100%)] px-3 text-white shadow-sm shadow-emerald-950/15 hover:opacity-95";

export function TeamSuggestionBar({
  score,
  reasons,
  suggestedRoles,
  suggestedPresetLabel,
  onEnableTeam,
  onContinueSingleAgent,
  compact = false,
}: TeamSuggestionBarProps) {
  const summaryText =
    reasons[0] || "这次输入包含多阶段目标，适合按分析、执行、验证拆分推进。";
  const containerClassName = compact
    ? "mb-1.5 flex max-w-full flex-wrap items-center gap-2 text-xs text-slate-500"
    : "mx-4 mb-3 rounded-[18px] border border-slate-200/85 bg-slate-50/92 px-3.5 py-3 shadow-sm shadow-slate-950/5";

  if (compact) {
    return (
      <div
        data-testid="team-suggestion-bar"
        className={containerClassName}
        title={reasons.join(" ")}
      >
        <Badge className="h-6 rounded-full border border-slate-200/80 bg-slate-50 px-2.5 text-[11px] font-medium text-slate-600">
          <Workflow className="mr-1 h-3.5 w-3.5" />
          分工建议
        </Badge>
        <span className="min-w-0 max-w-[340px] truncate leading-5 text-slate-500">
          {summaryText}
        </span>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 rounded-full px-2.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            onClick={onContinueSingleAgent}
          >
            继续单代理
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 rounded-full px-2.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            onClick={onEnableTeam}
          >
            启用任务分工
            <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="team-suggestion-bar" className={containerClassName}>
      <div
        className={
          compact
            ? "flex flex-wrap items-center gap-2"
            : "flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"
        }
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="h-6 rounded-full border border-slate-200 bg-white px-2.5 text-[11px] font-medium text-slate-700">
              <Workflow className="mr-1 h-3.5 w-3.5" />
              任务分工建议
            </Badge>
            <span className="text-xs font-medium text-slate-700">
              复杂任务可切到任务分工
            </span>
            {!compact && (
              <span className="text-xs font-medium text-slate-500">
                适配度 {Math.round(score * 100)}%
              </span>
            )}
          </div>
          <div
            className={
              compact
                ? "mt-1 max-w-[540px] truncate text-xs leading-5 text-slate-500"
                : "mt-2 text-sm leading-6 text-slate-600"
            }
            title={reasons.join(" ")}
          >
            {compact ? summaryText : reasons.slice(0, 2).join(" ")}
          </div>
          {suggestedPresetLabel && !compact ? (
            <div className="mt-1 text-xs text-slate-500">
              推荐预设：{suggestedPresetLabel}
            </div>
          ) : null}
          {!compact && suggestedRoles.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {suggestedRoles.slice(0, 3).map((role) => (
                <span
                  key={role}
                  className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600"
                >
                  建议角色：{TEAM_ROLE_LABELS[role]}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 rounded-full border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            onClick={onContinueSingleAgent}
          >
            继续单代理
          </Button>
          <Button
            type="button"
            size="sm"
            className={TEAM_SUGGESTION_PRIMARY_BUTTON_CLASSNAME}
            onClick={onEnableTeam}
          >
            启用任务分工
            <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export default TeamSuggestionBar;
