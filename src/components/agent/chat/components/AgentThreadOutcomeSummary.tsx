import React from "react";
import { CheckCircle2, RotateCcw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ThreadReliabilityOutcomeDisplay } from "../utils/threadReliabilityView";

interface AgentThreadOutcomeSummaryProps {
  outcome: ThreadReliabilityOutcomeDisplay;
}

function resolveOutcomeBadgeClassName(
  tone: ThreadReliabilityOutcomeDisplay["tone"],
) {
  switch (tone) {
    case "completed":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "failed":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "paused":
      return "border-slate-200 bg-slate-50 text-slate-700";
    case "waiting":
      return "border-amber-200 bg-amber-50 text-amber-700";
    default:
      return "border-sky-200 bg-sky-50 text-sky-700";
  }
}

function resolveOutcomeShellClassName(
  tone: ThreadReliabilityOutcomeDisplay["tone"],
) {
  switch (tone) {
    case "completed":
      return "border-emerald-200/80 bg-emerald-50";
    case "failed":
      return "border-rose-200/80 bg-rose-50";
    case "paused":
      return "border-slate-200/80 bg-slate-50";
    case "waiting":
      return "border-amber-200/80 bg-amber-50";
    default:
      return "border-sky-200/80 bg-sky-50";
  }
}

export const AgentThreadOutcomeSummary: React.FC<
  AgentThreadOutcomeSummaryProps
> = ({ outcome }) => {
  return (
    <div
      className={cn(
        "rounded-2xl border px-4 py-3",
        resolveOutcomeShellClassName(outcome.tone),
      )}
      data-testid="agent-thread-outcome-summary"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
          <CheckCircle2 className="h-4 w-4" />
          <span>最近结果</span>
        </div>
        <Badge
          variant="outline"
          className={resolveOutcomeBadgeClassName(outcome.tone)}
        >
          {outcome.label}
        </Badge>
        {outcome.endedAtLabel ? (
          <span className="text-xs text-muted-foreground">
            {outcome.endedAtLabel}
          </span>
        ) : null}
      </div>

      <div className="mt-2 text-sm leading-6 text-foreground">
        {outcome.summary}
      </div>

      {outcome.primaryCause ? (
        <div className="mt-2 text-sm text-muted-foreground">
          主因：{outcome.primaryCause}
        </div>
      ) : null}

      <div className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
        <RotateCcw className="h-3.5 w-3.5" />
        <span>
          {outcome.retryable ? "建议可重试或恢复" : "当前无需人工恢复"}
        </span>
      </div>
    </div>
  );
};
